import { describe, expect, it } from "vitest";

import { buildSignInRedirectUrl } from "@/lib/auth-redirect";

describe("buildSignInRedirectUrl", () => {
  it("points at the public sign-in page and returns to the requested URL", () => {
    expect(buildSignInRedirectUrl("https://saadstudio.app", "/shots", "")).toBe(
      "https://saadstudio.app/sign-in?redirect_url=https%3A%2F%2Fsaadstudio.app%2Fshots",
    );
  });

  it("keeps the query string and encodes it", () => {
    const url = new URL(buildSignInRedirectUrl("https://saadstudio.app/", "/studio", "?tab=a&x=1"));
    expect(url.origin).toBe("https://saadstudio.app");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirect_url")).toBe("https://saadstudio.app/studio?tab=a&x=1");
  });

  it("never uses the internal bind address", () => {
    expect(buildSignInRedirectUrl("https://saadstudio.app", "/zzz", "")).not.toContain("0.0.0.0");
  });

  it("tolerates a path without a leading slash and a bare query", () => {
    const url = new URL(buildSignInRedirectUrl("https://saadstudio.app", "zzz", "a=1"));
    expect(url.searchParams.get("redirect_url")).toBe("https://saadstudio.app/zzz?a=1");
  });
});
