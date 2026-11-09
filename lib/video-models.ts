export type ModelInputType = "text-to-video" | "image-to-video" | "video-to-video";
export type ModelBadge = "TOP" | "NEW" | "New" | "PRO" | "FAST" | "50% off" | null | string;
export type AcceptedAsset = "start-frame" | "end-frame" | "reference-image" | "video" | "multi-image";

export interface VideoModel {
  id: string;
  name: string;
  family: string;
  familyColor: string;
  inputType: ModelInputType;
  accepts?: AcceptedAsset[];
  maxImages?: number;
  /** Allowed aspect ratio values from the API. `[]` = auto/N/A (hide dropdown). `undefined` = show global defaults. */
  aspectRatios?: string[];
  /** Exact allowed duration values in seconds. `[]` = N/A (hide dropdown). `undefined` = use maxDuration range. */
  durations?: number[];
  /** Real API resolution strings. `undefined` = hide resolution dropdown. */
  resolutions?: string[];
  /** Grok-specific mode (fun / normal / spicy). */
  grokMode?: boolean;
  badge: ModelBadge;
  creditCost: number;
  maxDuration: number;
  description: string;
}

export interface VideoModelFamily {
  name: string;
  color: string;
  models: VideoModel[];
}

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "google/veo3.1-text-to-video",
    name: "Google Veo 3.1",
    family: "Google Veo",
    familyColor: "#3b82f6",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame", "reference-image", "video"],
    maxImages: 3,
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p", "4k"],
    badge: "TOP",
    creditCost: 96.0,
    maxDuration: 8,
    description: "Official Google Veo 3.1 direct video generation with image, reference, and extension support",
  },
  {
    id: "google/gemini-omni-flash",
    name: "Gemini Omni Flash",
    family: "Google Gemini",
    familyColor: "#22c55e",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame", "reference-image"],
    aspectRatios: ["16:9", "9:16"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["360p", "720p", "1080p", "4k"],
    badge: "NEW",
    creditCost: 30.0,
    maxDuration: 10,
    description: "Direct Google Gemini Omni 1.1 Flash video generation, editing, upscaling, and interpolation",
  },
  {
    id: "google/gemini-omni-1.2-flash",
    name: "Google Gemini Omni 1.2 Flash",
    family: "Google Gemini",
    familyColor: "#22c55e",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame", "reference-image", "video"],
    maxImages: 6,
    aspectRatios: ["16:9", "9:16"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["360p", "720p", "1080p", "4k"],
    badge: "NEW",
    creditCost: 30.0,
    maxDuration: 15,
    description: "Google Gemini Omni 1.2 Flash via the official Google Interactions API",
  },
  // â”€â”€ KLING â”€â”€
  {
    id: "kling-3.0/video",
    name: "Kling 3.0",
    family: "Kling",
    familyColor: "#06b6d4",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["std", "pro", "4k"],
    badge: "TOP",
    creditCost: 22.4,
    maxDuration: 15,
    description: "15s cinematic with character lock & native audio",
  },
  {
    id: "kling-3.0/motion-control",
    name: "Kling 3.0 Motion",
    family: "Kling",
    familyColor: "#06b6d4",
    inputType: "image-to-video",
    accepts: ["start-frame", "video"],
    aspectRatios: [],
    durations: [],
    resolutions: ["720p", "1080p"],
    badge: "TOP",
    creditCost: 44.7,
    maxDuration: 30,
    description: "Precise character actions & expressions up to 30s",
  },
  {
    id: "kling-v3-turbo",
    name: "Kling V3 Turbo",
    family: "Kling",
    familyColor: "#06b6d4",
    inputType: "text-to-video",
    accepts: ["start-frame"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    badge: "FAST",
    creditCost: 6.0,
    maxDuration: 15,
    description: "Kling V3 Turbo auto-routing model",
  },
  {
    id: "kling/v2-5-turbo-text-to-video-pro",
    name: "Kling 2.5 Turbo T2V",
    family: "Kling",
    familyColor: "#06b6d4",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    badge: "FAST",
    creditCost: 7.15,
    maxDuration: 10,
    description: "Fast turbo text to video generation",
  },
  {
    id: "kling/v2-5-turbo-image-to-video-pro",
    name: "Kling 2.5 Turbo I2V",
    family: "Kling",
    familyColor: "#06b6d4",
    inputType: "image-to-video",
    aspectRatios: [],
    durations: [5, 10],
    badge: "FAST",
    creditCost: 7.15,
    maxDuration: 10,
    description: "Fast turbo image to video generation",
  },

  // â”€â”€ HAILUO â”€â”€
  {
    id: "minimax-h3",
    name: "Minimax H3",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
    durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["768p", "2k"],
    badge: null,
    creditCost: 39.2,
    maxDuration: 15,
    description: "Official MiniMax H3 multimodal video generation supporting text, image, and references",
  },
  {
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "768p"],
    badge: null,
    creditCost: 14.0,
    maxDuration: 15,
    description: "Open Weights MiniMax H3 Max video generation with lower-cost 480p and native 768p tiers",
  },

  {
    id: "minimax-hailuo-02-pro",
    name: "MiniMax Hailuo 02 Pro",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "image-to-video",
    accepts: ["start-frame", "end-frame"],
    aspectRatios: [],
    durations: [6],
    resolutions: ["1080p"],
    badge: null,
    creditCost: 27.44,
    maxDuration: 6,
    description: "Flagship Hailuo 02 1080p video with start and end frame control",
  },
  {
    id: "minimax-hailuo-02-standard",
    name: "MiniMax Hailuo 02 Standard",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "image-to-video",
    accepts: ["start-frame", "end-frame"],
    aspectRatios: [],
    durations: [6, 10],
    resolutions: ["768p"],
    badge: null,
    creditCost: 12.88,
    maxDuration: 10,
    description: "Hailuo 02 Standard 768p video with start and end frame control",
  },
  {
    id: "minimax-hailuo-02-fast",
    name: "MiniMax Hailuo 02 Fast",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "image-to-video",
    accepts: ["start-frame"],
    aspectRatios: [],
    durations: [6, 10],
    resolutions: ["512p"],
    badge: null,
    creditCost: 5.6,
    maxDuration: 10,
    description: "Hailuo 02 Fast 512p video for rapid iteration",
  },
  {
    id: "minimax-hailuo-2.3-pro",
    name: "MiniMax Hailuo 2.3 Pro",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "image-to-video",
    accepts: ["start-frame"],
    aspectRatios: [],
    durations: [6],
    resolutions: ["1080p"],
    badge: null,
    creditCost: 27.44,
    maxDuration: 6,
    description: "Flagship Hailuo 2.3 cinematic 1080p video generation",
  },
  {
    id: "minimax-hailuo-2.3-fast",
    name: "MiniMax Hailuo 2.3 Fast",
    family: "Hailuo",
    familyColor: "#f59e0b",
    inputType: "image-to-video",
    accepts: ["start-frame"],
    aspectRatios: [],
    durations: [6, 10],
    resolutions: ["720p"],
    badge: null,
    creditCost: 10.64,
    maxDuration: 10,
    description: "Fast 720p image-to-video generation",
  },

  // â”€â”€ SORA â”€â”€
  {
    id: "sora-2-image-to-video",
    name: "Sora 2 I2V",
    family: "Sora",
    familyColor: "#8b5cf6",
    inputType: "image-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 8, 12],
    badge: "TOP",
    creditCost: 13.64,
    maxDuration: 12,
    description: "Cinematic image to video generation",
  },
  {
    id: "sora-2-text-to-video",
    name: "Sora 2 T2V",
    family: "Sora",
    familyColor: "#8b5cf6",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 8, 12],
    badge: "TOP",
    creditCost: 13.64,
    maxDuration: 12,
    description: "Cinematic text to video generation",
  },
  {
    id: "sora-2-pro-image-to-video",
    name: "Sora 2 Pro I2V",
    family: "Sora",
    familyColor: "#8b5cf6",
    inputType: "image-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 8, 12],
    badge: "PRO",
    creditCost: 20.48,
    maxDuration: 12,
    description: "Pro quality cinematic image to video",
  },
  {
    id: "sora-2-pro-text-to-video",
    name: "Sora 2 Pro T2V",
    family: "Sora",
    familyColor: "#8b5cf6",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 8, 12],
    badge: "PRO",
    creditCost: 20.48,
    maxDuration: 12,
    description: "Pro quality cinematic text to video",
  },

  // â”€â”€ RUNWAY â”€â”€
  {
    id: "runwayml/gen4-aleph",
    name: "Gen4 Aleph",
    family: "Runway",
    familyColor: "#3b82f6",
    inputType: "video-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [5, 10],
    badge: "NEW",
    creditCost: 7.15,
    maxDuration: 10,
    description: "Video-to-video editing & transformation",
  },
  {
    id: "runwayml/gen4-turbo",
    name: "Gen4 Turbo",
    family: "Runway",
    familyColor: "#3b82f6",
    inputType: "image-to-video",
    aspectRatios: ["16:9", "9:16"],
    durations: [5, 10],
    badge: "FAST",
    creditCost: 7.15,
    maxDuration: 10,
    description: "Fast high-quality image to video",
  },

  // â”€â”€ WAVESPEED â”€â”€
  {
    id: "wavespeed-ai/cinematic-video-generator",
    name: "Cinematic Video Generator",
    family: "WaveSpeed",
    familyColor: "#f97316",
    inputType: "text-to-video",
    accepts: ["reference-image", "multi-image"],
    maxImages: 4,
    aspectRatios: ["16:9", "9:16", "4:3", "3:4"],
    durations: [5, 10, 15],
    badge: "NEW",
    creditCost: 8,
    maxDuration: 15,
    description: "Hollywood-style T2V or I2V with up to 4 reference images",
  },

  // â”€â”€ GROK â”€â”€
  {
    id: "grok-imagine/text-to-video",
    name: "Grok Imagine T2V",
    family: "Grok",
    familyColor: "#f43f5e",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16", "1:1", "2:3", "3:2"],
    durations: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    resolutions: ["480p", "720p"],
    grokMode: true,
    badge: "NEW",
    creditCost: 9.24,
    maxDuration: 30,
    description: "Cinematic video with synced voice & emotion",
  },
  {
    id: "grok-imagine/image-to-video",
    name: "Grok Imagine I2V",
    family: "Grok",
    familyColor: "#f43f5e",
    inputType: "image-to-video",
    aspectRatios: ["16:9", "9:16", "1:1", "2:3", "3:2"],
    durations: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    resolutions: ["480p", "720p"],
    grokMode: true,
    badge: "NEW",
    creditCost: 9.24,
    maxDuration: 30,
    description: "Image to video with intelligent camera work",
  },

  // â”€â”€ BYTEDANCE â”€â”€
  {
    id: "bytedance/seedance-1.5-pro",
    name: "Seedance 1.5 Pro",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    badge: null,
    creditCost: 25,
    maxDuration: 10,
    description: "Dance and motion specialized generation",
  },
  {
    id: "bytedance/seedance-2",
    name: "Seedance 2",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame", "multi-image"],
    maxImages: 9,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p"],
    badge: "TOP",
    creditCost: 32,
    maxDuration: 15,
    description: "Full multimodal with 12 input assets",
  },
  {
    id: "bytedance/seedance-2-fast",
    name: "Seedance 2 Fast",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "text-to-video",
    accepts: ["start-frame", "end-frame", "multi-image"],
    maxImages: 9,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p"],
    badge: "FAST",
    creditCost: 26.8,
    maxDuration: 15,
    description: "Fast multimodal generation",
  },
  {
    id: "bytedance/v1-pro-fast-image-to-video",
    name: "ByteDance V1 Pro Fast I2V",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "image-to-video",
    aspectRatios: [],
    durations: [5],
    badge: "FAST",
    creditCost: 25,
    maxDuration: 5,
    description: "Ultra-fast image to video",
  },
  {
    id: "bytedance/v1-pro-image-to-video",
    name: "ByteDance V1 Pro I2V",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "image-to-video",
    aspectRatios: [],
    durations: [5, 10],
    badge: null,
    creditCost: 25,
    maxDuration: 10,
    description: "Pro quality image to video",
  },
  {
    id: "bytedance/v1-pro-text-to-video",
    name: "ByteDance V1 Pro T2V",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    badge: null,
    creditCost: 25,
    maxDuration: 10,
    description: "Pro quality text to video",
  },
  {
    id: "bytedance/v1-lite-image-to-video",
    name: "ByteDance V1 Lite I2V",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "image-to-video",
    aspectRatios: [],
    durations: [5],
    badge: "FAST",
    creditCost: 25,
    maxDuration: 5,
    description: "Lite fast image to video",
  },
  {
    id: "bytedance/v1-lite-text-to-video",
    name: "ByteDance V1 Lite T2V",
    family: "ByteDance",
    familyColor: "#22d3ee",
    inputType: "text-to-video",
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5],
    badge: "FAST",
    creditCost: 25,
    maxDuration: 5,
    description: "Lite fast text to video",
  },
];

export function getAllModels(): VideoModel[] {
  return VIDEO_MODELS;
}

export function getModelById(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export function getModelFamilies(): VideoModelFamily[] {
  const familyMap = new Map<string, VideoModelFamily>();
  for (const model of VIDEO_MODELS) {
    if (!familyMap.has(model.family)) {
      familyMap.set(model.family, {
        name: model.family,
        color: model.familyColor,
        models: [],
      });
    }
    familyMap.get(model.family)!.models.push(model);
  }
  return Array.from(familyMap.values());
}

export function getDefaultModel(): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === "google/gemini-omni-flash")!;
}

export function getModelsByFamily(family: string): VideoModel[] {
  return VIDEO_MODELS.filter((m) => m.family === family);
}

export function getModelsByInputType(type: ModelInputType): VideoModel[] {
  return VIDEO_MODELS.filter((m) => m.inputType === type);
}
