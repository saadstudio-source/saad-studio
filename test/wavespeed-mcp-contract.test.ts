import { describe, expect, it, vi } from "vitest";
import { callWaveSpeedMcp, discoverWaveSpeedMcp } from "@/lib/wavespeed-mcp-sync";

describe("WaveSpeed MCP JSON-RPC control plane", () => {
  it("performs initialize and tools/list over Streamable HTTP without calling a model", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-only-key");
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.method);
      const result = body.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} } }
        : { tools: [{ name: "list_models", inputSchema: { type: "object" } }, { name: "get_model_schema" }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await discoverWaveSpeedMcp(fetchMock as typeof fetch);
    expect(calls).toEqual(["initialize", "tools/list"]);
    expect(result.protocolVersion).toBe("2025-11-25");
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["list_models", "get_model_schema"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses an SSE JSON-RPC response and exposes protocol errors", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-only-key");
    const fetchMock = vi.fn(async () => new Response("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    await expect(callWaveSpeedMcp("tools/list", {}, fetchMock as typeof fetch)).resolves.toMatchObject({ result: { ok: true } });
  });
});
