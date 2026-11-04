import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/is-admin";
import { loadWaveSpeedMcpSync, reviewWaveSpeedModel, syncWaveSpeedCatalog, syncWaveSpeedMcpTools } from "@/lib/wavespeed-mcp-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await loadWaveSpeedMcpSync());
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; modelId?: string };
  try {
    if (body.action === "sync") return NextResponse.json(await syncWaveSpeedCatalog("admin_operator"));
    if (body.action === "mcp_discover") return NextResponse.json(await syncWaveSpeedMcpTools("admin_operator"));
    if (body.action === "approve" || body.action === "reject") {
      if (!body.modelId) return NextResponse.json({ error: "modelId is required" }, { status: 400 });
      return NextResponse.json(await reviewWaveSpeedModel(body.modelId, body.action === "approve" ? "approved" : "rejected", "admin_operator"));
    }
    return NextResponse.json({ error: "action must be sync, approve, or reject" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WaveSpeed MCP operation failed" }, { status: 500 });
  }
}
