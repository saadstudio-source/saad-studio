/**
 * WaveSpeed Video Model Registry
 *
 * All API routes map to: POST https://api.wavespeed.ai/api/v3/{api_route}
 * Polling endpoint:      GET  https://api.wavespeed.ai/api/v3/predictions/{taskId}/result
 *
 * Confirmed routes are verified against the official WaveSpeed API documentation.
 * Inferred routes follow the exact slug patterns observed in confirmed examples.
 *
 * Sources:
 *  - https://wavespeed.ai/docs/docs-api
 *  - Individual model pages (confirmed via curl examples in API Endpoints section)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelCategory =
  | "text-to-video"
  | "image-to-video"
  | "motion-control";

export type ModelBadge = "TOP" | "NEW" | "PRO" | "FAST" | "4K" | "TURBO" | "BUDGET" | "SPICY" | "50% off" | "New" | string | null;

/**
 * Capability flags derived exclusively from official docs parameter tables.
 * Only set to true when that param is documented in the model's request schema.
 */
export interface VideoModelCapabilities {
  // ── Input ─────────────────────────────────────────────────────────────────
  /** Image input is REQUIRED (I2V models) */
  requires_image: boolean;
  /** Image input is OPTIONAL (some T2V models that accept a reference) */
  optional_image: boolean;
  /** Video input is REQUIRED (motion-control models) */
  requires_video: boolean;
  /** Video input is OPTIONAL (like Gemini Omni Flash) */
  optional_video?: boolean;
  /** End-frame / last_image / end_image parameter exists */
  has_end_frame: boolean;

  // ── Output controls ───────────────────────────────────────────────────────
  /**
   * For models using aspect_ratio param (e.g. Kling, Google Veo3).
   * Empty = aspect_ratio not a controllable param.
   */
  aspect_ratios: string[];
  /**
   * For models using size param as "WxH" string (e.g. Wan 2.2, Sora 2).
   * Empty = size not a controllable param.
   */
  sizes: string[];
  /** Selectable durations in seconds. Empty = not user-configurable. */
  durations: number[];
  /** Selectable resolution labels. Empty = fixed by the model. */
  resolutions: string[];
  /** Which request key should receive the selected quality value. */
  quality_param: "resolution" | "mode";
  /** Max number of reference images supported by this model (0 = not supported). */
  max_reference_images: number;
  /** Max number of reference videos (Seedance 2). 0 = not supported. */
  max_reference_videos: number;
  /** Max combined duration (seconds) for all reference videos. 0 = no limit. */
  max_reference_video_total_seconds: number;
  /** Max number of reference audios (Seedance 2). 0 = not supported. */
  max_reference_audios: number;
  /** Max combined duration (seconds) for all reference audios. 0 = no limit. */
  max_reference_audio_total_seconds: number;

  // ── Prompt controls ───────────────────────────────────────────────────────
  has_negative_prompt: boolean;
  has_loop: boolean;
  has_seed: boolean;
  has_cfg_scale: boolean;
  /** Exact maximum character length allowed for the generation prompt by the provider API */
  max_prompt_characters?: number;

  // ── Advanced controls ─────────────────────────────────────────────────────
  /** sound / generate_audio param */
  has_sound: boolean;
  /** Which request key should receive the audio toggle value. */
  sound_param: "sound" | "generate_audio";
  /** shot_type param (Kling models) */
  has_shot_type: boolean;
  /** multi_prompt array param (Kling models) */
  has_multi_prompt: boolean;
  /** element_list array param (Kling models) */
  has_element_list: boolean;
  /** scene_control_mode toggle param (Kling motion-control) */
  has_scene_control: boolean;
  /** orientation param � "video" | "image" (Kling motion-control) */
  has_orientation: boolean;
  /** Show Elements/Frames tab switcher (Kling Omni only) */
  has_omni_tabs: boolean;
  /**
   * True when ONE request may carry reference media and start/end frames together.
   * Nearly every provider splits these across separate endpoints, so the UI makes
   * the user pick one. Gemini Omni is the documented exception: it binds roles with
   * <FIRST_FRAME> / <IMAGE_REF_n> tags inside a single interaction.
   */
  combines_references_with_frames?: boolean;
}

export interface WaveSpeedVideoModel {
  /** Unique UI key — used as React key and to identify the model in state */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider family grouping key */
  family: string;
  /** Human-readable group label for the dropdown header */
  family_label: string;
  /** Hex colour for badges and accents */
  family_color: string;
  badge: ModelBadge;
  description: string;
  /**
   * Path after /api/v3/ that identifies the model.
   * E.g. "wavespeed-ai/wan-2.2/t2v-720p"
   *      "kwaivgi/kling-v3.0-pro/text-to-video"
   *      "google/veo3"
   */
  api_route: string;
  /** Optional unified public model sub-route for text-only requests. */
  text_api_route?: string;
  /** Optional unified public model sub-route for image/start-frame requests. */
  image_api_route?: string;
  /** Optional unified public model sub-route for multimodal reference requests. */
  reference_api_route?: string;
  /** Optional unified public model sub-route for start-and-end frame requests. */
  start_end_api_route?: string;
  /** Optional unified public model sub-route for video extension / continuation requests. */
  video_api_route?: string;
  /** Optional unified public model sub-route for video editing requests. */
  edit_api_route?: string;
  capabilities: VideoModelCapabilities;
  /** Whether the API route has been verified against official docs curl examples */
  route_confirmed: boolean;
  pricingConfig?: any;
}

export type GoogleVideoRoute =
  | "google/veo3.1-lite-text-to-video"
  | "google/veo3.1-fast-text-to-video"
  | "google/veo3.1-text-to-video"
  | "google/veo-3.1-generate-preview"
  | "google/veo3-fast-text-to-video"
  | "google/veo3-text-to-video"
  | "google/gemini-omni-flash"
  | "google/gemini-omni-1.2-flash"
  | "google/gemini-omni-video";

export type GoogleVideoTier =
  | "veo31_lite"
  | "veo31_fast"
  | "veo31"
  | "veo3_fast"
  | "veo3"
  | "omni_flash";

export type GoogleVideoMode =
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "video_extend"
  | "video_edit";

export interface GoogleVideoConstraints {
  route: GoogleVideoRoute;
  tier: GoogleVideoTier;
  providerModel: string;
  aspectRatios: Array<"16:9" | "9:16">;
  durations: number[];
  resolutions: Array<"360p" | "720p" | "1080p" | "4k">;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  supportsStartImage: boolean;
  supportsEndFrame: boolean;
  supportsVideoInput: boolean;
  extensionCapable: boolean;
  outputCount: 1;
}

export interface NormalizeGoogleVideoInput {
  duration?: number | string | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  hasVideoInput?: boolean;
  hasStartImage?: boolean;
  hasEndImage?: boolean;
  previousInteractionId?: string | null;
  requestedMode?: GoogleVideoMode | string | null;
}

export interface NormalizedGoogleVideoOptions {
  route: GoogleVideoRoute;
  tier: GoogleVideoTier;
  providerModel: string;
  mode: GoogleVideoMode;
  duration: number;
  resolution: "360p" | "720p" | "1080p" | "4k";
  aspectRatio: "16:9" | "9:16";
  maxReferenceImages: number;
  maxReferenceVideos: number;
  referenceImageCount: number;
  hasVideoInput: boolean;
}

export const GOOGLE_VIDEO_CONSTRAINTS: Record<GoogleVideoRoute, GoogleVideoConstraints> = {
  "google/veo3.1-lite-text-to-video": {
    route: "google/veo3.1-lite-text-to-video",
    tier: "veo31_lite",
    providerModel: "veo-3.1-lite-generate-preview",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: false,
    extensionCapable: false,
    outputCount: 1,
  },
  "google/veo3.1-fast-text-to-video": {
    route: "google/veo3.1-fast-text-to-video",
    tier: "veo31_fast",
    providerModel: "veo-3.1-fast-generate-preview",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p", "4k"],
    maxReferenceImages: 3,
    maxReferenceVideos: 1,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
  "google/veo3.1-text-to-video": {
    route: "google/veo3.1-text-to-video",
    tier: "veo31",
    providerModel: "veo-3.1-generate-preview",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p", "4k"],
    maxReferenceImages: 3,
    maxReferenceVideos: 1,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
  "google/veo-3.1-generate-preview": {
    route: "google/veo-3.1-generate-preview",
    tier: "veo31",
    providerModel: "veo-3.1-generate-preview",
    aspectRatios: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p", "4k"],
    maxReferenceImages: 3,
    maxReferenceVideos: 1,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
  "google/veo3-fast-text-to-video": {
    route: "google/veo3-fast-text-to-video",
    tier: "veo3_fast",
    providerModel: "veo-3.0-fast-generate-001",
    aspectRatios: ["16:9", "9:16"],
    durations: [8],
    resolutions: ["720p", "1080p"],
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: false,
    extensionCapable: false,
    outputCount: 1,
  },
  "google/veo3-text-to-video": {
    route: "google/veo3-text-to-video",
    tier: "veo3",
    providerModel: "veo-3.0-generate-001",
    aspectRatios: ["16:9", "9:16"],
    durations: [8],
    resolutions: ["720p", "1080p"],
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: false,
    extensionCapable: false,
    outputCount: 1,
  },
  "google/gemini-omni-flash": {
    route: "google/gemini-omni-flash",
    tier: "omni_flash",
    providerModel: "gemini-omni-1.1-flash",
    aspectRatios: ["16:9", "9:16"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["360p", "720p", "1080p", "4k"],
    maxReferenceImages: 3,
    maxReferenceVideos: 3,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
  "google/gemini-omni-1.2-flash": {
    route: "google/gemini-omni-1.2-flash",
    tier: "omni_flash",
    providerModel: "gemini-omni-1.2-flash",
    aspectRatios: ["16:9", "9:16"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["360p", "720p", "1080p", "4k"],
    maxReferenceImages: 6,
    maxReferenceVideos: 1,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
  "google/gemini-omni-video": {
    route: "google/gemini-omni-video",
    tier: "omni_flash",
    providerModel: "gemini-omni-1.1-flash",
    aspectRatios: ["16:9", "9:16"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["360p", "720p", "1080p", "4k"],
    maxReferenceImages: 3,
    maxReferenceVideos: 3,
    supportsStartImage: true,
    supportsEndFrame: true,
    supportsVideoInput: true,
    extensionCapable: true,
    outputCount: 1,
  },
};

export function isGoogleVideoRoute(route: string | undefined | null): route is GoogleVideoRoute {
  return typeof route === "string" && route in GOOGLE_VIDEO_CONSTRAINTS;
}

export function getGoogleVideoConstraints(route: string): GoogleVideoConstraints | null {
  return isGoogleVideoRoute(route) ? GOOGLE_VIDEO_CONSTRAINTS[route] : null;
}

export function normalizeGoogleVideoOptions(route: GoogleVideoRoute, input: NormalizeGoogleVideoInput = {}): NormalizedGoogleVideoOptions {
  const constraints = GOOGLE_VIDEO_CONSTRAINTS[route];
  const referenceImageCount = Math.max(0, Math.floor(Number(input.referenceImageCount ?? 0)));
  const referenceVideoCount = Math.max(0, Math.floor(Number(input.referenceVideoCount ?? 0)));
  const hasVideoInput = input.hasVideoInput === true;
  const rawAspect = typeof input.aspectRatio === "string" ? input.aspectRatio : "";
  const aspectRatio = constraints.aspectRatios.includes(rawAspect as "16:9" | "9:16")
    ? rawAspect as "16:9" | "9:16"
    : "16:9";
  const rawResolution = typeof input.resolution === "string" ? input.resolution.toLowerCase() : "";
  let resolution: "360p" | "720p" | "1080p" | "4k" =
    rawResolution === "4k" ? "4k" :
    rawResolution === "1080p" || rawResolution === "pro" ? "1080p" :
    rawResolution === "360p" ? "360p" :
    "720p";
  if (!constraints.resolutions.includes(resolution)) {
    resolution = constraints.resolutions[0];
  }

  let mode: GoogleVideoMode = "text_to_video";
  if (hasVideoInput) {
    const requestedExtend = input.requestedMode === "video_extend" || input.requestedMode === "Video Extend" || input.requestedMode === "extend";
    mode = requestedExtend && constraints.extensionCapable
      ? "video_extend"
      : constraints.tier === "omni_flash" || input.previousInteractionId
      ? "video_edit"
      : "video_extend";
  } else if (
    (referenceImageCount > 0 && constraints.maxReferenceImages > 0) ||
    (referenceVideoCount > 0 && constraints.maxReferenceVideos > 0)
  ) {
    mode = "reference_to_video";
  } else if (input.hasStartImage || input.hasEndImage) {
    mode = "image_to_video";
  }

  if (mode === "video_extend" && constraints.tier !== "omni_flash") {
    resolution = "720p";
  }

  const rawDuration =
    typeof input.duration === "number" ? input.duration :
    typeof input.duration === "string" ? Number.parseInt(input.duration, 10) :
    NaN;
  let duration = Number.isFinite(rawDuration) ? Math.floor(rawDuration) : constraints.tier === "omni_flash" ? 5 : 8;
  if (constraints.tier === "omni_flash") {
    const omniMaxDuration = route === "google/gemini-omni-1.2-flash" && (mode === "text_to_video" || mode === "image_to_video") ? 15 : 10;
    duration = Math.max(3, Math.min(omniMaxDuration, duration));
  } else if (mode === "video_extend" || referenceImageCount > 0 || resolution === "1080p" || resolution === "4k") {
    duration = 8;
  } else if (!constraints.durations.includes(duration)) {
    duration = constraints.durations.includes(8) ? 8 : constraints.durations[0];
  }

  return {
    route,
    tier: constraints.tier,
    providerModel: constraints.providerModel,
    mode,
    duration,
    resolution,
    aspectRatio,
    maxReferenceImages: constraints.maxReferenceImages,
    maxReferenceVideos: constraints.maxReferenceVideos,
    referenceImageCount: Math.min(referenceImageCount, constraints.maxReferenceImages),
    hasVideoInput,
  };
}
// ── Capability helpers ────────────────────────────────────────────────────────

function t2vCaps(overrides: Partial<VideoModelCapabilities> = {}): VideoModelCapabilities {
  return {
    requires_image:     false,
    optional_image:     false,
    requires_video:     false,
    optional_video:     false,
    has_end_frame:      false,
    aspect_ratios:      [],
    sizes:              [],
    durations:          [],
    resolutions:        [],
    quality_param:      "resolution",
    max_reference_images: 0,
    max_reference_videos: 0,
    max_reference_video_total_seconds: 0,
    max_reference_audios: 0,
    max_reference_audio_total_seconds: 0,
    has_negative_prompt: false,
    has_loop:           false,
    has_seed:           false,
    has_cfg_scale:      false,
    has_sound:          false,
    sound_param:        "sound",
    has_shot_type:      false,
    has_multi_prompt:   false,
    has_element_list:   false,
    has_scene_control:  false,
    has_orientation:    false,
    has_omni_tabs:      false,
    combines_references_with_frames: false,
    ...overrides,
  };
}

function i2vCaps(overrides: Partial<VideoModelCapabilities> = {}): VideoModelCapabilities {
  return t2vCaps({ requires_image: true, ...overrides });
}

// ── Model Definitions ─────────────────────────────────────────────────────────

export const VIDEO_MODEL_REGISTRY: WaveSpeedVideoModel[] = [

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Kling 4.0 — WaveSpeed official five-endpoint contract
  // ║ https://wavespeed.ai/blog/ai-news/kling-4-0-is-coming-what-we-know-and-how-to-prepare-on-wavespeedai/
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "kling-v4.0",
    name: "Kling 4.0",
    family: "kling", family_label: "Kling", family_color: "#06b6d4",
    badge: "NEW",
    description: "Kling 4.0 text, image, reference, edit, and extend video with synchronized stereo audio.",
    api_route: "kwaivgi/kling-v4.0/text-to-video",
    text_api_route: "kwaivgi/kling-v4.0/text-to-video",
    image_api_route: "kwaivgi/kling-v4.0/image-to-video",
    reference_api_route: "kwaivgi/kling-v4.0/reference-to-video",
    edit_api_route: "kwaivgi/kling-v4.0/video-edit",
    video_api_route: "kwaivgi/kling-v4.0/video-extend",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "21:9"],
      resolutions: ["720p", "1080p"],
      quality_param: "resolution",
      durations: Array.from({ length: 28 }, (_, index) => index + 3),
      max_reference_images: 10,
      max_reference_videos: 5,
      max_reference_audios: 3,
      has_sound: true,
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Kling V3.0 Text/Image Smart Route
  // ║ Confirmed:
  // ║ - https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-v3.0-std-text-to-video
  // ║ - https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-v3.0-pro-text-to-video
  // ║ - https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-v3.0-std-image-to-video
  // ║ - https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-v3.0-pro-image-to-video
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "kling-v3.0-pro-t2v",
    name: "Kling 3.0",
    family: "kling", family_label: "Kling", family_color: "#06b6d4",
    badge: "NEW",
    description: "Kuaishou Kling V3.0 text/image-to-video with Standard/Pro smart route selection, optional end frame for image mode, native audio, multi-shot, and element references.",
    api_route: "kwaivgi/kling-v3.0-std/image-to-video",
    route_confirmed: true,
    capabilities: i2vCaps({
      has_end_frame:       true,
      aspect_ratios:       ["16:9", "9:16", "1:1", "4:3", "3:4"],
      resolutions:         ["Standard", "Pro"],
      quality_param:       "resolution",
      durations:           [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      has_negative_prompt: true,
      has_loop:            true,
      has_cfg_scale:       true,
      has_sound:           true,
      has_shot_type:       true,
      has_multi_prompt:    true,
      has_element_list:    true,
      max_reference_images: 2,
    }),
  },
  // NOTE: Kling 3.0 Omni / Omni Edit removed — KIE does not provide these endpoints.
  // The kwaivgi/kling-video-o3-pro/* routes were aliased to kling-3.0/video (duplicate of standard).
  // Re-add when KIE officially launches Omni 3 (O3) — see https://kie.ai/kling-3-0 FAQ.
  {
    id: "kling-video-o3",
    name: "Kling O3",
    family: "kling", family_label: "Kling", family_color: "#06b6d4",
    badge: "TOP",
    description: "Kling Video O3 with Standard/Pro/4K routing across text, image, and reference-to-video modes.",
    api_route: "kwaivgi/kling-video-o3-std/image-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image:      true,
      optional_video:      true,
      has_end_frame:       true,
      aspect_ratios:       ["16:9", "9:16", "1:1"],
      resolutions:         ["Standard", "Pro", "4K"],
      quality_param:       "resolution",
      durations:           [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      has_negative_prompt: true,
      has_loop:            true,
      has_sound:           true,
      has_shot_type:       true,
      has_multi_prompt:    true,
      has_element_list:    true,
      max_reference_images: 7,
      max_reference_videos: 1,
    }),
  },
  {
    id: "kling-v3-turbo",
    name: "Kling V3 Turbo",
    family: "kling", family_label: "Kling", family_color: "#06b6d4",
    badge: "FAST",
    description: "Kling V3 Turbo image-to-video. Standard 720P route with optional prompt or multi-shot storyboard.",
    api_route: "kwaivgi/kling-v3-turbo-std/image-to-video",
    route_confirmed: true,
    capabilities: i2vCaps({
      aspect_ratios:       ["16:9", "9:16", "1:1", "4:3", "3:4"],
      resolutions:         ["Standard", "Pro"],
      quality_param:       "resolution",
      durations:           [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      has_negative_prompt: true,
      has_loop:            true,
      has_multi_prompt:    true,
    }),
  },
  {
    id: "kling-v2.6-t2v",
    name: "Kling 2.6",
    family: "kling", family_label: "Kling", family_color: "#06b6d4",
    badge: "FAST",
    description: "Kling 2.6 text-to-video with Standard/Pro route selection.",
    api_route: "kwaivgi/kling-v2.6-std/text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image:      true,
      aspect_ratios:    ["16:9", "9:16", "1:1"],
      resolutions:      ["Standard", "Pro"],
      quality_param:    "resolution",
      durations:        [5, 10],
      has_end_frame:    true,
      has_negative_prompt: true,
      has_loop:         true,
      has_cfg_scale:    true,
      has_sound:        true,
    }),
  },
  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Minimax Hailuo Video Fleet (Verified WaveSpeed Endpoints)
  // ║ Confirmed from official WaveSpeed API documentation & playground:
  // ║ - Minimax H3 official: 768p ($0.10/s), 2K ($0.14/s), 5-15s
  // ║ - MiniMax H3 Max Open Weights: 480p/768p, 3-15s, native audio
  // ║ - Hailuo 02 Pro: 1080p, 6s ($0.49 i2v, $0.48 t2v), image + end_image
  // ║ - Hailuo 02 Standard: 768p, 6s ($0.23), 10s ($0.56), image + end_image
  // ║ - Hailuo 02 Fast: 512p, 6s ($0.10), 10s ($0.15)
  // ║ - Hailuo 2.3 Pro: 1080p, 5-6s ($0.49)
  // ║ - Hailuo 2.3 Fast: 720p, 6s ($0.19), 10s ($0.32)
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "minimax-h3",
    name: "Minimax H3",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "Minimax H3 official multimodal video generator. Supports text, image, and reference to video with end frame.",
    api_route: "minimax/h3/reference-to-video",
    text_api_route: "minimax/h3/text-to-video",
    image_api_route: "minimax/h3/image-to-video",
    reference_api_route: "minimax/h3/reference-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["768p", "2k"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_audios: 3,
      has_negative_prompt: false,
      has_loop: false,
    }),
  },
  {
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax H3 Max Open Weights multimodal video generator with native audio and reference support.",
    api_route: "wavespeed-ai/minimax-h3/reference-to-video",
    text_api_route: "wavespeed-ai/minimax-h3/text-to-video",
    image_api_route: "wavespeed-ai/minimax-h3/image-to-video",
    reference_api_route: "wavespeed-ai/minimax-h3/reference-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["480p", "768p"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_audios: 3,
      has_negative_prompt: false,
      has_loop: false,
      has_seed: true,
    }),
  },

  {
    id: "minimax-hailuo-02-pro",
    name: "MiniMax Hailuo 02 Pro",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax Hailuo 02 Pro 1080p cinematic video generation with start and end frame support.",
    api_route: "minimax/hailuo-02/pro",
    text_api_route: "minimax/hailuo-02/t2v-pro",
    image_api_route: "minimax/hailuo-02/i2v-pro",
    start_end_api_route: "minimax/hailuo-02/i2v-pro",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: [],
      durations: [6],
      resolutions: ["1080p"],
      max_reference_images: 0,
      has_negative_prompt: true,
      has_loop: true,
    }),
  },
  {
    id: "minimax-hailuo-02-standard",
    name: "MiniMax Hailuo 02 Standard",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax Hailuo 02 Standard 768p video generation with start and end frame support.",
    api_route: "minimax/hailuo-02/standard",
    text_api_route: "minimax/hailuo-02/t2v-standard",
    image_api_route: "minimax/hailuo-02/i2v-standard",
    start_end_api_route: "minimax/hailuo-02/i2v-standard",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: [],
      durations: [6, 10],
      resolutions: ["768p"],
      max_reference_images: 0,
      has_negative_prompt: true,
      has_loop: true,
    }),
  },
  {
    id: "minimax-hailuo-02-fast",
    name: "MiniMax Hailuo 02 Fast",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax Hailuo 02 Fast 512p video generation optimized for rapid turnaround.",
    api_route: "minimax/hailuo-02/fast",
    image_api_route: "minimax/hailuo-02/fast",
    route_confirmed: true,
    capabilities: i2vCaps({
      aspect_ratios: [],
      durations: [6, 10],
      resolutions: ["512p"],
      max_reference_images: 0,
      has_negative_prompt: false,
      has_loop: false,
    }),
  },
  {
    id: "minimax-hailuo-2.3-pro",
    name: "MiniMax Hailuo 2.3 Pro",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax Hailuo 2.3 Pro unified 1080p cinematic video model.",
    api_route: "minimax/hailuo-2.3/t2v-pro",
    text_api_route: "minimax/hailuo-2.3/t2v-pro",
    image_api_route: "minimax/hailuo-2.3/i2v-pro",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: false,
      aspect_ratios: [],
      durations: [6],
      resolutions: ["1080p"],
      max_reference_images: 0,
      has_negative_prompt: true,
      has_loop: true,
    }),
  },
  {
    id: "minimax-hailuo-2.3-fast",
    name: "MiniMax Hailuo 2.3 Fast",
    family: "hailuo", family_label: "Minimax Hailuo", family_color: "#f59e0b",
    badge: null,
    description: "MiniMax Hailuo 2.3 Fast 720p rapid image-to-video generation.",
    api_route: "minimax/hailuo-2.3/fast",
    image_api_route: "minimax/hailuo-2.3/fast",
    route_confirmed: true,
    capabilities: i2vCaps({
      aspect_ratios: [],
      durations: [6, 10],
      resolutions: ["720p"],
      max_reference_images: 0,
      has_negative_prompt: false,
      has_loop: false,
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ OpenAI Sora 2
  // ║ Confirmed:
  // ║ - https://docs.kie.ai/market/sora2/sora-2-text-to-video
  // ║ Params: prompt, aspect_ratio ("portrait"|"landscape"), n_frames ("10"|"15"),
  // ║         remove_watermark, character_id_list, upload_method ("s3"|"oss" REQUIRED)
  // ║ I2V adds image_urls (array, max 1 image, REQUIRED)
  // ║ Pro adds size ("standard"|"high")
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "openai-sora-2-t2v",
    name: "Sora 2",
    family: "sora", family_label: "OpenAI Sora 2", family_color: "#8b5cf6",
    badge: null,
    description: "OpenAI Sora 2 multi-character T2V. 10s or 15s, portrait or landscape.",
    api_route: "openai/sora-2/text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      aspect_ratios: ["landscape", "portrait"],
      durations:     [10, 15],
    }),
  },
  {
    id: "openai-sora-2-i2v",
    name: "Sora 2 I2V",
    family: "sora", family_label: "OpenAI Sora 2", family_color: "#8b5cf6",
    badge: null,
    description: "OpenAI Sora 2 image-to-video. Single first-frame image.",
    api_route: "openai/sora-2/image-to-video",
    route_confirmed: true,
    capabilities: i2vCaps({
      aspect_ratios: ["landscape", "portrait"],
      durations:     [10, 15],
    }),
  },
  {
    id: "openai-sora-2-pro-t2v",
    name: "Sora 2 Pro",
    family: "sora", family_label: "OpenAI Sora 2", family_color: "#8b5cf6",
    badge: "PRO",
    description: "Pro-tier Sora 2 — higher fidelity, 10s or 15s.",
    api_route: "openai/sora-2/text-to-video-pro",
    route_confirmed: true,
    capabilities: t2vCaps({
      aspect_ratios: ["landscape", "portrait"],
      durations:     [10, 15],
    }),
  },
  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Google Veo 3.1
  // ║ Confirmed:
  // ║ - https://docs.kie.ai/veo3-api/generate-veo-3-video
  // ║ Uses dedicated /api/v1/veo/generate (NOT /jobs/createTask). See route.ts.
  // ║ - model enum mapped to: veo3 / veo3_fast / veo3_lite
  // ║ - aspect_ratio: "16:9" | "9:16" | "Auto"
  // ║ - resolution: 720p | 1080p | 4k (4k = ~2× credits)
  // ║ - duration is FIXED at ~8s by the model (no duration param accepted)
  // ║ - audio is ALWAYS-ON (no sound toggle)
  // ║ - imageUrls: 1 (animate) / 2 (first+last) / 1-3 (REFERENCE_2_VIDEO, fast only)
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "google-veo3.1-lite-t2v",
    name: "Google Veo 3.1 Lite",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: null,
    description: "Lightweight, affordable Veo 3.1. Durations: 4/6/8s. Native audio always-on. Image and last-frame input only; no referenceImages or extension.",
    api_route: "google/veo3.1-lite-text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios: ["16:9", "9:16"],
      durations:     [4, 6, 8],
      resolutions:   ["720p", "1080p"],
      // Google spec: Lite accepts image / lastFrame, but referenceImages is n/a.
      max_reference_images: 0,
    }),
  },
  {
    id: "google-veo3.1-fast-t2v",
    name: "Google Veo 3.1 Fast",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: "FAST",
    description: "Veo 3.1 Fast. Durations: 4/6/8s. Native audio always-on. Up to 3 reference images.",
    api_route: "google/veo3.1-fast-text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame:  true,
      // Google spec: 16:9 or 9:16 only. "Auto" is NOT a documented value.
      aspect_ratios: ["16:9", "9:16"],
      // Google spec: 4, 6, 8 are the only valid durations.
      durations:     [4, 6, 8],
      // Google spec: 720p (default), 1080p, 4k.
      resolutions:   ["720p", "1080p", "4k"],
      // Google spec: up to 3 reference images of a single person/character/product.
      max_reference_images: 3,
    }),
  },
  {
    id: "google-veo3.1-t2v",
    name: "Google Veo 3.1",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: "NEW",
    description: "Veo 3.1 (Pro). Durations: 4/6/8s. Native audio always-on. Up to 3 reference images. 720p/1080p/4K.",
    api_route: "google/veo3.1-text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame:  true,
      // Google spec: 16:9 or 9:16 only.
      aspect_ratios: ["16:9", "9:16"],
      // Google spec: 4, 6, 8 are the only valid durations.
      durations:     [4, 6, 8],
      // Google spec: 720p (default), 1080p, 4k.
      resolutions:   ["720p", "1080p", "4k"],
      // Google spec: up to 3 reference images for both Fast and Pro variants.
      max_reference_images: 3,
    }),
  },
  {
    id: "google-veo3-fast-t2v",
    name: "Google Veo 3 Fast",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: "FAST",
    description: "Legacy Google Veo 3 Fast. Text/image-to-video with native audio. Fixed 8s in the public selector.",
    api_route: "google/veo3-fast-text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios: ["16:9", "9:16"],
      durations:     [8],
      resolutions:   ["720p", "1080p"],
      max_reference_images: 0,
    }),
  },
  {
    id: "google-veo3-t2v",
    name: "Google Veo 3",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: null,
    description: "Legacy Google Veo 3 quality model. Text/image-to-video with native audio. Fixed 8s in the public selector.",
    api_route: "google/veo3-text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios: ["16:9", "9:16"],
      durations:     [8],
      resolutions:   ["720p", "1080p"],
      max_reference_images: 0,
    }),
  },
  {
    id: "google-gemini-omni-flash",
    name: "Google Gemini Omni",
    family: "veo", family_label: "Google Veo", family_color: "#3b82f6",
    badge: "NEW",
    description: "Google Gemini Omni Flash multimodal video engine. Native audio always-on. Supports text, image, reference, and video editing.",
    api_route: "google/gemini-omni-flash",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame:  true,
      aspect_ratios: ["16:9", "9:16"],
      durations:     [3, 4, 5, 6, 7, 8, 9, 10],
      resolutions:   ["360p", "720p", "1080p", "4k"],
      max_reference_images: 6,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 9,
      max_prompt_characters: 2500,
      // Documented: "[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]"
      // binds a starting frame and a reference image in the same interaction.
      combines_references_with_frames: true,
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Black Forest Labs Flux 3 Unified Video
  // ║ Confirmed from official WaveSpeed API documentation:
  // ║ - Text-to-Video & Image-to-Video: 720p $0.17/s, 1080p $0.29/s
  // ║ - Draft / Extend: $0.06/s
  // ║ - Aspect ratios: 21:9, 2:1, 16:9, 4:3, 1:1, 3:4, 9:16
  // ║ - Durations: 5-20s (default 5s)
  // ║ - Reference frames up to 10, Video extend up to 1 video
  // ║ - Synchronized audio: generate_audio default true
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "black-forest-labs-flux-3-video",
    name: "Flux 3",
    family: "flux",
    family_label: "Flux",
    family_color: "#ec4899",
    badge: "NEW",
    description: "Black Forest Labs FLUX 3 unified video model. 5-20s, 720p/1080p, synchronized audio, supporting text, image/frame references, start/end frames, and video extend.",
    api_route: "black-forest-labs/flux-3/text-to-video",
    text_api_route: "black-forest-labs/flux-3/text-to-video",
    image_api_route: "black-forest-labs/flux-3/image-to-video",
    start_end_api_route: "black-forest-labs/flux-3/start-end-to-video",
    video_api_route: "black-forest-labs/flux-3/video-extend",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "2:1"],
      durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      resolutions: ["720p", "1080p"],
      has_seed: true,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ WaveSpeed Alibaba Wan 3.0 Unified Video
  // ║ Owner-supplied official WaveSpeed docs:
  // ║ - T2V/Reference: 480p $0.07/s, 720p $0.13/s, 1080p $0.28/s
  // ║ - I2V: 480p $0.06/s, 720p $0.12/s, 1080p $0.24/s
  // ║ - duration examples confirm 2s and 30s.
  // ║ Public UI shows one model; runtime routes text-only vs image vs references.
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "alibaba-wan-3.0-video",
    name: "Wan 3.0",
    family: "wan",
    family_label: "Wan",
    family_color: "#f59e0b",
    badge: "NEW",
    description: "Alibaba Wan 3.0 unified video model. Text-only requests use T2V; start images use I2V; reference media use reference-to-video in the background.",
    api_route: "alibaba/wan-3.0/text-to-video",
    text_api_route: "alibaba/wan-3.0/text-to-video",
    image_api_route: "alibaba/wan-3.0/image-to-video",
    reference_api_route: "alibaba/wan-3.0/reference-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30],
      resolutions: ["480p", "720p", "1080p"],
      max_reference_images: 10,
      max_reference_videos: 5,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 5,
      max_reference_audio_total_seconds: 15,
      has_seed: true,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ Bytedance Seedance 2.5
  // ║ Confirmed from WaveSpeed model pages provided with the task:
  // ║ - text-to-video-turbo: prompt, reference_images 0..30,
  // ║   reference_videos 0..10 (<=30s total), reference_audios 0..10 (<=30s total),
  // ║   aspect_ratio 16:9|9:16|4:3|3:4|1:1|21:9, resolution 720p|1080p,
  // ║   duration 4..30, generate_audio default true.
  // ║ - image-to-video-turbo: prompt + image, optional last_image,
  // ║   same ratios, resolution 720p|1080p, duration 4..30, generate_audio.
  // ║ - image-to-video-spicy: image required, optional prompt/last_image/seed,
  // ║   resolution 480p|720p|1080p|4k, duration 4..30, generate_audio.
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "bytedance-seedance-v25-t2v",
    name: "Seedance 2.5",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "NEW",
    description: "Bytedance Seedance 2.5 - 480p/720p/1080p/4k, 4-30s, up to 30 images + 10 videos + 10 audios on text/reference generation.",
    api_route: "bytedance/seedance-2.5/text-to-video",
    text_api_route: "bytedance/seedance-2.5/text-to-video",
    image_api_route: "bytedance/seedance-2.5/image-to-video",
    reference_api_route: "bytedance/seedance-2.5/text-to-video",
    video_api_route: "bytedance/seedance-2.5/video-extend",
    start_end_api_route: "bytedance/seedance-2.5/image-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions: ["480p", "720p", "1080p", "4k"],
      max_reference_images: 30,
      max_reference_videos: 10,
      max_reference_video_total_seconds: 30,
      max_reference_audios: 10,
      max_reference_audio_total_seconds: 30,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v25-t2v-turbo",
    name: "Seedance 2.5 Turbo",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "TURBO",
    description: "Bytedance Seedance 2.5 Turbo - 720p/1080p, 4-30s, up to 30 images + 10 videos + 10 audios on text/reference generation.",
    api_route: "bytedance/seedance-2.5/text-to-video-turbo",
    text_api_route: "bytedance/seedance-2.5/text-to-video-turbo",
    image_api_route: "bytedance/seedance-2.5/image-to-video-turbo",
    reference_api_route: "bytedance/seedance-2.5/text-to-video-turbo",
    video_api_route: "bytedance/seedance-2.5/video-extend",
    start_end_api_route: "bytedance/seedance-2.5/image-to-video-turbo",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      optional_video: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions: ["720p", "1080p"],
      max_reference_images: 30,
      max_reference_videos: 10,
      max_reference_video_total_seconds: 30,
      max_reference_audios: 10,
      max_reference_audio_total_seconds: 30,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v25-i2v-turbo",
    name: "Seedance 2.5 I2V Turbo",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "FAST",
    description: "Bytedance Seedance 2.5 Image-to-Video Turbo - start image, optional last image, 720p/1080p, 4-30s, native audio.",
    api_route: "bytedance/seedance-2.5/image-to-video-turbo",
    route_confirmed: true,
    capabilities: i2vCaps({
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions: ["720p", "1080p"],
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v25-i2v-spicy",
    name: "Seedance 2.5 Spicy",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "PRO",
    description: "Bytedance Seedance 2.5 Image-to-Video Spicy - image required, optional last image, 480p/720p/1080p/4k, 4-30s, native audio.",
    api_route: "bytedance/seedance-2.5/image-to-video-spicy",
    route_confirmed: true,
    capabilities: i2vCaps({
      has_end_frame: true,
      aspect_ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions: ["480p", "720p", "1080p", "4k"],
      has_negative_prompt: true,
      has_loop: true,
      has_seed: true,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  // ║ Bytedance Seedance 2.0
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "bytedance-seedance-v2-t2v-fast",
    name: "Seedance 2.0 Turbo",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "TURBO",
    description: "Bytedance Seedance 2.0 Turbo — text/reference generation plus start/end image-to-video, 720p/1080p, 4-15s, native audio.",
    api_route: "bytedance/seedance-2.0/text-to-video-turbo",
    text_api_route: "bytedance/seedance-2.0/text-to-video-turbo",
    image_api_route: "bytedance/seedance-2.0/image-to-video-turbo",
    reference_api_route: "bytedance/seedance-2.0/text-to-video-turbo",
    video_api_route: "bytedance/seedance-2.0/video-extend",
    start_end_api_route: "bytedance/seedance-2.0/image-to-video-turbo",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations:     [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions:   ["720p", "1080p"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 3,
      max_reference_audio_total_seconds: 15,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v2-fast",
    name: "Seedance 2.0 Fast",
    family: "seedance",
    family_label: "Seedance",
    family_color: "#10b981",
    badge: "BUDGET",
    description: "Bytedance Seedance 2.0 Fast — cost-effective HD generation with 20% off, ideal for iteration.",
    api_route: "bytedance/seedance-2.0-fast/text-to-video",
    text_api_route: "bytedance/seedance-2.0-fast/text-to-video",
    image_api_route: "bytedance/seedance-2.0-fast/image-to-video",
    reference_api_route: "bytedance/seedance-2.0-fast/text-to-video",
    video_api_route: "bytedance/seedance-2.0-fast/video-extend",
    start_end_api_route: "bytedance/seedance-2.0-fast/image-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame: true,
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["480p", "720p", "1080p", "4k"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 3,
      max_reference_audio_total_seconds: 15,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v2-t2v-mini",
    name: "Seedance 2.0 Mini",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: null,
    description: "Seedance 2.0 Mini multimodal video generator.",
    api_route: "bytedance/seedance-2.0-mini/text-to-video",
    text_api_route: "bytedance/seedance-2.0-mini/text-to-video",
    image_api_route: "bytedance/seedance-2.0-mini/image-to-video",
    reference_api_route: "bytedance/seedance-2.0-mini/text-to-video",
    video_api_route: "bytedance/seedance-2.0-mini/video-extend",
    start_end_api_route: "bytedance/seedance-2.0-mini/image-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios:  ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations:      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions:    ["480p", "720p", "1080p", "4k"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 3,
      max_reference_audio_total_seconds: 15,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v2-mini-turbo",
    name: "Seedance 2.0 Mini Turbo",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "TURBO",
    description: "Bytedance Seedance 2.0 Mini Turbo — ultra-fast generation (720p/1080p) with prompt & reference guidance.",
    api_route: "bytedance/seedance-2.0-mini/text-to-video-turbo",
    text_api_route: "bytedance/seedance-2.0-mini/text-to-video-turbo",
    image_api_route: "bytedance/seedance-2.0-mini/image-to-video-turbo",
    reference_api_route: "bytedance/seedance-2.0-mini/text-to-video-turbo",
    video_api_route: "bytedance/seedance-2.0-mini/video-edit-turbo",
    start_end_api_route: "bytedance/seedance-2.0-mini/image-to-video-turbo",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios:  ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations:      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions:    ["720p", "1080p"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 3,
      max_reference_audio_total_seconds: 15,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v2-mini-spicy",
    name: "Seedance 2.0 Mini Spicy",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "SPICY",
    description: "Bytedance Seedance 2.0 Mini Spicy — creative image-to-video with seed control and last-frame guidance.",
    api_route: "bytedance/seedance-2.0-mini/image-to-video-spicy",
    image_api_route: "bytedance/seedance-2.0-mini/image-to-video-spicy",
    start_end_api_route: "bytedance/seedance-2.0-mini/image-to-video-spicy",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: false,
      has_end_frame:  true,
      aspect_ratios:  ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
      durations:      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions:    ["480p", "720p", "1080p", "4k"],
      has_negative_prompt: true,
      has_loop: true,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },
  {
    id: "bytedance-seedance-v2-t2v",
    name: "Seedance 2.0",
    family: "seedance", family_label: "Seedance", family_color: "#10b981",
    badge: "NEW",
    description: "Bytedance Seedance 2.0 — text/reference generation plus start/end image-to-video, 480p-4k, 4-15s, native audio.",
    api_route: "bytedance/seedance-2.0/text-to-video",
    text_api_route: "bytedance/seedance-2.0/text-to-video",
    image_api_route: "bytedance/seedance-2.0/image-to-video",
    reference_api_route: "bytedance/seedance-2.0/text-to-video",
    video_api_route: "bytedance/seedance-2.0/video-extend",
    start_end_api_route: "bytedance/seedance-2.0/image-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      optional_image: true,
      has_end_frame:  true,
      aspect_ratios:  ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      durations:      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions:    ["480p", "720p", "1080p", "4k"],
      max_reference_images: 9,
      max_reference_videos: 3,
      max_reference_video_total_seconds: 15,
      max_reference_audios: 3,
      max_reference_audio_total_seconds: 15,
      has_sound: true,
      sound_param: "generate_audio",
    }),
  },

  // ╔══════════════════════════════════════════════════════════════════════════
  // ║ xAI Grok Imagine (video)
  // ║ Confirmed:
  // ║ - https://docs.kie.ai/market/grok-imagine/text-to-video
  // ║            https://docs.kie.ai/market/grok-imagine/image-to-video
  // ║ T2V input: prompt (req), aspect_ratio (2:3|3:2|1:1|16:9|9:16, default 2:3),
  // ║            mode (fun|normal|spicy), duration NUMBER 6-30, resolution (480p|720p),
  // ║            nsfw_checker bool
  // ║ I2V input: image_urls (max 7) OR task_id+index, prompt (optional!),
  // ║            mode (spicy NOT allowed for external images), duration STRING 6-30,
  // ║            resolution, aspect_ratio (multi-image only — single image inherits),
  // ║            nsfw_checker
  // ╚══════════════════════════════════════════════════════════════════════════
  {
    id: "xai-grok-imagine-t2v",
    name: "Grok Imagine",
    family: "grok", family_label: "xAI Grok", family_color: "#ef4444",
    badge: "NEW",
    description: "xAI Grok Imagine — text-to-video. Modes: fun / normal / spicy.",
    api_route: "x-ai/grok-imagine-video/text-to-video",
    route_confirmed: true,
    capabilities: t2vCaps({
      aspect_ratios: ["2:3", "3:2", "1:1", "16:9", "9:16"],
      durations:     [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions:   ["480p", "720p"],
      has_negative_prompt: true,
      has_loop: true,
    }),
  },
  {
    id: "xai-grok-imagine-edit",
    name: "Grok Imagine Edit",
    family: "grok", family_label: "xAI Grok", family_color: "#ef4444",
    badge: null,
    description: "xAI Grok Imagine — image-to-video. Up to 7 reference images.",
    api_route: "x-ai/grok-imagine-video/edit-video",
    route_confirmed: true,
    capabilities: i2vCaps({
      aspect_ratios:        ["2:3", "3:2", "1:1", "16:9", "9:16"],
      durations:            [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      resolutions:          ["480p", "720p"],
      max_reference_images: 7,
      has_negative_prompt:  true,
      has_loop:              true,
    }),
  },
];

// ── Derived helpers ───────────────────────────────────────────────────────────

export function getVideoModelDisplayPriority(model: Pick<WaveSpeedVideoModel, "id" | "api_route" | "family">): number {
  const id = model.id.toLowerCase();
  const route = model.api_route.toLowerCase();
  if (id === "bytedance-seedance-v25-t2v" || route === "bytedance/seedance-2.5/text-to-video") return 0;
  if (id === "bytedance-seedance-v25-t2v-turbo" || route === "bytedance/seedance-2.5/text-to-video-turbo") return 1;
  if (id === "bytedance-seedance-v25-i2v-turbo" || route === "bytedance/seedance-2.5/image-to-video-turbo") return 2;
  if (id === "bytedance-seedance-v25-i2v-spicy" || route === "bytedance/seedance-2.5/image-to-video-spicy") return 3;
  if (id === "alibaba-wan-3.0-video" || route.startsWith("alibaba/wan-3.0")) return 4;
  if (id === "black-forest-labs-flux-3-video" || route.startsWith("black-forest-labs/flux-3")) return 5;
  return 100;
}

export function orderVideoModelsForDisplay<T extends Pick<WaveSpeedVideoModel, "id" | "api_route" | "family">>(models: T[]): T[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const priorityDelta = getVideoModelDisplayPriority(a.model) - getVideoModelDisplayPriority(b.model);
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
    })
    .map(({ model }) => model);
}

export type SeedanceComposerMediaConflict =
  | "end_requires_start"
  | "frames_and_references_conflict"
  | null;

/**
 * Seedance generation uses two mutually exclusive provider contracts:
 * text-to-video accepts reference media, while image-to-video accepts a required
 * start image and an optional last image. Validate that choice before upload or billing.
 */
export function getSeedanceComposerMediaConflict(
  route: string,
  input: {
    hasStartFrame: boolean;
    hasEndFrame: boolean;
    hasReferenceMedia: boolean;
    isExtendMode?: boolean;
  },
): SeedanceComposerMediaConflict {
  if (!route.startsWith("bytedance/seedance-")) return null;
  if (input.isExtendMode) return null;
  if ((input.hasStartFrame || input.hasEndFrame) && input.hasReferenceMedia) {
    return "frames_and_references_conflict";
  }
  if (input.hasEndFrame && !input.hasStartFrame) return "end_requires_start";
  return null;
}

export function supportsSeedanceComposerAspectRatio(route: string, hasStartFrame: boolean): boolean {
  return !(hasStartFrame && route.startsWith("bytedance/seedance-2.5"));
}

/** All models grouped by family for the UI dropdown */
export interface ModelGroup {
  family:       string;
  family_label: string;
  family_color: string;
  models:       WaveSpeedVideoModel[];
}

export function getModelGroups(): ModelGroup[] {
  const map = new Map<string, ModelGroup>();
  const seenModelIds = new Set<string>();

  for (const m of orderVideoModelsForDisplay(VIDEO_MODEL_REGISTRY)) {
    if (m.id === "bytedance-seedance-v25-i2v-turbo" || m.id === "bytedance-seedance-v25-i2v-spicy") continue;
    if (seenModelIds.has(m.id)) continue;
    seenModelIds.add(m.id);

    if (!map.has(m.family)) {
      map.set(m.family, {
        family:       m.family,
        family_label: m.family_label,
        family_color: m.family_color,
        models:       [],
      });
    }
    map.get(m.family)!.models.push(m);
  }
  return Array.from(map.values());
}

export function getModelById(id: string): WaveSpeedVideoModel | undefined {
  return VIDEO_MODEL_REGISTRY.find(m => m.id === id);
}

export const DEFAULT_MODEL = getModelById("bytedance-seedance-v25-t2v-turbo") ?? VIDEO_MODEL_REGISTRY[0];
