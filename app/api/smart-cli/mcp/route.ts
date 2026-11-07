import { NextResponse } from "next/server";

import { verifyPanelToken } from "@/lib/panel-auth";
import { getFallbackUrls } from "@/lib/utils";
import { getInternalBaseUrl, getPublicOrigin, SMART_CLI_CANONICAL_ORIGIN } from "@/lib/smart-cli-origin";
import { callExtraTool, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, EXTRA_TOOLS } from "@/lib/smart-cli-extra-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
};

type JsonRpcPayload = {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolResult = {
  content: ToolContent[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
};


// MCP Apps UI resource URIs — the widgets that Claude renders inline when
// these tools return. See https://apps.extensions.modelcontextprotocol.io/.
const IMAGE_VIEW_URI = "ui://saadstudio/image.html";
const VIDEO_VIEW_URI = "ui://saadstudio/video.html";

const IMAGE_TOOL_UI_META = {
  ui: { resourceUri: IMAGE_VIEW_URI },
  "ui/resourceUri": IMAGE_VIEW_URI,
} as const;

const VIDEO_TOOL_UI_META = {
  ui: { resourceUri: VIDEO_VIEW_URI },
  "ui/resourceUri": VIDEO_VIEW_URI,
} as const;

// MCP tool annotations (spec: ToolAnnotations). Claude uses them to group the
// connector's tools in Settings → Connectors → Tool permissions:
//   readOnlyHint: true  → "Read-only tools"  (safe to allow without asking)
//   readOnlyHint: false → "Write/delete tools" (asks for approval by default)
// Without them every tool lands in "Other tools" with one blanket permission.
//
// Generation tools spend the user's credits, so they stay write-class (approval
// by default) but are marked non-destructive: they only add new media.
const GENERATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
} as const;

const CORE_TOOLS = [
  {
    name: "generate_image",
    title: "Generate image",
    annotations: { title: "Generate image", ...GENERATE_ANNOTATIONS },
    description: "Generate an image through Saad Studio using Nano Banana Pro by default.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt to generate." },
        modelId: { type: "string", default: DEFAULT_IMAGE_MODEL },
        aspectRatio: { type: "string", default: "1:1" },
        resolution: { type: "string", default: "1K" },
        numImages: { type: "number", default: 1 },
        negativePrompt: { type: "string" },
        imageUrl: { type: "string", description: "Optional reference image URL." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_storyboard",
    title: "Generate storyboard",
    annotations: { title: "Generate storyboard", ...GENERATE_ANNOTATIONS },
    description:
      "Generate multiple concept variations (storyboard candidates) from a single idea. Returns N image options the user can pick from before rendering a video.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The story idea or scene description." },
        numConcepts: {
          type: "number",
          description: "How many concept variations to generate (1-4). Default 4.",
          default: 4,
        },
        aspectRatio: { type: "string", default: "16:9" },
        style: {
          type: "string",
          description: "Optional style hint, e.g. 'cinematic', 'comic', 'noir', 'anime'.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    title: "Generate video",
    annotations: { title: "Generate video", ...GENERATE_ANNOTATIONS },
    description:
      "Render a video from a prompt. Optionally pass imageUrl (a concept from generate_storyboard or from show_generations) to do image-to-video.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        imageUrl: { type: "string", description: "Optional first-frame image URL (from a chosen storyboard concept or an earlier generation)." },
        modelId: { type: "string", default: DEFAULT_VIDEO_MODEL },
        duration: { type: "number", default: 5 },
        aspectRatio: { type: "string", default: "16:9" },
        resolution: { type: "string", default: "1080p" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "show_generations",
    title: "Show generations",
    annotations: { title: "Show generations", ...READ_ONLY_ANNOTATIONS },
    description:
      "List the most recent images/videos the user generated. Returns public URLs so Claude can reference an earlier image (e.g. as first frame for a new video via generate_video's imageUrl) or show the user their history.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many recent items to return (1-50). Default 10.", default: 10 },
        kind: {
          type: "string",
          description: "Filter by media kind. Omit for all.",
          enum: ["image", "video", "audio"],
        },
      },
    },
  },
  {
    name: "list_models",
    title: "List models",
    annotations: { title: "List models", ...READ_ONLY_ANNOTATIONS },
    description:
      "List the image and video models available on Saad Studio, with their capabilities. Use before generate_image/generate_video when the user asks for a specific look, quality tier, or a named model.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "Filter by kind. Omit for all.",
          enum: ["image", "video"],
        },
      },
    },
  },
];

const tools = [...CORE_TOOLS, ...EXTRA_TOOLS];

const AVAILABLE_MODELS = [
  { id: "nano-banana-pro", kind: "image", label: "Nano Banana Pro", notes: "Default. Professional 4K asset production.", badges: ["default", "pro"] },
  { id: "nano-banana-2", kind: "image", label: "Nano Banana 2", notes: "Balanced quality, speed, cost, and prompt adherence.", badges: ["balanced"] },
  { id: "google/nano-banana", kind: "image", label: "Google Nano Banana", notes: "Google Imagen variant.", badges: [] },
  { id: "seedream/5-pro", kind: "image", label: "Seedream 5 Pro", notes: "ByteDance high-fidelity. Accepts reference images for edit mode.", badges: ["pro"] },
  { id: "seedream/5-lite", kind: "image", label: "Seedream 5 Lite", notes: "Cheaper Seedream tier.", badges: [] },
  { id: "flux-2/pro", kind: "image", label: "Flux 2 Pro", notes: "Black Forest Labs flagship.", badges: ["pro"] },
  { id: "gpt-image-2", kind: "image", label: "GPT Image 2", notes: "OpenAI image model. Slower, strong typography.", badges: [] },
  { id: "minimax-h3-reference-to-video", kind: "video", label: "Minimax H3", notes: "Minimax reference-to-video.", badges: ["new"] },
  { id: "kling-3.0/video", kind: "video", label: "Kling 3.0", notes: "Default video model. 5-10s, 1080p.", badges: ["default", "new"] },
  { id: "kling-video-o3", kind: "video", label: "Kling O3", notes: "Flagship Kling. Best fidelity.", badges: ["top"] },
  { id: "kling/v3-turbo-text-to-video", kind: "video", label: "Kling V3 Turbo", notes: "Faster Kling variant.", badges: ["fast"] },
  { id: "kling-v2.6-t2v", kind: "video", label: "Kling 2.6", notes: "Previous-gen Kling, cheaper and quick.", badges: ["fast"] },
  { id: "google/veo3.1-lite-text-to-video", kind: "video", label: "Google Veo 3.1 Lite", notes: "Lightweight Veo tier." },
  { id: "google/veo3.1-fast-text-to-video", kind: "video", label: "Google Veo 3.1 Fast", notes: "Faster Veo 3.1.", badges: ["fast"] },
  { id: "google/veo3.1-text-to-video", kind: "video", label: "Google Veo 3.1", notes: "Google flagship video, native audio.", badges: ["new"] },
  { id: "google/veo3-fast-text-to-video", kind: "video", label: "Google Veo 3 Fast", notes: "Legacy Veo 3 Fast. Fixed 8s, 720p/1080p.", badges: ["fast"] },
  { id: "google/veo3-text-to-video", kind: "video", label: "Google Veo 3", notes: "Legacy Veo 3. Fixed 8s, 720p/1080p.", badges: [] },
  { id: "google/gemini-omni-flash", kind: "video", label: "Google Gemini Omni", notes: "Gemini Omni 1.1 video generation/editing. 360p/720p/1080p/4k, 3-10s.", badges: ["new"] },
  { id: "bytedance/seedance-2.5/text-to-video-turbo", kind: "video", label: "Seedance 2.5", notes: "480p/720p, 4-30s, up to 30 image + 10 video + 10 audio references.", badges: ["new"] },
  { id: "bytedance/seedance-2.5/image-to-video-turbo", kind: "video", label: "Seedance 2.5 I2V Turbo", notes: "Image-to-video, optional last image, 480p/720p, 4-30s.", badges: ["fast"] },
  { id: "bytedance/seedance-v2/text-to-video-fast", kind: "video", label: "Seedance 2.0 Turbo", notes: "Fastest Seedance tier.", badges: ["fast"] },
  { id: "bytedance/seedance-v2/text-to-video-mini", kind: "video", label: "Seedance 2.0 Mini", notes: "Cheapest Seedance tier.", badges: ["fast"] },
  { id: "bytedance/seedance-v2/text-to-video", kind: "video", label: "Seedance 2.0", notes: "ByteDance flagship video, accepts reference images + audio.", badges: ["new"] },
];

// ── MCP Apps widgets ──────────────────────────────────────────────────────
// Two inline HTML documents Claude renders as rich cards when generate_image /
// generate_storyboard / generate_video return. They pull @modelcontextprotocol
// /ext-apps from unpkg (declared in CSP meta on the resource), read the tool
// result via app.ontoolresult, and render the image(s) or video with the
// model + aspect badges plus the prompt.

const IMAGE_WIDGET_HTML = String.raw`<!DOCTYPE html>
<html>
<head>
<meta name="color-scheme" content="light dark">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e2e8f0; }
  .card { max-width: 560px; padding: 4px; }
  .head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(148,163,184,0.15); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); }
  .badge.model { background: rgba(34,211,238,0.15); color: #67e8f9; border-color: rgba(34,211,238,0.3); }
  .badge.aspect { background: rgba(148,163,184,0.1); }
  .prompt { margin: 0 0 12px 0; font-size: 13px; line-height: 1.6; color: #94a3b8; max-height: 4.8em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
  .grid.multi { grid-template-columns: 1fr 1fr; }
  .img-wrap { border-radius: 12px; overflow: hidden; background: rgba(15,23,42,0.4); border: 1px solid rgba(148,163,184,0.12); }
  img { display: block; width: 100%; height: auto; max-height: 640px; object-fit: contain; }
  .empty { padding: 40px 20px; text-align: center; color: #64748b; font-size: 13px; }
  @media (prefers-color-scheme: light) {
    body { color: #0f172a; }
    .badge { background: rgba(15,23,42,0.06); color: #334155; border-color: rgba(15,23,42,0.1); }
    .badge.model { background: rgba(6,182,212,0.15); color: #0891b2; border-color: rgba(6,182,212,0.3); }
    .prompt { color: #64748b; }
    .img-wrap { background: rgba(15,23,42,0.03); border-color: rgba(15,23,42,0.08); }
  }
</style>
</head>
<body>
<div class="card" id="root"><div class="empty">Loading…</div></div>
<script type="module">
  import { App } from "https://saadstudio.app/mcp-ext-apps-0.4.0.js";
  const app = new App({ name: "Saad Studio · Image", version: "1.0.0" });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  app.ontoolresult = ({ content, structuredContent }) => {
    const meta = structuredContent || {};
    const imageBlocks = (content || []).filter((c) => c && c.type === "image");
    const urls = Array.isArray(meta.imageUrls) ? meta.imageUrls : (meta.imageUrl ? [meta.imageUrl] : []);
    const modelLabel = meta.modelLabel || meta.modelId || "Nano Banana Pro";
    const aspect = meta.aspectRatio || "";
    const prompt = meta.prompt || "";

    const cards = [];
    for (let i = 0; i < Math.max(imageBlocks.length, urls.length); i++) {
      const block = imageBlocks[i];
      const src = block ? "data:" + (block.mimeType || "image/png") + ";base64," + block.data : urls[i];
      if (src) cards.push('<div class="img-wrap"><img src="' + esc(src) + '" alt="Generated image ' + (i + 1) + '"></div>');
    }

    const root = document.getElementById("root");
    root.innerHTML =
      '<div class="head">' +
        '<span class="badge model">' + esc(modelLabel) + '</span>' +
        (aspect ? '<span class="badge aspect">' + esc(aspect) + '</span>' : '') +
      '</div>' +
      (prompt ? '<p class="prompt">' + esc(prompt) + '</p>' : '') +
      (cards.length
        ? '<div class="grid' + (cards.length > 1 ? ' multi' : '') + '">' + cards.join('') + '</div>'
        : '<div class="empty">No image returned.</div>');
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx && ctx.safeAreaInsets) {
      const s = ctx.safeAreaInsets;
      document.body.style.padding = s.top + 'px ' + s.right + 'px ' + s.bottom + 'px ' + s.left + 'px';
    }
  };

  await app.connect();
  const ctx = app.getHostContext && app.getHostContext();
  if (ctx && ctx.safeAreaInsets) {
    const s = ctx.safeAreaInsets;
    document.body.style.padding = s.top + 'px ' + s.right + 'px ' + s.bottom + 'px ' + s.left + 'px';
  }
</script>
</body>
</html>`;

const VIDEO_WIDGET_HTML = String.raw`<!DOCTYPE html>
<html>
<head>
<meta name="color-scheme" content="light dark">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e2e8f0; }
  .card { max-width: 560px; padding: 4px; }
  .head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(148,163,184,0.15); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); }
  .badge.model { background: rgba(217,70,239,0.15); color: #f0abfc; border-color: rgba(217,70,239,0.3); }
  .prompt { margin: 0 0 12px 0; font-size: 13px; line-height: 1.6; color: #94a3b8; max-height: 4.8em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .video-wrap { border-radius: 12px; overflow: hidden; background: rgba(15,23,42,0.4); border: 1px solid rgba(148,163,184,0.12); }
  video { display: block; width: 100%; height: auto; max-height: 640px; background: black; }
  .empty { padding: 40px 20px; text-align: center; color: #64748b; font-size: 13px; }
  @media (prefers-color-scheme: light) {
    body { color: #0f172a; }
    .badge { background: rgba(15,23,42,0.06); color: #334155; border-color: rgba(15,23,42,0.1); }
    .badge.model { background: rgba(217,70,239,0.15); color: #a21caf; border-color: rgba(217,70,239,0.3); }
    .prompt { color: #64748b; }
    .video-wrap { background: rgba(15,23,42,0.03); border-color: rgba(15,23,42,0.08); }
  }
</style>
</head>
<body>
<div class="card" id="root"><div class="empty">Loading…</div></div>
<script type="module">
  import { App } from "https://saadstudio.app/mcp-ext-apps-0.4.0.js";
  const app = new App({ name: "Saad Studio · Video", version: "1.0.0" });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  app.ontoolresult = ({ structuredContent }) => {
    const meta = structuredContent || {};
    const urls = Array.isArray(meta.videoUrls) ? meta.videoUrls : (meta.videoUrl ? [meta.videoUrl] : []);
    const modelLabel = meta.modelLabel || meta.modelId || "Kling 3.0";
    const aspect = meta.aspectRatio || "";
    const durationS = meta.duration ? meta.duration + "s" : "";
    const prompt = meta.prompt || "";
    const src = urls[0];

    const root = document.getElementById("root");
    root.innerHTML =
      '<div class="head">' +
        '<span class="badge model">' + esc(modelLabel) + '</span>' +
        (aspect ? '<span class="badge">' + esc(aspect) + '</span>' : '') +
        (durationS ? '<span class="badge">' + esc(durationS) + '</span>' : '') +
      '</div>' +
      (prompt ? '<p class="prompt">' + esc(prompt) + '</p>' : '') +
      (src
        ? '<div class="video-wrap"><video src="' + esc(src) + '" controls playsinline preload="metadata"></video></div>'
        : '<div class="empty">Video is still rendering. Poll again in a few seconds.</div>');
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx && ctx.safeAreaInsets) {
      const s = ctx.safeAreaInsets;
      document.body.style.padding = s.top + 'px ' + s.right + 'px ' + s.bottom + 'px ' + s.left + 'px';
    }
  };

  await app.connect();
</script>
</body>
</html>`;

const UI_RESOURCES = [
  {
    uri: IMAGE_VIEW_URI,
    name: "Saad Studio image result",
    description: "Rich card that displays generated images with the model and aspect ratio.",
    mimeType: "text/html;profile=mcp-app",
    text: IMAGE_WIDGET_HTML,
    _meta: {
      ui: { csp: { resourceDomains: [SMART_CLI_CANONICAL_ORIGIN], connectDomains: [SMART_CLI_CANONICAL_ORIGIN] } },
    },
  },
  {
    uri: VIDEO_VIEW_URI,
    name: "Saad Studio video result",
    description: "Rich card that plays the generated video with the model, aspect ratio, and duration.",
    mimeType: "text/html;profile=mcp-app",
    text: VIDEO_WIDGET_HTML,
    _meta: {
      ui: { csp: { resourceDomains: [SMART_CLI_CANONICAL_ORIGIN], connectDomains: [SMART_CLI_CANONICAL_ORIGIN] } },
    },
  },
];

function findModelLabel(modelId: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

// Panel APIs return storage-relative paths ("images/user_xxx/abc.jpg").
// The widget renders them inside a sandboxed iframe, so relative paths
// resolve against the iframe origin (not saadstudio.app) and 404. Convert
// to the first absolute CDN URL from our storage fallback chain.
function toAbsoluteMediaUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const candidates = getFallbackUrls(url).filter((u) => /^https?:\/\//i.test(u));
  return candidates[0] ?? null;
}

function toAbsoluteMediaUrls(urls: string[] | undefined | null): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(toAbsoluteMediaUrl).filter((u): u is string => Boolean(u));
}

function withMcpHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("MCP-Protocol-Version", "2024-11-05");
  return response;
}

function getOrigin(request: Request) {
  return getPublicOrigin(request);
}

function authChallenge(request: Request) {
  const origin = getOrigin(request);
  return new NextResponse(null, {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": "2024-11-05",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="smart_cli.generate smart_cli.read"`,
    },
  });
}

function rpcPayload(id: unknown, result: unknown): JsonRpcPayload {
  return { jsonrpc: "2.0", id, result };
}

function rpcErrorPayload(id: unknown, code: number, message: string): JsonRpcPayload {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResponse(payload: JsonRpcPayload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "MCP-Protocol-Version": "2024-11-05",
    },
  });
}

function toolResult(value: unknown, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    isError,
  };
}

// 25 MB cap on a single tool response payload (Claude.ai refuses much larger).
// Each image is base64 (~33% overhead). Cap individuals at 10 MB raw so we can
// fit ~2 hi-res images per response, and stop at 22 MB total to leave room for
// the JSON text block.
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_INLINE_BYTES = 22 * 1024 * 1024;

function guessImageMimeFromUrl(url: string): string | null {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return null;
}

type InlineFetchOk = { ok: true; data: string; mimeType: string; bytes: number };
type InlineFetchErr = { ok: false; reason: string };

async function fetchInlineImage(url: string): Promise<InlineFetchOk | InlineFetchErr> {
  // Panel APIs return storage-relative paths ("images/user_xxx/abc.jpg")
  // that fetch() can't parse. getFallbackUrls expands them into the ordered
  // list of absolute CDN URLs (Backblaze B2 → /api/media → R2). We stop at
  // the first host that returns bytes so Claude actually gets the image.
  const candidates = getFallbackUrls(url).filter((candidate) =>
    /^https?:\/\//i.test(candidate),
  );
  if (candidates.length === 0) return { ok: false, reason: "no_absolute_url" };

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { cache: "no-store" });
      if (!res.ok) {
        failures.push(`http_${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength === 0) {
        failures.push("empty_body");
        continue;
      }
      if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
        return { ok: false, reason: `too_large_${buffer.byteLength}` };
      }
      const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      const mimeType = headerMime.startsWith("image/")
        ? headerMime
        : guessImageMimeFromUrl(candidate) ?? "image/png";
      return { ok: true, data: buffer.toString("base64"), mimeType, bytes: buffer.byteLength };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      failures.push(`fetch_failed:${msg.slice(0, 60)}`);
    }
  }
  return { ok: false, reason: failures.join("|") || "all_candidates_failed" };
}

type InlineCollection = {
  blocks: ToolContent[];
  diagnostics: { attached: number; skipped: number; reasons: string[] };
};

async function collectInlineImages(urls: string[]): Promise<InlineCollection> {
  const fetched = await Promise.all(urls.map(fetchInlineImage));
  const blocks: ToolContent[] = [];
  const reasons: string[] = [];
  let total = 0;
  let attached = 0;
  let skipped = 0;
  for (const item of fetched) {
    if (!item.ok) {
      skipped += 1;
      reasons.push(item.reason);
      continue;
    }
    if (total + item.data.length > MAX_TOTAL_INLINE_BYTES) {
      skipped += 1;
      reasons.push("payload_cap_reached");
      continue;
    }
    blocks.push({ type: "image", data: item.data, mimeType: item.mimeType });
    total += item.data.length;
    attached += 1;
  }
  return { blocks, diagnostics: { attached, skipped, reasons } };
}

function toolResultWithImages(
  value: unknown,
  collection: InlineCollection,
  structuredContent?: Record<string, unknown>,
): ToolResult {
  const annotated = typeof value === "object" && value !== null
    ? { ...(value as Record<string, unknown>), _inlineImages: collection.diagnostics }
    : { value, _inlineImages: collection.diagnostics };
  return {
    content: [
      ...collection.blocks,
      { type: "text", text: JSON.stringify(annotated, null, 2) },
    ],
    isError: false,
    structuredContent,
  };
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

function hasValidToken(request: Request) {
  const token = getBearerToken(request);
  return Boolean(token && verifyPanelToken(token));
}

function normalizeToolName(name: unknown) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  const unprefixed = trimmed.includes(":") ? trimmed.split(":").pop() : trimmed;
  return unprefixed ?? trimmed;
}

function normalizeToolArgs(args: Record<string, unknown>) {
  const nested = args.params;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return args;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const MCP_IMAGE_DIMENSION_LABELS: Record<string, readonly string[]> = {
  "16:9": ["1K", "2K"],
  "9:16": ["1K", "2K"],
  "1:1": ["1K", "2K"],
  "4:3": ["1K", "2K"],
  "3:4": ["1K", "2K"],
};

function normalizeMcpImageRequest(aspectRatio: string, resolution: string): { aspectRatio: string; resolution: string } | { error: string } {
  const cleanAspectRatio = aspectRatio.trim();
  const cleanResolution = resolution.trim().toUpperCase();
  const supportedResolutions = MCP_IMAGE_DIMENSION_LABELS[cleanAspectRatio];
  if (!supportedResolutions?.includes(cleanResolution)) {
    const supported = Object.entries(MCP_IMAGE_DIMENSION_LABELS)
      .flatMap(([aspect, resolutions]) => resolutions.map((res) => `${aspect} + ${res}`))
      .join(", ");
    return {
      error: `Unsupported image dimensions: aspectRatio=${cleanAspectRatio || "(empty)"}, resolution=${cleanResolution || "(empty)"}. Supported pairs: ${supported}.`,
    };
  }
  return { aspectRatio: cleanAspectRatio, resolution: cleanResolution };
}

async function panelFetch(
  request: Request,
  path: string,
  init: RequestInit,
  token: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Fixed trusted base: never derive the fetch target (which carries the
  // Bearer token) from request headers.
  const url = new URL(path, getInternalBaseUrl());
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function callGenerateImage(
  request: Request,
  args: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const prompt = asString(args.prompt).trim();
  if (!prompt) return toolResult({ error: "Missing prompt." }, true);

  const normalizedImageRequest = normalizeMcpImageRequest(
    asString(args.aspectRatio, "1:1"),
    asString(args.resolution, "1K"),
  );
  if ("error" in normalizedImageRequest) {
    return toolResult({ error: normalizedImageRequest.error }, true);
  }

  const body = {
    prompt,
    modelId: asString(args.modelId, DEFAULT_IMAGE_MODEL),
    aspectRatio: normalizedImageRequest.aspectRatio,
    resolution: normalizedImageRequest.resolution,
    numImages: asNumber(args.numImages, 1),
    negativePrompt: asString(args.negativePrompt) || undefined,
    imageUrl: asString(args.imageUrl) || undefined,
  };

  const res = await panelFetch(request, "/api/panel/generate/image", {
    method: "POST",
    body: JSON.stringify(body),
  }, token);

  if (!res.ok) {
    return toolResult(
      { status: "failed", modelId: body.modelId, error: (res.data as { error?: string })?.error ?? "Image generation failed." },
      true,
    );
  }

  const data = res.data as { imageUrls?: string[]; imageUrl?: string | null; generationId?: string };
  const urls = Array.isArray(data.imageUrls) && data.imageUrls.length
    ? data.imageUrls
    : data.imageUrl ? [data.imageUrl] : [];
  const absoluteUrls = toAbsoluteMediaUrls(urls);
  const collection = await collectInlineImages(urls);

  const structuredContent = {
    prompt: body.prompt,
    modelId: body.modelId,
    modelLabel: findModelLabel(body.modelId),
    aspectRatio: body.aspectRatio,
    resolution: body.resolution,
    imageUrls: absoluteUrls,
    imageUrl: absoluteUrls[0] ?? null,
    generationId: data.generationId ?? null,
  };

  const fallbackText = absoluteUrls[0]
    ? `Done — here's the image:\n${absoluteUrls[0]}`
    : `Done — generated via ${findModelLabel(body.modelId)}.`;

  return {
    content: [
      ...collection.blocks,
      { type: "text", text: fallbackText },
    ],
    isError: false,
    structuredContent,
  };
}

async function callGenerateStoryboard(
  request: Request,
  args: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const idea = asString(args.prompt).trim();
  if (!idea) return toolResult({ error: "Missing prompt." }, true);

  const requested = asNumber(args.numConcepts, 4);
  const numConcepts = Math.max(1, Math.min(4, Math.floor(requested)));
  const normalizedImageRequest = normalizeMcpImageRequest(asString(args.aspectRatio, "16:9"), "1K");
  if ("error" in normalizedImageRequest) {
    return toolResult({ error: normalizedImageRequest.error }, true);
  }
  const aspectRatio = normalizedImageRequest.aspectRatio;
  const style = asString(args.style).trim();

  const styleClause = style ? `, ${style} style` : "";
  const compositionClause = ", cinematic composition, key lighting, clear focal subject";
  const fullPrompt = `${idea}${styleClause}${compositionClause}`;

  const res = await panelFetch(request, "/api/panel/generate/image", {
    method: "POST",
    body: JSON.stringify({
      prompt: fullPrompt,
      modelId: DEFAULT_IMAGE_MODEL,
      aspectRatio,
      resolution: normalizedImageRequest.resolution,
      numImages: numConcepts,
    }),
  }, token);

  if (!res.ok) {
    return toolResult(
      { status: "failed", error: (res.data as { error?: string })?.error ?? "Storyboard generation failed." },
      true,
    );
  }

  const data = res.data as { imageUrls?: string[]; imageUrl?: string; generationId?: string };
  const urls = Array.isArray(data.imageUrls) ? data.imageUrls : data.imageUrl ? [data.imageUrl] : [];
  const absoluteUrls = toAbsoluteMediaUrls(urls);

  const concepts = absoluteUrls.map((url, index) => ({
    conceptId: `${index + 1}`,
    imageUrl: url,
    label: `Concept ${index + 1}`,
  }));

  const collection = await collectInlineImages(urls);

  const structuredContent = {
    prompt: idea,
    modelId: DEFAULT_IMAGE_MODEL,
    modelLabel: findModelLabel(DEFAULT_IMAGE_MODEL),
    aspectRatio,
    imageUrls: absoluteUrls,
    imageUrl: absoluteUrls[0] ?? null,
    concepts,
    generationId: data.generationId ?? null,
  };

  const fallbackText = absoluteUrls.length
    ? `Done — ${absoluteUrls.length} concept${absoluteUrls.length > 1 ? "s" : ""} ready:\n${absoluteUrls.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}\n\nAsk which concept to animate, then call generate_video with imageUrl set to that URL.`
    : `Storyboard job accepted but no URLs yet.`;

  return {
    content: [
      ...collection.blocks,
      { type: "text", text: fallbackText },
    ],
    isError: false,
    structuredContent,
  };
}

async function callGenerateVideo(
  request: Request,
  args: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const prompt = asString(args.prompt).trim();
  if (!prompt) return toolResult({ error: "Missing prompt." }, true);

  const body = {
    prompt,
    modelId: asString(args.modelId, DEFAULT_VIDEO_MODEL),
    duration: asNumber(args.duration, 5),
    aspectRatio: asString(args.aspectRatio, "16:9"),
    resolution: asString(args.resolution, "1080p"),
    imageUrl: asString(args.imageUrl) || undefined,
  };

  const res = await panelFetch(request, "/api/panel/generate/video", {
    method: "POST",
    body: JSON.stringify(body),
  }, token);

  if (!res.ok) {
    return toolResult(
      { status: "failed", modelId: body.modelId, error: (res.data as { error?: string })?.error ?? "Video generation failed." },
      true,
    );
  }

  const videoData = res.data as { videoUrl?: string; videoUrls?: string[]; url?: string; generationId?: string };
  const rawVideoUrls = Array.isArray(videoData.videoUrls) && videoData.videoUrls.length
    ? videoData.videoUrls
    : videoData.videoUrl
      ? [videoData.videoUrl]
      : videoData.url
        ? [videoData.url]
        : [];
  const absoluteVideoUrls = toAbsoluteMediaUrls(rawVideoUrls);

  const structuredContent = {
    prompt: body.prompt,
    modelId: body.modelId,
    modelLabel: findModelLabel(body.modelId),
    aspectRatio: body.aspectRatio,
    duration: body.duration,
    resolution: body.resolution,
    videoUrls: absoluteVideoUrls,
    videoUrl: absoluteVideoUrls[0] ?? null,
    generationId: videoData.generationId ?? null,
  };

  const fallbackText = absoluteVideoUrls[0]
    ? `Done — here's the video:\n${absoluteVideoUrls[0]}`
    : `Video job accepted via ${findModelLabel(body.modelId)}. May still be processing.`;

  return {
    content: [{ type: "text", text: fallbackText }],
    isError: false,
    structuredContent,
  };
}

async function callShowGenerations(
  request: Request,
  args: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const rawLimit = Math.floor(asNumber(args.limit, 10));
  const limit = Math.max(1, Math.min(50, rawLimit));
  const kind = asString(args.kind).toLowerCase();
  const query = new URLSearchParams({ limit: String(limit) });
  if (kind === "image" || kind === "video" || kind === "audio") {
    query.set("kind", kind);
  }

  const res = await panelFetch(
    request,
    `/api/panel/generations?${query.toString()}`,
    { method: "GET" },
    token,
  );
  if (!res.ok) {
    return toolResult(
      { error: (res.data as { error?: string })?.error ?? "Failed to list generations." },
      true,
    );
  }

  const data = res.data as { items?: Array<Record<string, unknown>>; hasMore?: boolean };
  const items = data.items ?? [];
  const imageUrls = items
    .filter((item) => item.kind === "image" && typeof item.url === "string")
    .slice(0, 4)
    .map((item) => item.url as string);
  const collection = await collectInlineImages(imageUrls);

  return toolResultWithImages({
    items,
    hasMore: data.hasMore ?? false,
    hint: "To reuse an image as the first frame of a new video, call generate_video with imageUrl set to that item's url.",
  }, collection);
}

function callListModels(args: Record<string, unknown>): ToolResult {
  const kind = asString(args.kind).toLowerCase();
  const models = kind === "image" || kind === "video"
    ? AVAILABLE_MODELS.filter((model) => model.kind === kind)
    : AVAILABLE_MODELS;
  return toolResult({
    defaults: { image: DEFAULT_IMAGE_MODEL, video: DEFAULT_VIDEO_MODEL },
    models,
    hint: "Pass any model id to generate_image or generate_video via the modelId parameter. Omit modelId to use the default.",
  });
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  request: Request,
): Promise<ToolResult> {
  const token = getBearerToken(request);
  if (!token) {
    return toolResult(
      { status: "auth_required", error: "Missing Authorization: Bearer ssp_... header." },
      true,
    );
  }

  switch (name) {
    case "generate_image":
      return callGenerateImage(request, args, token);
    case "generate_storyboard":
      return callGenerateStoryboard(request, args, token);
    case "generate_video":
      return callGenerateVideo(request, args, token);
    case "show_generations":
      return callShowGenerations(request, args, token);
    case "list_models":
      return callListModels(args);
    default: {
      // Account / status / audio / post-production / upload tools live in
      // lib/smart-cli-extra-tools.ts and share this panelFetch + token.
      const extra = await callExtraTool(
        name,
        args,
        (path, init) => panelFetch(request, path, init ?? {}, token),
      );
      return extra ?? toolResult({ error: `Unknown tool: ${name}` }, true);
    }
  }
}

async function handleRpcPayload(body: JsonRpcRequest, request: Request): Promise<JsonRpcPayload | null> {
  const id = body?.id ?? null;
  const method = body?.method;

  if (!method) return rpcErrorPayload(id, -32600, "Invalid request");
  if (method.startsWith("notifications/")) return null;

  if (method === "initialize") {
    return rpcPayload(id, {
      protocolVersion: body?.params?.protocolVersion ?? "2024-11-05",
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      serverInfo: { name: "saad-studio-smart-cli", version: "0.3.0" },
    });
  }

  if (method === "ping") return rpcPayload(id, {});
  if (method === "tools/list") return rpcPayload(id, { tools });

  if (method === "resources/list") {
    return rpcPayload(id, {
      resources: UI_RESOURCES.map(({ text: _text, ...rest }) => rest),
    });
  }

  if (method === "resources/read") {
    const uri = typeof body?.params === "object" && body?.params
      ? (body.params as { uri?: unknown }).uri
      : undefined;
    const match = UI_RESOURCES.find((r) => r.uri === uri);
    if (!match) return rpcErrorPayload(id, -32602, `Unknown resource: ${String(uri ?? "missing")}`);
    return rpcPayload(id, {
      contents: [{
        uri: match.uri,
        mimeType: match.mimeType,
        text: match.text,
        _meta: match._meta,
      }],
    });
  }

  if (method === "tools/call") {
    const requestedName = body?.params?.name;
    const name = normalizeToolName(requestedName);
    const args = normalizeToolArgs(body?.params?.arguments ?? {});
    const tool = tools.find((item) => item.name === name);
    if (!tool) return rpcErrorPayload(id, -32602, `Unknown tool: ${String(requestedName ?? "missing")}`);
    const result = await dispatchTool(name, args, request);
    return rpcPayload(id, result);
  }

  return rpcErrorPayload(id, -32601, "Method not found");
}

async function handleRpc(body: JsonRpcRequest, request: Request) {
  const payload = await handleRpcPayload(body, request);
  if (!payload) {
    return new NextResponse(null, {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "MCP-Protocol-Version": "2024-11-05",
      },
    });
  }
  return rpcResponse(payload);
}

export async function GET(request: Request) {
  if (!hasValidToken(request)) return authChallenge(request);
  // Streamable HTTP clients probe GET with Accept: text/event-stream to open a
  // server->client stream. We only answer via POST, so reply 405 as the spec
  // requires instead of a JSON body the client would try to parse as SSE.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  return withMcpHeaders(NextResponse.json({
    name: "Saad Studio Smart CLI",
    description: "MCP-compatible endpoint for Saad Studio creative briefs.",
    tools: tools.map(({ name, description }) => ({ name, description })),
  }));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!hasValidToken(request)) return authChallenge(request);

  if (Array.isArray(body)) {
    const results = (await Promise.all(
      body.map((item) => handleRpcPayload(item, request)),
    )).filter((item): item is JsonRpcPayload => Boolean(item));
    return withMcpHeaders(NextResponse.json(results));
  }

  return handleRpc(body, request);
}
