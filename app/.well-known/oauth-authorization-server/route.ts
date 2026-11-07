import { NextRequest, NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/smart-cli-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);

  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/smart-cli/authorize`,
    token_endpoint: `${origin}/api/smart-cli/oauth/token`,
    registration_endpoint: `${origin}/api/smart-cli/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["smart_cli.generate", "smart_cli.read"],
    resource_parameter_supported: true,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
