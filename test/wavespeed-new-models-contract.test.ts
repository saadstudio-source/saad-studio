import { describe, expect, it } from "vitest";
import { VIDEO_MODEL_REGISTRY } from "@/lib/video-model-registry";
import { IMAGE_MODELS } from "@/lib/image-models";
import { getVideoCreditsByRoute } from "@/lib/credit-pricing";

describe("WaveSpeed new model contracts", () => {
  it("registers Kling 4.0 with the five documented routes and exact capabilities", () => {
    const model = VIDEO_MODEL_REGISTRY.find((entry) => entry.id === "kling-v4.0");
    expect(model).toBeDefined();
    expect(model?.text_api_route).toBe("kwaivgi/kling-v4.0/text-to-video");
    expect(model?.image_api_route).toBe("kwaivgi/kling-v4.0/image-to-video");
    expect(model?.reference_api_route).toBe("kwaivgi/kling-v4.0/reference-to-video");
    expect(model?.video_api_route).toBe("kwaivgi/kling-v4.0/video-extend");
    expect((model as any)?.edit_api_route).toBe("kwaivgi/kling-v4.0/video-edit");
    expect(model?.capabilities.durations).toEqual(Array.from({ length: 28 }, (_, index) => index + 3));
    expect(model?.capabilities.resolutions).toEqual(["720p", "1080p"]);
    expect(model?.capabilities.aspect_ratios).toEqual(["16:9", "9:16", "1:1", "21:9"]);
    expect(model?.capabilities.max_reference_images).toBe(10);
    expect(model?.capabilities.max_reference_videos).toBe(5);
    expect(model?.capabilities.max_reference_audios).toBe(3);
  });

  it("exposes all five GPT Image 2.5 quality tiers and 4K", () => {
    const models = IMAGE_MODELS.filter((entry) => entry.id.includes("gpt-image-2.5"));
    expect(models).toHaveLength(4);
    for (const model of models) {
      expect(model.qualityParam).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(model.aspectRatios).toEqual(expect.arrayContaining(["9:21", "21:9", "1:3", "3:1"]));
      expect(model.resolutions).toEqual(["1k", "2k", "4k"]);
    }
  });

  it("uses the documented Kling 4.0 tariff by mode", () => {
    expect(getVideoCreditsByRoute("kwaivgi/kling-v4.0/text-to-video", { duration: 5, resolution: "720p" })).toBe(43.96);
    expect(getVideoCreditsByRoute("kwaivgi/kling-v4.0/video-extend", { duration: 5, resolution: "1080p" })).toBe(65.8);
    expect(getVideoCreditsByRoute("kwaivgi/kling-v4.0/video-edit", { duration: 5, resolution: "720p", source_video_duration: 5 })).toBe(52.64);
    expect(getVideoCreditsByRoute("kwaivgi/kling-v4.0/reference-to-video", { duration: 5, resolution: "720p", videos: ["v"], source_video_duration: 8 })).toBe(59.79);
    expect(getVideoCreditsByRoute("kwaivgi/kling-v4.0/reference-to-video", { duration: 15, resolution: "720p", videos: ["v"], source_video_duration: 15 })).toBe(112.1);
  });
});
