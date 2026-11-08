import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { POST as chatgptPost } from "@/app/api/smart-cli/chatgpt/mcp/route";
import { POST as defaultPost } from "@/app/api/smart-cli/mcp/route";
import { generatePanelToken } from "@/lib/panel-auth";
import {
  STUDIO_WIDGET_URI,
  adaptResultForChatGpt,
  buildStudioOutput,
  linkToolsToStudioWidget,
} from "@/lib/smart-cli-chatgpt";
import { STUDIO_WIDGET_HTML } from "@/lib/smart-cli-studio-widget";

const token = generatePanelToken("user_test_chatgpt");

function rpc(handler: (request: Request) => Promise<Response>, path: string, method: string, params?: unknown, auth = true) {
  return handler(
    new Request(`https://0.0.0.0:3000${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "saadstudio.app",
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

const callDefault = (method: string, params?: unknown) => rpc(defaultPost, "/api/smart-cli/mcp", method, params).then((r) => r.json());
const callChatGpt = (method: string, params?: unknown) => rpc(chatgptPost, "/api/smart-cli/chatgpt/mcp", method, params).then((r) => r.json());

type ToolEntry = { name: string; _meta?: Record<string, unknown> };

describe("default connector (Claude and others) is unchanged", () => {
  it("never links a widget and has no open_studio tool", async () => {
    const { result } = await callDefault("tools/list");
    const list = result.tools as ToolEntry[];
    expect(list.length).toBeGreaterThan(15);
    expect(list.some((tool) => tool.name === "open_studio")).toBe(false);
    expect(list.filter((tool) => tool._meta)).toEqual([]);
  });

  it("does not expose the studio panel resource", async () => {
    const read = await callDefault("resources/read", { uri: STUDIO_WIDGET_URI });
    expect(read.error?.code).toBe(-32602);
    const { result } = await callDefault("resources/list");
    expect(JSON.stringify(result)).not.toContain("studio-v1");
  });

  it("rejects open_studio", async () => {
    const res = await callDefault("tools/call", { name: "open_studio", arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });

  it("points the 401 challenge at the default metadata document", async () => {
    const res = await rpc(defaultPost, "/api/smart-cli/mcp", "tools/list", undefined, false);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('/.well-known/oauth-protected-resource"');
  });
});

describe("ChatGPT connector", () => {
  it("adds open_studio and links the render tools to the panel", async () => {
    const { result } = await callChatGpt("tools/list");
    const list = result.tools as ToolEntry[];
    const byName = Object.fromEntries(list.map((tool) => [tool.name, tool]));

    expect(list[0].name).toBe("open_studio");
    for (const name of ["open_studio", "generate_image", "generate_video", "generate_storyboard"]) {
      const meta = byName[name]._meta as { ui: { resourceUri: string } };
      expect(meta.ui.resourceUri).toBe(STUDIO_WIDGET_URI);
      expect(byName[name]._meta?.["openai/outputTemplate"]).toBe(STUDIO_WIDGET_URI);
    }
    // data tools the panel calls are widget-accessible but never render a card of their own
    for (const name of ["quote_generation", "check_balance", "show_generations", "list_models"]) {
      expect(byName[name]._meta?.["openai/widgetAccessible"]).toBe(true);
      expect(JSON.stringify(byName[name]._meta)).not.toContain("resourceUri");
    }
    expect(byName.delete_generation._meta).toBeUndefined();
  });

  it("serves the panel HTML as an MCP App resource", async () => {
    const { result } = await callChatGpt("resources/read", { uri: STUDIO_WIDGET_URI });
    const content = result.contents[0];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("Saad Studio");
    expect(content._meta.ui.csp.resourceDomains).toContain("https://saadstudio.app");
  });

  it("open_studio returns dashboard data with prefill", async () => {
    const { result } = await callChatGpt("tools/call", { name: "open_studio", arguments: { kind: "video", prompt: "  a reed boat  " } });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.view).toBe("dashboard");
    expect(result.structuredContent.prefill).toEqual({ kind: "video", prompt: "a reed boat" });
    expect(result.structuredContent.models.length).toBeGreaterThan(5);
    expect(result.structuredContent.presets).toHaveLength(7);
  });

  it("advertises path-specific protected-resource metadata in the 401 challenge", async () => {
    const res = await rpc(chatgptPost, "/api/smart-cli/chatgpt/mcp", "tools/list", undefined, false);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/smart-cli/chatgpt/mcp");
  });

  it("still requires a valid token, whatever the query flag says", async () => {
    const res = await defaultPost(
      new Request("https://0.0.0.0:3000/api/smart-cli/mcp?client=chatgpt", {
        method: "POST",
        headers: { "content-type": "application/json", host: "saadstudio.app" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("linkToolsToStudioWidget", () => {
  it("does not mutate its input and does not duplicate open_studio", () => {
    const input = [{ name: "generate_image" }, { name: "delete_generation" }] as const;
    const once = linkToolsToStudioWidget(input);
    const twice = linkToolsToStudioWidget(once as unknown as Array<{ name: string }>);
    expect((input[0] as Record<string, unknown>)._meta).toBeUndefined();
    expect(once.map((tool) => tool.name)).toEqual(["open_studio", "generate_image", "delete_generation"]);
    expect(twice.filter((tool) => tool.name === "open_studio")).toHaveLength(1);
  });
});

describe("buildStudioOutput", () => {
  it("de-duplicates models and drops unknown kinds", () => {
    const out = buildStudioOutput(
      [
        { id: "a", kind: "image", label: "A" },
        { id: "a", kind: "image", label: "A again" },
        { id: "v", kind: "video", label: "V", badges: ["fast"] },
        { id: "z", kind: "audio", label: "Z" },
      ],
      { image: "a", video: "v" },
    ) as { models: Array<{ id: string }>; prefill?: unknown };
    expect(out.models.map((model) => model.id)).toEqual(["a", "v"]);
    expect(out.prefill).toBeUndefined();
  });
});

describe("preset thumbnails", () => {
  it("every workflow has its own image file in public/", () => {
    const out = buildStudioOutput([], { image: "a", video: "v" }) as { presets: Array<{ slug: string; thumb: string }> };
    expect(out.presets.length).toBeGreaterThan(0);
    for (const preset of out.presets) {
      expect(preset.thumb).toBe(`/images/chatgpt-panel/${preset.slug}.jpg`);
      expect(existsSync(path.join(process.cwd(), "public", preset.thumb))).toBe(true);
    }
  });
});

describe("adaptResultForChatGpt", () => {
  it("replaces generation text and drops inline base64 images", () => {
    const adapted = adaptResultForChatGpt("generate_image", {
      isError: false,
      content: [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "Show the user this link: https://saadstudio.app/preview/x" },
      ],
      structuredContent: { imageUrls: ["https://cdn.example.com/a.png"], modelLabel: "Nano Banana Pro" },
    });
    expect(adapted.content).toHaveLength(1);
    expect(adapted.content[0].text).toContain("Nano Banana Pro");
    expect(adapted.content[0].text).not.toContain("preview/x");
    expect(adapted.structuredContent?.imageUrls).toEqual(["https://cdn.example.com/a.png"]);
  });

  it("leaves errors untouched", () => {
    const failed = { isError: true, content: [{ type: "text", text: "nope" }] };
    expect(adaptResultForChatGpt("generate_image", failed)).toBe(failed);
  });

  it("lifts show_generations JSON into structuredContent and drops images", () => {
    const adapted = adaptResultForChatGpt("show_generations", {
      isError: false,
      content: [
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: JSON.stringify({ items: [{ kind: "image", url: "https://cdn.example.com/a.png" }], hasMore: false }) },
      ],
    });
    expect(adapted.content.every((block) => block.type === "text")).toBe(true);
    expect(adapted.structuredContent?.items).toHaveLength(1);
  });
});

describe("studio widget HTML", () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(STUDIO_WIDGET_HTML)?.[1] ?? "";

  it("is a single self-contained document", () => {
    expect(script.length).toBeGreaterThan(1000);
    expect(STUDIO_WIDGET_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(STUDIO_WIDGET_HTML).not.toMatch(/<link[^>]+href=/i);
  });

  it("never writes HTML from data (textContent / DOM only)", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  it("compiles", () => {
    expect(() => new Function(script)).not.toThrow();
  });
});
