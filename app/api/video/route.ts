import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 90;
export const dynamic = "force-dynamic";
import { getGenerationCost, estimateProviderCostSync } from "@/lib/pricing";
import { getVideoCreditsByRouteAsync } from "@/lib/credit-pricing";
import { InsufficientCreditsError, precheckGenerationPolicy, refundGenerationCharge, setGenerationTaskMarker, spendCredits } from "@/lib/credit-ledger";
import { completeTaskGeneration } from "@/lib/generation/task-orchestrator";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, isAllowedOrigin, sanitizePrompt } from "@/lib/security";
import prismadb from "@/lib/prismadb";
import { getResolvedKieRoutingMaps } from "@/lib/kie-model-routing";
import { getCentralizedDynamicVideoModels } from "@/lib/model-definition-registry";
import { resolveDynamicVideoSubRoute } from "@/lib/dynamic-model-loader";
import { getGoogleVideoConstraints, isGoogleVideoRoute, normalizeGoogleVideoOptions } from "@/lib/video-model-registry";
import { syncKieModelCatalog } from "@/lib/kie-model-sync";
import { beginIdempotency, completeIdempotency, failIdempotency, getIdempotencyKey, hashRequestBody, idempotencyErrorResponse, markIdempotencyProviderDispatched } from "@/lib/idempotency";
import { VIDEO_PROVIDER_BUSY_MESSAGE } from "@/lib/generation-errors";
import { downloadVeoVideo, pollVeoOperation, startVeoGeneration, urlToImageInput, urlToVideoInput, type VeoImageInput, type VeoVideoInput, type VeoOperationHandle, type VeoResolution, type VeoTier } from "@/lib/gemini-veo";
import { uploadBufferToStorage } from "@/lib/supabase-storage";
import { fetchBytePlusTask } from "@/lib/providers/byteplus-reconcile";
import { normalizeMediaUrl, readStorageRuntimeConfig, type StorageRuntimeConfig } from "@/lib/storage";
import {
  isProviderSafeUrl,
  parseStorageKey,
  resolveProviderMediaUrl,
  uploadDataUrlToStorage,
  verifyPublicMediaUrl,
  ValidationError,
} from "@/lib/media/public-url-resolver";
import { resolveProviderPublicUrl } from "@/lib/storage";
import { resolveRuntimeProviderRoute, routingMetadata } from "@/lib/routing/runtime-routing";
import { isFinalProviderExecutionAllowed } from "@/lib/generation/runtime-safety";
import { assertMobileCapabilityAllowed, MobileCapabilityDisabledError } from "@/lib/mobile/mobile-control-plane";
import { validateAndBuildSeedanceExactPayload, isSeedanceRoute } from "@/lib/seedance-validation";
import { assertVideoRouteAllowed, BlockedVideoRouteError } from "@/lib/generation/video-route-policy";

const KIE_BASE = "https://api.kie.ai/api/v1";
const WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3";
const { videoRouteToKieModelMap, wavespeedFallbackMap } = getResolvedKieRoutingMaps();
const IDEMPOTENCY_ROUTE = "generate:video";
const GOOGLE_VEO31_PRO_ROUTE = "google/veo-3.1-generate-preview";
const GOOGLE_VEO31_FAST_ROUTE = "google/veo3.1-fast-text-to-video";
const GOOGLE_VEO31_LITE_ROUTE = "google/veo3.1-lite-text-to-video";
const GOOGLE_VEO31_ROUTE = "google/veo3.1-text-to-video";
const GOOGLE_VEO3_FAST_ROUTE = "google/veo3-fast-text-to-video";
const GOOGLE_VEO3_ROUTE = "google/veo3-text-to-video";
const LEGACY_GEMINI_OMNI_VIDEO_ROUTE = "google/gemini-omni-video";
const BYTEPLUS_ARK_BASE = (process.env.BYTEPLUS_ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/+$/, "");
const BYTEPLUS_CONTENT_TASKS_URL = `${BYTEPLUS_ARK_BASE}/contents/generations/tasks`;
const GENERATION_SERVICE_UNAVAILABLE_MESSAGE = "This generation service is temporarily unavailable. Please try again later.";
const GENERATION_SERVICE_NOT_CONFIGURED_MESSAGE = "This generation service is not configured for execution right now.";

function providerNotActiveResponse(_provider: "byteplus" | "kie", extra?: Record<string, unknown>) {
  return {
    error: GENERATION_SERVICE_UNAVAILABLE_MESSAGE,
    code: "provider_not_active",
    ...extra,
  };
}
const SEEDANCE_2_MODEL = "dreamina-seedance-2-0-260128";
const SEEDANCE_2_FAST_MODEL = "dreamina-seedance-2-0-fast-260128";
const SEEDANCE_2_MINI_MODEL = process.env.BYTEPLUS_MODEL_MINI ?? "dreamina-seedance-2-0-mini-260615";
const SEEDANCE_2_ROUTES = new Set([
  "bytedance/seedance-v2/text-to-video",
  "bytedance/seedance-v2/text-to-video-fast",
  "bytedance/seedance-v2/text-to-video-mini",
]);

const LOCKED_VIDEO_ROUTE_TO_KIE_MODEL: Record<string, string> = {
  // These are high-traffic paid routes. Keep them immutable so a catalog sync or
  // env override can never accidentally submit a Kling request as Seedance, or
  // the reverse. New aliases can still be added below the lock.
  "kwaivgi/kling-v3.0-std/text-to-video": "kling-3.0/video",
  "kwaivgi/kling-v3.0-pro/text-to-video": "kling-3.0/video",
  "kwaivgi/kling-v3.0-pro/motion-control": "kling-3.0/motion-control",
  "bytedance/seedance-v2/text-to-video": "bytedance/seedance-2",
  "bytedance/seedance-v2/text-to-video-fast": "bytedance/seedance-2-fast",
  "bytedance/seedance-v2/text-to-video-mini": "bytedance/seedance-2-mini",
};

function resolveKieVideoModel(modelRoute: string): string | undefined {
  return LOCKED_VIDEO_ROUTE_TO_KIE_MODEL[modelRoute] ?? videoRouteToKieModelMap[modelRoute];
}

type GoogleVideoModeLabel = "Text To Video" | "Image To Video" | "Reference To Video" | "Video Extend" | "Video Edit";

function resolveGoogleVideoModeLabel(input: {
  modelRoute: string;
  hasVideo: boolean;
  hasStartImage: boolean;
  hasEndImage: boolean;
  referenceCount: number;
  hasPreviousInteraction: boolean;
  requestedMode?: unknown;
}): GoogleVideoModeLabel {
  if (input.hasVideo) {
    if (input.requestedMode === "Video Extend" || input.requestedMode === "video_extend" || input.requestedMode === "extend") return "Video Extend";
    return (input.modelRoute === "google/gemini-omni-flash" || input.modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE || input.hasPreviousInteraction) ? "Video Edit" : "Video Extend";
  }
  if (input.referenceCount > 0) return "Reference To Video";
  if (input.hasStartImage || input.hasEndImage) return "Image To Video";
  return "Text To Video";
}
function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStringList(value: unknown): boolean {
  return Array.isArray(value) && value.some(hasNonEmptyString);
}

function payloadHasImageInput(payload: Record<string, unknown>): boolean {
  return (
    hasNonEmptyString(payload.first_frame_url) ||
    hasNonEmptyString(payload.last_frame_url) ||
    hasNonEmptyString(payload.image_url) ||
    hasNonEmptyString(payload.imageUrl) ||
    hasNonEmptyString(payload.image) ||
    hasNonEmptyString(payload.last_image) ||
    hasNonEmptyString(payload.end_image) ||
    hasNonEmptyStringList(payload.image_urls) ||
    hasNonEmptyStringList(payload.imageUrls) ||
    hasNonEmptyStringList(payload.reference_image_urls) ||
    hasNonEmptyStringList(payload.reference_images)
  );
}

function resolveSeedance25Route(baseRoute: string, payload: Record<string, unknown>): string {
  if (!baseRoute.startsWith("bytedance/seedance-2.5")) return baseRoute;

  const hasExplicitStartImage =
    hasNonEmptyString(payload.first_frame_url) ||
    hasNonEmptyString(payload.image_url) ||
    hasNonEmptyString(payload.imageUrl) ||
    hasNonEmptyString(payload.image) ||
    hasNonEmptyString(payload.start_frame) ||
    hasNonEmptyString(payload.last_frame_url) ||
    hasNonEmptyString(payload.last_image) ||
    hasNonEmptyString(payload.end_image);

  if (!hasExplicitStartImage) return baseRoute;

  if (baseRoute === "bytedance/seedance-2.5/text-to-video") {
    return "bytedance/seedance-2.5/image-to-video";
  }
  if (baseRoute !== "bytedance/seedance-2.5/text-to-video-turbo") return baseRoute;

  return "bytedance/seedance-2.5/image-to-video-turbo";
}
function stripPromptReferenceTags(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/@(image|img|video|audio)\d+\b/gi, "").trim();
}

function providerFailureMessage(payload: Record<string, unknown> | null, status: number) {
  if (!payload) return `HTTP ${status}`;
  
  if (payload.error && typeof payload.error === "object") {
    const errObj = payload.error as Record<string, unknown>;
    if (errObj.message) return String(errObj.message).slice(0, 260);
    if (errObj.msg) return String(errObj.msg).slice(0, 260);
  }

  const raw =
    payload.msg ??
    payload.message ??
    payload.error ??
    payload.code ??
    `HTTP ${status}`;
    
  if (typeof raw === "object") {
    return JSON.stringify(raw).slice(0, 260);
  }
  return String(raw).slice(0, 260);
}

function sanitizeUrlForProviderAudit(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = parsed.search ? "?[query-redacted]" : "";
    parsed.pathname = parsed.pathname
      .replace(/user_[A-Za-z0-9]+/g, "user_[redacted]")
      .replace(/\/input-[A-Za-z0-9-]+/g, "/input-[redacted]");
    return parsed.toString();
  } catch {
    return url
      .replace(/user_[A-Za-z0-9]+/g, "user_[redacted]")
      .replace(/^data:[^,]+,.+$/i, "data:[redacted]");
  }
}

function sanitizeArkPayloadForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeArkPayloadForLog(item));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return sanitizeUrlForProviderAudit(value);
    if (typeof value === "string" && value.startsWith("data:")) return "data:[redacted]";
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key === "text" || key === "prompt") {
      output[key] = typeof item === "string" ? `[redacted:${item.length} chars]` : "[redacted]";
      continue;
    }
    output[key] = sanitizeArkPayloadForLog(item);
  }
  return output;
}

function getArkImageAuditDetails(payload: Record<string, unknown>) {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      if (rec.type !== "image_url") return null;
      const imageUrl = rec.image_url;
      const url =
        imageUrl && typeof imageUrl === "object"
          ? (imageUrl as Record<string, unknown>).url
          : undefined;
      if (typeof url !== "string") return null;
      let domain = "invalid-url";
      try {
        domain = new URL(url).hostname;
      } catch {
        domain = url.startsWith("data:") ? "data-url" : "invalid-url";
      }
      return {
        role: typeof rec.role === "string" ? rec.role : "none",
        domain,
        url: sanitizeUrlForProviderAudit(url),
      };
    })
    .filter((item): item is { role: string; domain: string; url: string } => item !== null);
}

function buildArkFailureAudit(params: {
  generationId: string | null;
  providerStatus: number;
  arkModel: string;
  modelRoute: string;
  imageReferences: ReturnType<typeof getArkImageAuditDetails>;
  sanitizedPayload: unknown;
  rawResponse?: unknown;
  rawResponseText?: string;
}) {
  return {
    generationId: params.generationId,
    provider: "BytePlus",
    providerStatus: params.providerStatus,
    providerModel: params.arkModel,
    modelRoute: params.modelRoute,
    bytePlusMediaUrlMode: getBytePlusMediaUrlMode(),
    bytePlusImagePreprocessMode: getBytePlusImagePreprocessMode(),
    imageReferences: params.imageReferences,
    sanitizedPayload: params.sanitizedPayload,
    rawResponse:
      params.rawResponse !== undefined ? sanitizeArkPayloadForLog(params.rawResponse) : undefined,
    rawResponseText: params.rawResponseText,
  };
}

function isProviderContentRejection(message: string) {
  return /safety|policy|violat|censor|moderation|sensitive|block|flagged|nsfw|prohibited|input image may contain|content risk/i.test(message);
}

function classifyArkSubmitFailure(rawError: string, providerStatus: number) {
  const isClientFailure = providerStatus >= 400 && providerStatus < 500;
  const isContentRejection = isProviderContentRejection(rawError);

  if (isContentRejection) {
    return {
      responseStatus: 400,
      code: "ark_content_rejected",
      publicError:
        "The image or prompt was rejected by the video provider's safety policy. Please try a different image or rewrite the prompt.",
    };
  }

  if (isClientFailure) {
    return {
      responseStatus: 400,
      code: "ark_invalid_request",
      publicError:
        "The video provider rejected this request. Please adjust the prompt, image, duration, or resolution and try again.",
    };
  }

  return {
    responseStatus: 502,
    code: "ark_submit_failed",
    publicError: "Generation unavailable. Please retry later.",
  };
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err || "");
}

function isMissingProviderTask(message: string) {
  return /job not found|task not found|operation not found|not found in cache storage|expired|404|410/i.test(message);
}

function getKieKeyFromEnv(): string | null {
  const key = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY;
  if (!key || !key.trim()) return null;
  return key.trim();
}

function kieHeaders() {
  const key = getKieKeyFromEnv();
  if (!key) throw new Error("KIE API key is not configured");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function getArkApiKeyFromEnv(): string | null {
  const key = process.env.ARK_API_KEY || process.env.BYTEPLUS_ARK_API_KEY || process.env.BYTEPLUS_API_KEY;
  if (!key || !key.trim()) return null;
  return key.trim();
}

function arkHeaders() {
  const key = getArkApiKeyFromEnv();
  if (!key) throw new Error("ARK_API_KEY is not configured");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function isOfficialSeedance2Route(modelRoute: string): boolean {
  // Disabled completely - routing all Seedance requests to KIE
  return false;
}

function getOfficialSeedanceModel(modelRoute: string): string {
  if (modelRoute === "bytedance/seedance-v2/text-to-video-fast") {
    return SEEDANCE_2_FAST_MODEL;
  }
  if (modelRoute === "bytedance/seedance-v2/text-to-video-mini") {
    return SEEDANCE_2_MINI_MODEL;
  }
  return SEEDANCE_2_MODEL;
}

function getWaveSpeedKey(): string {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error("WAVESPEED_API_KEY is not configured");
  return key;
}

function wavespeedHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getWaveSpeedKey()}`,
  };
}

function encodeGeminiTask(handle: VeoOperationHandle): string {
  return `gvo:${Buffer.from(JSON.stringify(handle), "utf8").toString("base64url")}`;
}

function normalizePollingTaskId(taskId: string): string {
  if (!taskId.startsWith("gen-")) return taskId;

  const unwrapped = taskId.slice(4);
  const knownProviderPrefixes = ["gvo:", "ark:", "ws:", "veo:", "veo1080:", "veo4k:"];
  return knownProviderPrefixes.some((prefix) => unwrapped.startsWith(prefix))
    ? unwrapped
    : taskId;
}

type VideoTaskGeneration = {
  id: string;
  cost: number;
  mediaUrl: string | null;
  outputUrl?: string | null;
  providerRequestId?: string | null;
  createdAt: Date;
};

function extractStoredVideoTaskId(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl?.startsWith("task:")) return null;
  return normalizePollingTaskId(mediaUrl.slice("task:".length));
}

function resolveCompletedGenerationUrl(generation: VideoTaskGeneration | null | undefined, config?: StorageRuntimeConfig): string | null {
  const candidate = generation?.outputUrl || generation?.mediaUrl || null;
  if (!candidate || candidate.startsWith("task:") || candidate.startsWith("failed:")) return null;
  return normalizeMediaUrl(candidate, { config }) || candidate;
}

function resolveFailedGenerationError(generation: VideoTaskGeneration | null | undefined): string | null {
  const mediaUrl = generation?.mediaUrl || "";
  if (!mediaUrl.startsWith("failed:")) return null;
  const parts = mediaUrl.split(":");
  return parts.slice(2).join(":") || "Generation failed";
}

async function findVideoTaskGeneration(
  userId: string,
  requestedTaskId: string,
  normalizedTaskId = normalizePollingTaskId(requestedTaskId),
): Promise<VideoTaskGeneration | null> {
  const ids = Array.from(new Set([requestedTaskId, normalizedTaskId].filter(Boolean)));
  const or: any[] = [];

  for (const id of ids) {
    or.push({ id });
    or.push({ providerRequestId: id });
    or.push({ mediaUrl: { startsWith: `task:${id}` } });
  }

  if (or.length === 0) return null;

  return prismadb.generation.findFirst({
    where: { userId, OR: or },
    select: {
      id: true,
      cost: true,
      mediaUrl: true,
      outputUrl: true,
      providerRequestId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null);
}

async function resolveGeminiInteractionHandleFromTask(
  userId: string,
  previousTaskId: string | undefined,
): Promise<VeoOperationHandle | null> {
  if (!previousTaskId) return null;

  let taskId = normalizePollingTaskId(previousTaskId);
  const linkedGeneration = await findVideoTaskGeneration(userId, previousTaskId, taskId);
  const storedTaskId =
    extractStoredVideoTaskId(linkedGeneration?.mediaUrl) ||
    linkedGeneration?.providerRequestId ||
    null;

  if (storedTaskId) {
    taskId = normalizePollingTaskId(storedTaskId);
  }

  const decoded = decodeGeminiTask(taskId);
  if (decoded) return decoded;

  if (previousTaskId.startsWith("interactions/") || previousTaskId.startsWith("v1_")) {
    return { name: previousTaskId, model: "gemini-omni-1.1-flash" };
  }

  return null;
}

function decodeGeminiTask(taskId: string): VeoOperationHandle | null {
  taskId = normalizePollingTaskId(taskId);
  if (!taskId.startsWith("gvo:")) return null;
  try {
    const decoded = JSON.parse(Buffer.from(taskId.slice(4), "base64url").toString("utf8")) as Partial<VeoOperationHandle>;
    if (typeof decoded.name === "string" && typeof decoded.model === "string") {
      return { name: decoded.name, model: decoded.model };
    }
  } catch {
    return null;
  }
  return null;
}

function dataUrlToImageInput(value: string) {
  const parsed = extractBase64(value);
  if (!parsed) return null;
  return {
    imageBytes: parsed.fileData,
    mimeType: parsed.mime,
  };
}

async function sourceToGoogleImageInput(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.startsWith("data:")) return dataUrlToImageInput(value) ?? undefined;
  return urlToImageInput(value);
}

function dataUrlToVideoInput(value: string) {
  const parsed = extractBase64(value);
  if (!parsed) return null;
  return {
    videoBytes: parsed.fileData,
    mimeType: parsed.mime,
  };
}

async function sourceToGoogleVideoInput(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.startsWith("data:")) return dataUrlToVideoInput(value) ?? undefined;
  return urlToVideoInput(value);
}

function normalizeGeminiResolution(value: unknown): VeoResolution {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw === "4k") return "4k";
  if (raw === "1080p" || raw === "pro") return "1080p";
  if (raw === "360p") return "360p";
  return "720p";
}

function normalizeGeminiDuration(value: unknown, resolution: VeoResolution, hasReferences: boolean, modelRoute?: string): number {
  if (modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE) {
    const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 5;
    return raw >= 3 && raw <= 10 ? raw : 5;
  }
  if (resolution === "1080p" || resolution === "4k" || hasReferences) return 8;
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 8;
  return raw === 4 || raw === 6 || raw === 8 ? raw : 8;
}

function resolveGoogleVeoTier(modelRoute: string): VeoTier {
  if (modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE) return "omni_flash";
  if (modelRoute === GOOGLE_VEO31_FAST_ROUTE) return "fast";
  if (modelRoute === GOOGLE_VEO31_LITE_ROUTE) return "lite";
  if (modelRoute === GOOGLE_VEO3_FAST_ROUTE) return "legacy_fast";
  if (modelRoute === GOOGLE_VEO3_ROUTE) return "legacy";
  return "pro";
}

function resolveGoogleVeoProviderModel(modelRoute: string): string {
  if (modelRoute === GOOGLE_VEO31_FAST_ROUTE) return "veo-3.1-fast-generate-preview";
  if (modelRoute === GOOGLE_VEO31_LITE_ROUTE) return "veo-3.1-lite-generate-preview";
  if (modelRoute === GOOGLE_VEO3_FAST_ROUTE) return "veo-3.0-fast-generate-001";
  if (modelRoute === GOOGLE_VEO3_ROUTE) return "veo-3.0-generate-001";
  if (modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE) return "gemini-omni-1.1-flash";
  return "veo-3.1-generate-preview";
}
function mapToWavespeedInput(payload: Record<string, unknown>, route?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof payload.prompt === "string") out.prompt = payload.prompt;
  if (typeof payload.video === "string") out.video = payload.video;
  for (const key of ["target", "mode", "change_to", "character_orientation", "target_resolution"] as const) {
    if (typeof payload[key] === "string" && payload[key].trim()) out[key] = payload[key].trim();
  }
  if (typeof payload.keep_original_sound === "boolean") out.keep_original_sound = payload.keep_original_sound;
  if (typeof payload.seed === "number" && Number.isInteger(payload.seed)) out.seed = payload.seed;
  if (typeof payload.duration === "number") out.duration = payload.duration;
  else if (typeof payload.duration === "string") out.duration = Number.parseInt(payload.duration, 10);
  if (typeof payload.negative_prompt === "string" && payload.negative_prompt.trim()) {
    out.negative_prompt = payload.negative_prompt.trim();
  }
  if (payload.loop === true || payload.ping_pong === true || payload.is_loop === true) {
    out.loop = true;
  }
  if (typeof payload.cfg_scale === "number") out.cfg_scale = payload.cfg_scale;

  const requestedAspect =
    typeof payload.aspect_ratio === "string"
      ? payload.aspect_ratio
      : typeof payload.aspectRatio === "string"
        ? payload.aspectRatio
        : null;
  if (requestedAspect) out.aspect_ratio = requestedAspect;

  const requestedResolution =
    typeof payload.resolution === "string"
      ? payload.resolution
      : typeof payload.quality === "string"
        ? payload.quality
        : null;
  if (requestedResolution) out.resolution = requestedResolution;

  const imgSrc =
    (typeof payload.image === "string" ? payload.image : null) ||
    (typeof payload.first_frame_url === "string" ? payload.first_frame_url : null) ||
    (typeof payload.image_url === "string" ? payload.image_url : null);
  if (imgSrc) {
    out.image = imgSrc;
    out.image_url = imgSrc;
  }

  if (typeof payload.first_frame_url === "string") {
    out.first_frame_url = payload.first_frame_url;
    if (!out.image) out.image = payload.first_frame_url;
  }
  if (typeof payload.last_frame_url === "string") {
    out.last_frame_url = payload.last_frame_url;
  }

  const endImage =
    (typeof payload.end_image === "string" ? payload.end_image : null) ||
    (typeof payload.last_image === "string" ? payload.last_image : null) ||
    (typeof payload.last_frame_url === "string" ? payload.last_frame_url : null);
  if (endImage) {
    out.end_image = endImage;
    out.last_image = endImage;
  }

  if (Array.isArray(payload.reference_image_urls)) out.reference_image_urls = payload.reference_image_urls;
  if (Array.isArray(payload.image_urls) && !out.reference_image_urls) out.reference_image_urls = payload.image_urls;
  if (Array.isArray(payload.reference_video_urls)) out.reference_video_urls = payload.reference_video_urls;
  if (typeof payload.video_url === "string") out.reference_video_urls = [payload.video_url];
  if (Array.isArray(payload.video_urls) && !out.reference_video_urls) out.reference_video_urls = payload.video_urls;
  if (Array.isArray(payload.reference_audio_urls)) out.reference_audio_urls = payload.reference_audio_urls;
  if (Array.isArray(payload.audio_urls) && !out.reference_audio_urls) out.reference_audio_urls = payload.audio_urls;
  if (typeof payload.audio_url === "string" && !out.reference_audio_urls) out.reference_audio_urls = [payload.audio_url];

  const isI2VTargetRoute = typeof route === "string" && route.includes("image-to-video");
  const isExtendTargetRoute = typeof route === "string" && route.includes("video-extend");

  if (isI2VTargetRoute) {
    if (!out.image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string") {
      out.image = out.reference_image_urls[0];
      out.first_frame_url = out.reference_image_urls[0];
    }
    if (!out.end_image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[1] === "string") {
      out.end_image = out.reference_image_urls[1];
      out.last_image = out.reference_image_urls[1];
      out.last_frame_url = out.reference_image_urls[1];
    }
  } else if (isExtendTargetRoute) {
    if (!out.end_image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string") {
      out.end_image = out.reference_image_urls[0];
      out.last_image = out.reference_image_urls[0];
      out.last_frame_url = out.reference_image_urls[0];
    }
  }

  out.enable_web_search = payload.enable_web_search !== undefined ? !!payload.enable_web_search : false;

  // Guard Turbo resolution: Turbo routes only support 720p or 1080p
  const isSeedanceMiniTurboRoute = typeof route === "string" && route.includes("seedance-2.0-mini") && route.includes("turbo");
  if (isSeedanceMiniTurboRoute) {
    const rawRes = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "";
    if (rawRes === "480p" || rawRes === "4k") {
      throw new ValidationError(`Resolution '${rawRes}' not supported for this route. Allowed: 720p, 1080p.`);
    }
  }

  const isSeedance25TextRoute = route === "bytedance/seedance-2.5/text-to-video";
  const isSeedance25ImageRoute = route === "bytedance/seedance-2.5/image-to-video";
  const isSeedance25TextTurboRoute = route === "bytedance/seedance-2.5/text-to-video-turbo";
  const isSeedance25TurboImageRoute = route === "bytedance/seedance-2.5/image-to-video-turbo";
  const isSeedance25SpicyImageRoute = route === "bytedance/seedance-2.5/image-to-video-spicy";
  const isSeedanceBaseImageRoute = route === "bytedance/seedance-2.0/image-to-video";
  const isSeedanceTurboImageRoute = route === "bytedance/seedance-2.0/image-to-video-turbo";
  const isSeedanceMiniImageRoute = route === "bytedance/seedance-2.0-mini/image-to-video";
  const isWan30TextRoute = route === "alibaba/wan-3.0/text-to-video";
  const isWan30ImageRoute = route === "alibaba/wan-3.0/image-to-video";
  const isWan30ReferenceRoute = route === "alibaba/wan-3.0/reference-to-video";
  const isFlux3Route = typeof route === "string" && (route.startsWith("black-forest-labs/flux-3") || route.startsWith("black-forest-labs-flux-3"));
  const isFlux3ExtendRoute = isFlux3Route && route.includes("extend");
  const isFlux3StartEndRoute = isFlux3Route && route.includes("start-end");
  const isFlux3ImageRoute = isFlux3Route && route.includes("image-to-video");
  const isKling30ImageRoute =
    route === "kwaivgi/kling-v3.0-std/image-to-video" ||
    route === "kwaivgi/kling-v3.0-pro/image-to-video";
  const isMinimaxH3MaxRoute = typeof route === "string" && route.startsWith("wavespeed-ai/minimax-h3");
  const isMinimaxH3ReferenceRoute = route === "minimax/h3/reference-to-video" || route === "wavespeed-ai/minimax-h3/reference-to-video";
  const isKlingV3TurboImageRoute =
    route === "kwaivgi/kling-v3-turbo-std/image-to-video" ||
    route === "kwaivgi/kling-v3-turbo-pro/image-to-video";
  const isKlingO3Route = typeof route === "string" && route.startsWith("kwaivgi/kling-video-o3-");
  const isKling26Route = typeof route === "string" && route.startsWith("kwaivgi/kling-v2.6-") && route !== "kwaivgi/kling-v2.6-std/motion-control";
  const hasAudio = isSeedance25TextRoute || isSeedance25ImageRoute || isSeedance25TextTurboRoute || isSeedance25TurboImageRoute || isSeedance25SpicyImageRoute || isSeedanceBaseImageRoute || route?.includes("seedance-2.0-mini") || isSeedanceTurboImageRoute || isWan30TextRoute || isWan30ImageRoute || isWan30ReferenceRoute || isFlux3Route
    ? payload.generate_audio !== false
    : payload.sound === true || payload.generate_audio === true;
  out.generate_audio = hasAudio;
  const readKlingElementList = () => {
    const directElements = Array.isArray(payload.element_list)
      ? payload.element_list.slice(0, 3).filter((item) => item && typeof item === "object")
      : [];
    const imageElements = Array.isArray(payload.kling_elements)
      ? payload.kling_elements
          .slice(0, Math.max(0, 3 - directElements.length))
          .filter((item) => item && typeof item === "object")
      : [];
    return [...directElements, ...imageElements];
  };


  if (isMinimaxH3ReferenceRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideosFromList = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = [
      ...referenceVideosFromList,
      ...(typeof payload.video === "string" && payload.video.trim() ? [payload.video] : []),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const referenceAudios = Array.isArray(out.reference_audio_urls)
      ? out.reference_audio_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new ValidationError("Minimax H3 requires at least one reference image or reference video.");
    }
    if (referenceAudios.length > 0 && referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new ValidationError("Minimax H3 reference audio cannot be provided alone.");
    }

    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) {
      exact.prompt = out.prompt
        .trim()
        .replace(/@Image(\d+)\b/g, "<Picture $1>")
        .replace(/@Video(\d+)\b/g, "<Video $1>")
        .replace(/@Audio(\d+)\b/g, "<Audio $1>");
    }
    else throw new ValidationError("Minimax H3 requires a prompt.");
    if (referenceImages.length > 0) exact.reference_images = referenceImages.slice(0, 9);
    if (referenceVideos.length > 0) exact.reference_videos = referenceVideos.slice(0, 3);
    if (referenceAudios.length > 0) exact.reference_audios = referenceAudios.slice(0, 3);
    if (typeof out.aspect_ratio === "string" && ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : (isMinimaxH3MaxRoute ? "480p" : "2k");
    exact.resolution = isMinimaxH3MaxRoute
      ? (resolution === "768p" ? "768p" : "480p")
      : (resolution === "2k" || resolution === "2 k" ? "2k" : "768p");
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(isMinimaxH3MaxRoute ? 3 : 5, duration)) : 5;
    if (isMinimaxH3MaxRoute) {
      const seed = Number(payload.seed ?? out.seed);
      if (Number.isInteger(seed)) exact.seed = seed;
    }
    return exact;
  }

  const isMinimaxH3TextOrImageRoute =
    route === "minimax/h3/text-to-video" ||
    route === "minimax/h3/image-to-video" ||
    route === "wavespeed-ai/minimax-h3/text-to-video" ||
    route === "wavespeed-ai/minimax-h3/image-to-video";
  if (isMinimaxH3TextOrImageRoute) {
    const exact: Record<string, unknown> = {};
    const prompt = typeof out.prompt === "string" && out.prompt.trim() ? out.prompt.trim() : "";
    if (!prompt) throw new ValidationError("Minimax H3 requires a prompt.");
    exact.prompt = prompt;
    if (route.includes("image-to-video")) {
      const startImage =
        (typeof out.image === "string" && out.image.trim() ? out.image.trim() : null) ||
        (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim() ? payload.first_frame_url.trim() : null) ||
        (typeof out.image_url === "string" && out.image_url.trim() ? out.image_url.trim() : null) ||
        null;
      if (!startImage) throw new ValidationError("Minimax H3 image-to-video requires a start image.");
      exact.image = startImage;
      const endImage =
        (typeof out.last_image === "string" && out.last_image.trim() ? out.last_image.trim() : null) ||
        (typeof out.end_image === "string" && out.end_image.trim() ? out.end_image.trim() : null) ||
        (typeof payload.last_frame_url === "string" && payload.last_frame_url.trim() ? payload.last_frame_url.trim() : null) ||
        null;
      if (endImage) exact.last_image = endImage;
    }
    if (typeof out.aspect_ratio === "string" && ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "9:21"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const isTextOrImageH3MaxRoute = route.startsWith("wavespeed-ai/minimax-h3");
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : (isTextOrImageH3MaxRoute ? "480p" : "2k");
    exact.resolution = isTextOrImageH3MaxRoute
      ? (resolution === "768p" ? "768p" : "480p")
      : (resolution === "2k" || resolution === "2 k" ? "2k" : "768p");
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(isTextOrImageH3MaxRoute ? 3 : 5, duration)) : 5;
    if (isTextOrImageH3MaxRoute) {
      const seed = Number(payload.seed ?? out.seed);
      if (Number.isInteger(seed)) exact.seed = seed;
    }
    return exact;
  }

  const isMinimaxHailuoRoute = typeof route === "string" && (route.startsWith("minimax/hailuo-") || route === "minimax/live-illustrations");
  if (isMinimaxHailuoRoute) {
    const exact: Record<string, unknown> = {};
    const prompt = typeof out.prompt === "string" && out.prompt.trim() ? out.prompt.trim() : "";
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof payload.first_frame_url === "string" ? payload.first_frame_url : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      (Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string" ? out.reference_image_urls[0] : null) ||
      null;
    const endImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      (typeof payload.last_frame_url === "string" ? payload.last_frame_url : null) ||
      (Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[1] === "string" ? out.reference_image_urls[1] : null) ||
      null;

    const isFastRoute = route.includes("/fast") || route.includes("/fast-pro");
    const isLiveIllustrations = route === "minimax/live-illustrations";
    const isI2vOnly = isFastRoute || isLiveIllustrations || route.includes("/i2v-");
    const supportsEndFrame = route.startsWith("minimax/hailuo-02") && !isFastRoute;

    if (isI2vOnly && !startImage) {
      throw new ValidationError(`${route} requires an input image.`);
    }
    if (!prompt && !startImage) {
      throw new ValidationError("Prompt or image is required for video generation.");
    }

    if (prompt) exact.prompt = prompt;
    if (startImage) exact.image = startImage;
    if (endImage && supportsEndFrame) exact.end_image = endImage;

    const rawDuration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "6"), 10);
    if (route === "minimax/hailuo-2.3/t2v-pro" || route === "minimax/hailuo-2.3/i2v-pro") {
      exact.duration = 5;
    } else if (route === "minimax/hailuo-02/pro" || route === "minimax/hailuo-2.3/fast-pro") {
      exact.duration = 6;
    } else if (rawDuration === 10) {
      exact.duration = 10;
    } else {
      exact.duration = 6;
    }

    if (isFastRoute) {
      exact.go_fast = payload.go_fast !== false;
    } else {
      exact.enable_prompt_expansion = payload.enable_prompt_expansion !== false;
    }

    return exact;
  }

  if (isWan30TextRoute || isWan30ImageRoute || isWan30ReferenceRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceImageUrls)
        ? payload.referenceImageUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceVideoUrls)
        ? payload.referenceVideoUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const referenceAudios = Array.isArray(out.reference_audio_urls)
      ? out.reference_audio_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceAudioUrls)
        ? payload.referenceAudioUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const endImage =
      (typeof out.last_image === "string" ? out.last_image : null) ||
      (typeof out.last_frame_url === "string" ? out.last_frame_url : null) ||
      (typeof out.end_image === "string" ? out.end_image : null) ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    else throw new ValidationError("Wan 3.0 requires a prompt.");
    if (isWan30ImageRoute) {
      if (startImage) exact.image = startImage;
      else throw new ValidationError("Wan 3.0 Image-to-Video requires an image or reference image.");
      if (endImage) exact.last_image = endImage;
    }
    if (isWan30ReferenceRoute) {
      if (referenceImages.length > 0) exact.reference_images = referenceImages.slice(0, 10);
      if (referenceVideos.length > 0) exact.reference_videos = referenceVideos.slice(0, 5);
      if (referenceAudios.length > 0) exact.reference_audios = referenceAudios.slice(0, 5);
      if (!exact.reference_images && !exact.reference_videos && !exact.reference_audios) {
        throw new ValidationError("Wan 3.0 Reference-to-Video requires at least one reference image, video, or audio.");
      }
    }
    if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "720p";
    exact.resolution = ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p";
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(30, Math.max(2, duration)) : 5;
    if (typeof out.thinking_mode === "boolean") exact.thinking_mode = out.thinking_mode;
    exact.enable_audio = out.generate_audio !== false;
    if (typeof payload.seed === "number" && Number.isFinite(payload.seed)) exact.seed = payload.seed;
    return exact;
  }

  if (isFlux3Route) {
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) {
      exact.prompt = out.prompt.trim();
    } else {
      throw new ValidationError("Flux 3 requires a prompt.");
    }

    if (isFlux3ExtendRoute) {
      const video = typeof payload.video === "string" && payload.video.trim()
        ? payload.video.trim()
        : Array.isArray(out.reference_video_urls) && out.reference_video_urls[0]
          ? out.reference_video_urls[0]
          : null;
      if (!video) {
        throw new ValidationError("Flux 3 Video Extend requires a source video.");
      }
      exact.video = video;
    } else if (isFlux3StartEndRoute) {
      const startImage = (typeof out.image === "string" ? out.image : null) || (typeof payload.start_image === "string" ? payload.start_image : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[0] : null);
      const endImage = (typeof out.last_image === "string" ? out.last_image : null) || (typeof payload.end_image === "string" ? payload.end_image : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[1] : null);
      if (!startImage || !endImage) {
        throw new ValidationError("Flux 3 Start-End-to-Video requires both start_image and end_image.");
      }
      exact.start_image = startImage;
      exact.end_image = endImage;
    } else if (isFlux3ImageRoute) {
      const image = (typeof out.image === "string" ? out.image : null) || (typeof out.image_url === "string" ? out.image_url : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[0] : null) || (Array.isArray(out.reference_image_urls) ? out.reference_image_urls[0] : null);
      if (!image) {
        throw new ValidationError("Flux 3 Image-to-Video requires an input image.");
      }
      exact.image = image;
    }

    if (typeof out.aspect_ratio === "string" && ["21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "720p";
    if (!route.includes("draft")) {
      exact.resolution = resolution === "1080p" ? "1080p" : "720p";
    }
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(20, Math.max(5, duration)) : 5;
    exact.generate_audio = out.generate_audio !== false;
    if (typeof payload.seed === "number" && Number.isFinite(payload.seed)) exact.seed = payload.seed;
    return exact;
  }

  if (isKling30ImageRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (startImage) exact.image = startImage;
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    if (finalImage) {
      exact.end_image = finalImage;
      exact.last_image = finalImage;
    }
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
    if (typeof out.cfg_scale === "number" && Number.isFinite(out.cfg_scale)) {
      exact.cfg_scale = Math.min(1, Math.max(0, out.cfg_scale));
    }
    exact.sound = payload.sound === true || payload.generate_audio === true;
    const shotType = typeof payload.shot_type === "string" ? payload.shot_type.trim() : "";
    if (Array.isArray(payload.multi_prompt)) {
      const multiPrompt = payload.multi_prompt
        .slice(0, 6)
        .filter((item) => item && typeof item === "object");
      if (multiPrompt.length > 0) {
        exact.multi_prompt = multiPrompt;
        if (shotType === "customize" || shotType === "intelligent") exact.shot_type = shotType;
      }
    }
    const elementList = readKlingElementList();
    if (elementList.length > 0) exact.element_list = elementList;
    return exact;
  }

  if (isKlingV3TurboImageRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (startImage) exact.image = startImage;
    else throw new ValidationError("Kling V3 Turbo requires an image.");
    if (finalImage) {
      exact.end_image = finalImage;
      exact.last_image = finalImage;
    }
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const rawMultiPrompt = payload.multi_prompt;
    const hasMultiPromptInput = Array.isArray(rawMultiPrompt);
    const multiPrompt = hasMultiPromptInput
      ? (rawMultiPrompt as Array<Record<string, unknown>>)
          .slice(0, 6)
          .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
            if (!prompt) return null;
            const duration = typeof item.duration === "number" ? item.duration : Number.parseInt(String(item.duration || "1"), 10);
            if (!Number.isFinite(duration) || duration <= 0) {
              throw new ValidationError(`Kling V3 Turbo multi_prompt item ${index + 1} duration must be at least 1 second.`);
            }
            return { prompt, duration };
          })
          .filter((item: { prompt: string; duration: number } | null): item is { prompt: string; duration: number } => item !== null)
      : [];
    if (multiPrompt.length > 0) {
      const totalDuration = multiPrompt.reduce((sum: number, item: { prompt: string; duration: number }) => sum + item.duration, 0);
      if (totalDuration > 15) {
        throw new ValidationError("Kling V3 Turbo multi_prompt total duration must not exceed 15 seconds.");
      }
      exact.multi_prompt = multiPrompt;
    } else if (hasMultiPromptInput) {
      throw new ValidationError("Kling V3 Turbo multi_prompt must include at least one shot.");
    } else {
      if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
      const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
      const normalizedDuration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
      exact.duration = normalizedDuration;
    }
    return exact;
  }

  if (isKlingO3Route) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    const normalizedDuration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
    if (route?.includes("-pro/image-to-video")) {
      exact.duration = normalizedDuration >= 8 ? 10 : 5;
    } else {
      exact.duration = normalizedDuration;
    }
    exact.sound = payload.sound === true || payload.generate_audio === true;
    const shotType = typeof payload.shot_type === "string" ? payload.shot_type.trim() : "";
    if (Array.isArray(payload.multi_prompt)) {
      const multiPrompt = payload.multi_prompt.slice(0, 6).filter((item) => item && typeof item === "object");
      if (multiPrompt.length > 0) {
        exact.multi_prompt = multiPrompt;
        if (shotType === "customize" || shotType === "intelligent") exact.shot_type = shotType;
      }
    }
    const elementList = readKlingElementList();
    if (elementList.length > 0) exact.element_list = elementList;
    if (route?.includes("/reference-to-video")) {
      if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1"].includes(out.aspect_ratio)) exact.aspect_ratio = out.aspect_ratio;
      if (referenceVideos[0]) {
        exact.video = referenceVideos[0];
        exact.keep_original_sound = payload.keep_original_sound !== false;
      }
      const images = [...imageUrls, ...referenceImages].filter((value, index, list) => list.indexOf(value) === index);
      if (images.length > 0) exact.images = images.slice(0, referenceVideos[0] ? 4 : 7);
    } else if (route?.includes("/image-to-video")) {
      if (startImage) exact.image = startImage;
      if (finalImage) {
        exact.end_image = finalImage;
        exact.last_image = finalImage;
      }
    }
    return exact;
  }

  if (isKling26Route) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = duration >= 8 ? 10 : 5;
    if (typeof out.cfg_scale === "number" && Number.isFinite(out.cfg_scale)) {
      exact.cfg_scale = Math.min(1, Math.max(0, out.cfg_scale));
    }
    if (route?.includes("/image-to-video")) {
      if (startImage) exact.image = startImage;
      if (finalImage) {
        exact.end_image = finalImage;
        exact.last_image = finalImage;
      }
      if (route.includes("-pro/")) {
        const sound = payload.sound === true || payload.generate_audio === true;
        exact.sound = sound;
        if (Array.isArray(payload.voice_list)) {
          const voiceList = payload.voice_list.slice(0, 2).filter((item) => item && typeof item === "object");
          if (voiceList.length > 0) exact.voice_list = voiceList;
        }
      }
    } else if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    return exact;
  }

  if (route && (isSeedanceRoute(route) || route.startsWith("bytedance/seedance-"))) {
    return validateAndBuildSeedanceExactPayload(route, out, payload);
  }

  return out;
}

function extractBase64(raw: string) {
  const match = raw.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const fileData = match[2];
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return { mime, fileData, ext };
}

async function uploadDataUrlToKie(value: string): Promise<string> {
  if (!value.startsWith("data:")) return value;
  const parsed = extractBase64(value);
  if (!parsed) return value;

  // CRITICAL: Use a unique filename per upload. If two uploads share the same
  // filename, KIE may dedupe and return the same URL for both - which silently
  // collapses image_urls=[first,last] to image_urls=[same,same] and breaks
  // first/last-frame video generation.
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const uploadRes = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
    method: "POST",
    headers: kieHeaders(),
    body: JSON.stringify({
      base64Data: parsed.fileData,
      uploadPath: "video-refs",
      fileName: `upload-${uniqueId}.${parsed.ext}`,
    }),
  });

  const uploadJson = await uploadRes.json().catch(() => null);
  const maybeUrl =
    uploadJson?.data?.downloadUrl ||
    uploadJson?.data?.download_url ||
    uploadJson?.data?.fileUrl ||
    uploadJson?.data?.file_url ||
    uploadJson?.data?.url ||
    (typeof uploadJson?.data === "string" ? uploadJson.data : undefined) ||
    uploadJson?.fileUrl ||
    uploadJson?.url;

  if (!uploadRes.ok || !maybeUrl) {
    throw new Error(uploadJson?.msg || "KIE file upload failed");
  }

  return String(maybeUrl);
}

async function resolveMediaInInput(input: Record<string, unknown>, userId: string) {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && ["image", "image_url", "first_frame_url", "last_frame_url", "last_image", "end_image", "video"].includes(key)) {
      if (value.trim()) {
        const resolvedUrl = await resolveProviderMediaUrl(value, { userId, assetType: getAssetTypeFromKey(key) });
        await verifyPublicMediaUrl(resolvedUrl, key, { expectedMediaKind: getAssetTypeFromKey(key) });
        resolved[key] = resolvedUrl;
      } else {
        resolved[key] = value;
      }
      continue;
    }

    if (Array.isArray(value) && ["reference_image_urls", "image_urls", "reference_video_urls", "reference_audio_urls"].includes(key)) {
      const assetType = getAssetTypeFromKey(key);
      const uploaded = await Promise.all(
        value.map(async (item) => {
          if (typeof item === "string" && item.trim()) {
            const resolvedUrl = await resolveProviderMediaUrl(item, { userId, assetType });
            await verifyPublicMediaUrl(resolvedUrl, key, { expectedMediaKind: getAssetTypeFromKey(key) });
            return resolvedUrl;
          }
          return item;
        }),
      );
      // Verify uploads produced distinct URLs (critical for first/last frame pairs)
      if (key === "image_urls" && uploaded.length >= 2) {
        const urlsOnly = uploaded.filter((u): u is string => typeof u === "string");
        const uniqueUrls = new Set(urlsOnly);
        console.log(
          `[API/video] image_urls resolved -> ${urlsOnly.length} items, ${uniqueUrls.size} unique URLs`,
          urlsOnly.map((u, i) => `[${i}] ${u.slice(0, 80)}`),
        );
        if (uniqueUrls.size < urlsOnly.length) {
          console.warn(
            "[API/video] Warning: KIE resolved duplicate URLs for distinct frames - first/last frame transition will not work!",
          );
        }
      }
      resolved[key] = uploaded;
      continue;
    }

    resolved[key] = value;
  }

  if (Array.isArray(resolved.kling_elements)) {
    resolved.kling_elements = await Promise.all(
      (resolved.kling_elements as Array<Record<string, unknown>>).map(async (el) => {
        const next = { ...el };
        if (Array.isArray(next.element_input_urls)) {
          next.element_input_urls = await Promise.all(
            (next.element_input_urls as unknown[]).map(async (v) => {
              if (typeof v === "string" && v.trim()) {
                const resolvedUrl = await resolveProviderMediaUrl(v, { userId, assetType: "image" });
                await verifyPublicMediaUrl(resolvedUrl, "kling_element", { expectedMediaKind: "image" });
                return resolvedUrl;
              }
              return v;
            }),
          );
        }
        return next;
      }),
    );
  }

  return resolved;
}

function getAssetTypeFromKey(key: string): "image" | "video" | "audio" {
  const k = key.toLowerCase();
  if (k.includes("video")) return "video";
  if (k.includes("audio")) return "audio";
  return "image";
}

type BytePlusMediaUrlMode = "b2" | "proxy" | "cdn" | "passthrough";
type BytePlusImagePreprocessMode = "off" | "reencode";

function getBytePlusMediaUrlMode(): BytePlusMediaUrlMode {
  const raw = (process.env.BYTEPLUS_MEDIA_URL_MODE || "b2").trim().toLowerCase();
  if (raw === "b2" || raw === "proxy" || raw === "cdn" || raw === "passthrough") {
    return raw;
  }
  console.warn(`[BytePlus Media URL] Unknown BYTEPLUS_MEDIA_URL_MODE=${raw}; falling back to b2`);
  return "b2";
}

function getBytePlusImagePreprocessMode(): BytePlusImagePreprocessMode {
  const raw = (process.env.BYTEPLUS_IMAGE_PREPROCESS_MODE || "off").trim().toLowerCase();
  if (raw === "off" || raw === "reencode") return raw;
  console.warn(`[BytePlus Image Preprocess] Unknown BYTEPLUS_IMAGE_PREPROCESS_MODE=${raw}; falling back to off`);
  return "off";
}

function getAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.saadstudio.app").replace(/\/+$/, "");
}

function getBytePlusCdnBaseUrl() {
  return (
    process.env.BYTEPLUS_MEDIA_CDN_BASE_URL ||
    process.env.BYTEPLUS_CDN_BASE_URL ||
    process.env.BROWSER_CDN_BASE_URL ||
    process.env.NEXT_PUBLIC_BROWSER_CDN_BASE_URL ||
    ""
  ).replace(/\/+$/, "");
}

function encodeMediaKey(bucket: string, path: string) {
  return [bucket, ...path.split("/")]
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function extractStorageKeyFromUrl(value: string): { bucket: string; path: string } | null {
  const apiMediaIndex = value.indexOf("/api/media/");
  if (apiMediaIndex !== -1) {
    return parseStorageKey(value.slice(apiMediaIndex + "/api/media/".length));
  }

  const match = value.match(/(?:^|\/)(images|videos|audio|thumbnails|media)\/([^?#]+)/i);
  if (!match) return null;
  return parseStorageKey(`${match[1]}/${decodeURIComponent(match[2])}`);
}

function toBytePlusProxyUrl(key: { bucket: string; path: string }) {
  return `${getAppBaseUrl()}/api/media/${encodeMediaKey(key.bucket, key.path)}`;
}

function toBytePlusCdnUrl(key: { bucket: string; path: string }) {
  const cdnBase = getBytePlusCdnBaseUrl();
  if (!cdnBase) {
    throw new ValidationError("BYTEPLUS_MEDIA_URL_MODE=cdn requires BYTEPLUS_MEDIA_CDN_BASE_URL.");
  }
  return `${cdnBase}/${encodeMediaKey(key.bucket, key.path)}`;
}

async function resolveBytePlusStorageKey(value: unknown, userId: string, assetType: "image" | "video" | "audio") {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("Invalid or empty media input");
  }

  const trimmed = value.trim();

  if (assetType === "image" && getBytePlusImagePreprocessMode() === "reencode") {
    const normalizedKey = await normalizeBytePlusImageInputToStorageKey(trimmed, userId);
    if (normalizedKey) return normalizedKey;
    console.warn("[BytePlus Image Preprocess] Re-encode failed; falling back to original media reference.");
  }

  if (trimmed.startsWith("data:")) {
    const uploaded = await uploadDataUrlToStorage(trimmed, userId, assetType);
    const parsed = parseStorageKey(uploaded);
    if (parsed) return parsed;
    throw new ValidationError(`Failed to parse uploaded BytePlus media path: ${uploaded}`);
  }

  return parseStorageKey(trimmed) || extractStorageKeyFromUrl(trimmed);
}

async function readBytePlusImageInputBuffer(value: string, userId: string): Promise<Buffer | null> {
  const trimmed = value.trim();

  const dataUrlMatch = trimmed.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return Buffer.from(dataUrlMatch[2], "base64");
  }

  const directKey = parseStorageKey(trimmed) || extractStorageKeyFromUrl(trimmed);
  let fetchUrl: string | null = null;

  if (directKey) {
    fetchUrl = await resolveProviderPublicUrl(directKey.bucket, directKey.path);
  } else if (/^https?:\/\//i.test(trimmed)) {
    fetchUrl = await resolveProviderMediaUrl(trimmed, { userId, assetType: "image" });
  }

  if (!fetchUrl) return null;

  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new ValidationError(`Unable to fetch image for BytePlus preprocessing (HTTP ${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function normalizeBytePlusImageInputToStorageKey(value: string, userId: string) {
  try {
    const inputBuffer = await readBytePlusImageInputBuffer(value, userId);
    if (!inputBuffer?.length) return null;

    const normalizedBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .toColorspace("srgb")
      .jpeg({ quality: 94, mozjpeg: true })
      .toBuffer();

    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const uploaded = await uploadBufferToStorage({
      buffer: normalizedBuffer,
      contentType: "image/jpeg",
      userId,
      assetType: "image",
      generationId: `byteplus-normalized-${uniqueId}`,
      fileName: "input.jpg",
    });

    if (!uploaded) return null;
    const parsed = parseStorageKey(uploaded);
    if (!parsed) {
      throw new ValidationError(`Failed to parse normalized BytePlus image path: ${uploaded}`);
    }

    console.log(`[BytePlus Image Preprocess] Re-encoded image for Ark payload: ${parsed.bucket}/${parsed.path}`);
    return parsed;
  } catch (err) {
    console.error("[BytePlus Image Preprocess] failed:", err);
    return null;
  }
}

async function resolveOfficialSeedanceUrl(value: unknown, userId: string, assetType: "image" | "video" | "audio"): Promise<string | null> {
  try {
    const mode = getBytePlusMediaUrlMode();
    if (mode === "passthrough" && typeof value === "string" && isProviderSafeUrl(value.trim())) {
      return value.trim();
    }

    if (mode === "proxy" || mode === "cdn") {
      const key = await resolveBytePlusStorageKey(value, userId, assetType);
      if (key) return mode === "proxy" ? toBytePlusProxyUrl(key) : toBytePlusCdnUrl(key);

      if (typeof value === "string" && isProviderSafeUrl(value.trim())) {
        console.warn(`[BytePlus Media URL] ${mode} mode could not derive a storage key; preserving provider-safe HTTPS URL.`);
        return value.trim();
      }
      throw new ValidationError(`Unable to resolve BytePlus ${mode} media URL.`);
    }

    return await resolveProviderMediaUrl(value, { userId, assetType });
  } catch (err) {
    console.error(`[resolveOfficialSeedanceUrl] failed for value: ${value}`, err);
    return null;
  }
}

async function resolveOfficialSeedanceUrlList(value: unknown, userId: string, assetType: "image" | "video" | "audio", limit: number): Promise<string[]> {
  if (!Array.isArray(value)) return [];
  const resolved = await Promise.all(
    value.slice(0, limit).map((item) => resolveOfficialSeedanceUrl(item, userId, assetType)),
  );
  return resolved.filter((item): item is string => Boolean(item));
}

function normalizeOfficialSeedanceRatio(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const allowed = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  return allowed.has(raw) ? raw : "16:9";
}

function normalizeOfficialSeedanceDuration(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? Math.floor(value)
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 5;
  return Math.max(4, Math.min(15, Number.isFinite(parsed) ? parsed : 5));
}

function normalizeOfficialSeedanceResolution(modelRoute: string, value: unknown): string {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (
    modelRoute === "bytedance/seedance-v2/text-to-video-fast" ||
    modelRoute === "bytedance/seedance-v2/text-to-video-mini"
  ) {
    return raw === "480p" ? "480p" : "720p";
  }
  if (raw === "480p" || raw === "1080p") return raw;
  return "720p";
}

async function buildOfficialSeedancePayload(modelRoute: string, payload: Record<string, unknown>, userId: string) {
  const prompt = typeof payload.prompt === "string" ? sanitizePrompt(payload.prompt, 20000) : "";
  const content: Array<Record<string, unknown>> = [];
  const bytePlusMediaUrlMode = getBytePlusMediaUrlMode();
  const verifyOptions = { allowSaasMediaProxy: bytePlusMediaUrlMode === "proxy" };
  if (prompt) content.push({ type: "text", text: prompt });

  const imageUrls = Array.isArray(payload.image_urls) ? payload.image_urls : [];
  const refImagesRaw = Array.isArray(payload.reference_image_urls) ? (payload.reference_image_urls as string[]) : [];
  const firstFrame =
    (await resolveOfficialSeedanceUrl(payload.first_frame_url, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(payload.image_url, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(payload.image, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(imageUrls[0], userId, "image")) ||
    (refImagesRaw[0] ? await resolveOfficialSeedanceUrl(refImagesRaw[0], userId, "image") : null);
  const lastFrame =
    (await resolveOfficialSeedanceUrl(payload.last_frame_url, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(payload.end_image, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(payload.last_image, userId, "image")) ||
    (await resolveOfficialSeedanceUrl(imageUrls[1], userId, "image")) ||
    (refImagesRaw.length > 1 ? await resolveOfficialSeedanceUrl(refImagesRaw[1], userId, "image") : null);

  if (firstFrame) {
    await verifyPublicMediaUrl(firstFrame, "first_frame_url", { ...verifyOptions, expectedMediaKind: "image" });
    content.push({ type: "image_url", image_url: { url: firstFrame }, role: "first_frame" });
  }
  if (lastFrame) {
    await verifyPublicMediaUrl(lastFrame, "last_frame_url", { ...verifyOptions, expectedMediaKind: "image" });
    content.push({ type: "image_url", image_url: { url: lastFrame }, role: "last_frame" });
  }

  const maxReferenceImages = Math.max(0, 9 - (firstFrame ? 1 : 0) - (lastFrame ? 1 : 0));
  const referenceImages = await resolveOfficialSeedanceUrlList(payload.reference_image_urls, userId, "image", maxReferenceImages);
  for (const url of referenceImages) {
    await verifyPublicMediaUrl(url, "reference_image", { ...verifyOptions, expectedMediaKind: "image" });
    content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  }

  const referenceVideos = await resolveOfficialSeedanceUrlList(payload.reference_video_urls, userId, "video", 3);
  const singleVideo = await resolveOfficialSeedanceUrl(payload.video, userId, "video");
  const finalVideos = [...referenceVideos, ...(singleVideo ? [singleVideo] : [])].slice(0, 3);
  for (const url of finalVideos) {
    await verifyPublicMediaUrl(url, "reference_video", { ...verifyOptions, expectedMediaKind: "video" });
    content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  }

  const referenceAudios = await resolveOfficialSeedanceUrlList(payload.reference_audio_urls, userId, "audio", 3);
  for (const url of referenceAudios) {
    await verifyPublicMediaUrl(url, "reference_audio", { ...verifyOptions, expectedMediaKind: "audio" });
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }

  const imageCount = (firstFrame ? 1 : 0) + (lastFrame ? 1 : 0) + referenceImages.length;
  const videoCount = finalVideos.length;
  const audioCount = referenceAudios.length;

  if (audioCount > 0 && imageCount === 0 && videoCount === 0) {
    throw new ValidationError(
      "Seedance 2.0 does not support 'text + audio' or 'audio-only' inputs. You must provide at least one reference image or video to use audio inputs."
    );
  }

  if (content.length === 0 || !prompt) {
    throw new ValidationError("Seedance 2.0 requires a prompt.");
  }

  const body: Record<string, unknown> = {
    model: getOfficialSeedanceModel(modelRoute),
    content,
    generate_audio: payload.generate_audio === true || payload.sound === true,
    ratio: normalizeOfficialSeedanceRatio(payload.ratio ?? payload.aspect_ratio ?? payload.aspectRatio),
    duration: normalizeOfficialSeedanceDuration(payload.duration),
    resolution: normalizeOfficialSeedanceResolution(modelRoute, payload.resolution ?? payload.quality ?? payload.mode),
    watermark:
      modelRoute === "bytedance/seedance-v2/text-to-video"
        ? payload.watermark === true
        : payload.watermark === false ? false : true,
  };

  if (payload.return_last_frame === true) body.return_last_frame = true;
  if (typeof payload.callback_url === "string" && payload.callback_url.trim()) body.callback_url = payload.callback_url.trim();

  return body;
}

function normalizeInputForKie(payload: Record<string, unknown>) {
  return { ...payload };
}

function normalizeKling30Mode(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const lower = raw.toLowerCase();
  if (lower === "4k") return "4K";
  if (lower === "pro" || lower === "1080p") return "pro";
  return "std";
}

function mapToKieInput(model: string, payload: Record<string, unknown>) {
  const input: Record<string, unknown> = { ...payload };

  const startImage =
    (typeof input.first_frame_url === "string" ? input.first_frame_url : null) ||
    (typeof input.image_url === "string" ? input.image_url : null) ||
    (typeof input.image === "string" ? input.image : null);
  const endImage =
    (typeof input.last_frame_url === "string" ? input.last_frame_url : null) ||
    (typeof input.end_image === "string" ? input.end_image : null) ||
    (typeof input.last_image === "string" ? input.last_image : null);
  const referenceImages = Array.isArray(input.reference_image_urls)
    ? input.reference_image_urls.filter((v): v is string => typeof v === "string")
    : [];
  const referenceVideos = Array.isArray(input.reference_video_urls)
    ? input.reference_video_urls.filter((v): v is string => typeof v === "string")
    : [];
  const referenceAudios = Array.isArray(input.reference_audio_urls)
    ? input.reference_audio_urls.filter((v): v is string => typeof v === "string")
    : [];
  const motionVideo = typeof input.video === "string" ? input.video : null;

  if (model === "kling-3.0/video") {
    const out: Record<string, unknown> = {};
    const mode = normalizeKling30Mode(input.mode ?? input.resolution ?? input.quality);
    const sound = input.sound === true;
    const multiShots = input.multi_shots === true;
    const durationRaw = input.duration;
    const durationValue =
      typeof durationRaw === "number"
        ? durationRaw
        : typeof durationRaw === "string"
          ? Number.parseInt(durationRaw, 10)
          : 5;
    const duration = Number.isFinite(durationValue) ? Math.max(3, Math.min(15, durationValue)) : 5;
    const aspectRatio = typeof input.aspect_ratio === "string" ? input.aspect_ratio : undefined;
    const multiPrompt = Array.isArray(input.multi_prompt)
      ? input.multi_prompt
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const rec = item as Record<string, unknown>;
            const prompt = typeof rec.prompt === "string" ? rec.prompt.trim() : "";
            const shotDurationRaw = rec.duration;
            const shotDuration =
              typeof shotDurationRaw === "number"
                ? shotDurationRaw
                : typeof shotDurationRaw === "string"
                  ? Number.parseInt(shotDurationRaw, 10)
                  : NaN;
            if (!prompt) return null;
            if (!Number.isFinite(shotDuration) || shotDuration < 1 || shotDuration > 12) return null;
            return { prompt, duration: shotDuration };
          })
          .filter((x): x is { prompt: string; duration: number } => x !== null)
      : [];

    out.mode = mode;
    out.sound = sound;
    out.duration = String(duration);
    if (aspectRatio) out.aspect_ratio = aspectRatio;
    out.multi_shots = multiShots;

    // image_urls: already correctly built by the frontend (start frame + optional end frame).
    // Accept them directly from the payload rather than recomputing.
    const frontendImageUrls = Array.isArray(input.image_urls)
      ? (input.image_urls as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    if (multiShots) {
      out.multi_prompt = multiPrompt;
      // Only the first frame is supported in multi-shot
      if (frontendImageUrls.length > 0) {
        out.image_urls = [frontendImageUrls[0]];
      } else if (startImage) {
        out.image_urls = [startImage];
      }
      if (typeof input.prompt === "string") out.prompt = "";
    } else {
      out.prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      out.multi_prompt = [];
      // Use frontend-built image_urls directly (preserves start+end frame pair)
      if (frontendImageUrls.length > 0) {
        out.image_urls = frontendImageUrls.slice(0, 2);
      } else if (startImage && endImage) {
        out.image_urls = [startImage, endImage];
      } else if (startImage) {
        out.image_urls = [startImage];
      }
    }

    if (Array.isArray(input.kling_elements)) {
      out.kling_elements = (input.kling_elements as Array<Record<string, unknown>>)
        .map((el) => {
          const name = typeof el.name === "string" ? el.name.trim() : "";
          const description = typeof el.description === "string" ? el.description.trim() : "";
          const urls = Array.isArray(el.element_input_urls)
            ? (el.element_input_urls as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            : [];
          if (!name || !description || urls.length < 2 || urls.length > 4) return null;
          return { name, description, element_input_urls: urls };
        })
        .filter((x) => x !== null);
    }

    return out;
  }

  // -- Seedance 2.0 / 2.0 Fast - KIE flat input shape ---
  // Spec (docs.kie.ai/market/bytedance/seedance-2 + seedance-2-fast):
  //   prompt (REQUIRED, 3-20000)
  //   first_frame_url, last_frame_url, reference_image_urls (max 9)
  //   generate_audio (send explicitly so the user sound choice is respected)
  //   resolution: HQ allows 480p/720p/1080p; Fast allows 480p/720p only
  //   aspect_ratio: 1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9 / adaptive (default 16:9)
  //   duration: 4-15 (integer)
  if (model === "bytedance/seedance-2" || model === "bytedance/seedance-2-fast" || model === "bytedance/seedance-2-mini") {
    const isFast = model === "bytedance/seedance-2-fast";
    const out: Record<string, unknown> = { ...input };

    // Map start/first frame
    if (startImage) {
      out.first_frame_url = startImage;
    } else if (referenceImages.length > 0) {
      out.first_frame_url = referenceImages[0];
    } else {
      delete out.first_frame_url;
    }

    // Map end/last frame
    if (endImage) {
      out.last_frame_url = endImage;
    } else if (referenceImages.length > 1) {
      out.last_frame_url = referenceImages[1];
    } else {
      delete out.last_frame_url;
    }

    // Map reference images list
    if (referenceImages.length > 0) {
      out.reference_image_urls = referenceImages.slice(0, 9);
    } else {
      delete out.reference_image_urls;
    }

    // Reference videos: max 3, total duration <=15s (validated client-side)
    // KIE field name in spec has a trailing space: 'reference_video_urls ' - using
    // the trimmed name; if KIE rejects, switch to the spec literal.
    if (referenceVideos.length > 0) {
      out.reference_video_urls = referenceVideos.slice(0, 3);
    } else {
      delete out.reference_video_urls;
    }

    // Reference audios: max 3, total duration <=15s
    if (referenceAudios.length > 0) {
      out.reference_audio_urls = referenceAudios.slice(0, 3);
    } else {
      delete out.reference_audio_urls;
    }

    // Clean generic aliases never used by Seedance
    delete out.image;
    delete out.image_url;
    delete out.end_image;
    delete out.last_image;
    delete out.image_urls;
    delete out.video;
    delete out.size;
    delete out.mode;
    delete out.quality;

    // duration must be integer in [4, 15]
    const rawDur = typeof out.duration === "string" ? Number.parseInt(out.duration, 10)
                 : typeof out.duration === "number" ? Math.floor(out.duration)
                 : 5;
    out.duration = Math.max(4, Math.min(15, Number.isFinite(rawDur) ? rawDur : 5));

    // resolution: clamp Fast variant to 720p max (KIE rejects 1080p there)
    const rawRes = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "";
    const validRes = isFast
      ? (rawRes === "480p" ? "480p" : "720p")
      : (rawRes === "480p" ? "480p" : rawRes === "1080p" ? "1080p" : "720p");
    out.resolution = validRes;

    // aspect_ratio is REQUIRED per spec - default to 16:9 if missing
    const allowedAR = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"]);
    if (typeof out.aspect_ratio !== "string" || !allowedAR.has(out.aspect_ratio)) {
      out.aspect_ratio = "16:9";
    }

    // generate_audio: always send explicit boolean so the user sound choice is respected. KIE logs currently show the same Seedance 2 cost either way.
    out.generate_audio = out.generate_audio === true;

    // prompt length: hard cap at 20000 chars (KIE limit)
    if (typeof out.prompt === "string" && out.prompt.length > 20000) {
      out.prompt = out.prompt.slice(0, 20000);
    }

    return out;
  }

  // -- Hailuo 2.3 - strict whitelist; image_url (singular string), 10s+1080P unsupported --
  // KIE accepts ONLY: prompt, image_url, duration ("6"|"10"), resolution ("768P"|"1080P"), nsfw_checker
  if (model === "hailuo/2-3-image-to-video-standard" || model === "hailuo/2-3-image-to-video-pro") {
    const out: Record<string, unknown> = {};
    if (typeof input.prompt === "string") out.prompt = input.prompt;
    if (startImage) out.image_url = startImage;
    // Duration: must be string "6" or "10"
    const durRaw = typeof input.duration === "number" ? input.duration
                 : typeof input.duration === "string" ? Number(input.duration) : 6;
    let durStr: "6" | "10" = durRaw >= 10 ? "10" : "6";
    // Resolution: must be "768P" or "1080P"
    const resRaw = typeof input.resolution === "string" ? input.resolution.toUpperCase() : "768P";
    let resStr: "768P" | "1080P" = resRaw === "1080P" ? "1080P" : "768P";
    // ENFORCE: 10s NOT supported with 1080P -> downgrade resolution to 768P
    if (durStr === "10" && resStr === "1080P") {
      console.warn("[hailuo-2.3] 10s + 1080P not supported by KIE - downgrading resolution to 768P");
      resStr = "768P";
    }
    out.duration = durStr;
    out.resolution = resStr;
    if (typeof input.nsfw_checker === "boolean") out.nsfw_checker = input.nsfw_checker;
    return out;
  }

  // -- Kling V3 Turbo (T2V + I2V) - KIE input shape ---
  if (
    model === "kling/v3-turbo-text-to-video" ||
    model === "kling/v3-turbo-image-to-video"
  ) {
    const isI2V = model === "kling/v3-turbo-image-to-video";
    const out: Record<string, unknown> = {};
    out.prompt = typeof input.prompt === "string" ? input.prompt : "";
    
    // Duration: string enum (default '5')
    const durRaw = typeof input.duration === "number" ? input.duration
                 : typeof input.duration === "string" ? Number(input.duration) : 5;
    out.duration = String(durRaw);
    
    // Resolution: string enum '720p' or '1080p'
    const resRaw = typeof input.resolution === "string" ? input.resolution.toLowerCase() : "720p";
    out.resolution = resRaw === "1080p" ? "1080p" : "720p";

    if (isI2V) {
      // image_urls is required array of strings
      if (startImage) {
        out.image_urls = [startImage];
      } else if (Array.isArray(input.image_urls) && input.image_urls.length > 0) {
        out.image_urls = input.image_urls;
      } else if (typeof input.image === "string") {
        out.image_urls = [input.image];
      } else {
        out.image_urls = [];
      }
    } else {
      // aspect_ratio: required only for text-to-video
      const arRaw = typeof input.aspect_ratio === "string" ? input.aspect_ratio : "16:9";
      out.aspect_ratio = ["16:9", "9:16", "1:1"].includes(arRaw) ? arRaw : "16:9";
    }

    return out;
  }

  // -- Kling 2.5 Turbo Pro (T2V + I2V) - KIE flat input shape ---
  // T2V: { prompt, duration ('5'|'10'), aspect_ratio, negative_prompt?, cfg_scale? }
  // I2V: { prompt, image_url, duration ('5'|'10'), negative_prompt?, cfg_scale? }
  if (
    model === "kling/v2-5-turbo-text-to-video-pro" ||
    model === "kling/v2-5-turbo-image-to-video-pro"
  ) {
    const isI2V = model === "kling/v2-5-turbo-image-to-video-pro";
    const out: Record<string, unknown> = {};
    out.prompt = typeof input.prompt === "string" ? input.prompt : "";
    const dur = typeof input.duration === "number"
      ? input.duration
      : typeof input.duration === "string" ? Number(input.duration) : 5;
    out.duration = dur >= 10 ? "10" : "5";
    if (!isI2V && typeof input.aspect_ratio === "string") {
      out.aspect_ratio = input.aspect_ratio;
    }
    if (typeof input.negative_prompt === "string" && input.negative_prompt.trim()) {
      out.negative_prompt = input.negative_prompt;
    }
    if (typeof input.cfg_scale === "number") {
      out.cfg_scale = input.cfg_scale;
    }
    if (isI2V && startImage) {
      out.image_url = startImage;
    }
    return out;
  }

  // -- Sora 2 - confirmed against KIE OpenAPI spec --
  // T2V:     prompt (req), aspect_ratio ("portrait"|"landscape"), n_frames ("10"|"15"),
  //          remove_watermark, character_id_list, upload_method ("s3"|"oss", REQUIRED, default s3)
  // I2V:     adds image_urls (array, maxItems 1, REQUIRED)
  // Pro T2V: adds size ("standard"|"high", default high)
  if (model === "sora-2-text-to-video" || model === "sora-2-image-to-video" || model === "sora-2-pro-text-to-video") {
    const out: Record<string, unknown> = {};
    out.prompt = typeof input.prompt === "string" ? input.prompt : "";
    // aspect_ratio: KIE requires LOWERCASE "portrait" or "landscape"
    const arRaw = typeof input.aspect_ratio === "string" ? input.aspect_ratio.toLowerCase() : "landscape";
    out.aspect_ratio = arRaw === "portrait" ? "portrait" : "landscape";
    // n_frames: KIE requires string "10" or "15" (NO 's' suffix)
    const soraDur = typeof input.duration === "number" ? input.duration
                  : typeof input.duration === "string" ? Number(input.duration) : 10;
    out.n_frames = soraDur >= 15 ? "15" : "10";
    // remove_watermark: pass through if explicitly set
    if (typeof input.remove_watermark === "boolean") out.remove_watermark = input.remove_watermark;
    // character_id_list: optional, max 5
    if (Array.isArray(input.character_id_list) && input.character_id_list.length > 0) {
      out.character_id_list = input.character_id_list.slice(0, 5);
    }
    // upload_method: REQUIRED - default to s3
    out.upload_method = (input.upload_method === "oss") ? "oss" : "s3";
    // I2V: image_urls (array of 1, REQUIRED)
    if (model === "sora-2-image-to-video") {
      if (startImage) out.image_urls = [startImage];
      else if (Array.isArray(input.image_urls)) out.image_urls = input.image_urls.slice(0, 1);
    }
    // Pro: size ("standard" | "high", default high)
    if (model === "sora-2-pro-text-to-video") {
      out.size = input.size === "standard" ? "standard" : "high";
    }
    return out;
  }

  // -- Grok Imagine T2V/I2V --
  // Confirmed: https://docs.kie.ai/market/grok-imagine/text-to-video
  //            https://docs.kie.ai/market/grok-imagine/image-to-video
  // T2V duration is NUMBER 6-30; I2V duration is STRING (per OpenAPI).
  // I2V: image_urls (max 7) OR task_id+index (mutually exclusive). prompt optional.
  // mode: fun|normal|spicy (spicy NOT allowed for I2V with external images).
  // aspect_ratio default 2:3 (T2V) / inherited from image (I2V single).
  if (model === "grok-imagine/text-to-video" || model === "grok-imagine/image-to-video") {
    const isI2V = model === "grok-imagine/image-to-video";
    const out: Record<string, unknown> = {};
    if (typeof input.prompt === "string" && input.prompt.trim()) {
      out.prompt = input.prompt.slice(0, 5000);
    } else if (!isI2V) {
      out.prompt = ""; // T2V requires prompt
    }
    // aspect_ratio: validate against allowed enum
    const arRaw = typeof input.aspect_ratio === "string" ? input.aspect_ratio : "";
    if (["2:3", "3:2", "1:1", "16:9", "9:16"].includes(arRaw)) {
      out.aspect_ratio = arRaw;
    }
    // resolution: only 480p / 720p
    const resRaw = typeof input.resolution === "string" ? input.resolution.toLowerCase() : "";
    if (resRaw === "480p" || resRaw === "720p") out.resolution = resRaw;
    // duration: 6-30. T2V wants number, I2V wants string per spec.
    const grokDurNum = typeof input.duration === "number" ? input.duration
      : typeof input.duration === "string" ? Number(input.duration) : 6;
    if (Number.isFinite(grokDurNum)) {
      const clamped = Math.max(6, Math.min(30, Math.round(grokDurNum)));
      out.duration = isI2V ? String(clamped) : clamped;
    }
    // mode: fun | normal | spicy
    const modeRaw = typeof input.mode === "string" ? input.mode.toLowerCase() : "";
    if (modeRaw === "fun" || modeRaw === "normal" || modeRaw === "spicy") {
      out.mode = modeRaw;
    }
    // nsfw_checker pass-through
    if (typeof input.nsfw_checker === "boolean") out.nsfw_checker = input.nsfw_checker;
    if (isI2V) {
      // task_id + index path (mutually exclusive with image_urls)
      const taskIdRaw = typeof input.task_id === "string" ? input.task_id.trim() : "";
      if (taskIdRaw && referenceImages.length === 0 && !startImage) {
        out.task_id = taskIdRaw.slice(0, 100);
        const idx = typeof input.index === "number" ? input.index : 0;
        if (Number.isFinite(idx)) out.index = Math.max(0, Math.min(5, Math.round(idx)));
      } else {
        // image_urls: prefer references, fall back to startImage. Cap at 7.
        if (referenceImages.length > 0) out.image_urls = referenceImages.slice(0, 7);
        else if (startImage) out.image_urls = [startImage];
        // Spicy mode is NOT available with external images - downgrade to normal
        if (out.mode === "spicy" && Array.isArray(out.image_urls) && out.image_urls.length > 0) {
          console.warn("[grok-imagine] Spicy mode unavailable with external images, downgrading to normal");
          out.mode = "normal";
        }
      }
    }
    // T2V: ignore any image inputs - endpoint does not accept them
    return out;
  }

  // -- Veo 3.1 - dedicated /api/v1/veo/generate endpoint with camelCase fields --
  // Confirmed: https://docs.kie.ai/veo3-api/generate-veo-3-video
  // - model enum: veo3 | veo3_fast | veo3_lite (passed as `model` field, NOT in URL)
  // - imageUrls: camelCase array (1 image = animate-around / 2 images = first+last frame
  //   transition / 1-3 images = REFERENCE_2_VIDEO mode, fast model only)
  // - aspect_ratio: "16:9" | "9:16" | "Auto"
  // - resolution: "720p" | "1080p" | "4k" (4k requires extra credits via separate endpoint)
  // - generationType: TEXT_2_VIDEO | FIRST_AND_LAST_FRAMES_2_VIDEO | REFERENCE_2_VIDEO
  // - enableTranslation (default true), watermark (optional), seeds (optional)
  // - NO duration field (fixed ~8s by model), NO sound field (audio always-on)
  if (model === "veo3" || model === "veo3_fast" || model === "veo3_lite") {
    const out: Record<string, unknown> = {};
    out.model = model;
    out.prompt = typeof input.prompt === "string" ? input.prompt : "";
    // aspect_ratio/aspectRatio: KIE docs currently show both spellings; send both for compatibility.
    const arRaw = typeof input.aspect_ratio === "string" ? input.aspect_ratio : "16:9";
    let veoAspectRatio = "16:9";
    if (arRaw === "9:16" || arRaw === "Auto" || arRaw === "auto") {
      veoAspectRatio = arRaw === "auto" ? "Auto" : arRaw;
    }
    out.aspect_ratio = veoAspectRatio;
    out.aspectRatio = veoAspectRatio;
    // imageUrls: collect from various sources (max 3 for REFERENCE, 2 for first+last, 1 for animate)
    const collected: string[] = [];
    const explicitReferenceMode = referenceImages.length > 0;
    if (referenceImages.length > 0) {
      collected.push(...referenceImages.slice(0, 3));
    } else {
      if (startImage) collected.push(startImage);
      if (endImage && endImage !== startImage) collected.push(endImage);
    }
    const isReferenceMode = model === "veo3_fast" && explicitReferenceMode && collected.length > 0;
    const imageLimit = isReferenceMode ? 3 : 2;
    if (collected.length > 0) out.imageUrls = collected.slice(0, imageLimit);
    // generationType: explicit when reference mode is requested by frontend
    if (typeof input.generation_type === "string") {
      const gt = input.generation_type;
      if (gt === "TEXT_2_VIDEO" || gt === "FIRST_AND_LAST_FRAMES_2_VIDEO" || gt === "REFERENCE_2_VIDEO") {
        out.generationType = gt;
      }
    }
    if (!out.generationType) {
      out.generationType = collected.length === 0
        ? "TEXT_2_VIDEO"
        : isReferenceMode
          ? "REFERENCE_2_VIDEO"
          : "FIRST_AND_LAST_FRAMES_2_VIDEO";
    }
    // Optional pass-throughs
    if (typeof input.watermark === "string" && input.watermark.trim()) {
      out.watermark = input.watermark.trim();
    }
    out.enableTranslation = typeof input.enable_translation === "boolean" ? input.enable_translation : true;
    if (typeof input.seeds === "number" && Number.isFinite(input.seeds)) {
      out.seeds = input.seeds;
    }
    return out;
  }

  // -- Kling 3.0 Motion Control - KIE flat input shape ---
  // Required: input_urls (1 image), video_urls (1 video). Optional: prompt,
  // mode ("std"|"pro"), character_orientation ("video"|"image"),
  // background_source ("input_video"|"input_image"). NO duration/aspect_ratio.
  if (model === "kling-3.0/motion-control") {
    const out: Record<string, unknown> = {};
    out.prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 2500) : "";
    if (startImage) out.input_urls = [startImage];
    if (motionVideo) out.video_urls = [motionVideo];

    // resolution ("720p"|"1080p") -> mode ("720p"|"1080p")
    const res = typeof input.resolution === "string" ? input.resolution.toLowerCase() : "";
    if (res.includes("1080")) {
      out.mode = "1080p";
    } else {
      out.mode = "720p";
    }

    // orientation ("video"|"image") -> character_orientation
    if (input.orientation === "video" || input.orientation === "image") {
      out.character_orientation = input.orientation;
    }

    // scene_control_mode toggle -> background_source
    // toggle ON -> use image background; OFF (default) -> use video background
    if (input.scene_control_mode === true) {
      out.background_source = "input_image";
    } else if (input.scene_control_mode === false) {
      out.background_source = "input_video";
    }

    return out;
  }

  // -- Gemini Omni Video - KIE flat input shape ---
  if (model === "gemini-omni-video") {
    const out: Record<string, unknown> = {};
    out.prompt = typeof input.prompt === "string" ? input.prompt : "";
    
    // 1. duration: REQUIRED string ("4" | "6" | "8" | "10")
    const durRaw = typeof input.duration === "number" ? input.duration
                 : typeof input.duration === "string" ? Number(input.duration) : 8;
    // Map to nearest allowed enum string
    let durStr = "8";
    if (durRaw <= 4) durStr = "4";
    else if (durRaw <= 6) durStr = "6";
    else if (durRaw <= 8) durStr = "8";
    else durStr = "10";
    out.duration = durStr;

    // 2. aspect_ratio: "16:9" | "9:16"
    const arRaw = typeof input.aspect_ratio === "string" ? input.aspect_ratio : "16:9";
    out.aspect_ratio = (arRaw === "9:16") ? "9:16" : "16:9";

    // 3. resolution: "720p" | "1080p" | "4k"
    const resRaw = typeof input.resolution === "string" ? input.resolution.toLowerCase() : "720p";
    if (["720p", "1080p", "4k"].includes(resRaw)) {
      out.resolution = resRaw;
    } else {
      out.resolution = "720p";
    }

    // 4. image_urls: collect references + start/end images
    const collectedImages: string[] = [];
    if (referenceImages.length > 0) {
      collectedImages.push(...referenceImages);
    }
    if (startImage) {
      collectedImages.push(startImage);
    }
    if (endImage && endImage !== startImage) {
      collectedImages.push(endImage);
    }
    if (collectedImages.length > 0) {
      // Unique and cap at 7
      out.image_urls = Array.from(new Set(collectedImages)).slice(0, 7);
    }

    // 5. video_list: if motion video is provided
    if (motionVideo) {
      out.video_list = [
        {
          url: motionVideo,
          start: 0,
          ends: 10
        }
      ];
    }

    // 6. seed
    if (typeof input.seed === "number") {
      out.seed = input.seed;
    }

    return out;
  }

  // Generic fallback path (any model not handled above)
  if (referenceImages.length) {
    input.image_urls = referenceImages;
  } else if (startImage && endImage) {
    input.image_urls = [startImage, endImage];
  } else if (startImage) {
    input.image_urls = [startImage];
  }

  delete input.image;
  delete input.image_url;
  delete input.first_frame_url;
  delete input.last_frame_url;
  delete input.end_image;
  delete input.last_image;
  delete input.reference_image_urls;
  delete input.video;

  if (typeof input.duration === "number") {
    input.duration = String(input.duration);
  }

  return input;
}

function normalizeTaskState(status: string) {
  const s = (status || "").toLowerCase();
  if (["success", "succeed", "succeeded", "completed", "done", "finish", "finished"].includes(s)) return "completed";
  if (["fail", "failed", "error", "canceled", "cancelled"].includes(s)) return "failed";
  return "processing";
}

function extractOutputs(resultPayload: unknown): string[] {
  if (!resultPayload) return [];

  if (typeof resultPayload === "string") {
    if (/^https?:\/\//.test(resultPayload)) return [resultPayload];
    const urlMatches = resultPayload.match(/https?:\/\/[^\s"'<>\\]+/g);
    if (urlMatches?.length) return urlMatches;
    try {
      const parsed = JSON.parse(resultPayload);
      return extractOutputs(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(resultPayload)) {
    const fromItems: string[] = [];
    for (const item of resultPayload) {
      const extracted = extractOutputs(item);
      if (extracted.length) fromItems.push(...extracted);
    }
    return fromItems;
  }

  if (typeof resultPayload === "object") {
    const data = resultPayload as Record<string, unknown>;
    const candidates = [
      data.resultUrls,
      data.outputs,
      data.urls,
      data.videos,
      data.images,
      data.result,
      data.videoUrl,
      data.video_url,
      data.lastFrameUrl,
      data.last_frame_url,
      data.fileUrl,
      data.file_url,
      data.imageUrl,
      data.image_url,
      data.url,
    ];
    for (const candidate of candidates) {
      const extracted = extractOutputs(candidate);
      if (extracted.length) return extracted;
    }

    const nested: string[] = [];
    for (const value of Object.values(data)) {
      const extracted = extractOutputs(value);
      if (extracted.length) nested.push(...extracted);
    }
    return nested;
  }

  return [];
}

function validateKling30Payload(payload: Record<string, unknown>): string | null {
  const mode = typeof payload.mode === "string" ? payload.mode : "std";
  if (!["std", "pro", "4K"].includes(mode)) return "Kling 3.0 mode must be std, pro, or 4K.";

  const durationRaw = payload.duration;
  const duration =
    typeof durationRaw === "number"
      ? durationRaw
      : typeof durationRaw === "string"
        ? Number.parseInt(durationRaw, 10)
        : NaN;
  if (!Number.isFinite(duration) || duration < 3 || duration > 15) {
    return "Kling 3.0 duration must be between 3 and 15 seconds.";
  }

  const multiShots = payload.multi_shots === true;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const imageUrls = Array.isArray(payload.image_urls)
    ? payload.image_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const refImages = Array.isArray(payload.reference_image_urls)
    ? payload.reference_image_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  if (refImages.length > 3) return "Kling 3.0 supports at most 3 reference images.";

  if (!multiShots) {
    if (!prompt) return "Kling 3.0 single-shot requires prompt.";
    if (imageUrls.length > 2) return "Kling 3.0 supports at most 2 image_urls in single-shot.";
  }

  const shots = Array.isArray(payload.multi_prompt) ? payload.multi_prompt : [];
  if (multiShots) {
    if (shots.length < 1 || shots.length > 5) return "Kling 3.0 multi-shot supports 1 to 5 shots.";
    if (imageUrls.length > 1) return "Kling 3.0 multi-shot supports only first frame image.";
    let sum = 0;
    for (const item of shots) {
      if (!item || typeof item !== "object") return "Invalid multi_prompt entry.";
      const record = item as Record<string, unknown>;
      const shotPrompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
      const shotDuration =
        typeof record.duration === "number"
          ? record.duration
          : typeof record.duration === "string"
            ? Number.parseInt(record.duration, 10)
            : NaN;
      if (!shotPrompt || shotPrompt.length > 500) return "Each multi-shot prompt must be 1..500 chars.";
      if (!Number.isFinite(shotDuration) || shotDuration < 1 || shotDuration > 12) {
        return "Each multi-shot duration must be 1..12 seconds.";
      }
      sum += shotDuration;
    }
    if (sum !== duration) return "Sum of multi-shot durations must equal total duration.";
  }

  const klingElements = Array.isArray(payload.kling_elements) ? payload.kling_elements : [];
  if (klingElements.length > 3) return "Kling 3.0 supports maximum 3 elements.";
  if (klingElements.length > 0) {
    const allPrompts = [
      prompt,
      ...shots
        .map((s) => (s && typeof s === "object" && typeof (s as Record<string, unknown>).prompt === "string"
          ? String((s as Record<string, unknown>).prompt)
          : ""))
        .filter(Boolean),
    ].join(" ");

    for (const el of klingElements) {
      if (!el || typeof el !== "object") return "Invalid kling_elements entry.";
      const record = el as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const desc = typeof record.description === "string" ? record.description.trim() : "";
      const urls = Array.isArray(record.element_input_urls)
        ? record.element_input_urls.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      if (!name || !desc) return "Each element must include name and description.";
      if (urls.length < 2 || urls.length > 4) return `Element ${name} must include 2 to 4 URLs.`;
      if (!allPrompts.includes(`@${name}`)) return `Element @${name} is not referenced in prompts.`;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  let chargedCredits = 0;
  let chargedUserId: string | null = null;
  let generationId: string | null = null;
  const idempotencyKey = getIdempotencyKey(req.headers);
  let requestHash: string | null = null;
  let idempotencyClaimed = false;
  let providerDispatched = false;
  let idempotencyUserId: string | null = null;

  try {
    await syncKieModelCatalog(false).catch(() => null);

    if (!isAllowedOrigin(req.headers.get("origin"))) {
      return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
    }

    let { userId } = await auth();
    if (!userId && process.env.NODE_ENV !== "production") {
      userId = "user_3CMgl0E1u3OcgATvBIZR3rByAXo";
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    chargedUserId = userId;

    const ip = getClientIp(req);
    const rate = checkRateLimit(`video:${userId}:${ip}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rate) });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    requestHash = hashRequestBody(body);
    let { modelRoute, payload } = body as {
      modelRoute?: string;
      payload?: Record<string, unknown>;
    };

    const profileIdFromHeader = req.headers.get("x-profile-id") || req.cookies.get("saad_active_profile_id")?.value;
    const profileId = typeof (body as any)?.profileId === "string" ? (body as any).profileId : profileIdFromHeader || null;

    if (!modelRoute || typeof modelRoute !== "string") {
      return NextResponse.json({ error: "modelRoute is required" }, { status: 400 });
    }

    try {
      assertVideoRouteAllowed(modelRoute);
    } catch (routeError) {
      if (routeError instanceof BlockedVideoRouteError) {
        return NextResponse.json({ error: routeError.message, code: routeError.code }, { status: routeError.status });
      }
      throw routeError;
    }

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "payload is required" }, { status: 400 });
    }

    try {
      await assertMobileCapabilityAllowed("mobile.video.generate.enabled", req.headers.get("user-agent"));
    } catch (mobileErr) {
      if (mobileErr instanceof MobileCapabilityDisabledError) {
        return NextResponse.json({ error: mobileErr.message, code: "mobile_capability_disabled" }, { status: 403 });
      }
    }

    const hasImage = payloadHasImageInput(payload);
    const hasDirectStartImage =
      hasNonEmptyString(payload.first_frame_url) ||
      hasNonEmptyString(payload.image_url) ||
      hasNonEmptyString(payload.imageUrl) ||
      hasNonEmptyString(payload.image) ||
      hasNonEmptyString(payload.start_frame);

    const requestedRes = String(payload.resolution ?? payload.quality ?? payload.mode ?? "").trim().toLowerCase();
    const isNonTurboRes = requestedRes === "480p" || requestedRes === "4k";

    // Canonical Route Normalization & Auto-routing between Text-to-Video and Image-to-Video
    if (modelRoute.startsWith("bytedance/seedance-2.5")) {
      modelRoute = resolveSeedance25Route(modelRoute, payload);
    } else if (modelRoute.includes("seedance")) {
      if (modelRoute.includes("mini")) {
        const isTurbo = modelRoute.includes("turbo") && !isNonTurboRes;
        const isSpicy = modelRoute.includes("spicy");
        const isExtend = modelRoute.includes("extend") || (typeof payload.video === "string" && payload.video.trim().length > 0 && !modelRoute.includes("edit"));
        const isEdit = modelRoute.includes("edit");

        if (isTurbo) {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0-mini/image-to-video-turbo" : "bytedance/seedance-2.0-mini/text-to-video-turbo";
        } else if (isSpicy) {
          modelRoute = "bytedance/seedance-2.0-mini/image-to-video-spicy";
        } else if (isExtend) {
          modelRoute = "bytedance/seedance-2.0-mini/video-extend";
        } else if (isEdit) {
          modelRoute = isTurbo ? "bytedance/seedance-2.0-mini/video-edit-turbo" : "bytedance/seedance-2.0-mini/video-edit";
        } else {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0-mini/image-to-video" : "bytedance/seedance-2.0-mini/text-to-video";
        }
      } else if (modelRoute.includes("fast")) {
        const isTurbo = modelRoute.includes("turbo") && !isNonTurboRes;
        const isSpicy = modelRoute.includes("spicy");
        const isExtend = modelRoute.includes("extend") || (typeof payload.video === "string" && payload.video.trim().length > 0 && !modelRoute.includes("edit"));
        const isEdit = modelRoute.includes("edit");

        if (isTurbo) {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0-fast/image-to-video-turbo" : "bytedance/seedance-2.0-fast/text-to-video-turbo";
        } else if (isSpicy) {
          modelRoute = "bytedance/seedance-2.0-fast/image-to-video-spicy";
        } else if (isExtend) {
          modelRoute = "bytedance/seedance-2.0-fast/video-extend";
        } else if (isEdit) {
          modelRoute = isTurbo ? "bytedance/seedance-2.0-fast/video-edit-turbo" : "bytedance/seedance-2.0-fast/video-edit";
        } else {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0-fast/image-to-video" : "bytedance/seedance-2.0-fast/text-to-video";
        }
      } else {
        const isTurbo = modelRoute.includes("turbo") && !isNonTurboRes;
        const isSpicy = modelRoute.includes("spicy");
        const isExtend = modelRoute.includes("extend") || (typeof payload.video === "string" && payload.video.trim().length > 0 && !modelRoute.includes("edit"));
        const isEdit = modelRoute.includes("edit");

        if (isTurbo) {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0/image-to-video-turbo" : "bytedance/seedance-2.0/text-to-video-turbo";
        } else if (isSpicy) {
          modelRoute = "bytedance/seedance-2.0/image-to-video-spicy";
        } else if (isExtend) {
          modelRoute = "bytedance/seedance-2.0/video-extend";
        } else if (isEdit) {
          modelRoute = isTurbo ? "bytedance/seedance-2.0/video-edit-turbo" : "bytedance/seedance-2.0/video-edit";
        } else {
          modelRoute = hasDirectStartImage ? "bytedance/seedance-2.0/image-to-video" : "bytedance/seedance-2.0/text-to-video";
        }
      }
    } else if (modelRoute.includes("kling") && !modelRoute.startsWith("kwaivgi/kling-v4.0/") && modelRoute !== "kwaivgi/kling-v2.6-std/motion-control") {
      const requestedKlingTier = typeof payload?.quality === "string"
        ? payload.quality.toLowerCase()
        : typeof payload?.resolution === "string"
          ? payload.resolution.toLowerCase()
          : typeof payload?.mode === "string"
            ? payload.mode.toLowerCase()
            : "";
      const wantsKlingPro = requestedKlingTier === "pro" || requestedKlingTier === "1080p";
      const wantsKling4k = requestedKlingTier === "4k";
      const klingO3Tier = wantsKling4k ? "4k" : wantsKlingPro ? "pro" : "std";
      if (modelRoute.includes("kling-video-o3")) {
        const hasReferenceVideo =
          (typeof payload.video_url === "string" && payload.video_url.trim().length > 0) ||
          (Array.isArray(payload.video_urls) && payload.video_urls.some((value) => typeof value === "string" && value.trim().length > 0)) ||
          (Array.isArray(payload.reference_video_urls) && payload.reference_video_urls.some((value) => typeof value === "string" && value.trim().length > 0));
        const imageCount =
          (Array.isArray(payload.image_urls) ? payload.image_urls.length : 0) ||
          (Array.isArray(payload.reference_image_urls) ? payload.reference_image_urls.length : 0) ||
          (hasImage ? 1 : 0);
        const mode = hasReferenceVideo || imageCount > 2
          ? "reference-to-video"
          : hasImage
            ? "image-to-video"
            : "text-to-video";
        modelRoute = `kwaivgi/kling-video-o3-${klingO3Tier}/${mode}`;
      } else if (modelRoute.includes("kling-v2.6")) {
        const tier = wantsKlingPro ? "pro" : "std";
        modelRoute = `kwaivgi/kling-v2.6-${tier}/${hasImage ? "image-to-video" : "text-to-video"}`;
      } else if (modelRoute.includes("kling-v3-turbo-pro")) {
        modelRoute = "kwaivgi/kling-v3-turbo-pro/image-to-video";
      } else if (modelRoute.includes("kling-v3-turbo-std")) {
        modelRoute = "kwaivgi/kling-v3-turbo-std/image-to-video";
      } else if (modelRoute.includes("v3-turbo") || modelRoute.includes("turbo")) {
        modelRoute = hasImage
          ? (wantsKlingPro ? "kwaivgi/kling-v3-turbo-pro/image-to-video" : "kwaivgi/kling-v3-turbo-std/image-to-video")
          : "kling/v3-turbo-text-to-video";
      } else if (modelRoute.includes("2.6")) {
        const tier = wantsKlingPro ? "pro" : "std";
        modelRoute = `kwaivgi/kling-v2.6-${tier}/${hasImage ? "image-to-video" : "text-to-video"}`;
      } else if (modelRoute.includes("v2-5-turbo")) {
        modelRoute = hasImage ? "kling/v2-5-turbo-image-to-video-pro" : "kling/v2-5-turbo-text-to-video-pro";
      } else if (modelRoute.includes("motion-control")) {
        modelRoute = "kwaivgi/kling-v3.0-pro/motion-control";
      } else if (modelRoute.includes("kling-v3.0")) {
        modelRoute = hasImage
          ? (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/image-to-video" : "kwaivgi/kling-v3.0-std/image-to-video")
          : (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/text-to-video" : "kwaivgi/kling-v3.0-std/text-to-video");
      } else {
        // Generic Kling 3.0 alias.
        modelRoute = hasImage
          ? (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/image-to-video" : "kwaivgi/kling-v3.0-std/image-to-video")
          : (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/text-to-video" : "kwaivgi/kling-v3.0-std/text-to-video");
      }
    } else if (modelRoute.includes("seedream")) {
      modelRoute = "bytedance/seedream-v5.0-pro/edit";
    } else if (modelRoute.includes("gpt-image")) {
      modelRoute = "gpt-image-2-text-to-image";
    } else {
      // Auto-routing for non-WaveSpeed models
      if (hasImage) {
        if (modelRoute === "openai/sora-2/text-to-video") {
          modelRoute = "openai/sora-2/image-to-video";
        } else if (modelRoute === "x-ai/grok-imagine-video/text-to-video") {
          modelRoute = "x-ai/grok-imagine-video/edit-video";
        } else if (modelRoute === "hailuo/02-text-to-video-pro" || modelRoute === "hailuo/02-text-to-video-standard") {
          modelRoute = "hailuo/02-image-to-video-pro";
        }
      } else {
        if (modelRoute === "openai/sora-2/image-to-video") {
          modelRoute = "openai/sora-2/text-to-video";
        } else if (modelRoute === "x-ai/grok-imagine-video/edit-video") {
          modelRoute = "x-ai/grok-imagine-video/text-to-video";
        } else if (modelRoute === "hailuo/02-image-to-video-pro") {
          modelRoute = "hailuo/02-text-to-video-pro";
        }
      }
    }

    let isDirectGoogleVeo31Route = isGoogleVideoRoute(modelRoute);
    
    // WaveSpeed Models Checklist Bypass
    const isWaveSpeedOnlyModel = 
      modelRoute.startsWith("minimax/") ||
      modelRoute.startsWith("minimax-") ||
      modelRoute.startsWith("hailuo/") ||
      modelRoute.startsWith("bytedance/seedance-2.0") ||
      modelRoute.includes("seedance") ||
      modelRoute === "kwaivgi/kling-v3.0-std/text-to-video" ||
      modelRoute === "kwaivgi/kling-v3.0-std/image-to-video" ||
      modelRoute === "kwaivgi/kling-v3.0-pro/image-to-video" ||
      modelRoute.startsWith("kwaivgi/kling-v4.0/") ||
      modelRoute === "kwaivgi/kling-v2.6-std/motion-control" ||
      modelRoute === "wavespeed-ai/openjutsu/object-swap" ||
      modelRoute === "wavespeed-ai/video-upscaler" ||
      modelRoute === "wavespeed-ai/ultimate-video-upscaler" ||
      modelRoute === "kwaivgi/kling-v3-turbo-std/image-to-video" ||
      modelRoute === "kwaivgi/kling-v3-turbo-pro/image-to-video" ||
      modelRoute.startsWith("kwaivgi/kling-video-o3-") ||
      modelRoute.startsWith("kwaivgi/kling-v2.6-") ||
      modelRoute === "kwaivgi/kling-v3.0-pro/text-to-video" ||
      modelRoute.startsWith("kling/v3-turbo") ||
      modelRoute.startsWith("kling/v2-5-turbo") ||
      modelRoute.startsWith("alibaba/wan-3.0") ||
      modelRoute.startsWith("black-forest-labs/") ||
      modelRoute.startsWith("black-forest-labs-flux-3") ||
      modelRoute.startsWith("x-ai/") ||
      modelRoute === "bytedance/seedream-v5.0-pro/edit" ||
      modelRoute === "gpt-image-2-text-to-image";

    const dynamicVideoModels = await getCentralizedDynamicVideoModels();
    let dynamicVideoModel = dynamicVideoModels.find(
      (m) => (m.api_route === modelRoute || m.id === modelRoute || m.text_api_route === modelRoute || m.image_api_route === modelRoute || m.reference_api_route === modelRoute || (m as any).video_api_route === modelRoute || (m as any).edit_api_route === modelRoute || (m as any).start_end_api_route === modelRoute) && m.isActive !== false
    );

    // Intelligent background sub-route dispatch for unified dynamic models
    if (dynamicVideoModel) {
      const dynamicHasVideoInput =
        (typeof payload.video === "string" && payload.video.trim().length > 0) ||
        hasNonEmptyString(payload.video_url) ||
        hasNonEmptyString(payload.videoUrl);
      const dynamicHasStartEndInput =
        (Boolean(payload.start_image) && Boolean(payload.end_image)) ||
        (Array.isArray(payload.image_urls) && payload.image_urls.length >= 2 && Boolean(payload.has_end_frame));
      const dynamicHasReferenceInput =
        hasNonEmptyStringList(payload.reference_image_urls) ||
        hasNonEmptyStringList(payload.referenceImageUrls) ||
        hasNonEmptyStringList(payload.reference_video_urls) ||
        hasNonEmptyStringList(payload.referenceVideoUrls) ||
        hasNonEmptyStringList(payload.reference_audio_urls) ||
        hasNonEmptyStringList(payload.referenceAudioUrls);
      const dynamicHasDirectStartImage =
        hasNonEmptyString(payload.first_frame_url) ||
        hasNonEmptyString(payload.image_url) ||
        hasNonEmptyString(payload.imageUrl) ||
        hasNonEmptyString(payload.image) ||
        hasNonEmptyString(payload.start_frame);
      modelRoute = resolveDynamicVideoSubRoute(
        dynamicVideoModel,
        dynamicHasDirectStartImage,
        dynamicHasReferenceInput,
        dynamicHasVideoInput,
        dynamicHasStartEndInput
      ) || modelRoute;
    } else if (modelRoute.startsWith("alibaba/wan-3.0")) {
      const hasWanReferenceInput =
        hasNonEmptyStringList(payload.reference_image_urls) ||
        hasNonEmptyStringList(payload.referenceImageUrls) ||
        hasNonEmptyStringList(payload.reference_video_urls) ||
        hasNonEmptyStringList(payload.referenceVideoUrls) ||
        hasNonEmptyStringList(payload.reference_audio_urls) ||
        hasNonEmptyStringList(payload.referenceAudioUrls);
      const hasWanImageInput =
        hasImage ||
        hasNonEmptyStringList(payload.image_urls) ||
        hasNonEmptyStringList(payload.imageUrls);
      modelRoute = hasWanReferenceInput
        ? "alibaba/wan-3.0/reference-to-video"
        : hasWanImageInput
          ? "alibaba/wan-3.0/image-to-video"
          : "alibaba/wan-3.0/text-to-video";
    } else if (modelRoute.startsWith("black-forest-labs/flux-3") || modelRoute === "black-forest-labs-flux-3-video") {
      const hasFluxVideoInput =
        (typeof payload.video === "string" && payload.video.trim().length > 0) ||
        hasNonEmptyStringList(payload.reference_video_urls) ||
        hasNonEmptyStringList(payload.referenceVideoUrls);
      const hasFluxStartEndInput =
        (Boolean(payload.start_image) && Boolean(payload.end_image)) ||
        (Array.isArray(payload.image_urls) && payload.image_urls.length >= 2 && Boolean(payload.has_end_frame));
      const hasFluxImageInput =
        hasImage ||
        hasNonEmptyStringList(payload.image_urls) ||
        hasNonEmptyStringList(payload.imageUrls) ||
        hasNonEmptyStringList(payload.reference_image_urls) ||
        hasNonEmptyStringList(payload.referenceImageUrls);
      modelRoute = hasFluxVideoInput
        ? "black-forest-labs/flux-3/video-extend"
        : hasFluxStartEndInput
          ? "black-forest-labs/flux-3/start-end-to-video"
          : hasFluxImageInput
            ? "black-forest-labs/flux-3/image-to-video"
            : "black-forest-labs/flux-3/text-to-video";
    } else if (modelRoute.startsWith("minimax/hailuo-02")) {
      const resLower = typeof payload.resolution === "string" ? payload.resolution.toLowerCase() : "";
      const isFast = resLower.includes("fast") || resLower.includes("512");
      const is768p = resLower.includes("768") || resLower.includes("standard");
      const hasImageInput = Boolean(hasImage || hasNonEmptyString(payload.image) || hasNonEmptyString(payload.first_frame_url));
      if (isFast || modelRoute.includes("fast")) {
        modelRoute = "minimax/hailuo-02/fast";
      } else if (is768p) {
        modelRoute = hasImageInput ? "minimax/hailuo-02/i2v-standard" : "minimax/hailuo-02/t2v-standard";
      } else {
        modelRoute = hasImageInput ? "minimax/hailuo-02/i2v-pro" : "minimax/hailuo-02/t2v-pro";
      }
    } else if (modelRoute.startsWith("minimax/hailuo-2.3")) {
      const is1080p = typeof payload.resolution === "string" && payload.resolution.toLowerCase() === "1080p";
      const hasImageInput = Boolean(hasImage || hasNonEmptyString(payload.image) || hasNonEmptyString(payload.first_frame_url));
      if (modelRoute.includes("fast")) {
        modelRoute = is1080p ? "minimax/hailuo-2.3/fast-pro" : "minimax/hailuo-2.3/fast";
      } else {
        modelRoute = hasImageInput ? "minimax/hailuo-2.3/i2v-pro" : "minimax/hailuo-2.3/t2v-pro";
      }
    } else if (modelRoute.startsWith("minimax/h3") || modelRoute.startsWith("wavespeed-ai/minimax-h3") || modelRoute === "minimax-h3") {
      const hasReference = Boolean(
        hasNonEmptyStringList(payload.reference_image_urls) ||
        hasNonEmptyStringList(payload.referenceImageUrls) ||
        hasNonEmptyStringList(payload.reference_video_urls) ||
        hasNonEmptyStringList(payload.referenceVideoUrls) ||
        hasNonEmptyStringList(payload.reference_audio_urls) ||
        hasNonEmptyStringList(payload.referenceAudioUrls)
      );
      const hasImg = Boolean(hasImage || hasNonEmptyString(payload.image) || hasNonEmptyString(payload.first_frame_url));
      if (hasReference) {
        const prefix = modelRoute.startsWith("wavespeed-ai/minimax-h3") ? "wavespeed-ai/minimax-h3" : "minimax/h3";
        modelRoute = `${prefix}/reference-to-video`;
      } else if (hasImg) {
        const prefix = modelRoute.startsWith("wavespeed-ai/minimax-h3") ? "wavespeed-ai/minimax-h3" : "minimax/h3";
        modelRoute = `${prefix}/image-to-video`;
      } else {
        const prefix = modelRoute.startsWith("wavespeed-ai/minimax-h3") ? "wavespeed-ai/minimax-h3" : "minimax/h3";
        modelRoute = `${prefix}/text-to-video`;
      }
    }

    const isWaveSpeedTarget =
      isWaveSpeedOnlyModel ||
      modelRoute.startsWith("minimax/") ||
      modelRoute.startsWith("minimax-") ||
      modelRoute.startsWith("hailuo/") ||
      Boolean(dynamicVideoModel && (
        dynamicVideoModel.provider === "wavespeed" ||
        dynamicVideoModel.family === "hailuo" ||
        dynamicVideoModel.family === "minimax-hailuo" ||
        dynamicVideoModel.family === "minimax" ||
        dynamicVideoModel.family?.includes("hailuo") ||
        dynamicVideoModel.family?.includes("minimax") ||
        dynamicVideoModel.group?.toLowerCase().includes("hailuo") ||
        dynamicVideoModel.group?.toLowerCase().includes("minimax") ||
        (dynamicVideoModel as any).family_label?.toLowerCase().includes("hailuo") ||
        (dynamicVideoModel as any).family_label?.toLowerCase().includes("minimax") ||
        dynamicVideoModel.family === "seedance" ||
        dynamicVideoModel.family?.includes("seedance") ||
        dynamicVideoModel.family === "wan" ||
        dynamicVideoModel.family?.includes("wan") ||
        dynamicVideoModel.family === "flux" ||
        dynamicVideoModel.family?.includes("flux") ||
        dynamicVideoModel.api_route?.startsWith("minimax/") ||
        dynamicVideoModel.text_api_route?.startsWith("minimax/") ||
        dynamicVideoModel.image_api_route?.startsWith("minimax/") ||
        dynamicVideoModel.api_route?.startsWith("alibaba/") ||
        dynamicVideoModel.text_api_route?.startsWith("alibaba/") ||
        dynamicVideoModel.image_api_route?.startsWith("alibaba/") ||
        dynamicVideoModel.api_route?.startsWith("black-forest-labs/") ||
        dynamicVideoModel.text_api_route?.startsWith("black-forest-labs/") ||
        dynamicVideoModel.image_api_route?.startsWith("black-forest-labs/") ||
        dynamicVideoModel.isCustom
      ));

    let kieModel = (isDirectGoogleVeo31Route || isWaveSpeedTarget) ? undefined : resolveKieVideoModel(modelRoute);
    let wavespeedRoute: string | undefined = wavespeedFallbackMap[modelRoute];
    if (isWaveSpeedTarget && !wavespeedRoute) {
      wavespeedRoute = modelRoute;
    }

    if (dynamicVideoModel) {
      if (isWaveSpeedTarget) {
        wavespeedRoute = modelRoute;
        kieModel = undefined;
      } else {
        kieModel = resolveKieVideoModel(dynamicVideoModel.api_route) || dynamicVideoModel.id;
        wavespeedRoute = undefined;
      }
    }

    const legacyVideoRoute =
      isDirectGoogleVeo31Route
        ? { provider: "google" as const, route: modelRoute }
        : wavespeedRoute && !kieModel
          ? { provider: "wavespeed" as const, route: wavespeedRoute }
          : kieModel
            ? { provider: "kie" as const, route: kieModel }
            : { provider: "wavespeed" as const, route: modelRoute };
    const routingDecision = await resolveRuntimeProviderRoute({
      modelId: modelRoute,
      modality: "video",
      legacyRoute: legacyVideoRoute,
    });
    if (routingDecision.routingSource === "control_center") {
      if (routingDecision.effectiveProvider === "google") {
        modelRoute = routingDecision.providerRoute;
        kieModel = undefined;
        wavespeedRoute = undefined;
        isDirectGoogleVeo31Route = isGoogleVideoRoute(modelRoute);
      } else if (routingDecision.effectiveProvider === "wavespeed") {
        wavespeedRoute = routingDecision.providerRoute;
        kieModel = undefined;
        isDirectGoogleVeo31Route = false;
      }
    }

    // Hard guard: Minimax/Hailuo and all other WaveSpeed models must NEVER be assigned to KIE
    if (isWaveSpeedTarget) {
      wavespeedRoute = wavespeedRoute || modelRoute;
      kieModel = undefined;
      isDirectGoogleVeo31Route = false;
    }

    try {
      assertVideoRouteAllowed(modelRoute);
      if (kieModel) assertVideoRouteAllowed(kieModel);
      if (wavespeedRoute) assertVideoRouteAllowed(wavespeedRoute);
    } catch (routeError) {
      if (routeError instanceof BlockedVideoRouteError) {
        return NextResponse.json({ error: routeError.message, code: routeError.code }, { status: routeError.status });
      }
      throw routeError;
    }

    if (
      modelRoute.includes("kling") ||
      modelRoute.includes("seedance") ||
      (kieModel && kieModel.includes("kling")) ||
      (kieModel && kieModel.includes("seedance"))
    ) {
      console.log("[api/video POST] resolved provider model", JSON.stringify({ modelRoute, kieModel, wavespeedRoute }));
    }

    if (!isDirectGoogleVeo31Route && !kieModel && !wavespeedRoute) {
      return NextResponse.json(
        { error: `No model mapping for route: ${modelRoute}` },
        { status: 400 },
      );
    }

    const isVeoModelRoute = isGoogleVideoRoute(modelRoute);
    if (isGoogleVideoRoute(modelRoute)) {
      const requestedResolution =
        typeof payload.resolution === "string"
          ? payload.resolution.toLowerCase()
          : typeof payload.quality === "string"
            ? payload.quality.toLowerCase()
            : "720p";

      if (modelRoute === "google/veo3.1-lite-text-to-video" && requestedResolution === "4k") {
        return NextResponse.json(
          {
            error: "Google Veo 3.1 Lite does not support 4K. Choose 720p or 1080p.",
            publicError: "Veo 3.1 Lite supports 720p or 1080p only.",
          },
          { status: 400 },
        );
      }

      const requestedAspect =
        typeof payload.aspect_ratio === "string"
          ? payload.aspect_ratio
          : typeof payload.aspectRatio === "string"
            ? payload.aspectRatio
            : "16:9";
      const safeAspect = requestedAspect === "9:16" ? "9:16" : "16:9";
      payload.aspect_ratio = safeAspect;
      payload.aspectRatio = safeAspect;

      const isLegacyGoogleVeo3Route = modelRoute === GOOGLE_VEO3_FAST_ROUTE || modelRoute === GOOGLE_VEO3_ROUTE;
      if (isLegacyGoogleVeo3Route && requestedResolution === "4k") {
        return NextResponse.json(
          {
            error: "Legacy Google Veo 3 does not support 4K in the official public catalog. Choose 720p or 1080p.",
            publicError: "Google Veo 3 supports 720p or 1080p in this catalog.",
          },
          { status: 400 },
        );
      }

      if (isLegacyGoogleVeo3Route && requestedResolution === "1080p" && safeAspect === "9:16") {
        return NextResponse.json(
          {
            error: "Legacy Google Veo 3 1080p supports 16:9 only. Choose 16:9 or use 720p for portrait.",
            publicError: "Google Veo 3 1080p supports 16:9 only.",
          },
          { status: 400 },
        );
      }

      if (typeof payload.resolution !== "string" && typeof payload.quality !== "string") {
        payload.resolution = "720p";
      }

      const referenceUrls = Array.isArray(payload.reference_image_urls)
        ? payload.reference_image_urls.filter((value): value is string => typeof value === "string")
        : [];
      const supportsGoogleReferenceImages =
        modelRoute === GOOGLE_VEO31_PRO_ROUTE ||
        modelRoute === GOOGLE_VEO31_ROUTE ||
        modelRoute === GOOGLE_VEO31_FAST_ROUTE ||
        modelRoute === "google/gemini-omni-flash" ||
        modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE;
      if (referenceUrls.length > 0 && !supportsGoogleReferenceImages) {
        return NextResponse.json(
          {
            error: "This Google Veo model does not support referenceImages. Use a start image / last frame instead, or choose Veo 3.1 / Veo 3.1 Fast / Gemini Omni.",
            publicError: "This Veo model does not support reference images.",
          },
          { status: 400 },
        );
      }
      const hasReferenceInput =
        referenceUrls.length > 0 ||
        typeof payload.image === "string" ||
        typeof payload.first_frame_url === "string" ||
        typeof payload.end_image === "string" ||
        typeof payload.last_frame_url === "string" ||
        typeof payload.last_image === "string";

      const isOmniModel = modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE;
      if (!isOmniModel && (hasReferenceInput || requestedResolution === "1080p" || requestedResolution === "4k")) {
        payload.duration = 8;
      }

      delete payload.sound;
      delete payload.generate_audio;
    }
    const isSeedance2Route =
      modelRoute === "bytedance/dreamina-v3.0/text-to-video-720p" ||
      modelRoute === "bytedance/seedance-v2/text-to-video" ||
      modelRoute === "bytedance/seedance-v2/text-to-video-fast" ||
      modelRoute.startsWith("bytedance/seedance-2.0");
    const defaultDurationForCost = (modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE) ? 5 : (isVeoModelRoute ? 8 : 5);
    const durationForCost =
      typeof payload.duration === "number"
        ? payload.duration
        : typeof payload.duration === "string"
          ? Number.parseInt(payload.duration, 10) || defaultDurationForCost
          : defaultDurationForCost;
    const qualityForCost =
      (typeof payload.mode === "string" ? payload.mode : null) ||
      (typeof payload.resolution === "string" ? payload.resolution : null) ||
      (typeof payload.quality === "string" ? payload.quality : null);
    const soundEnabled = payload.sound === true || payload.generate_audio === true;
    const baseCost = (modelRoute.startsWith("bytedance/seedance") || modelRoute.includes("seedance") || modelRoute.startsWith("wavespeed-ai/minimax-h3") || modelRoute.startsWith("minimax/h3") || modelRoute === "minimax-h3" || modelRoute.startsWith("kwaivgi/kling-v4.0/") || modelRoute === "kwaivgi/kling-v2.6-std/motion-control" || modelRoute.startsWith("wavespeed-ai/openjutsu/") || modelRoute.startsWith("wavespeed-ai/video-upscaler") || modelRoute.startsWith("wavespeed-ai/ultimate-video-upscaler"))
      ? await getVideoCreditsByRouteAsync(modelRoute, payload)
      : await getGenerationCost(modelRoute, durationForCost, 1, qualityForCost).catch(() => 0);
    const creditsToCharge = baseCost;
    if (creditsToCharge <= 0) {
      return NextResponse.json({ error: "No credit configuration for this model" }, { status: 400 });
    }

    console.log("[api/video POST] prechecking safety policy for:", JSON.stringify({
      prompt: typeof payload.prompt === "string" ? payload.prompt.slice(0, 1000) : "",
      negativePrompt: typeof (payload as any).negative_prompt === "string" ? String((payload as any).negative_prompt) : null,
    }));

    const precheck = await precheckGenerationPolicy({
      prompt: hasImage ? stripPromptReferenceTags(payload.prompt) : (typeof payload.prompt === "string" ? payload.prompt : ""),
      negativePrompt: typeof (payload as any).negative_prompt === "string" ? String((payload as any).negative_prompt) : null,
    });
    if (!precheck.allowed) {
      return NextResponse.json(
        { error: precheck.message, blocked: true, reason: precheck.reason },
        { status: 403 },
      );
    }

    if (requestHash) {
      const idem = await beginIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        requestHash,
      });
      if (idem.kind === "replay") {
        return NextResponse.json(idem.responseJson, { status: idem.responseStatus });
      }
      if (idem.kind === "in_progress") {
        return NextResponse.json({ status: "processing", generationId: idem.generationId }, { status: 202 });
      }
      idempotencyClaimed = true;
      idempotencyUserId = userId;
    }

    const markProviderDispatched = async () => {
      if (providerDispatched) return;
      await markIdempotencyProviderDispatched({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
      });
      providerDispatched = true;
    };

    // Official Seedance 2.0 path (BytePlus ModelArk, no KIE)
    const hasImageOrAvatar = payloadHasImageInput(payload);

    if (isOfficialSeedance2Route(modelRoute) && !hasImageOrAvatar) {
      if (!isFinalProviderExecutionAllowed("byteplus")) {
        const responseJson = providerNotActiveResponse("byteplus", { modelRoute });
        await completeIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          responseStatus: 503,
          responseJson,
        });
        return NextResponse.json(responseJson, { status: 503 });
      }

      const arkKey = getArkApiKeyFromEnv();
      if (!arkKey) {
        const responseJson = {
          error: "BytePlus ModelArk provider is not configured. Add ARK_API_KEY.",
          code: "ark_key_missing",
          modelRoute,
        };
        await completeIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          responseStatus: 503,
          responseJson,
        });
        return NextResponse.json(responseJson, { status: 503 });
      }

      const prompt = typeof payload.prompt === "string" ? sanitizePrompt(payload.prompt, 5000) : "Seedance 2.0 video generation";
      const bpResolution = String(qualityForCost || "720p").toLowerCase();
      let bpTokensPerSec = 12000;
      if (bpResolution.includes("480")) bpTokensPerSec = 6000;
      else if (bpResolution.includes("1080")) bpTokensPerSec = 30000;
      else if (bpResolution.includes("4k")) bpTokensPerSec = 70000;
      const bpTokens = durationForCost * bpTokensPerSec;

      const isMini = modelRoute === "bytedance/seedance-v2/text-to-video-mini";
      let ratePerToken = 0.0000043;
      if (isMini) {
        const referenceVideos = Array.isArray(payload.reference_video_urls) ? payload.reference_video_urls : [];
        const hasVideo = referenceVideos.length > 0 || !!payload.video || !!payload.videoUrl || !!payload.referenceVideoUrls;
        ratePerToken = hasVideo ? 0.0000021 : 0.0000035;
      }
      const bpEstimatedCost = bpTokens * ratePerToken;

      const arkBody = await buildOfficialSeedancePayload(modelRoute, payload, userId);
      const arkModel = String(arkBody.model || getOfficialSeedanceModel(modelRoute));
      const arkImageAuditDetails = getArkImageAuditDetails(arkBody);
      const sanitizedArkPayload = sanitizeArkPayloadForLog(arkBody);

      const charge = await spendCredits({
        userId,
        profileId,
        credits: creditsToCharge,
        prompt,
        assetType: "VIDEO",
        modelUsed: modelRoute,
        resolution: qualityForCost,
        duration: durationForCost,
        aspectRatio: String(payload.aspect_ratio || payload.aspectRatio || "16:9"),
        quality: qualityForCost,
        providerName: "BytePlus",
        providerModel: arkModel,
        providerCostUsd: bpEstimatedCost,
        providerTokens: bpTokens,
        providerCostSource: "estimated",
        requestPayload: {
          ...payload,
          routing: routingMetadata(routingDecision),
        },
        idempotency: {
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
        },
      });
      generationId = charge.generationId;
      chargedCredits = creditsToCharge;
      chargedUserId = userId;

      console.log(`[Provider Payload Audit] ---`);
      console.log(`[Provider Payload Audit] Generation ID: ${generationId}`);
      console.log(`[Provider Payload Audit] Provider: BytePlus`);
      console.log(`[Provider Payload Audit] Model: ${arkModel}`);
      console.log(`[Provider Payload Audit] Route: ${modelRoute}`);
      console.log(`[Provider Payload Audit] BYTEPLUS_MEDIA_URL_MODE: ${getBytePlusMediaUrlMode()}`);
      console.log(`[Provider Payload Audit] BYTEPLUS_IMAGE_PREPROCESS_MODE: ${getBytePlusImagePreprocessMode()}`);
      console.log(`[Provider Payload Audit] Image References:`, JSON.stringify(arkImageAuditDetails, null, 2));
      console.log(`[Provider Payload Audit] Sanitized Payload:`, JSON.stringify(sanitizedArkPayload, null, 2));
      console.log(`[Provider Payload Audit] ---`);

      await markProviderDispatched();
      const createRes = await fetch(BYTEPLUS_CONTENT_TASKS_URL, {
        method: "POST",
        headers: arkHeaders(),
        body: JSON.stringify(arkBody),
      });

      let createJson: Record<string, unknown> | null = null;
      try {
        createJson = await createRes.json();
      } catch {
        const text = await createRes.text().catch(() => "");
        console.error("[api/video POST] BytePlus non-JSON response", createRes.status, text.slice(0, 300));
        console.error("[Provider Payload Audit] Ark Failure:", JSON.stringify({
          generationId,
          providerStatus: createRes.status,
          bytePlusMediaUrlMode: getBytePlusMediaUrlMode(),
          imageReferences: arkImageAuditDetails,
          rawResponseText: text.slice(0, 1000),
        }));
        if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
          await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        const failure = classifyArkSubmitFailure(text, createRes.status);
        const providerAudit = buildArkFailureAudit({
          generationId,
          providerStatus: createRes.status,
          arkModel,
          modelRoute,
          imageReferences: arkImageAuditDetails,
          sanitizedPayload: sanitizedArkPayload,
          rawResponseText: text.slice(0, 1000),
        });
        const responseJson = {
          generationId,
          error: `BytePlus ModelArk returned non-JSON (${createRes.status}): ${text.slice(0, 200)}`,
          publicError: failure.publicError,
          code: failure.code,
          providerStatus: createRes.status,
          providerModel: arkModel,
          modelRoute,
          providerAudit,
        };
        const status = await failIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          errorMessage: responseJson.error,
          providerDispatched,
        });
        if (status === "review_required") {
          return NextResponse.json({ ...responseJson, status }, { status: 409 });
        }
        return NextResponse.json(responseJson, { status: failure.responseStatus });
      }

      const createData = createJson?.data as Record<string, unknown> | undefined;
      const rawTaskId = createJson?.id ?? createJson?.task_id ?? createJson?.taskId ?? createData?.id ?? createData?.task_id ?? createData?.taskId;
      if (!createRes.ok || !rawTaskId) {
        console.error("[api/video POST] BytePlus create task failed", createRes.status, JSON.stringify(createJson));
        console.error("[Provider Payload Audit] Ark Failure:", JSON.stringify({
          generationId,
          providerStatus: createRes.status,
          bytePlusMediaUrlMode: getBytePlusMediaUrlMode(),
          imageReferences: arkImageAuditDetails,
          rawResponse: createJson,
        }));
        if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
          await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        const rawError = providerFailureMessage(createJson, createRes.status);
        const failure = classifyArkSubmitFailure(rawError, createRes.status);
        const providerAudit = buildArkFailureAudit({
          generationId,
          providerStatus: createRes.status,
          arkModel,
          modelRoute,
          imageReferences: arkImageAuditDetails,
          sanitizedPayload: sanitizedArkPayload,
          rawResponse: createJson,
        });

        const responseJson = {
          generationId,
          error: rawError,
          publicError: failure.publicError,
          code: failure.code,
          providerStatus: createRes.status,
          providerModel: arkModel,
          modelRoute,
          providerAudit,
        };
        const status = await failIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          errorMessage: rawError,
          providerDispatched,
        });
        if (status === "review_required") {
          return NextResponse.json({ ...responseJson, status }, { status: 409 });
        }
        return NextResponse.json(responseJson, { status: failure.responseStatus });
      }

      const taskId = `ark:${String(rawTaskId)}`;
      await setGenerationTaskMarker(generationId, taskId);

      const responseJson = {
        generationId,
        taskId,
        status: "processing",
      };
      await completeIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        responseStatus: 200,
        responseJson,
      });
      return NextResponse.json(responseJson);
    }

    // Direct Google Gemini video path (no KIE, no WaveSpeed)
    if (isGoogleVideoRoute(modelRoute)) {
      const prompt = typeof payload.prompt === "string" ? sanitizePrompt(stripPromptReferenceTags(payload.prompt), 5000) : "";
      if (!prompt) {
        const responseJson = { error: "Prompt is required" };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }

      const startImage =
        payload.first_frame_url ??
        payload.image_url ??
        payload.image;
      const endImage =
        payload.last_frame_url ??
        payload.end_image ??
        payload.last_image;
      const startVideo =
        payload.video_url ??
        payload.videoUrl ??
        payload.video;
      const referenceSources = Array.isArray(payload.reference_image_urls)
        ? payload.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3)
        : [];
      const referenceVideoSources = [
        ...(Array.isArray(payload.reference_video_urls)
          ? payload.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : []),
        ...(Array.isArray(payload.referenceVideoUrls)
          ? payload.referenceVideoUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : []),
      ].slice(0, 3);

      // Resolve and verify accessibility of all media inputs before spending credits
      const resolvedStartImage = (typeof startImage === "string" && startImage.trim())
        ? await resolveProviderMediaUrl(startImage, { userId, assetType: "image" })
        : undefined;
      const resolvedEndImage = (typeof endImage === "string" && endImage.trim())
        ? await resolveProviderMediaUrl(endImage, { userId, assetType: "image" })
        : undefined;
      const resolvedStartVideo = (typeof startVideo === "string" && startVideo.trim())
        ? await resolveProviderMediaUrl(startVideo, { userId, assetType: "video" })
        : undefined;
      
      const resolvedReferenceSources: string[] = [];
      for (const source of referenceSources) {
        if (typeof source === "string" && source.trim()) {
          const resolved = await resolveProviderMediaUrl(source, { userId, assetType: "image" });
          resolvedReferenceSources.push(resolved);
        }
      }
      const resolvedReferenceVideoSources: string[] = [];
      for (const source of referenceVideoSources) {
        if (typeof source === "string" && source.trim()) {
          const resolved = await resolveProviderMediaUrl(source, { userId, assetType: "video" });
          resolvedReferenceVideoSources.push(resolved);
        }
      }

      if (resolvedStartImage) {
        await verifyPublicMediaUrl(resolvedStartImage, "google_start_image", { expectedMediaKind: "image" });
      }
      if (resolvedEndImage) {
        await verifyPublicMediaUrl(resolvedEndImage, "google_end_image", { expectedMediaKind: "image" });
      }
      if (resolvedStartVideo) {
        await verifyPublicMediaUrl(resolvedStartVideo, "google_start_video", { expectedMediaKind: "video" });
      }
      for (const url of resolvedReferenceSources) {
        await verifyPublicMediaUrl(url, "google_reference_image", { expectedMediaKind: "image" });
      }
      for (const url of resolvedReferenceVideoSources) {
        await verifyPublicMediaUrl(url, "google_reference_video", { expectedMediaKind: "video" });
      }

      const isGoogleVeo31ExtensionRoute =
        modelRoute === GOOGLE_VEO31_FAST_ROUTE ||
        modelRoute === GOOGLE_VEO31_ROUTE ||
        modelRoute === GOOGLE_VEO31_PRO_ROUTE;
      const isOmniDirectModel = modelRoute === "google/gemini-omni-flash" || modelRoute === LEGACY_GEMINI_OMNI_VIDEO_ROUTE;
      const supportsGoogleVideoInput =
        isOmniDirectModel ||
        isGoogleVeo31ExtensionRoute;

      if (resolvedStartVideo && !supportsGoogleVideoInput) {
        const responseJson = {
          error: "This Google video model does not support video input. Use Gemini Omni Flash for video edit or Veo 3.1 Fast/Pro for video extension.",
          publicError: "This model does not support video input.",
        };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }

      if (resolvedReferenceVideoSources.length > 0 && !isOmniDirectModel) {
        const responseJson = {
          error: "This Google video model does not support reference videos. Use Gemini Omni Flash for video references.",
          publicError: "This model does not support reference videos.",
        };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }

      const hasGoogleForcedEightSecondInput =
        Boolean(resolvedStartImage) ||
        Boolean(resolvedEndImage) ||
        resolvedReferenceSources.length > 0 ||
        (Boolean(resolvedStartVideo) && modelRoute !== "google/gemini-omni-flash" && modelRoute !== LEGACY_GEMINI_OMNI_VIDEO_ROUTE);
      const requestedGoogleVideoMode =
        typeof payload.google_video_mode === "string"
          ? payload.google_video_mode
          : typeof payload.video_mode_label === "string"
          ? payload.video_mode_label
          : typeof payload.video_task === "string"
          ? payload.video_task
          : undefined;

      const normalizedGoogle = normalizeGoogleVideoOptions(modelRoute, {
        duration: payload.duration as number | string | undefined,
        resolution: typeof payload.resolution === "string" ? payload.resolution : typeof payload.quality === "string" ? payload.quality : typeof payload.mode === "string" ? payload.mode : undefined,
        aspectRatio: typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : typeof payload.aspectRatio === "string" ? payload.aspectRatio : undefined,
        referenceImageCount: resolvedReferenceSources.length,
        referenceVideoCount: resolvedReferenceVideoSources.length,
        hasVideoInput: Boolean(resolvedStartVideo),
        hasStartImage: Boolean(resolvedStartImage),
        hasEndImage: Boolean(resolvedEndImage),
        previousInteractionId: typeof payload.previousTaskId === "string" ? payload.previousTaskId : undefined,
        requestedMode: requestedGoogleVideoMode,
      });
      const aspectRatio = normalizedGoogle.aspectRatio;
      const resolution = normalizedGoogle.resolution;
      const durationSeconds = normalizedGoogle.duration;
      if (resolvedStartVideo && isGoogleVeo31ExtensionRoute && resolution !== "720p") {
        const responseJson = {
          error: "Google Veo 3.1 video extension supports 720p only. Choose 720p or remove the input video.",
          publicError: "Video Extend on Veo 3.1 supports 720p only.",
        };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      const googleCreditsToCharge = await getGenerationCost(modelRoute, durationSeconds, 1, resolution);
      if (googleCreditsToCharge <= 0) {
        const responseJson = { error: "Invalid model cost configuration" };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      const negativePrompt =
        typeof payload.negative_prompt === "string" && payload.negative_prompt.trim()
          ? sanitizePrompt(payload.negative_prompt, 1000)
          : undefined;
      const previousTaskId = typeof payload.previousTaskId === "string" ? payload.previousTaskId : undefined;
      const googleVideoModeLabel = resolveGoogleVideoModeLabel({
        modelRoute,
        hasVideo: Boolean(resolvedStartVideo),
        hasStartImage: Boolean(resolvedStartImage),
        hasEndImage: Boolean(resolvedEndImage),
        referenceCount: resolvedReferenceSources.length,
        hasPreviousInteraction: Boolean(previousTaskId),
        requestedMode: requestedGoogleVideoMode,
      });
      const googleAuditPayload = {
        ...payload,
        google_video_mode: googleVideoModeLabel,
        google_video_provider_model: resolveGoogleVeoProviderModel(modelRoute),
        routing: routingMetadata(routingDecision),
      };

      console.log(`[Provider Payload Audit] ---`);
      console.log(`[Provider Payload Audit] Provider: Google Veo`);
      console.log(`[Provider Payload Audit] Model: ${resolveGoogleVeoProviderModel(modelRoute)}`);
      console.log(`[Provider Payload Audit] Route: ${modelRoute}`);
      console.log(`[Provider Payload Audit] Payload details:`, JSON.stringify({
        prompt,
        aspectRatio,
        resolution,
        durationSeconds,
        negativePrompt,
        startImage: resolvedStartImage,
        endImage: resolvedEndImage,
        referenceSources: resolvedReferenceSources,
        referenceVideoSources: resolvedReferenceVideoSources,
        mode: googleVideoModeLabel,
      }, null, 2));
      console.log(`[Provider Payload Audit] ---`);

      const googleCostEst = estimateProviderCostSync(modelRoute, durationSeconds, resolution);

      const charge = await spendCredits({
        userId,
        profileId,
        credits: googleCreditsToCharge,
        prompt,
        assetType: "VIDEO",
        modelUsed: modelRoute,
        resolution: resolution,
        duration: durationSeconds,
        aspectRatio: aspectRatio,
        quality: String(payload.quality || payload.mode || ""),
        providerName: "Google",
        providerModel: resolveGoogleVeoProviderModel(modelRoute),
        providerCostUsd: googleCostEst.usd,
        providerCostSource: googleCostEst.source,
        requestPayload: googleAuditPayload,
        idempotency: {
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
        },
      });
      generationId = charge.generationId;
      chargedCredits = googleCreditsToCharge;
      chargedUserId = userId;
      const [image, lastFrame, referenceImages, referenceVideos, video] = await Promise.all([
        sourceToGoogleImageInput(resolvedStartImage),
        sourceToGoogleImageInput(resolvedEndImage),
        resolvedReferenceSources.length
          ? Promise.all(resolvedReferenceSources.map((source) => sourceToGoogleImageInput(source))).then((items) => items.filter((item): item is VeoImageInput => Boolean(item)))
          : Promise.resolve([]),
        resolvedReferenceVideoSources.length
          ? Promise.all(resolvedReferenceVideoSources.map((source) => sourceToGoogleVideoInput(source))).then((items) => items.filter((item): item is VeoVideoInput => Boolean(item)))
          : Promise.resolve([]),
        sourceToGoogleVideoInput(resolvedStartVideo),
      ]);

      let previousInteractionId: string | undefined;
      const previousHandle = await resolveGeminiInteractionHandleFromTask(userId, previousTaskId);
      if (previousHandle?.name) {
        previousInteractionId = previousHandle.name;
      }

      let opHandle: VeoOperationHandle;
      try {
        const tier = resolveGoogleVeoTier(modelRoute);
        await markProviderDispatched();
        opHandle = await startVeoGeneration({
          tier,
          prompt,
          aspectRatio,
          resolution,
          durationSeconds,
          negativePrompt,
          image,
          lastFrame: image ? lastFrame : undefined,
          referenceImages: referenceImages.length ? referenceImages : undefined,
          referenceVideos: referenceVideos.length ? referenceVideos : undefined,
          previousInteractionId,
          video,
          videoTask: googleVideoModeLabel === "Video Extend" ? "extend" : undefined,
        });
      } catch (err) {
        if (!providerDispatched && generationId && chargedUserId && chargedCredits > 0) {
          await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        const rawError = err instanceof Error ? err.message : "Google Gemini video generation failed";
        let publicError = VIDEO_PROVIDER_BUSY_MESSAGE;

        if (/safety|policy|violat|censor|moderation|sensitive|block|flagged|nsfw/i.test(rawError)) {
          publicError = "Generation failed because the attached media or prompt violates the provider content policy.";
        }

        const responseJson = {
          generationId,
          error: rawError,
          publicError,
          code: "provider_submit_failed",
          providerModel: resolveGoogleVeoProviderModel(modelRoute),
          modelRoute,
        };
        const status = await failIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          errorMessage: rawError,
          providerDispatched,
        });
        if (status === "review_required") {
          return NextResponse.json({ ...responseJson, status }, { status: 409 });
        }
        return NextResponse.json(responseJson, { status: 502 });
      }

      const taskId = encodeGeminiTask(opHandle);
      await setGenerationTaskMarker(generationId, taskId);

      const responseJson = {
        generationId,
        taskId,
        status: "processing",
      };
      await completeIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        responseStatus: 200,
        responseJson,
      });
      return NextResponse.json(responseJson);
    }

    // WaveSpeed path
    if (wavespeedRoute && !kieModel) {
      const wavespeedKey = process.env.WAVESPEED_API_KEY;
      if (!wavespeedKey) {
        const responseJson = { error: "WaveSpeed provider is not configured.", code: "wavespeed_key_missing" };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 503, responseJson });
        return NextResponse.json(responseJson, { status: 503 });
      }
      const wsInput = mapToWavespeedInput(payload, wavespeedRoute);
      wsInput.enable_base64_output = false;
      if ((wavespeedRoute === "kwaivgi/kling-v3.0-std/image-to-video" || wavespeedRoute === "kwaivgi/kling-v3.0-pro/image-to-video") && typeof wsInput.image !== "string") {
        const responseJson = { error: "Kling 3.0 Image-to-Video requires an image reference." };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      if ((wavespeedRoute === "kwaivgi/kling-v3-turbo-std/image-to-video" || wavespeedRoute === "kwaivgi/kling-v3-turbo-pro/image-to-video") && typeof wsInput.image !== "string") {
        const responseJson = { error: "Kling V3 Turbo Image-to-Video requires an image reference." };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      if (wavespeedRoute?.startsWith("kwaivgi/kling-video-o3-") && wavespeedRoute.endsWith("/image-to-video") && typeof wsInput.image !== "string") {
        const responseJson = { error: "Kling O3 Image-to-Video requires an image reference." };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      if ((wavespeedRoute === "bytedance/seedance-2.5/image-to-video-turbo" || wavespeedRoute === "bytedance/seedance-2.5/image-to-video") && typeof wsInput.image !== "string") {
        const responseJson = { error: "Seedance 2.5 Image-to-Video requires an image reference." };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      if (wavespeedRoute?.startsWith("kwaivgi/kling-v2.6-") && wavespeedRoute.endsWith("/image-to-video") && typeof wsInput.image !== "string") {
        const responseJson = { error: "Kling 2.6 Image-to-Video requires an image reference." };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
      
      if (wavespeedRoute === "kwaivgi/kling-v2.6-std/motion-control") {
        if (typeof wsInput.image !== "string" || typeof wsInput.video !== "string") {
          return NextResponse.json({ error: "Motion Transfer requires both a character image and a motion video." }, { status: 400 });
        }
        if (!["image", "video", "front", "side", "back"].includes(String(wsInput.character_orientation || ""))) {
          return NextResponse.json({ error: "Motion Transfer requires a valid character orientation." }, { status: 400 });
        }
      }
      if (wavespeedRoute === "wavespeed-ai/openjutsu/object-swap") {
        if (typeof wsInput.video !== "string" || typeof wsInput.target !== "string") {
          return NextResponse.json({ error: "Object Swap requires a source video and target." }, { status: 400 });
        }
        if (wsInput.mode !== undefined && !["change", "background"].includes(String(wsInput.mode))) {
          return NextResponse.json({ error: "Object Swap mode must be change or background." }, { status: 400 });
        }
        if (typeof wsInput.change_to !== "string" && typeof wsInput.image !== "string") {
          return NextResponse.json({ error: "Object Swap requires change_to or a reference image." }, { status: 400 });
        }
      }
      if (wavespeedRoute === "wavespeed-ai/video-upscaler" || wavespeedRoute === "wavespeed-ai/ultimate-video-upscaler") {
        if (typeof wsInput.video !== "string") return NextResponse.json({ error: "Video Upscaler requires a source video." }, { status: 400 });
        if (!["720p", "1080p", "2k", "4k"].includes(String(wsInput.target_resolution || "1080p"))) {
          return NextResponse.json({ error: "Video Upscaler target resolution must be 720p, 1080p, 2k, or 4k." }, { status: 400 });
        }
      }

      // Resolve single images/videos/audios
      for (const key of ["image", "image_url", "video", "end_image", "last_image", "first_frame_url", "last_frame_url"] as const) {
        const mediaValue = wsInput[key];
        if (typeof mediaValue === "string" && mediaValue.trim()) {
          const assetType = getAssetTypeFromKey(key);
          const resolvedUrl = await resolveProviderMediaUrl(mediaValue, { userId, assetType });
          await verifyPublicMediaUrl(resolvedUrl, `wavespeed_${key}`, { expectedMediaKind: assetType });
          wsInput[key] = resolvedUrl;
        }
      }

      // Resolve reference lists (images, videos, audios). WaveSpeed models use both
      // legacy app keys (*_urls) and exact provider keys for routes such as Minimax H3.
      const resolveMediaList = async (key: string, assetType: "image" | "video" | "audio", verifyLabel: string) => {
        const value = wsInput[key];
        if (!Array.isArray(value)) return;
        const validItems: string[] = [];
        for (const u of value) {
          if (typeof u !== "string" || !u.trim()) continue;
          const resolved = await resolveProviderMediaUrl(u, { userId, assetType });
          await verifyPublicMediaUrl(resolved, verifyLabel, { expectedMediaKind: assetType });
          validItems.push(resolved);
        }
        wsInput[key] = validItems;
      };
      await resolveMediaList("reference_image_urls", "image", "wavespeed_ref_image");
      await resolveMediaList("reference_images", "image", "wavespeed_ref_image");
      await resolveMediaList("reference_video_urls", "video", "wavespeed_ref_video");
      await resolveMediaList("reference_videos", "video", "wavespeed_ref_video");
      await resolveMediaList("reference_audio_urls", "audio", "wavespeed_ref_audio");
      await resolveMediaList("reference_audios", "audio", "wavespeed_ref_audio");

      console.log(`[Provider Payload Audit] ---`);
      console.log(`[Provider Payload Audit] Provider: WaveSpeed`);
      console.log(`[Provider Payload Audit] Model: ${wavespeedRoute}`);
      console.log(`[Provider Payload Audit] Route: ${modelRoute}`);
      console.log(`[Provider Payload Audit] Payload:`, JSON.stringify(wsInput, null, 2));
      console.log(`[Provider Payload Audit] ---`);

      const referenceVideoDurationSec = Array.isArray(payload.reference_video_durations)
        ? payload.reference_video_durations.reduce((sum, value) => {
            const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : 0;
            return Number.isFinite(n) && n > 0 ? sum + n : sum;
          }, 0)
        : 0;
      const wsCostEst = estimateProviderCostSync({
        modelRef: modelRoute,
        providerName: "WaveSpeed",
        providerRoute: wavespeedRoute,
        durationSec: durationForCost,
        quality: qualityForCost,
        resolution: qualityForCost,
        referenceVideoDurationSec,
      });

      const charge = await spendCredits({
        userId,
        profileId,
        credits: creditsToCharge,
        prompt: typeof payload.prompt === "string" ? sanitizePrompt(payload.prompt, 5000) : "Video generation",
        assetType: "VIDEO",
        modelUsed: modelRoute,
        resolution: qualityForCost,
        duration: durationForCost,
        aspectRatio: String(payload.aspect_ratio || payload.aspectRatio || "16:9"),
        quality: qualityForCost,
        providerName: "WaveSpeed",
        providerModel: wavespeedRoute,
        providerCostUsd: wsCostEst.usd,
        providerCostSource: wsCostEst.source,
        requestPayload: {
          ...payload,
          routing: routingMetadata(routingDecision),
        },
        idempotency: {
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
        },
      });
      generationId = charge.generationId;
      chargedCredits = creditsToCharge;
      chargedUserId = userId;
      await markProviderDispatched();
      const wsRes = await fetch(`${WAVESPEED_BASE}/${wavespeedRoute}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${wavespeedKey}`,
        },
        body: JSON.stringify(wsInput),
      });

      let wsJson: Record<string, unknown> | null = null;
      try { wsJson = await wsRes.json(); } catch { /* non-JSON */ }
      const wsPredictionId = (wsJson?.data as Record<string, unknown>)?.id ?? wsJson?.id;

      if (!wsRes.ok || !wsPredictionId) {
        if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
          await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        const errorMessage = String((wsJson as Record<string, unknown>)?.message || `WaveSpeed submit failed (${wsRes.status})`);
        const status = await failIdempotency({
          userId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          errorMessage,
          providerDispatched,
        });
        if (status === "review_required") {
          return NextResponse.json({ generationId, status, error: errorMessage }, { status: 409 });
        }
        return NextResponse.json(
          { generationId, error: errorMessage },
          { status: 502 },
        );
      }

      const wsTaskId = `ws:${String(wsPredictionId)}`;
      if (generationId) await setGenerationTaskMarker(generationId, wsTaskId);

      const responseJson = { generationId, taskId: wsTaskId, status: "processing" };
      await completeIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        responseStatus: 200,
        responseJson,
      });
      return NextResponse.json(responseJson);
    }

    // KIE path
    if (!isFinalProviderExecutionAllowed("kie")) {
      const responseJson = providerNotActiveResponse("kie", { modelRoute });
      await completeIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        responseStatus: 503,
        responseJson,
      });
      return NextResponse.json(responseJson, { status: 503 });
    }

    const kieKey = getKieKeyFromEnv();
    if (!kieKey) {
      const responseJson = { error: GENERATION_SERVICE_NOT_CONFIGURED_MESSAGE, code: "kie_key_missing" };
      await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 503, responseJson });
      return NextResponse.json(responseJson, { status: 503 });
    }

    const normalizedInput = normalizeInputForKie(payload);
    const resolvedInput = await resolveMediaInInput(normalizedInput, userId);

    // KIE 3.0 payload diagnostic log
    if (kieModel === "kling-3.0/video") {
      const rawImageUrls = Array.isArray(normalizedInput.image_urls)
        ? (normalizedInput.image_urls as unknown[]).map((u, i) =>
            typeof u === "string" ? `[${i}] ${u.slice(0, 60)}\u2026 (len=${u.length})` : `[${i}] non-string`
          )
        : "not an array";
      console.log(
        `[API/video] Kling 3.0 received image_urls (${Array.isArray(normalizedInput.image_urls) ? (normalizedInput.image_urls as unknown[]).length : 0} items):`,
        JSON.stringify(rawImageUrls, null, 2)
      );
    }

    const requestedVeoResolution =
      kieModel === "veo3" || kieModel === "veo3_fast" || kieModel === "veo3_lite"
        ? (typeof resolvedInput.resolution === "string" ? resolvedInput.resolution.toLowerCase() : "1080p")
        : null;
    const kieInput = mapToKieInput(kieModel!, resolvedInput);

    // Post-map log
    if (kieModel === "kling-3.0/video") {
      const mapped = kieInput as Record<string, unknown>;
      console.log("[API/video] Kling 3.0 kieInput snapshot:", JSON.stringify({
        prompt: mapped.prompt,
        mode: mapped.mode,
        duration: mapped.duration,
        aspect_ratio: mapped.aspect_ratio,
        multi_shots: mapped.multi_shots,
        image_urls: Array.isArray(mapped.image_urls)
          ? (mapped.image_urls as string[]).map((u, i) => `[${i}] ${u.slice(0, 80)}\u2026`)
          : mapped.image_urls,
        has_kling_elements: Array.isArray(mapped.kling_elements) && (mapped.kling_elements as unknown[]).length > 0,
        kling_elements_count: Array.isArray(mapped.kling_elements) ? (mapped.kling_elements as unknown[]).length : 0,
      }, null, 2));
    }

    if (kieModel === "kling-3.0/video") {
      const klingError = validateKling30Payload(kieInput);
      if (klingError) {
        const responseJson = { error: klingError };
        await completeIdempotency({ userId, route: IDEMPOTENCY_ROUTE, key: idempotencyKey, generationId, responseStatus: 400, responseJson });
        return NextResponse.json(responseJson, { status: 400 });
      }
    }

    const kieCostEst = estimateProviderCostSync(modelRoute, durationForCost, qualityForCost);

    const charge = await spendCredits({
      userId,
      profileId,
      credits: creditsToCharge,
      prompt: typeof payload.prompt === "string" ? sanitizePrompt(payload.prompt, 5000) : "Video generation",
      assetType: "VIDEO",
      modelUsed: modelRoute,
      resolution: qualityForCost,
      duration: durationForCost,
      aspectRatio: String(payload.aspect_ratio || payload.aspectRatio || "16:9"),
      quality: qualityForCost,
      providerName: "KIE.ai",
      providerModel: kieModel,
      providerCostUsd: kieCostEst.usd,
      providerCredits: kieCostEst.usd ? kieCostEst.usd / 0.005 : null,
      providerCostSource: kieCostEst.source,
      requestPayload: {
        ...payload,
        routing: routingMetadata(routingDecision),
      },
      idempotency: {
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
      },
    });
    generationId = charge.generationId;
    chargedCredits = creditsToCharge;
    chargedUserId = userId;
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/callback`;

    // Veo 3.1 uses a dedicated endpoint with a flat top-level body.
    // (see https://docs.kie.ai/veo3-api/generate-veo-3-video). NOT /jobs/createTask.
    const isVeoModel = kieModel === "veo3" || kieModel === "veo3_fast" || kieModel === "veo3_lite";
    const createEndpoint = isVeoModel ? `${KIE_BASE}/veo/generate` : `${KIE_BASE}/jobs/createTask`;
    const createBody = isVeoModel
      ? { ...(kieInput as Record<string, unknown>), callBackUrl: callbackUrl }
      : { model: kieModel, callBackUrl: callbackUrl, input: kieInput };

    console.log(`[Provider Payload Audit] ---`);
    console.log(`[Provider Payload Audit] Provider: KIE.ai`);
    console.log(`[Provider Payload Audit] Model: ${kieModel}`);
    console.log(`[Provider Payload Audit] Route: ${modelRoute}`);
    console.log(`[Provider Payload Audit] Payload:`, JSON.stringify(createBody, null, 2));
    console.log(`[Provider Payload Audit] ---`);

    try {
      const fs = require("fs");
      const path = require("path");
      fs.writeFileSync(
        path.join(process.cwd(), "last_kie_request.json"),
        JSON.stringify({ createEndpoint, createBody }, null, 2)
      );
    } catch (err) {
      console.error("Failed to write debug log", err);
    }

    await markProviderDispatched();
    const createRes = await fetch(createEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kieKey}`,
      },
      body: JSON.stringify(createBody),
    });

    let createJson: Record<string, unknown> | null = null;
    try {
      createJson = await createRes.json();
    } catch {
      const text = await createRes.text().catch(() => "");
      console.error("[api/video POST] KIE non-JSON response", createRes.status, text.slice(0, 300));
      if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
        await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
          reason: "generation_refund_provider_failed",
          clearMediaUrl: true,
        });
      }
      const responseJson = {
        error: `KIE returned non-JSON (${createRes.status}): ${text.slice(0, 200)}`,
        publicError: VIDEO_PROVIDER_BUSY_MESSAGE,
        code: "provider_submit_failed",
        providerStatus: createRes.status,
        providerModel: kieModel,
        modelRoute,
      };
      const status = await failIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        errorMessage: responseJson.error,
        providerDispatched,
      });
      if (status === "review_required") {
        return NextResponse.json({ ...responseJson, status }, { status: 409 });
      }
      return NextResponse.json(
        responseJson,
        { status: 502 },
      );
    }

    const createData = createJson?.data as Record<string, unknown> | undefined;
    const rawTaskId = createData?.taskId || createJson?.taskId;
    // Prefix Veo tasks so the GET poller routes to /veo/record-info instead of /jobs/recordInfo
    const veoTaskPrefix =
      requestedVeoResolution === "4k" ? "veo4k" :
      requestedVeoResolution === "1080p" ? "veo1080" :
      "veo";
    const taskId = rawTaskId && isVeoModel ? `${veoTaskPrefix}:${String(rawTaskId)}` : rawTaskId;

    if (!createRes.ok || !taskId) {
      console.error("[api/video POST] KIE createTask failed", createRes.status, JSON.stringify(createJson).slice(0, 500));
      if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
        await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
          reason: "generation_refund_provider_failed",
          clearMediaUrl: true,
        });
      }
      const rawError = providerFailureMessage(createJson, createRes.status);
      let publicError = `Debug: ${rawError} | Payload: ${JSON.stringify(createBody).slice(0, 300)}`;

      if (/safety|policy|violat|censor|moderation|sensitive|block|flagged|nsfw/i.test(rawError)) {
        publicError = "Generation failed because the attached media or prompt violates the provider content policy.";
      }

      const responseJson = {
        generationId,
        error: rawError,
        publicError,
        code: "provider_submit_failed",
        providerStatus: createRes.status,
        providerModel: kieModel,
        modelRoute,
        debugRequest: createBody,
      };
      const status = await failIdempotency({
        userId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        errorMessage: rawError,
        providerDispatched,
      });
      if (status === "review_required") {
        return NextResponse.json({ ...responseJson, status }, { status: 409 });
      }
      return NextResponse.json(
        responseJson,
        { status: 502 },
      );
    }

    if (generationId) {
      await setGenerationTaskMarker(generationId, String(taskId));
    }

    const responseJson = {
      generationId,
      taskId: String(taskId),
      status: "processing",
    };
    await completeIdempotency({
      userId,
      route: IDEMPOTENCY_ROUTE,
      key: idempotencyKey,
      generationId,
      responseStatus: 200,
      responseJson,
    });
    return NextResponse.json(responseJson);
  } catch (err) {
    const idemResponse = idempotencyErrorResponse(err);
    if (idemResponse) return idemResponse;

    if (err instanceof ValidationError) {
      const msg = err.message;
      if (idempotencyClaimed && idempotencyUserId && requestHash) {
        await completeIdempotency({
          userId: idempotencyUserId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          responseStatus: 400,
          responseJson: { error: msg },
        });
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (err instanceof InsufficientCreditsError) {
      const responseJson = {
        error: "Insufficient credits",
        requiredCredits: err.requiredCredits,
        currentBalance: err.currentBalance,
      };
      if (idempotencyClaimed && idempotencyUserId && requestHash) {
        await completeIdempotency({
          userId: idempotencyUserId,
          route: IDEMPOTENCY_ROUTE,
          key: idempotencyKey,
          generationId,
          responseStatus: 402,
          responseJson,
        });
      }
      return NextResponse.json(
        responseJson,
        { status: 402 },
      );
    }

    if (!providerDispatched && chargedCredits > 0 && chargedUserId && generationId) {
      await refundGenerationCharge(generationId, chargedUserId, chargedCredits, {
        reason: "generation_refund_provider_failed",
        clearMediaUrl: true,
      });
    }

    const msg = err instanceof Error ? err.message : "Internal Error";
    console.error("[api/video POST]", err);
    if (idempotencyClaimed && idempotencyUserId && requestHash) {
      const status = await failIdempotency({
        userId: idempotencyUserId,
        route: IDEMPOTENCY_ROUTE,
        key: idempotencyKey,
        generationId,
        errorMessage: msg,
        providerDispatched,
      });
      if (status === "review_required") {
        return NextResponse.json({ generationId, status, error: msg }, { status: 409 });
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    let { userId } = await auth();
    if (!userId && process.env.NODE_ENV !== "production") {
      userId = "user_3CMgl0E1u3OcgATvBIZR3rByAXo";
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const storageConfig = await readStorageRuntimeConfig();

    const { searchParams } = new URL(req.url);
    const requestedTaskId = searchParams.get("taskId");

    if (!requestedTaskId || typeof requestedTaskId !== "string") {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }
    let taskId = normalizePollingTaskId(requestedTaskId);
    const initialLinkedGeneration = await findVideoTaskGeneration(userId, requestedTaskId, taskId);
    const failedGenerationError = resolveFailedGenerationError(initialLinkedGeneration);
    if (failedGenerationError) {
      return NextResponse.json({ taskId: requestedTaskId, status: "failed", outputs: [], error: failedGenerationError });
    }

    const completedGenerationUrl = resolveCompletedGenerationUrl(initialLinkedGeneration, storageConfig);
    if (completedGenerationUrl) {
      return NextResponse.json({ taskId: requestedTaskId, status: "completed", outputs: [completedGenerationUrl], error: null });
    }

    const storedTaskId =
      extractStoredVideoTaskId(initialLinkedGeneration?.mediaUrl) ||
      initialLinkedGeneration?.providerRequestId ||
      null;
    if (storedTaskId) {
      taskId = normalizePollingTaskId(storedTaskId);
    }

    // Direct Google Gemini polling. This route never touches KIE or WaveSpeed.
    if (taskId.startsWith("gvo:")) {
      const handle = decodeGeminiTask(taskId);
      if (!handle) {
        return NextResponse.json({ taskId: requestedTaskId, status: "failed", outputs: [], error: "Invalid Gemini task id" });
      }

      const linkedGeneration = initialLinkedGeneration ?? await prismadb.generation.findFirst({
        where: { userId, mediaUrl: { startsWith: `task:${taskId}` } },
        select: { id: true, cost: true, mediaUrl: true, outputUrl: true, providerRequestId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }).catch(() => null);

      const linkedCompletedUrl = resolveCompletedGenerationUrl(linkedGeneration);
      if (linkedCompletedUrl) {
        return NextResponse.json({ taskId: requestedTaskId, status: "completed", outputs: [linkedCompletedUrl], error: null });
      }

      let poll;
      try {
        poll = await pollVeoOperation(handle);
      } catch (pollErr) {
        const message = errorMessage(pollErr);
        console.error("[api/video GET] Gemini poll error", message);

        if (isMissingProviderTask(message)) {
          const ageMs = linkedGeneration ? (Date.now() - new Date(linkedGeneration.createdAt).getTime()) : 0;
          if (ageMs < 30000 && (message.includes("404") || /not found/i.test(message))) {
            return NextResponse.json({
            taskId: requestedTaskId,
            status: "processing",
            outputs: [],
            error: null,
            });
          }

          if (linkedGeneration && linkedGeneration.cost > 0) {
            await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
              reason: "generation_refund_provider_failed",
              clearMediaUrl: true,
            });
          }
          return NextResponse.json({
            taskId,
            status: "failed",
            outputs: [],
            error: "Render job expired or was not found. Please start a new render.",
          });
        }

        return NextResponse.json({
          taskId,
          status: "processing",
          outputs: [],
          error: null,
        });
      }
      if (!poll.done) {
        return NextResponse.json({ taskId: requestedTaskId, status: "processing", outputs: [], error: null });
      }

      if (!poll.videoUri) {
        if (linkedGeneration && linkedGeneration.cost > 0) {
          await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        const debugMsg = poll.rawResponse ? " - RAW: " + JSON.stringify(poll.rawResponse).substring(0, 300) : "";
        return NextResponse.json({ taskId: requestedTaskId, status: "failed", outputs: [], error: "No video returned" + debugMsg });
      }

      let downloaded;
      try {
        downloaded = await downloadVeoVideo(poll.videoUri);
      } catch (downloadErr) {
        console.error("[api/video GET] Gemini download pending/error", errorMessage(downloadErr));
        return NextResponse.json({ taskId: requestedTaskId, status: "processing", outputs: [], error: null });
      }
      const { buffer, contentType } = downloaded;
      let publicUrl = poll.videoUri;
      if (linkedGeneration) {
        const storedUrl = await uploadBufferToStorage({
          buffer,
          contentType,
          userId,
          assetType: "video",
          generationId: linkedGeneration.id,
        });
        if (!storedUrl) {
          return NextResponse.json({ taskId: requestedTaskId, status: "failed", outputs: [], error: "Storage upload failed" });
        }
        publicUrl = storedUrl;
        await completeTaskGeneration({ generationId: linkedGeneration.id, mediaUrl: publicUrl });
      }

      return NextResponse.json({ taskId: requestedTaskId, status: "completed", outputs: [normalizeMediaUrl(publicUrl, { config: storageConfig }) || publicUrl], error: null });
    }

    // -- WaveSpeed polling ---
    if (taskId.startsWith("ark:")) {
      if (!isFinalProviderExecutionAllowed("byteplus")) {
        return NextResponse.json(providerNotActiveResponse("byteplus", { taskId }), { status: 503 });
      }

      const arkTaskId = taskId.slice(4);
      const arkKey = getArkApiKeyFromEnv();
      if (!arkKey) {
        return NextResponse.json({ error: "BytePlus ModelArk provider is not configured. Add ARK_API_KEY.", code: "ark_key_missing" }, { status: 503 });
      }

      const linkedGeneration = await prismadb.generation.findFirst({
        where: { userId, mediaUrl: { startsWith: `task:${taskId}` } },
        select: { id: true, cost: true, mediaUrl: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }).catch(() => null);

      if (linkedGeneration?.mediaUrl && !linkedGeneration.mediaUrl.startsWith("task:")) {
        if (!linkedGeneration.mediaUrl.startsWith("failed:")) {
          return NextResponse.json({ taskId, status: "completed", outputs: [normalizeMediaUrl(linkedGeneration.mediaUrl, { config: storageConfig }) || linkedGeneration.mediaUrl], error: null });
        }
      }

      let result;
      try {
        result = await fetchBytePlusTask(arkTaskId);
      } catch (pollError) {
        console.error("[api/video GET] BytePlus poll error", pollError);
        return NextResponse.json({ taskId, status: "processing", outputs: [], error: null });
      }

      const withinMissingTaskGrace =
        result.missing &&
        linkedGeneration &&
        Date.now() - linkedGeneration.createdAt.getTime() < 15 * 60_000;
      const status = withinMissingTaskGrace ? "processing" : result.status;
      const outputs = result.outputs;
      const error = withinMissingTaskGrace ? null : result.error;

      try {
        if (status === "completed" && outputs.length > 0 && linkedGeneration) {
          await completeTaskGeneration({ generationId: linkedGeneration.id, mediaUrl: outputs[0] });
        }

        if (status === "failed" && linkedGeneration && linkedGeneration.cost > 0) {
          await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
      } catch (dbErr) {
        console.error("[api/video GET] non-fatal BytePlus DB sync error", dbErr);
      }

      if (status === "completed" && outputs.length === 0) {
        const missingOutputError = "BytePlus ModelArk marked the task as succeeded but returned no video_url.";
        if (linkedGeneration && linkedGeneration.cost > 0) {
          await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
            reason: "generation_refund_provider_failed",
            clearMediaUrl: true,
          });
        }
        return NextResponse.json({ taskId, status: "failed", outputs: [], error: missingOutputError });
      }

      return NextResponse.json({ taskId, status, outputs: outputs.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url), error });
    }

    if (taskId.startsWith("ws:")) {
      const predictionId = taskId.slice(3);
      const wsKey = process.env.WAVESPEED_API_KEY;
      if (!wsKey) {
        return NextResponse.json({ error: "WaveSpeed provider is not configured.", code: "wavespeed_key_missing" }, { status: 503 });
      }
      const headers = { Authorization: `Bearer ${wsKey}` };
      let wsData: Record<string, unknown> = {};
      let wsStatus = "processing";
      let wsOutputs: string[] = [];
      let wsError: string | null = null;

      const wsResultRes = await fetch(`${WAVESPEED_BASE}/predictions/${predictionId}/result`, {
        headers,
        cache: "no-store",
      });
      let wsResultJson: Record<string, unknown> | null = null;
      try { wsResultJson = await wsResultRes.json(); } catch { /* ignore */ }
      if (wsResultRes.ok && wsResultJson) {
        wsData = (wsResultJson.data as Record<string, unknown>) ?? wsResultJson;
        wsStatus = normalizeTaskState(String(wsData.status ?? wsResultJson.status ?? ""));
        wsOutputs = extractOutputs(wsData.outputs ?? wsData.result ?? wsData.response ?? wsData);
        wsError = typeof wsData.error === "string" ? wsData.error : null;
      }

      if (!wsResultRes.ok || (wsStatus !== "completed" && wsOutputs.length === 0)) {
        const wsStatusRes = await fetch(`${WAVESPEED_BASE}/predictions/${predictionId}`, {
          headers,
          cache: "no-store",
        });
        let wsJson: Record<string, unknown> | null = null;
        try { wsJson = await wsStatusRes.json(); } catch { /* ignore */ }
        if (wsStatusRes.ok && wsJson) {
          const statusData = (wsJson.data as Record<string, unknown>) ?? wsJson;
          const statusOutputs = extractOutputs(statusData.outputs ?? statusData.result ?? statusData.response ?? statusData);
          wsData = { ...statusData, ...wsData };
          wsStatus = normalizeTaskState(String(wsData.status ?? statusData.status ?? ""));
          wsOutputs = wsOutputs.length ? wsOutputs : statusOutputs;
          wsError =
            (typeof wsData.error === "string" ? wsData.error : null) ??
            (typeof statusData.error === "string" ? statusData.error : null);
        } else if (!wsResultRes.ok) {
          return NextResponse.json({ taskId, status: "processing", outputs: [], error: null });
        }
      }

      if (wsStatus === "completed" && wsOutputs.length === 0) {
        wsStatus = "processing";
      }

      const wsErrorFromData = typeof wsData.error === "string" ? wsData.error : null;
      wsError = wsError ?? wsErrorFromData;

      // DB sync for completion / refund on failure
      try {
        const linkedGeneration = await prismadb.generation.findFirst({
          where: { userId, mediaUrl: { startsWith: `task:${taskId}` } },
          select: { id: true, cost: true, mediaUrl: true },
          orderBy: { createdAt: "desc" },
        });
        if (linkedGeneration) {
          if (wsStatus === "completed" && wsOutputs.length > 0 && linkedGeneration.mediaUrl?.startsWith("task:")) {
            await completeTaskGeneration({ generationId: linkedGeneration.id, mediaUrl: wsOutputs[0] });
          }
          if (wsStatus === "failed" && linkedGeneration.cost > 0) {
            await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
              reason: "generation_refund_provider_failed",
              clearMediaUrl: true,
            });
          }
        }
      } catch { /* best-effort */ }

      return NextResponse.json({ taskId, status: wsStatus, outputs: wsOutputs.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url), error: wsError });
    }

    // Veo 3.1 polling (dedicated endpoint /api/v1/veo/record-info).
    // Confirmed: https://docs.kie.ai/veo3-api/get-veo-3-video-details
    // successFlag: 0=generating, 1=success, 2=failed, 3=generation_failed
    if (taskId.startsWith("veo:") || taskId.startsWith("veo1080:") || taskId.startsWith("veo4k:")) {
      if (!isFinalProviderExecutionAllowed("kie")) {
        return NextResponse.json(providerNotActiveResponse("kie", { taskId }), { status: 503 });
      }

      const kieKey = getKieKeyFromEnv();
      if (!kieKey) {
        return NextResponse.json({ error: GENERATION_SERVICE_NOT_CONFIGURED_MESSAGE, code: "kie_key_missing" }, { status: 503 });
      }
      const veoVariant = taskId.startsWith("veo4k:") ? "4k" : taskId.startsWith("veo1080:") ? "1080p" : "base";
      const veoTaskId = taskId.replace(/^veo(?:1080|4k)?:/, "");
      const veoRes = await fetch(`${KIE_BASE}/veo/record-info?taskId=${encodeURIComponent(veoTaskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${kieKey}` },
        cache: "no-store",
      });
      let veoJson: Record<string, unknown> | null = null;
      try { veoJson = await veoRes.json(); } catch { /* ignore */ }
      if (veoRes.status === 404) {
        return NextResponse.json({ taskId, status: "failed", outputs: [], error: "Task not found" });
      }
      const veoCodeOk = veoJson?.code == null || veoJson.code === 200 || veoJson.code === 0;
      if (!veoRes.ok || !veoCodeOk) {
        return NextResponse.json({ taskId, status: "processing", outputs: [], error: null });
      }
      const veoData = (veoJson?.data ?? {}) as Record<string, unknown>;
      const successFlag = veoData.successFlag;
      let veoStatus: "processing" | "completed" | "failed" = "processing";
      if (successFlag === 1) veoStatus = "completed";
      else if (successFlag === 2 || successFlag === 3) veoStatus = "failed";
      const veoResponse = (veoData.response ?? {}) as Record<string, unknown>;
      const fullUrls = Array.isArray(veoResponse.fullResultUrls)
        ? (veoResponse.fullResultUrls as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const resultUrls = Array.isArray(veoResponse.resultUrls)
        ? (veoResponse.resultUrls as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      // Prefer fullResultUrls when present (post-extension), fall back to resultUrls.
      const veoOutputs = [...(fullUrls.length > 0 ? fullUrls : resultUrls)];
      const veoError = typeof veoData.errorMessage === "string" && veoData.errorMessage
        ? veoData.errorMessage
        : null;

      if (veoStatus === "completed" && veoVariant === "1080p") {
        const hdRes = await fetch(`${KIE_BASE}/veo/get-1080p-video?taskId=${encodeURIComponent(veoTaskId)}&index=0`, {
          method: "GET",
          headers: { Authorization: `Bearer ${kieKey}` },
          cache: "no-store",
        });
        const hdJson = (await hdRes.json().catch(() => null)) as Record<string, unknown> | null;
        const hdData = (hdJson?.data ?? {}) as Record<string, unknown>;
        const hdUrl = typeof hdData.resultUrl === "string" ? hdData.resultUrl : null;
        if (hdRes.ok && hdUrl) {
          veoOutputs.splice(0, veoOutputs.length, hdUrl);
        } else {
          return NextResponse.json({ taskId, status: "processing", outputs: [], error: null });
        }
      }

      if (veoStatus === "completed" && veoVariant === "4k") {
        const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/api/callback`;
        const fourKRes = await fetch(`${KIE_BASE}/veo/get-4k-video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${kieKey}`,
          },
          body: JSON.stringify({ taskId: veoTaskId, index: 0, callBackUrl: callbackUrl }),
          cache: "no-store",
        });
        const fourKJson = (await fourKRes.json().catch(() => null)) as Record<string, unknown> | null;
        const fourKData = (fourKJson?.data ?? {}) as Record<string, unknown>;
        const urls = Array.isArray(fourKData.resultUrls)
          ? (fourKData.resultUrls as unknown[]).filter((v): v is string => typeof v === "string")
          : [];
        if (fourKRes.ok && urls.length > 0) {
          veoOutputs.splice(0, veoOutputs.length, urls[0]);
        } else {
          return NextResponse.json({ taskId, status: "processing", outputs: [], error: null });
        }
      }

      // DB sync (best-effort): generation row stores prefixed taskId via setGenerationTaskMarker.
      try {
        const linkedGeneration = await prismadb.generation.findFirst({
          where: { userId, mediaUrl: { startsWith: `task:${taskId}` } },
          select: { id: true, cost: true, mediaUrl: true },
          orderBy: { createdAt: "desc" },
        });
        if (linkedGeneration) {
          if (veoStatus === "completed" && veoOutputs.length > 0 && linkedGeneration.mediaUrl?.startsWith("task:")) {
            await completeTaskGeneration({ generationId: linkedGeneration.id, mediaUrl: veoOutputs[0] });
          }
          if (veoStatus === "failed" && linkedGeneration.cost > 0) {
            await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
              reason: "generation_refund_provider_failed",
              clearMediaUrl: true,
            });
          }
        }
      } catch { /* best-effort */ }

      return NextResponse.json({ taskId, status: veoStatus, outputs: veoOutputs.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url), error: veoError });
    }

    // -- KIE polling ---
    if (!isFinalProviderExecutionAllowed("kie")) {
      return NextResponse.json(providerNotActiveResponse("kie", { taskId }), { status: 503 });
    }

    const kieKey = getKieKeyFromEnv();
    if (!kieKey) {
      return NextResponse.json({ error: GENERATION_SERVICE_NOT_CONFIGURED_MESSAGE, code: "kie_key_missing" }, { status: 503 });
    }
    const pollRes = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${kieKey}` },
      cache: "no-store",
    });

    let pollJson: Record<string, unknown> | null = null;
    try {
      pollJson = await pollRes.json();
    } catch {
      const text = await pollRes.text().catch(() => "");
      console.error("[api/video GET] KIE non-JSON poll response", pollRes.status, text.slice(0, 300));
      return NextResponse.json(
        { taskId, status: "processing", outputs: [], error: null },
      );
    }

    // KIE uses code: 200 for success, but fallback: if HTTP is OK and data exists, treat as success
    const kieCodeOk = pollJson?.code == null || pollJson.code === 200 || pollJson.code === 0;
    if (pollRes.status === 404) {
      // Task not found in KIE; may have been cleaned up. Treat as completed if DB has result.
      return NextResponse.json(
        { taskId, status: "failed", outputs: [], error: "Task not found" },
        { status: 200 },
      );
    }
    if (!pollRes.ok || !kieCodeOk) {
      return NextResponse.json(
        { error: pollJson?.msg || pollJson?.message || `KIE poll failed (${pollRes.status})` },
        { status: 502 },
      );
    }

    const data = (pollJson?.data ?? {}) as Record<string, unknown>;
    const status = normalizeTaskState(String(data.taskStatus || data.status || data.state || ""));
    const outputs = (() => {
      for (const field of [data.response, data.resultJson, data.outputs, data.result, data.output, data.works]) {
        const found = extractOutputs(field);
        if (found.length) return found;
      }
      return [] as string[];
    })();
    const error = typeof data.errorMessage === "string" ? data.errorMessage
      : typeof data.failMsg === "string" ? data.failMsg : null;

    // DB sync is best-effort; status polling should still work even if DB is temporarily unavailable.
    try {
      const linkedGeneration = await prismadb.generation.findFirst({
        where: { userId, mediaUrl: { startsWith: `task:${taskId}` } },
        select: { id: true, cost: true, mediaUrl: true },
        orderBy: { createdAt: "desc" },
      });

      // Check if callback already resolved this task in DB
      if (linkedGeneration?.mediaUrl && !linkedGeneration.mediaUrl.startsWith("task:")) {
        if (linkedGeneration.mediaUrl.startsWith("failed:")) {
          const parts = linkedGeneration.mediaUrl.split(":");
          const errMsg = parts.slice(2).join(":") || "Generation failed";
          return NextResponse.json({ taskId, status: "failed", outputs: [], error: errMsg });
        }
        // Already has a real URL from callback
        return NextResponse.json({ taskId, status: "completed", outputs: [normalizeMediaUrl(linkedGeneration.mediaUrl, { config: storageConfig }) || linkedGeneration.mediaUrl], error: null });
      }

      if (status === "completed" && outputs.length > 0 && linkedGeneration) {
        await completeTaskGeneration({ generationId: linkedGeneration.id, mediaUrl: outputs[0] });
      }

      if (status === "failed" && linkedGeneration && linkedGeneration.cost > 0) {
        await refundGenerationCharge(linkedGeneration.id, userId, linkedGeneration.cost, {
          reason: "generation_refund_provider_failed",
          clearMediaUrl: true,
        });
      }
    } catch (dbErr) {
      console.error("[api/video GET] non-fatal DB sync error", dbErr);
    }

    return NextResponse.json({
      taskId: String(data.taskId || taskId),
      status,
      outputs: outputs.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url),
      error,
    });
  } catch (err) {
    console.error("[api/video GET]", err);
    return NextResponse.json({ error: "Internal error while checking generation status" }, { status: 500 });
  }
}
