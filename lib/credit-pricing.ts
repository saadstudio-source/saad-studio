import { IMAGE_MODELS, getImageCreditCost } from "@/lib/image-models";
import { VIDEO_MODELS } from "@/lib/video-models";
import { VIDEO_MODEL_REGISTRY, isGoogleVideoRoute, normalizeGoogleVideoOptions } from "@/lib/video-model-registry";
import { getGenerationCost, getGenerationCostSync, calculateTtsCredits, calculateMusicCredits, calculateSfxCredits } from "@/lib/pricing";

type VideoPayload = Record<string, unknown>;
type ImagePricingOptions = {
  quality?: string;
  resolution?: string;
  imageSize?: string;
};

const IMAGE_MODEL_MAP = new Map(IMAGE_MODELS.map((m) => [m.id, m]));
const VIDEO_MODEL_ID_COST_MAP = new Map(VIDEO_MODELS.map((m) => [m.id, m.creditCost]));
const VIDEO_MODEL_BY_ID_MAP = new Map(VIDEO_MODELS.map((m) => [m.id, m]));
const VIDEO_ROUTE_REGISTRY_MAP = new Map(VIDEO_MODEL_REGISTRY.map((m) => [m.api_route, m]));
const SEEDANCE_25_CREDITS_PER_USD = 40;
const SEEDANCE_25_MARGIN_MULTIPLIER = 1.4;
const SEEDANCE_25_USD_PER_SECOND = {
  "480p": 0.162,
  "720p": 0.180,
  "1080p": 0.240,
  "4k": 1.620,
} as const;
const MINIMAX_H3_CREDITS_PER_USD = 40;
const MINIMAX_H3_MARGIN_MULTIPLIER = 1.4;
const MINIMAX_H3_USD_PER_SECOND = {
  "768p": 0.10,
  "2k": 0.14,
} as const;
const MINIMAX_H3_MAX_TEXT_IMAGE_USD_PER_SECOND = {
  "480p": 0.04,
  "540p": 0.06,
  "768p": 0.08,
  "1080p": 0.16,
} as const;
const MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND = {
  "480p": 0.05,
  "540p": 0.075,
  "768p": 0.10,
  "1080p": 0.20,
} as const;
const WAN_30_CREDITS_PER_USD = 40;
const WAN_30_MARGIN_MULTIPLIER = 1.4;
const WAN_30_USD_PER_SECOND = {
  "480p": 0.05,
  "720p": 0.10,
  "1080p": 0.20,
} as const;
// Wan 3.0 bills reference-to-video and image-to-video at the same rate, so both
// aliases point at one table rather than drifting apart again.
const WAN_30_TEXT_REFERENCE_USD_PER_SECOND = WAN_30_USD_PER_SECOND;
const WAN_30_IMAGE_USD_PER_SECOND = WAN_30_USD_PER_SECOND;
const FLUX_3_CREDITS_PER_USD = 40;
const FLUX_3_MARGIN_MULTIPLIER = 1.4;
const FLUX_3_USD_PER_SECOND = {
  "720p": 0.17,
  "1080p": 0.29,
  "draft": 0.06,
} as const;
const SEEDANCE_20_MINI_CREDITS_PER_USD = 40;
const SEEDANCE_20_MINI_MARGIN_MULTIPLIER = 1.4;
const SEEDANCE_20_MINI_I2V_USD_PER_SECOND = {
  "480p": 0.06,
  "720p": 0.12,
  "1080p": 0.30,
  "4k": 0.60,
} as const;
const SEEDANCE_20_MINI_T2V_USD_PER_SECOND = {
  "480p": 0.0375,
  "720p": 0.075,
  "1080p": 0.1875,
  "4k": 0.375,
} as const;
const SEEDANCE_20_MINI_TURBO_USD_PER_SECOND = {
  "720p": 0.08,
  "1080p": 0.10,
} as const;

const VIDEO_ROUTE_COST_MAP = new Map<string, number>([
  ["black-forest-labs/flux-3/text-to-video", 47.6],
  ["black-forest-labs/flux-3/image-to-video", 47.6],
  ["black-forest-labs/flux-3/start-end-to-video", 47.6],
  ["black-forest-labs/flux-3/video-extend", 16.8],
  ["black-forest-labs/flux-3/text-to-video-draft", 16.8],
  ["black-forest-labs/flux-3/image-to-video-draft", 16.8],
  ["black-forest-labs/flux-3/start-end-to-video-draft", 16.8],
  ["black-forest-labs/flux-3/video-extend-draft", 16.8],
  ["minimax/h3/text-to-video", 39.2],
  ["minimax/h3/image-to-video", 39.2],
  ["minimax/h3/reference-to-video", 39.2],
  ["wavespeed-ai/minimax-h3/text-to-video", 11.2],
  ["wavespeed-ai/minimax-h3/image-to-video", 11.2],
  ["wavespeed-ai/minimax-h3/reference-to-video", 14.0],
  ["kwaivgi/kling-v3.0-std/text-to-video", 22.35],
  ["kwaivgi/kling-v3.0-std/image-to-video", 22.35],
  ["kwaivgi/kling-v3.0-pro/image-to-video", 29.8],
  ["kwaivgi/kling-v3.0-pro/text-to-video", 29.8],
  ["kwaivgi/kling-v3.0-pro/motion-control", 44.7],
  ["kwaivgi/kling-v3.0-std/motion-control", 33.5],
  ["kling/v2-5-turbo-text-to-video-pro", 7.15],
  ["kling/v2-5-turbo-image-to-video-pro", 7.15],
  ["kling/v3-turbo-text-to-video", 5.96],
  ["kling/v3-turbo-image-to-video", 5.96],
  ["kling/v3-turbo", 5.96],
  ["kwaivgi/kling-v3-turbo-std/image-to-video", 5.96],
  ["kwaivgi/kling-v3-turbo-pro/image-to-video", 7.45],
  ["kwaivgi/kling-v3-turbo-std/text-to-video", 5.96],
  ["kwaivgi/kling-v3-turbo-pro/text-to-video", 7.45],
  ["kwaivgi/kling-video-o3-std/text-to-video", 22.35],
  ["kwaivgi/kling-video-o3-std/image-to-video", 22.35],
  ["kwaivgi/kling-video-o3-std/reference-to-video", 26.8],
  ["kwaivgi/kling-video-o3-pro/text-to-video", 29.8],
  ["kwaivgi/kling-video-o3-pro/image-to-video", 29.8],
  ["kwaivgi/kling-video-o3-pro/reference-to-video", 35.75],
  ["kwaivgi/kling-video-o3-4k/text-to-video", 111.75],
  ["kwaivgi/kling-video-o3-4k/image-to-video", 111.75],
  ["kwaivgi/kling-video-o3-4k/reference-to-video", 134.1],
  ["kling-3.0/video", 22.35],
  ["kling-3.0/motion-control", 44.7],
  ["kwaivgi/kling-v2.6-std/text-to-video", 5.0],
  ["kwaivgi/kling-v2.6-std/image-to-video", 5.0],
  ["kwaivgi/kling-v2.6-pro/text-to-video", 7.0],
  ["minimax-h3", 39.2],
  ["minimax-h3-max", 14.0],
  ["minimax-hailuo-02-pro", 27.44],
  ["minimax-hailuo-02-standard", 12.88],
  ["minimax-hailuo-02-fast", 5.6],
  ["minimax-hailuo-2.3-pro", 27.44],
  ["minimax-hailuo-2.3-fast", 10.64],
  // Legacy aliases
  ["minimax-hailuo-02", 27.44],
  ["minimax-hailuo-2.3", 27.44],
  ["minimax/hailuo-02/pro", 27.44],
  ["minimax/hailuo-02/i2v-pro", 27.44],
  ["minimax/hailuo-02/t2v-pro", 26.88],
  ["minimax/hailuo-02/standard", 12.88],
  ["minimax/hailuo-02/i2v-standard", 12.88],
  ["minimax/hailuo-02/t2v-standard", 12.88],
  ["minimax/hailuo-02/fast", 5.6],
  ["minimax/hailuo-2.3/t2v-pro", 27.44],
  ["minimax/hailuo-2.3/i2v-pro", 27.44],
  ["minimax/hailuo-2.3/fast", 10.64],
  ["minimax/hailuo-2.3/fast-pro", 18.48],
  ["openai/sora-2/text-to-video", 13.64],
  ["openai/sora-2/text-to-video-pro", 20.48],
  ["openai/sora-2-pro/text-to-video", 20.48],
  ["openai/sora-2-pro/text-to-video-pro", 20.48],
  ["google/veo3.1-lite-text-to-video", 12.0],
  ["google/veo3.1-fast-text-to-video", 24.0],
  ["google/veo3.1-text-to-video", 96.0],
  ["google/veo-3.1-generate-preview", 96.0],
  ["google/veo3-fast-text-to-video", 24.0],
  ["google/veo3-text-to-video", 96.0],
  ["google/gemini-omni-video", 30.0],
  ["google/gemini-omni-flash", 30.0],
  ["google/gemini-omni-1.2-flash", 30.0],
  ["bytedance/seedance-2.0/text-to-video", 40],
  ["bytedance/seedance-2.0/image-to-video", 40],
  ["bytedance/seedance-2.0/text-to-video-turbo", 27],
  ["bytedance/seedance-2.0/image-to-video-turbo", 27],
  ["bytedance/seedance-2.5/text-to-video-turbo", 40],
  ["bytedance/seedance-2.5/image-to-video-turbo", 40],
  ["bytedance/seedance-2.5/image-to-video-spicy", 64.8],
  ["bytedance/seedance-v2/text-to-video-fast", 27],
  ["bytedance/seedance-v2/text-to-video", 40],
  ["x-ai/grok-imagine-video/text-to-video", 9.24],
  ["x-ai/grok-imagine-video/edit-video", 9.24],
  ["wavespeed-ai/cinematic-video-generator", 8],
]);

const MUSIC_MODEL_BASE_COST = new Map<string, number>([
  ["wavespeed-ai/ace-step-1.5", 10],
  ["wavespeed-ai/song-generation", 14],
  ["wavespeed-ai/ace-step", 9],
  ["wavespeed-ai/heartmula-generate-music", 9],
  ["minimax/music-2.5", 12],
  ["minimax/music-02", 10],
  ["minimax/music-v1.5", 8],
  ["elevenlabs/elevenlabs-music", 12],
  ["google/lyria-3-pro/music", 15],
  ["google/lyria-3-clip/music", 10],
]);

const THREE_D_COST_MAP = new Map<string, number>([
  ["tripo3d-2.5.image", 3.9],
  ["tripo3d-2.5.multiview", 3.9],
  ["hunyuan3d-3.1.text", 3],
  ["hunyuan3d-3.1.image", 4],
  ["hunyuan3d-3.text", 38],
  ["hunyuan3d-3.image", 38],
  ["hunyuan3d-3.sketch", 40],
  ["meshy-6.text", 7.8],
  ["meshy-6.image", 7.8],
  ["hyper3d-rodin-2.text", 40],
  ["hyper3d-rodin-2.image", 40],
]);

function shouldApplySound(modelRef: string): boolean {
  const ref = modelRef.toLowerCase();
  if (ref.includes("gemini-omni")) {
    return false;
  }
  if (ref.includes("seedance") || ref.includes("dreamina") || ref.includes("minimax/h3") || ref.includes("wavespeed-ai/minimax-h3") || ref.includes("minimax_h3")) {
    return false;
  }
  return true;
}

export function getImageCredits(modelId: string, numImages = 1, options?: ImagePricingOptions): number {
  const count = Number.isFinite(numImages) ? Math.max(1, Math.floor(numImages)) : 1;
  const dbCost = getGenerationCostSync(modelId, 0, count, options?.quality ?? options?.resolution ?? options?.imageSize);
  if (dbCost > 0) return dbCost;
  const model = IMAGE_MODEL_MAP.get(modelId);
  if (!model) return 0;
  return getImageCreditCost(model, count, options?.quality ?? options?.resolution ?? options?.imageSize);
}

function readDuration(payload?: VideoPayload, fallback = 5): number {
  const raw = payload?.duration;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(parsed)) return Math.max(1, parsed);
  }
  return fallback;
}

function readQuality(payload?: VideoPayload): string {
  const candidates = [payload?.quality, payload?.resolution, payload?.mode];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim().toLowerCase();
  }
  return "std";
}

function hasSoundEnabled(payload?: VideoPayload): boolean {
  return payload?.sound === true || payload?.generate_audio === true;
}

function applySoundMultiplier(baseCost: number, payload?: VideoPayload): number {
  return hasSoundEnabled(payload) ? parseFloat((baseCost * 1.5).toFixed(2)) : baseCost;
}

function getMinimaxH3RateKey(quality?: string): keyof typeof MINIMAX_H3_USD_PER_SECOND {
  const q = (quality || "2k").toLowerCase();
  if (q.includes("2k") || q.includes("2 k") || q.includes("2K".toLowerCase())) return "2k";
  return "768p";
}

function getMinimaxH3MaxRateKey(quality?: string): keyof typeof MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND {
  const q = (quality || "480p").toLowerCase();
  // Most specific label first: 1080p previously fell through to the 480p rate
  // and was billed at a quarter of its true cost.
  if (q.includes("1080")) return "1080p";
  if (q.includes("768")) return "768p";
  if (q.includes("540")) return "540p";
  return "480p";
}

function readReferenceVideoDurationSeconds(payload?: VideoPayload, minPerClipSeconds = 0): number {
  const rawDurations = payload?.reference_video_durations ?? payload?.referenceVideoDurations;
  if (!Array.isArray(rawDurations)) return 0;
  const total = rawDurations.reduce((sum, value) => {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : 0;
    return Number.isFinite(n) && n > 0 ? sum + Math.max(minPerClipSeconds, n) : sum;
  }, 0);
  if (total <= 0) return 0;
  return Math.min(15, Math.ceil(total));
}

function countStringList(value: unknown): number {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0).length : 0;
}

function getMinimaxH3Credits(payload?: VideoPayload, rateOverride?: number, modelRoute?: string): number {
  const isH3Max = modelRoute?.startsWith("wavespeed-ai/minimax-h3") === true || modelRoute === "minimax-h3-max";
  const isReferenceRoute = modelRoute?.includes("reference-to-video") === true;
  const referenceVideoDuration = isReferenceRoute ? readReferenceVideoDurationSeconds(payload, 2) : 0;

  if (isH3Max) {
    const outputDuration = Math.max(3, readDuration(payload, 5));
    const rateKey = getMinimaxH3MaxRateKey(readQuality(payload));
    const rateTable = isReferenceRoute ? MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND : MINIMAX_H3_MAX_TEXT_IMAGE_USD_PER_SECOND;
    const usdPerSec = rateOverride !== undefined ? rateOverride : rateTable[rateKey];
    const refImageCount = isReferenceRoute ? countStringList(payload?.reference_images ?? payload?.reference_image_urls ?? payload?.referenceImageUrls) : 0;
    const refAudioCount = isReferenceRoute ? countStringList(payload?.reference_audios ?? payload?.reference_audio_urls ?? payload?.referenceAudioUrls) : 0;
    const referenceAssetUsd = (refImageCount + refAudioCount) * 0.02;
    const providerUsd = (outputDuration + referenceVideoDuration) * usdPerSec + referenceAssetUsd;
    return parseFloat(Math.max(1, providerUsd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD).toFixed(2));
  }

  const outputDuration = Math.max(5, readDuration(payload, 5));
  const rateKey = getMinimaxH3RateKey(readQuality(payload));
  const usdPerSec = rateOverride !== undefined ? rateOverride : MINIMAX_H3_USD_PER_SECOND[rateKey];
  const billableDuration = outputDuration + referenceVideoDuration;
  return parseFloat(Math.max(1, billableDuration * usdPerSec * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD).toFixed(2));
}

function getHailuoCredits(modelRoute: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 6);
  if (modelRoute === "minimax-hailuo-02") {
    const q = readQuality(payload);
    if (q === "512p") return duration >= 10 ? 8.40 : 5.60;
    if (duration >= 10 || q === "768p") return duration >= 10 ? 31.36 : 12.88;
    return 27.44;
  }
  if (
    modelRoute === "minimax-hailuo-02-pro" ||
    modelRoute === "minimax/hailuo-02/pro" ||
    modelRoute === "minimax/hailuo-02/i2v-pro" ||
    modelRoute === "minimax/hailuo-02/t2v-pro"
  ) {
    if (modelRoute.includes("t2v") || modelRoute.endsWith("/t2v-pro")) return 26.88;
    return 27.44;
  }
  if (
    modelRoute === "minimax-hailuo-02-standard" ||
    modelRoute === "minimax/hailuo-02/standard" ||
    modelRoute === "minimax/hailuo-02/i2v-standard" ||
    modelRoute === "minimax/hailuo-02/t2v-standard"
  ) {
    return duration >= 10 ? 31.36 : 12.88;
  }
  if (modelRoute === "minimax-hailuo-02-fast" || modelRoute === "minimax/hailuo-02/fast") {
    return duration >= 10 ? 8.40 : 5.60;
  }
  if (
    modelRoute === "minimax-hailuo-2.3-pro" ||
    modelRoute === "minimax/hailuo-2.3/t2v-pro" ||
    modelRoute === "minimax/hailuo-2.3/i2v-pro" ||
    modelRoute === "minimax-hailuo-2.3"
  ) {
    return 27.44;
  }
  if (modelRoute === "minimax/hailuo-2.3/i2v-standard" || modelRoute === "minimax/hailuo-2.3/t2v-standard") {
    return duration >= 10 ? 31.36 : 15.68;
  }
  if (modelRoute === "minimax-hailuo-2.3-fast" || modelRoute === "minimax/hailuo-2.3/fast") {
    return duration >= 10 ? 17.92 : 10.64;
  }
  if (modelRoute === "minimax/hailuo-2.3/fast-pro") {
    return 18.48;
  }
  const isPro = modelRoute.includes("pro");
  return parseFloat(Math.max(1, duration * (isPro ? 4.48 : 2.15)).toFixed(2));
}

function getKling3Credits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const is4k = quality === "4k";
  const isPro = quality === "pro" || quality.includes("1080");

  if (is4k) {
    return parseFloat((duration * 22.344).toFixed(2));
  }

  if (isPro) {
    return parseFloat((duration * 5.96).toFixed(2));
  }

  return parseFloat((duration * 4.47).toFixed(2));
}

function getKling30StdCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  return parseFloat((duration * 4.47).toFixed(2));
}

function getKlingMotionCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const isStd = quality === "std" || quality.includes("720");
  const perSec = isStd ? 6.70 : 8.94;
  return parseFloat((duration * perSec).toFixed(2));
}

// Kling Omni Edit credit helper removed — endpoint not provided by KIE.

function getSeedance2Credits(payload?: VideoPayload, variant: "hq" | "fast" = "hq"): number {
  const duration = readDuration(payload, 4);
  const quality = readQuality(payload);

  if (variant === "fast") {
    let cost = duration * 6.0;
    if (quality.includes("480")) {
      cost *= 0.5;
    }
    return parseFloat(Math.max(1, cost).toFixed(2));
  }

  // HQ variant
  let cost = duration * 4.5333;
  let qMul = 1.0;
  if (quality.includes("480")) {
    qMul = 0.661765;
  } else if (quality.includes("1080")) {
    qMul = 1.985294;
  } else if (quality.includes("4k")) {
    qMul = 4.852941;
  }
  cost *= qMul;

  return parseFloat(Math.max(1, cost).toFixed(2));
}


function hasNonEmptyArray(payload: VideoPayload | undefined, keys: string[]): boolean {
  return keys.some((key) => {
    const value = payload?.[key];
    return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
  });
}

function getSeedance25TurboCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const q: keyof typeof SEEDANCE_25_USD_PER_SECOND = quality.includes("4k") ? "4k" : quality.includes("1080") ? "1080p" : quality.includes("480") ? "480p" : "720p";
  const usdPerSecond = SEEDANCE_25_USD_PER_SECOND[q] ?? SEEDANCE_25_USD_PER_SECOND["720p"];
  return parseFloat(Math.max(1, usdPerSecond * duration * SEEDANCE_25_MARGIN_MULTIPLIER * SEEDANCE_25_CREDITS_PER_USD).toFixed(2));
}

function getSeedance25SpicyCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const q: keyof typeof SEEDANCE_25_USD_PER_SECOND = quality.includes("4k") ? "4k" : quality.includes("1080") ? "1080p" : quality.includes("480") ? "480p" : "720p";
  const usdPerSecond = SEEDANCE_25_USD_PER_SECOND[q] ?? SEEDANCE_25_USD_PER_SECOND["720p"];
  return parseFloat(Math.max(1, usdPerSecond * duration * SEEDANCE_25_MARGIN_MULTIPLIER * SEEDANCE_25_CREDITS_PER_USD).toFixed(2));
}

function getSeedance20MiniCredits(modelRoute: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const route = (modelRoute || "").toLowerCase();
  const isTurbo = route.includes("turbo");
  const isI2V = route.includes("image-to-video") || route.includes("video-extend") || route.includes("spicy");

  if (isTurbo) {
    if (quality.includes("480") || quality.includes("4k")) {
      throw new Error("Seedance 2.0 Mini Turbo only supports 720p or 1080p resolution.");
    }
    const q = quality.includes("1080") ? "1080p" : "720p";
    const usdPerSecond = SEEDANCE_20_MINI_TURBO_USD_PER_SECOND[q];
    return parseFloat((usdPerSecond * duration * SEEDANCE_20_MINI_MARGIN_MULTIPLIER * SEEDANCE_20_MINI_CREDITS_PER_USD).toFixed(2));
  }

  const q: "480p" | "720p" | "1080p" | "4k" = quality.includes("4k")
    ? "4k"
    : quality.includes("1080")
    ? "1080p"
    : quality.includes("480")
    ? "480p"
    : "720p";
  const rateTable = isI2V ? SEEDANCE_20_MINI_I2V_USD_PER_SECOND : SEEDANCE_20_MINI_T2V_USD_PER_SECOND;
  const usdPerSecond = rateTable[q] ?? rateTable["720p"];
  return parseFloat((usdPerSecond * duration * SEEDANCE_20_MINI_MARGIN_MULTIPLIER * SEEDANCE_20_MINI_CREDITS_PER_USD).toFixed(2));
}

function getWan30Credits(modelRoute: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const q: keyof typeof WAN_30_TEXT_REFERENCE_USD_PER_SECOND = quality.includes("1080") ? "1080p" : quality.includes("480") ? "480p" : "720p";
  const rateTable = modelRoute.includes("/image-to-video")
    ? WAN_30_IMAGE_USD_PER_SECOND
    : WAN_30_TEXT_REFERENCE_USD_PER_SECOND;
  const usdPerSecond = rateTable[q] ?? rateTable["720p"];
  return parseFloat(Math.max(1, usdPerSecond * duration * WAN_30_MARGIN_MULTIPLIER * WAN_30_CREDITS_PER_USD).toFixed(2));
}

function getFlux3Credits(modelRoute: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const isDraft = modelRoute.includes("draft") || modelRoute.includes("extend");
  const usdPerSecond = isDraft
    ? FLUX_3_USD_PER_SECOND["draft"]
    : quality.includes("1080")
    ? FLUX_3_USD_PER_SECOND["1080p"]
    : FLUX_3_USD_PER_SECOND["720p"];
  return parseFloat(Math.max(1, usdPerSecond * duration * FLUX_3_MARGIN_MULTIPLIER * FLUX_3_CREDITS_PER_USD).toFixed(2));
}
function getSora2Credits(modelRoute: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 4);
  const isPro = modelRoute.includes("text-to-video-pro") || modelRoute.includes("sora-2-pro");
  return parseFloat(Math.max(1, duration * (isPro ? 5.12 : 3.41)).toFixed(2));
}



function getGrokCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 6);
  const quality = readQuality(payload);
  const qualityMultiplier = quality.includes("480") ? 0.8 : 1;
  return parseFloat(Math.max(1, duration * 1.54 * qualityMultiplier).toFixed(2));
}

function getVeo31Credits(modelRoute: string, payload?: VideoPayload): number {
  if (!isGoogleVideoRoute(modelRoute)) return 0;

  const referenceCount = Array.isArray(payload?.reference_image_urls)
    ? payload.reference_image_urls.length
    : Array.isArray(payload?.referenceImageUrls)
      ? payload.referenceImageUrls.length
      : 0;
  const normalized = normalizeGoogleVideoOptions(modelRoute, {
    duration: payload?.duration as number | string | undefined,
    resolution: readQuality(payload),
    aspectRatio: typeof payload?.aspect_ratio === "string" ? payload.aspect_ratio : typeof payload?.aspectRatio === "string" ? payload.aspectRatio : undefined,
    referenceImageCount: referenceCount,
    hasVideoInput: Boolean(payload?.video_url || payload?.videoUrl || payload?.video),
    hasStartImage: Boolean(payload?.image_url || payload?.imageUrl || payload?.image || payload?.first_frame_url),
    hasEndImage: Boolean(payload?.last_frame_url || payload?.lastFrameUrl || payload?.last_image || payload?.end_image),
  });

  let usdPerSecond = 0.40;
  if (normalized.tier === "veo31_lite") {
    usdPerSecond = normalized.resolution === "1080p" ? 0.08 : 0.05;
  } else if (normalized.tier === "veo31_fast" || normalized.tier === "veo3_fast") {
    usdPerSecond = normalized.resolution === "4k" ? 0.30 : normalized.resolution === "1080p" ? 0.12 : 0.10;
  } else if (normalized.tier === "veo31") {
    usdPerSecond = normalized.resolution === "4k" ? 0.60 : 0.40;
  }

  return parseFloat(Math.max(1, usdPerSecond * normalized.duration * 28).toFixed(2));
}

function getGeminiOmniFlashCredits(payload?: VideoPayload): number {
  const duration = readDuration(payload, 10);
  const quality = readQuality(payload);
  const perSecond = quality.includes("360")
    ? 1
    : quality.includes("1080")
    ? 4.5
    : quality.includes("4k")
    ? 9
    : 3;
  return parseFloat(Math.max(1, duration * perSecond).toFixed(2));
}

function applyGenericRouteDynamics(modelRoute: string, baseCost: number, payload?: VideoPayload): number {
  const model = VIDEO_ROUTE_REGISTRY_MAP.get(modelRoute);
  if (!model) return applySoundMultiplier(baseCost, payload);

  let cost = baseCost;
  const caps = model.capabilities;

  if (caps.durations.length > 0) {
    const baseDuration = caps.durations[0];
    const duration = readDuration(payload, baseDuration);
    cost = (cost * duration) / baseDuration;
  }

  if (caps.resolutions.length > 1) {
    const quality = readQuality(payload);
    const tiers = caps.resolutions.map((r) => r.toLowerCase());
    const matchedIndex = tiers.findIndex((t) => quality === t || quality.includes(t));
    const tierIndex = matchedIndex >= 0 ? matchedIndex : 0;
    if (tierIndex > 0) cost *= 1 + tierIndex * 0.35;
  }

  return applySoundMultiplier(Math.max(1, Math.ceil(cost)), payload);
}

export function getVideoCreditsByModelId(modelId: string, payload?: VideoPayload): number {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const dbCost = getGenerationCostSync(modelId, duration, 1, quality);
  if (dbCost > 0) {
    return shouldApplySound(modelId) ? applySoundMultiplier(dbCost, payload) : dbCost;
  }

  return getVideoCreditsByModelIdFallback(modelId, payload);
}

export async function getVideoCreditsByModelIdAsync(modelId: string, payload?: VideoPayload): Promise<number> {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const dbCost = await getGenerationCost(modelId, duration, 1, quality).catch(() => 0);
  if (dbCost > 0) {
    return shouldApplySound(modelId) ? applySoundMultiplier(dbCost, payload) : dbCost;
  }

  return getVideoCreditsByModelIdFallback(modelId, payload);
}

function getVideoCreditsByModelIdFallback(modelId: string, payload?: VideoPayload): number {
  if (modelId === "kling-v3-turbo") {
    const duration = readDuration(payload, 5);
    return applySoundMultiplier(parseFloat((duration * (5 / 3)).toFixed(2)), payload);
  }
  if (modelId === "kling-3.0/video") return applySoundMultiplier(getKling3Credits(payload), payload);
  if (modelId === "kling-3.0/motion-control") return applySoundMultiplier(getKlingMotionCredits(payload), payload);
  if (modelId === "bytedance/seedance-2") return getSeedance2Credits(payload, "hq");
  if (modelId === "bytedance/seedance-2-fast") return getSeedance2Credits(payload, "fast");
  if (modelId === "bytedance/seedance-2.5/text-to-video-turbo" || modelId === "bytedance/seedance-2.5/image-to-video-turbo") return getSeedance25TurboCredits(payload);
  if (modelId === "bytedance/seedance-2.5/image-to-video-spicy") return getSeedance25SpicyCredits(payload);
  if (
    modelId === "bytedance-seedance-v2-t2v-mini" ||
    modelId === "bytedance-seedance-v2-mini-turbo" ||
    modelId === "bytedance-seedance-v2-mini-spicy" ||
    modelId.startsWith("bytedance/seedance-2.0-mini")
  ) {
    return getSeedance20MiniCredits(modelId, payload);
  }
  if (modelId === "google/gemini-omni-flash" || modelId === "google/gemini-omni-1.2-flash" || modelId === "google/gemini-omni-video") {
    return applySoundMultiplier(getGeminiOmniFlashCredits(payload), payload);
  }
  if (modelId === "minimax-h3") return getMinimaxH3Credits(payload, undefined, "minimax-h3");
  if (modelId === "minimax-h3-max") return getMinimaxH3Credits(payload, undefined, "minimax-h3-max");
  if (
    modelId === "minimax-hailuo-02-pro" ||
    modelId === "minimax-hailuo-02-standard" ||
    modelId === "minimax-hailuo-02-fast" ||
    modelId === "minimax-hailuo-2.3-pro" ||
    modelId === "minimax-hailuo-2.3-fast" ||
    modelId === "minimax-hailuo-02" ||
    modelId === "minimax-hailuo-2.3"
  ) {
    return applySoundMultiplier(getHailuoCredits(modelId, payload), payload);
  }

  const base = VIDEO_MODEL_ID_COST_MAP.get(modelId) ?? 0;
  if (!base) return 0;

  const model = VIDEO_MODEL_BY_ID_MAP.get(modelId);
  const baseDuration = model?.durations?.[0];
  if (baseDuration && Number.isFinite(baseDuration)) {
    const duration = readDuration(payload, baseDuration);
    let cost = Math.max(1, Math.ceil((base * duration) / baseDuration));

    if (model?.resolutions && model.resolutions.length > 1) {
      const quality = readQuality(payload);
      const tiers = model.resolutions.map((r) => r.toLowerCase());
      const matchedIndex = tiers.findIndex((t) => quality === t || quality.includes(t));
      const tierIndex = matchedIndex >= 0 ? matchedIndex : 0;
      if (tierIndex > 0) cost = Math.max(1, Math.ceil(cost * (1 + tierIndex * 0.35)));
    }

    return applySoundMultiplier(cost, payload);
  }

  return applySoundMultiplier(base, payload);
}

const SEEDANCE_20_REFERENCE_VIDEO_USD_PER_SECOND = {
  standard: { "480p": 0.075, "720p": 0.15, "1080p": 0.375, "4k": 0.75 },
  fast:     { "480p": 0.065, "720p": 0.13, "1080p": 0.325, "4k": 0.65 },
} as const;

/**
 * Seedance 2.0 / 2.0 Fast with reference videos attached. The provider bills one
 * reduced per-second rate across the normalised reference duration plus the
 * output duration, instead of the output-only schedule. Returns null when the
 * route or payload does not match so the caller falls through unchanged.
 */
function getSeedance20ReferenceVideoCredits(modelRoute: string, payload?: VideoPayload): number | null {
  const route = (modelRoute || "").toLowerCase();
  const isFast = route.startsWith("bytedance/seedance-2.0-fast/");
  const isStandard = route.startsWith("bytedance/seedance-2.0/") && !route.includes("-turbo");
  if (!isFast && !isStandard) return null;

  const referenceSeconds = readReferenceVideoDurationSeconds(payload, 2);
  if (referenceSeconds <= 0) return null;

  const quality = readQuality(payload);
  const q: keyof typeof SEEDANCE_20_REFERENCE_VIDEO_USD_PER_SECOND["standard"] =
    quality.includes("4k") ? "4k" : quality.includes("1080") ? "1080p" : quality.includes("480") ? "480p" : "720p";
  const usdPerSecond = SEEDANCE_20_REFERENCE_VIDEO_USD_PER_SECOND[isFast ? "fast" : "standard"][q];
  const billedSeconds = referenceSeconds + Math.max(1, readDuration(payload, 5));
  return parseFloat(Math.max(1, usdPerSecond * billedSeconds * 1.4 * 40).toFixed(2));
}

const SEEDANCE_V15_PRO_USD_PER_SECOND = {
  "480p": 0.012,
  "720p": 0.026,
} as const;

/**
 * Seedance V1.5 Pro (and its v1-pro aliases). Cost scales linearly with
 * duration, 720p costs about 2.17x the 480p branch, and generate_audio doubles
 * the price. Returns null for routes it does not own.
 */
function getSeedanceV15ProCredits(modelRoute: string, payload?: VideoPayload): number | null {
  const route = (modelRoute || "").toLowerCase();
  const owned =
    route.startsWith("bytedance/seedance-v1.5-pro/") ||
    route === "bytedance/seedance-1.5-pro" ||
    route === "bytedance/v1-pro-image-to-video" ||
    route === "bytedance/v1-pro-text-to-video" ||
    route === "bytedance/v1-pro-fast-image-to-video";
  if (!owned) return null;

  const quality = readQuality(payload);
  const q: keyof typeof SEEDANCE_V15_PRO_USD_PER_SECOND = quality.includes("720") ? "720p" : "480p";
  const audioMultiplier = hasSoundEnabled(payload) ? 2 : 1;
  const usd = SEEDANCE_V15_PRO_USD_PER_SECOND[q] * Math.max(1, readDuration(payload, 5)) * audioMultiplier;
  return parseFloat(Math.max(1, usd * 1.4 * 40).toFixed(2));
}

export function getVideoCreditsByRoute(modelRoute: string, payload?: VideoPayload): number {
  const seedanceReferenceCredits = getSeedance20ReferenceVideoCredits(modelRoute, payload);
  if (seedanceReferenceCredits !== null) return seedanceReferenceCredits;
  const seedanceV15Credits = getSeedanceV15ProCredits(modelRoute, payload);
  if (seedanceV15Credits !== null) return seedanceV15Credits;

  if (modelRoute.startsWith("minimax/h3") || modelRoute.startsWith("wavespeed-ai/minimax-h3") || modelRoute === "minimax-h3") {
    return getMinimaxH3Credits(payload, undefined, modelRoute);
  }

  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const dbCost = getGenerationCostSync(modelRoute, duration, 1, quality);
  if (dbCost > 0) {
    return shouldApplySound(modelRoute) ? applySoundMultiplier(dbCost, payload) : dbCost;
  }

  return getVideoCreditsByRouteFallback(modelRoute, payload);
}

export async function getVideoCreditsByRouteAsync(modelRoute: string, payload?: VideoPayload): Promise<number> {
  if (modelRoute.startsWith("minimax/h3") || modelRoute.startsWith("wavespeed-ai/minimax-h3") || modelRoute === "minimax-h3") {
    return getMinimaxH3Credits(payload, undefined, modelRoute);
  }

  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const dbCost = await getGenerationCost(modelRoute, duration, 1, quality).catch(() => 0);
  if (dbCost > 0) {
    return shouldApplySound(modelRoute) ? applySoundMultiplier(dbCost, payload) : dbCost;
  }

  return getVideoCreditsByRouteFallback(modelRoute, payload);
}

function getVideoCreditsByRouteFallback(modelRoute: string, payload?: VideoPayload): number {
  if (modelRoute.startsWith("kwaivgi/kling-v4.0/")) {
    const outputDuration = Math.min(30, Math.max(3, readDuration(payload, 5)));
    const quality = readQuality(payload).toLowerCase();
    const highRate = quality === "1080p";
    const normalRate = highRate ? 0.235 : 0.157;
    const countedRate = highRate ? 0.141 : 0.094;
    // WaveSpeed source evidence: Kling V4 reference-to-video at 720p costs
    // $2.00175 for a 15s job, i.e. $0.13345/s before SaadStudio margin.
    const reference720pRate = 2.00175 / 15;
    const isEdit = modelRoute.endsWith("/video-edit");
    const hasReferenceVideos = modelRoute.endsWith("/reference-to-video") && countStringList(payload?.videos ?? payload?.reference_videos) > 0;
    if (!isEdit && !hasReferenceVideos) return parseFloat((outputDuration * normalRate * 1.4 * 40).toFixed(2));
    const sourceDuration = Math.min(30, Math.max(0, Math.ceil(Number(payload?.source_video_duration ?? payload?.video_duration ?? 0) || 0)));
    const countedSeconds = isEdit
      ? Math.min(60, outputDuration + Math.max(outputDuration, sourceDuration))
      : hasReferenceVideos
        ? Math.min(60, Math.max(outputDuration, sourceDuration))
        : outputDuration;
    const effectiveRate = hasReferenceVideos && !highRate ? reference720pRate : countedRate;
    return parseFloat((countedSeconds * effectiveRate * 1.4 * 40).toFixed(2));
  }
  if (modelRoute === "kwaivgi/kling-v2.6-std/motion-control") {
    const duration = Math.min(30, Math.max(3, readDuration(payload, 3)));
    return parseFloat((duration * 0.07 * 1.4 * 40).toFixed(2));
  }
  if (modelRoute === "wavespeed-ai/openjutsu/object-swap") {
    const duration = Math.min(15, Math.max(3, readDuration(payload, 3)));
    const quality = readQuality(payload).toLowerCase();
    const rate = quality === "1080p" ? 0.40 : quality === "768p" ? 0.20 : quality === "540p" ? 0.17 : 0.15;
    const referenceFee = typeof payload?.image === "string" && payload.image.trim() ? 0.02 : 0;
    return parseFloat((duration * rate * 1.4 * 40 + referenceFee * 1.4 * 40).toFixed(2));
  }
  if (modelRoute === "wavespeed-ai/video-upscaler" || modelRoute === "wavespeed-ai/ultimate-video-upscaler") {
    const duration = Math.min(600, Math.max(3, Math.ceil(readDuration(payload, 3))));
    const quality = readQuality(payload).toLowerCase();
    const perFive = modelRoute.includes("ultimate")
      ? ({ "720p": 0.10, "1080p": 0.20, "2k": 0.30, "4k": 0.40 } as const)
      : ({ "720p": 0.025, "1080p": 0.025, "2k": 0.05, "4k": 0.10 } as const);
    const perSecond = (perFive[quality as keyof typeof perFive] ?? perFive["1080p"]) / 5;
    return parseFloat((duration * perSecond * 1.4 * 40).toFixed(2));
  }
  if (modelRoute.startsWith("minimax/h3") || modelRoute.startsWith("wavespeed-ai/minimax-h3") || modelRoute === "minimax-h3") {
    return getMinimaxH3Credits(payload, undefined, modelRoute);
  }
  if (
    modelRoute.startsWith("minimax/hailuo-") ||
    modelRoute.startsWith("minimax-hailuo-")
  ) {
    return applySoundMultiplier(getHailuoCredits(modelRoute, payload), payload);
  }
  if (
    modelRoute === "kwaivgi/kling-v3-turbo-std/image-to-video" ||
    modelRoute === "kwaivgi/kling-v3-turbo-pro/image-to-video" ||
    modelRoute === "kwaivgi/kling-v3-turbo-std/text-to-video" ||
    modelRoute === "kwaivgi/kling-v3-turbo-pro/text-to-video"
  ) {
    const duration = readDuration(payload, 5);
    const perSecond = modelRoute.includes("-pro/") ? 4.4 : 3.5;
    return parseFloat((duration * perSecond).toFixed(2));
  }
  if (modelRoute.includes("kling/v3-turbo") || modelRoute === "kling-v3-turbo") {
    const duration = readDuration(payload, 5);
    return applySoundMultiplier(parseFloat((duration * 3.5).toFixed(2)), payload);
  }
  if (modelRoute === "kwaivgi/kling-v3.0-std/text-to-video") {
    return getKling30StdCredits(payload);
  }
  if (modelRoute === "kwaivgi/kling-v3.0-std/image-to-video") {
    return getKling30StdCredits(payload);
  }
  if (modelRoute === "kwaivgi/kling-v3.0-pro/image-to-video") {
    return applySoundMultiplier(getKling3Credits(payload), payload);
  }
  if (modelRoute.startsWith("kwaivgi/kling-video-o3-") || modelRoute === "kling-video-o3") {
    const duration = readDuration(payload, 5);
    const tier = modelRoute.includes("-4k/") ? 22.344 : modelRoute.includes("-pro/") ? 5.96 : 4.47;
    const refMultiplier = modelRoute.includes("/reference-to-video") ? 1.2 : 1;
    return parseFloat((duration * tier * refMultiplier).toFixed(2));
  }
  if (modelRoute.startsWith("kwaivgi/kling-v2.6-")) {
    const duration = readDuration(payload, 5);
    const tier = modelRoute.includes("-pro/") ? 2.5 : 1.5;
    const soundMultiplier = payload?.sound === true || payload?.generate_audio === true ? 2 : 1;
    return parseFloat((duration * tier * soundMultiplier).toFixed(2));
  }
  if (modelRoute === "kwaivgi/kling-v3.0-pro/text-to-video") {
    return applySoundMultiplier(getKling3Credits(payload), payload);
  }
  // kwaivgi/kling-video-o3-pro/* routes removed — KIE has no Omni endpoint.
  if (modelRoute === "kwaivgi/kling-v3.0-pro/motion-control") {
    return applySoundMultiplier(getKlingMotionCredits(payload), payload);
  }
  if (modelRoute.startsWith("bytedance/seedance-2.5")) {
    if (modelRoute.includes("spicy")) {
      return getSeedance25SpicyCredits(payload);
    }
    return getSeedance25TurboCredits(payload);
  }
  if (
    modelRoute.startsWith("bytedance/seedance-2.0-mini") ||
    modelRoute.startsWith("bytedance/seedance-v2/text-to-video-mini") ||
    modelRoute === "bytedance/seedance-2-mini"
  ) {
    return getSeedance20MiniCredits(modelRoute, payload);
  }
  if (
    modelRoute.startsWith("bytedance/seedance-2.0-fast") ||
    modelRoute === "bytedance/seedance-v2/text-to-video-fast"
  ) {
    return getSeedance2Credits(payload, "fast");
  }
  if (
    modelRoute === "bytedance/dreamina-v3.0/text-to-video-720p" ||
    modelRoute === "bytedance/seedance-v2/text-to-video" ||
    modelRoute.startsWith("bytedance/seedance-2.0") ||
    modelRoute.includes("seedance")
  ) {
    return getSeedance2Credits(payload, "hq");
  }
  if (modelRoute.startsWith("alibaba/wan-3.0")) {
    return getWan30Credits(modelRoute, payload);
  }
  if (modelRoute.startsWith("black-forest-labs/flux-3") || modelRoute.startsWith("black-forest-labs-flux-3")) {
    return getFlux3Credits(modelRoute, payload);
  }
  if (modelRoute === "google/gemini-omni-flash" || modelRoute === "google/gemini-omni-1.2-flash" || modelRoute === "google/gemini-omni-video") {
    return getGeminiOmniFlashCredits(payload);
  }
  if (
    modelRoute === "google/veo3.1-lite-text-to-video" ||
    modelRoute === "google/veo3.1-fast-text-to-video" ||
    modelRoute === "google/veo3.1-text-to-video" ||
    modelRoute === "google/veo-3.1-generate-preview" ||
    modelRoute === "google/veo3-fast-text-to-video" ||
    modelRoute === "google/veo3-text-to-video"
  ) {
    return applySoundMultiplier(getVeo31Credits(modelRoute, payload), payload);
  }
  if (
    modelRoute === "openai/sora-2/text-to-video" ||
    modelRoute === "openai/sora-2/text-to-video-pro" ||
    modelRoute === "openai/sora-2-pro/text-to-video" ||
    modelRoute === "openai/sora-2-pro/text-to-video-pro"
  ) {
    return applySoundMultiplier(getSora2Credits(modelRoute, payload), payload);
  }

  if (modelRoute === "x-ai/grok-imagine-video/text-to-video" || modelRoute === "x-ai/grok-imagine-video/edit-video") {
    return applySoundMultiplier(getGrokCredits(payload), payload);
  }
  if (modelRoute === "wavespeed-ai/cinematic-video-generator") {
    const duration = readDuration(payload, 5);
    return applySoundMultiplier(parseFloat(Math.max(1, duration * 1.6).toFixed(2)), payload);
  }

  const base = VIDEO_ROUTE_COST_MAP.get(modelRoute) ?? 20;
  return applyGenericRouteDynamics(modelRoute, base, payload);
}

export function getMusicCredits(modelId: string, duration?: number): number {
  const safeDuration = duration && duration > 0 ? duration : 30;
  const dbCost = getGenerationCostSync(modelId, safeDuration, 1);
  if (dbCost > 0) return dbCost;

  return getMusicCreditsFallback(modelId, safeDuration);
}

export async function getMusicCreditsAsync(modelId: string, duration?: number): Promise<number> {
  const safeDuration = duration && duration > 0 ? duration : 30;
  const dbCost = await getGenerationCost(modelId, safeDuration, 1).catch(() => 0);
  if (dbCost > 0) return dbCost;

  return getMusicCreditsFallback(modelId, safeDuration);
}

export async function getHookStudioCreditsAsync(
  modelId: string,
  payload?: VideoPayload,
  options?: { legacyUserCredits?: number },
): Promise<number> {
  const duration = readDuration(payload, 5);
  const quality = readQuality(payload);
  const dbCost = await getGenerationCost(modelId, duration, 1, quality).catch(() => 0);
  if (dbCost > 0) {
    return shouldApplySound(modelId) ? applySoundMultiplier(dbCost, payload) : dbCost;
  }

  const legacyUserCredits = Number(options?.legacyUserCredits);
  if (Number.isFinite(legacyUserCredits) && legacyUserCredits > 0) {
    return legacyUserCredits;
  }

  return getVideoCreditsByModelIdFallback(modelId, payload);
}

function getMusicCreditsFallback(modelId: string, safeDuration: number): number {
  const base = MUSIC_MODEL_BASE_COST.get(modelId) ?? 10;
  const durationMultiplier = Math.max(1, Math.ceil(safeDuration / 30));
  return base * durationMultiplier;
}

export function get3DCredits(modelId: string, mode: string): number {
  const combinedKey = `${modelId}.${mode}`;
  const dbCost = getGenerationCostSync(combinedKey, 0, 1);
  if (dbCost > 0) return dbCost;

  return THREE_D_COST_MAP.get(combinedKey) ?? 0;
}

/**
 * ElevenLabs Dubbing bills $0.01 per second of source media, capped at 15
 * minutes. At 0.33 credits per second the cheapest credit a subscriber can hold
 * still clears that cost (1.21x on Max, 1.44x on Plus) — the margin Kling v3
 * Turbo settled on. The old flat 8 credits ignored duration entirely.
 */
const DUBBING_CREDITS_PER_SECOND = 0.33;
/** minimax/voice-clone bills a flat $1.60 per run; 1.60 x 1.4 x 40 = 89.6. */
const VOICE_CLONE_CREDITS = 89.6;
/** Used when the caller could not measure the media; one minute. */
const DUBBING_FALLBACK_SECONDS = 60;
const DUBBING_MAX_BILLED_SECONDS = 15 * 60;

export function getAudioActionCredits(
  actionType: "tts" | "video2audio" | "music" | "voice-changer" | "dubbing" | "lip-sync" | "voice-cloning",
  textOrPayloadOrDuration?: string | number | { text?: string; prompt?: string; duration?: number; musicDuration?: number }
): number {
  if (actionType === "voice-cloning") {
    // Flat per-run charge: cloning cost does not scale with the script length.
    const dbCost = getGenerationCostSync("audio:voice-cloning", 0, 1);
    return dbCost > 0 ? dbCost : VOICE_CLONE_CREDITS;
  }
  if (actionType === "tts") {
    const text = typeof textOrPayloadOrDuration === "string" ? textOrPayloadOrDuration : typeof textOrPayloadOrDuration === "object" ? textOrPayloadOrDuration?.text || textOrPayloadOrDuration?.prompt : "";
    if (text !== undefined) return calculateTtsCredits(text);
  }
  if (actionType === "music") {
    const dur = typeof textOrPayloadOrDuration === "number" ? textOrPayloadOrDuration : typeof textOrPayloadOrDuration === "object" ? textOrPayloadOrDuration?.duration || textOrPayloadOrDuration?.musicDuration : 30;
    return calculateMusicCredits(dur);
  }
  if (actionType === "video2audio") {
    const dur = typeof textOrPayloadOrDuration === "number" ? textOrPayloadOrDuration : typeof textOrPayloadOrDuration === "object" ? textOrPayloadOrDuration?.duration : 5;
    return calculateSfxCredits(dur);
  }
  const dbCost = getGenerationCostSync(`audio:${actionType}`, 0, 1);
  if (dbCost > 0) return dbCost;

  if (actionType === "dubbing") {
    const raw =
      typeof textOrPayloadOrDuration === "number"
        ? textOrPayloadOrDuration
        : typeof textOrPayloadOrDuration === "object"
          ? textOrPayloadOrDuration?.duration
          : undefined;
    const seconds = Math.min(
      DUBBING_MAX_BILLED_SECONDS,
      Math.max(1, Math.ceil(Number(raw) || DUBBING_FALLBACK_SECONDS)),
    );
    return parseFloat((seconds * DUBBING_CREDITS_PER_SECOND).toFixed(2));
  }
  if (actionType === "voice-changer") return 3;
  if (actionType === "lip-sync") return 6;
  return 10;
}

export const FIXED_TOOL_CREDITS = {
  upscale: 6,
  removeBg: 4,
  faceSwap: 4,
};
