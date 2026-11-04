import prismadb from "@/lib/prismadb";
import { IMAGE_MODELS, type ImageModel } from "./image-models";
import { VIDEO_MODEL_REGISTRY, orderVideoModelsForDisplay, type WaveSpeedVideoModel } from "./video-model-registry";

export interface DynamicImageModel extends ImageModel {
  isActive?: boolean;
  isCustom?: boolean;
  isDeleted?: boolean;
  family_color?: string;
  color?: string;
  text_api_route?: string;
  image_api_route?: string;
  reference_api_route?: string;
}

export interface DynamicVideoModelPricingConfig {
  stickerRates?: {
    "480p"?: number;
    "720p"?: number;
    "1080p"?: number;
    "4k"?: number;
  };
  turboStickerRates?: {
    "720p"?: number;
    "1080p"?: number;
  };
  // Extend-specific
  extendStickerRates?: {
    "480p"?: number;
    "720p"?: number;
    "1080p"?: number;
    "4k"?: number;
  };
  extendBillingMode?: "new_segment_only" | "source_plus_new_segment";
  extendMaxDuration?: number;
  extendSupportsLastImage?: boolean;
  extendDefaultSourceContextSec?: number;
  extendUserHintAr?: string;
  extendUserHintEn?: string;
  extendTipAr?: string;
  extendTipEn?: string;
  discountMultiplier?: number;
  creditsPerUsd?: number;
  billingMode?: "flat_output" | "input_plus_output" | "new_segment_only" | "base_plus_surcharge";
  lastVerifiedAt?: string;
  verificationSource?: "UI_MEASURED" | "INVOICE_MEASURED" | "DOCS_INFERRED";
}

export const SEEDANCE_INITIAL_PRICING: Record<string, DynamicVideoModelPricingConfig> = {
  "bytedance-seedance-v25-t2v-turbo": {
    stickerRates: { "480p": 0.18, "720p": 0.36, "1080p": 0.90, "4k": 1.80 },
    extendStickerRates: { "480p": 0.11, "720p": 0.22, "1080p": 0.55, "4k": 1.10 },
    extendBillingMode: "source_plus_new_segment",
    extendMaxDuration: 30,
    extendSupportsLastImage: false, // ⚠️ 2.5 unique
    extendDefaultSourceContextSec: 5,
    extendUserHintAr: "يقرأ الموديل {sourceSec} ثوانٍ من الفيديو الأصلي لفهم الحركة، ثم يضيف الجزء الجديد.",
    extendUserHintEn: "The model reads {sourceSec}s from source to understand motion, then generates the new segment.",
    extendTipAr: "نصيحة: إذا تريد جيلاً جديداً بنفس الشخصية، استخدم T2V/I2V مع رفرنس صورة — أرخص وأسرع.",
    extendTipEn: "Tip: For a new generation with same character, use T2V/I2V with image reference — cheaper and faster.",
    discountMultiplier: 0.90,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v25-t2v": {
    stickerRates: { "480p": 0.18, "720p": 0.36, "1080p": 0.90, "4k": 1.80 },
    extendStickerRates: { "480p": 0.11, "720p": 0.22, "1080p": 0.55, "4k": 1.10 },
    extendBillingMode: "source_plus_new_segment",
    extendMaxDuration: 30,
    extendSupportsLastImage: false,
    extendDefaultSourceContextSec: 5,
    extendUserHintAr: "يقرأ الموديل {sourceSec} ثوانٍ من الفيديو الأصلي لفهم الحركة، ثم يضيف الجزء الجديد.",
    extendUserHintEn: "The model reads {sourceSec}s from source to understand motion, then generates the new segment.",
    extendTipAr: "نصيحة: إذا تريد جيلاً جديداً بنفس الشخصية، استخدم T2V/I2V مع رفرنس صورة — أرخص وأسرع.",
    extendTipEn: "Tip: For a new generation with same character, use T2V/I2V with image reference — cheaper and faster.",
    discountMultiplier: 0.90,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v25-i2v-turbo": {
    turboStickerRates: { "720p": 0.20, "1080p": 0.21 },
    discountMultiplier: 0.90,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v2-t2v-fast": {
    turboStickerRates: { "720p": 0.14, "1080p": 0.15 },
    extendStickerRates: { "480p": 0.12, "720p": 0.24, "1080p": 0.60, "4k": 1.20 },
    extendBillingMode: "new_segment_only",
    extendMaxDuration: 15,
    extendSupportsLastImage: true,
    discountMultiplier: 0.90,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v2-t2v": {
    stickerRates: { "480p": 0.12, "720p": 0.24, "1080p": 0.60, "4k": 1.20 },
    extendStickerRates: { "480p": 0.12, "720p": 0.24, "1080p": 0.60, "4k": 1.20 },
    extendBillingMode: "new_segment_only",
    extendMaxDuration: 15,
    extendSupportsLastImage: true,
    discountMultiplier: 0.90,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v2-fast": {
    stickerRates: { "480p": 0.10, "720p": 0.20, "1080p": 0.50, "4k": 1.00 },
    extendStickerRates: { "480p": 0.10, "720p": 0.20, "1080p": 0.50, "4k": 1.00 },
    extendBillingMode: "new_segment_only",
    extendMaxDuration: 15,
    extendSupportsLastImage: true,
    discountMultiplier: 0.80,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
  "bytedance-seedance-v2-t2v-mini": {
    stickerRates: { "480p": 0.06, "720p": 0.12, "1080p": 0.30, "4k": 0.60 },
    extendStickerRates: { "480p": 0.06, "720p": 0.12, "1080p": 0.30, "4k": 0.60 },
    extendBillingMode: "new_segment_only",
    extendMaxDuration: 15,
    extendSupportsLastImage: true,
    discountMultiplier: 0.60,
    creditsPerUsd: 40,
    billingMode: "flat_output",
    lastVerifiedAt: "2026-08-28",
    verificationSource: "UI_MEASURED",
  },
};

export interface DynamicVideoModel extends WaveSpeedVideoModel {
  provider?: string;
  isActive?: boolean;
  creditCost?: number;
  isCustom?: boolean;
  isDeleted?: boolean;
  group?: string;
  color?: string;
  text_api_route?: string;
  image_api_route?: string;
  reference_api_route?: string;
  pricingConfig?: DynamicVideoModelPricingConfig;
}

const BLOCKED_DYNAMIC_IMAGE_IDS = new Set([
  "google/gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "openai/dall-e-3",
  "dalle3",
]);

const BLOCKED_DYNAMIC_VIDEO_IDS = new Set([
  "google/veo-3.1-generate-preview",
  "google/veo-3.1-fast-generate-preview",
  "google/veo-3.1-lite-generate-preview",
  "minimax-h3-max-turbo",
  "minimax-live-illustrations",
  "minimax-h3-reference-to-video",
  "minimax-hailuo-2.3-i2v-fast",
  "minimax-hailuo-2.3-i2v-pro",
  "minimax-hailuo-02",
  "minimax-hailuo-2.3",
  "kwaivgi/kling-v3.0-pro/text-to-video",
  "bytedance-seedance-v25-i2v-turbo",
  "bytedance-seedance-v25-i2v-spicy",
  "bytedance-seedance-v2-mini-spicy",
]);

function hasBlockedVideoRoute(model: Partial<DynamicVideoModel>): boolean {
  return [model.id, model.api_route, model.text_api_route, model.image_api_route, model.reference_api_route, model.start_end_api_route, model.video_api_route]
    .some((value) => typeof value === "string" && /(?:^|[\/_-])spicy(?:$|[\/_-])/i.test(value));
}

function mergeCuratedImageModel(curated: ImageModel, existing?: DynamicImageModel): DynamicImageModel {
  const group = existing?.group ?? curated.group ?? "Image Models";
  const familyColor = existing?.family_color ?? existing?.color ?? (curated as any).family_color ?? (curated as any).color ?? "#06b6d4";
  const label = existing?.label ?? (existing as any)?.name ?? curated.label;
  return {
    ...curated,
    label,
    group,
    family_color: familyColor,
    isActive: existing?.isDeleted ? false : (existing?.isActive ?? (curated as DynamicImageModel).isActive ?? true),
    isDeleted: existing?.isDeleted ?? false,
    creditCost: existing?.creditCost ?? curated.creditCost,
  };
}

function mergeWan30AdminCapabilities(
  curated: WaveSpeedVideoModel["capabilities"],
  existing?: DynamicVideoModel["capabilities"]
): WaveSpeedVideoModel["capabilities"] {
  if (!existing) return curated;

  const mergeOptions = (baseline: string[], override?: string[]) => {
    const ordered = [...baseline];
    if (Array.isArray(override)) {
      for (const option of override) {
        if (typeof option === "string" && option.trim() && !ordered.includes(option)) {
          ordered.push(option);
        }
      }
    }
    return ordered;
  };

  return {
    ...curated,
    aspect_ratios: mergeOptions(curated.aspect_ratios, existing.aspect_ratios),
    durations: Array.isArray(existing.durations) && existing.durations.length > 0
      ? existing.durations
      : curated.durations,
    resolutions: Array.isArray(existing.resolutions) && existing.resolutions.length > 0
      ? existing.resolutions
      : curated.resolutions,
    max_reference_images: typeof existing.max_reference_images === "number" && existing.max_reference_images > 0
      ? existing.max_reference_images
      : curated.max_reference_images,
    max_reference_videos: typeof existing.max_reference_videos === "number" && existing.max_reference_videos > 0
      ? existing.max_reference_videos
      : curated.max_reference_videos,
    max_reference_video_total_seconds: typeof existing.max_reference_video_total_seconds === "number" && existing.max_reference_video_total_seconds > 0
      ? existing.max_reference_video_total_seconds
      : curated.max_reference_video_total_seconds,
    max_reference_audios: typeof existing.max_reference_audios === "number" && existing.max_reference_audios > 0
      ? existing.max_reference_audios
      : curated.max_reference_audios,
    max_reference_audio_total_seconds: typeof existing.max_reference_audio_total_seconds === "number" && existing.max_reference_audio_total_seconds > 0
      ? existing.max_reference_audio_total_seconds
      : curated.max_reference_audio_total_seconds,
    has_sound: typeof existing.has_sound === "boolean" ? existing.has_sound : curated.has_sound,
    has_seed: typeof existing.has_seed === "boolean" ? existing.has_seed : curated.has_seed,
  };
}

function mergeCuratedVideoModel(curated: WaveSpeedVideoModel, existing?: DynamicVideoModel): DynamicVideoModel {
  const group = existing?.group ?? (curated as any).group ?? curated.family_label ?? curated.family ?? "Video Models";
  const familyColor = existing?.family_color ?? existing?.color ?? curated.family_color ?? "#8b5cf6";
  const familySlug = group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const name = existing?.name ?? (existing as any)?.label ?? curated.name;
  const capabilities = curated.id === "alibaba-wan-3.0-video"
    ? mergeWan30AdminCapabilities(curated.capabilities, existing?.capabilities)
    : curated.capabilities;

  const defaultPricing = SEEDANCE_INITIAL_PRICING[curated.id];
  const mergedPricing = existing?.pricingConfig
    ? {
        ...defaultPricing,
        ...existing.pricingConfig,
        stickerRates: { ...defaultPricing?.stickerRates, ...existing.pricingConfig.stickerRates },
        turboStickerRates: { ...defaultPricing?.turboStickerRates, ...existing.pricingConfig.turboStickerRates },
        extendStickerRates: { ...defaultPricing?.extendStickerRates, ...existing.pricingConfig.extendStickerRates },
        extendBillingMode: existing.pricingConfig.extendBillingMode ?? defaultPricing?.extendBillingMode,
        extendMaxDuration: existing.pricingConfig.extendMaxDuration ?? defaultPricing?.extendMaxDuration,
        extendSupportsLastImage: existing.pricingConfig.extendSupportsLastImage ?? defaultPricing?.extendSupportsLastImage,
        extendDefaultSourceContextSec: existing.pricingConfig.extendDefaultSourceContextSec ?? defaultPricing?.extendDefaultSourceContextSec,
        extendUserHintAr: existing.pricingConfig.extendUserHintAr ?? defaultPricing?.extendUserHintAr,
        extendUserHintEn: existing.pricingConfig.extendUserHintEn ?? defaultPricing?.extendUserHintEn,
        extendTipAr: existing.pricingConfig.extendTipAr ?? defaultPricing?.extendTipAr,
        extendTipEn: existing.pricingConfig.extendTipEn ?? defaultPricing?.extendTipEn,
      }
    : ((curated as any).pricingConfig ?? defaultPricing);

  return {
    ...curated,
    name,
    group,
    family: familySlug,
    family_label: group,
    family_color: familyColor,
    isActive: existing?.isDeleted ? false : (existing?.isActive ?? (curated as DynamicVideoModel).isActive ?? true),
    isDeleted: existing?.isDeleted ?? false,
    creditCost: existing?.creditCost ?? (curated as DynamicVideoModel).creditCost,
    capabilities,
    video_api_route: existing?.video_api_route ?? (curated as any).video_api_route,
    pricingConfig: mergedPricing,
  };
}

export function normalizeDynamicImageModels(models: DynamicImageModel[]): DynamicImageModel[] {
  const orderedResult: DynamicImageModel[] = [];
  const processedIds = new Set<string>();

  if (Array.isArray(models) && models.length > 0) {
    for (const model of models) {
      const id = model.id?.toLowerCase();
      if (!id || processedIds.has(id) || model.isDeleted || BLOCKED_DYNAMIC_IMAGE_IDS.has(id)) continue;
      if (/gemini-3(?:\.1)?-.*preview/i.test(model.id)) continue;

      const curated = IMAGE_MODELS.find((c) => c.id.toLowerCase() === id);
      if (curated) {
        orderedResult.push(mergeCuratedImageModel(curated, model));
      } else {
        orderedResult.push({
          ...model,
          label: model.label || model.id,
          sublabel: model.sublabel || "",
          badge: model.badge || "NEW",
          group: model.group || "Custom Fleet",
          inputType: (model.text_api_route || !model.image_api_route) ? "text-to-image" : (model.inputType || "text-to-image"),
          aspectRatios: model.aspectRatios || ["16:9", "9:16", "1:1"],
          maxImages: typeof model.maxImages === "number" ? model.maxImages : 4,
          maxRefImages: typeof model.maxRefImages === "number" ? model.maxRefImages : 4,
          family_color: model.family_color || model.color || "#06b6d4",
        });
      }
      processedIds.add(id);
    }
  }

  for (const curated of IMAGE_MODELS) {
    const id = curated.id.toLowerCase();
    if (!processedIds.has(id) && !BLOCKED_DYNAMIC_IMAGE_IDS.has(id)) {
      orderedResult.push(mergeCuratedImageModel(curated));
      processedIds.add(id);
    }
  }

  return orderedResult;
}

export function normalizeDynamicVideoModels(models: DynamicVideoModel[]): DynamicVideoModel[] {
  const orderedResult: DynamicVideoModel[] = [];
  const processedIds = new Set<string>();
  const processedGroupAndNames = new Set<string>();

  if (Array.isArray(models) && models.length > 0) {
    for (const model of models) {
      const id = model.id?.toLowerCase();
      if (!id || processedIds.has(id) || model.isDeleted || BLOCKED_DYNAMIC_VIDEO_IDS.has(id) || hasBlockedVideoRoute(model)) continue;

      const curated = VIDEO_MODEL_REGISTRY.find((c) => c.id.toLowerCase() === id);
      const merged = curated ? mergeCuratedVideoModel(curated, model) : null;
      const group = merged ? (merged.group || merged.family_label) : (model.group || (model as any).family_label || (model as any).family || "Custom Video Fleet");
      const modelName = (merged ? merged.name : model.name || "").trim().toLowerCase();
      const groupAndNameKey = `${group.toLowerCase()}:${modelName}`;

      if (processedGroupAndNames.has(groupAndNameKey)) {
        continue;
      }

      if (merged) {
        orderedResult.push(merged);
      } else {
        const familySlug = group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const familyColor = model.family_color || model.color || "#8b5cf6";
        orderedResult.push({
          ...model,
          group,
          family: familySlug,
          family_label: group,
          family_color: familyColor,
        });
      }
      processedIds.add(id);
      processedGroupAndNames.add(groupAndNameKey);
    }
  }

  for (const curated of VIDEO_MODEL_REGISTRY) {
    const id = curated.id.toLowerCase();
    const group = (curated.family_label || curated.family || "").toLowerCase();
    const modelName = (curated.name || "").trim().toLowerCase();
    const groupAndNameKey = `${group}:${modelName}`;
    if (!processedIds.has(id) && !processedGroupAndNames.has(groupAndNameKey) && !BLOCKED_DYNAMIC_VIDEO_IDS.has(id) && !hasBlockedVideoRoute(curated)) {
      orderedResult.push(mergeCuratedVideoModel(curated));
      processedIds.add(id);
      processedGroupAndNames.add(groupAndNameKey);
    }
  }

  return orderedResult;
}

/**
 * Loads dynamic image models from the PlatformConfig table.
 * If empty or not set, initializes it with static defaults.
 */
export async function getDynamicImageModels(): Promise<DynamicImageModel[]> {
  try {
    const config = await prismadb.platformConfig.findUnique({
      where: { key: "dynamic_image_models" },
    });
    if (config?.value) {
      const parsed = JSON.parse(config.value) as DynamicImageModel[];
      if (parsed && parsed.length > 0) {
        const normalized = normalizeDynamicImageModels(parsed);
        if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
          await saveDynamicImageModels(normalized);
        }
        return normalized;
      }
    }
    const normalizedDefaults = normalizeDynamicImageModels(IMAGE_MODELS);
    await saveDynamicImageModels(normalizedDefaults);
    return normalizedDefaults;
  } catch (error) {
    console.error("[GET_DYNAMIC_IMAGE_MODELS_ERROR]", error);
    return normalizeDynamicImageModels(IMAGE_MODELS);
  }
}

/**
 * Loads dynamic video models from the PlatformConfig table.
 * If empty or not set, initializes it with static defaults.
 */
export async function getDynamicVideoModels(): Promise<DynamicVideoModel[]> {
  try {
    const config = await prismadb.platformConfig.findUnique({
      where: { key: "dynamic_video_models" },
    });
    if (config?.value) {
      const parsed = JSON.parse(config.value) as DynamicVideoModel[];
      if (parsed && parsed.length > 0) {
        const normalized = normalizeDynamicVideoModels(parsed);
        if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
          await saveDynamicVideoModels(normalized);
        }
        return normalized;
      }
    }
    const normalizedDefaults = normalizeDynamicVideoModels(VIDEO_MODEL_REGISTRY);
    await saveDynamicVideoModels(normalizedDefaults);
    return normalizedDefaults;
  } catch (error) {
    console.error("[GET_DYNAMIC_VIDEO_MODELS_ERROR]", error);
    return normalizeDynamicVideoModels(VIDEO_MODEL_REGISTRY);
  }
}

/**
 * Saves dynamic image models to the PlatformConfig table.
 */
export async function saveDynamicImageModels(models: ImageModel[]): Promise<void> {
  const serialized = JSON.stringify(models);
  await prismadb.platformConfig.upsert({
    where: { key: "dynamic_image_models" },
    update: { value: serialized },
    create: { key: "dynamic_image_models", value: serialized },
  });
}

/**
 * Saves dynamic video models to the PlatformConfig table.
 */
export async function saveDynamicVideoModels(models: WaveSpeedVideoModel[]): Promise<void> {
  const serialized = JSON.stringify(models);
  await prismadb.platformConfig.upsert({
    where: { key: "dynamic_video_models" },
    update: { value: serialized },
    create: { key: "dynamic_video_models", value: serialized },
  });
}

export interface InferredModelSpecs {
  cleanName: string;
  cleanId: string;
  modality: "image" | "video";
  provider: string;
  group: string;
  familyColor: string;
  aspectRatios: string[];
  durations: number[];
  resolutions: string[];
  maxRefImages: number;
  textRoute: string;
  imageRoute: string;
  referenceRoute?: string;
  startEndRoute?: string;
  creditCost: number;
}

export function cleanModelDisplayName(raw: string): string {
  if (!raw) return "";
  let name = raw.trim();

  // Strip provider prefixes if in path or id
  name = name.replace(/^(x-ai|bytedance|alibaba|kwaivgi|kling|wavespeed-ai|wavespeed|openai|google)[\/\-_:]/i, "");

  // Strip technical sub-route suffixes
  name = name.replace(/[\/\-_:]?(text-to-image|image-to-image|image-to-video|text-to-video|edit-video|reference-to-video|sequential|edit-sequential|edit|quality|image|video)$/gi, "");
  name = name.replace(/[\/\-_:]?(text-to-image|image-to-image|image-to-video|text-to-video|edit-video|reference-to-video|sequential|edit-sequential|edit|quality)$/gi, "");

  // Handle well-known flagship clean brandings:
  if (/grok\s*imagine/i.test(raw) || /grok/i.test(raw)) {
    if (/v2|2\.0|2/i.test(raw)) return "Grok Imagine 2.0";
    return "Grok Imagine";
  }
  if (/seedance/i.test(raw)) {
    if (/2\.5|25/i.test(raw)) return "Seedance 2.5";
    if (/mini/i.test(raw)) return "Seedance 2.0 Mini";
    return "Seedance 2.0";
  }
  if (/seedream/i.test(raw)) {
    if (/5.*pro|5\.0.*pro/i.test(raw)) return "Seedream 5.0 Pro";
    if (/5.*lite|5\.0.*lite/i.test(raw)) return "Seedream 5.0 Lite";
    if (/4\.5/i.test(raw)) return "Seedream 4.5";
    return "Seedream 5.0";
  }
  if (/kling/i.test(raw)) {
    if (/3\.0.*pro|3.*pro/i.test(raw)) return "Kling 3.0 Pro";
    if (/3\.0|3/i.test(raw)) return "Kling 3.0";
    if (/o3/i.test(raw)) return "Kling O3";
    if (/turbo/i.test(raw)) return "Kling V3 Turbo";
    if (/2\.6/i.test(raw)) return "Kling 2.6";
  }
  if (/wan/i.test(raw)) {
    if (/2\.7/i.test(raw)) return "Wan 2.7 Pro";
    if (/2\.5/i.test(raw)) return "Wan 2.5";
    if (/2\.1/i.test(raw)) return "Wan 2.1";
  }
  if (/flux/i.test(raw)) {
    if (/pro/i.test(raw)) return "FLUX.2 Pro";
    if (/flex/i.test(raw)) return "FLUX.2 Flex";
    if (/max/i.test(raw)) return "FLUX.2 Max";
    return "FLUX.2";
  }
  if (/minimax|hailuo/i.test(raw)) {
    if (/h3/i.test(raw)) return "Minimax H3";
    if (/02.*fast/i.test(raw)) return "MiniMax Hailuo 02 Fast";
    if (/02.*standard|02.*std/i.test(raw)) return "MiniMax Hailuo 02 Standard";
    if (/02.*pro|02/i.test(raw)) return "MiniMax Hailuo 02 Pro";
    if (/2\.3.*fast/i.test(raw)) return "MiniMax Hailuo 2.3 Fast";
    if (/2\.3/i.test(raw)) return "MiniMax Hailuo 2.3 Pro";
    return "MiniMax Hailuo";
  }

  // If camelCase or hyphenated, turn into title words
  name = name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return name || raw;
}

export function inferModelCapabilitiesAndSpecs(rawIdOrRoute: string, rawTitle?: string): InferredModelSpecs {
  const text = `${rawIdOrRoute} ${rawTitle || ""}`.toLowerCase();
  const cleanName = cleanModelDisplayName(rawTitle || rawIdOrRoute);

  // 1. Grok Imagine
  if (text.includes("grok")) {
    const isV2 = text.includes("v2") || text.includes("2.0");
    const textRoute = isV2
      ? "x-ai/grok-imagine-image-v2.0/text-to-image"
      : "x-ai/grok-imagine-image-quality/text-to-image";
    const editRoute = isV2
      ? "x-ai/grok-imagine-image-v2.0/edit"
      : "x-ai/grok-imagine-image-quality/edit";
    return {
      cleanName: isV2 ? "Grok Imagine 2.0" : "Grok Imagine",
      cleanId: isV2 ? "grok-imagine-v2" : "grok-imagine",
      modality: "image",
      provider: "wavespeed",
      group: "Grok",
      familyColor: "#06b6d4",
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"],
      durations: [],
      resolutions: ["1K", "2K", "4K"],
      maxRefImages: 1,
      textRoute,
      imageRoute: editRoute,
      creditCost: 2.0,
    };
  }

  // 2. Kling Video
  if (text.includes("kling")) {
    const isTurbo = text.includes("turbo");
    const isO3 = text.includes("o3");
    const is26 = text.includes("2.6");

    let textRoute = "kwaivgi/kling-v3.0-pro/text-to-video";
    let imageRoute = "kwaivgi/kling-v3.0-pro/image-to-video";
    let cleanId = "kling-3-pro";
    let name = "Kling 3.0 Pro";

    if (isTurbo) {
      textRoute = "kwaivgi/kling-v3-turbo-pro/text-to-video";
      imageRoute = "kwaivgi/kling-v3-turbo-pro/image-to-video";
      cleanId = "kling-v3-turbo";
      name = "Kling V3 Turbo";
    } else if (isO3) {
      textRoute = "kwaivgi/kling-video-o3-std/text-to-video";
      imageRoute = "kwaivgi/kling-video-o3-std/image-to-video";
      cleanId = "kling-o3";
      name = "Kling O3";
    } else if (is26) {
      textRoute = "kwaivgi/kling-v2.6-std/text-to-video";
      imageRoute = "kwaivgi/kling-v2.6-std/image-to-video";
      cleanId = "kling-2-6";
      name = "Kling 2.6";
    }

    return {
      cleanName: name,
      cleanId,
      modality: "video",
      provider: "wavespeed",
      group: "Kling",
      familyColor: "#8b5cf6",
      aspectRatios: ["16:9", "9:16", "1:1"],
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["Standard", "Pro", "4K"],
      maxRefImages: 4,
      textRoute,
      imageRoute,
      creditCost: isTurbo ? 6.0 : 22.4,
    };
  }

  // 3. Seedance Video
  if (text.includes("seedance")) {
    const is25 = text.includes("2.5") || text.includes("25");
    const isMini = text.includes("mini");
    const textRoute = is25
      ? "bytedance/seedance-2.5/text-to-video-turbo"
      : isMini
        ? "bytedance/seedance-2.0-mini/text-to-video"
        : "bytedance/seedance-2.0/text-to-video";
    const imageRoute = is25
      ? "bytedance/seedance-2.5/image-to-video-turbo"
      : isMini
        ? "bytedance/seedance-2.0-mini/image-to-video"
        : "bytedance/seedance-2.0/image-to-video";
    return {
      cleanName: is25 ? "Seedance 2.5" : isMini ? "Seedance 2.0 Mini" : "Seedance 2.0",
      cleanId: is25 ? "seedance-2-5" : isMini ? "seedance-2-mini" : "seedance-2-0",
      modality: "video",
      provider: "byteplus",
      group: "Seedance",
      familyColor: "#10b981",
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["480p", "720p", "1080p", "4K"],
      maxRefImages: 9,
      textRoute,
      imageRoute,
      creditCost: isMini ? 2.5 : 3.0,
    };
  }

  // 4. Seedream Image
  if (text.includes("seedream")) {
    const is5Pro = text.includes("5-pro") || text.includes("5.0-pro") || text.includes("pro");
    const textRoute = is5Pro ? "bytedance/seedream-v5.0-pro" : "bytedance/seedream-v5.0-lite";
    const imageRoute = is5Pro ? "bytedance/seedream-v5.0-pro/edit" : "bytedance/seedream-v5.0-lite/edit";
    return {
      cleanName: is5Pro ? "Seedream 5.0 Pro" : "Seedream 5.0 Lite",
      cleanId: is5Pro ? "seedream-5-pro" : "seedream-5-lite",
      modality: "image",
      provider: "wavespeed",
      group: "Seedream",
      familyColor: "#10b981",
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "auto"],
      durations: [],
      resolutions: ["1K", "2K", "4K"],
      maxRefImages: 4,
      textRoute,
      imageRoute,
      creditCost: 2.0,
    };
  }

  // 5. FLUX.2 Image & FLUX 3 Video
  if (text.includes("flux")) {
    if (text.includes("flux-3") || text.includes("flux 3") || (text.includes("flux") && (text.includes("video") || text.includes("t2v") || text.includes("i2v") || text.includes("extend")))) {
      return {
        cleanName: "Flux 3",
        cleanId: "black-forest-labs-flux-3-video",
        modality: "video",
        provider: "wavespeed",
        group: "Flux",
        familyColor: "#ec4899",
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "2:1"],
        durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        resolutions: ["720p", "1080p"],
        maxRefImages: 10,
        textRoute: "black-forest-labs/flux-3/text-to-video",
        imageRoute: "black-forest-labs/flux-3/image-to-video",
        referenceRoute: "black-forest-labs/flux-3/image-to-video",
        creditCost: 9.52,
      };
    }
    const isFlex = text.includes("flex");
    const tier = isFlex ? "flex" : "pro";
    return {
      cleanName: isFlex ? "FLUX.2 Flex" : "FLUX.2 Pro",
      cleanId: `flux-2-${tier}`,
      modality: "image",
      provider: "wavespeed",
      group: "Flux",
      familyColor: "#ec4899",
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "1:2", "2:1"],
      durations: [],
      resolutions: ["1K", "2K", "4K"],
      maxRefImages: 3,
      textRoute: `wavespeed-ai/flux-2-${tier}/text-to-image`,
      imageRoute: `wavespeed-ai/flux-2-${tier}/edit`,
      creditCost: 2.0,
    };
  }

  // 6. Wan Video/Image
  if (text.includes("wan")) {
    const isWan30 = text.includes("3.0") || text.includes("wan-3") || text.includes("wan 3");
    const isWan30Video = isWan30 && (text.includes("video") || text.includes("t2v") || text.includes("i2v"));
    const isImg = text.includes("image");
    if (isWan30Video) {
      return {
        cleanName: "Wan 3.0",
        cleanId: "alibaba-wan-3-0-video",
        modality: "video",
        provider: "wavespeed",
        group: "Wan",
        familyColor: "#f59e0b",
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30],
        resolutions: ["480p", "720p", "1080p"],
        maxRefImages: 10,
        textRoute: "alibaba/wan-3.0/text-to-video",
        imageRoute: "alibaba/wan-3.0/image-to-video",
        referenceRoute: "alibaba/wan-3.0/reference-to-video",
        creditCost: 7.28,
      };
    }
    if (isImg) {
      return {
        cleanName: "Wan 2.7 Image Pro",
        cleanId: "wan-2-7-image-pro",
        modality: "image",
        provider: "wavespeed",
        group: "Wan",
        familyColor: "#f59e0b",
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        durations: [],
        resolutions: ["1K", "2K", "4K"],
        maxRefImages: 3,
        textRoute: "alibaba/wan-2.7/text-to-image-pro",
        imageRoute: "alibaba/wan-2.7/image-edit-pro",
        creditCost: 2.0,
      };
    }
    return {
      cleanName: "Wan 2.5 Video",
      cleanId: "wan-2-5-video",
      modality: "video",
      provider: "wavespeed",
      group: "Wan",
      familyColor: "#f59e0b",
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      durations: [5, 10],
      resolutions: ["720p", "1080p"],
      maxRefImages: 3,
      textRoute: "alibaba/wan-2.5/text-to-video",
      imageRoute: "alibaba/wan-2.5/image-to-video",
      creditCost: 3.0,
    };
  }

  // 7. Minimax / Hailuo Video
  if (text.includes("minimax") || text.includes("hailuo")) {
    if (text.includes("h3") && text.includes("max")) {

      return {

        cleanName: "MiniMax H3 Max",

        cleanId: "minimax-h3-max",

        modality: "video",

        provider: "wavespeed",

        group: "Minimax Hailuo",

        familyColor: "#f59e0b",

        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],

        durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],

        resolutions: ["480p", "768p"],

        maxRefImages: 9,

        textRoute: "wavespeed-ai/minimax-h3/text-to-video",

        imageRoute: "wavespeed-ai/minimax-h3/image-to-video",

        referenceRoute: "wavespeed-ai/minimax-h3/reference-to-video",

        creditCost: 14.0,

      };

    }

    if (text.includes("h3")) {

      return {
        cleanName: "Minimax H3",
        cleanId: "minimax-h3",
        modality: "video",
        provider: "wavespeed",
        group: "Minimax Hailuo",
        familyColor: "#f59e0b",
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutions: ["768p", "2k"],
        maxRefImages: 9,
        textRoute: "minimax/h3/text-to-video",
        imageRoute: "minimax/h3/image-to-video",
        referenceRoute: "minimax/h3/reference-to-video",
        creditCost: 39.2,
      };
    }
    if (text.includes("02")) {
      if (text.includes("fast")) {
        return {
          cleanName: "MiniMax Hailuo 02 Fast",
          cleanId: "minimax-hailuo-02-fast",
          modality: "video",
          provider: "wavespeed",
          group: "Minimax Hailuo",
          familyColor: "#f59e0b",
          aspectRatios: [],
          durations: [6, 10],
          resolutions: ["512p"],
          maxRefImages: 0,
          textRoute: "",
          imageRoute: "minimax/hailuo-02/fast",
          creditCost: 5.6,
        };
      }
      if (text.includes("standard") || text.includes("std")) {
        return {
          cleanName: "MiniMax Hailuo 02 Standard",
          cleanId: "minimax-hailuo-02-standard",
          modality: "video",
          provider: "wavespeed",
          group: "Minimax Hailuo",
          familyColor: "#f59e0b",
          aspectRatios: [],
          durations: [6, 10],
          resolutions: ["768p"],
          maxRefImages: 0,
          textRoute: "minimax/hailuo-02/t2v-standard",
          imageRoute: "minimax/hailuo-02/i2v-standard",
          startEndRoute: "minimax/hailuo-02/i2v-standard",
          creditCost: 12.88,
        };
      }
      return {
        cleanName: "MiniMax Hailuo 02 Pro",
        cleanId: "minimax-hailuo-02-pro",
        modality: "video",
        provider: "wavespeed",
        group: "Minimax Hailuo",
        familyColor: "#f59e0b",
        aspectRatios: [],
        durations: [6],
        resolutions: ["1080p"],
        maxRefImages: 0,
        textRoute: "minimax/hailuo-02/t2v-pro",
        imageRoute: "minimax/hailuo-02/i2v-pro",
        startEndRoute: "minimax/hailuo-02/i2v-pro",
        creditCost: 27.44,
      };
    }
    if (text.includes("fast")) {
      return {
        cleanName: "MiniMax Hailuo 2.3 Fast",
        cleanId: "minimax-hailuo-2.3-fast",
        modality: "video",
        provider: "wavespeed",
        group: "Minimax Hailuo",
        familyColor: "#f59e0b",
        aspectRatios: [],
        durations: [6, 10],
        resolutions: ["720p"],
        maxRefImages: 0,
        textRoute: "",
        imageRoute: "minimax/hailuo-2.3/fast",
        creditCost: 10.64,
      };
    }
    return {
      cleanName: "MiniMax Hailuo 2.3 Pro",
      cleanId: "minimax-hailuo-2.3-pro",
      modality: "video",
      provider: "wavespeed",
      group: "Minimax Hailuo",
      familyColor: "#f59e0b",
      aspectRatios: [],
      durations: [5, 6],
      resolutions: ["1080p"],
      maxRefImages: 0,
      textRoute: "minimax/hailuo-2.3/t2v-pro",
      imageRoute: "minimax/hailuo-2.3/i2v-pro",
      creditCost: 27.44,
    };
  }

  // Generic fallback
  const isVideo = text.includes("video") || text.includes("t2v") || text.includes("i2v");
  return {
    cleanName,
    cleanId: rawIdOrRoute.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    modality: isVideo ? "video" : "image",
    provider: "wavespeed",
    group: "Custom Fleet",
    familyColor: isVideo ? "#8b5cf6" : "#06b6d4",
    aspectRatios: isVideo ? ["16:9", "9:16", "1:1"] : ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    durations: isVideo ? [5, 10] : [],
    resolutions: isVideo ? ["720p", "1080p"] : ["1K", "2K"],
    maxRefImages: 4,
    textRoute: rawIdOrRoute,
    imageRoute: rawIdOrRoute.includes("text") ? rawIdOrRoute.replace(/text-to-image/i, "edit").replace(/text-to-video/i, "image-to-video") : "",
    creditCost: isVideo ? 3.0 : 2.0,
  };
}

export function resolveDynamicVideoSubRoute(
  model: Pick<DynamicVideoModel, "api_route" | "text_api_route" | "image_api_route" | "reference_api_route"> & {
    video_api_route?: string;
    edit_api_route?: string;
    start_end_api_route?: string;
  },
  hasImageOrReferenceInput: boolean,
  hasReferenceInput = false,
  hasVideoInput = false,
  hasStartEndInput = false
): string {
  if (hasVideoInput && model.video_api_route?.trim()) {
    return model.video_api_route.trim();
  }

  if (hasStartEndInput && model.start_end_api_route?.trim()) {
    return model.start_end_api_route.trim();
  }

  if (hasReferenceInput && model.reference_api_route?.trim()) {
    return model.reference_api_route.trim();
  }

  if (hasImageOrReferenceInput && model.image_api_route?.trim()) {
    return model.image_api_route.trim();
  }

  if (!hasImageOrReferenceInput && !hasVideoInput && model.text_api_route?.trim()) {
    return model.text_api_route.trim();
  }

  return model.api_route?.trim() || model.text_api_route?.trim() || model.image_api_route?.trim() || model.reference_api_route?.trim() || model.video_api_route?.trim() || "";
}
