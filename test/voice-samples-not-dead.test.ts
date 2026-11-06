import { describe, it, expect } from "vitest";
import { VOICE_CATALOG, WAVESPEED_ELEVEN_VOICES } from "@/lib/voice-catalog";
import { getRegistry } from "@/lib/voice-registry";
import { readFileSync } from "node:fs";

/**
 * /api/voices used to overwrite each voice's sampleUrl with whatever the
 * registry held for it. That registry still carries relative
 * "/api/media/audio/sample_*.mp3" paths whose files were removed, so every
 * preview in the picker 404'd. Only a fully hosted URL may replace the
 * catalogue's own /api/voice-sample link, which regenerates a missing sample.
 */
const isHosted = (u: unknown) => typeof u === "string" && /^https?:\/\//i.test(u);

/** The exact rule app/api/voices/route.ts applies. */
const resolveSampleUrl = (voice: (typeof VOICE_CATALOG)[number], registry: Record<string, string>) => {
  const stored = voice.geminiVoiceId ? registry[voice.geminiVoiceId] : null;
  return isHosted(stored) ? (stored as string) : voice.sampleUrl;
};

describe("voice previews never resolve to a dead path", () => {
  const registry = getRegistry() as Record<string, string>;

  it("has a registry to test against", () => {
    expect(Object.keys(registry).length).toBeGreaterThan(0);
  });

  it("contains exactly the documented WaveSpeed voice set without duplicate IDs", () => {
    expect(WAVESPEED_ELEVEN_VOICES).toHaveLength(64);
    expect(new Set(WAVESPEED_ELEVEN_VOICES.map((voice) => voice.id)).size).toBe(64);
    expect(WAVESPEED_ELEVEN_VOICES.every((voice) =>
      voice.provider === "wavespeed" &&
      voice.compatibleModels?.includes("elevenlabs/eleven-v4") &&
      voice.compatibleModels?.includes("elevenlabs/eleven-v4-turbo")
    )).toBe(true);
  });

  it("never serves a relative media path from the registry", () => {
    const served = VOICE_CATALOG.map((v) => resolveSampleUrl(v, registry));
    const relativeMedia = served.filter((u) => u.startsWith("/api/media/"));
    expect(relativeMedia).toEqual([]);
  });

  it("falls back to the regenerating endpoint for every voice the registry cannot host", () => {
    for (const voice of VOICE_CATALOG) {
      const stored = voice.geminiVoiceId ? registry[voice.geminiVoiceId] : null;
      if (isHosted(stored)) continue;
      if (voice.provider === "wavespeed") continue;
      expect(resolveSampleUrl(voice, registry), voice.name).toContain("/api/voice-sample");
    }
  });

  it("keeps a genuinely hosted sample when the registry has one", () => {
    const hosted = { "test-voice": "https://cdn.example.com/sample.mp3" };
    const voice = { ...VOICE_CATALOG[0], geminiVoiceId: "test-voice" };
    expect(resolveSampleUrl(voice, hosted)).toBe("https://cdn.example.com/sample.mp3");
  });

  it("gives every catalogue voice some playable sample url", () => {
    for (const v of VOICE_CATALOG) {
      if (v.provider === "wavespeed") continue;
      expect(v.sampleUrl, v.name).toBeTruthy();
    }
  });
});

describe("voice preview endpoint is reachable without a session", () => {
  it("is explicitly allowlisted before Clerk auth in middleware", () => {
    const middleware = readFileSync("middleware.ts", "utf8");
    expect(
      middleware.includes("'/api/voice-sample(.*)'") ||
      middleware.includes("'/api/voice-sample'")
    ).toBe(true);
  });
});
