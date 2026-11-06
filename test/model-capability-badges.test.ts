import { describe, it, expect } from "vitest";
import { extractModelCapabilities } from "@/components/video/ModelCapabilityBadges";
import {
  getSeedanceComposerMediaConflict,
  supportsSeedanceComposerAspectRatio,
  VIDEO_MODEL_REGISTRY,
} from "@/lib/video-model-registry";

describe("Model Capability Badges Contract Tests", () => {
  it("should accurately extract capabilities for Kling 3.0 Pro without guessing", () => {
    const kling30Pro = VIDEO_MODEL_REGISTRY.find(m => m.id === "kling-v3.0-pro-t2v");
    expect(kling30Pro).toBeDefined();

    const caps = extractModelCapabilities(kling30Pro);
    expect(caps.refs).toBe(true);
    expect(caps.multi).toBe(true);
    expect(caps.seed).toBe(false); // Kling 3.0 has no seed parameter per official schema
    expect(caps.startEnd).toBe("Start/End");
    expect(caps.audio).toBe(true);
    expect(caps.duration).toBe("3 - 15\"");
    expect(caps.creditRange).toBeTruthy();
  });

  it("should accurately extract capabilities for Wan 2.1 models with Custom seed", () => {
    const wanModel = VIDEO_MODEL_REGISTRY.find(m => m.capabilities?.has_seed);
    expect(wanModel).toBeDefined();

    const caps = extractModelCapabilities(wanModel);
    expect(caps.seed).toBe(true);
  });

  it("should accurately extract capabilities for Minimax H3 without guessing", () => {
    const minimaxH3 = VIDEO_MODEL_REGISTRY.find(m => m.id === "minimax-h3");
    expect(minimaxH3).toBeDefined();

    const caps = extractModelCapabilities(minimaxH3);
    expect(caps.refs).toBe(true);
    expect(caps.startEnd).toBe("Start/End");
    expect(caps.duration).toBe("5 - 15\"");
    expect(caps.resolution).toBe("2K");
    expect(caps.creditRange).toBeTruthy();
  });

  it("should accurately extract capabilities for MiniMax H3 Max without mixing it with official H3", () => {
    const h3Max = VIDEO_MODEL_REGISTRY.find(m => m.id === "minimax-h3-max");
    expect(h3Max).toBeDefined();

    const caps = extractModelCapabilities(h3Max);
    expect(caps.refs).toBe(true);
    expect(caps.startEnd).toBe("Start/End");
    expect(caps.duration).toBe("3 - 15\"");
    expect(caps.resolution).toBe("768p");
  });

  it("should accurately extract capabilities for Hailuo 02 Pro with fixed 6s duration", () => {
    const hailuo02Pro = VIDEO_MODEL_REGISTRY.find(m => m.id === "minimax-hailuo-02-pro");
    expect(hailuo02Pro).toBeDefined();

    const caps = extractModelCapabilities(hailuo02Pro);
    expect(caps.startEnd).toBe("Start/End");
    expect(caps.duration).toBe("6\"");
    expect(caps.resolution).toBe("1080p");
    expect(caps.creditRange).toBe("27.4");
  });

  it("should accurately extract capabilities for Hailuo 02 Fast with Start only", () => {
    const hailuo02Fast = VIDEO_MODEL_REGISTRY.find(m => m.id === "minimax-hailuo-02-fast");
    expect(hailuo02Fast).toBeDefined();

    const caps = extractModelCapabilities(hailuo02Fast);
    expect(caps.startEnd).toBe("Start");
    expect(caps.duration).toBe("6 - 10\"");
    expect(caps.creditRange).toContain("5.6");
  });

  it("should accurately extract capabilities for Kling V3 Turbo", () => {
    const turbo = VIDEO_MODEL_REGISTRY.find(m => m.id === "kling-v3-turbo");
    expect(turbo).toBeDefined();

    const caps = extractModelCapabilities(turbo);
    expect(caps.multi).toBe(true);
    expect(caps.duration).toBe("3 - 15\"");
    expect(caps.creditRange).toBeTruthy();
  });

  it("keeps the visible Seedance cards aligned with the official WaveSpeed contracts", () => {
    const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
    const cases = [
      {
        id: "bytedance-seedance-v25-t2v",
        name: "Seedance 2.5",
        text: "bytedance/seedance-2.5/text-to-video",
        image: "bytedance/seedance-2.5/image-to-video",
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxDuration: 30,
        refs: [30, 10, 10],
      },
      {
        id: "bytedance-seedance-v25-t2v-turbo",
        name: "Seedance 2.5 Turbo",
        text: "bytedance/seedance-2.5/text-to-video-turbo",
        image: "bytedance/seedance-2.5/image-to-video-turbo",
        resolutions: ["720p", "1080p"],
        maxDuration: 30,
        refs: [30, 10, 10],
      },
      {
        id: "bytedance-seedance-v2-t2v-fast",
        text: "bytedance/seedance-2.0/text-to-video-turbo",
        image: "bytedance/seedance-2.0/image-to-video-turbo",
        resolutions: ["720p", "1080p"],
        maxDuration: 15,
        refs: [9, 3, 3],
      },
      {
        id: "bytedance-seedance-v2-t2v-mini",
        text: "bytedance/seedance-2.0-mini/text-to-video",
        image: "bytedance/seedance-2.0-mini/image-to-video",
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxDuration: 15,
        refs: [9, 3, 3],
      },
      {
        id: "bytedance-seedance-v2-t2v",
        text: "bytedance/seedance-2.0/text-to-video",
        image: "bytedance/seedance-2.0/image-to-video",
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxDuration: 15,
        refs: [9, 3, 3],
      },
      {
        id: "bytedance-seedance-v2-fast",
        text: "bytedance/seedance-2.0-fast/text-to-video",
        image: "bytedance/seedance-2.0-fast/image-to-video",
        resolutions: ["480p", "720p", "1080p", "4k"],
        maxDuration: 15,
        refs: [9, 3, 3],
      },
      {
        id: "bytedance-seedance-v2-mini-turbo",
        text: "bytedance/seedance-2.0-mini/text-to-video-turbo",
        image: "bytedance/seedance-2.0-mini/image-to-video-turbo",
        resolutions: ["720p", "1080p"],
        maxDuration: 15,
        refs: [9, 3, 3],
      },
    ] as const;

    for (const expected of cases) {
      const model = VIDEO_MODEL_REGISTRY.find((candidate) => candidate.id === expected.id);
      expect(model, expected.id).toBeDefined();
      if ("name" in expected) expect(model?.name).toBe(expected.name);
      expect(model?.text_api_route).toBe(expected.text);
      expect(model?.reference_api_route).toBe(expected.text);
      expect(model?.image_api_route).toBe(expected.image);
      expect(model?.start_end_api_route).toBe(expected.image);
      expect(model?.capabilities.has_end_frame).toBe(true);
      expect([...(model?.capabilities.aspect_ratios ?? [])].sort()).toEqual([...ratios].sort());
      expect(model?.capabilities.resolutions).toEqual(expected.resolutions);
      expect(model?.capabilities.durations.at(0)).toBe(4);
      expect(model?.capabilities.durations.at(-1)).toBe(expected.maxDuration);
      expect([
        model?.capabilities.max_reference_images,
        model?.capabilities.max_reference_videos,
        model?.capabilities.max_reference_audios,
      ]).toEqual(expected.refs);
    }
  });

  it("rejects invalid Seedance Start/End and References combinations before submission", () => {
    const route = "bytedance/seedance-2.0-mini/text-to-video";

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: false,
      hasEndFrame: true,
      hasReferenceMedia: false,
    })).toBe("end_requires_start");

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: true,
      hasEndFrame: true,
      hasReferenceMedia: true,
    })).toBe("frames_and_references_conflict");

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: false,
      hasEndFrame: true,
      hasReferenceMedia: true,
    })).toBe("frames_and_references_conflict");

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: true,
      hasEndFrame: true,
      hasReferenceMedia: false,
    })).toBeNull();

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: false,
      hasEndFrame: false,
      hasReferenceMedia: true,
    })).toBeNull();

    expect(getSeedanceComposerMediaConflict(route, {
      hasStartFrame: false,
      hasEndFrame: true,
      hasReferenceMedia: false,
      isExtendMode: true,
    })).toBeNull();
  });

  it("uses real aspect-ratio behavior for Seedance text and image routes", () => {
    expect(supportsSeedanceComposerAspectRatio(
      "bytedance/seedance-2.5/text-to-video-turbo",
      false,
    )).toBe(true);
    expect(supportsSeedanceComposerAspectRatio(
      "bytedance/seedance-2.5/text-to-video-turbo",
      true,
    )).toBe(false);
    expect(supportsSeedanceComposerAspectRatio(
      "bytedance/seedance-2.0-mini/text-to-video",
      true,
    )).toBe(true);
  });
});
