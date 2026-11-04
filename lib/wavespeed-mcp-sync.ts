import prismadb from "@/lib/prismadb";

export const WAVESPEED_MCP_SYNC_KEY = "wavespeed_mcp_catalog_sync";

export type WaveSpeedCatalogModel = {
  model_id: string;
  name?: string;
  base_price?: number;
  description?: string;
  type?: string;
  api_schema?: unknown;
};

export type WaveSpeedSyncProposal = {
  modelId: string;
  status: "proposed" | "approved" | "rejected";
  firstSeenAt: string;
  lastSeenAt: string;
  model: WaveSpeedCatalogModel;
};

export type WaveSpeedMcpSyncState = {
  source: "wavespeed-model-catalog";
  mcpUrl: "https://api.wavespeed.ai/mcp";
  syncedAt: string | null;
  proposals: WaveSpeedSyncProposal[];
  audit: Array<{ id: string; action: string; modelId?: string; at: string; operatorId: string }>;
  mcpTools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
};

const emptyState = (): WaveSpeedMcpSyncState => ({ source: "wavespeed-model-catalog", mcpUrl: "https://api.wavespeed.ai/mcp", syncedAt: null, proposals: [], audit: [], mcpTools: [] });

export async function loadWaveSpeedMcpSync(): Promise<WaveSpeedMcpSyncState> {
  const row = await prismadb.platformConfig.findUnique({ where: { key: WAVESPEED_MCP_SYNC_KEY } });
  if (!row?.value) return emptyState();
  try {
    const parsed = JSON.parse(row.value) as Partial<WaveSpeedMcpSyncState>;
    return { ...emptyState(), ...parsed, proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [], audit: Array.isArray(parsed.audit) ? parsed.audit : [], mcpTools: Array.isArray(parsed.mcpTools) ? parsed.mcpTools : [] };
  } catch { return emptyState(); }
}

type McpEnvelope = { jsonrpc: "2.0"; id?: number; result?: any; error?: { code: number; message: string; data?: unknown } };

/** Real Streamable HTTP MCP JSON-RPC call. Never calls run_model from this module. */
export async function callWaveSpeedMcp(method: string, params: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<McpEnvelope> {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error("WAVESPEED_API_KEY is not configured");
  const response = await fetchImpl("https://api.wavespeed.ai/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Method": method,
      "Mcp-Name": "saadstudio-wavespeed-control-plane",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`WaveSpeed MCP ${method} failed (${response.status})`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error(`WaveSpeed MCP ${method} returned no JSON-RPC event`);
    return JSON.parse(dataLine.slice(5).trim()) as McpEnvelope;
  }
  return await response.json() as McpEnvelope;
}

export async function discoverWaveSpeedMcp(fetchImpl: typeof fetch = fetch) {
  const initialized = await callWaveSpeedMcp("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: { tools: {} },
    clientInfo: { name: "saadstudio", version: "1.0.0" },
  }, fetchImpl);
  if (initialized.error) throw new Error(`WaveSpeed MCP initialize error: ${initialized.error.message}`);
  const listed = await callWaveSpeedMcp("tools/list", {}, fetchImpl);
  if (listed.error) throw new Error(`WaveSpeed MCP tools/list error: ${listed.error.message}`);
  const tools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
  return { protocolVersion: initialized.result?.protocolVersion ?? null, tools };
}

async function save(state: WaveSpeedMcpSyncState) {
  await prismadb.platformConfig.upsert({ where: { key: WAVESPEED_MCP_SYNC_KEY }, update: { value: JSON.stringify(state) }, create: { key: WAVESPEED_MCP_SYNC_KEY, value: JSON.stringify(state) } });
}

export async function syncWaveSpeedCatalog(operatorId: string): Promise<WaveSpeedMcpSyncState> {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error("WAVESPEED_API_KEY is not configured");
  const response = await fetch("https://api.wavespeed.ai/api/v3/models", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`WaveSpeed catalog sync failed (${response.status})`);
  const body = await response.json() as { data?: unknown };
  const models = Array.isArray(body.data) ? body.data.filter((item): item is WaveSpeedCatalogModel => Boolean(item && typeof item === "object" && typeof (item as { model_id?: unknown }).model_id === "string")) : [];
  const now = new Date().toISOString();
  const current = await loadWaveSpeedMcpSync();
  const byId = new Map(current.proposals.map((proposal) => [proposal.modelId, proposal]));
  for (const model of models) {
    const previous = byId.get(model.model_id);
    byId.set(model.model_id, { modelId: model.model_id, status: previous?.status ?? "proposed", firstSeenAt: previous?.firstSeenAt ?? now, lastSeenAt: now, model });
  }
  const next = { ...current, syncedAt: now, proposals: Array.from(byId.values()), audit: [{ id: `wavespeed_sync_${Date.now()}`, action: "catalog_sync", at: now, operatorId }, ...current.audit].slice(0, 200) };
  await save(next);
  return next;
}

export async function syncWaveSpeedMcpTools(operatorId: string): Promise<WaveSpeedMcpSyncState> {
  const discovered = await discoverWaveSpeedMcp();
  const current = await loadWaveSpeedMcpSync();
  const now = new Date().toISOString();
  const next = {
    ...current,
    mcpTools: discovered.tools.map((tool: any) => ({ name: String(tool.name), description: typeof tool.description === "string" ? tool.description : undefined, inputSchema: tool.inputSchema })),
    audit: [{ id: `wavespeed_mcp_${Date.now()}`, action: "mcp_tools_list", at: now, operatorId }, ...current.audit].slice(0, 200),
  };
  await save(next);
  return next;
}

export async function reviewWaveSpeedModel(modelId: string, status: "approved" | "rejected", operatorId: string) {
  const current = await loadWaveSpeedMcpSync();
  const proposal = current.proposals.find((item) => item.modelId === modelId);
  if (!proposal) throw new Error("WaveSpeed model proposal not found");
  const now = new Date().toISOString();
  const next = { ...current, proposals: current.proposals.map((item) => item.modelId === modelId ? { ...item, status } : item), audit: [{ id: `wavespeed_review_${Date.now()}`, action: status === "approved" ? "approve_model" : "reject_model", modelId, at: now, operatorId }, ...current.audit].slice(0, 200) };
  await save(next);
  return next;
}
