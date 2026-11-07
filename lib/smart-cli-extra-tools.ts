// Smart CLI MCP — account, status, audio, post-production and upload tools.
//
// Every tool here is a thin, validated wrapper over an EXISTING panel endpoint
// (/api/panel/*) called with the caller's own Bearer token, so the server keeps
// enforcing authentication, bans, rate limits, content policy and credit
// charging. No tool talks to a provider directly.
//
// Annotations follow the MCP ToolAnnotations spec; Claude uses them to group
// tools in Settings → Connectors:
//   readOnlyHint true            → "Read-only tools"  (no approval needed)
//   readOnlyHint false           → "Write/delete tools"
//   destructiveHint true         → deletes data (always worth a confirmation)
// Anything that spends credits is write-class on purpose.

import { getFallbackUrls } from "@/lib/utils";
import { buildPreviewUrl, type PreviewInput } from "@/lib/smart-cli-preview";

export const DEFAULT_IMAGE_MODEL = "nano-banana-pro";
export const DEFAULT_VIDEO_MODEL = "kling-3.0/video";

export type PanelFetcher = (
  path: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; data: unknown }>;

export type ExtraToolResult = {
  content: { type: "text"; text: string }[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const READ_ONLY_EXTERNAL = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE_SPENDS_CREDITS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
const WRITE_NO_SPEND = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const TTS_VOICES = ["rachel", "brian", "aria", "daniel", "matilda", "arabella"] as const;
export const MUSIC_MODELS = ["google/lyria-3-clip/music", "google/lyria-3-pro/music"] as const;
export const POST_PRODUCTION_TOOLS = ["captions", "reframe", "dubbing", "transcription", "edit-videos"] as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_FILE_NAME = 200;

export const EXTRA_TOOLS = [
  // ── Account & pricing (read-only) ───────────────────────────────────────
  {
    name: "check_balance",
    title: "Check balance",
    annotations: { title: "Check balance", ...READ_ONLY },
    description: "Return the user's current Saad Studio credit balance. Use before an expensive generation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_account",
    title: "Get account",
    annotations: { title: "Get account", ...READ_ONLY },
    description: "Return the signed-in account's name, credit balance and subscription status (plan, billing interval, renewal date).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "quote_generation",
    title: "Quote generation",
    annotations: { title: "Quote generation", ...READ_ONLY },
    description:
      "Price an image or video generation in credits WITHOUT generating or charging anything. Returns the exact credits, the current balance and the balance after. Call this before generate_image / generate_video when the user asks about cost.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["image", "video"], description: "What will be generated." },
        modelId: { type: "string", description: "Model id from list_models. Omit for the default." },
        duration: { type: "number", description: "Video length in seconds. Default 5. Ignored for images." },
        resolution: { type: "string", description: "Image: 1K or 2K. Video: e.g. 720p, 1080p. Defaults: 1K image, 1080p video." },
        aspectRatio: { type: "string", description: "e.g. 16:9, 9:16, 1:1." },
        numImages: { type: "number", description: "Images only. Default 1." },
        enableAudio: { type: "boolean", description: "Video only: include generated audio." },
        imageUrl: { type: "string", description: "Optional reference / first-frame image URL (can change the price)." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "get_job_status",
    title: "Get job status",
    annotations: { title: "Get job status", ...READ_ONLY },
    description:
      "Check a generation by id (the generationId returned by generate_* tools). Returns status (running / succeeded / failed), progress and, when finished, the result URL.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "generationId / job id." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  // ── Audio (spends credits) ──────────────────────────────────────────────
  {
    name: "generate_music",
    title: "Generate music",
    annotations: { title: "Generate music", ...WRITE_SPENDS_CREDITS },
    description:
      "Generate a music track (Google Lyria 3). The clip model always returns 30 s; the pro model supports 30–300 s. Spends credits. Returns an audio URL (and lyrics when the model writes any).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What the music should sound like." },
        model: { type: "string", enum: [...MUSIC_MODELS], default: MUSIC_MODELS[0] },
        duration: { type: "number", description: "Seconds. Pro model only (30–300, default 120)." },
        genre: { type: "string" },
        mood: { type: "string" },
        bpm: { type: "number", description: "Tempo in beats per minute." },
        style: { type: "string", description: "Extra style / instrument notes." },
        lyrics: { type: "string", description: "Optional lyrics (ignored when force_instrumental is true)." },
        force_instrumental: { type: "boolean", description: "No vocals at all." },
        output_format: { type: "string", enum: ["mp3", "wav"], description: "wav is available on the pro model only." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "text_to_speech",
    title: "Text to speech",
    annotations: { title: "Text to speech", ...WRITE_SPENDS_CREDITS },
    description:
      "Turn text into speech with a multilingual voice. Spends credits based on the character count (max 4000 characters). Returns an audio URL.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The script to speak (max 4000 characters)." },
        voiceId: { type: "string", enum: [...TTS_VOICES], default: "rachel" },
        speed: { type: "number", description: "0.5–2.0. Default 1.0." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  // ── Post-production on an existing video (spends credits) ───────────────
  {
    name: "post_produce_video",
    title: "Post-produce video",
    annotations: { title: "Post-produce video", ...WRITE_SPENDS_CREDITS },
    description:
      "Start a post-production job on an existing video URL: captions, reframe (vertical/square), dubbing (translate the voice), transcription or edit-videos (auto-cut short clips). Spends credits, billed by duration, so pass durationSec. The job runs in the background: poll get_post_production_status. For dubbing you MUST pass options.translationLanguage (see list_dubbing_languages).",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", enum: [...POST_PRODUCTION_TOOLS] },
        sourceUrl: { type: "string", description: "Public http(s) URL of the video. Use create_upload_url for local files." },
        durationSec: { type: "number", description: "Video length in seconds (used for pricing). Strongly recommended." },
        filename: { type: "string", description: "Optional file name." },
        options: {
          type: "object",
          description:
            "Optional per-tool settings. captions: captionsPreset (see list_caption_presets), language, enableEmojis, enableHighlights, resolution. reframe: orientation (portrait|square|landscape), genre (talking|screenshare|gaming). dubbing: translationLanguage (required), sourceLanguage. transcription: language. edit-videos: prompt, clipDurations, topics.",
          additionalProperties: true,
        },
      },
      required: ["tool", "sourceUrl"],
      additionalProperties: false,
    },
  },
  {
    name: "get_post_production_status",
    title: "Get post-production status",
    annotations: { title: "Get post-production status", ...READ_ONLY_EXTERNAL },
    description:
      "Poll a post_produce_video job. Returns status (queued / processing / completed / failed), progress and, when completed, the final video URL(s) stored on Saad Studio.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "projectId returned by post_produce_video." },
        generationId: { type: "string", description: "generationId returned by post_produce_video (required; ties the job to your account)." },
      },
      required: ["projectId", "generationId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_dubbing_languages",
    title: "List dubbing languages",
    annotations: { title: "List dubbing languages", ...READ_ONLY_EXTERNAL },
    description: "List the languages a video can be dubbed into. Use the returned code as options.translationLanguage.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_translation_languages",
    title: "List translation languages",
    annotations: { title: "List translation languages", ...READ_ONLY_EXTERNAL },
    description: "List the languages supported for caption / transcript translation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_caption_presets",
    title: "List caption presets",
    annotations: { title: "List caption presets", ...READ_ONLY_EXTERNAL },
    description: "List the caption styles available for post_produce_video with tool=captions (use as options.captionsPreset).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  // ── Uploads & cleanup ───────────────────────────────────────────────────
  {
    name: "create_upload_url",
    title: "Create upload URL",
    annotations: { title: "Create upload URL", ...WRITE_NO_SPEND },
    description:
      "Create a one-time signed URL to upload a local image / video / audio file to Saad Studio storage. The agent must PUT the raw bytes to signedUrl with the same Content-Type header; then use publicUrl as imageUrl (generate_*) or sourceUrl (post_produce_video). Files are never sent through this MCP.",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "e.g. clip.mp4" },
        contentType: { type: "string", description: "MIME type, e.g. video/mp4, image/png, audio/mpeg. Must start with image/, video/ or audio/." },
        assetType: { type: "string", enum: ["image", "video", "audio"], description: "Optional hint; inferred from contentType." },
      },
      required: ["fileName", "contentType"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_generation",
    title: "Delete generation",
    annotations: { title: "Delete generation", ...DESTRUCTIVE },
    description:
      "PERMANENTLY delete one of the user's generations (its history entry and stored file) by id. Cannot be undone. Only call when the user explicitly asks to delete a specific item.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Generation id (from show_generations)." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
] as const;

export const EXTRA_TOOL_NAMES: ReadonlySet<string> = new Set(EXTRA_TOOLS.map((tool) => tool.name));

// ── helpers ────────────────────────────────────────────────────────────────

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function ok(value: Record<string, unknown>): ExtraToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError: false,
    structuredContent: value,
  };
}

function fail(message: string, extra: Record<string, unknown> = {}): ExtraToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "failed", error: message, ...extra }, null, 2) }],
    isError: true,
  };
}

function absoluteUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return getFallbackUrls(url).find((candidate) => /^https?:\/\//i.test(candidate)) ?? null;
}

/** Map a failed panel response to a clear, actionable tool error. */
export function describePanelFailure(status: number, data: unknown, fallback: string): ExtraToolResult {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const message = typeof body.error === "string" && body.error ? body.error : fallback;

  if (status === 401) {
    return fail("Your Saad Studio session expired. Reconnect the Saad Studio connector and try again.", { httpStatus: 401 });
  }
  if (status === 402) {
    return fail("Not enough credits for this action.", {
      httpStatus: 402,
      requiredCredits: body.requiredCredits ?? null,
      currentBalance: body.currentBalance ?? null,
      hint: "Top up credits on saadstudio.app/pricing, then retry.",
    });
  }
  if (status === 403) {
    return fail(message, { httpStatus: 403, blocked: body.blocked ?? undefined, reason: body.reason ?? undefined });
  }
  if (status === 429) {
    return fail("Too many requests. Wait a moment and retry.", { httpStatus: 429 });
  }
  return fail(message, { httpStatus: status });
}

function validId(value: unknown): string | null {
  const id = asString(value);
  return ID_PATTERN.test(id) ? id : null;
}

function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ── handlers ───────────────────────────────────────────────────────────────

export interface ExtraToolContext {
  /** Public site origin used to build branded /preview links. Omit to skip previews. */
  previewOrigin?: string;
}

function previewFor(ctx: ExtraToolContext | undefined, input: PreviewInput): string | null {
  return ctx?.previewOrigin ? buildPreviewUrl(ctx.previewOrigin, input) : null;
}

export async function callExtraTool(
  name: string,
  args: Record<string, unknown>,
  panel: PanelFetcher,
  ctx?: ExtraToolContext,
): Promise<ExtraToolResult | null> {
  switch (name) {
    case "check_balance": {
      const res = await panel("/api/panel/credits", { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not read the balance.");
      return ok({ creditBalance: pickRecord(res.data).creditBalance ?? null });
    }

    case "get_account": {
      const res = await panel("/api/panel/me", { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not read the account.");
      const data = pickRecord(res.data);
      const subscription = pickRecord(data.subscription);
      return ok({
        name: data.name ?? null,
        creditBalance: data.creditBalance ?? null,
        subscription: {
          active: subscription.active === true,
          planId: subscription.planId ?? null,
          billingInterval: subscription.billingInterval ?? null,
          renewsAt: subscription.renewsAt ?? null,
        },
      });
    }

    case "quote_generation": {
      const kind = asString(args.kind).toLowerCase();
      if (kind !== "image" && kind !== "video") return fail('kind must be "image" or "video".');
      const body: Record<string, unknown> = {
        kind,
        modelId: asString(args.modelId) || (kind === "image" ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL),
        resolution: asString(args.resolution) || (kind === "image" ? "1K" : "1080p"),
      };
      const aspectRatio = asString(args.aspectRatio);
      if (aspectRatio) body.aspectRatio = aspectRatio;
      const imageUrl = asString(args.imageUrl);
      if (imageUrl) body.imageUrl = imageUrl;
      if (kind === "image") {
        body.numImages = Math.max(1, Math.min(4, Math.floor(asFiniteNumber(args.numImages) ?? 1)));
      } else {
        body.duration = asFiniteNumber(args.duration) ?? 5;
        if (args.enableAudio === true) body.enableAudio = true;
      }
      const res = await panel("/api/panel/credits/quote", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not price this generation.");
      const data = pickRecord(res.data);
      return ok({
        kind,
        modelId: body.modelId,
        credits: data.credits ?? null,
        creditBalance: data.creditBalance ?? null,
        balanceAfter: data.balanceAfter ?? null,
        resolution: data.resolution ?? body.resolution,
        duration: data.duration ?? null,
        charged: false,
        affordable:
          typeof data.balanceAfter === "number" ? data.balanceAfter >= 0 : undefined,
      });
    }

    case "get_job_status": {
      const id = validId(args.id);
      if (!id) return fail("id is required (the generationId returned by a generate_* tool).");
      const res = await panel(`/api/panel/jobs/${encodeURIComponent(id)}`, { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not read the job.");
      const data = pickRecord(res.data);
      const result = pickRecord(data.result);
      return ok({
        id: data.id ?? id,
        status: data.status ?? "unknown",
        progress: data.progress ?? null,
        error: typeof data.error === "string" ? data.error : undefined,
        result: data.result
          ? { kind: result.kind ?? null, url: absoluteUrl(result.url), model: result.model ?? null, prompt: result.prompt ?? null }
          : null,
      });
    }

    case "generate_music": {
      const prompt = asString(args.prompt);
      if (!prompt) return fail("prompt is required.");
      const model = (MUSIC_MODELS as readonly string[]).includes(asString(args.model)) ? asString(args.model) : MUSIC_MODELS[0];
      const outputFormat = asString(args.output_format) === "wav" && model === MUSIC_MODELS[1] ? "wav" : "mp3";
      const body: Record<string, unknown> = { prompt, model, output_format: outputFormat };
      const duration = asFiniteNumber(args.duration);
      if (duration !== undefined && model === MUSIC_MODELS[1]) body.duration = duration;
      for (const key of ["genre", "mood", "style", "lyrics"] as const) {
        const value = asString(args[key]);
        if (value) body[key] = value;
      }
      const bpm = asFiniteNumber(args.bpm);
      if (bpm !== undefined && bpm > 0) body.bpm = bpm;
      if (args.force_instrumental === true) body.force_instrumental = true;

      const res = await panel("/api/panel/generate/music", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Music generation failed.");
      const data = pickRecord(res.data);
      const result = pickRecord(data.result);
      const audioUrl = absoluteUrl(data.audioUrl ?? result.url);
      if (!audioUrl) return fail("Music finished but no audio URL was returned.", { generationId: data.generationId ?? data.id });
      const durationSec = typeof result.durationSec === "number" ? result.durationSec : undefined;
      const previewUrl = previewFor(ctx, {
        kind: "audio",
        urls: [audioUrl],
        model: model === MUSIC_MODELS[1] ? "Lyria 3 Pro" : "Lyria 3 Clip",
        durationSec,
        prompt,
      });
      return ok({
        status: "succeeded",
        audioUrl,
        previewUrl,
        presentation: previewUrl
          ? `Show the user this link to listen on Saad Studio: [Open the preview](${previewUrl}). Do not embed audioUrl as an image.`
          : undefined,
        generationId: data.generationId ?? data.id ?? null,
        model,
        durationSec: durationSec ?? null,
        lyrics: typeof data.lyrics === "string" && data.lyrics ? data.lyrics : undefined,
      });
    }

    case "text_to_speech": {
      const text = asString(args.text);
      if (!text) return fail("text is required.");
      if (text.length > 4000) return fail("text is too long (max 4000 characters). Split it into parts.");
      const voice = asString(args.voiceId).toLowerCase();
      const voiceId = (TTS_VOICES as readonly string[]).includes(voice) ? voice : "rachel";
      const speed = Math.max(0.5, Math.min(2, asFiniteNumber(args.speed) ?? 1));
      const res = await panel("/api/panel/generate/tts", {
        method: "POST",
        body: JSON.stringify({ text, voiceId, speed }),
      });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Text to speech failed.");
      const data = pickRecord(res.data);
      const audioUrl = absoluteUrl(data.audioUrl);
      if (!audioUrl) return fail("Speech finished but no audio URL was returned.");
      const previewUrl = previewFor(ctx, { kind: "audio", urls: [audioUrl], model: `Voice: ${voiceId}`, prompt: text });
      return ok({
        status: "succeeded",
        audioUrl,
        previewUrl,
        presentation: previewUrl
          ? `Show the user this link to listen on Saad Studio: [Open the preview](${previewUrl}). Do not embed audioUrl as an image.`
          : undefined,
        voiceId,
        characterCount: data.characterCount ?? null,
        creditsUsed: data.creditsUsed ?? null,
        balanceAfter: data.balanceAfter ?? null,
      });
    }

    case "post_produce_video": {
      const tool = asString(args.tool);
      if (!(POST_PRODUCTION_TOOLS as readonly string[]).includes(tool)) {
        return fail(`tool must be one of: ${POST_PRODUCTION_TOOLS.join(", ")}.`);
      }
      const sourceUrl = asString(args.sourceUrl);
      if (!/^https?:\/\//i.test(sourceUrl)) {
        return fail("sourceUrl must be a public http(s) URL. Use create_upload_url for local files.");
      }
      const options: Record<string, unknown> = { ...pickRecord(args.options) };
      const durationSec = asFiniteNumber(args.durationSec);
      if (durationSec !== undefined && durationSec > 0) options.duration = durationSec;

      if (tool === "dubbing") {
        const target = asString(options.translationLanguage) || asString(options.translateTo) || asString(options.dubbingLanguage);
        if (!target) {
          return fail("Dubbing needs options.translationLanguage. Call list_dubbing_languages to pick a code.");
        }
      }

      const body: Record<string, unknown> = { tool, sourceUrl, options };
      const filename = asString(args.filename);
      if (filename) body.filename = filename.slice(0, MAX_FILE_NAME);

      const res = await panel("/api/panel/reap/start", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not start the post-production job.");
      const data = pickRecord(res.data);
      return ok({
        status: data.status ?? "queued",
        tool,
        projectId: data.projectId ?? null,
        generationId: data.generationId ?? null,
        creditsCharged: data.creditsCharged ?? null,
        nextStep: "Call get_post_production_status with projectId and generationId until status is completed.",
      });
    }

    case "get_post_production_status": {
      const projectId = asString(args.projectId);
      if (!projectId || projectId.length > 200) return fail("projectId is required.");
      // generationId is mandatory: the server only polls jobs that belong to the
      // caller's own generations, so the id returned by post_produce_video is the
      // proof of ownership.
      const generationId = validId(args.generationId);
      if (!generationId) return fail("generationId is required (returned by post_produce_video together with projectId).");
      const query = new URLSearchParams({ projectId, generationId });
      const res = await panel(`/api/panel/reap/status?${query.toString()}`, { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not read the job status.");
      const data = pickRecord(res.data);
      const urls = Array.isArray(data.urls)
        ? (data.urls.map(absoluteUrl).filter((url): url is string => Boolean(url)))
        : [];
      const url = absoluteUrl(data.url) ?? urls[0] ?? null;
      return ok({
        status: data.status ?? "processing",
        progress: data.progress ?? null,
        url,
        urls: urls.length ? urls : url ? [url] : [],
        error: typeof data.error === "string" ? data.error : undefined,
      });
    }

    case "list_dubbing_languages": {
      const res = await panel("/api/panel/reap/dubbing-languages", { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not load dubbing languages.");
      return ok({ languages: res.data as unknown });
    }

    case "list_translation_languages": {
      const res = await panel("/api/panel/reap/translation-languages", { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not load translation languages.");
      return ok({ languages: res.data as unknown });
    }

    case "list_caption_presets": {
      const res = await panel("/api/panel/reap/caption-presets", { method: "GET" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not load caption presets.");
      return ok({ presets: pickRecord(res.data).presets ?? [] });
    }

    case "create_upload_url": {
      const fileName = asString(args.fileName);
      if (!fileName || fileName.length > MAX_FILE_NAME) return fail("fileName is required (max 200 characters).");
      const contentType = asString(args.contentType).toLowerCase();
      if (!/^(image|video|audio)\/[a-z0-9.+-]+$/.test(contentType)) {
        return fail("contentType must be an image/*, video/* or audio/* MIME type, e.g. video/mp4.");
      }
      const assetType = asString(args.assetType);
      const body: Record<string, unknown> = { fileName, contentType };
      if (assetType) body.assetType = assetType;
      const res = await panel("/api/panel/upload-url", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not create an upload URL.");
      const data = pickRecord(res.data);
      if (typeof data.signedUrl !== "string" || typeof data.publicUrl !== "string") {
        return fail("The server did not return an upload URL.");
      }
      return ok({
        signedUrl: data.signedUrl,
        publicUrl: data.publicUrl,
        contentType,
        howTo: `PUT the raw file bytes to signedUrl with the header "Content-Type: ${contentType}" (for example: curl -X PUT -H "Content-Type: ${contentType}" --data-binary @file "<signedUrl>"). Then pass publicUrl as imageUrl or sourceUrl.`,
      });
    }

    case "delete_generation": {
      const id = validId(args.id);
      if (!id) return fail("id is required (a generation id from show_generations).");
      const res = await panel(`/api/panel/generations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return describePanelFailure(res.status, res.data, "Could not delete the generation.");
      return ok({ deleted: pickRecord(res.data).deleted === true, id });
    }

    default:
      return null;
  }
}
