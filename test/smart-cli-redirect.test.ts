import { describe, expect, it } from "vitest";

import { isAllowedRedirectUri, parseAllowedRedirectUri } from "@/lib/smart-cli-redirect";

describe("smart-cli redirect URI policy", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback", // Claude web / desktop
    "http://localhost:54321/callback", // Claude Code
    "http://localhost:7777/oauth/callback", // Gemini CLI
    "http://127.0.0.1:1455/callback", // Codex CLI (RFC 8252 loopback IP)
    "http://[::1]:8080/callback",
    "cursor://anysphere.cursor-retrieval/oauth/user-saad-studio/callback", // Cursor
  ])("accepts %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://evil.example/callback",
    "http://localhost.evil.example/callback",
    "https://user:pass@claude.ai/callback",
    "vscode://something/callback",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("rejects %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it("returns null for missing input", () => {
    expect(parseAllowedRedirectUri(undefined)).toBeNull();
    expect(parseAllowedRedirectUri(null)).toBeNull();
  });
});
