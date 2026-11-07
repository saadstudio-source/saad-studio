import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/smart-cli-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);

  return NextResponse.json({
    resource: `${origin}/api/smart-cli/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["smart_cli.generate", "smart_cli.read"],
    resource_name: "Saad Studio Smart CLI",
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
