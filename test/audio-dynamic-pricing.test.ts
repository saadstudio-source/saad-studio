import { describe, it, expect } from "vitest";
import {
  countAudioScriptCharacters,
  calculateTtsCredits,
  calculateMusicCredits,
  calculateSfxCredits,
} from "@/lib/pricing";
import { getAudioActionCredits } from "@/lib/credit-pricing";

describe("Audio Suite Unified Dynamic Pricing Suite", () => {
  // ── 1. MUSIC DURATION ACCEPTANCE TABLE ──
  const MUSIC_ACCEPTANCE_TABLE: Array<{ sec: number; expectedCredits: number }> = [
    { sec: 15, expectedCredits: 9 },
    { sec: 30, expectedCredits: 17 },
    { sec: 60, expectedCredits: 34 },
    { sec: 90, expectedCredits: 51 },
    { sec: 120, expectedCredits: 68 },
    { sec: 180, expectedCredits: 101 },
    { sec: 240, expectedCredits: 135 },
    { sec: 300, expectedCredits: 168 },
  ];

  it("verifies WaveSpeed music source cost with the SaadStudio margin", () => {
    for (const row of MUSIC_ACCEPTANCE_TABLE) {
      const calculated = calculateMusicCredits(row.sec);
      expect(calculated).toBe(row.expectedCredits);

      const actionCredits = getAudioActionCredits("music", row.sec);
      expect(actionCredits).toBe(row.expectedCredits);

      const payloadCredits = getAudioActionCredits("music", { duration: row.sec });
      expect(payloadCredits).toBe(row.expectedCredits);
    }
  });

  // ── 2. SOUND EFFECTS DURATION ACCEPTANCE TABLE ──
  const SFX_ACCEPTANCE_TABLE: Array<{ sec: number; expectedCredits: number }> = [
    { sec: 2, expectedCredits: 3 },
    { sec: 5, expectedCredits: 4 },
    { sec: 10, expectedCredits: 5 },
    { sec: 15, expectedCredits: 6 },
    { sec: 22, expectedCredits: 8 },
  ];

  it("verifies the exact canonical Sound Effects pricing acceptance table: max(2, ceil(2 + durationSec * 0.25))", () => {
    for (const row of SFX_ACCEPTANCE_TABLE) {
      const calculated = calculateSfxCredits(row.sec);
      expect(calculated).toBe(row.expectedCredits);

      const actionCredits = getAudioActionCredits("video2audio", row.sec);
      expect(actionCredits).toBe(row.expectedCredits);

      const payloadCredits = getAudioActionCredits("video2audio", { duration: row.sec });
      expect(payloadCredits).toBe(row.expectedCredits);
    }
  });

  // ── 3. TTS CHARACTER PRICING PRESERVATION ──
  it("preserves canonical TTS character-based pricing: max(1, ceil(characterCount * 0.0034))", () => {
    expect(calculateTtsCredits(1)).toBe(1);
    expect(calculateTtsCredits(10)).toBe(1);
    expect(calculateTtsCredits(100)).toBe(1);
    expect(calculateTtsCredits(250)).toBe(1);
    expect(calculateTtsCredits(500)).toBe(2);
    expect(calculateTtsCredits(627)).toBe(3);
    expect(calculateTtsCredits(1000)).toBe(4);
    expect(calculateTtsCredits(2000)).toBe(7);
    expect(calculateTtsCredits(5000)).toBe(17);
  });

  it("uses the documented WaveSpeed V4 and Turbo rates with SaadStudio margin", () => {
    expect(calculateTtsCredits(1000, "elevenlabs/eleven-v4")).toBe(5);
    expect(calculateTtsCredits(10000, "elevenlabs/eleven-v4")).toBe(45);
    expect(calculateTtsCredits(1000, "elevenlabs/eleven-v4-turbo")).toBe(3);
    expect(calculateTtsCredits(10000, "elevenlabs/eleven-v4-turbo")).toBe(23);
  });

  // ── 4. LEGACY VOICE CLONING IS NOT TTS ──
  it("keeps legacy Voice Cloning on its flat minimax/voice-clone charge", () => {
    const text627 = "A".repeat(627);
    expect(getAudioActionCredits("voice-cloning", text627)).toBe(89.6);
    expect(getAudioActionCredits("voice-cloning", { text: text627 })).toBe(89.6);
  });

  // ── 5. DEFAULT FALLBACK SANITY CHECKS ──
  it("handles empty / undefined inputs with sensible safe minimums", () => {
    expect(calculateMusicCredits(null)).toBe(17); // default 30s -> 17 CR
    expect(calculateMusicCredits(undefined)).toBe(17);
    expect(calculateMusicCredits(0)).toBe(17);

    expect(calculateSfxCredits(null)).toBe(4); // default 5s -> 4 CR
    expect(calculateSfxCredits(undefined)).toBe(4);
    expect(calculateSfxCredits(0)).toBe(4);
  });
});
