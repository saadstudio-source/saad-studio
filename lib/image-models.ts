// â”€â”€â”€ Image Model Definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Per-model API parameter configs used by the image workspace UI.
// Routes: Google official (google/nano-banana/imagen), OpenAI official (gpt-image), WaveSpeed (all other curated image rows).

import {
  GEMINI_FLASH_IMAGE_ASPECT_RATIOS,
  GEMINI_FLASH_LITE_IMAGE_ASPECT_RATIOS,
  GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
  GOOGLE_IMAGE_UPSTREAM_MODEL_MAP,
} from "./google-image-model-specs";
import { DEFAULT_MODELS, calcUserCredits } from "./pricing-models";

export type ImageInputType = "text-to-image" | "image-to-image" | "edit";

export interface ImageModel {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  group: string;
  /** Optional provider-native model id. */
  upstreamModelId?: string;
  /** Dynamic/admin catalogs can disable models without removing them. */
  isActive?: boolean;
  inputType: ImageInputType;
  /** Supported aspect ratio strings. Empty array = N/A (inherits from input image). */
  aspectRatios: string[];
  /** Max images per generation run. */
  maxImages: number;
  /** How many reference images this model accepts for the configured provider route. */
  maxRefImages: number;
  /** Planning depth presets sent as `complexity` (GPT Image 2.6). Free: never changes the price. */
  complexityParam?: string[];
  /** Whether this model exposes a grok-style mode toggle. */
  grokMode?: boolean;
  /** Quality presets sent as a `quality` param (e.g. GPT Image). */
  qualityParam?: string[];
  /** Exact provider resolution presets exposed separately from quality. */
  resolutions?: string[];
  /** Provider input field name for reference images:
   * - undefined / "image_url" â†’ single: image_url, multi: image_urls (default)
   * - "image_input" â†’ always array: image_input (Gemini/Nano Banana models)
   * - "images" â†’ always array: images (WaveSpeed multi-reference edit models)
   * - "image" â†’ single string: image (WaveSpeed single-reference edit models)
   * - "image_urls" â†’ always array: image_urls (legacy compatibility)
   * - "image_url" â†’ single string: image_url (Qwen image-edit, qwen/image-to-image)
   * - "input_urls" â†’ always array: input_urls (GPT Image I2I, Wan, Flux-2 I2I)
   */
  imageInputField?: "image_url" | "image_input" | "image_urls" | "input_urls" | "image" | "images";
  /** When true, the route runs N parallel createTasks for models that don't
   * accept num_images / n natively (so the user actually receives N images).
   * When false, model is sent num_images / n (or n via sequential mode for Wan).
   * Auto-derived per model in the route. UI does not set this. */
  /** Grok Imagine T2I exposes a speed-vs-quality boolean (`enable_pro`).
   * When true, `quality === "quality"` triggers enable_pro: true. */
  grokProToggle?: boolean;
  /** Wan 2.7 Image Pro can output up to 12 images via `enable_sequential: true`.
   * When true, the UI shows a sequential-mode toggle. */
  wanSequentialMode?: boolean;
  /** Seedream Lite uses a `size` pixel-dim string (e.g. "2048*2048") instead of a
   * `quality` tier. When true, the route sends `size` derived from qualityParam.
   * Sequential mode auto-activates on the server when numImages > 1. */
  seedreamLiteSize?: boolean;
  /** Display credit cost (UI only). */
  creditCost: number;
}

const IMAGE_QUALITY_CREDIT_MULTIPLIER: Record<string, number> = {
  "512px": 0.5,
  "1k": 1.0,
  "1024": 1.0,
  "2k": 1.5,
  "2048": 1.5,
  "4k": 3.0,
};

const IMAGE_MODEL_QUALITY_CREDIT_MULTIPLIER: Record<string, Record<string, number>> = {
  "nano-banana-pro": { "2k": 1.5, "4k": 1.875 },
  "wan/2-7-image-pro": { "2k": 1.5, "4k": 1.875 },
  "nano-banana-2": { "512px": 0.5, "2k": 1.5, "4k": 2.25 },
  "nano-banana-2-lite": { "2k": 1.5, "4k": 2.25 },
  "gpt-image-2-text-to-image": { "medium": 1.5, "high": 1.875 },
  "gpt-image-2-image-to-image": { "medium": 1.5, "high": 1.875 },
  "gpt-image-2.5-flare-text-to-image": { "medium": 1.5, "high": 1.875 },
  "gpt-image-2.5-flare-image-to-image": { "medium": 1.5, "high": 1.875 },
  "gpt-image-2.5-sunburst-text-to-image": { "medium": 1.5, "high": 1.875 },
  "gpt-image-2.5-sunburst-image-to-image": { "medium": 1.5, "high": 1.875 },
  "google/imagen4": { "2k": 1.5, "4k": 2.0 },
  "google/imagen4-ultra": { "2k": 1.5, "4k": 2.0 },
  "seedream/5-pro": { "1k": 1.0, "2k": 2.0 },
  "seedream/5-pro-text-to-image": { "1k": 1.0, "2k": 2.0 },
  "seedream/5-pro-image-to-image": { "1k": 1.0, "2k": 2.0 },
};

const GPT_IMAGE_25_TEXT_USD: Record<string, Record<string, number>> = {
  low: { "1k": 0.01, "2k": 0.02, "4k": 0.03 }, medium: { "1k": 0.024, "2k": 0.04, "4k": 0.07 },
  high: { "1k": 0.09, "2k": 0.15, "4k": 0.27 }, xhigh: { "1k": 0.16, "2k": 0.27, "4k": 0.48 }, max: { "1k": 0.36, "2k": 0.60, "4k": 1.00 },
};
const GPT_IMAGE_25_EDIT_USD: Record<string, Record<string, number>> = {
  low: { "1k": 0.02, "2k": 0.03, "4k": 0.04 }, medium: { "1k": 0.034, "2k": 0.05, "4k": 0.08 },
  high: { "1k": 0.10, "2k": 0.16, "4k": 0.28 }, xhigh: { "1k": 0.17, "2k": 0.28, "4k": 0.49 }, max: { "1k": 0.37, "2k": 0.61, "4k": 1.01 },
};

// GPT Image 2.6 (Flare + Sunburst share one tariff). WaveSpeed docs: edit prices already include
// ONE input image ($0.015); every extra image adds $0.015. complexity never changes the price.
// SVG output adds $0.02 and GIF costs the same as a still (text-to-image only; not exposed yet).
const GPT_IMAGE_26_TEXT_USD: Record<string, Record<string, number>> = {
  low: { "1k": 0.03, "2k": 0.06, "4k": 0.10 }, medium: { "1k": 0.05, "2k": 0.10, "4k": 0.18 },
  high: { "1k": 0.06, "2k": 0.12, "4k": 0.21 }, xhigh: { "1k": 0.11, "2k": 0.21, "4k": 0.38 }, max: { "1k": 0.25, "2k": 0.47, "4k": 0.85 },
};
const GPT_IMAGE_26_EDIT_USD: Record<string, Record<string, number>> = {
  low: { "1k": 0.045, "2k": 0.075, "4k": 0.115 }, medium: { "1k": 0.065, "2k": 0.115, "4k": 0.195 },
  high: { "1k": 0.075, "2k": 0.135, "4k": 0.225 }, xhigh: { "1k": 0.125, "2k": 0.225, "4k": 0.395 }, max: { "1k": 0.265, "2k": 0.485, "4k": 0.865 },
};

/** True for the WaveSpeed-routed GPT Image 2.5 / 2.6 rows (Flare + Sunburst, text + edit). */
export function isWaveSpeedGptImageModelId(modelId: string): boolean {
  // Case-insensitive on purpose: the WaveSpeed router lower-cases ids, so an upper-case id must not
  // slip past the pricing check and fall back to the flat default price.
  return /gpt-image-2\.[56]/i.test(modelId);
}

export const GPT_IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export const GPT_IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;

export type GptImageTier = { ok: true; quality: string; resolution: string } | { ok: false; error: string };

/**
 * Single source of truth for the quality/resolution of a GPT Image 2.5 / 2.6 request.
 * The SAME normalised values must feed the credit charge and the provider payload, otherwise a
 * padded or re-cased value ("4K ", imageSize instead of resolution) can be billed as 1k and
 * rendered as 4k. Absent values get the provider defaults; present-but-unknown values are rejected.
 */
export function normalizeGptImageTier(quality: unknown, resolution: unknown, imageSize?: unknown): GptImageTier {
  const clean = (value: unknown) => (value == null ? "" : String(value).trim().toLowerCase());
  const q = clean(quality) || "medium";
  const r = clean(resolution) || clean(imageSize) || "1k";
  if (!(GPT_IMAGE_QUALITIES as readonly string[]).includes(q)) {
    return { ok: false, error: `Unsupported quality "${q}". Use one of: ${GPT_IMAGE_QUALITIES.join(", ")}.` };
  }
  if (!(GPT_IMAGE_RESOLUTIONS as readonly string[]).includes(r)) {
    return { ok: false, error: `Unsupported resolution "${r}". Use one of: ${GPT_IMAGE_RESOLUTIONS.join(", ")}.` };
  }
  return { ok: true, quality: q, resolution: r };
}

export const GPT_IMAGE_COMPLEXITIES = ["low", "medium", "high"] as const;

/** Credits charged per image for GPT Image 2.5 / 2.6: cheapest tier and dearest tier. */
export const GPT_IMAGE_CREDIT_FLOOR = 1;
export const GPT_IMAGE_CREDIT_CEILING = 15;

export function getWaveSpeedGptImage25Credits(modelId: string, numImages = 1, quality?: string | null, resolution?: string | null, referenceCount = 0): number {
  // Fail closed: an unknown tier is priced at the dearest one, never at the cheap default.
  // (The route rejects unknown tiers up front via normalizeGptImageTier; this is the backstop.)
  const id = String(modelId).trim().toLowerCase();
  const qValue = String(quality ?? "medium").trim().toLowerCase() || "medium";
  const resValue = String(resolution ?? "1k").trim().toLowerCase() || "1k";
  const known = (GPT_IMAGE_QUALITIES as readonly string[]).includes(qValue) && (GPT_IMAGE_RESOLUTIONS as readonly string[]).includes(resValue);
  const q = known ? qValue : "max";
  const res = known ? resValue : "4k";
  const isEdit = id.includes("image-to-image") || id.endsWith("/edit") || id.includes("-edit");
  const is26 = id.includes("gpt-image-2.6");
  const table = is26
    ? (isEdit ? GPT_IMAGE_26_EDIT_USD : GPT_IMAGE_26_TEXT_USD)
    : (isEdit ? GPT_IMAGE_25_EDIT_USD : GPT_IMAGE_25_TEXT_USD);
  const base = table[q][res];
  const extraReferenceUsd = isEdit ? Math.max(0, Math.ceil(Number(referenceCount) || 0) - 1) * 0.015 : 0;
  const units = Math.max(1, Math.ceil(Number(numImages) || 1));
  // Owner-set price band (2026-11-08): the cheapest combination (low @ 1k) costs
  // GPT_IMAGE_CREDIT_FLOOR credits and the dearest (max @ 4k) GPT_IMAGE_CREDIT_CEILING credits.
  // Everything in between is placed on a straight line by the provider's USD cost, so a
  // higher quality or resolution is never cheaper than a lower one. Extra references add
  // their provider cost on the same line.
  const minUsd = table.low["1k"];
  const maxUsd = table.max["4k"];
  const perImage = GPT_IMAGE_CREDIT_FLOOR + ((base + extraReferenceUsd - minUsd) / (maxUsd - minUsd)) * (GPT_IMAGE_CREDIT_CEILING - GPT_IMAGE_CREDIT_FLOOR);
  return parseFloat((perImage * units).toFixed(2));
}

export function getImageCreditCost(_model: ImageModel, numImages = 1, quality?: string | null, resolution?: string | null, referenceCount = 0): number {
  // MUST stay in sync with the server-side rule in `lib/pricing.ts` (getGenerationCost):
  //   All non-utility image models cost 2 credits at 1k/2k and 4 credits at 4k, per image.
  // The per-model / per-quality multiplier tables above are legacy display data that no
  // longer reflect what the server actually charges — do not reintroduce them here.
  const safeUnits = Math.max(1, Math.ceil(Number(numImages) || 1));
  if (isWaveSpeedGptImageModelId(_model.id)) {
    return getWaveSpeedGptImage25Credits(_model.id, safeUnits, quality, resolution, referenceCount);
  }
  const q = quality?.trim().toLowerCase() ?? "1k";
  const baseRate = q === "4k" ? 4.0 : 2.0;
  return parseFloat((baseRate * safeUnits).toFixed(2));
}

const CLIENT_UTILITY_IMAGE_MODEL_IDS = {
  upscale: "tool_upscale",
  faceSwap: "tool_faceswap",
} as const;

const CLIENT_QUALITY_MULTIPLIER: Record<string, number> = {
  "512px": 0.5,
  "1k": 1.0,
  "2k": 1.5,
  "4k": 3.0,
  "8k": 3.0,
};

export function formatCreditAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(2).replace(/\.?0+$/, "");
}

export function getImageUtilityCreditCost(
  tool: keyof typeof CLIENT_UTILITY_IMAGE_MODEL_IDS,
  quality?: string | null,
): number {
  const modelId = CLIENT_UTILITY_IMAGE_MODEL_IDS[tool];
  const model = DEFAULT_MODELS.find((entry) => entry.id === modelId && entry.isActive);
  if (!model) return 0;

  const base = calcUserCredits(model, 0);
  const q = quality?.trim().toLowerCase() ?? "";
  const multiplier = CLIENT_QUALITY_MULTIPLIER[q] ?? 1.0;
  return parseFloat((base * multiplier).toFixed(2));
}

export function getImageUpscaleTargetResolution(scale: number): "2k" | "4k" | "8k" {
  const normalized = String(scale);
  if (normalized === "1") return "2k";
  if (normalized === "8") return "8k";
  return "4k";
}

// â”€â”€â”€ All Aspect Options lookup (for the UI toggle buttons) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ALL_ASPECT_OPTIONS = [
  { value: "auto",  label: "Auto",  cls: "w-7 h-7"        },
  { value: "1:1",   label: "1:1",   cls: "w-6 h-6"        },
  { value: "16:9",  label: "16:9",  cls: "w-8 h-[18px]"   },
  { value: "9:16",  label: "9:16",  cls: "w-[18px] h-8"   },
  { value: "4:3",   label: "4:3",   cls: "w-8 h-6"         },
  { value: "3:4",   label: "3:4",   cls: "w-6 h-8"         },
  { value: "21:9",  label: "21:9",  cls: "w-[42px] h-[18px]" },
  { value: "2:3",   label: "2:3",   cls: "w-[18px] h-7"   },
  { value: "3:2",   label: "3:2",   cls: "w-7 h-[18px]"   },
] as const;

// â”€â”€â”€ Image Model Catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const IMAGE_MODELS: ImageModel[] = [
  // â”€â”€ Google Nano Banana â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "nano-banana-2.1",
    label: "Nano Banana 2.1",
    sublabel: "Sharper text, steadier characters, clean panoramas",
    badge: "NEW",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["nano-banana-2.1"],
    inputType: "text-to-image",
    aspectRatios: GEMINI_FLASH_IMAGE_ASPECT_RATIOS,
    maxImages: 4,
    maxRefImages: 14,
    imageInputField: "image_input",
    qualityParam: ["1K", "2K", "4K"],
    creditCost: 2.0,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    sublabel: "Balanced quality, speed, and cost",
    badge: "DEFAULT",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["nano-banana-2"],
    inputType: "text-to-image",
    aspectRatios: GEMINI_FLASH_IMAGE_ASPECT_RATIOS,
    maxImages: 4,
    maxRefImages: 14,
    imageInputField: "image_input",
    qualityParam: ["512px", "1K", "2K", "4K"],
    creditCost: 2.0,
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    sublabel: "Professional 4K asset production",
    badge: "PRO",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["nano-banana-pro"],
    inputType: "text-to-image",
    aspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
    maxImages: 4,
    maxRefImages: 14,
    imageInputField: "image_input",
    qualityParam: ["1K", "2K", "4K"],
    creditCost: 2.0,
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    sublabel: "Ultra Fast Â· Cost-efficient",
    badge: "NEW",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["nano-banana-2-lite"],
    inputType: "text-to-image",
    aspectRatios: GEMINI_FLASH_LITE_IMAGE_ASPECT_RATIOS,
    maxImages: 4,
    maxRefImages: 14,
    imageInputField: "image_input",
    qualityParam: ["1K"],
    creditCost: 1.0,
  },
  {
    id: "google/nano-banana",
    label: "Nano Banana",
    sublabel: "Google Â· Standard",
    badge: "",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["google/nano-banana"],
    inputType: "text-to-image",
    aspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
    maxImages: 4,
    maxRefImages: 3,
    imageInputField: "image_input",
    creditCost: 1.0,
  },
  {
    id: "google/nano-banana-edit",
    label: "Nano Banana Edit",
    sublabel: "Google Â· In-painting",
    badge: "",
    group: "Nano Banana",
    upstreamModelId: GOOGLE_IMAGE_UPSTREAM_MODEL_MAP["google/nano-banana-edit"],
    inputType: "edit",
    aspectRatios: [],
    maxImages: 1,
    maxRefImages: 3,
    imageInputField: "image_urls",
    creditCost: 1.0,
  },
  // â”€â”€ Google Imagen 4 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "google/imagen4-fast",
    label: "Google Imagen 4 Fast",
    sublabel: "Speed-optimized",
    badge: "",
    group: "Google Imagen",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "16:9", "9:16", "3:4", "4:3"],
    maxImages: 4,
    maxRefImages: 0,
    creditCost: 1.0,
  },
  {
    id: "google/imagen4",
    label: "Google Imagen 4",
    sublabel: "High-fidelity output",
    badge: "",
    group: "Google Imagen",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "16:9", "9:16", "3:4", "4:3"],
    maxImages: 1,
    maxRefImages: 0,
    creditCost: 1.0,
  },
  {
    id: "google/imagen4-ultra",
    label: "Google Imagen 4 Ultra",
    sublabel: "Maximum quality",
    badge: "TOP",
    group: "Google Imagen",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "16:9", "9:16", "3:4", "4:3"],
    maxImages: 1,
    maxRefImages: 0,
    creditCost: 1.0,
  },
  // â”€â”€ Seedream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "seedream/4.5-text-to-image",
    label: "Seedream 4.5 T2I",
    sublabel: "Text to image",
    badge: "",
    group: "Seedream",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    maxImages: 4,
    maxRefImages: 0,
    qualityParam: ["basic", "high"],
    creditCost: 1.0,
  },
  {
    id: "seedream/4.5-edit",
    label: "Seedream 4.5 Edit",
    sublabel: "Image editing",
    badge: "",
    group: "Seedream",
    inputType: "edit",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    maxImages: 1,
    maxRefImages: 10,
    imageInputField: "images",
    qualityParam: ["basic", "high"],
    creditCost: 1.0,
  },
  {
    id: "seedream/5-lite-text-to-image",
    label: "Seedream 5 Lite T2I",
    sublabel: "Text to image",
    badge: "NEW",
    group: "Seedream",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    maxImages: 4,
    maxRefImages: 0,
    qualityParam: ["basic", "high"],
    creditCost: 1.0,
  },
  {
    id: "seedream/5-lite-image-to-image",
    label: "Seedream 5 Lite I2I",
    sublabel: "Image to image",
    badge: "NEW",
    group: "Seedream",
    inputType: "image-to-image",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    maxImages: 4,
    maxRefImages: 10,
    imageInputField: "images",
    qualityParam: ["basic", "high"],
    creditCost: 1.0,
  },
  // Seedream 5.0 Lite — one smart wrapper (WaveSpeed direct).
  // The server routes to the correct endpoint based on runtime state:
  //   • no refs + 1 image  → bytedance/seedream-v5.0-lite            (base T2I)
  //   • no refs + N images → bytedance/seedream-v5.0-lite/sequential (multi T2I, identity lock)
  //   • refs   + 1 image   → bytedance/seedream-v5.0-lite/edit       (single-image edit)
  //   • refs   + N images  → bytedance/seedream-v5.0-lite/edit-sequential (multi edit, identity lock)
  // One entry in the UI, four capabilities behind — mirrors the seedream/5-pro pattern.
  {
    id: "seedream/5-lite",
    label: "Seedream 5.0 Lite",
    sublabel: "Fast · up to 15 images · edits with refs",
    badge: "NEW",
    group: "Seedream",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    maxImages: 15,
    maxRefImages: 10,
    imageInputField: "images",
    qualityParam: ["2K", "4K"],
    seedreamLiteSize: true,
    creditCost: 1.5,
  },
  // Seedream 5.0 Pro — one smart wrapper. The server routes at runtime:
  //   • no refs → bytedance/seedream-v5.0-pro       (base T2I)
  //   • refs   → bytedance/seedream-v5.0-pro/edit   (up to 10 references, identity/style guidance)
  // The T2I/I2I split entries (seedream/5-pro-text-to-image / -image-to-image) still resolve
  // server-side for backward compatibility with any persisted generations, but are hidden
  // from the UI catalog — the user picks Seedream 5.0 Pro once and it does the right thing.
  {
    id: "seedream/5-pro",
    label: "Seedream 5.0 Pro",
    sublabel: "Pro-quality · auto-edits with refs",
    badge: "PRO",
    group: "Seedream",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2"],
    maxImages: 1,
    maxRefImages: 10,
    imageInputField: "images",
    qualityParam: ["1K", "2K"],
    creditCost: 1.0,
  },
  // â”€â”€ Z-Image â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "z-image",
    label: "Z-Image",
    sublabel: "Consistent Â· Sharp",
    badge: "",
    group: "Other",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    maxImages: 4,
    maxRefImages: 1,
    imageInputField: "image",
    creditCost: 1.0,
  },
  // â”€â”€ Qwen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "qwen2/text-to-image",
    label: "Qwen Image T2I",
    sublabel: "Text to image",
    badge: "NEW",
    group: "Qwen",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    maxImages: 4,
    maxRefImages: 0,
    creditCost: 1.0,
  },
  {
    id: "qwen2/image-edit",
    label: "Qwen2 Image Edit",
    sublabel: "Image editing",
    badge: "NEW",
    group: "Qwen",
    inputType: "edit",
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
    maxImages: 1,
    maxRefImages: 3,
    imageInputField: "images",
    creditCost: 1.0,
  },
  {
    id: "qwen/image-to-image",
    label: "Qwen Image I2I",
    sublabel: "Image to image",
    badge: "NEW",
    group: "Qwen",
    inputType: "image-to-image",
    aspectRatios: [],
    maxImages: 1,
    maxRefImages: 1,
    imageInputField: "image",
    creditCost: 1.0,
  },
  // â”€â”€ Grok Imagine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "grok-imagine/text-to-image",
    label: "Grok Imagine",
    sublabel: "Creative Â· Open",
    badge: "",
    group: "Other",
    inputType: "text-to-image",
    aspectRatios: ["2:3", "3:2", "1:1", "16:9", "9:16"],
    maxImages: 4,
    maxRefImages: 0,
    // Speed (false) vs Quality (true) maps to enable_pro.
    qualityParam: ["speed", "quality"],
    grokProToggle: true,
    creditCost: 1.0,
  },
  {
    id: "grok-imagine/image-to-image",
    label: "Grok Imagine I2I",
    sublabel: "Image to image",
    badge: "NEW",
    group: "Other",
    inputType: "image-to-image",
    aspectRatios: [],
    maxImages: 4,
    // WaveSpeed Grok Image Quality Edit accepts one input image.
    maxRefImages: 1,
    imageInputField: "image",
    creditCost: 1.0,
  },
  // â”€â”€ GPT Image â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GPT Image 2.6 — WaveSpeed openai/gpt-image-2.6-{flare,sunburst}/{text-to-image,edit}.
  // Flare = fast everyday iteration; Sunburst = extra fidelity on intricate detail.
  {
    id: "gpt-image-2.6-flare-text-to-image",
    label: "GPT Image 2.6",
    sublabel: "OpenAI fast text-to-image, up to 4K",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    complexityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.6-flare-image-to-image",
    label: "GPT Image 2.6 Edit",
    sublabel: "OpenAI fast editing, up to 16 references",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    complexityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.6-sunburst-text-to-image",
    label: "GPT Image 2.6 Sunburst",
    sublabel: "OpenAI max-fidelity render for fine detail",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    complexityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.6-sunburst-image-to-image",
    label: "GPT Image 2.6 Sunburst Edit",
    sublabel: "OpenAI max-fidelity editing for fine detail",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    complexityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.5-flare-text-to-image",
    label: "GPT Image 2.5",
    sublabel: "Official OpenAI text-to-image",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.5-flare-image-to-image",
    label: "GPT Image 2.5 Edit",
    sublabel: "Official OpenAI image editing",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.5-sunburst-text-to-image",
    label: "GPT Image 2.5 Sunburst",
    sublabel: "OpenAI high-effort render — slower",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2.5-sunburst-image-to-image",
    label: "GPT Image 2.5 Sunburst Edit",
    sublabel: "OpenAI high-effort editing — slower",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high", "xhigh", "max"],
    resolutions: ["1k", "2k", "4k"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2-text-to-image",
    label: "GPT Image 2",
    sublabel: "Official OpenAI text-to-image",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image-2-image-to-image",
    label: "GPT Image 2 Edit",
    sublabel: "Official OpenAI image editing",
    badge: "NEW",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "images",
    qualityParam: ["low", "medium", "high"],
    creditCost: 2.0,
  },
  {
    id: "gpt-image/1.5-text-to-image",
    label: "GPT Image 1.5",
    sublabel: "OpenAI text-to-image",
    badge: "",
    group: "OpenAI Images",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "2:3", "3:2"],
    maxImages: 1,
    maxRefImages: 0,
    qualityParam: ["medium", "high"],
    creditCost: 1.0,
  },
  {
    id: "gpt-image/1.5-image-to-image",
    label: "GPT Image 1.5 Edit",
    sublabel: "OpenAI image editing",
    badge: "",
    group: "OpenAI Images",
    inputType: "image-to-image",
    aspectRatios: ["1:1", "2:3", "3:2"],
    maxImages: 1,
    maxRefImages: 16,
    imageInputField: "input_urls",
    qualityParam: ["medium", "high"],
    creditCost: 1.0,
  },
  // â”€â”€ Wan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "wan/2-7-image-pro",
    label: "Wan 2.7 Image Pro",
    sublabel: "Generate & Edit",
    badge: "NEW",
    group: "Wan",
    inputType: "text-to-image",
    aspectRatios: ["1:1", "16:9", "4:3", "21:9", "3:4", "9:16", "8:1", "1:8"],
    // n: 1-4 default; 1-12 when enable_sequential. UI bumps to 12 when sequential mode is on.
    maxImages: 12,
    maxRefImages: 3,
    imageInputField: "images",
    qualityParam: ["1K", "2K", "4K"],
    wanSequentialMode: true,
    creditCost: 1.0,
  },
  // â”€â”€ FLUX.2 (public tiers; server resolves T2I/I2I variants privately) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id: "flux-2/pro",
    label: "FLUX.2 Pro",
    sublabel: "Speed-optimized detail",
    badge: "",
    group: "Flux-2",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"],
    maxImages: 4,
    maxRefImages: 3,
    imageInputField: "images",
    qualityParam: ["1K", "2K"],
    creditCost: 1.0,
  },
  {
    id: "flux-2/flex",
    label: "FLUX.2 Flex",
    sublabel: "Next-gen image generation",
    badge: "",
    group: "Flux-2",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"],
    maxImages: 4,
    maxRefImages: 3,
    imageInputField: "images",
    qualityParam: ["1K"],
    creditCost: 1.0,
  },
  {
    id: "flux-2/max",
    label: "FLUX.2 Max",
    sublabel: "Ultimate precision and speed",
    badge: "",
    group: "Flux-2",
    inputType: "text-to-image",
    aspectRatios: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"],
    maxImages: 4,
    maxRefImages: 3,
    imageInputField: "images",
    qualityParam: ["2K"],
    creditCost: 1.0,
  },
];
