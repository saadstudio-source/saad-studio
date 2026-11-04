export const WAVESPEED_VIDEO_TOOLS = {
  motionTransfer: {
    id: "motion-transfer",
    route: "kwaivgi/kling-v2.6-std/motion-control",
    requiredInputs: ["image", "video", "character_orientation"] as const,
    durations: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    orientations: ["image", "video", "front", "side", "back"],
  },
  objectSwap: {
    id: "object-swap",
    route: "wavespeed-ai/openjutsu/object-swap",
    requiredInputs: ["video", "target"] as const,
    modes: ["change", "background"],
    resolutions: ["480p", "540p", "768p", "1080p"],
    minBilledSeconds: 3,
    maxBilledSeconds: 15,
  },
  videoUpscaler: {
    id: "video-upscaler",
    route: "wavespeed-ai/video-upscaler",
    ultimateRoute: "wavespeed-ai/ultimate-video-upscaler",
    requiredInputs: ["video", "target_resolution"] as const,
    resolutions: ["720p", "1080p", "2k", "4k"],
    maxInputSeconds: 600,
    minBilledSeconds: 3,
    standardUsdPerFiveSeconds: { "720p": 0.025, "1080p": 0.025, "2k": 0.05, "4k": 0.1 },
    ultimateUsdPerFiveSeconds: { "720p": 0.1, "1080p": 0.2, "2k": 0.3, "4k": 0.4 },
  },
} as const;

export type WaveSpeedVideoToolId = keyof typeof WAVESPEED_VIDEO_TOOLS;
