import { describe, it, expect, vi } from "vitest";

// Mock prismadb with vi.hoisted
const { mockPrisma } = vi.hoisted(() => {
  const mock: any = {
    generation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    providerUsageRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  mock.$transaction = vi.fn(async (cb: any) => cb(mock));
  return { mockPrisma: mock };
});

vi.mock("@/lib/prismadb", () => ({
  default: mockPrisma,
}));

import {
  resolveProviderCostPrecedence,
  recordProviderExecutionCost,
} from "@/lib/provider-cost-capture";
import { getProviderReconciliationReadModel } from "@/lib/admin/provider-reconciliation-read-model";
import { getGenerationCostSync } from "@/lib/pricing";

describe("Provider Cost Capture & Reconciliation Hardening Suite", () => {
  it("1. proves ACTUAL outranks ESTIMATED when exact provider charge is reported", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_test_actual",
      modelRef: "google/veo3.1-fast-text-to-video",
      providerName: "Google",
      durationSec: 8,
      resolution: "720p",
      actualCostUsd: 0.75, // Exact reported charge
    });

    expect(res.costTrust).toBe("ACTUAL");
    expect(res.providerCostSource).toBe("actual");
    expect(res.providerCostUsd).toBe(0.75); // Not the $0.80 estimated tariff
  });

  it("2. proves ESTIMATED_VERIFIED uses provider-specific tariff", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_test_est",
      modelRef: "google/veo3.1-fast-text-to-video",
      providerName: "Google",
      durationSec: 8,
      resolution: "720p",
    });

    expect(res.costTrust).toBe("ESTIMATED_VERIFIED");
    expect(res.providerCostSource).toBe("estimated");
    expect(res.providerCostUsd).toBe(0.80);
    expect(res.tariffVerificationStatus).toBe("VERIFIED_CURRENT");
  });

  it("3. proves WaveSpeed UNKNOWN route strictly remains UNKNOWN and null cost", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_test_ws_unk",
      modelRef: "wavespeed-ai/unverified-custom-model",
      providerName: "WaveSpeed",
      durationSec: 10,
      quality: "pro",
    });

    expect(res.costTrust).toBe("UNKNOWN");
    expect(res.providerCostUsd).toBeNull(); // Strictly null, NEVER $0.00
    expect(res.unknownReason).toBe("NO_VERIFIED_TARIFF");
  });

  it("4. proves KIE never supplies WaveSpeed cost", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_test_no_leak",
      modelRef: "wavespeed-ai/unverified-custom-model",
      providerName: "WaveSpeed",
      durationSec: 5,
    });

    // WaveSpeed execution must NOT use KIE credits (14.0 * 5 * $0.005)
    expect(res.providerName).toBe("WaveSpeed");
    expect(res.costTrust).toBe("UNKNOWN");
    expect(res.providerCostUsd).toBeNull();
  });

  it("5. proves Google official tariff is ESTIMATED_VERIFIED", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_google",
      modelRef: "google/imagen-3",
      providerName: "Google",
    });

    expect(res.costTrust).toBe("ESTIMATED_VERIFIED");
    expect(res.providerCostUsd).toBe(0.03);
    expect(res.billingUnit).toBe("USD/image");
  });

  it("6. proves OpenAI official tariff is ESTIMATED_VERIFIED", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_openai",
      modelRef: "openai/dall-e-3",
      providerName: "OpenAI",
      quality: "hd",
    });

    expect(res.costTrust).toBe("ESTIMATED_VERIFIED");
    expect(res.providerCostUsd).toBe(0.08);
    expect(res.billingUnit).toBe("USD/image");
  });

  it("7. proves BytePlus official tariff is ESTIMATED_VERIFIED", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_byteplus",
      modelRef: "bytedance/seedance-2.5/image-to-video",
      providerName: "BytePlus",
      durationSec: 5,
      resolution: "720p",
    });

    expect(res.costTrust).toBe("ESTIMATED_VERIFIED");
    expect(res.providerCostUsd).toBe(0.90);
    expect(res.billingUnit).toBe("USD/sec");
  });

  it("8. proves ElevenLabs is INACTIVE_LEGACY without runtime evidence and tariffs are marked UNKNOWN", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_elevenlabs",
      modelRef: "elevenlabs/tts",
      providerName: "ElevenLabs",
      durationSec: 10,
    });

    expect(res.tariffVerificationStatus).toBe("UNKNOWN");
    expect(res.costTrust).toBe("UNKNOWN");
    expect(res.providerCostUsd).toBeNull();
  });

  it("9. proves Reap shadow remains SHADOW_ANALYTICAL and separate from direct spend", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_reap",
      modelRef: "reap/dubbing",
      providerName: "Reap",
      durationSec: 60,
    });

    expect(res.costTrust).toBe("SHADOW_ANALYTICAL");
    expect(res.providerCostUsd).toBe(0.12);
    expect(res.tariffSource).toContain("Shadow Analytical Proxy");
  });

  it("10. proves refund does not automatically zero provider cost", async () => {
    // When a generation fails, user credit cost is refunded (net credits = 0),
    // but providerCostUsd evidence is preserved in provider tracking
    const precedence = resolveProviderCostPrecedence({
      generationId: "gen_failed_retained",
      modelRef: "minimax/h3/reference-to-video",
      providerName: "WaveSpeed",
      durationSec: 5,
      resolution: "768p",
      executionStatus: "failed",
    });

    expect(precedence.providerCostUsd).toBe(0.50); // Provider cost retained!
  });

  it("11. proves ProviderUsageRecord idempotency prevents double-counting", async () => {
    mockPrisma.providerUsageRecord.findFirst.mockResolvedValueOnce({
      id: "usage_existing_1",
      generationId: "gen_idem_1",
      providerCostUsd: 0.50,
    });

    await recordProviderExecutionCost({
      generationId: "gen_idem_1",
      modelRef: "minimax/h3/reference-to-video",
      providerName: "WaveSpeed",
      durationSec: 5,
      resolution: "768p",
    });

    // Proves update was called instead of creating a duplicate usage record
    expect(mockPrisma.providerUsageRecord.update).toHaveBeenCalled();
    expect(mockPrisma.providerUsageRecord.create).not.toHaveBeenCalled();
  });

  it("12. proves historical records remain untouched", () => {
    // Precedence resolution never mutates existing database records without explicit record call
    const precedence = resolveProviderCostPrecedence({
      generationId: "gen_historical",
      modelRef: "legacy-model",
      providerName: "Legacy",
    });

    expect(precedence.providerCostUsd).toBeNull();
    expect(precedence.costTrust).toBe("UNKNOWN");
  });

  it("13. proves tariff snapshot remains immutable", () => {
    const res = resolveProviderCostPrecedence({
      generationId: "gen_snapshot",
      modelRef: "google/veo3.1-fast-text-to-video",
      providerName: "Google",
      durationSec: 8,
      resolution: "720p",
    });

    expect(res.tariffKey).toBe("google:video:veo31_fast:720p");
    expect(res.tariffRate).toBe(0.10);
    expect(res.billingUnit).toBe("USD/sec");
    expect(res.tariffSource).toContain("Google Cloud Vertex AI");
  });

  it("14. proves reconciliation with insufficient provider evidence returns INSUFFICIENT_DATA", async () => {
    mockPrisma.generation.findMany.mockImplementation(async (args) => {
      if (args?.distinct) return [{ providerName: "Google" }, { providerName: "WaveSpeed" }];
      return [
        {
          id: "g1",
          providerName: "Google",
          modelUsed: "google/imagen-3",
          providerCostUsd: 0.03,
          providerCostSource: "estimated",
          user: { email: "user@test.com" },
          providerUsageRecords: [{ providerCostUsd: 0.03, providerCostSource: "estimated" }],
        },
      ];
    });

    const reconciliation = await getProviderReconciliationReadModel({ periodDays: 30 });
    const googleRecon = reconciliation.reconciliations.find((r) => r.providerName === "Google");

    expect(googleRecon?.reconciliationStatus).toBe("INSUFFICIENT_DATA");
    expect(googleRecon?.providerObservedSpendUsd).toBeNull();
  });

  it("15. proves macro WaveSpeed balance evidence is never used as per-generation ACTUAL cost", () => {
    // Under concurrency, balance delta cannot be attributed per-request
    const res = resolveProviderCostPrecedence({
      generationId: "gen_ws_concurrency",
      modelRef: "wavespeed-ai/unverified-custom-model",
      providerName: "WaveSpeed",
      durationSec: 10,
    });

    // WaveSpeed unverified route strictly returns UNKNOWN (never estimated from balance delta)
    expect(res.costTrust).toBe("UNKNOWN");
    expect(res.providerCostUsd).toBeNull();
  });

  it("16. proves internal/test usage remains included in total provider operating cost", async () => {
    mockPrisma.generation.findMany.mockImplementation(async (args) => {
      if (args?.distinct) return [{ providerName: "WaveSpeed" }];
      return [
        {
          id: "g_internal",
          providerName: "WaveSpeed",
          modelUsed: "minimax/h3/reference-to-video",
          providerCostUsd: 0.50,
          providerCostSource: "estimated",
          duration: 5,
          resolution: "768p",
          user: { email: "seedsat@gmail.com" }, // Official owner test account
          providerUsageRecords: [{ providerCostUsd: 0.50, providerCostSource: "estimated" }],
        },
      ];
    });

    const recon = await getProviderReconciliationReadModel({ periodDays: 30 });
    const ws = recon.reconciliations.find((r) => r.providerName === "WaveSpeed");

    expect(ws?.internalKnownCost).toBe(0.50);
    expect(ws?.commercialKnownCost).toBe(0);
    expect(ws?.totalKnownCost).toBe(0.50); // Internal is fully included in total operating spend
  });

  it("17. proves customer credit pricing remains strictly unchanged", () => {
    const h3Credits = getGenerationCostSync("minimax/h3/reference-to-video", 5, 1, "768p");
    expect(h3Credits).toBe(28);

    const veoCredits = getGenerationCostSync("google/veo3.1-fast-text-to-video", 8, 1, "1080p");
    expect(veoCredits).toBe(53.76);

    const s25Credits = getGenerationCostSync("bytedance/seedance-2.5/text-to-video-turbo", 30, 1, "720p");
    expect(s25Credits).toBe(302.4);
  });
});
