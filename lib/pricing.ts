/**
 * lib/pricing.ts â€” Server-only pricing bridge
 *
 * Single source of truth for all generation credit costs.
 * Loads PricingModel[] from DEFAULT_MODELS (with 60-second in-memory cache).
 * Once the DB table is wired, replace the stub in loadModels() below.
 *
 * All generation routes call getGenerationCost() instead of the
 * hardcoded functions in credit-pricing.ts.
 */

import { DEFAULT_MODELS, KIE_PACKAGES, applyPricingFloor, calcUserCredits, type PricingModel } from "@/lib/pricing-models";
import prismadb from "@/lib/prismadb";
import { isGoogleVideoRoute, normalizeGoogleVideoOptions } from "@/lib/video-model-registry";
import { resolveCanonicalProviderTariff, type ProviderCostEstimateInput, type TariffProvenanceRecord } from "@/lib/provider-tariff-registry";
import type { DynamicVideoModel } from "@/lib/dynamic-model-loader";

// â”€â”€â”€ In-memory cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _cachedModels: PricingModel[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000;
const SEEDANCE_20_TURBO_CREDITS_PER_USD = 40;
const SEEDANCE_20_TURBO_MARGIN_MULTIPLIER = 1.4;
const SEEDANCE_20_TURBO_USD_PER_15S: Record<"720p" | "1080p", number> = {
  "720p": 2.10,
  "1080p": 2.16,
};

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

function sanitizePricingModel(input: Partial<PricingModel>): PricingModel {
  const safeId = String(input.id ?? "").trim();
  const safeName = String((input.name ?? safeId) || "unknown-model").trim();
  const provider = input.provider === "wavespeed" ? "wavespeed" : "kie";
  const billing = input.billing === "per_sec" ? "per_sec" : "flat";
  const maxDurationRaw = Number(input.maxDuration);
  const maxDuration = Number.isFinite(maxDurationRaw) && maxDurationRaw > 0 ? maxDurationRaw : null;

  return {
    id: safeId,
    name: safeName,
    notes: String(input.notes ?? ""),
    type: (input.type as PricingModel["type"]) || "image",
    provider,
    billing,
    kieCredits: Number.isFinite(Number(input.kieCredits)) ? Number(input.kieCredits) : 0,
    waveUsd: Number.isFinite(Number(input.waveUsd)) ? Number(input.waveUsd) : 0,
    userCreditsRate: Number.isFinite(Number(input.userCreditsRate)) ? Number(input.userCreditsRate) : 0,
    maxDuration,
    isActive: input.isActive !== false,
  };
}

export function resolveConstitutionId(modelRef: string, models: PricingModel[]): string {
  const direct = MODEL_ALIAS_MAP[modelRef];
  if (direct) return direct;

  const exact = models.find((m) => m.id === modelRef);
  if (exact) return exact.id;

  const normalizedRef = normalizeKey(modelRef);
  if (!normalizedRef) return modelRef;

  const normalizedExact = models.find((m) => normalizeKey(m.id) === normalizedRef);
  if (normalizedExact) return normalizedExact.id;

  // Heuristic fallback for small naming variations in provider/model routes.
  const candidates = models
    .map((m) => {
      const nk = normalizeKey(m.id);
      const score =
        nk && (normalizedRef.includes(nk) || nk.includes(normalizedRef))
          ? Math.min(nk.length, normalizedRef.length)
          : 0;
      return { id: m.id, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length) return candidates[0].id;
  return modelRef;
}

/**
 * Load constitution models from DB (falls back to DEFAULT_MODELS if DB unavailable).
 */
export async function loadModels(): Promise<PricingModel[]> {
  const now = Date.now();
  if (_cachedModels && now - _cacheTime < CACHE_TTL_MS) return _cachedModels;

  try {
    const rows = await prismadb.pricingConstitution.findMany();
    if (rows.length > 0) {
      // Merge: DB rows override defaults, but keep defaults for any missing models
      const dbModels = (rows as unknown as Array<Partial<PricingModel>>)
        .map((row) => sanitizePricingModel(row))
        .map((row) => applyPricingFloor(row))
        .filter((row) => Boolean(row.id));
      const dbIds = new Set(dbModels.map((m) => m.id));
      const merged = [...dbModels, ...DEFAULT_MODELS.filter((d) => !dbIds.has(d.id))];
      _cachedModels = merged;
      _cacheTime = now;
      return merged;
    }
  } catch {
    // DB unavailable â€” fall back to defaults
  }

  _cachedModels = DEFAULT_MODELS;
  _cacheTime = now;
  return DEFAULT_MODELS;
}

/** Call after the admin saves the constitution to pick up changes immediately. */
export function invalidatePricingCache(): void {
  _cachedModels = null;
  _cacheTime = 0;
}

// â”€â”€â”€ Model alias map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps the model IDs used by generation routes â†’ constitution model IDs.
// Convention: if a route uses "modelId.mode" (like 3D), use that combined key.

const MODEL_ALIAS_MAP: Record<string, string> = {
  // â”€â”€ Video â€” app/api/generate/video (WaveSpeed route model IDs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "minimax/h3/text-to-video":                       "minimax_h3",
  "minimax/h3/image-to-video":                      "minimax_h3",
  "minimax/h3/reference-to-video":                  "minimax_h3",
  "wavespeed-ai/minimax-h3/text-to-video":          "minimax_h3_max",
  "wavespeed-ai/minimax-h3/image-to-video":         "minimax_h3_max",
  "wavespeed-ai/minimax-h3/reference-to-video":     "minimax_h3_max",
  "kling-3.0/video":                              "kling30",
  "kling-3.0/motion-control":                     "kling30_mc",
  "kling/v2-5-turbo-text-to-video-pro":           "kling25t",
  "kling/v2-5-turbo-image-to-video-pro":          "kling25t",
  "kling/v3-turbo-text-to-video":                 "kling_v3_turbo",
  "kling/v3-turbo-image-to-video":                "kling_v3_turbo",
  "kling/v3-turbo":                               "kling_v3_turbo",
  "kwaivgi/kling-v3-turbo-std/image-to-video":    "kling_v3_turbo",
  "kwaivgi/kling-v3-turbo-pro/image-to-video":    "kling_v3_turbo",
  "kwaivgi/kling-video-o3-std/text-to-video":     "kling30",
  "kwaivgi/kling-video-o3-std/image-to-video":    "kling30",
  "kwaivgi/kling-video-o3-std/reference-to-video": "kling30",
  "kwaivgi/kling-video-o3-pro/text-to-video":     "kling30",
  "kwaivgi/kling-video-o3-pro/image-to-video":    "kling30",
  "kwaivgi/kling-video-o3-pro/reference-to-video": "kling30",
  "kwaivgi/kling-video-o3-4k/text-to-video":      "kling30",
  "kwaivgi/kling-video-o3-4k/image-to-video":     "kling30",
  "kwaivgi/kling-video-o3-4k/reference-to-video": "kling30",
  "kwaivgi/kling-v2.6-std/text-to-video":         "kling26",
  "kwaivgi/kling-v2.6-std/image-to-video":        "kling26",
  "kwaivgi/kling-v2.6-pro/text-to-video":         "kling26",
  "kwaivgi/kling-v2.6-pro/image-to-video":        "kling26",
  "hailuo/2-3-image-to-video-pro":                "hailuo23",
  "hailuo/2-3-image-to-video-standard":           "hailuo23f",
  "hailuo/02-text-to-video-pro":                  "hailuo23",
  "hailuo/02-image-to-video-pro":                 "hailuo23",
  "hailuo/02-text-to-video-standard":             "hailuo23f",
  "sora-2-text-to-video":                         "sora2",
  "sora-2-image-to-video":                        "sora2_i2v",
  "sora-2-pro-text-to-video":                     "sora2_pro",
  "sora-2-pro-image-to-video":                    "sora2_pro",
  "runwayml/gen4-aleph":                          "kling25t",
  "runwayml/gen4-turbo":                          "kling25t",
  "bytedance/seedance-2":                         "seedance2",
  "bytedance/seedance-2.0/text-to-video":         "seedance2",
  "bytedance/seedance-2.0/image-to-video":        "seedance2",
  "bytedance/seedance-2-fast":                    "seedance2f",
  "bytedance/seedance-2-mini":                    "seedance2mini_t2v",
  "bytedance/seedance-2.0/text-to-video-turbo":   "seedance2turbo",
  "bytedance/seedance-2.0/image-to-video-turbo":  "seedance2turbo",
  "bytedance/seedance-2.0-fast/text-to-video":    "seedance2fast",
  "bytedance/seedance-2.0-fast/image-to-video":   "seedance2fast",
  "bytedance/seedance-2.0-fast/video-extend":     "seedance2fast",
  "bytedance/seedance-2.0-mini/text-to-video":    "seedance2mini_t2v",
  "bytedance/seedance-2.0-mini/video-edit":       "seedance2mini_t2v",
  "bytedance/seedance-2.0-mini/image-to-video":   "seedance2mini_i2v",
  "bytedance/seedance-2.0-mini/image-to-video-spicy": "seedance2mini_i2v",
  "bytedance/seedance-2.0-mini/video-extend":     "seedance2mini_i2v",
  "bytedance/seedance-2.0-mini/text-to-video-turbo": "seedance2mini_turbo",
  "bytedance/seedance-2.0-mini/image-to-video-turbo": "seedance2mini_turbo",
  "bytedance/seedance-2.0-mini/video-edit-turbo": "seedance2mini_turbo",
  "bytedance/seedance-v2/text-to-video-fast":     "seedance2f",
  "bytedance/seedance-v2/text-to-video-mini":     "seedance2mini_t2v",
  "bytedance/seedance-v2/text-to-video":          "seedance2",
  "bytedance/seedance-1.5-pro":                   "seedance2f",
  "bytedance/v1-pro-fast-image-to-video":         "seedance2f",
  "bytedance/v1-pro-image-to-video":              "seedance2f",
  "bytedance/v1-pro-text-to-video":               "seedance2f",
  "bytedance/v1-lite-image-to-video":             "seedance2f",
  "bytedance/v1-lite-text-to-video":              "seedance2f",
  "grok-imagine/text-to-video":                   "grok_vid",
  "grok-imagine/image-to-video":                  "grok_vid",

  // â”€â”€ Cinema â€” app/api/video (KIE model routes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "kwaivgi/kling-v3.0-std/text-to-video":         "kling30",
  "kwaivgi/kling-v3.0-pro/text-to-video":         "kling30",
  "kwaivgi/kling-v3.0-std/image-to-video":        "kling30",
  "kwaivgi/kling-v3.0-pro/image-to-video":        "kling30",
  // Kling 3.0 Omni / Omni Edit routes removed â€” KIE has no Omni endpoint.
  "minimax-h3":                                   "minimax_h3",
  "minimax-h3-max":                               "minimax_h3_max",
  "minimax-hailuo-02-pro":                        "hailuo02",
  "minimax-hailuo-02-standard":                   "hailuo02_std",
  "minimax-hailuo-02-fast":                       "hailuo02_fast",
  "minimax-hailuo-2.3-pro":                       "hailuo23",
  "minimax-hailuo-2.3-fast":                      "hailuo23f",
  "minimax-hailuo-2.3":                           "hailuo23",
  "minimax-hailuo-02":                            "hailuo02",
  "minimax/hailuo-02/pro":                        "hailuo02",
  "minimax/hailuo-02/standard":                   "hailuo02_std",
  "minimax/hailuo-02/fast":                       "hailuo02_fast",
  "minimax/hailuo-02/i2v-pro":                    "hailuo02",
  "minimax/hailuo-02/i2v-standard":               "hailuo02_std",
  "minimax/hailuo-02/t2v-pro":                    "hailuo02",
  "minimax/hailuo-02/t2v-standard":               "hailuo02_std",
  "minimax/hailuo-2.3/t2v-pro":                   "hailuo23",
  "minimax/hailuo-2.3/t2v-standard":              "hailuo23f",
  "minimax/hailuo-2.3/i2v-standard":              "hailuo23f",
  "minimax/hailuo-2.3/i2v-pro":                   "hailuo23",
  "minimax/hailuo-2.3/fast":                      "hailuo23f",
  "minimax/hailuo-2.3/fast-pro":                  "hailuo23_fast_pro",
  "openai/sora-2/text-to-video":                  "sora2",
  "openai/sora-2/image-to-video":                 "sora2_i2v",
  "openai/sora-2/text-to-video-pro":              "sora2_pro",
  "openai/sora-2-pro/text-to-video":              "sora2_pro",
  "openai/sora-2-pro/text-to-video-pro":          "sora2_pro",
  "google/veo3.1-lite-text-to-video":             "veo31_lite",
  "google/veo3.1-fast-text-to-video":             "veo31_fast",
  "google/veo3.1-text-to-video":                  "veo31",
  "google/veo-3.1-generate-preview":              "veo31",
  "google/veo3-fast-text-to-video":                "veo3_fast",
  "google/veo3-text-to-video":                     "veo3",
  "google/gemini-omni-video":                     "gemini_omni_video",
  "google/gemini-omni-flash":                     "gemini_omni_flash",
  "bytedance/dreamina-v3.0/text-to-video-720p":   "seedance2",
  "x-ai/grok-imagine-video/text-to-video":        "grok_vid",
  "x-ai/grok-imagine-video/edit-video":           "grok_vid",
  "black-forest-labs/flux-3/text-to-video":        "flux3_video",
  "black-forest-labs/flux-3/image-to-video":       "flux3_video",
  "black-forest-labs/flux-3/start-end-to-video":   "flux3_video",
  "black-forest-labs/flux-3/video-extend":         "flux3_video_extend",
  "black-forest-labs/flux-3-text-to-video":        "flux3_video",
  "black-forest-labs/flux-3-image-to-video":       "flux3_video",
  "black-forest-labs/flux-3-start-end-to-video":   "flux3_video",
  "black-forest-labs/flux-3-video-extend":         "flux3_video_extend",
  "black-forest-labs/flux-3/text-to-video-draft":  "flux3_video_draft",
  "black-forest-labs/flux-3/image-to-video-draft": "flux3_video_draft",
  "black-forest-labs/flux-3/start-end-to-video-draft": "flux3_video_draft",
  "black-forest-labs/flux-3/video-extend-draft":   "flux3_video_draft",

  // â”€â”€ 3D â€” app/api/3d (endpointKey = modelId.mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "tripo3d-2.5.image":        "tripo25",
  "tripo3d-2.5.multiview":    "tripo25",
  "hunyuan3d-3.1.text":       "hunya31",
  "hunyuan3d-3.1.image":      "hunya31",
  "hunyuan3d-3.text":         "hunya3",
  "hunyuan3d-3.image":        "hunya3",
  "hunyuan3d-3.sketch":       "hunya3",
  "meshy-6.text":             "meshy6",
  "meshy-6.image":            "meshy6",
  "hyper3d-rodin-2.text":     "hyper3d_rodin_2",
  "hyper3d-rodin-2.image":    "hyper3d_rodin_2",

  // â”€â”€ Music â€” app/api/music â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "wavespeed-ai/ace-step-1.5":              "music_gen",
  "wavespeed-ai/song-generation":           "music_gen",
  "wavespeed-ai/ace-step":                  "music_gen",
  "wavespeed-ai/heartmula-generate-music":  "music_gen",
  "minimax/music-2.5":                      "music_gen",
  "minimax/music-02":                       "music_gen",
  "minimax/music-v1.5":                     "music_gen",
  "google/lyria-3":                          "music_gen",
  "google/lyria-3-clip/music":               "music_gen",
  "google/lyria-3-pro/music":                "music_gen",
  "elevenlabs/music":                       "music_gen",
  "elevenlabs/elevenlabs-music":            "music_gen",

  // â”€â”€ Direct audio model routes â€” app/api/generate/audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "elevenlabs/multilingual-v2":              "el_v2",
  "elevenlabs/text-to-speech-multilingual-v2":"el_v2",
  "elevenlabs/text-to-dialogue-v3":          "voice_gen",
  "elevenlabs/sound-effect-v2":              "sfx",
  "elevenlabs/speech-to-text":               "voice_gen",
  "elevenlabs/audio-isolation":              "voice_chg",
  "elevenlabs/eleven-v3":                    "el_v3",
  "wavespeed-ai/mmaudio-v2":                 "sfx",
  "elevenlabs/voice-changer":                "voice_chg",
  "elevenlabs/dubbing":                      "dubbing",
  "sync/lipsync-3":                          "lipsync",
  "infinitalk/from-audio":                   "lipsync",
  "kling/ai-avatar-pro":                     "lipsync",
  "kling/ai-avatar-standard":                "lipsync",
  "minimax/voice-clone":                     "voice_clone",

  // â”€â”€ Audio actions â€” app/api/generate/audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "audio:tts":           "el_v2",
  "audio:video2audio":   "sfx",
  "audio:music":         "music_gen",
  "audio:speech-to-text": "voice_gen",
  "audio:audio-isolation":"voice_chg",
  "audio:voice-changer": "voice_chg",
  "audio:dubbing":       "dubbing",
  "audio:lip-sync":      "lipsync",
  "audio:voice-cloning": "voice_clone",

  // â”€â”€ Image models â€” app/api/generate/image (IMAGE_MODELS catalog IDs) â”€â”€â”€â”€â”€
  "nano-banana-pro":                    "nano_pro",
  "nano-banana-2":                      "nano2",
  "nano-banana-2.1":                    "nano21",
  "gemini-nano-banana-2.1":             "nano21",
  "nano-banana-2-lite":                 "nano2_lite",
  "google/nano-banana":                 "nano",
  "google/nano-banana-edit":            "nano_edit",
  "google/imagen4-fast":                "imagen4f",
  "google/imagen4":                     "imagen4",
  "google/imagen4-ultra":               "imagen4u",
  "seedream/4.5-text-to-image":         "seedream45",
  "seedream/4.5-edit":                  "seedream45e",
  "seedream/5-lite-text-to-image":      "seedream5l",
  "seedream/5-lite-image-to-image":     "seedream5i",
  "seedream/5-pro-text-to-image":       "seedream5p",
  "seedream/5-pro-image-to-image":      "seedream5pi",
  "seedream/5-pro":                     "seedream5p",
  "z-image":                            "zimage",
  "grok-imagine/text-to-image":         "grok_img",
  "grok-imagine/image-to-image":        "grok_imge",
  "gpt-image/1.5-text-to-image":       "gpt15t",
  "gpt-image/1.5-image-to-image":      "gpt15i",
  "gpt-image-2-text-to-image":         "gpt2t",
  "gpt-image-2-image-to-image":        "gpt2i",
  "qwen2/text-to-image":               "qwen_t",
  "qwen2/image-edit":                   "qwen_i",
  "qwen/image-to-image":               "qwen_i",
  "wan/2-7-image-pro":                  "wan_image_pro",
  "flux-2/pro-text-to-image":           "flux2_pro_t",
  "flux-2/pro-image-to-image":          "flux2_pro_i",
  "flux-2/flex-text-to-image":          "flux2_flex_t",
  "flux-2/flex-image-to-image":         "flux2_flex_i",
  "flux-2/pro":                         "flux2_pro_t",
  "flux-2/flex":                        "flux2_flex_t",
  "flux-2/max":                         "flux2_pro_t",
  "flux-2":                             "flux2_flex_t",

  // â”€â”€ Tools â€” app/api/generate/* (WaveSpeed tool routes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "tool:upscale":                       "tool_upscale",
  "tool:remove-bg":                     "tool_rmbg",
  "tool:face-swap":                     "tool_faceswap",
  "tool:watermark-remover":             "tool_watermark_remover",
  "tool:instant-character":             "tool_instant_character",
  "gemini-3-pro-image":                 "gemini_omni_character",
  "gemini-omni-character":              "gemini_omni_character",
  "tool:gemini-omni-character":         "gemini_omni_character",
  "gemini-omni-audio":                  "gemini_omni_audio",
  "gemini-3.1-flash-live-preview":      "gemini_omni_audio",
  "gemini-3.1-flash-tts-preview":       "gemini_omni_audio",
  "gemini-2.5-flash-preview-tts":       "gemini_omni_audio",
  "gemini-2.5-pro-preview-tts":         "gemini_omni_audio",
  "dall-e-3":                           "dalle3",
};

// â”€â”€â”€ Quality multipliers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Applied on top of the base per-second or flat rate for models that expose
// a quality/resolution/mode selector.  Only models using quality_param:"mode"
// (Kling, Wan, etc.) or explicit resolution tiers are affected.
// Values are intentionally modest â€” "pro" is ~50% more than "std".

// Quality / resolution multipliers applied on top of a model's base
// userCreditsRate when no per-model override is set in
// IMAGE_MODEL_QUALITY_MULTIPLIER below.
//
// Naming mirrors the strings the routes pass through (lowercased):
//   "1k", "2k", "4k"           â€” image resolution tiers
//   "480p", "720p", "1080p"    â€” video resolution tiers
//   "std", "pro"               â€” Kling generation mode
const QUALITY_MULTIPLIER: Record<string, number> = {
  // Kling std/pro mode
  "std":    1.0,
  "pro":    1.5,
  // Image resolution tiers
  "512px":  0.5,
  "1k":     1.0,
  "1024":   1.0,
  "2k":     1.5,
  "2048":   1.5,
  "4k":     3.0,
  // Video resolution tiers
  "480p":   0.8,
  "720p":   1.0,
  "768p":   1.0,
  "1080p":  1.3,
};

const USER_CREDIT_USD = 0.05;
const GOOGLE_VIDEO_MARGIN = 1.4;
/** Platform-wide: 1.4 margin x 40 credits-per-USD = 56 credits per provider dollar. */
const GOOGLE_VIDEO_CREDITS_PER_USD = 40;
type GoogleVideoBillingKey = "veo31_lite" | "veo31_fast" | "veo31" | "veo3_fast" | "veo3" | "omni_flash";
type GoogleVideoQuality = "360p" | "720p" | "1080p" | "4k";

function normalizeGoogleVideoQuality(quality: string | null | undefined): GoogleVideoQuality {
  const q = quality?.trim().toLowerCase() ?? "";
  if (q.includes("4k")) return "4k";
  if (q.includes("1080")) return "1080p";
  if (q.includes("360")) return "360p";
  return "720p";
}

function resolveGoogleVideoBillingKey(modelRef: string): GoogleVideoBillingKey | null {
  const key = (modelRef || "").trim().toLowerCase();
  if (!key) return null;
  if (key === "google/gemini-omni-flash" || key === "gemini_omni_flash") return "omni_flash";
  if (key === "google/veo3.1-lite-text-to-video" || key === "google/veo-3.1-lite-generate-preview" || key === "veo31_lite" || key === "veo31_gem_lite") return "veo31_lite";
  if (key === "google/veo3.1-fast-text-to-video" || key === "google/veo-3.1-fast-generate-preview" || key === "veo31_fast" || key === "veo31_gem_fast") return "veo31_fast";
  if (key === "google/veo3.1-text-to-video" || key === "google/veo-3.1-generate-preview" || key === "veo31" || key === "veo31_gem") return "veo31";
  if (key === "google/veo3-fast-text-to-video" || key === "veo3_fast") return "veo3_fast";
  if (key === "google/veo3-text-to-video" || key === "veo3") return "veo3";
  return null;
}

function getGoogleVideoUsdPerSecond(modelRef: string, quality: string | null | undefined): number | null {
  const billingKey = resolveGoogleVideoBillingKey(modelRef);
  if (!billingKey) return null;
  const q = normalizeGoogleVideoQuality(quality);
  if (billingKey === "omni_flash") {
    if (q === "360p") return 0.03;
    if (q === "1080p") return 0.15;
    if (q === "4k") return 0.30;
    return 0.10;
  }
  if (billingKey === "veo31_lite") return q === "1080p" || q === "4k" ? 0.08 : 0.05;
  if (billingKey === "veo31_fast" || billingKey === "veo3_fast") {
    if (q === "4k") return 0.30;
    if (q === "1080p") return 0.12;
    return 0.10;
  }
  if (billingKey === "veo31") return q === "4k" ? 0.60 : 0.40;
  if (billingKey === "veo3") return 0.40;
  return null;
}

function getGeminiOmniUserCreditsPerSecond(quality: string | null | undefined): number {
  const q = normalizeGoogleVideoQuality(quality);
  if (q === "360p") return 1.68;
  if (q === "1080p") return 8.4;
  if (q === "4k") return 16.8;
  return 5.6;
}

function getGoogleVideoCredits(modelRef: string, durationSec: number, numUnits: number, quality: string | null | undefined): number | null {
  const route = isGoogleVideoRoute(modelRef) ? modelRef : null;
  const normalized = route
    ? normalizeGoogleVideoOptions(route, { duration: durationSec, resolution: quality })
    : null;
  const billingQuality = normalized?.resolution ?? quality;
  const billingKey = resolveGoogleVideoBillingKey(modelRef);
  if (!billingKey) return null;
  const safeDuration = normalized?.duration ?? Math.max(1, Number.isFinite(durationSec) ? durationSec : 8);
  const safeUnits = Math.max(1, Math.floor(Number.isFinite(numUnits) ? numUnits : 1));

  if (billingKey === "omni_flash") {
    const credits = getGeminiOmniUserCreditsPerSecond(billingQuality) * safeDuration * safeUnits;
    return parseFloat(Math.max(1, credits).toFixed(2));
  }

  const usdPerSecond = getGoogleVideoUsdPerSecond(modelRef, billingQuality);
  if (usdPerSecond === null) return null;
  const credits = usdPerSecond * safeDuration * safeUnits * GOOGLE_VIDEO_MARGIN * GOOGLE_VIDEO_CREDITS_PER_USD;
  return parseFloat(Math.max(1, credits).toFixed(2));
}

function getGoogleVideoProviderUsd(modelRef: string, durationSec: number, quality: string | null | undefined): number | null {
  const route = isGoogleVideoRoute(modelRef) ? modelRef : null;
  const normalized = route
    ? normalizeGoogleVideoOptions(route, { duration: durationSec, resolution: quality })
    : null;
  const billingQuality = normalized?.resolution ?? quality;
  const usdPerSecond = getGoogleVideoUsdPerSecond(modelRef, billingQuality);
  if (usdPerSecond === null) return null;
  const safeDuration = normalized?.duration ?? Math.max(1, Number.isFinite(durationSec) ? durationSec : 8);
  return parseFloat((usdPerSecond * safeDuration).toFixed(4));
}
export interface GenerationCostQuote {
  modelRef: string;
  constitutionId: string;
  provider: PricingModel["provider"];
  sourceCredits: number;
  marginPercent: number;
  finalCredits: number;
  qualityMultiplier: number;
}

export interface LegacyUserChargeQuote {
  modelRef: string;
  userCredits: number;
  sourceCredits: number | null;
  marginPercent: number;
  source: "source-margin" | "user-charge-fallback" | "avatar-pro-fallback";
}

function resolveAudioMarginPercent(): number {
  const raw = process.env.CREDIT_MARGIN_PERCENT ?? process.env.AUDIO_CREDIT_MARGIN_PERCENT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 40;
  return Math.max(0, Math.min(500, parsed));
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSourceUsdPerCredit(): number {
  const envRaw = process.env.SOURCE_CREDIT_USD;
  const envVal = Number(envRaw);
  if (Number.isFinite(envVal) && envVal > 0) return envVal;
  // Use the best available provider-pack rate as a sane default source value.
  return KIE_PACKAGES.reduce((min, pkg) => Math.min(min, pkg.costPerCredit), Number.POSITIVE_INFINITY);
}

function calcSourceCredits(model: PricingModel, durationSec: number): number {
  const maxDuration = asFiniteNumber(model.maxDuration, 0);
  const effectiveDur = maxDuration > 0 ? Math.min(durationSec, maxDuration) : durationSec;

  if (model.provider === "kie") {
    const kieCredits = asFiniteNumber(model.kieCredits, 0);
    return model.billing === "per_sec"
      ? kieCredits * effectiveDur
      : kieCredits;
  }

  // WaveSpeed is billed in USD; convert to source-credit-equivalent for unified margining.
  const usdPerCredit = resolveSourceUsdPerCredit();
  const waveUsd = asFiniteNumber(model.waveUsd, 0);
  const runUsd = model.billing === "per_sec" ? waveUsd * effectiveDur : waveUsd;
  return runUsd / usdPerCredit;
}

/**
 * Returns the quality multiplier for a given resolution/mode value.
 * Defaults to 1.0 when the quality string is unrecognised.
 */
export function qualityMultiplierFor(quality: string | null | undefined): number {
  if (!quality) return 1.0;
  return QUALITY_MULTIPLIER[quality.trim().toLowerCase()] ?? 1.0;
}


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
  "768p": 0.08,
} as const;
const MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND = {
  "480p": 0.05,
  "768p": 0.10,
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

function getSeedance20MiniProviderUsd(modelRef: string, durationSec: number, quality?: string | null): number | null {
  const route = (modelRef || "").toLowerCase();
  if (
    !route.startsWith("bytedance/seedance-2.0-mini") &&
    !route.startsWith("bytedance/seedance-v2/text-to-video-mini") &&
    route !== "bytedance/seedance-2-mini" &&
    route !== "seedance2mini" &&
    route !== "seedance2mini_t2v" &&
    route !== "seedance2mini_i2v" &&
    route !== "seedance2mini_turbo" &&
    route !== "bytedance-seedance-v2-t2v-mini" &&
    route !== "bytedance-seedance-v2-mini-turbo" &&
    route !== "bytedance-seedance-v2-mini-spicy"
  ) {
    return null;
  }

  const duration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 5);
  const q = (quality || "720p").trim().toLowerCase();

  const isTurbo = route.includes("turbo") || route === "seedance2mini_turbo" || route === "bytedance-seedance-v2-mini-turbo";
  if (isTurbo) {
    if (q.includes("480") || q.includes("4k")) {
      throw new Error("Seedance 2.0 Mini Turbo only supports 720p or 1080p resolution.");
    }
    const usdPerSec = q.includes("1080")
      ? SEEDANCE_20_MINI_TURBO_USD_PER_SECOND["1080p"]
      : SEEDANCE_20_MINI_TURBO_USD_PER_SECOND["720p"];
    return parseFloat((usdPerSec * duration).toFixed(4));
  }

  const isI2V =
    route.includes("image-to-video") ||
    route.includes("video-extend") ||
    route.includes("spicy") ||
    route === "seedance2mini_i2v" ||
    route === "bytedance-seedance-v2-mini-spicy";

  const rateTable = isI2V
    ? SEEDANCE_20_MINI_I2V_USD_PER_SECOND
    : SEEDANCE_20_MINI_T2V_USD_PER_SECOND;

  const resKey: "480p" | "720p" | "1080p" | "4k" = q.includes("4k")
    ? "4k"
    : q.includes("1080")
    ? "1080p"
    : q.includes("480")
    ? "480p"
    : "720p";

  const usdPerSecond = rateTable[resKey] ?? rateTable["720p"];
  return parseFloat((usdPerSecond * duration).toFixed(4));
}

function getSeedance20MiniDefaultCredits(
  modelRef: string,
  durationSec: number,
  numUnits: number,
  quality?: string | null,
): number | null {
  const usd = getSeedance20MiniProviderUsd(modelRef, durationSec, quality);
  if (usd === null) return null;
  return parseFloat(
    Math.max(
      1,
      usd *
        SEEDANCE_20_MINI_MARGIN_MULTIPLIER *
        SEEDANCE_20_MINI_CREDITS_PER_USD *
        numUnits,
    ).toFixed(2),
  );
}

function getFlux3ProviderUsd(modelRef: string, durationSec: number, quality?: string | null): number | null {
  const route = (modelRef || "").toLowerCase();
  if (!route.startsWith("black-forest-labs/flux-3") && !route.startsWith("black-forest-labs-flux-3") && route !== "flux3_video" && route !== "flux3_video_extend" && route !== "flux3_video_draft") {
    return null;
  }
  const duration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 5);
  const q = (quality || "720p").trim().toLowerCase();
  if (route.includes("draft") || route.includes("extend")) {
    return parseFloat((FLUX_3_USD_PER_SECOND["draft"] * duration).toFixed(4));
  }
  const usdPerSecond = q.includes("1080")
    ? FLUX_3_USD_PER_SECOND["1080p"]
    : FLUX_3_USD_PER_SECOND["720p"];
  return parseFloat((usdPerSecond * duration).toFixed(4));
}

function getFlux3DefaultCredits(modelRef: string, durationSec: number, numUnits: number, quality?: string | null): number | null {
  const usd = getFlux3ProviderUsd(modelRef, durationSec, quality);
  if (usd === null) return null;
  return parseFloat(Math.max(1, usd * FLUX_3_MARGIN_MULTIPLIER * FLUX_3_CREDITS_PER_USD * numUnits).toFixed(2));
}

function getSeedance25ProviderUsd(modelRef: string, durationSec: number, quality?: string | null): number | null {
  const route = (modelRef || "").toLowerCase();
  if (!route.includes("bytedance/seedance-2.5")) return null;
  const q = (quality || "720p").trim().toLowerCase();
  const duration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 5);
  const usdPerSecond = q.includes("4k")
    ? SEEDANCE_25_USD_PER_SECOND["4k"]
    : q.includes("1080")
    ? SEEDANCE_25_USD_PER_SECOND["1080p"]
    : q.includes("480")
    ? SEEDANCE_25_USD_PER_SECOND["480p"]
    : SEEDANCE_25_USD_PER_SECOND["720p"];
  return parseFloat((usdPerSecond * duration).toFixed(4));
}

function getMinimaxH3RateKey(quality?: string | null): keyof typeof MINIMAX_H3_USD_PER_SECOND {
  const q = (quality || "2k").trim().toLowerCase();
  if (q.includes("2k") || q.includes("2 k")) return "2k";
  return "768p";
}

function getMinimaxH3MaxRateKey(quality?: string | null): keyof typeof MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND {
  const q = (quality || "480p").trim().toLowerCase();
  if (q.includes("768")) return "768p";
  return "480p";
}

function getMinimaxH3ProviderUsd(modelRef: string, durationSec: number, quality?: string | null): number | null {
  const constitutionId = MODEL_ALIAS_MAP[modelRef] ?? modelRef;
  const route = modelRef.toLowerCase();
  const duration = Math.max(constitutionId === "minimax_h3_max" || route.startsWith("wavespeed-ai/minimax-h3") ? 3 : 5, Number.isFinite(durationSec) ? durationSec : 5);
  if (constitutionId === "minimax_h3_max" || route.startsWith("wavespeed-ai/minimax-h3")) {
    const rateTable = route.includes("reference-to-video") ? MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND : MINIMAX_H3_MAX_TEXT_IMAGE_USD_PER_SECOND;
    const usdPerSecond = rateTable[getMinimaxH3MaxRateKey(quality)];
    return parseFloat((usdPerSecond * duration).toFixed(4));
  }
  if (constitutionId !== "minimax_h3" && !modelRef.startsWith("minimax/h3")) return null;
  const usdPerSecond = MINIMAX_H3_USD_PER_SECOND[getMinimaxH3RateKey(quality)];
  return parseFloat((usdPerSecond * duration).toFixed(4));
}

function getWan30ProviderUsd(modelRef: string, durationSec: number, quality?: string | null): number | null {
  const route = (modelRef || "").toLowerCase();
  if (!route.startsWith("alibaba/wan-3.0")) return null;
  const duration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 5);
  const q = (quality || "720p").trim().toLowerCase();
  const rateTable = route.includes("/image-to-video")
    ? WAN_30_IMAGE_USD_PER_SECOND
    : WAN_30_TEXT_REFERENCE_USD_PER_SECOND;
  const usdPerSecond = q.includes("1080")
    ? rateTable["1080p"]
    : q.includes("480")
    ? rateTable["480p"]
    : rateTable["720p"];
  return parseFloat((usdPerSecond * duration).toFixed(4));
}

function getMinimaxH3DefaultCredits(modelRef: string, durationSec: number, numUnits: number, quality?: string | null): number | null {
  const usd = getMinimaxH3ProviderUsd(modelRef, durationSec, quality);
  if (usd === null) return null;
  return parseFloat(Math.max(1, usd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
}

function getSeedance25DefaultCredits(modelRef: string, durationSec: number, numUnits: number, quality?: string | null): number | null {
  const usd = getSeedance25ProviderUsd(modelRef, durationSec, quality);
  if (usd === null) return null;
  return parseFloat(Math.max(1, usd * SEEDANCE_25_MARGIN_MULTIPLIER * SEEDANCE_25_CREDITS_PER_USD * numUnits).toFixed(2));
}

function getWan30DefaultCredits(modelRef: string, durationSec: number, numUnits: number, quality?: string | null): number | null {
  const usd = getWan30ProviderUsd(modelRef, durationSec, quality);
  if (usd === null) return null;
  return parseFloat(Math.max(1, usd * WAN_30_MARGIN_MULTIPLIER * WAN_30_CREDITS_PER_USD * numUnits).toFixed(2));
}
function isVeo31ModelRef(modelRef: string): boolean {
  return (
    modelRef === "google/veo3.1-lite-text-to-video" ||
    modelRef === "google/veo3.1-fast-text-to-video" ||
    modelRef === "google/veo3.1-text-to-video" ||
    modelRef === "veo31_lite" ||
    modelRef === "veo31_fast" ||
    modelRef === "veo31" ||
    modelRef === "veo31_gem_lite" ||
    modelRef === "veo31_gem_fast" ||
    modelRef === "veo31_gem" ||
    modelRef === "google/veo-3.1-generate-preview" ||
    modelRef === "google/veo3-fast-text-to-video" ||
    modelRef === "google/veo3-text-to-video" ||
    modelRef === "veo3_fast" ||
    modelRef === "veo3" ||
    modelRef === "google/gemini-omni-video" ||
    modelRef === "gemini_omni_video"
  );
}

// Per-model resolution overrides. Falls back to the global
// QUALITY_MULTIPLIER above when a model/quality combo is absent here.
//
// nano-banana-* and some image providers have provider-specific cost bumps.
const IMAGE_MODEL_QUALITY_MULTIPLIER: Record<string, Record<string, number>> = {
  "nano-banana-pro":              { "2k": 1.5, "4k": 1.875 },
  "nano_pro":                     { "2k": 1.5, "4k": 1.875 },
  "wan/2-7-image-pro":            { "2k": 1.5, "4k": 1.875 },
  "wan_image_pro":                { "2k": 1.5, "4k": 1.875 },
  "nano-banana-2":                { "512px": 0.5, "2k": 1.5, "4k": 2.25 },
  "nano-banana-2.1":              { "1k": 1.0, "2k": 0.0504 / 0.0336, "4k": 0.113 / 0.0336 },
  "nano21":                       { "1k": 1.0, "2k": 0.0504 / 0.0336, "4k": 0.113 / 0.0336 },
  "nano2":                        { "512px": 0.5, "2k": 1.5, "4k": 2.25 },
  "nano-banana-2-lite":           { "2k": 1.5, "4k": 2.25 },
  "nano2_lite":                   { "2k": 1.5, "4k": 2.25 },
  "gpt-image-2-text-to-image":    { "medium": 1.5, "high": 1.875 },
  "gpt-image-2-image-to-image":   { "medium": 1.5, "high": 1.875 },
  "gpt2t":                        { "medium": 1.5, "high": 1.875 },
  "gpt2i":                        { "medium": 1.5, "high": 1.875 },
  "google/imagen4":               { "2k": 1.5, "4k": 2.0 },
  "imagen4":                      { "2k": 1.5, "4k": 2.0 },
  "google/imagen4-ultra":         { "2k": 1.5, "4k": 2.0 },
  "imagen4u":                     { "2k": 1.5, "4k": 2.0 },
  "gemini-3-pro-image":            { "2k": 1.5, "4k": 3.0 },
  "gemini-omni-character":        { "2k": 1.5, "4k": 3.0 },
  "gemini_omni_character":        { "2k": 1.5, "4k": 3.0 },
  "seedream/5-pro":                     { "1k": 1.0, "2k": 2.0 },
  "seedream/5-pro-text-to-image":       { "1k": 1.0, "2k": 2.0 },
  "seedream/5-pro-image-to-image":      { "1k": 1.0, "2k": 2.0 },
  "seedream5p":                         { "1k": 1.0, "2k": 2.0 },
  "seedream5pi":                        { "1k": 1.0, "2k": 2.0 },
};

const VIDEO_MODEL_QUALITY_MULTIPLIER: Record<string, Record<string, number>> = {
  "bytedance/seedance-2-fast":                  { "720p": 1.0, "1080p": 2.16 / 2.10 },
  "bytedance/seedance-2.0/text-to-video-turbo": { "720p": 1.0, "1080p": 0.115 / 0.095 },
  "bytedance/seedance-2.0/image-to-video-turbo": { "720p": 1.0, "1080p": 0.115 / 0.095 },
  "bytedance/seedance-2.5/text-to-video-turbo": { "480p": 0.162 / 0.180, "720p": 1.0, "1080p": 0.240 / 0.180 },
  "bytedance/seedance-2.5/image-to-video-turbo": { "480p": 0.162 / 0.180, "720p": 1.0, "1080p": 0.240 / 0.180 },
  "bytedance/seedance-2.5/image-to-video-spicy": { "480p": 0.162 / 0.180, "720p": 1.0, "1080p": 0.240 / 0.180, "4k": 1.620 / 0.180 },
  "bytedance/seedance-2-mini":                  { "480p": 0.5, "720p": 1.0, "1080p": 151.2 / 64, "4k": 300 / 64 },
  "bytedance/seedance-2.0-mini/text-to-video":  { "480p": 0.5, "720p": 1.0, "1080p": 151.2 / 64, "4k": 300 / 64 },
  "bytedance/seedance-2.0-mini/image-to-video": { "480p": 0.5, "720p": 1.0, "1080p": 151.2 / 64, "4k": 300 / 64 },
  "bytedance/seedance-v2/text-to-video-fast":   { "720p": 1.0, "1080p": 2.16 / 2.10 },
  "bytedance/seedance-v2/text-to-video-mini":   { "480p": 0.5, "720p": 1.0, "1080p": 151.2 / 64, "4k": 300 / 64 },
  "seedance2f":                                 { "720p": 1.0, "1080p": 2.16 / 2.10 },
  "seedance2mini":                              { "480p": 0.5, "720p": 1.0, "1080p": 151.2 / 64, "4k": 300 / 64 },
  "bytedance/seedance-2":                       { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-2.0/text-to-video":       { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-2.0/image-to-video":      { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-v2/text-to-video":        { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/dreamina-v3.0/text-to-video-720p": { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "seedance2":                                  { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-2.0-fast/text-to-video":  { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-2.0-fast/image-to-video": { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "bytedance/seedance-2.0-fast/video-extend":   { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  "seedance2fast":                              { "480p": 0.5, "720p": 1.0, "1080p": 2.5, "4k": 5.0 },
  // Turbo bills $0.075/s generation plus an upscale surcharge of $0.02/s at
  // 720p or $0.04/s at 1080p, so 1080p is 0.115/0.095 of the 720p rate.
  "seedance2turbo":                             { "720p": 1.0, "1080p": 0.115 / 0.095 },
  "kwaivgi/kling-v3.0-std/text-to-video":        { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-pro/text-to-video":        { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-pro/motion-control":       { "pro": 1.0, "std": 0.75 },
  "kling-3.0/motion-control":                   { "pro": 1.0, "std": 0.75 },
  "kling30_mc":                                 { "pro": 1.0, "std": 0.75 },
  "kling-3.0/video":                            { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-pro/image-to-video":      { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-std/image-to-video":      { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-pro/video-to-video":      { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-v3.0-std/video-to-video":      { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-video-o3-std/text-to-video":     { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-video-o3-std/image-to-video":    { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-video-o3-pro/text-to-video":     { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kwaivgi/kling-video-o3-pro/image-to-video":    { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kling-video-o3":                             { "4k": 5.0, "pro": 4/3, "std": 1.0 },
  "kling-2.6/video":                            { "pro": 0.07 / 0.042, "std": 1.0 },
  "kling-2.6/image-to-video":                   { "pro": 0.07 / 0.042, "std": 1.0 },
  "kwaivgi/kling-v2.6-pro/text-to-video":       { "pro": 0.07 / 0.042, "std": 1.0 },
  "kwaivgi/kling-v2.6-pro/image-to-video":      { "pro": 0.07 / 0.042, "std": 1.0 },
  "kwaivgi/kling-v2.6-std/text-to-video":       { "pro": 0.07 / 0.042, "std": 1.0 },
  "kwaivgi/kling-v2.6-std/image-to-video":      { "pro": 0.07 / 0.042, "std": 1.0 },
  "kling26":                                    { "pro": 0.07 / 0.042, "std": 1.0 },
};

function qualityMultiplierForModel(modelRef: string, quality: string | null | undefined): number {
  const q = quality?.trim().toLowerCase() ?? "";
  if (!q) return 1.0;
  const imageMultiplier = IMAGE_MODEL_QUALITY_MULTIPLIER[modelRef]?.[q];
  if (imageMultiplier) return imageMultiplier;
  const videoMultiplier = VIDEO_MODEL_QUALITY_MULTIPLIER[modelRef]?.[q];
  if (videoMultiplier) return videoMultiplier;
  if (isVeo31ModelRef(modelRef) && q === "4k") {
    if (modelRef === "google/veo3.1-lite-text-to-video" || modelRef === "veo31_lite" || modelRef === "veo31_gem_lite") return 3.285714;
    if (modelRef === "google/veo3.1-fast-text-to-video" || modelRef === "veo31_fast" || modelRef === "veo31_gem_fast") return 3.0;
    return 1.8;
  }
  return QUALITY_MULTIPLIER[q] ?? 1.0;
}

function resolveSpecialUserCharge(
  modelRef: string,
  durationSec: number,
  numUnits: number,
  quality?: string | null,
): number | null {
  // Hyper3D Rodin 2 is a flat-billed 3D route. Keep it in the same
  // resolver used by /api/3d so a missing legacy DB row cannot turn a
  // configured UI price into a zero-credit rejection.
  if (modelRef === "hyper3d-rodin-2.text" || modelRef === "hyper3d-rodin-2.image") {
    return 40 * Math.max(1, numUnits);
  }

  const googleVideoCredits = getGoogleVideoCredits(modelRef, durationSec, numUnits, quality);
  if (googleVideoCredits !== null) return googleVideoCredits;

  const seedance25Credits = getSeedance25DefaultCredits(modelRef, durationSec, numUnits, quality);
  if (seedance25Credits !== null) return seedance25Credits;

  const seedance20MiniCredits = getSeedance20MiniDefaultCredits(modelRef, durationSec, numUnits, quality);
  if (seedance20MiniCredits !== null) return seedance20MiniCredits;

  const minimaxH3Credits = getMinimaxH3DefaultCredits(modelRef, durationSec, numUnits, quality);
  if (minimaxH3Credits !== null) return minimaxH3Credits;

  const wan30Credits = getWan30DefaultCredits(modelRef, durationSec, numUnits, quality);
  if (wan30Credits !== null) return wan30Credits;

  const flux3Credits = getFlux3DefaultCredits(modelRef, durationSec, numUnits, quality);
  if (flux3Credits !== null) return flux3Credits;

  return null;
}

function resolveModelUserCharge(
  modelRef: string,
  durationSec: number,
  numUnits: number,
  quality: string | null | undefined,
  models: PricingModel[],
): number {
  const constitutionId = resolveConstitutionId(modelRef, models);
  const model = models.find((m) => m.id === constitutionId && m.isActive);
  if (!model) return 0;

  // Custom pricing rule: All image generation models cost 2 credits for 1k/2k and 4 credits for 4k
  const isUtilityImageTool = ["tool_upscale", "tool_rmbg", "tool_faceswap", "tool_instant_character"].includes(model.id);
  if (model.type === "image" && !isUtilityImageTool) {
    const q = quality?.trim().toLowerCase() ?? "1k";
    const baseRate = q === "4k" ? 4.0 : 2.0;
    return baseRate * numUnits;
  }

  if (constitutionId === "kling30") {
    const qLower = (quality || "").toLowerCase();
    const is4k = modelRef.includes("-4k") || qLower.includes("4k");
    const isPro = modelRef.includes("-pro") || qLower.includes("pro");
    const rate = is4k ? 22.35 : isPro ? 5.96 : 4.47;
    return parseFloat((rate * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "kling30_mc") {
    const isStd = (quality || "").toLowerCase().includes("std") || modelRef.includes("-std");
    const rate = isStd ? 6.70 : 8.94;
    return parseFloat((rate * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "kling_v3_turbo") {
    const isPro = modelRef.includes("-pro") || (quality || "").toLowerCase().includes("pro");
    // Published rates: Std $0.112/s, Pro $0.14/s. 0.112 x 56 = 6.272, 0.14 x 56 = 7.84.
    const rate = isPro ? 7.84 : 6.272;
    return parseFloat((rate * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "dubbing") {
    // ElevenLabs Dubbing bills $0.01 per second of source media and trims
    // anything past 15 minutes. The constitution row says billing:"flat" at 12
    // credits, which charged the same for a 30-second clip as for a 15-minute
    // one — $0.35 of revenue against $9.00 of cost. 0.33 cr/s clears the cost
    // on the cheapest credit sold (1.21x on Max, 1.44x on Plus).
    const seconds = Math.min(900, Math.max(1, Math.ceil(Number(durationSec) || 60)));
    return parseFloat((seconds * 0.33 * numUnits).toFixed(2));
  }

  if (constitutionId === "minimax_h3_max") {
    const route = modelRef.toLowerCase();
    const duration = Math.max(3, Number.isFinite(durationSec) ? durationSec : 5);
    const rateTable = route.includes("reference-to-video") ? MINIMAX_H3_MAX_REFERENCE_USD_PER_SECOND : MINIMAX_H3_MAX_TEXT_IMAGE_USD_PER_SECOND;
    const usdPerSec = rateTable[getMinimaxH3MaxRateKey(quality)];
    return parseFloat((usdPerSec * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * duration * numUnits).toFixed(2));
  }

  if (constitutionId === "minimax_h3") {
    const duration = Math.max(5, Number.isFinite(durationSec) ? durationSec : 5);
    const usdPerSec = MINIMAX_H3_USD_PER_SECOND[getMinimaxH3RateKey(quality)];
    return parseFloat((usdPerSec * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * duration * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo02" || constitutionId === "hailuo02_pro") {
    return parseFloat((0.50 * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo02_std") {
    const usd = durationSec >= 10 ? 0.56 : 0.28;
    return parseFloat((usd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo02_fast") {
    const usd = durationSec >= 10 ? 0.15 : 0.10;
    return parseFloat((usd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo23" || constitutionId === "hailuo23_pro") {
    return parseFloat((0.49 * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo23f" || constitutionId === "hailuo23_fast") {
    const usd = durationSec >= 10 ? 0.32 : 0.19;
    return parseFloat((usd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo23_std") {
    const usd = durationSec >= 10 ? 0.56 : 0.28;
    return parseFloat((usd * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "hailuo23_fast_pro") {
    return parseFloat((0.33 * MINIMAX_H3_MARGIN_MULTIPLIER * MINIMAX_H3_CREDITS_PER_USD * numUnits).toFixed(2));
  }

  if (constitutionId === "seedance2mini_i2v") {
    const q = quality?.trim().toLowerCase() ?? "720p";
    const mappedQ = q.includes("4k") ? "4k" : q.includes("1080") ? "1080p" : q.includes("480") ? "480p" : "720p";
    const usdPerSec = SEEDANCE_20_MINI_I2V_USD_PER_SECOND[mappedQ] ?? SEEDANCE_20_MINI_I2V_USD_PER_SECOND["720p"];
    return parseFloat((usdPerSec * SEEDANCE_20_MINI_MARGIN_MULTIPLIER * SEEDANCE_20_MINI_CREDITS_PER_USD * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "seedance2mini_t2v" || constitutionId === "seedance2mini") {
    const q = quality?.trim().toLowerCase() ?? "720p";
    const mappedQ = q.includes("4k") ? "4k" : q.includes("1080") ? "1080p" : q.includes("480") ? "480p" : "720p";
    const usdPerSec = SEEDANCE_20_MINI_T2V_USD_PER_SECOND[mappedQ] ?? SEEDANCE_20_MINI_T2V_USD_PER_SECOND["720p"];
    return parseFloat((usdPerSec * SEEDANCE_20_MINI_MARGIN_MULTIPLIER * SEEDANCE_20_MINI_CREDITS_PER_USD * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "seedance2mini_turbo") {
    const q = quality?.trim().toLowerCase() ?? "720p";
    if (q.includes("480") || q.includes("4k")) {
      throw new Error("Seedance 2.0 Mini Turbo only supports 720p or 1080p resolution.");
    }
    const mappedQ = q.includes("1080") ? "1080p" : "720p";
    const usdPerSec = SEEDANCE_20_MINI_TURBO_USD_PER_SECOND[mappedQ] ?? SEEDANCE_20_MINI_TURBO_USD_PER_SECOND["720p"];
    return parseFloat((usdPerSec * SEEDANCE_20_MINI_MARGIN_MULTIPLIER * SEEDANCE_20_MINI_CREDITS_PER_USD * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "seedance2f") {
    const q = quality?.trim().toLowerCase() ?? "720p";
    const sourceUsdPer15s = q === "1080p"
      ? SEEDANCE_20_TURBO_USD_PER_15S["1080p"]
      : SEEDANCE_20_TURBO_USD_PER_15S["720p"];
    return parseFloat(((sourceUsdPer15s / 15) * SEEDANCE_20_TURBO_MARGIN_MULTIPLIER * SEEDANCE_20_TURBO_CREDITS_PER_USD * durationSec * numUnits).toFixed(2));
  }

  if (constitutionId === "seedance2") {
    const q = quality?.trim().toLowerCase() ?? "720p";
    const perSec15 = ({
      "480p": 100.8 / 15,
      "720p": 201.6 / 15,
      "1080p": 504 / 15,
      "4k": 1008 / 15,
    } as Record<string, number>)[q] ?? 201.6 / 15;
    return parseFloat((perSec15 * durationSec * numUnits).toFixed(2));
  }

  const perUnit = calcUserCredits(model, durationSec);
  const qMul = qualityMultiplierForModel(modelRef, quality);
  return parseFloat((perUnit * numUnits * qMul).toFixed(2));
}

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Returns the credits to charge a user for one generation task.
 *
 * @param modelRef   Model ID as used by the route (route alias or constitution ID).
 * @param durationSec  Duration in seconds; ignored for flat-billing models.
 * @param numUnits   Number of units (e.g. images); multiplies flat-billing cost.
 * @param quality    Optional resolution/mode string (e.g. "pro", "1080p", "std").
 * @returns  Credits to charge (0 = model not found or inactive â†’ caller should reject).
 */
export async function getGenerationCost(
  modelRef: string,
  durationSec = 5,
  numUnits = 1,
  quality?: string | null,
): Promise<number> {
  const specialCharge = resolveSpecialUserCharge(modelRef, durationSec, numUnits, quality);
  if (specialCharge !== null) return specialCharge;

  const models = await loadModels();
  return resolveModelUserCharge(modelRef, durationSec, numUnits, quality, models);
}

/**
 * Source/provider-cost-style quote from source cost + margin.
 *
 * Important: this is not the canonical user charge resolver. User-facing
 * pricing should use getGenerationCost()/getGenerationCostSync(), which
 * preserve the current subscriber charge rules and special cases.
 */
export async function getGenerationCostQuote(
  modelRef: string,
  durationSec = 5,
  numUnits = 1,
  quality?: string | null,
): Promise<GenerationCostQuote | null> {
  const googleVideoCredits = getGoogleVideoCredits(modelRef, durationSec, numUnits, quality);
  if (googleVideoCredits !== null) {
    return {
      modelRef,
      constitutionId: resolveGoogleVideoBillingKey(modelRef) ?? modelRef,
      provider: "kie",
      sourceCredits: parseFloat((googleVideoCredits / GOOGLE_VIDEO_MARGIN).toFixed(2)),
      marginPercent: 40,
      finalCredits: Math.max(1, Math.ceil(googleVideoCredits)),
      qualityMultiplier: 1,
    };
  }

  const models = await loadModels();
  const constitutionId = resolveConstitutionId(modelRef, models);
  const model = models.find((m) => m.id === constitutionId && m.isActive);
  if (!model) return null;

  const qMul = qualityMultiplierFor(quality);
  const sourcePerUnit = calcSourceCredits(model, durationSec);
  let sourceCredits = parseFloat((sourcePerUnit * numUnits * qMul).toFixed(2));
  if (!Number.isFinite(sourceCredits) || sourceCredits <= 0) {
    // Fallback to legacy user-credit computation if source-side values are incomplete.
    const legacyPerUnit = calcUserCredits(model, durationSec);
    sourceCredits = parseFloat((legacyPerUnit * numUnits * qMul).toFixed(2));
  }

  const marginPercent = resolveAudioMarginPercent();
  const finalCreditsRaw = Math.ceil(sourceCredits * (1 + marginPercent / 100));
  const finalCredits = Number.isFinite(finalCreditsRaw) ? Math.max(1, finalCreditsRaw) : 0;

  return {
    modelRef,
    constitutionId,
    provider: model.provider,
    sourceCredits,
    marginPercent,
    finalCredits,
    qualityMultiplier: qMul,
  };
}

/**
 * Preserves the historical user charge used by audio/avatar routes while moving
 * the deduction decision into the central pricing core.
 */
export async function getLegacyAudioAvatarUserCharge(
  modelRef: string,
  durationSec = 5,
  numUnits = 1,
  quality?: string | null,
  options?: { fallbackUserCredits?: number; avatarProFallbackBaseCredits?: number },
): Promise<LegacyUserChargeQuote | null> {
  const quote = await getGenerationCostQuote(modelRef, durationSec, numUnits, quality);
  if (quote && Number.isFinite(quote.finalCredits) && quote.finalCredits > 0) {
    return {
      modelRef,
      userCredits: quote.finalCredits,
      sourceCredits: quote.sourceCredits,
      marginPercent: quote.marginPercent,
      source: "source-margin",
    };
  }

  if (Number.isFinite(options?.fallbackUserCredits) && Number(options?.fallbackUserCredits) > 0) {
    return {
      modelRef,
      userCredits: Math.ceil(Number(options?.fallbackUserCredits)),
      sourceCredits: Number(options?.fallbackUserCredits),
      marginPercent: 0,
      source: "user-charge-fallback",
    };
  }

  if (Number.isFinite(options?.avatarProFallbackBaseCredits) && Number(options?.avatarProFallbackBaseCredits) > 0) {
    const legacyBaseCredits = Number(options?.avatarProFallbackBaseCredits);
    const marginPercent = 40;
    return {
      modelRef,
      userCredits: Math.max(1, Math.ceil(legacyBaseCredits * (1 + marginPercent / 100))),
      sourceCredits: legacyBaseCredits,
      marginPercent,
      source: "avatar-pro-fallback",
    };
  }

  return null;
}

/**
 * Synchronous version using the current cache (or DEFAULT_MODELS).
 * Safe to call without await; uses whatever is already in memory.
 */
export function getGenerationCostSync(
  modelRef: string,
  durationSec = 5,
  numUnits = 1,
  quality?: string | null,
): number {
  const specialCharge = resolveSpecialUserCharge(modelRef, durationSec, numUnits, quality);
  if (specialCharge !== null) return specialCharge;

  const models = _cachedModels ?? DEFAULT_MODELS;
  return resolveModelUserCharge(modelRef, durationSec, numUnits, quality, models);
}

/**
 * Estimates the provider operating cost in USD using the canonical provider tariff registry.
 *
 * Invariants:
 * 1. WaveSpeed execution -> WaveSpeed tariff ONLY (never leaks to KIE).
 * 2. Google execution -> Google tariff ONLY.
 * 3. BytePlus execution -> BytePlus tariff ONLY.
 * 4. OpenAI execution -> OpenAI tariff ONLY.
 * 5. ElevenLabs execution -> ElevenLabs tariff ONLY.
 * 6. Reap execution -> Reap tariff ONLY.
 * 7. KIE execution -> KIE Standby tariff ONLY.
 */
export function estimateProviderCostSync(
  modelRefOrInput: string | ProviderCostEstimateInput,
  durationSec = 5,
  quality?: string | null,
  numUnits = 1,
  options?: {
    providerName?: string | null;
    providerModel?: string | null;
    providerRoute?: string | null;
    resolution?: string | null;
  }
): { usd: number | null; source: "actual" | "estimated" | "unknown"; tariffKey?: string; provenance?: TariffProvenanceRecord } {
  let input: ProviderCostEstimateInput;
  if (typeof modelRefOrInput === "object" && modelRefOrInput !== null) {
    input = modelRefOrInput;
  } else {
    input = {
      modelRef: modelRefOrInput,
      durationSec,
      quality,
      numUnits,
      providerName: options?.providerName,
      providerModel: options?.providerModel,
      providerRoute: options?.providerRoute,
      resolution: options?.resolution,
    };
  }

  const result = resolveCanonicalProviderTariff(input, (ref) => {
    const models = _cachedModels ?? DEFAULT_MODELS;
    const constitutionId = resolveConstitutionId(ref, models);
    const m = models.find((item) => item.id === constitutionId && item.isActive);
    if (!m) return null;
    return { provider: m.provider, billing: m.billing, kieCredits: m.kieCredits, waveUsd: m.waveUsd };
  });

  return {
    usd: result.usd,
    source: result.source,
    tariffKey: result.tariffKey,
    provenance: result.provenance,
  };
}

/**
 * Canonical character counting for audio script text.
 * Normalizes Unicode NFC, standardizes CRLF, trims leading/trailing whitespace.
 */
export function countAudioScriptCharacters(text?: string | null): number {
  if (!text) return 0;
  return text
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .trim()
    .length;
}

/**
 * Canonical TTS character-based customer credit pricing.
 * Credits = max(1, ceil(characterCount * 0.0034))
 * Benchmark: ~1 CR per 294 chars ($0.00017 / char target value). Minimum 1 CR.
 */
export function calculateTtsCredits(textOrCount?: string | number | null, model?: string | null): number {
  const count = typeof textOrCount === "number" ? textOrCount : countAudioScriptCharacters(textOrCount);
  if (count <= 0) return 1;
  const normalizedModel = String(model || "").trim().toLowerCase();
  // WaveSpeed source rates: V4=$0.08/1k and Turbo=$0.04/1k. Apply the
  // existing 1.4 margin and 40 credits/USD conversion for these routes.
  if (normalizedModel === "elevenlabs/eleven-v4") return Math.max(1, Math.ceil(count * 0.00448));
  if (normalizedModel === "elevenlabs/eleven-v4-turbo") return Math.max(1, Math.ceil(count * 0.00224));
  return Math.max(1, Math.ceil(count * 0.0034));
}

/**
 * Canonical Music duration-based customer credit pricing.
 * Credits = max(4, ceil(2 + durationSec * 0.12))
 * Acceptance: 15s=4CR, 30s=6CR, 60s=10CR, 90s=13CR, 120s=17CR, 180s=24CR, 240s=31CR, 300s=38CR.
 */
export function calculateMusicCredits(durationSec?: number | null): number {
  const dur = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : 30;
  return Math.max(4, Math.ceil(2 + dur * 0.12));
}

/**
 * Canonical Sound Effects duration-based customer credit pricing.
 * Credits = max(2, ceil(2 + durationSec * 0.25))
 * Acceptance: 2s=3CR, 5s=4CR, 10s=5CR, 15s=6CR, 22s=8CR.
 */
export function calculateSfxCredits(durationSec?: number | null): number {
  const dur = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : 5;
  return Math.max(2, Math.ceil(2 + dur * 0.25));
}

/**
 * Compute video generation credits dynamically from model's pricingConfig (administered from Admin dashboard)
 */
export function computeCreditsFromDynamicModel(
  model: DynamicVideoModel,
  params: {
    resolution: "480p" | "720p" | "1080p" | "4k";
    outputSec: number;
    inputSec?: number;
    refVideoSecTotal?: number;
    isTurbo?: boolean;
    isExtend?: boolean;
    sourceContextSec?: number;
  }
): number {
  const cfg = model.pricingConfig;
  if (!cfg) {
    return getGenerationCostSync(model.api_route ?? model.id, params.outputSec, 1, params.resolution);
  }

  let rates: Record<string, number | undefined> | undefined;
  let mode: string = cfg.billingMode ?? "flat_output";

  if (params.isExtend && cfg.extendStickerRates) {
    rates = cfg.extendStickerRates;
    mode = cfg.extendBillingMode ?? "new_segment_only";
  } else if (params.isTurbo && cfg.turboStickerRates) {
    rates = cfg.turboStickerRates;
  } else {
    rates = cfg.stickerRates;
  }

  if (!rates || !rates[params.resolution]) {
    throw new Error(`Missing rate for ${params.resolution} on ${model.id}`);
  }

  const stickerRate = rates[params.resolution]!;
  const discount = cfg.discountMultiplier ?? 0.90;
  const creditsPerUsd = cfg.creditsPerUsd ?? 40;

  let billableSec = params.outputSec;
  if (mode === "source_plus_new_segment") {
    // 2.5 Extend: source_context clamped 2-30s + new_segment
    const source = params.sourceContextSec ?? cfg.extendDefaultSourceContextSec ?? 5;
    const clampedSource = Math.min(30, Math.max(2, source));
    billableSec = clampedSource + params.outputSec;
  } else if (mode === "input_plus_output") {
    const clampedInput = Math.min(15, Math.max(2, params.inputSec ?? params.outputSec));
    billableSec = clampedInput + params.outputSec;
  } else if (mode === "new_segment_only") {
    billableSec = params.outputSec;
  }

  const stickerUsd = stickerRate * billableSec;
  const realSourceUsd = stickerUsd * discount;
  const credits = realSourceUsd * creditsPerUsd;

  return Math.max(1, parseFloat(credits.toFixed(2)));
}
