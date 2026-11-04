import { describe, expect, it } from "vitest";
import { WAVESPEED_VIDEO_TOOLS } from "@/lib/video-tools-registry";
import { getVideoCreditsByRoute } from "@/lib/credit-pricing";

describe("WaveSpeed standalone video tools", () => {
  it("keeps the official motion transfer contract", () => {
    expect(WAVESPEED_VIDEO_TOOLS.motionTransfer.route).toBe("kwaivgi/kling-v2.6-std/motion-control");
    expect(WAVESPEED_VIDEO_TOOLS.motionTransfer.requiredInputs).toEqual(["image", "video", "character_orientation"]);
    expect(WAVESPEED_VIDEO_TOOLS.motionTransfer.durations).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });

  it("keeps the official object swap limits and modes", () => {
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.route).toBe("wavespeed-ai/openjutsu/object-swap");
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.modes).toEqual(["change", "background"]);
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.resolutions).toEqual(["480p", "540p", "768p", "1080p"]);
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.minBilledSeconds).toBe(3);
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.maxBilledSeconds).toBe(15);
  });

  it("declares the provider payload fields required by the standalone tools", () => {
    expect(WAVESPEED_VIDEO_TOOLS.objectSwap.requiredInputs).toEqual(["video", "target"]);
    expect(WAVESPEED_VIDEO_TOOLS.motionTransfer.requiredInputs).toEqual(["image", "video", "character_orientation"]);
  });

  it("keeps the official standard and ultimate upscaler contracts", () => {
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.route).toBe("wavespeed-ai/video-upscaler");
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.ultimateRoute).toBe("wavespeed-ai/ultimate-video-upscaler");
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.requiredInputs).toEqual(["video", "target_resolution"]);
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.resolutions).toEqual(["720p", "1080p", "2k", "4k"]);
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.maxInputSeconds).toBe(600);
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.standardUsdPerFiveSeconds["4k"]).toBe(0.1);
    expect(WAVESPEED_VIDEO_TOOLS.videoUpscaler.ultimateUsdPerFiveSeconds["4k"]).toBe(0.4);
  });

  it("prices standalone tools using documented rates and platform margin", () => {
    expect(getVideoCreditsByRoute(WAVESPEED_VIDEO_TOOLS.motionTransfer.route, { duration: 3, resolution: "720p" })).toBe(11.76);
    expect(getVideoCreditsByRoute(WAVESPEED_VIDEO_TOOLS.objectSwap.route, { duration: 3, resolution: "1080p" })).toBe(67.2);
    expect(getVideoCreditsByRoute("wavespeed-ai/video-upscaler", { duration: 3, resolution: "4k" })).toBe(3.36);
  });
});
