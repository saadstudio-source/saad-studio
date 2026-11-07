import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CORE_TOOL_NAMES as PRESET_CORE_TOOLS, SMART_CLI_PRESETS } from "@/lib/smart-cli-presets";
import {
  EXTRA_TOOLS,
  EXTRA_TOOL_NAMES,
  callExtraTool,
  type PanelFetcher,
} from "@/lib/smart-cli-extra-tools";

type Call = { path: string; method: string; body: unknown };

function mockPanel(responses: Record<string, { ok?: boolean; status?: number; data?: unknown }> = {}) {
  const calls: Call[] = [];
  const panel: PanelFetcher = async (path, init) => {
    const method = String(init?.method ?? "GET");
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${path.split("?")[0]}`;
    const hit = responses[key] ?? { ok: true, status: 200, data: {} };
    return { ok: hit.ok ?? true, status: hit.status ?? 200, data: hit.data ?? {} };
  };
  return { panel, calls };
}

const CORE_TOOL_NAMES = ["generate_image", "generate_storyboard", "generate_video", "show_generations", "list_models"];

function text(result: Awaited<ReturnType<typeof callExtraTool>>) {
  return JSON.parse(result!.content[0].text) as Record<string, unknown>;
}

describe("server, page and presets stay in sync", () => {
  const allNames = [...CORE_TOOL_NAMES, ...EXTRA_TOOLS.map((tool) => tool.name)];

  it("the preset core list matches the core tools used in this test", () => {
    expect([...PRESET_CORE_TOOLS].sort()).toEqual([...CORE_TOOL_NAMES].sort());
  });

  it("the MCP route registers exactly the core tools it implements", () => {
    const route = readFileSync(join(process.cwd(), "app/api/smart-cli/mcp/route.ts"), "utf8");
    for (const name of CORE_TOOL_NAMES) expect(route, name).toContain(`name: "${name}"`);
    for (const name of CORE_TOOL_NAMES) expect(route, `dispatch ${name}`).toContain(`case "${name}"`);
  });

  it("every tool is listed on the /smart-cli page", () => {
    const hub = readFileSync(join(process.cwd(), "components/smart-cli/SmartCliHub.tsx"), "utf8");
    for (const name of allNames) expect(hub, name).toContain(`title: "${name}"`);
  });

  it("presets only reference tools that exist", () => {
    for (const preset of SMART_CLI_PRESETS) {
      for (const tool of preset.tools) expect(allNames, `${preset.slug} → ${tool}`).toContain(tool);
    }
  });
});

describe("tool definitions", () => {
  it("have unique names that do not clash with the core tools", () => {
    const names = EXTRA_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(CORE_TOOL_NAMES).not.toContain(name);
    expect(EXTRA_TOOL_NAMES.size).toBe(names.length);
  });

  it("every tool has a title, annotations and an object schema whose required keys exist", () => {
    for (const tool of EXTRA_TOOLS) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations.title, tool.name).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint, tool.name).toBe("boolean");
      expect(tool.inputSchema.type).toBe("object");
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      const required = ("required" in tool.inputSchema ? tool.inputSchema.required : []) as readonly string[];
      for (const key of required) expect(Object.keys(properties), `${tool.name}.${key}`).toContain(key);
    }
  });

  it("classifies spend / delete / read tools correctly", () => {
    const byName = Object.fromEntries(EXTRA_TOOLS.map((tool) => [tool.name, tool.annotations]));
    for (const name of ["generate_music", "text_to_speech", "post_produce_video"]) {
      expect(byName[name].readOnlyHint).toBe(false);
      expect((byName[name] as { destructiveHint?: boolean }).destructiveHint).toBe(false);
    }
    expect(byName.delete_generation.readOnlyHint).toBe(false);
    expect((byName.delete_generation as { destructiveHint?: boolean }).destructiveHint).toBe(true);
    for (const name of ["check_balance", "get_account", "quote_generation", "get_job_status", "get_post_production_status", "list_dubbing_languages", "list_translation_languages", "list_caption_presets"]) {
      expect(byName[name].readOnlyHint, name).toBe(true);
    }
  });

  it("read-only tools only ever issue GET (or the read-only quote POST) and never charge", async () => {
    const readOnly = EXTRA_TOOLS.filter((tool) => tool.annotations.readOnlyHint);
    const minimalArgs: Record<string, Record<string, unknown>> = {
      quote_generation: { kind: "image" },
      get_job_status: { id: "clx1234567890" },
      get_post_production_status: { projectId: "proj_123", generationId: "clx1234567890" },
    };
    for (const tool of readOnly) {
      const { panel, calls } = mockPanel();
      await callExtraTool(tool.name, minimalArgs[tool.name] ?? {}, panel);
      expect(calls.length, tool.name).toBe(1);
      const allowed = tool.name === "quote_generation" ? ["POST"] : ["GET"];
      expect(allowed, `${tool.name} used ${calls[0].method}`).toContain(calls[0].method);
      if (tool.name === "quote_generation") expect(calls[0].path).toBe("/api/panel/credits/quote");
    }
  });

  it("returns null for tools it does not own", async () => {
    const { panel, calls } = mockPanel();
    expect(await callExtraTool("generate_image", {}, panel)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("account and pricing", () => {
  it("check_balance reads the credits endpoint", async () => {
    const { panel, calls } = mockPanel({ "GET /api/panel/credits": { data: { creditBalance: 321 } } });
    const result = await callExtraTool("check_balance", {}, panel);
    expect(calls[0]).toMatchObject({ path: "/api/panel/credits", method: "GET" });
    expect(text(result).creditBalance).toBe(321);
  });

  it("get_account hides email and Stripe ids", async () => {
    const { panel } = mockPanel({
      "GET /api/panel/me": {
        data: {
          userId: "u1",
          name: "Saad",
          email: "private@example.com",
          creditBalance: 5,
          role: "ADMIN",
          subscription: { active: true, planId: "plus", billingInterval: "month", stripePriceId: "price_secret", renewsAt: "2026-12-01" },
        },
      },
    });
    const out = text(await callExtraTool("get_account", {}, panel));
    expect(JSON.stringify(out)).not.toMatch(/private@example|price_secret|ADMIN|u1/);
    expect(out).toMatchObject({ name: "Saad", creditBalance: 5, subscription: { active: true, planId: "plus" } });
  });

  it("quote_generation uses per-kind defaults and never sends a charge flag", async () => {
    const image = mockPanel({ "POST /api/panel/credits/quote": { data: { credits: 4, creditBalance: 10, balanceAfter: 6 } } });
    const imageOut = text(await callExtraTool("quote_generation", { kind: "image" }, image.panel));
    expect(image.calls[0].body).toMatchObject({ kind: "image", modelId: "nano-banana-pro", resolution: "1K", numImages: 1 });
    expect(imageOut).toMatchObject({ credits: 4, charged: false, affordable: true });

    const video = mockPanel({ "POST /api/panel/credits/quote": { data: { credits: 50, creditBalance: 10, balanceAfter: -40 } } });
    const videoOut = text(await callExtraTool("quote_generation", { kind: "video", enableAudio: true }, video.panel));
    expect(video.calls[0].body).toMatchObject({ kind: "video", modelId: "kling-3.0/video", resolution: "1080p", duration: 5, enableAudio: true });
    expect(videoOut).toMatchObject({ affordable: false });
  });

  it("quote_generation rejects an unknown kind without calling the server", async () => {
    const { panel, calls } = mockPanel();
    const result = await callExtraTool("quote_generation", { kind: "audio" }, panel);
    expect(result!.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("job status and deletion", () => {
  it("get_job_status validates the id and encodes it", async () => {
    const bad = mockPanel();
    expect((await callExtraTool("get_job_status", { id: "../../etc" }, bad.panel))!.isError).toBe(true);
    expect(bad.calls).toHaveLength(0);

    const good = mockPanel({
      "GET /api/panel/jobs/clx1234567890": {
        data: { id: "clx1234567890", status: "succeeded", progress: 100, result: { kind: "video", url: "https://cdn.example/v.mp4", model: "kling" } },
      },
    });
    const out = text(await callExtraTool("get_job_status", { id: "clx1234567890" }, good.panel));
    expect(out).toMatchObject({ status: "succeeded", result: { url: "https://cdn.example/v.mp4" } });
  });

  it("delete_generation only deletes a valid id with DELETE", async () => {
    const bad = mockPanel();
    expect((await callExtraTool("delete_generation", { id: "x" }, bad.panel))!.isError).toBe(true);
    expect(bad.calls).toHaveLength(0);

    const good = mockPanel({ "DELETE /api/panel/generations/clx1234567890": { data: { deleted: true } } });
    const out = text(await callExtraTool("delete_generation", { id: "clx1234567890" }, good.panel));
    expect(good.calls[0]).toMatchObject({ method: "DELETE", path: "/api/panel/generations/clx1234567890" });
    expect(out).toMatchObject({ deleted: true });
  });
});

describe("audio tools", () => {
  it("generate_music: clip model ignores duration, wav only on pro", async () => {
    const clip = mockPanel({ "POST /api/panel/generate/music": { data: { audioUrl: "https://cdn.example/a.mp3", generationId: "g1", result: { durationSec: 30 } } } });
    await callExtraTool("generate_music", { prompt: "calm oud", duration: 200, output_format: "wav" }, clip.panel);
    expect(clip.calls[0].body).toMatchObject({ model: "google/lyria-3-clip/music", output_format: "mp3" });
    expect(clip.calls[0].body).not.toHaveProperty("duration");

    const pro = mockPanel({ "POST /api/panel/generate/music": { data: { audioUrl: "https://cdn.example/a.wav", generationId: "g2" } } });
    const out = text(await callExtraTool("generate_music", { prompt: "epic", model: "google/lyria-3-pro/music", duration: 90, output_format: "wav", force_instrumental: true }, pro.panel));
    expect(pro.calls[0].body).toMatchObject({ model: "google/lyria-3-pro/music", duration: 90, output_format: "wav", force_instrumental: true });
    expect(out).toMatchObject({ status: "succeeded", audioUrl: "https://cdn.example/a.wav" });
  });

  it("audio tools return a branded preview link only when an origin is supplied", async () => {
    process.env.PANEL_TOKEN_SECRET ??= "test-secret-for-previews";
    const music = { "POST /api/panel/generate/music": { data: { audioUrl: "https://cdn.example/a.mp3", generationId: "g1", result: { durationSec: 30 } } } };

    const withCtx = mockPanel(music);
    const a = text(await callExtraTool("generate_music", { prompt: "calm oud" }, withCtx.panel, { previewOrigin: "https://saadstudio.app" }));
    expect(String(a.previewUrl)).toMatch(/^https:\/\/saadstudio\.app\/preview\/.+\..+/);
    expect(String(a.presentation)).toContain(String(a.previewUrl));

    const without = mockPanel(music);
    const b = text(await callExtraTool("generate_music", { prompt: "calm oud" }, without.panel));
    expect(b.previewUrl ?? null).toBeNull();

    const tts = mockPanel({ "POST /api/panel/generate/tts": { data: { audioUrl: "https://cdn.example/t.mp3", creditsUsed: 1, characterCount: 5, balanceAfter: 9 } } });
    const c = text(await callExtraTool("text_to_speech", { text: "hello" }, tts.panel, { previewOrigin: "https://saadstudio.app" }));
    expect(String(c.previewUrl)).toContain("/preview/");
  });

  it("generate_music requires a prompt", async () => {
    const { panel, calls } = mockPanel();
    expect((await callExtraTool("generate_music", { prompt: "  " }, panel))!.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("text_to_speech clamps speed, falls back to a known voice and caps length", async () => {
    const { panel, calls } = mockPanel({ "POST /api/panel/generate/tts": { data: { audioUrl: "https://cdn.example/t.mp3", creditsUsed: 2, characterCount: 5, balanceAfter: 8 } } });
    const out = text(await callExtraTool("text_to_speech", { text: "hello", voiceId: "nobody", speed: 9 }, panel));
    expect(calls[0].body).toEqual({ text: "hello", voiceId: "rachel", speed: 2 });
    expect(out).toMatchObject({ creditsUsed: 2, balanceAfter: 8 });

    const long = mockPanel();
    expect((await callExtraTool("text_to_speech", { text: "x".repeat(4001) }, long.panel))!.isError).toBe(true);
    expect(long.calls).toHaveLength(0);
  });
});

describe("post-production and uploads", () => {
  it("post_produce_video requires an http(s) source and a dubbing language", async () => {
    const a = mockPanel();
    expect((await callExtraTool("post_produce_video", { tool: "captions", sourceUrl: "file:///etc/passwd" }, a.panel))!.isError).toBe(true);
    expect((await callExtraTool("post_produce_video", { tool: "nope", sourceUrl: "https://x.test/v.mp4" }, a.panel))!.isError).toBe(true);
    expect((await callExtraTool("post_produce_video", { tool: "dubbing", sourceUrl: "https://x.test/v.mp4" }, a.panel))!.isError).toBe(true);
    expect(a.calls).toHaveLength(0);
  });

  it("post_produce_video forwards durationSec as options.duration for billing", async () => {
    const { panel, calls } = mockPanel({ "POST /api/panel/reap/start": { data: { projectId: "p1", generationId: "g1", creditsCharged: 3, status: "queued" } } });
    const out = text(
      await callExtraTool("post_produce_video", { tool: "dubbing", sourceUrl: "https://x.test/v.mp4", durationSec: 45, options: { translationLanguage: "ar" } }, panel),
    );
    expect(calls[0].body).toMatchObject({ tool: "dubbing", sourceUrl: "https://x.test/v.mp4", options: { duration: 45, translationLanguage: "ar" } });
    expect(out).toMatchObject({ projectId: "p1", generationId: "g1", creditsCharged: 3 });
  });

  it("get_post_production_status builds the query safely", async () => {
    const { panel, calls } = mockPanel({ "GET /api/panel/reap/status": { data: { status: "completed", url: "https://cdn.example/o.mp4", urls: ["https://cdn.example/o.mp4"] } } });
    const out = text(await callExtraTool("get_post_production_status", { projectId: "a b&c", generationId: "clx1234567890" }, panel));
    expect(calls[0].path).toBe("/api/panel/reap/status?projectId=a+b%26c&generationId=clx1234567890");
    expect(out).toMatchObject({ status: "completed", url: "https://cdn.example/o.mp4" });
  });

  it("get_post_production_status requires a well-formed generationId (ownership proof)", async () => {
    const { panel, calls } = mockPanel();
    expect((await callExtraTool("get_post_production_status", { projectId: "proj_123" }, panel))!.isError).toBe(true);
    expect((await callExtraTool("get_post_production_status", { projectId: "proj_123", generationId: "../x" }, panel))!.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("create_upload_url only allows media content types", async () => {
    const bad = mockPanel();
    expect((await callExtraTool("create_upload_url", { fileName: "a.exe", contentType: "application/x-msdownload" }, bad.panel))!.isError).toBe(true);
    expect(bad.calls).toHaveLength(0);

    const good = mockPanel({ "POST /api/panel/upload-url": { data: { signedUrl: "https://r2.example/put?sig=1", publicUrl: "https://cdn.example/f.mp4", path: "u/f.mp4", bucket: "videos" } } });
    const out = text(await callExtraTool("create_upload_url", { fileName: "f.mp4", contentType: "video/mp4" }, good.panel));
    expect(out.signedUrl).toBe("https://r2.example/put?sig=1");
    expect(String(out.howTo)).toContain("Content-Type: video/mp4");
    // internal storage fields are not leaked
    expect(JSON.stringify(out)).not.toContain("bucket");
  });
});

describe("error mapping", () => {
  it("maps 402 to a credits message with amounts", async () => {
    const { panel } = mockPanel({ "POST /api/panel/generate/tts": { ok: false, status: 402, data: { error: "Insufficient credits.", requiredCredits: 9 } } });
    const result = await callExtraTool("text_to_speech", { text: "hi" }, panel);
    expect(result!.isError).toBe(true);
    expect(text(result)).toMatchObject({ httpStatus: 402, requiredCredits: 9 });
  });

  it("maps 401 to a reconnect hint and 429 to a retry hint", async () => {
    const a = mockPanel({ "GET /api/panel/credits": { ok: false, status: 401, data: {} } });
    expect(String(text(await callExtraTool("check_balance", {}, a.panel)).error)).toMatch(/Reconnect/);
    const b = mockPanel({ "GET /api/panel/credits": { ok: false, status: 429, data: {} } });
    expect(String(text(await callExtraTool("check_balance", {}, b.panel)).error)).toMatch(/Too many requests/);
  });

  it("passes content-policy blocks through", async () => {
    const { panel } = mockPanel({ "POST /api/panel/generate/music": { ok: false, status: 403, data: { error: "Blocked", blocked: true, reason: "policy" } } });
    expect(text(await callExtraTool("generate_music", { prompt: "x" }, panel))).toMatchObject({ httpStatus: 403, blocked: true, reason: "policy" });
  });
});
