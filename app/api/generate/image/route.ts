import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/is-admin";
import { getGenerationCost } from "@/lib/pricing";
import { IMAGE_MODELS, getWaveSpeedGptImage25Credits } from "@/lib/image-models";
import { getCentralizedDynamicImageModels } from "@/lib/model-definition-registry";
import { InsufficientCreditsError, recordFreeGeneration, rollbackGenerationCharge, saveAdditionalGenerationUrls, setActualProviderUsage, setGenerationMediaUrl, spendCredits } from "@/lib/credit-ledger";
import { applyAnnualUnlimitedImageSlowdown, getAnnualUnlimitedImageEligibility } from "@/lib/annual-image-unlimited";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, isAllowedOrigin, sanitizePrompt } from "@/lib/security";
import { isStorageConfigured, uploadBufferToStorage } from "@/lib/supabase-storage";
import { checkStoryboardReferenceImageSafety, UnsafeReferenceImageError } from "@/lib/storyboard-reference-safety";
import { normalizeMediaUrl, readStorageRuntimeConfig } from "@/lib/storage";
import { applyImageWatermarkMany } from "@/lib/watermark";
import { resolveProviderMediaUrl, verifyPublicMediaUrl, ValidationError } from "@/lib/media/public-url-resolver";
import { buildWaveSpeedImageInput, resolveWaveSpeedImageModelRoute, normalizeWaveSpeedModelEndpoint, type WaveSpeedImageRouteConfig } from "@/lib/wavespeed-image-routing";
import { resolveRuntimeProviderRoute, routingMetadata } from "@/lib/routing/runtime-routing";
import {
  buildGoogleImageGenerationConfig,
  buildGoogleImageResponseFormat,
  formatGoogleImagePrompt,
  getGoogleImageUpstreamModel,
  normalizeGoogleImageSize,
  withGoogleImageControlHints,
} from "@/lib/google-image-model-specs";
import { assertMobileCapabilityAllowed, MobileCapabilityDisabledError } from "@/lib/mobile/mobile-control-plane";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WAVESPEED_BASE_URL = "https://api.wavespeed.ai/api/v3";
const IDEMPOTENCY_ROUTE = "generate:image";
const OPENAI_IMAGE_MODEL_MAP: Record<string, string> = {
  // Released 2026-09-08. Both variants sit on /v1/images/generations and
  // /v1/images/edits, exactly like gpt-image-2, so generateOpenAIImage needs
  // no change — only the id mapping.
  "gpt-image-2-text-to-image": "gpt-image-2",
  "gpt-image-2-image-to-image": "gpt-image-2",
  "gpt-image/1.5-text-to-image": "gpt-image-1.5",
  "gpt-image/1.5-image-to-image": "gpt-image-1.5",
};

interface ImageRequestBody {
  prompt: string;
  modelId: string;
  aspectRatio?: string;
  resolution?: string;
  imageSize?: string;
  numImages?: number;
  negativePrompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  useAnnualUnlimited?: boolean;
  feature?: string;
  /** Provider input field override for legacy callers. */
  imageInputField?: string;
}

function extractProviderOutputUrls(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractProviderOutputUrls(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    if (/^https?:\/\//i.test(trimmed)) return [trimmed];
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractProviderOutputUrls(item));
  }

  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const direct = rec.url ?? rec.imageUrl ?? rec.image_url ?? rec.downloadUrl;
    if (typeof direct === "string") return extractProviderOutputUrls(direct);

    const candidates = [
      rec.resultUrls,
      rec.imageUrls,
      rec.images,
      rec.outputs,
      rec.urls,
      rec.result,
      rec.output,
      rec.response,
      rec.data,
    ];
    for (const candidate of candidates) {
      const urls = extractProviderOutputUrls(candidate);
      if (urls.length) return urls;
    }
  }

  return [];
}

function resolveFlux2Variant(modelId: string, hasReferenceImages: boolean, quality?: string | null): string {
  const normalized = modelId.toLowerCase();
  let prefix: "pro" | "flex" | null = null;

  if (normalized === "flux-2/flex") {
    prefix = "flex";
  } else if (normalized === "flux-2/pro" || normalized === "flux-2/max") {
    prefix = "pro";
  } else if (normalized === "flux-2") {
    const tier = typeof quality === "string" ? quality.trim().toUpperCase() : "";
    prefix = tier === "1K" ? "flex" : "pro";
  }

  if (!prefix) return modelId;
  return hasReferenceImages
    ? `flux-2/${prefix}-image-to-image`
    : `flux-2/${prefix}-text-to-image`;
}

function resolveSeedream5ProVariant(modelId: string, hasReferenceImages: boolean): string {
  const normalized = modelId.toLowerCase();
  if (normalized === "seedream/5-pro") {
    return hasReferenceImages
      ? "seedream/5-pro-image-to-image"
      : "seedream/5-pro-text-to-image";
  }
  return modelId;
}

function resolveSeedream5ProWaveSpeedRoute(modelId: string): string | null {
  const normalized = modelId.toLowerCase();
  if (normalized === "seedream/5-pro-text-to-image" || normalized === "bytedance/seedream-v5.0-pro") {
    return "bytedance/seedream-v5.0-pro";
  }
  if (normalized === "seedream/5-pro-image-to-image" || normalized === "bytedance/seedream-v5.0-pro/edit") {
    return "bytedance/seedream-v5.0-pro/edit";
  }
  return null;
}

function resolveSeedream5LiteWaveSpeedRoute(
  modelId: string,
  hasReferenceImages: boolean,
  numImages: number,
): string | null {
  const normalized = modelId.toLowerCase();
  const isLiteAlias =
    normalized === "seedream/5-lite" ||
    normalized === "bytedance/seedream-v5.0-lite" ||
    normalized === "bytedance/seedream-v5.0-lite/edit" ||
    normalized === "bytedance/seedream-v5.0-lite/sequential" ||
    normalized === "bytedance/seedream-v5.0-lite/edit-sequential";
  if (!isLiteAlias) return null;
  const wantsMulti = numImages > 1;
  if (hasReferenceImages) {
    return wantsMulti
      ? "bytedance/seedream-v5.0-lite/edit-sequential"
      : "bytedance/seedream-v5.0-lite/edit";
  }
  return wantsMulti
    ? "bytedance/seedream-v5.0-lite/sequential"
    : "bytedance/seedream-v5.0-lite";
}

function resolveWaveSpeedImageRoute(
  modelId: string,
  hasReferenceImages: boolean,
  numImages: number,
): string | null {
  return (
    resolveSeedream5ProWaveSpeedRoute(modelId) ??
    resolveSeedream5LiteWaveSpeedRoute(modelId, hasReferenceImages, numImages)
  );
}

function normalizeSeedream5ProResolution(value: unknown): "1k" | "2k" {
  const normalized = String(value ?? "1k").trim().toLowerCase();
  return normalized.includes("2") ? "2k" : "1k";
}

// Seedream Lite uses a `size` param in the form "W*H" (pixels, range 1440..8192).
// Map the UI quality tier ("2K" / "4K") to a square pixel size.
function normalizeSeedream5LiteSize(value: unknown): string {
  const normalized = String(value ?? "2K").trim().toLowerCase();
  if (normalized.includes("4")) return "4096*4096";
  return "2048*2048";
}

function getGoogleImageModel(modelId: string): string | null {
  return getGoogleImageUpstreamModel(modelId);
}

function getOpenAIImageModel(modelId: string): string | null {
  return OPENAI_IMAGE_MODEL_MAP[modelId] ?? null;
}

function findStaticImageModel(...modelIds: string[]) {
  for (const id of modelIds) {
    const model = IMAGE_MODELS.find((item) => item.id === id);
    if (model) return model;
  }
  return null;
}

function getImageReferenceLimit(
  modelId: string,
  effectiveModelId: string,
  dynamicModel?: { maxRefImages?: unknown } | null,
): number {
  if (modelId.startsWith("flux-kontext") || effectiveModelId.startsWith("flux-kontext")) {
    return 1;
  }
  if (modelId.includes("gpt-image-2") || effectiveModelId.includes("gpt-image-2")) {
    return 16;
  }

  const dynamicLimit = Number(dynamicModel?.maxRefImages);
  if (Number.isFinite(dynamicLimit) && dynamicLimit >= 0) {
    return Math.floor(dynamicLimit);
  }

  const staticModel = findStaticImageModel(modelId, effectiveModelId);
  return Math.max(0, Math.floor(Number(staticModel?.maxRefImages) || 0));
}

function normalizeOpenAIImageSize(aspectRatio: string): string {
  switch (aspectRatio) {
    case "1:1":
      return "1024x1024";
    case "9:16":
    case "3:4":
      return "1024x1536";
    case "16:9":
    case "4:3":
      return "1536x1024";
    case "auto":
    default:
      return "auto";
  }
}

function normalizeOpenAIImageQuality(value?: string | null): "low" | "medium" | "high" {
  const normalized = String(value ?? "medium").trim().toLowerCase();
  if (normalized === "1k" || normalized === "low") return "low";
  if (normalized === "2k" || normalized === "medium") return "medium";
  if (normalized === "4k" || normalized === "high") return "high";
  return "medium";
}

function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function imageUrlToInlineData(url: string): Promise<{ mimeType: string; data: string }> {
  const inline = dataUrlToInlineData(url);
  if (inline) return inline;

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch reference image for Google (${res.status})`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buffer.toString("base64") };
}

async function imageUrlToOpenAIBlob(url: string): Promise<{ blob: Blob; fileName: string }> {
  const inline = dataUrlToInlineData(url);
  if (inline) {
    const ext = inline.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return {
      blob: new Blob([Buffer.from(inline.data, "base64")], { type: inline.mimeType }),
      fileName: `reference.${ext}`,
    };
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch reference image for OpenAI (${res.status})`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return {
    blob: new Blob([buffer], { type: mimeType }),
    fileName: `reference.${ext}`,
  };
}

function extractOpenAIBase64Images(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const data = Array.isArray(rec.data) ? rec.data : [];
  return data.flatMap((item) => {
    const b64 = (item as Record<string, unknown>)?.b64_json;
    return typeof b64 === "string" && b64 ? [b64] : [];
  });
}

async function generateOpenAIImage(params: {
  apiKey: string;
  openAIModel: string;
  prompt: string;
  referenceUrls: string[];
  aspectRatio: string;
  quality?: string | null;
}): Promise<Array<{ buffer: Buffer; mimeType: string }>> {
  const size = normalizeOpenAIImageSize(params.aspectRatio);
  const quality = normalizeOpenAIImageQuality(params.quality);
  const endpoint = params.referenceUrls.length > 0
    ? "https://api.openai.com/v1/images/edits"
    : "https://api.openai.com/v1/images/generations";

  const headers = { Authorization: `Bearer ${params.apiKey}` };
  let body: BodyInit;

  if (params.referenceUrls.length > 0) {
    const form = new FormData();
    form.append("model", params.openAIModel);
    form.append("prompt", sanitizePrompt(params.prompt, 5000));
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", "png");
    for (const ref of params.referenceUrls.slice(0, 16)) {
      const file = await imageUrlToOpenAIBlob(ref);
      form.append("image", file.blob, file.fileName);
    }
    body = form;
  } else {
    body = JSON.stringify({
      model: params.openAIModel,
      prompt: sanitizePrompt(params.prompt, 5000),
      size,
      quality,
      output_format: "png",
    });
    Object.assign(headers, { "Content-Type": "application/json" });
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof json?.error?.message === "string" ? json.error.message : `OpenAI image generation failed (${res.status})`;
    throw new Error(message);
  }

  const images = extractOpenAIBase64Images(json);
  if (!images.length) throw new Error("OpenAI completed but returned no image.");
  return images.map((data) => ({ buffer: Buffer.from(data, "base64"), mimeType: "image/png" }));
}


function extractGoogleInteractionImages(value: unknown): Array<{ data: string; mimeType: string }> {
  const out: Array<{ data: string; mimeType: string }> = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = node as Record<string, unknown>;
    const outputImage = (rec.output_image ?? rec.outputImage ?? rec.image) as Record<string, unknown> | undefined;
    const data = outputImage?.data ?? outputImage?.b64_json ?? rec.data;
    if (typeof data === "string" && data) {
      const mimeType = typeof outputImage?.mime_type === "string"
        ? outputImage.mime_type
        : typeof outputImage?.mimeType === "string"
          ? outputImage.mimeType
          : typeof rec.mime_type === "string"
            ? rec.mime_type
            : "image/png";
      out.push({ data, mimeType });
    }
    for (const key of ["output", "content", "parts", "steps", "response", "result", "data"]) {
      visit(rec[key]);
    }
  };
  visit(value);
  return out.length ? out : extractGoogleInlineImages(value);
}
function extractGoogleInlineImages(value: unknown): Array<{ data: string; mimeType: string }> {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const candidates = Array.isArray(rec.candidates) ? rec.candidates : [];
  return candidates.flatMap((candidate) => {
    const content = (candidate as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return parts.flatMap((part) => {
      const inlineData = (part as Record<string, unknown>)?.inlineData as Record<string, unknown> | undefined;
      const data = inlineData?.data;
      if (typeof data !== "string" || !data) return [];
      const mimeType = typeof inlineData?.mimeType === "string" ? inlineData.mimeType : "image/png";
      return [{ data, mimeType }];
    });
  });
}

async function generateGoogleImage(params: {
  apiKey: string;
  googleModel: string;
  prompt: string;
  referenceUrls: string[];
  aspectRatio: string;
  quality?: string | null;
}): Promise<Array<{ buffer: Buffer; mimeType: string }>> {
  const initialResponseFormat = buildGoogleImageResponseFormat(params.googleModel, params.aspectRatio, params.quality);
  const promptText = withGoogleImageControlHints(
    formatGoogleImagePrompt(params.prompt),
    initialResponseFormat.aspect_ratio,
    initialResponseFormat.image_size,
  );
  const input: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
  for (const ref of params.referenceUrls) {
    const inline = await imageUrlToInlineData(ref);
    input.push({ type: "image", mime_type: inline.mimeType, data: inline.data });
  }

  const imageSize = normalizeGoogleImageSize(params.googleModel, params.quality);
  const makeRequest = async (requestedImageSize: string | null) => {
    const responseFormat = buildGoogleImageResponseFormat(params.googleModel, params.aspectRatio, requestedImageSize);
    const googleBody = {
      model: params.googleModel,
      input,
      response_format: responseFormat,
      generation_config: buildGoogleImageGenerationConfig(params.googleModel, params.aspectRatio),
    };
    console.log("GOOGLE_BODY", JSON.stringify(redactGoogleImageBodyForLog(googleBody), null, 2));

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": params.apiKey,
        "Content-Type": "application/json",
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify(googleBody),
      signal: AbortSignal.timeout(180_000),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = typeof json?.error?.message === "string" ? json.error.message : `Google image generation failed (${res.status})`;
      return { success: false, error: message, json };
    }
    return { success: true, json };
  };

  let attempt = await makeRequest(imageSize);
  if (!attempt.success) {
    const errStr = String(attempt.error || "");
    if (/image size|resolution|response_format|image_size/i.test(errStr) && imageSize && imageSize !== "1K") {
      console.warn(`[generateGoogleImage] Resolution ${imageSize} failed for model ${params.googleModel}. Retrying with 1K...`);
      attempt = await makeRequest("1K");
    }
  }

  if (!attempt.success) {
    throw new Error(attempt.error || "Google image generation failed");
  }

  const json = attempt.json;
  const images = extractGoogleInteractionImages(json);
  if (!images.length) {
    const candidates = json && typeof json === "object" && Array.isArray((json as Record<string, any>).candidates)
      ? (json as Record<string, any>).candidates
      : [];
    const finishReason = candidates[0]?.finishReason;
    if (finishReason) {
      throw new Error(`Google image generation was blocked or did not output an image. Reason: ${finishReason}`);
    }
    const stepText = (json as any)?.steps?.[0]?.content?.[0]?.text;
    if (typeof stepText === "string" && stepText.trim()) {
      throw new Error(`Google returned text description instead of an image. Ensure the prompt describes a visual scene.`);
    }
    throw new Error(`Google completed but returned no image artifact.`);
  }
  return images.map((image) => ({ buffer: Buffer.from(image.data, "base64"), mimeType: image.mimeType }));
}

function redactGoogleImageBodyForLog(body: { model: string; input: Array<Record<string, unknown>>; response_format: Record<string, string> }) {
  return {
    model: body.model,
    input: body.input.map((block) => {
      if (block.type === "text") {
        return {
          type: "text",
          textLength: typeof block.text === "string" ? block.text.length : 0,
        };
      }
      return {
        type: block.type,
        mime_type: block.mime_type,
        dataLength: typeof block.data === "string" ? block.data.length : 0,
      };
    }),
    response_format: body.response_format,
  };
}

async function pollWaveSpeedImageTask(taskId: string, apiKey: string, maxAttempts = 150): Promise<string[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Initial quick check after 1000ms, then every 2000ms
    const waitTime = attempt === 0 ? 1000 : 2000;
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    const resultRes = await fetch(
      `${WAVESPEED_BASE_URL}/predictions/${encodeURIComponent(taskId)}/result`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const resultJson = await resultRes.json().catch(() => null) as Record<string, unknown> | null;
    if (!resultRes.ok) {
      if (resultRes.status === 404) continue;
      throw new Error(`WaveSpeed poll failed (${resultRes.status})`);
    }

    const data = (resultJson?.data ?? resultJson) as Record<string, unknown> | null;
    const status = String(data?.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success" || status === "done") {
      const urls = extractProviderOutputUrls(data?.outputs ?? data?.output ?? data?.result ?? data?.resultUrls ?? data?.imageUrls ?? data?.images ?? data?.urls ?? data);
      if (!urls.length) throw new Error("WaveSpeed task completed but returned no image URLs.");
      return urls;
    }
    if (["failed", "cancelled", "timeout", "error"].includes(status)) {
      throw new Error(String(data?.error ?? data?.errorMessage ?? data?.message ?? "WaveSpeed image generation failed."));
    }
  }
  throw new Error("WaveSpeed image generation timed out.");
}


export async function POST(req: NextRequest) {
  let chargedCredits = 0;
  let chargedUserId: string | null = null;
  let generationId: string | null = null;

  try {
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

    const storageConfig = await readStorageRuntimeConfig();

    const ip = getClientIp(req);
    const rate = checkRateLimit(`image:${userId}:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(rate) });
    }

    const body: ImageRequestBody = await req.json();
    const {
      prompt,
      modelId,
      aspectRatio = "1:1",
      numImages = 1,
      negativePrompt,
      imageUrl,
      imageUrls: imageUrlsParam,
      quality,
      resolution,
      imageSize,
      outputFormat,
      useAnnualUnlimited = true,
      feature,
    } = body;

    const profileIdFromHeader = req.headers.get("x-profile-id") || req.cookies.get("saad_active_profile_id")?.value;
    const profileId = typeof (body as any)?.profileId === "string" ? (body as any).profileId : profileIdFromHeader || undefined;

    if (!prompt || !modelId) {
      return NextResponse.json(
        { error: "Missing required fields: prompt, modelId." },
        { status: 400 },
      );
    }

    try {
      await assertMobileCapabilityAllowed("mobile.image.generate.enabled", req.headers.get("user-agent"));
    } catch (mobileErr) {
      if (mobileErr instanceof MobileCapabilityDisabledError) {
        return NextResponse.json({ error: mobileErr.message, code: "mobile_capability_disabled" }, { status: 403 });
      }
    }

    if (feature === "influencers-nsfw" || feature === "nsfw" || feature === "influencers") {
      const admin = await isAdmin();
      if (!admin) {
        return NextResponse.json(
          { error: "Forbidden: Admin access required for Influencers NSFW feature." },
          { status: 403 },
        );
      }
    }

    // Early check: reference images require Supabase storage to be configured
    const rawRefUrls: string[] = [];
    if (imageUrl) rawRefUrls.push(imageUrl);
    if (imageUrlsParam?.length) rawRefUrls.push(...imageUrlsParam);

    const hasReferenceImages = Boolean(imageUrl || imageUrlsParam?.length);
    let effectiveModelId = resolveFlux2Variant(modelId, hasReferenceImages, quality);
    effectiveModelId = resolveSeedream5ProVariant(effectiveModelId, hasReferenceImages);

    const dynamicModels = await getCentralizedDynamicImageModels();
    const dynamicModel = dynamicModels.find(
      (m) =>
        (m.id.toLowerCase() === modelId.toLowerCase() ||
         m.id.toLowerCase() === effectiveModelId.toLowerCase() ||
         m.label.toLowerCase() === modelId.toLowerCase() ||
         (m.upstreamModelId && m.upstreamModelId.toLowerCase() === modelId.toLowerCase()) ||
         (m.text_api_route && m.text_api_route.toLowerCase() === modelId.toLowerCase())) &&
        m.isActive !== false
    );

    let waveSpeedImageRoute: WaveSpeedImageRouteConfig | null = null;
    let isWaveSpeedImageModel = false;
    let openAIImageModel: string | null = null;
    let googleImageModel: string | null = null;

    if (dynamicModel) {
      const targetApiRoute = hasReferenceImages && dynamicModel.image_api_route
        ? dynamicModel.image_api_route
        : (dynamicModel.text_api_route || dynamicModel.upstreamModelId || dynamicModel.id);

      const isGoogle = /^(google|gemini|imagen)/i.test(targetApiRoute) || /google/i.test(dynamicModel.group || "");
      const isOpenAI = /^(openai|dall-e)/i.test(targetApiRoute) || /openai/i.test(dynamicModel.group || "");

      if (isGoogle) {
        googleImageModel = targetApiRoute;
      } else if (isOpenAI) {
        openAIImageModel = targetApiRoute;
      } else {
        const canonicalRoute = resolveWaveSpeedImageModelRoute(targetApiRoute, hasReferenceImages, Number(numImages) || 1);
        if (canonicalRoute) {
          waveSpeedImageRoute = canonicalRoute;
        } else {
          const cleanModel = normalizeWaveSpeedModelEndpoint(targetApiRoute, hasReferenceImages);
          waveSpeedImageRoute = {
            model: cleanModel,
            referenceField: (hasReferenceImages || (dynamicModel.maxRefImages && dynamicModel.maxRefImages > 0)) ? "images" : undefined,
            requiresReference: Boolean(hasReferenceImages && dynamicModel.image_api_route),
            maxReferenceImages: dynamicModel.maxRefImages ?? (hasReferenceImages ? 4 : 0),
            maxOutputImages: dynamicModel.maxImages ?? 4,
            inputShape: cleanModel.includes("grok") ? "aspect-only" : "size",
          };
        }
        isWaveSpeedImageModel = true;
      }
    } else {
      waveSpeedImageRoute = resolveWaveSpeedImageModelRoute(effectiveModelId, hasReferenceImages, Number(numImages) || 1);
      isWaveSpeedImageModel = Boolean(waveSpeedImageRoute);
      openAIImageModel = getOpenAIImageModel(effectiveModelId);
      googleImageModel = getGoogleImageModel(effectiveModelId);
    }

    const legacyImageProvider = openAIImageModel ? "openai" : googleImageModel ? "google" : "wavespeed";
    const legacyImageRoute = openAIImageModel || googleImageModel || waveSpeedImageRoute?.model || effectiveModelId;
    const routingDecision = await resolveRuntimeProviderRoute({
      modelId: effectiveModelId,
      modality: "image",
      legacyRoute: { provider: legacyImageProvider, route: legacyImageRoute },
    });
    if (routingDecision.routingSource === "control_center") {
      const routedOpenAIModel = getOpenAIImageModel(routingDecision.providerRoute);
      const routedGoogleModel = getGoogleImageModel(routingDecision.providerRoute);
      const routedWaveSpeedRoute = resolveWaveSpeedImageModelRoute(routingDecision.providerRoute, hasReferenceImages, Number(numImages) || 1);
      if (routingDecision.effectiveProvider === "openai" && routedOpenAIModel) {
        openAIImageModel = routedOpenAIModel;
        googleImageModel = null;
        waveSpeedImageRoute = null;
        isWaveSpeedImageModel = false;
      } else if (routingDecision.effectiveProvider === "google" && routedGoogleModel) {
        googleImageModel = routedGoogleModel;
        openAIImageModel = null;
        waveSpeedImageRoute = null;
        isWaveSpeedImageModel = false;
      } else if (routingDecision.effectiveProvider === "wavespeed" && routedWaveSpeedRoute) {
        waveSpeedImageRoute = routedWaveSpeedRoute;
        isWaveSpeedImageModel = true;
        openAIImageModel = null;
        googleImageModel = null;
      }
    }

    if (!isWaveSpeedImageModel && !openAIImageModel && !googleImageModel) {
      return NextResponse.json(
        { error: `Unsupported image model for configured providers: ${effectiveModelId}` },
        { status: 400 },
      );
    }
    const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (googleImageModel && !googleApiKey) {
      return NextResponse.json(
        { error: "Google image API key is not configured. Set GOOGLE_API_KEY on the server." },
        { status: 500 },
      );
    }

    const chargeQuality = resolution ?? quality ?? imageSize;
    const unlimited = useAnnualUnlimited
      ? await getAnnualUnlimitedImageEligibility({
          userId,
          modelId: effectiveModelId,
          quality: chargeQuality,
          requestedUnits: numImages,
        })
      : { eligible: false, planId: null as string | null, reason: "disabled", dailyUsed: undefined };
    let creditsToCharge = unlimited.eligible
      ? 0
      : await getGenerationCost(effectiveModelId, 5, numImages, chargeQuality);
    if (!unlimited.eligible && isWaveSpeedImageModel && effectiveModelId.includes("gpt-image-2.5")) {
      creditsToCharge = getWaveSpeedGptImage25Credits(effectiveModelId, numImages, quality, resolution, rawRefUrls.length);
    }
    if (!unlimited.eligible && creditsToCharge <= 0 && dynamicModel?.creditCost) {
      creditsToCharge = Number(dynamicModel.creditCost) * (Number(numImages) || 1);
    }
    if (!unlimited.eligible && creditsToCharge <= 0) {
      return NextResponse.json({ error: `No credit configuration for model: ${modelId}` }, { status: 400 });
    }

    const chargeInput = {
      userId,
      profileId,
      prompt: sanitizePrompt(prompt, 5000),
      assetType: "IMAGE",
      modelUsed: modelId,
      resolution: chargeQuality,
      aspectRatio,
      requestPayload: {
        ...body,
        routing: routingMetadata(routingDecision),
      },
    };
    const refUrls: string[] = [];
    if (imageUrl) refUrls.push(imageUrl);
    if (imageUrlsParam?.length) refUrls.push(...imageUrlsParam);

    const maxReferenceImages = getImageReferenceLimit(modelId, effectiveModelId, dynamicModel);
    if (refUrls.length > 0 && maxReferenceImages <= 0) {
      return NextResponse.json(
        { error: "Selected model does not accept reference images." },
        { status: 400 },
      );
    }
    if (maxReferenceImages > 0 && refUrls.length > maxReferenceImages) {
      return NextResponse.json(
        {
          error: `Selected model accepts up to ${maxReferenceImages} reference image${maxReferenceImages === 1 ? "" : "s"}.`,
        },
        { status: 400 },
      );
    }

    const resolvedRefs: string[] = [];
    for (const ref of refUrls) {
      try {
        await checkStoryboardReferenceImageSafety(ref);
        const resolved = await resolveProviderMediaUrl(ref, { userId, assetType: "image" });
        await verifyPublicMediaUrl(resolved, "reference_image", { expectedMediaKind: "image" });
        resolvedRefs.push(resolved);
      } catch (err) {
        console.warn("[image generation] Reference image failed verification/resolution before dispatch:", err);
        return NextResponse.json(
          {
            error: "One of the attached reference images could not be loaded from storage.",
            publicError:
              "تعذّر تحميل إحدى الصور المرجعية المرفقة — أعد رفع الصورة ثم حاول مرة أخرى.",
            code: "references_unreachable",
            unreachableCount: 1,
          },
          { status: 400 },
        );
      }
    }

    if (waveSpeedImageRoute?.requiresReference && resolvedRefs.length === 0) {
      return NextResponse.json(
        { error: "Selected WaveSpeed image edit model requires at least one valid reference image." },
        { status: 400 },
      );
    }

    const spent = unlimited.eligible
      ? await recordFreeGeneration(chargeInput)
      : await spendCredits({ ...chargeInput, credits: creditsToCharge });
    chargedCredits = creditsToCharge;
    generationId = spent.generationId;
    await applyAnnualUnlimitedImageSlowdown({
      eligible: unlimited.eligible,
      dailyUsed: unlimited.dailyUsed,
      requestedUnits: numImages,
    });

    if (openAIImageModel) {
      const openAIApiKey = process.env.OPENAI_API_KEY;
      if (!openAIApiKey) {
        return NextResponse.json(
          { error: "OpenAI API key is not configured. Set OPENAI_API_KEY on the server." },
          { status: 500 },
        );
      }

      const images = await generateOpenAIImage({
        apiKey: openAIApiKey,
        openAIModel: openAIImageModel,
        prompt,
        referenceUrls: resolvedRefs,
        aspectRatio,
        quality: chargeQuality,
      });

      const imageUrls = await Promise.all(
        images.map(async (image, index) => {
          const stored = generationId
            ? await uploadBufferToStorage({
                buffer: image.buffer,
                contentType: image.mimeType,
                userId,
                assetType: "IMAGE",
                generationId: index === 0 ? generationId : `${generationId}-${index}`,
              }).catch((err) => {
                console.error("[generate/image] Failed to upload OpenAI image", err);
                return null;
              })
            : null;
          return stored ?? `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
        }),
      );

      if (generationId && imageUrls[0]) {
        await setGenerationMediaUrl(generationId, imageUrls[0]).catch((err) => {
          console.error("[generate/image] Failed to save OpenAI media URL", err);
        });
        await setActualProviderUsage(generationId, {
          providerName: "OpenAI",
          providerModel: openAIImageModel,
          status: "completed",
        });
      }

      if (imageUrls.length > 1 && chargedUserId) {
        await saveAdditionalGenerationUrls(
          chargedUserId,
          sanitizePrompt(prompt, 5000),
          modelId,
          "IMAGE",
          imageUrls.slice(1),
          profileId,
        ).catch((err) => {
          console.error("[generate/image] Failed to save additional OpenAI URLs", err);
        });
      }

      const normalizedImageUrls = imageUrls.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url);
      const watermarkedImageUrls = await applyImageWatermarkMany(normalizedImageUrls, { userId: chargedUserId || undefined, generationIdPrefix: generationId });
      return NextResponse.json({
        generationId,
        imageUrls: watermarkedImageUrls,
        resultUrls: watermarkedImageUrls,
        imageUrl: watermarkedImageUrls[0] ?? null,
        mediaUrl: watermarkedImageUrls[0] ?? null,
        provider: "openai",
        model: openAIImageModel,
      }, { status: 200 });
    }

    if (googleImageModel && googleApiKey) {
      const fanout = Math.max(1, Math.min(4, numImages));
      const googleResults = await Promise.all(
        Array.from({ length: fanout }, () =>
          generateGoogleImage({
            apiKey: googleApiKey,
            googleModel: googleImageModel,
            prompt,
            referenceUrls: resolvedRefs,
            aspectRatio,
            quality: chargeQuality,
          }),
        ),
      );
      const images = googleResults.flat().slice(0, fanout);

      const imageUrls = await Promise.all(
        images.map(async (image, index) => {
          const stored = generationId
            ? await uploadBufferToStorage({
                buffer: image.buffer,
                contentType: image.mimeType,
                userId,
                assetType: "IMAGE",
                generationId: index === 0 ? generationId : `${generationId}-${index}`,
              }).catch((err) => {
                console.error("[generate/image] Failed to upload Google image", err);
                return null;
              })
            : null;
          return stored ?? `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
        }),
      );

      if (generationId && imageUrls[0]) {
        await setGenerationMediaUrl(generationId, imageUrls[0]).catch((err) => {
          console.error("[generate/image] Failed to save Google media URL", err);
        });
        await setActualProviderUsage(generationId, {
          providerName: "Google",
          providerModel: googleImageModel,
          status: "completed",
        });
      }

      if (imageUrls.length > 1 && chargedUserId) {
        await saveAdditionalGenerationUrls(
          chargedUserId,
          sanitizePrompt(prompt, 5000),
          modelId,
          "IMAGE",
          imageUrls.slice(1),
          profileId,
        ).catch((err) => {
          console.error("[generate/image] Failed to save additional Google URLs", err);
        });
      }

      const normalizedImageUrls = imageUrls.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url);
      const watermarkedImageUrls = await applyImageWatermarkMany(normalizedImageUrls, { userId: chargedUserId || undefined, generationIdPrefix: generationId });
      return NextResponse.json({
        generationId,
        imageUrls: watermarkedImageUrls,
        resultUrls: watermarkedImageUrls,
        imageUrl: watermarkedImageUrls[0] ?? null,
        mediaUrl: watermarkedImageUrls[0] ?? null,
        provider: "google",
        model: googleImageModel,
      }, { status: 200 });
    }

    if (isWaveSpeedImageModel && waveSpeedImageRoute) {
      const waveSpeedApiKey = process.env.WAVESPEED_API_KEY;
      if (!waveSpeedApiKey) {
        throw new Error("WAVESPEED_API_KEY is not configured on the server.");
      }

      const waveSpeedInput = buildWaveSpeedImageInput(waveSpeedImageRoute, {
        prompt: sanitizePrompt(prompt, 5000),
        aspectRatio,
        quality,
        resolution,
        imageSize,
        numImages,
        referenceUrls: resolvedRefs,
        negativePrompt,
        outputFormat: outputFormat === "jpeg" || outputFormat === "webp" || outputFormat === "png" ? outputFormat : undefined,
      });

      const taskCount = waveSpeedImageRoute.outputCountField
        ? 1
        : Math.max(1, Math.min(waveSpeedImageRoute.maxOutputImages, Math.ceil(Number(numImages) || 1)));
      const taskIds = await Promise.all(
        Array.from({ length: taskCount }, async () => {
          const submitRes = await fetch(
            `${WAVESPEED_BASE_URL}/${waveSpeedImageRoute.model}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${waveSpeedApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(waveSpeedInput),
            },
          );

          const submitJson = await submitRes.json().catch(() => null) as Record<string, unknown> | null;
          const taskId = ((submitJson?.data as Record<string, unknown> | undefined)?.id ?? submitJson?.id) as string | undefined;
          if (!submitRes.ok || !taskId) {
            const detailMsg = (submitJson?.message || submitJson?.msg || submitJson?.error || submitJson?.detail) as string | undefined;
            console.error(`[generate/image] WaveSpeed submit error (${submitRes.status}):`, submitJson);
            throw new Error(`WaveSpeed submit failed for ${waveSpeedImageRoute.model} (${submitRes.status}): ${detailMsg || "Invalid payload"}`);
          }
          return taskId;
        }),
      );

      const imageUrls = (await Promise.all(
        taskIds.map((taskId) => pollWaveSpeedImageTask(taskId, waveSpeedApiKey)),
      )).flat();
      const taskId = taskIds[0];

      if (generationId && imageUrls[0]) {
        await setGenerationMediaUrl(generationId, imageUrls[0]).catch((err) => {
          console.error("[generate-image] Failed to save WaveSpeed media URL", err);
        });
        await setActualProviderUsage(generationId, {
          providerName: "WaveSpeed",
          providerModel: waveSpeedImageRoute.model,
          providerRequestId: taskId,
          status: "completed",
        });
      }
      if (imageUrls.length > 1 && chargedUserId) {
        await saveAdditionalGenerationUrls(
          chargedUserId,
          sanitizePrompt(prompt, 5000),
          modelId,
          "IMAGE",
          imageUrls.slice(1),
          profileId,
        ).catch((err) => {
          console.error("[generate-image] Failed to save additional WaveSpeed URLs", err);
        });
      }

      const normalizedImageUrls = imageUrls.map(url => normalizeMediaUrl(url, { config: storageConfig }) || url);
      const watermarkedImageUrls = await applyImageWatermarkMany(normalizedImageUrls, { userId: chargedUserId || undefined, generationIdPrefix: generationId });
      return NextResponse.json({
        generationId,
        taskId,
        imageUrls: watermarkedImageUrls,
        resultUrls: watermarkedImageUrls,
        imageUrl: watermarkedImageUrls[0] ?? null,
        mediaUrl: watermarkedImageUrls[0] ?? null,
        provider: "wavespeed",
        model: waveSpeedImageRoute.model,
        credits: creditsToCharge,
      });
    }

    return NextResponse.json(
      { error: `Unsupported image model for configured providers: ${effectiveModelId}` },
      { status: 400 },
    );
  } catch (error: unknown) {
    if (error instanceof InsufficientCreditsError) {
      const responseJson: Record<string, unknown> = {
        error: "Insufficient credits",
        requiredCredits: error.requiredCredits,
        currentBalance: error.currentBalance,
      };
      return NextResponse.json(
        responseJson,
        { status: 402 },
      );
    }

    if (error instanceof ValidationError || error instanceof UnsafeReferenceImageError) {
      if (chargedCredits > 0 && chargedUserId && generationId) {
        await rollbackGenerationCharge(generationId, chargedUserId, chargedCredits).catch(() => {});
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (chargedCredits > 0 && chargedUserId && generationId) {
      await rollbackGenerationCharge(generationId, chargedUserId, chargedCredits).catch(() => {});
    }

    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
