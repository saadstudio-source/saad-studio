import { describe, it, expect } from "vitest";
import { VIDEO_MODEL_REGISTRY } from "@/lib/video-model-registry";
import { VIDEO_MODELS } from "@/lib/video-models";
import { DEFAULT_MODELS } from "@/lib/pricing-models";
import { getVideoCreditsByRoute, getVideoCreditsByModelId } from "@/lib/credit-pricing";
import { resolveCanonicalProviderTariff } from "@/lib/provider-tariff-registry";
import { normalizeDynamicVideoModels, DynamicVideoModel } from "@/lib/dynamic-model-loader";

describe("Minimax Hailuo Contract and Specification Tests", () => {
  it("should have all 7 models registered under family 'hailuo' in exact dropdown sequence", () => {
    const hailuoModels = VIDEO_MODEL_REGISTRY.filter((m) => m.family === "hailuo");
    expect(hailuoModels.length).toBe(7);

    const expectedOrder = [
      { id: "minimax-h3", name: "Minimax H3", badge: null },
      { id: "minimax-h3-max", name: "MiniMax H3 Max", badge: null },
      { id: "minimax-hailuo-02-pro", name: "MiniMax Hailuo 02 Pro", badge: null },
      { id: "minimax-hailuo-02-standard", name: "MiniMax Hailuo 02 Standard", badge: null },
      { id: "minimax-hailuo-02-fast", name: "MiniMax Hailuo 02 Fast", badge: null },
      { id: "minimax-hailuo-2.3-pro", name: "MiniMax Hailuo 2.3 Pro", badge: null },
      { id: "minimax-hailuo-2.3-fast", name: "MiniMax Hailuo 2.3 Fast", badge: null },
    ];

    expectedOrder.forEach((expected, index) => {
      const actual = hailuoModels[index];
      expect(actual.id).toBe(expected.id);
      expect(actual.name).toBe(expected.name);
      expect(actual.badge ?? null).toBe(expected.badge);
      expect(actual.route_confirmed).toBe(true);

      const vm = VIDEO_MODELS.find((m) => m.id === actual.id);
      expect(vm).toBeDefined();
      expect(vm?.family).toBe("Hailuo");
    });
  });

  it("should mirror all 7 models into VIDEO_MODELS with correct accepts flags", () => {
    const h3 = VIDEO_MODELS.find((m) => m.id === "minimax-h3");
    expect(h3).toBeDefined();
    expect(h3?.accepts).toContain("start-frame");
    expect(h3?.accepts).toContain("end-frame");
    expect(h3?.aspectRatios).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"]);
    expect(h3?.durations).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(h3?.resolutions).toEqual(["768p", "2k"]);

    const h3Max = VIDEO_MODELS.find((m) => m.id === "minimax-h3-max");
    expect(h3Max).toBeDefined();
    expect(h3Max?.accepts).toContain("start-frame");
    expect(h3Max?.accepts).toContain("end-frame");
    expect(h3Max?.durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(h3Max?.resolutions).toEqual(["480p", "768p"]);

    const h02Pro = VIDEO_MODELS.find((m) => m.id === "minimax-hailuo-02-pro");
    expect(h02Pro).toBeDefined();
    expect(h02Pro?.accepts).toContain("start-frame");
    expect(h02Pro?.accepts).toContain("end-frame");

    const h02Std = VIDEO_MODELS.find((m) => m.id === "minimax-hailuo-02-standard");
    expect(h02Std).toBeDefined();
    expect(h02Std?.accepts).toContain("start-frame");
    expect(h02Std?.accepts).toContain("end-frame");

    const h02Fast = VIDEO_MODELS.find((m) => m.id === "minimax-hailuo-02-fast");
    expect(h02Fast).toBeDefined();
    expect(h02Fast?.accepts).toContain("start-frame");
    expect(h02Fast?.accepts).not.toContain("end-frame");

    const h23Pro = VIDEO_MODELS.find((m) => m.id === "minimax-hailuo-2.3-pro");
    expect(h23Pro).toBeDefined();
    expect(h23Pro?.accepts).toContain("start-frame");
    expect(h23Pro?.accepts).not.toContain("end-frame");
    expect(h02Pro?.durations).toEqual([6]);
    expect(h23Pro?.durations).toEqual([6]);

    const h23Fast = VIDEO_MODELS.find((m) => m.id === "minimax-hailuo-2.3-fast");
    expect(h23Fast).toBeDefined();
    expect(h23Fast?.accepts).toContain("start-frame");
    expect(h23Fast?.accepts).not.toContain("end-frame");
  });

  it("should strictly enforce empty aspect_ratios array for Hailuo models (image-derived AR)", () => {
    const hailuoModels = VIDEO_MODEL_REGISTRY.filter(
      (m) => m.id.startsWith("minimax-hailuo-")
    );
    for (const m of hailuoModels) {
      expect(m.capabilities.aspect_ratios).toEqual([]);
    }
  });

  it("should calculate exact credit costs per formula for all Minimax models", () => {
    // Hailuo 02 Pro: 6s fixed -> $0.49 * 56 = 27.44 cr
    expect(getVideoCreditsByModelId("minimax-hailuo-02-pro")).toBe(27.44);
    expect(getVideoCreditsByRoute("minimax/hailuo-02/pro")).toBe(27.44);
    expect(getVideoCreditsByRoute("minimax/hailuo-02/standard", { duration: 6 })).toBe(12.88);
    expect(getVideoCreditsByRoute("minimax/hailuo-02/standard", { duration: 10 })).toBe(31.36);
    expect(getVideoCreditsByRoute("minimax/hailuo-02/fast", { duration: 6 })).toBe(5.60);
    expect(getVideoCreditsByRoute("minimax/hailuo-02/fast", { duration: 10 })).toBe(8.40);

    // Hailuo 2.3 Pro: 5s/6s fixed -> $0.49 * 56 = 27.44 cr
    expect(getVideoCreditsByModelId("minimax-hailuo-2.3-pro")).toBe(27.44);
    expect(getVideoCreditsByRoute("minimax/hailuo-2.3/t2v-pro")).toBe(27.44);
    expect(getVideoCreditsByRoute("minimax/hailuo-2.3/i2v-pro")).toBe(27.44);

    // Hailuo 2.3 Fast: 6s / 10s
    expect(getVideoCreditsByModelId("minimax-hailuo-2.3-fast", { duration: 6 })).toBe(10.64);
    expect(getVideoCreditsByModelId("minimax-hailuo-2.3-fast", { duration: 10 })).toBe(17.92);

    // H3 official: 768p -> 5.6 cr/s, 2K -> 7.84 cr/s
    expect(getVideoCreditsByModelId("minimax-h3", { duration: 5, quality: "768p" })).toBe(28);
    expect(getVideoCreditsByModelId("minimax-h3", { duration: 5, quality: "2k" })).toBe(39.2);
    expect(getVideoCreditsByModelId("minimax-h3", { duration: 10, quality: "768p" })).toBe(56);
    expect(getVideoCreditsByModelId("minimax-h3", { duration: 10, quality: "2k" })).toBe(78.4);

    // H3 Max Open Weights: 480p text/image -> 2.24 cr/s, 768p reference -> 5.6 cr/s
    expect(getVideoCreditsByModelId("minimax-h3-max", { duration: 5, quality: "480p" })).toBe(11.2);
    expect(getVideoCreditsByRoute("wavespeed-ai/minimax-h3/reference-to-video", { duration: 5, resolution: "768p" })).toBe(28);
    expect(getVideoCreditsByRoute("wavespeed-ai/minimax-h3/reference-to-video", { duration: 5, resolution: "768p", reference_video_durations: [5, 5, 5] })).toBe(112);
  });

  it("should resolve verified WaveSpeed tariffs from registry", () => {
    const tariffH02 = resolveCanonicalProviderTariff({
      modelRef: "minimax-hailuo-02-pro",
      providerName: "WaveSpeed",
      providerRoute: "minimax/hailuo-02/pro",
      durationSec: 6,
    });
    expect(tariffH02.usd).toBe(0.49);
    expect(tariffH02.providerName).toBe("WaveSpeed");
    expect(tariffH02.tariffKey).toBe("wavespeed:video:minimax-hailuo-02:pro");

    const tariffH23 = resolveCanonicalProviderTariff({
      modelRef: "minimax-hailuo-2.3-pro",
      providerName: "WaveSpeed",
      providerRoute: "minimax/hailuo-2.3/t2v-pro",
      durationSec: 5,
    });
    expect(tariffH23.usd).toBe(0.49);
    expect(tariffH23.providerName).toBe("WaveSpeed");
    expect(tariffH23.tariffKey).toBe("wavespeed:video:minimax-hailuo-2.3:pro");

    const tariffH3 = resolveCanonicalProviderTariff({
      modelRef: "minimax-h3",
      providerName: "WaveSpeed",
      providerRoute: "minimax/h3/reference-to-video",
      durationSec: 5,
      quality: "768p",
    });
    expect(tariffH3.usd).toBe(0.50);
    expect(tariffH3.providerName).toBe("WaveSpeed");

    const tariffH3Max = resolveCanonicalProviderTariff({
      modelRef: "minimax-h3-max",
      providerName: "WaveSpeed",
      providerRoute: "wavespeed-ai/minimax-h3/reference-to-video",
      durationSec: 5,
      quality: "768p",
    });
    expect(tariffH3Max.usd).toBe(0.50);
    expect(tariffH3Max.tariffKey).toBe("wavespeed:video:minimax-h3-max:768p:reference");
  });

  it("should enforce zero duplicates and filter out legacy and fake blocked IDs in normalizeDynamicVideoModels", () => {
    // Simulate raw models containing legacy, fake, and valid models
    const mockDbModels: Partial<DynamicVideoModel>[] = [
      {
        id: "minimax-h3-max",
        name: "Minimax H3 Max",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "wavespeed-ai/minimax-h3/reference-to-video",
      },
      {
        id: "minimax-h3-max-turbo",
        name: "Minimax H3 Max Turbo",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/h3-max-turbo",
      },
      {
        id: "minimax-live-illustrations",
        name: "MiniMax Live Illustrations",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/live-illustrations",
      },
      {
        id: "minimax-h3",
        name: "Minimax H3",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/h3/image-to-video",
      },
      {
        id: "minimax-hailuo-02-pro",
        name: "MiniMax Hailuo 02 Pro",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/hailuo-02/pro",
      },
      {
        id: "minimax-hailuo-02-standard",
        name: "MiniMax Hailuo 02 Standard",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/hailuo-02/standard",
      },
      {
        id: "minimax-hailuo-02-fast",
        name: "MiniMax Hailuo 02 Fast",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/hailuo-02/fast",
      },
      {
        id: "minimax-hailuo-2.3-pro",
        name: "MiniMax Hailuo 2.3 Pro",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/hailuo-2.3/pro",
      },
      {
        id: "minimax-hailuo-2.3-fast",
        name: "MiniMax Hailuo 2.3 Fast",
        group: "Minimax Hailuo",
        family_label: "Minimax Hailuo",
        api_route: "minimax/hailuo-2.3/fast",
      },
    ];

    const normalized = normalizeDynamicVideoModels(mockDbModels as DynamicVideoModel[]);

    const hailuoFleet = normalized.filter(
      (m) =>
        m.group?.toLowerCase().includes("hailuo") ||
        (m as any).family_label?.toLowerCase().includes("hailuo") ||
        m.id.startsWith("minimax-")
    );

    // Assert blocked fake and legacy IDs are completely absent
    const blockedFound = hailuoFleet.filter((m) =>
      ["minimax-h3-max-turbo", "minimax-live-illustrations", "minimax-h3-reference-to-video"].includes(m.id)
    );
    expect(blockedFound).toHaveLength(0);

    // Assert every name in the hailuo group is strictly unique (no duplicates)
    const names = hailuoFleet.map((m) => m.name.trim().toLowerCase());
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);

    // Assert exactly the 7 canonical Minimax models exist
    expect(hailuoFleet.length).toBe(7);
  });

  it("should never route any Minimax/Hailuo models to KIE and must route to WaveSpeed", async () => {
    const { BASE_VIDEO_ROUTE_TO_KIE_MODEL, WAVESPEED_VIDEO_FALLBACK_MAP } = await import("@/lib/kie-model-routing");
    
    // Assert KIE video route map does not map any minimax or hailuo routes
    const kieKeys = Object.keys(BASE_VIDEO_ROUTE_TO_KIE_MODEL);
    const minimaxInKie = kieKeys.filter(k => k.includes("minimax") || k.includes("hailuo"));
    expect(minimaxInKie).toEqual([]);

    // Assert WAVESPEED_VIDEO_FALLBACK_MAP properly falls back legacy routes to WaveSpeed minimax routes
    expect(WAVESPEED_VIDEO_FALLBACK_MAP["hailuo/02-text-to-video-pro"]).toBe("minimax/hailuo-02/t2v-pro");
    expect(WAVESPEED_VIDEO_FALLBACK_MAP["hailuo/02-image-to-video-pro"]).toBe("minimax/hailuo-02/i2v-pro");
    expect(WAVESPEED_VIDEO_FALLBACK_MAP["hailuo/2-3-image-to-video-pro"]).toBe("minimax/hailuo-2.3/i2v-pro");
    expect(WAVESPEED_VIDEO_FALLBACK_MAP["minimax/hailuo-2.3/i2v-pro"]).toBe("minimax/hailuo-2.3/i2v-pro");

    // Test mapToWavespeedInput for Hailuo 02 Pro with start and end image
    const { mapToWavespeedInput } = await import("@/lib/video/wavespeed-input");
    const wsInput = mapToWavespeedInput({
      prompt: "Cinematic camera movement",
      image: "https://example.com/start.png",
      end_image: "https://example.com/end.png",
      duration: 6,
    }, "minimax/hailuo-02/i2v-pro");

    expect(wsInput.prompt).toBe("Cinematic camera movement");
    expect(wsInput.image).toBe("https://example.com/start.png");
    expect(wsInput.end_image).toBe("https://example.com/end.png");
    expect(wsInput.duration).toBe(6);
    expect(wsInput.enable_prompt_expansion).toBe(true);
  });

  it("should keep Minimax H3 uploaded reference images as reference media with official prompt tags", async () => {
    const { mapToWavespeedInput } = await import("@/lib/video/wavespeed-input");
    const refs = Array.from({ length: 8 }, (_, index) => `https://example.com/ref-${index + 1}.png`);

    const wsInput = mapToWavespeedInput({
      prompt: "Use @Image1 as the hero and @Image2 as the set. Match @Video1 if present.",
      duration: 5,
      resolution: "2k",
      aspect_ratio: "16:9",
      reference_image_urls: refs,
    }, "minimax/h3/reference-to-video");

    expect(wsInput.prompt).toContain("<Picture 1>");
    expect(wsInput.prompt).toContain("<Picture 2>");
    expect(wsInput.prompt).toContain("<Video 1>");
    expect(wsInput.reference_images).toEqual(refs);
    expect(wsInput).not.toHaveProperty("image");
    expect(wsInput).not.toHaveProperty("last_image");
    expect(wsInput.resolution).toBe("2k");
    expect(wsInput.duration).toBe(5);
  });
});
