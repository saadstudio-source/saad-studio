// ============================================================
// FILE: lib/gemini-veo.ts
// DESCRIPTION: Thin wrapper around @google/genai for the
//   /cinematic-video page. Exposes Veo 3.1 (all variants) plus
//   the advanced modes: text-to-video, image-to-video, last
//   frame control, reference images and video extension.
// AUTH: Uses the official Google AI API key from env.
// ============================================================

import { GenerateVideosOperation, GoogleGenAI } from "@google/genai";

export function getGoogleApiKey(): string {
  return (
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    ""
  );
}

let _client: GoogleGenAI | null = null;
let _cachedKey: string | null = null;

export function getGenAI(): GoogleGenAI {
  const key = getGoogleApiKey();
  if (!key) {
    throw new Error(
      "Google AI API key is not configured. Set GOOGLE_AI_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY, or GOOGLE_GENAI_API_KEY.",
    );
  }
  if (!_client || _cachedKey !== key) {
    _client = new GoogleGenAI({ apiKey: key });
    _cachedKey = key;
  }
  return _client;
}

export const VEO_MODELS = {
  lite: "veo-3.1-lite-generate-preview",
  fast: "veo-3.1-fast-generate-preview",
  pro:  "veo-3.1-generate-preview",
  legacy_fast: "veo-3.0-fast-generate-001",
  legacy: "veo-3.0-generate-001",
  omni_flash: "gemini-omni-1.1-flash",
} as const;

export type VeoTier = keyof typeof VEO_MODELS;

export const PRICING_ID: Record<VeoTier, string> = {
  lite: "veo31_gem_lite",
  fast: "veo31_gem_fast",
  pro:  "veo31_gem",
  legacy_fast: "veo3_fast",
  legacy: "veo3",
  omni_flash: "gemini_omni_flash",
};

export type VeoAspect = "16:9" | "9:16";
/** Per Google docs: 360p / 720p / 1080p / 4k. Lite supports up to 1080p only.
 *  Video extension is 720p only. */
export type VeoResolution = "360p" | "720p" | "1080p" | "4k";

export interface VeoImageInput {
  /** base64 of the image file (no data: prefix) */
  imageBytes: string;
  mimeType: string;
}

export interface VeoVideoInput {
  /** base64 of the mp4 (no data: prefix) */
  videoBytes: string;
  mimeType: string;
}

export interface StartVeoParams {
  tier: VeoTier;
  prompt: string;
  aspectRatio?: VeoAspect;
  resolution?: VeoResolution;
  /** seconds, 4-8 */
  durationSeconds?: number;
  negativePrompt?: string;

  // ── Advanced modes ──────────────────────────────────────
  /** Image-to-Video: starting frame */
  image?: VeoImageInput;
  /** Frame interpolation: ending frame (requires `image` as start) */
  lastFrame?: VeoImageInput;
  /** Reference images (up to 3) for style/character carry-over */
  referenceImages?: VeoImageInput[];
  /** Reference videos (up to 3 clips, 3 seconds each per Google docs) */
  referenceVideos?: VeoVideoInput[];
  /** Extend an existing clip (max 20×) */
  video?: VeoVideoInput;
  /** Explicit task for video input when the caller distinguishes edit vs extension. */
  videoTask?: "edit" | "extend";
  /** Stateful video editing: parent interaction ID to edit */
  previousInteractionId?: string;
  /** Explicit Google Interactions model for versioned Omni routes. */
  interactionModel?: string;
}

export interface VeoOperationHandle {
  /** Opaque name used to poll: e.g. `models/veo-3.1-…/operations/abc` */
  name: string;
  /** Model that was used (for the polling endpoint to know which to call) */
  model: string;
}

export interface VeoCompleted {
  done: true;
  /** Public URI for the generated mp4 (requires API key on download) */
  videoUri: string | null;
  /** When set, fetch with `?key=…` to download bytes */
  rawResponse: unknown;
}

export interface VeoStillRunning {
  done: false;
}

export type VeoPollResult = VeoCompleted | VeoStillRunning;

// ─── Start a generation ──────────────────────────────────────────────────────

export async function startVeoGeneration(
  params: StartVeoParams,
): Promise<VeoOperationHandle> {
  const ai = getGenAI();
    const model = params.interactionModel || VEO_MODELS[params.tier];

  if (params.tier === "omni_flash") {
    const key = getGoogleApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${key}`;
    
    const inputList: any[] = [];

    // 0. Add starting video if present (via Google Files API)
    if (params.video && !params.previousInteractionId) {
      const videoUri = await uploadVideoToGoogleFiles(
        Buffer.from(params.video.videoBytes, "base64"),
        params.video.mimeType
      );
      inputList.push({
        type: "document",
        uri: videoUri,
      });
    }

    // 1. Add starting frame (image) if present.
    if (params.image) {
      inputList.push({
        type: "image",
        data: params.image.imageBytes,
        mime_type: params.image.mimeType,
      });
    }

    // 2. Add reference images if present
    if (params.referenceImages && params.referenceImages.length > 0) {
      for (const refImg of params.referenceImages) {
        inputList.push({
          type: "image",
          data: refImg.imageBytes,
          mime_type: refImg.mimeType,
        });
      }
    }

    if (params.referenceVideos && params.referenceVideos.length > 0) {
      for (const refVid of params.referenceVideos.slice(0, 3)) {
        const videoUri = await uploadVideoToGoogleFiles(
          Buffer.from(refVid.videoBytes, "base64"),
          refVid.mimeType
        );
        inputList.push({
          type: "document",
          uri: videoUri,
        });
      }
    }

    // 3. Formulate the prompt text with official Google Gemini Omni Flash tags
    let promptText = params.prompt.trim();
    if (params.negativePrompt && params.negativePrompt.trim()) {
      promptText += `. Do not include: ${params.negativePrompt.trim()}`;
    }

    const hasStartFrame = Boolean(params.image);
    const refCount = params.referenceImages?.length || 0;
    const hasSourceVideo = Boolean(params.video && !params.previousInteractionId);
    const refVideoCount = Math.min(params.referenceVideos?.length || 0, 3);

    const sourceTags: string[] = [];
    const referenceTags: string[] = [];
    const guidingInstructions: string[] = [];

    if (hasSourceVideo) {
      sourceTags.push("<VIDEO_0>@Video1");
      guidingInstructions.push("Use Video1 as the primary source video to edit or modify.");
      promptText = promptText.replace(/@Video1\b/g, "<VIDEO_0>");
    }

    if (hasStartFrame && refCount > 0) {
      const refTags = Array.from({ length: refCount }, (_, i) => `<IMAGE_REF_${i}>@Image${i + 2}`).join(" ");
      sourceTags.push("<FIRST_FRAME>@Image1");
      referenceTags.push(refTags);
      guidingInstructions.push("Use Image1 as the starting frame.");
      guidingInstructions.push("Use the given reference image(s) as references for character identity, style, and video generation. Do not use the reference images as literal initial frames.");
      promptText = promptText
        .replace(/@Image1\b/g, "<FIRST_FRAME>")
        .replace(/@Image(\d+)\b/g, (m, d) => {
          const idx = parseInt(d, 10) - 2;
          return idx >= 0 && idx < refCount ? `<IMAGE_REF_${idx}>` : m;
        });
    } else if (hasStartFrame) {
      sourceTags.push("<FIRST_FRAME>@Image1");
      guidingInstructions.push("Use Image1 as the starting frame.");
      promptText = promptText.replace(/@Image1\b/g, "<FIRST_FRAME>");
    } else if (refCount > 0) {
      const refTags = Array.from({ length: refCount }, (_, i) => `<IMAGE_REF_${i}>@Image${i + 1}`).join(" ");
      referenceTags.push(refTags);
      guidingInstructions.push("Use the given image(s) as references for video generation. The images should not be used as literal initial frames.");
      promptText = promptText.replace(/@Image(\d+)\b/g, (m, d) => {
        const idx = parseInt(d, 10) - 1;
        return idx >= 0 && idx < refCount ? `<IMAGE_REF_${idx}>` : m;
      });
    }

    if (refVideoCount > 0) {
      const videoOffset = hasSourceVideo ? 2 : 1;
      const refVideoTags = Array.from({ length: refVideoCount }, (_, i) => `<VIDEO_REF_${i}>@Video${i + videoOffset}`).join(" ");
      referenceTags.push(refVideoTags);
      guidingInstructions.push("Use the given video(s) as references. Do not use them as a source for video editing.");
      promptText = promptText.replace(/@Video(\d+)\b/g, (m, d) => {
        const num = parseInt(d, 10);
        if (hasSourceVideo && num === 1) return "<VIDEO_0>";
        const idx = num - videoOffset;
        return idx >= 0 && idx < refVideoCount ? `<VIDEO_REF_${idx}>` : m;
      });
    }

    const prefixTags = [
      sourceTags.length ? `[# Sources ${sourceTags.join(" ")}]` : "",
      referenceTags.length ? `[# References ${referenceTags.join(" ")}]` : "",
    ].filter(Boolean).join(" ");
    const guidingSuffix = guidingInstructions.length ? `\n${guidingInstructions.join(" ")}` : "";
    const finalPrompt = prefixTags ? `${prefixTags} ${promptText}${guidingSuffix}` : `${promptText}${guidingSuffix}`;

    inputList.push({
      type: "text",
      text: finalPrompt,
    });

    // 4. Determine task type
    let task = params.previousInteractionId ? "edit" : "text_to_video";
    if (!params.previousInteractionId) {
      if (params.video) {
        task = params.videoTask === "extend" ? "extend" : "edit";
      } else if (params.image) {
        task = "image_to_video";
      } else if ((params.referenceImages && params.referenceImages.length > 0) || refVideoCount > 0) {
        task = "reference_to_video";
      }
    }

    const payload: any = {
      model,
      input: inputList,
      background: true,
      response_format: {
        type: "video",
        aspect_ratio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.durationSeconds ? `${params.durationSeconds}s` : undefined,
      },
      generation_config: {
        video_config: {
          task,
        }
      }
    };

    if (params.previousInteractionId) {
      payload.previous_interaction_id = params.previousInteractionId;
    }

    if (params.aspectRatio) {
      payload.response_format.aspect_ratio = params.aspectRatio;
    }
    if (params.resolution) {
      payload.response_format.resolution = params.resolution;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Interactions API error: ${response.status} ${errText}`);
    }
    
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Google Interactions API error");
    }
    
    if (!data.id) {
      throw new Error("Google Interactions API returned no interaction ID.");
    }
    
    return { name: data.id as string, model };
  }

  // Build the config block (only set what the user picked)
  const config: Record<string, unknown> = {};
  if (params.aspectRatio) config.aspectRatio = params.aspectRatio;
  if (params.resolution) config.resolution = params.resolution;
  if (params.durationSeconds) config.durationSeconds = params.durationSeconds;
  if (params.negativePrompt) config.negativePrompt = params.negativePrompt;

  // Build the top-level request
  const request: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    config,
  };

  if (params.image) request.image = params.image;
  if (params.lastFrame) request.lastFrame = params.lastFrame;
  if (params.referenceImages?.length) {
    request.referenceImages = params.referenceImages.slice(0, 3);
  }
  if (params.video) request.video = params.video;

  // The SDK is intentionally typed loosely on this method because the Veo
  // surface is still in preview and adds fields frequently.
  const operation: any = await (ai.models as any).generateVideos(request);

  if (!operation?.name) {
    throw new Error("Gemini API returned no operation name.");
  }
  return { name: operation.name as string, model };
}

// ─── Poll an operation ───────────────────────────────────────────────────────

export async function pollVeoOperation(
  handle: VeoOperationHandle,
): Promise<VeoPollResult> {
  if (handle.model === "gemini-omni-1.1-flash" || handle.model === "gemini-omni-1.2-flash" || handle.model === "gemini-omni-flash-preview") {
    const interactionId = handle.name.startsWith("interactions/")
      ? handle.name.replace("interactions/", "")
      : handle.name;
    const key = getGoogleApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}?key=${key}`;
    const res = await fetch(url, {
      headers: {
        "x-goog-api-key": key,
      },
    });
    if (!res.ok) {
      throw new Error(`Interactions polling failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || "Interactions failed");
    }
    
    // Status can be: 'in_progress', 'completed', 'failed', 'cancelled'
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(`Interactions generation ended with status: ${data.status}`);
    }
    if (data.status !== "completed") {
      return { done: false };
    }
    
    // Extract video
    let videoUri: string | null = null;
    
    // A. Check top-level output_video or outputVideo (direct REST payload format)
    if (data.output_video?.data) {
      videoUri = `inline:${data.output_video.data}`;
    } else if (data.outputVideo?.data) {
      videoUri = `inline:${data.outputVideo.data}`;
    } else if (data.output_video?.uri) {
      videoUri = data.output_video.uri;
    } else if (data.outputVideo?.uri) {
      videoUri = data.outputVideo.uri;
    }
    
    // B. Check steps array (timeline steps format)
    if (!videoUri) {
      const steps = data.steps || [];
      for (const step of steps) {
        // Search content parts inside model_output/output steps
        const parts = step.parts || step.model_output?.parts || step.modelOutput?.parts || step.content || [];
        for (const part of parts) {
          // B1. Standard parts with type === "video" and inline base64 data
          if (part.type === "video" && part.data) {
            videoUri = `inline:${part.data}`;
            break;
          }
          if (part.type === "video" && part.uri) {
            videoUri = part.uri;
            break;
          }
          // B2. Standard media inlineData/fileData wrappers
          if (part.inlineData?.data) {
            videoUri = `inline:${part.inlineData.data}`;
            break;
          }
          if (part.fileData?.fileUri) {
            videoUri = part.fileData.fileUri;
            break;
          }
          if (part.inline_data?.data) {
            videoUri = `inline:${part.inline_data.data}`;
            break;
          }
          if (part.file_data?.file_uri) {
            videoUri = part.file_data.file_uri;
            break;
          }
        }
        if (videoUri) break;
      }
    }

    // C. Check legacy outputs array (if present)
    if (!videoUri) {
      const outputs = Array.isArray(data.outputs) ? data.outputs : [];
      for (const out of outputs) {
        if (out.video?.uri) {
          videoUri = out.video.uri;
          break;
        }
        if (out.video?.url) {
          videoUri = out.video.url;
          break;
        }
        if (out.video?.data) {
          videoUri = `inline:${out.video.data}`;
          break;
        }
      }
    }

    // D. Check candidates array (standard Gemini content generation format)
    if (!videoUri) {
      const candidates = data.candidates || data.response?.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            videoUri = `inline:${part.inlineData.data}`;
            break;
          }
          if (part.inline_data?.data) {
            videoUri = `inline:${part.inline_data.data}`;
            break;
          }
          if (part.fileData?.fileUri) {
            videoUri = part.fileData.fileUri;
            break;
          }
          if (part.file_data?.file_uri) {
            videoUri = part.file_data.file_uri;
            break;
          }
        }
        if (videoUri) break;
      }
    }
    
    return { done: true, videoUri, rawResponse: data };
  }

  const ai = getGenAI();
  const operationsApi = ai.operations as any;
  let operation: any;
  const operationInput = new GenerateVideosOperation();
  operationInput.name = handle.name;

  if (typeof operationsApi.getVideosOperation === "function") {
    try {
      operation = await operationsApi.getVideosOperation({
        operation: operationInput,
      });
    } catch (err) {
      const fallbackOperation = new GenerateVideosOperation();
      fallbackOperation.name = handle.name;
      operation = await operationsApi.getVideosOperation({
        operation: fallbackOperation,
      }).catch(() => {
        throw err;
      });
    }
  } else if (typeof operationsApi.get === "function") {
    operation = await operationsApi.get({ operation: operationInput });
  } else {
    throw new Error("Gemini SDK does not expose a video operation poller.");
  }

  if (!operation?.done) return { done: false };

  const opError = operation.error ?? operation.response?.error;
  if (opError) {
    const message =
      opError.message ??
      opError.errorMessage ??
      opError.status ??
      "Veo operation failed.";
    throw new Error(String(message));
  }

  const generated =
    operation.response?.generatedVideos ??
    operation.response?.generated_videos ??
    operation.generatedVideos ??
    operation.generated_videos ??
    [];
  const first = Array.isArray(generated) ? generated[0] : null;
  const videoUri: string | null =
    first?.video?.uri ??
    first?.video?.url ??
    first?.video?.videoUri ??
    first?.video?.gcsUri ??
    first?.uri ??
    first?.url ??
    null;

  return { done: true, videoUri, rawResponse: operation.response ?? null };
}

// ─── Download a Veo mp4 ──────────────────────────────────────────────────────

export async function downloadVeoVideo(
  videoUri: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (videoUri.startsWith("inline:")) {
    const base64 = videoUri.replace("inline:", "");
    return {
      buffer: Buffer.from(base64, "base64"),
      contentType: "video/mp4",
    };
  }

  const key = getGoogleApiKey();
  if (!key) {
    throw new Error("GOOGLE_AI_API_KEY missing — cannot download Veo output.");
  }
  // The URI returned by the SDK requires the API key appended.
  const url = videoUri.includes("?")
    ? `${videoUri}&key=${key}`
    : `${videoUri}?key=${key}`;

  const res = await fetch(url, { 
    headers: {
      "x-goog-api-key": key,
    },
    signal: AbortSignal.timeout(120_000) 
  });
  if (!res.ok) {
    throw new Error(`Veo download failed: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "video/mp4";
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

// ─── Helpers — convert a public URL to an inline image input ─────────────────

export async function urlToImageInput(url: string): Promise<VeoImageInput> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Cannot fetch image: ${url}`);
  const ab = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return {
    imageBytes: Buffer.from(ab).toString("base64"),
    mimeType,
  };
}

export async function urlToVideoInput(url: string): Promise<VeoVideoInput> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Cannot fetch video: ${url}`);
  const ab = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "video/mp4";
  return {
    videoBytes: Buffer.from(ab).toString("base64"),
    mimeType,
  };
}

// ─── Imagen 4 — direct Google API (same key as Veo) ──────────────────────────

export const IMAGEN_MODELS = {
  fast:  "imagen-4.0-fast-generate-001",
  std:   "imagen-4.0-generate-001",
  ultra: "imagen-4.0-ultra-generate-001",
} as const;

export type ImagenTier = keyof typeof IMAGEN_MODELS;

export interface GenerateImageParams {
  tier?: ImagenTier;
  prompt: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  numberOfImages?: number;
}

export interface GeneratedImage {
  /** Raw bytes ready to upload to storage */
  buffer: Buffer;
  mimeType: string;
}

export async function generateImagenImage(
  params: GenerateImageParams,
): Promise<GeneratedImage[]> {
  const ai = getGenAI();
  const model = IMAGEN_MODELS[params.tier ?? "fast"];

  const response: any = await (ai.models as any).generateImages({
    model,
    prompt: params.prompt,
    config: {
      aspectRatio: params.aspectRatio ?? "16:9",
      numberOfImages: Math.max(1, Math.min(4, params.numberOfImages ?? 1)),
    },
  });

  const generatedImages =
    response?.generatedImages ?? response?.generated_images ?? [];

  if (!Array.isArray(generatedImages) || generatedImages.length === 0) {
    throw new Error("Imagen returned no images.");
  }

  return generatedImages.map((g: any) => {
    const imgPart = g?.image ?? g;
    const base64 =
      imgPart?.imageBytes ?? imgPart?.image_bytes ?? imgPart?.bytesBase64Encoded ?? "";
    const mimeType = imgPart?.mimeType ?? imgPart?.mime_type ?? "image/png";
    if (!base64) throw new Error("Imagen response missing image bytes.");
    return { buffer: Buffer.from(base64, "base64"), mimeType };
  });
}

export async function uploadVideoToGoogleFiles(videoBuffer: Buffer, mimeType = "video/mp4"): Promise<string> {
  const ai = getGenAI();
  const fileBlob = new Blob([new Uint8Array(videoBuffer)], { type: mimeType });

  let file: any = await ai.files.upload({
    file: fileBlob,
    config: {
      mimeType,
    },
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = String(file?.state?.name ?? file?.state ?? "").toUpperCase();
    if (!state || state === "ACTIVE") break;
    if (state === "FAILED") {
      throw new Error("Google Files API failed to process the uploaded video.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const name = file?.name;
    if (!name) break;
    file = await (ai.files as any).get({ name });
  }

  if (!file.uri) {
    throw new Error("Failed to upload video to Google Files API (no URI returned)");
  }

  return file.uri;
}
