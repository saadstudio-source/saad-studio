// Redirect URI policy for the Smart CLI OAuth flow (pure, client + server safe).
//
// Real MCP clients redirect back to:
//   - Claude web/desktop      https://claude.ai/api/mcp/auth_callback
//   - Claude Code / Gemini    http://localhost:<port>/callback
//   - Codex CLI               http://127.0.0.1:<port>/callback   (RFC 8252 loopback IP)
//   - Cursor                  cursor://anysphere.cursor-retrieval/oauth/.../callback
//
// Anything else (javascript:, data:, http to a non-loopback host, other custom
// schemes) is rejected so the authorize page can never be turned into an
// open redirect / script-injection vector.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ALLOWED_CUSTOM_SCHEMES = new Set(["cursor:"]);

export function parseAllowedRedirectUri(value: string | null | undefined): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;

  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return url;
  if (ALLOWED_CUSTOM_SCHEMES.has(url.protocol)) return url;
  return null;
}

export function isAllowedRedirectUri(value: string | null | undefined): boolean {
  return parseAllowedRedirectUri(value) !== null;
}
