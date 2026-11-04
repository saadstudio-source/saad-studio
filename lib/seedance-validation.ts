/**
 * Seedance 2.5, 2.0 Fast, and 2.0 Mini Comprehensive Server-Side Validation Matrix
 * Implements strict server-side rules across all 24 sub-routes (5 dimensions).
 */

export class SeedanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const SEEDANCE_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"] as const;

export type SeedanceRefLimit = {
  img: number;
  vid: number;
  aud: number;
  vidTotalSec: number;
  audTotalSec: number;
};

export const SEEDANCE_REF_LIMITS: Record<string, SeedanceRefLimit> = {
  // Seedance 2.5
  "seedance-2.5/image-to-video":       { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.5/image-to-video-spicy": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.5/image-to-video-turbo": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.5/text-to-video":        { img: 30, vid: 10, aud: 10, vidTotalSec: 30, audTotalSec: 30 },
  "seedance-2.5/text-to-video-turbo":  { img: 30, vid: 10, aud: 10, vidTotalSec: 30, audTotalSec: 30 },
  "seedance-2.5/video-edit":           { img: 30, vid: 0, aud: 10, vidTotalSec: 0, audTotalSec: 30 },
  "seedance-2.5/video-edit-turbo":     { img: 30, vid: 0, aud: 10, vidTotalSec: 0, audTotalSec: 30 },
  "seedance-2.5/video-extend":         { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },

  // Seedance 2.0 Standard
  "seedance-2.0/image-to-video":       { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0/image-to-video-spicy": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0/image-to-video-turbo": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0/text-to-video":        { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0/text-to-video-turbo":  { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0/video-edit":           { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0/video-edit-turbo":     { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0/video-extend":         { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },

  // Seedance 2.0 Fast
  "seedance-2.0-fast/image-to-video":       { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-fast/image-to-video-spicy": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-fast/image-to-video-turbo": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-fast/text-to-video":        { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0-fast/text-to-video-turbo":  { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0-fast/video-edit":           { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0-fast/video-edit-turbo":     { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0-fast/video-extend":         { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },

  // Seedance 2.0 Mini
  "seedance-2.0-mini/image-to-video":       { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-mini/image-to-video-spicy": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-mini/image-to-video-turbo": { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
  "seedance-2.0-mini/text-to-video":        { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0-mini/text-to-video-turbo":  { img: 9, vid: 3, aud: 3, vidTotalSec: 15, audTotalSec: 15 },
  "seedance-2.0-mini/video-edit":           { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0-mini/video-edit-turbo":     { img: 9, vid: 0, aud: 3, vidTotalSec: 0, audTotalSec: 15 },
  "seedance-2.0-mini/video-extend":         { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 },
};

export const SEEDANCE_RESOLUTIONS: Record<string, readonly string[]> = {
  // 2.5
  "seedance-2.5/image-to-video":       ["480p", "720p", "1080p", "4k"],
  "seedance-2.5/image-to-video-spicy": ["480p", "720p", "1080p", "4k"],
  "seedance-2.5/image-to-video-turbo": ["720p", "1080p"],
  "seedance-2.5/text-to-video":        ["480p", "720p", "1080p", "4k"],
  "seedance-2.5/text-to-video-turbo":  ["720p", "1080p"],
  "seedance-2.5/video-edit":           ["480p", "720p", "1080p", "4k"],
  "seedance-2.5/video-edit-turbo":     ["720p", "1080p"],
  "seedance-2.5/video-extend":         ["480p", "720p", "1080p", "4k"],

  // Standard 2.0
  "seedance-2.0/image-to-video":       ["480p", "720p", "1080p", "4k"],
  "seedance-2.0/image-to-video-spicy": ["480p", "720p", "1080p", "4k"],
  "seedance-2.0/image-to-video-turbo": ["720p", "1080p"],
  "seedance-2.0/text-to-video":        ["480p", "720p", "1080p", "4k"],
  "seedance-2.0/text-to-video-turbo":  ["720p", "1080p"],
  "seedance-2.0/video-edit":           ["480p", "720p", "1080p", "4k"],
  "seedance-2.0/video-edit-turbo":     ["720p", "1080p"],
  "seedance-2.0/video-extend":         ["480p", "720p", "1080p", "4k"],

  // Fast
  "seedance-2.0-fast/image-to-video":       ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-fast/image-to-video-spicy": ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-fast/image-to-video-turbo": ["720p", "1080p"],
  "seedance-2.0-fast/text-to-video":        ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-fast/text-to-video-turbo":  ["720p", "1080p"],
  "seedance-2.0-fast/video-edit":           ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-fast/video-edit-turbo":     ["720p", "1080p"],
  "seedance-2.0-fast/video-extend":         ["480p", "720p", "1080p", "4k"],

  // Mini
  "seedance-2.0-mini/image-to-video":       ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-mini/image-to-video-spicy": ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-mini/image-to-video-turbo": ["720p", "1080p"],
  "seedance-2.0-mini/text-to-video":        ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-mini/text-to-video-turbo":  ["720p", "1080p"],
  "seedance-2.0-mini/video-edit":           ["480p", "720p", "1080p", "4k"],
  "seedance-2.0-mini/video-edit-turbo":     ["720p", "1080p"],
  "seedance-2.0-mini/video-extend":         ["480p", "720p", "1080p", "4k"],
};

export const SEEDANCE_DURATION: Record<string, { min: number; max: number; auto: boolean }> = {
  // 2.5
  "seedance-2.5/image-to-video":       { min: 4, max: 30, auto: false },
  "seedance-2.5/image-to-video-spicy": { min: 4, max: 15, auto: false }, // ⚠️ Spicy exception
  "seedance-2.5/image-to-video-turbo": { min: 4, max: 30, auto: false },
  "seedance-2.5/text-to-video":        { min: 4, max: 30, auto: false },
  "seedance-2.5/text-to-video-turbo":  { min: 4, max: 30, auto: false },
  "seedance-2.5/video-edit":           { min: 4, max: 30, auto: true },
  "seedance-2.5/video-edit-turbo":     { min: 4, max: 15, auto: true }, // ⚠️ Turbo edit clamped 15
  "seedance-2.5/video-extend":         { min: 4, max: 30, auto: false },

  // Standard 2.0
  "seedance-2.0/image-to-video":       { min: 4, max: 15, auto: false },
  "seedance-2.0/image-to-video-spicy": { min: 4, max: 15, auto: false },
  "seedance-2.0/image-to-video-turbo": { min: 4, max: 15, auto: false },
  "seedance-2.0/text-to-video":        { min: 4, max: 15, auto: false },
  "seedance-2.0/text-to-video-turbo":  { min: 4, max: 15, auto: false },
  "seedance-2.0/video-edit":           { min: 4, max: 15, auto: true },
  "seedance-2.0/video-edit-turbo":     { min: 4, max: 15, auto: true },
  "seedance-2.0/video-extend":         { min: 4, max: 15, auto: false },

  // Fast
  "seedance-2.0-fast/image-to-video":       { min: 4, max: 15, auto: false },
  "seedance-2.0-fast/image-to-video-spicy": { min: 4, max: 15, auto: false },
  "seedance-2.0-fast/image-to-video-turbo": { min: 4, max: 15, auto: false },
  "seedance-2.0-fast/text-to-video":        { min: 4, max: 15, auto: false },
  "seedance-2.0-fast/text-to-video-turbo":  { min: 4, max: 15, auto: false },
  "seedance-2.0-fast/video-edit":           { min: 4, max: 15, auto: true },
  "seedance-2.0-fast/video-edit-turbo":     { min: 4, max: 15, auto: true },
  "seedance-2.0-fast/video-extend":         { min: 4, max: 15, auto: false },

  // Mini
  "seedance-2.0-mini/image-to-video":       { min: 4, max: 15, auto: false },
  "seedance-2.0-mini/image-to-video-spicy": { min: 4, max: 15, auto: false },
  "seedance-2.0-mini/image-to-video-turbo": { min: 4, max: 15, auto: false },
  "seedance-2.0-mini/text-to-video":        { min: 4, max: 15, auto: false },
  "seedance-2.0-mini/text-to-video-turbo":  { min: 4, max: 15, auto: false },
  "seedance-2.0-mini/video-edit":           { min: 4, max: 15, auto: true },
  "seedance-2.0-mini/video-edit-turbo":     { min: 4, max: 15, auto: true },
  "seedance-2.0-mini/video-extend":         { min: 4, max: 15, auto: false },
};

export const SEEDANCE_ASPECT_MODE: Record<string, "allowlist" | "reject" | "adaptive-fallback"> = {
  // 2.5
  "seedance-2.5/image-to-video":       "reject",
  "seedance-2.5/image-to-video-spicy": "reject",
  "seedance-2.5/image-to-video-turbo": "reject",
  "seedance-2.5/text-to-video":        "allowlist",
  "seedance-2.5/text-to-video-turbo":  "allowlist",
  "seedance-2.5/video-edit":           "reject",
  "seedance-2.5/video-edit-turbo":     "allowlist",
  "seedance-2.5/video-extend":         "reject",

  // Standard 2.0
  "seedance-2.0/image-to-video":       "adaptive-fallback",
  "seedance-2.0/image-to-video-spicy": "adaptive-fallback",
  "seedance-2.0/image-to-video-turbo": "adaptive-fallback",
  "seedance-2.0/text-to-video":        "allowlist",
  "seedance-2.0/text-to-video-turbo":  "allowlist",
  "seedance-2.0/video-edit":           "adaptive-fallback",
  "seedance-2.0/video-edit-turbo":     "adaptive-fallback",
  "seedance-2.0/video-extend":         "reject",

  // Fast
  "seedance-2.0-fast/image-to-video":       "adaptive-fallback",
  "seedance-2.0-fast/image-to-video-spicy": "adaptive-fallback",
  "seedance-2.0-fast/image-to-video-turbo": "adaptive-fallback",
  "seedance-2.0-fast/text-to-video":        "allowlist",
  "seedance-2.0-fast/text-to-video-turbo":  "allowlist",
  "seedance-2.0-fast/video-edit":           "adaptive-fallback",
  "seedance-2.0-fast/video-edit-turbo":     "adaptive-fallback",
  "seedance-2.0-fast/video-extend":         "reject",

  // Mini
  "seedance-2.0-mini/image-to-video":       "adaptive-fallback",
  "seedance-2.0-mini/image-to-video-spicy": "adaptive-fallback",
  "seedance-2.0-mini/image-to-video-turbo": "adaptive-fallback",
  "seedance-2.0-mini/text-to-video":        "allowlist",
  "seedance-2.0-mini/text-to-video-turbo":  "allowlist",
  "seedance-2.0-mini/video-edit":           "adaptive-fallback",
  "seedance-2.0-mini/video-edit-turbo":     "adaptive-fallback",
  "seedance-2.0-mini/video-extend":         "reject",
};

export const SEEDANCE_SUPPORTS_WEB_SEARCH: Record<string, boolean> = {
  // 2.5 — ALL false
  "seedance-2.5/image-to-video":       false,
  "seedance-2.5/image-to-video-spicy": false,
  "seedance-2.5/image-to-video-turbo": false,
  "seedance-2.5/text-to-video":        false,
  "seedance-2.5/text-to-video-turbo":  false,
  "seedance-2.5/video-edit":           false,
  "seedance-2.5/video-edit-turbo":     false,
  "seedance-2.5/video-extend":         false,

  // Standard 2.0
  "seedance-2.0/image-to-video":       true,
  "seedance-2.0/image-to-video-spicy": false, // ⚠️
  "seedance-2.0/image-to-video-turbo": true,
  "seedance-2.0/text-to-video":        true,
  "seedance-2.0/text-to-video-turbo":  true,
  "seedance-2.0/video-edit":           true,
  "seedance-2.0/video-edit-turbo":     true,
  "seedance-2.0/video-extend":         true,

  // Fast — Spicy false, rest true
  "seedance-2.0-fast/image-to-video":       true,
  "seedance-2.0-fast/image-to-video-spicy": false, // ⚠️
  "seedance-2.0-fast/image-to-video-turbo": true,
  "seedance-2.0-fast/text-to-video":        true,
  "seedance-2.0-fast/text-to-video-turbo":  true,
  "seedance-2.0-fast/video-edit":           true,
  "seedance-2.0-fast/video-edit-turbo":     true,
  "seedance-2.0-fast/video-extend":         true,

  // Mini — Spicy false, rest true
  "seedance-2.0-mini/image-to-video":       true,
  "seedance-2.0-mini/image-to-video-spicy": false, // ⚠️
  "seedance-2.0-mini/image-to-video-turbo": true,
  "seedance-2.0-mini/text-to-video":        true,
  "seedance-2.0-mini/text-to-video-turbo":  true,
  "seedance-2.0-mini/video-edit":           true,
  "seedance-2.0-mini/video-edit-turbo":     true,
  "seedance-2.0-mini/video-extend":         true,
};

/**
 * Normalizes any incoming Seedance route alias into canonical family key
 * e.g. "bytedance/seedance-2.5/image-to-video" -> "seedance-2.5/image-to-video"
 *      "bytedance/seedance-2.0-fast/text-to-video"  -> "seedance-2.0-fast/text-to-video"
 */
export function normalizeSeedanceRouteKey(route: string): string {
  let cleaned = (route || "").trim().toLowerCase();
  if (cleaned.startsWith("bytedance/")) cleaned = cleaned.replace("bytedance/", "");
  if (cleaned.startsWith("seedance-v2/")) cleaned = cleaned.replace("seedance-v2/", "seedance-2.0/");
  if (cleaned.startsWith("seedance-2-mini/")) cleaned = cleaned.replace("seedance-2-mini/", "seedance-2.0-mini/");
  if (cleaned === "seedance-2-mini") cleaned = "seedance-2.0-mini/text-to-video";
  if (cleaned === "seedance-2-fast") cleaned = "seedance-2.0-fast/text-to-video";
  if (cleaned === "seedance-2" || cleaned === "seedance-2.0") cleaned = "seedance-2.0/text-to-video";

  return cleaned;
}

export function isSeedanceRoute(route: string): boolean {
  const norm = (route || "").trim().toLowerCase();
  return (
    norm.includes("seedance-2.5") ||
    norm.includes("seedance-2.0") ||
    norm.includes("seedance-2-mini") ||
    norm.includes("seedance-2-fast") ||
    norm.includes("seedance-v2") ||
    norm.startsWith("bytedance/seedance-")
  );
}

/**
 * Rule #1: Enforce reference limits (counts & total durations)
 */
export function validateSeedanceReferences(
  routeKey: string,
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
): { refImages: string[]; refVideos: string[]; refAudios: string[] } {
  const limits = SEEDANCE_REF_LIMITS[routeKey] ?? { img: 0, vid: 0, aud: 0, vidTotalSec: 0, audTotalSec: 0 };

  const refImages = Array.isArray(out.reference_image_urls)
    ? out.reference_image_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_images)
    ? (payload.reference_images as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_image_urls)
    ? (payload.reference_image_urls as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];

  const refVideos = Array.isArray(out.reference_video_urls)
    ? out.reference_video_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_videos)
    ? (payload.reference_videos as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_video_urls)
    ? (payload.reference_video_urls as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];

  const refAudios = Array.isArray(out.reference_audio_urls)
    ? out.reference_audio_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_audios)
    ? (payload.reference_audios as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : Array.isArray(payload.reference_audio_urls)
    ? (payload.reference_audio_urls as string[]).filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];

  const is25 = routeKey.startsWith("seedance-2.5/");
  const isI2V = routeKey.includes("/image-to-video");
  const isExtend = routeKey.includes("/video-extend");

  const rawImage =
    (typeof out.image === "string" && out.image.trim() ? out.image.trim() : null) ||
    (typeof out.image_url === "string" && out.image_url.trim() ? out.image_url.trim() : null) ||
    (typeof payload.image === "string" && payload.image.trim() ? payload.image.trim() : null) ||
    (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim() ? payload.first_frame_url.trim() : null);

  const rawLastImage =
    (typeof out.last_image === "string" && out.last_image.trim() ? out.last_image.trim() : null) ||
    (typeof out.end_image === "string" && out.end_image.trim() ? out.end_image.trim() : null) ||
    (typeof out.last_frame_url === "string" && out.last_frame_url.trim() ? out.last_frame_url.trim() : null) ||
    (typeof payload.last_image === "string" && payload.last_image.trim() ? payload.last_image.trim() : null) ||
    (typeof payload.end_image === "string" && payload.end_image.trim() ? payload.end_image.trim() : null) ||
    (typeof payload.last_frame_url === "string" && payload.last_frame_url.trim() ? payload.last_frame_url.trim() : null);

  let skipImgReject = false;
  if (is25 && isI2V) {
    skipImgReject = false;
  } else if (!is25 && isI2V) {
    const availableSlots = (rawImage ? 0 : 1) + (rawLastImage ? 0 : 1);
    skipImgReject = refImages.length > 0 && refImages.length <= availableSlots;
  } else if (!is25 && isExtend) {
    skipImgReject = !rawLastImage && refImages.length === 1;
  }

  // Reject check with clear messages
  if (limits.img === 0 && refImages.length > 0 && !skipImgReject) {
    throw new SeedanceValidationError(
      `${routeKey} does not accept any reference_images. Use a text-to-video or video-edit sub-route if you need references.`
    );
  }
  if (limits.vid === 0 && refVideos.length > 0) {
    throw new SeedanceValidationError(
      `${routeKey} does not accept any reference_videos. Use a text-to-video sub-route if you need video references.`
    );
  }
  if (limits.aud === 0 && refAudios.length > 0) {
    throw new SeedanceValidationError(
      `${routeKey} does not accept any reference_audios. Use a text-to-video or video-edit sub-route if you need audio references.`
    );
  }

  // Count limit check
  if (limits.img > 0 && refImages.length > limits.img) {
    throw new SeedanceValidationError(`${routeKey} supports up to ${limits.img} reference images.`);
  }
  if (limits.vid > 0 && refVideos.length > limits.vid) {
    throw new SeedanceValidationError(`${routeKey} supports up to ${limits.vid} reference videos.`);
  }
  if (limits.aud > 0 && refAudios.length > limits.aud) {
    throw new SeedanceValidationError(`${routeKey} supports up to ${limits.aud} reference audios.`);
  }

  // Note: reference_video / audio duration caps are enforced by WaveSpeed provider,
  // not by this server. Client-supplied durations are not part of the API contract.

  return { refImages, refVideos, refAudios };
}

/**
 * Rule #2: Enforce start/end frame rules
 */
export function validateSeedanceStartEnd(
  routeKey: string,
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
  exact: Record<string, unknown>,
  refImages: string[],
): void {
  const isI2VFamily = routeKey.includes("/image-to-video");
  const isT2VFamily = routeKey.includes("/text-to-video");
  const isEditFamily = routeKey.includes("/video-edit");
  const isExtendFamily = routeKey.includes("/video-extend");
  const is25Extend = routeKey === "seedance-2.5/video-extend";

  const rawImage =
    (typeof out.image === "string" && out.image.trim() ? out.image.trim() : null) ||
    (typeof out.image_url === "string" && out.image_url.trim() ? out.image_url.trim() : null) ||
    (typeof payload.image === "string" && payload.image.trim() ? payload.image.trim() : null) ||
    (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim() ? payload.first_frame_url.trim() : null);

  const rawLastImage =
    (typeof out.last_image === "string" && out.last_image.trim() ? out.last_image.trim() : null) ||
    (typeof out.end_image === "string" && out.end_image.trim() ? out.end_image.trim() : null) ||
    (typeof out.last_frame_url === "string" && out.last_frame_url.trim() ? out.last_frame_url.trim() : null) ||
    (typeof payload.last_image === "string" && payload.last_image.trim() ? payload.last_image.trim() : null) ||
    (typeof payload.end_image === "string" && payload.end_image.trim() ? payload.end_image.trim() : null) ||
    (typeof payload.last_frame_url === "string" && payload.last_frame_url.trim() ? payload.last_frame_url.trim() : null);

  if (isI2VFamily) {
    const is25I2V = routeKey.startsWith("seedance-2.5/");
    const startImg = rawImage || (!is25I2V ? refImages[0] : null) || null;
    if (!startImg) {
      throw new SeedanceValidationError(`${routeKey} requires a start image.`);
    }
    exact.image = startImg;

    const endImg = rawLastImage || (!is25I2V && refImages.length > 1 ? refImages[1] : null);
    if (endImg) {
      exact.last_image = endImg;
    }
    return;
  }
  if (isT2VFamily || isEditFamily) {
    if (rawImage && !isEditFamily) {
      const currentRefs = (exact.reference_images as string[]) || [];
      if (!currentRefs.includes(rawImage)) {
        exact.reference_images = [rawImage, ...currentRefs];
      }
      delete exact.image;
    }
    if (rawLastImage && !isEditFamily) {
      const currentRefs = (exact.reference_images as string[]) || [];
      if (!currentRefs.includes(rawLastImage)) {
        exact.reference_images = [...currentRefs, rawLastImage];
      }
      delete exact.last_image;
      delete exact.end_image;
    }
    return;
  }

  if (isExtendFamily) {
    const endImg = rawLastImage || (refImages.length > 0 ? refImages[0] : null);
    if (is25Extend && endImg) {
      throw new SeedanceValidationError(`${routeKey} does not support last_image.`);
    }
    if (!is25Extend && endImg) {
      exact.last_image = endImg;
    }
    return;
  }
}

/**
 * Rule #3: Enforce aspect ratio rules
 */
export function validateSeedanceAspect(
  routeKey: string,
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
  exact: Record<string, unknown>,
): void {
  const mode = SEEDANCE_ASPECT_MODE[routeKey] ?? "allowlist";
  const rawAspect =
    (typeof out.aspect_ratio === "string" && out.aspect_ratio.trim() ? out.aspect_ratio.trim() : null) ||
    (typeof payload.aspect_ratio === "string" && payload.aspect_ratio.trim() ? payload.aspect_ratio.trim() : null);

  if (mode === "reject") {
    // Silently remove from provider payload, log warning
    if (rawAspect) {
      console.warn(`[SeedanceValidation] Aspect ratio '${rawAspect}' ignored for ${routeKey} (provider auto-adapts).`);
    }
    return;
  }

  if (rawAspect) {
    if (rawAspect === "adaptive" || rawAspect === "auto") {
      if (mode === "allowlist") {
        exact.aspect_ratio = "16:9";
      }
      return;
    }

    if (SEEDANCE_ASPECT_RATIOS.includes(rawAspect as (typeof SEEDANCE_ASPECT_RATIOS)[number])) {
      exact.aspect_ratio = rawAspect;
    } else {
      throw new SeedanceValidationError(
        `Aspect ratio '${rawAspect}' not supported. Allowed: ${SEEDANCE_ASPECT_RATIOS.join(", ")}.`,
      );
    }
  } else if (mode === "allowlist") {
    // Default 16:9 for T2V
    exact.aspect_ratio = "16:9";
  }
}

/**
 * Rule #4: Enforce strict resolution allowlist
 */
export function validateSeedanceResolution(
  routeKey: string,
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
  exact: Record<string, unknown>,
): void {
  const allowed = SEEDANCE_RESOLUTIONS[routeKey] ?? ["720p", "1080p"];
  const rawRes =
    (typeof out.resolution === "string" && out.resolution.trim() ? out.resolution.trim().toLowerCase() : null) ||
    (typeof payload.resolution === "string" && payload.resolution.trim() ? payload.resolution.trim().toLowerCase() : null) ||
    (typeof payload.quality === "string" && payload.quality.trim() ? payload.quality.trim().toLowerCase() : null) ||
    "720p";

  if (!allowed.includes(rawRes)) {
    throw new SeedanceValidationError(
      `Resolution '${rawRes}' not supported for this route. Allowed: ${allowed.join(", ")}.`,
    );
  }

  exact.resolution = rawRes;
}

/**
 * Rule #5: Enforce duration limits and auto behavior
 */
export function validateSeedanceDuration(
  routeKey: string,
  payload: Record<string, unknown>,
  out: Record<string, unknown>,
  exact: Record<string, unknown>,
): void {
  const config = SEEDANCE_DURATION[routeKey] ?? { min: 4, max: 15, auto: false };

  const rawVal = out.duration !== undefined ? out.duration : payload.duration;
  const hasUserDuration = rawVal !== undefined && rawVal !== null && String(rawVal).trim().length > 0;

  if (!hasUserDuration) {
    if (config.auto) {
      // Omit duration field so provider auto-detects from input video
      return;
    }
    exact.duration = 5;
    return;
  }

  const d = typeof rawVal === "number" ? rawVal : Number.parseInt(String(rawVal), 10);
  if (!Number.isFinite(d) || d < config.min || d > config.max) {
    throw new SeedanceValidationError(
      `Duration ${d}s out of range. Allowed: ${config.min}-${config.max}s.`,
    );
  }

  exact.duration = d;
}

/**
 * Main Central Validator: validates and builds exact clean payload for any of the 24 Seedance sub-routes
 */
export function validateAndBuildSeedanceExactPayload(
  route: string,
  out: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const routeKey = normalizeSeedanceRouteKey(route);
  const exact: Record<string, unknown> = {};

  // 1. References
  const { refImages, refVideos, refAudios } = validateSeedanceReferences(routeKey, payload, out);
  const isI2VFamily = routeKey.includes("/image-to-video");
  const isExtendFamily = routeKey.includes("/video-extend");

  if (refImages.length > 0 && !isI2VFamily && !isExtendFamily) exact.reference_images = refImages;
  if (refVideos.length > 0) exact.reference_videos = refVideos;
  if (refAudios.length > 0) exact.reference_audios = refAudios;

  // 2. Start / End
  validateSeedanceStartEnd(routeKey, payload, out, exact, refImages);

  // 3. Aspect Ratio
  validateSeedanceAspect(routeKey, payload, out, exact);

  // 4. Resolution
  validateSeedanceResolution(routeKey, payload, out, exact);

  // 5. Duration
  validateSeedanceDuration(routeKey, payload, out, exact);

  // Sub-route required inputs check
  const isT2VFamily = routeKey.includes("/text-to-video");
  const isEditFamily = routeKey.includes("/video-edit");
  const isSpicy = routeKey.includes("-spicy");

  if (typeof out.prompt === "string" && out.prompt.trim()) {
    exact.prompt = out.prompt.trim();
  } else if (typeof payload.prompt === "string" && payload.prompt.trim()) {
    exact.prompt = payload.prompt.trim();
  }

  if (isT2VFamily && !exact.prompt) {
    throw new SeedanceValidationError(`${routeKey} requires a prompt.`);
  }

  if (isExtendFamily) {
    const videoUrl =
      (typeof payload.video === "string" && payload.video.trim() ? payload.video.trim() : null) ||
      (typeof out.video_url === "string" && out.video_url.trim() ? out.video_url.trim() : null) ||
      (typeof out.video === "string" && out.video.trim() ? out.video.trim() : null) ||
      refVideos[0] ||
      null;
    if (!videoUrl) {
      throw new SeedanceValidationError(`${routeKey} requires an input video.`);
    }
    if (!exact.prompt) {
      throw new SeedanceValidationError(`${routeKey} requires a continuation prompt.`);
    }
    exact.video = videoUrl;
  }

  if (isEditFamily) {
    const videoUrl =
      (typeof payload.video === "string" && payload.video.trim() ? payload.video.trim() : null) ||
      (typeof out.video_url === "string" && out.video_url.trim() ? out.video_url.trim() : null) ||
      (typeof out.video === "string" && (out.video as string).trim() ? (out.video as string).trim() : null) ||
      refVideos[0] ||
      null;
    if (!videoUrl) {
      throw new SeedanceValidationError(`${routeKey} requires an input video.`);
    }
    if (!exact.prompt) {
      throw new SeedanceValidationError(`${routeKey} requires an edit prompt.`);
    }
    exact.video = videoUrl;
  }

  if (isSpicy) {
    exact.seed = typeof payload.seed === "number" && Number.isFinite(payload.seed) ? payload.seed : -1;
  }

  const generateAudio =
    typeof out.generate_audio === "boolean"
      ? out.generate_audio
      : typeof payload.generate_audio === "boolean"
        ? payload.generate_audio
        : typeof payload.sound === "boolean"
          ? payload.sound
          : true;
  exact.generate_audio = generateAudio;

  if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) {
    exact.negative_prompt = out.negative_prompt.trim();
  }

  if (SEEDANCE_SUPPORTS_WEB_SEARCH[routeKey]) {
    exact.enable_web_search = !!out.enable_web_search || !!payload.enable_web_search;
  } else if (payload.enable_web_search || out.enable_web_search) {
    console.warn(`[SeedanceValidation] enable_web_search ignored for ${routeKey} (not supported).`);
  }

  if (typeof payload.enable_base64_output === "boolean") {
    exact.enable_base64_output = payload.enable_base64_output;
  }

  return exact;
}
