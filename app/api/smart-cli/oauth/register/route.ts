import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Absolute URLs so any DCR client (Claude Web, Claude Desktop, ChatGPT
// Apps SDK) can fetch the logo without resolving against its own host.
const ORIGIN = "https://saadstudio.app";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    client_name?: string;
    redirect_uris?: string[];
  };

  return NextResponse.json({
    client_id: `saad_studio_${crypto.randomUUID()}`,
    client_name: body.client_name ?? "Claude",
    // logo_uri + client_uri + tos_uri + policy_uri are RFC 7591 fields.
    // Claude Web reads logo_uri for the connector chip icon; without it
    // the chip falls back to auto-generated "SA" initials on a neutral
    // tile, which is why the new brand mark never appeared there.
    logo_uri: `${ORIGIN}/apple-touch-icon.png`,
    client_uri: `${ORIGIN}/smart-cli`,
    tos_uri: `${ORIGIN}/terms`,
    policy_uri: `${ORIGIN}/privacy`,
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "smart_cli.generate smart_cli.read",
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
