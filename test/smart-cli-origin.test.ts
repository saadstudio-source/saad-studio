import { describe, expect, it } from "vitest";

import { getPublicOrigin, SMART_CLI_CANONICAL_ORIGIN } from "@/lib/smart-cli-origin";

function req(headers: Record<string, string>, url = "https://0.0.0.0:3000/api/smart-cli/mcp") {
  return new Request(url, { headers });
}

describe("getPublicOrigin", () => {
  it("ignores the internal bind address and uses the Host header", () => {
    expect(getPublicOrigin(req({ host: "saadstudio.app" }))).toBe("https://saadstudio.app");
  });

  it("prefers x-forwarded-host and normalizes www to the apex", () => {
    expect(getPublicOrigin(req({ "x-forwarded-host": "www.saadstudio.app", host: "0.0.0.0:3000" }))).toBe(
      "https://saadstudio.app",
    );
  });

  it("falls back to the canonical origin when only internal hosts are visible", () => {
    expect(getPublicOrigin(req({ host: "0.0.0.0:3000" }))).toBe(SMART_CLI_CANONICAL_ORIGIN);
    expect(getPublicOrigin(req({ host: "localhost:3000" }))).toBe(SMART_CLI_CANONICAL_ORIGIN);
  });

  it("rejects spoofed hosts and falls back to the canonical origin", () => {
    expect(getPublicOrigin(req({ host: "evil.example" }))).toBe(SMART_CLI_CANONICAL_ORIGIN);
    expect(getPublicOrigin(req({ "x-forwarded-host": "evil.example", host: "attacker.test" }))).toBe(
      SMART_CLI_CANONICAL_ORIGIN,
    );
    expect(getPublicOrigin(req({ host: "saadstudio.app.evil.example" }))).toBe(SMART_CLI_CANONICAL_ORIGIN);
  });

  it("never emits 0.0.0.0", () => {
    expect(getPublicOrigin(req({}))).not.toContain("0.0.0.0");
  });
});
