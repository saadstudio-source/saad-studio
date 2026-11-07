import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_PREVIEW_MEDIA,
  PREVIEW_TTL_SECONDS,
  buildPreviewUrl,
  createPreviewToken,
  verifyPreviewToken,
} from "@/lib/smart-cli-preview";

const ORIGINAL = { secret: process.env.PANEL_TOKEN_SECRET, next: process.env.NEXTAUTH_SECRET, env: process.env.NODE_ENV };

beforeEach(() => {
  process.env.PANEL_TOKEN_SECRET = "test-secret-for-previews";
});
afterEach(() => {
  process.env.PANEL_TOKEN_SECRET = ORIGINAL.secret;
  process.env.NEXTAUTH_SECRET = ORIGINAL.next;
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL.env;
  if (ORIGINAL.secret === undefined) delete process.env.PANEL_TOKEN_SECRET;
  if (ORIGINAL.next === undefined) delete process.env.NEXTAUTH_SECRET;
});

const image = { kind: "image" as const, urls: ["https://cdn.example/a.jpg"], model: "Nano Banana Pro", aspectRatio: "16:9", prompt: "Ahwar marshes at dawn" };

describe("preview tokens", () => {
  it("round-trips the data the page needs", () => {
    const token = createPreviewToken(image)!;
    expect(verifyPreviewToken(token)).toMatchObject({
      kind: "image",
      urls: ["https://cdn.example/a.jpg"],
      model: "Nano Banana Pro",
      aspectRatio: "16:9",
      prompt: "Ahwar marshes at dawn",
    });
  });

  it("rejects a tampered payload or signature", () => {
    const token = createPreviewToken(image)!;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "image", u: ["https://evil.example/x.jpg"], e: 9999999999 })).toString("base64url");
    expect(verifyPreviewToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyPreviewToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyPreviewToken(`${body}.`)).toBeNull();
    expect(verifyPreviewToken("garbage")).toBeNull();
  });

  it("rejects tokens signed with another secret", () => {
    const token = createPreviewToken(image)!;
    process.env.PANEL_TOKEN_SECRET = "a-different-secret";
    expect(verifyPreviewToken(token)).toBeNull();
  });

  it("expires after the TTL", () => {
    const now = Date.now();
    const token = createPreviewToken(image, now)!;
    expect(verifyPreviewToken(token, now + (PREVIEW_TTL_SECONDS - 5) * 1000)).not.toBeNull();
    expect(verifyPreviewToken(token, now + (PREVIEW_TTL_SECONDS + 5) * 1000)).toBeNull();
  });

  it("only carries https media URLs and caps their number", () => {
    expect(createPreviewToken({ ...image, urls: ["http://cdn.example/a.jpg", "javascript:alert(1)", "data:image/png;base64,xx", "not a url"] })).toBeNull();
    const many = Array.from({ length: 20 }, (_, i) => `https://cdn.example/${i}.jpg`);
    expect(verifyPreviewToken(createPreviewToken({ ...image, urls: many })!)!.urls).toHaveLength(MAX_PREVIEW_MEDIA);
  });

  it("refuses a validly signed token that smuggles a non-https URL", () => {
    // Even with a correct signature, verification re-checks the shape.
    const payload = Buffer.from(JSON.stringify({ k: "image", u: ["javascript:alert(1)"], e: 9999999999 })).toString("base64url");
    const sig = createHmac("sha256", "test-secret-for-previews").update(`smart-cli-preview.v1.${payload}`).digest("base64url");
    expect(verifyPreviewToken(`${payload}.${sig}`)).toBeNull();
  });

  it("clips long prompts and ignores empty ones", () => {
    const long = createPreviewToken({ ...image, prompt: "x".repeat(500) })!;
    expect(verifyPreviewToken(long)!.prompt!.length).toBeLessThanOrEqual(160);
    expect(verifyPreviewToken(createPreviewToken({ ...image, prompt: "   " })!)!.prompt).toBeUndefined();
  });

  it("supports video and audio with duration", () => {
    const video = verifyPreviewToken(createPreviewToken({ kind: "video", urls: ["https://cdn.example/v.mp4"], durationSec: 5 })!)!;
    expect(video).toMatchObject({ kind: "video", durationSec: 5 });
    expect(verifyPreviewToken(createPreviewToken({ kind: "audio", urls: ["https://cdn.example/a.mp3"] })!)!.kind).toBe("audio");
  });

  it("builds a /preview URL and keeps it short enough to paste", () => {
    const url = buildPreviewUrl("https://saadstudio.app/", image)!;
    expect(url.startsWith("https://saadstudio.app/preview/")).toBe(true);
    expect(url.length).toBeLessThan(700);
  });

  it("returns null (no link) in production when no secret is configured", () => {
    delete process.env.PANEL_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    expect(createPreviewToken(image)).toBeNull();
    expect(buildPreviewUrl("https://saadstudio.app", image)).toBeNull();
  });
});
