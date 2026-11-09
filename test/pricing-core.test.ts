import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prismadb", () => ({
  default: {
    pricingConstitution: {
      findMany: vi.fn(async () => {
        throw new Error("DB unavailable in pricing parity test");
      }),
    },
  },
}));

import {
  estimateProviderCostSync,
  getGenerationCost,
  getGenerationCostSync,
  getLegacyAudioAvatarUserCharge,
  invalidatePricingCache,
} from "@/lib/pricing";
import {
  calcTransitionCredits,
  calcTransitionCreditsForModel,
} from "@/lib/transition-presets";
import {
  getHookStudioCreditsAsync,
  getMusicCredits,
  getMusicCreditsAsync,
  getVideoCreditsByModelId,
  getVideoCreditsByModelIdAsync,
  getVideoCreditsByRoute,
  getVideoCreditsByRouteAsync,
} from "@/lib/credit-pricing";
import { normalizeGoogleVideoOptions } from "@/lib/video-model-registry";

type PricingCase = {
  name: string;
  modelRef: string;
  durationSec?: number;
  numUnits?: number;
  quality?: string | null;
  expected: number;
};

const parityCases: PricingCase[] = [
  {
    name: "Google video",
    modelRef: "google/veo3.1-fast-text-to-video",
    durationSec: 8,
    quality: "1080p",
    expected: 53.76,
  },
  {
    name: "Seedance 2.5",
    modelRef: "bytedance/seedance-2.5/text-to-video-turbo",
    durationSec: 30,
    quality: "720p",
    expected: 302.4,
  },
  {
    name: "Seedance 2.0 Fast",
    modelRef: "bytedance/seedance-2.0/text-to-video-turbo",
    durationSec: 15,
    quality: "1080p",
    expected: 96.6,
  },
  {
    name: "Seedance 2.0 Mini",
    modelRef: "bytedance/seedance-2-mini",
    durationSec: 15,
    quality: "720p",
    expected: 63,
  },
  {
    name: "Seedance 2.0",
    modelRef: "bytedance/seedance-2",
    durationSec: 15,
    quality: "720p",
    expected: 201.6,
  },
  {
    name: "Minimax H3 reference 768p",
    modelRef: "minimax/h3/reference-to-video",
    durationSec: 5,
    quality: "768p",
    expected: 28,
  },
  {
    name: "Minimax H3 text 768p",
    modelRef: "minimax/h3/text-to-video",
    durationSec: 5,
    quality: "768p",
    expected: 28,
  },
  {
    name: "Minimax H3 2K",
    modelRef: "minimax/h3/reference-to-video",
    durationSec: 5,
    quality: "2k",
    expected: 39.2,
  },
  {
    name: "MiniMax H3 Max reference 768p",
    modelRef: "wavespeed-ai/minimax-h3/reference-to-video",
    durationSec: 5,
    quality: "768p",
    expected: 28,
  },
  {
    name: "MiniMax H3 Max text 480p",
    modelRef: "wavespeed-ai/minimax-h3/text-to-video",
    durationSec: 5,
    quality: "480p",
    expected: 11.2,
  },
  {
    name: "Alibaba Wan 3.0 480p",
    modelRef: "alibaba/wan-3.0/text-to-video",
    durationSec: 30,
    quality: "480p",
    expected: 84,
  },
  {
    name: "Alibaba Wan 3.0 720p",
    modelRef: "alibaba/wan-3.0/image-to-video",
    durationSec: 30,
    quality: "720p",
    expected: 168,
  },
  {
    name: "Alibaba Wan 3.0 1080p",
    modelRef: "alibaba/wan-3.0/reference-to-video",
    durationSec: 30,
    quality: "1080p",
    expected: 336,
  },
  {
    name: "GPT Image 2",
    modelRef: "gpt-image-2-text-to-image",
    numUnits: 1,
    quality: "1k",
    expected: 2,
  },
  {
    name: "generic image 1k",
    modelRef: "qwen2/text-to-image",
    numUnits: 1,
    quality: "1k",
    expected: 2,
  },
  {
    name: "generic image 2k",
    modelRef: "qwen2/text-to-image",
    numUnits: 1,
    quality: "2k",
    expected: 2,
  },
  {
    name: "generic image 4k",
    modelRef: "qwen2/text-to-image",
    numUnits: 1,
    quality: "4k",
    expected: 4,
  },
  {
    name: "remove-bg",
    modelRef: "tool:remove-bg",
    expected: 0.4,
  },
  {
    name: "upscale 4k",
    modelRef: "tool:upscale",
    quality: "4k",
    expected: 3.6,
  },
  {
    name: "generic WaveSpeed model",
    modelRef: "tool:watermark-remover",
    durationSec: 10,
    expected: 4,
  },
];

describe("pricing core user charge parity", () => {
  it.each(parityCases)("$name keeps the current user charge", async (testCase) => {
    invalidatePricingCache();

    const duration = testCase.durationSec ?? 5;
    const units = testCase.numUnits ?? 1;
    const asyncCharge = await getGenerationCost(testCase.modelRef, duration, units, testCase.quality);
    const syncCharge = getGenerationCostSync(testCase.modelRef, duration, units, testCase.quality);

    expect(asyncCharge).toBe(testCase.expected);
    expect(syncCharge).toBe(testCase.expected);
    expect(asyncCharge).toBe(syncCharge);
  });

  it("falls back to DEFAULT_MODELS when the DB is unavailable", async () => {
    invalidatePricingCache();

    await expect(getGenerationCost("qwen2/text-to-image", 5, 1, "4k")).resolves.toBe(4);
    expect(getGenerationCostSync("qwen2/text-to-image", 5, 1, "4k")).toBe(4);
  });

  it("keeps legacy audio and avatar user charges in the central user-charge core", async () => {
    invalidatePricingCache();

    await expect(getLegacyAudioAvatarUserCharge("elevenlabs/multilingual-v2", 3, 1, null)).resolves.toMatchObject({
      userCredits: 23,
      sourceCredits: 16,
      marginPercent: 40,
      source: "source-margin",
    });

    await expect(
      getLegacyAudioAvatarUserCharge("kling/ai-avatar-pro", 5, 1, "1080p", {
        avatarProFallbackBaseCredits: 12,
      }),
    ).resolves.toMatchObject({
      userCredits: 17,
      sourceCredits: 12,
      marginPercent: 40,
      source: "avatar-pro-fallback",
    });
  });

  it("reports provider estimate per unit and total without changing user credits", () => {
    const one = estimateProviderCostSync("google/veo3.1-fast-text-to-video", 8, "1080p", 1);
    const two = estimateProviderCostSync("google/veo3.1-fast-text-to-video", 8, "1080p", 2);
    const four = estimateProviderCostSync("google/veo3.1-fast-text-to-video", 8, "1080p", 4);

    expect(one.usd).toBe(0.96);
    expect(two.usd).toBe(1.92);
    expect(four.usd).toBe(3.84);
  });

  it("keeps async charge helpers in parity with legacy sync helpers when DB is unavailable", async () => {
    invalidatePricingCache();

    const modelPayload = { duration: 15, resolution: "720p" };
    const routePayload = { duration: 30, resolution: "720p" };

    await expect(getVideoCreditsByModelIdAsync("bytedance/seedance-2", modelPayload)).resolves.toBe(
      getVideoCreditsByModelId("bytedance/seedance-2", modelPayload),
    );
    await expect(getVideoCreditsByRouteAsync("bytedance/seedance-2.5/text-to-video-turbo", routePayload)).resolves.toBe(
      getVideoCreditsByRoute("bytedance/seedance-2.5/text-to-video-turbo", routePayload),
    );
    expect(getVideoCreditsByRoute("bytedance/seedance-2.5/text-to-video", { duration: 5, resolution: "4k" })).toBe(453.6);
    await expect(getMusicCreditsAsync("elevenlabs/music", 60)).resolves.toBe(getMusicCredits("elevenlabs/music", 60));
  });

  it("prices Alibaba Wan 3.0 short generations from official route-specific rates plus platform margin", async () => {
    invalidatePricingCache();

    await expect(getGenerationCost("alibaba/wan-3.0/text-to-video", 2, 1, "480p")).resolves.toBe(5.6);
    await expect(getGenerationCost("alibaba/wan-3.0/image-to-video", 2, 1, "720p")).resolves.toBe(11.2);
    await expect(getGenerationCost("alibaba/wan-3.0/reference-to-video", 2, 1, "1080p")).resolves.toBe(22.4);
    expect(getVideoCreditsByRoute("alibaba/wan-3.0/reference-to-video", { duration: 2, resolution: "1080p" })).toBe(22.4);
  });

  it("keeps Hyper3D Rodin 2 3D routes billable through the legacy API resolver", async () => {
    invalidatePricingCache();

    await expect(getGenerationCost("hyper3d-rodin-2.image", 5, 1)).resolves.toBe(40);
    await expect(getGenerationCost("hyper3d-rodin-2.text", 5, 1)).resolves.toBe(40);
    expect(getGenerationCostSync("hyper3d-rodin-2.image", 5, 1)).toBe(40);
  });

  it("keeps direct provider video dispatch pricing in parity with the previous sync helper when DB is unavailable", async () => {
    invalidatePricingCache();

    const payload = { duration: 8, quality: "1080p" };
    await expect(getVideoCreditsByModelIdAsync("google/gemini-omni-flash", payload)).resolves.toBe(
      getVideoCreditsByModelId("google/gemini-omni-flash", payload),
    );
  });

  it("prices Gemini Omni Flash user credits by the Higgsfield quality schedule", async () => {
    invalidatePricingCache();

    const expectedByQuality = [
      ["360p", 16.8],
      ["720p", 56],
      ["1080p", 84],
      ["4k", 168],
    ] as const;

    for (const [quality, expected] of expectedByQuality) {
      await expect(getGenerationCost("google/gemini-omni-flash", 10, 1, quality)).resolves.toBe(expected);
      expect(getGenerationCostSync("google/gemini-omni-flash", 10, 1, quality)).toBe(expected);
      expect(getVideoCreditsByRoute("google/gemini-omni-flash", { duration: 10, resolution: quality, sound: true })).toBe(expected);
      expect(getVideoCreditsByModelId("google/gemini-omni-flash", { duration: 10, resolution: quality, sound: true })).toBe(expected);
    }

    expect(estimateProviderCostSync("google/gemini-omni-flash", 10, "720p", 1).usd).toBe(1);
  });

  it("keeps Gemini Omni 1.2 on the Google Omni pricing and documented limits", async () => {
    invalidatePricingCache();

    await expect(getGenerationCost("google/gemini-omni-1.2-flash", 15, 1, "720p")).resolves.toBe(84);
    const options = normalizeGoogleVideoOptions("google/gemini-omni-1.2-flash", {
      duration: 15,
      resolution: "1080p",
      aspectRatio: "9:16",
    });
    expect(options.providerModel).toBe("gemini-omni-1.2-flash");
    expect(options.duration).toBe(15);
    expect(options.resolution).toBe("1080p");
    expect(options.aspectRatio).toBe("9:16");
  });

  it("routes Gemini Omni video input as extension when explicitly requested", () => {
    const omni = normalizeGoogleVideoOptions("google/gemini-omni-flash", {
      duration: 10,
      resolution: "4k",
      hasVideoInput: true,
      requestedMode: "video_extend",
    });
    const veo = normalizeGoogleVideoOptions("google/veo3.1-fast-text-to-video", {
      duration: 8,
      resolution: "4k",
      hasVideoInput: true,
      requestedMode: "video_extend",
    });

    expect(omni.mode).toBe("video_extend");
    expect(omni.resolution).toBe("4k");
    expect(veo.mode).toBe("video_extend");
    expect(veo.resolution).toBe("720p");
  });

  it("keeps Hook Studio legacy fallback charge while using the async resolver entrypoint", async () => {
    invalidatePricingCache();

    await expect(
      getHookStudioCreditsAsync("bytedance-seedance-v25-t2v-turbo", { duration: 15, quality: "720p" }, { legacyUserCredits: 10 }),
    ).resolves.toBe(10);
  });

  it("keeps panel transition legacy charge when the model-aware core default would be lower", async () => {
    invalidatePricingCache();

    const legacyCredits = calcTransitionCredits("morph", 5, "1080p");
    await expect(
      calcTransitionCreditsForModel("morph", 5, "1080p", "kling-2.6/image-to-video", {
        legacyMinimumCredits: legacyCredits,
      }),
    ).resolves.toBe(legacyCredits);
  });
});
