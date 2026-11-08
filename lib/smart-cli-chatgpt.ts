// ChatGPT variant of the Saad Studio MCP connector.
//
// ChatGPT (OpenAI Apps SDK) can render an interactive widget inside the chat when a
// tool is linked to a `ui://` resource. The default connector URL
// (/api/smart-cli/mcp) deliberately never links widgets: doing so got the connector
// auto-rejected on Claude Web twice. So the widget lives behind a SEPARATE URL,
//
//     https://saadstudio.app/api/smart-cli/chatgpt/mcp
//
// which is the same server with `client=chatgpt` set. Claude / Codex / Gemini keep the
// plain URL and are unaffected. This module holds the pure pieces so they can be
// unit-tested: the extra tool, the tool→widget linking and the result adaptation.

import { SMART_CLI_CHATGPT_MCP_PATH } from "@/lib/smart-cli-origin";
import { SMART_CLI_PRESETS } from "@/lib/smart-cli-presets";

export const CHATGPT_MCP_PATH = SMART_CLI_CHATGPT_MCP_PATH;
export const CHATGPT_CLIENT_PARAM = "chatgpt";

// Bump the version in the URI when the widget HTML changes: ChatGPT caches by URI.
export const STUDIO_WIDGET_URI = "ui://saadstudio/studio-v1.html";
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

/** Tools that render the widget (the model calls them). */
export const RENDER_TOOL_NAMES = ["open_studio", "generate_image", "generate_storyboard", "generate_video"] as const;
/** Data tools the widget calls itself; they must not render a card of their own. */
export const WIDGET_CALLABLE_TOOL_NAMES = ["quote_generation", "check_balance", "show_generations", "list_models"] as const;

const WIDGET_CSP_RESOURCE_DOMAINS = [
  "https://saadstudio.app",
  "https://f003.backblazeb2.com",
  "https://*.backblazeb2.com",
  "https://*.r2.dev",
  "https://*.r2.cloudflarestorage.com",
];

export const STUDIO_RESOURCE = {
  uri: STUDIO_WIDGET_URI,
  name: "Saad Studio panel",
  description: "Interactive Saad Studio panel: prompt box, models, live credit quote, results and workflows.",
  mimeType: WIDGET_MIME_TYPE,
  _meta: {
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [] as string[], resourceDomains: WIDGET_CSP_RESOURCE_DOMAINS },
    },
    "openai/widgetPrefersBorder": false,
    "openai/widgetDescription":
      "Saad Studio creative panel. Shows generated images/videos and lets the user create more with a prompt box, model, aspect ratio and a live credit quote.",
    // Legacy keys, still needed for openExternal (download / open preview) to saadstudio.app.
    "openai/widgetCSP": {
      connect_domains: [] as string[],
      resource_domains: WIDGET_CSP_RESOURCE_DOMAINS,
      redirect_domains: ["https://saadstudio.app"],
    },
  },
} as const;

export const OPEN_STUDIO_TOOL = {
  name: "open_studio",
  title: "Open Saad Studio",
  annotations: { title: "Open Saad Studio", readOnlyHint: true, openWorldHint: false },
  description:
    "Open the Saad Studio panel inside the chat: a prompt box with image/video toggle, model and aspect pickers, live credit cost, the user's recent creations and one-click workflows. Use when the user wants to browse, create or choose options visually, or says 'open Saad Studio'. Optionally pre-fill the prompt.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["image", "video"], description: "Which tab to start on. Default image." },
      prompt: { type: "string", description: "Optional text to pre-fill in the prompt box." },
    },
    additionalProperties: false,
  },
} as const;

type ToolLike = { name: string; [key: string]: unknown };

function widgetMeta(name: string): Record<string, unknown> | null {
  if ((RENDER_TOOL_NAMES as readonly string[]).includes(name)) {
    return {
      ui: { resourceUri: STUDIO_WIDGET_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": STUDIO_WIDGET_URI,
      "openai/widgetAccessible": true,
    };
  }
  if ((WIDGET_CALLABLE_TOOL_NAMES as readonly string[]).includes(name)) {
    return { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true };
  }
  return null;
}

/** Adds the widget `_meta` to the tools that need it; every other tool is returned untouched. */
export function linkToolsToStudioWidget<T extends ToolLike>(tools: readonly T[]): Array<T | (T & { _meta: Record<string, unknown> })> {
  const withOpen = tools.some((tool) => tool.name === OPEN_STUDIO_TOOL.name)
    ? [...tools]
    : [OPEN_STUDIO_TOOL as unknown as T, ...tools];
  return withOpen.map((tool) => {
    const meta = widgetMeta(tool.name);
    return meta ? { ...tool, _meta: meta } : tool;
  });
}

// ── dashboard data ─────────────────────────────────────────────────────────

export interface StudioModelInfo {
  id: string;
  kind: string;
  label: string;
  badges?: readonly string[];
}

// One purpose-made image per workflow (generated with Saad Studio itself from the
// preset's own subject; Iraqi settings, no religious sites). Files: public/images/chatgpt-panel/<slug>.jpg
const PRESET_THUMBS: Record<string, string> = Object.fromEntries(
  SMART_CLI_PRESETS.map((preset) => [preset.slug, `/images/chatgpt-panel/${preset.slug}.jpg`]),
);

export function buildStudioOutput(
  models: readonly StudioModelInfo[],
  defaults: { image: string; video: string },
  prefill?: { kind?: unknown; prompt?: unknown },
): Record<string, unknown> {
  const seen = new Set<string>();
  const uniqueModels = models
    .filter((model) => (model.kind === "image" || model.kind === "video") && !seen.has(model.id) && seen.add(model.id))
    .map((model) => ({ id: model.id, kind: model.kind, label: model.label, badges: model.badges ?? [] }));

  const prompt = typeof prefill?.prompt === "string" ? prefill.prompt.trim().slice(0, 1000) : "";
  const kind = prefill?.kind === "video" ? "video" : "image";

  return {
    view: "dashboard",
    defaults,
    models: uniqueModels,
    presets: SMART_CLI_PRESETS.map((preset) => ({
      slug: preset.slug,
      title: preset.title,
      description: preset.description,
      prompt: preset.prompt,
      thumb: PRESET_THUMBS[preset.slug] ?? null,
    })),
    ...(prompt || kind === "video" ? { prefill: { kind, prompt } } : {}),
  };
}

// ── result adaptation ──────────────────────────────────────────────────────

type ContentBlock = { type: string; text?: string; [key: string]: unknown };
export type AdaptableResult = {
  content: ContentBlock[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
};

/**
 * Makes a tool result suit the in-chat card: no base64 image blocks (the card shows the
 * media), a short model-facing text (so the model does not also paste links), and
 * structuredContent for tools that only returned JSON text.
 */
export function adaptResultForChatGpt<T extends AdaptableResult>(name: string, result: T): T {
  if (result.isError) return result;

  if (name === "generate_image" || name === "generate_storyboard" || name === "generate_video") {
    const out = result.structuredContent ?? {};
    const images = Array.isArray(out.imageUrls) ? out.imageUrls.length : 0;
    const videos = Array.isArray(out.videoUrls) ? out.videoUrls.length : 0;
    const model = typeof out.modelLabel === "string" ? out.modelLabel : "Saad Studio";
    const text =
      name === "generate_video"
        ? videos
          ? `Done — video rendered with ${model}. The Saad Studio card shows it with download. Do not repeat the file URL.`
          : `The video job was accepted by ${model} and may still be processing. Use get_job_status with the generationId to check.`
        : images
          ? `Done — ${images} image${images > 1 ? "s" : ""} created with ${model}. The Saad Studio card shows them with download. Do not repeat the file URLs. To reuse one, use structuredContent.imageUrl.`
          : `The image job was accepted by ${model} but no image URL is available yet.`;
    return { ...result, content: [{ type: "text", text }] };
  }

  if (name === "show_generations") {
    const blocks = result.content.filter((block) => block.type === "text");
    const last = blocks[blocks.length - 1];
    let structured = result.structuredContent;
    if (!structured && last?.text) {
      try {
        const parsed = JSON.parse(last.text) as Record<string, unknown>;
        structured = { items: Array.isArray(parsed.items) ? parsed.items : [], hasMore: parsed.hasMore === true };
      } catch {
        structured = undefined;
      }
    }
    return { ...result, content: blocks, ...(structured ? { structuredContent: structured } : {}) };
  }

  return result;
}
