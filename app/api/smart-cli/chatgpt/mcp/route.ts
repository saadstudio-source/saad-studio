import { CHATGPT_CLIENT_PARAM } from "@/lib/smart-cli-chatgpt";

import { GET as baseGET, POST as basePOST } from "../../mcp/route";

// ChatGPT connector endpoint: https://saadstudio.app/api/smart-cli/chatgpt/mcp
//
// Same MCP server as /api/smart-cli/mcp, but flagged `client=chatgpt` so it also serves
// the in-chat Saad Studio panel (OpenAI Apps SDK widget). Keeping it on its own URL is
// what guarantees Claude and other agents never receive widget metadata.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function asChatGptRequest(request: Request, body?: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("client", CHATGPT_CLIENT_PARAM);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
}

export async function GET(request: Request) {
  return baseGET(asChatGptRequest(request));
}

export async function POST(request: Request) {
  const body = await request.text();
  return basePOST(asChatGptRequest(request, body));
}
