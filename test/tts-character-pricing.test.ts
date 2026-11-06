import { describe, it, expect } from "vitest";
import { countAudioScriptCharacters, calculateTtsCredits } from "@/lib/pricing";
import { getAudioActionCredits } from "@/lib/credit-pricing";

describe("TTS Character-Based Credit Pricing Acceptance Suite", () => {
  const ACCEPTANCE_TABLE: Array<{ chars: number; expectedCredits: number }> = [
    { chars: 1, expectedCredits: 1 },
    { chars: 10, expectedCredits: 1 },
    { chars: 100, expectedCredits: 1 },
    { chars: 250, expectedCredits: 1 },
    { chars: 500, expectedCredits: 2 },
    { chars: 627, expectedCredits: 3 },
    { chars: 1000, expectedCredits: 4 },
    { chars: 2000, expectedCredits: 7 },
    { chars: 5000, expectedCredits: 17 },
  ];

  it("verifies the exact canonical TTS pricing acceptance table", () => {
    for (const row of ACCEPTANCE_TABLE) {
      const sampleText = "A".repeat(row.chars);
      const counted = countAudioScriptCharacters(sampleText);
      expect(counted).toBe(row.chars);

      const credits = calculateTtsCredits(sampleText);
      expect(credits).toBe(row.expectedCredits);

      const directCountCredits = calculateTtsCredits(row.chars);
      expect(directCountCredits).toBe(row.expectedCredits);
    }
  });

  it("guarantees minimum charge of 1 credit and never returns 0 for non-empty or empty input", () => {
    expect(calculateTtsCredits("")).toBe(1);
    expect(calculateTtsCredits("   ")).toBe(1);
    expect(calculateTtsCredits(null)).toBe(1);
    expect(calculateTtsCredits(undefined)).toBe(1);
    expect(calculateTtsCredits(0)).toBe(1);
    expect(calculateTtsCredits(1)).toBe(1);
  });

  it("handles whitespace, newlines, CRLF, and Unicode NFC deterministically", () => {
    const rawText = "   Hello \r\n World \n\n Test   ";
    const normalized = rawText.normalize("NFC").replace(/\r\n/g, "\n").trim();
    const count = countAudioScriptCharacters(rawText);
    expect(count).toBe(normalized.length);
    expect(countAudioScriptCharacters(rawText)).toBe(countAudioScriptCharacters(normalized));
  });

  it("keeps legacy Voice Cloning separate from canonical TTS pricing", () => {
    const script627 = "X".repeat(627);
    const standardTtsCredits = calculateTtsCredits(script627);
    const clonedTtsCredits = getAudioActionCredits("voice-cloning", { text: script627 });

    expect(standardTtsCredits).toBe(3);
    expect(clonedTtsCredits).toBe(89.6);
    expect(clonedTtsCredits).not.toBe(standardTtsCredits);
  });

  it("verifies Music and SFX pricing use duration-based canonical formulas without character leakage", () => {
    const music30Credits = getAudioActionCredits("music", 30);
    const music60Credits = getAudioActionCredits("music", 60);
    const sfx5Credits = getAudioActionCredits("video2audio", 5);
    const sfx22Credits = getAudioActionCredits("video2audio", 22);
    const dubbing30Credits = getAudioActionCredits("dubbing", 30);
    const dubbing60Credits = getAudioActionCredits("dubbing", 60);
    const voiceChangerCredits = getAudioActionCredits("voice-changer");
    const lipsyncCredits = getAudioActionCredits("lip-sync");

    expect(music30Credits).toBe(6);
    expect(music60Credits).toBe(10);
    expect(sfx5Credits).toBe(4);
    expect(sfx22Credits).toBe(8);
    // Dubbing is billed per second of source media ($0.01/s at the provider),
    // so it belongs to the duration-based family this suite is about. It used
    // to be a flat 8 regardless of length, which is what made a 15-minute job
    // lose money.
    expect(dubbing30Credits).toBe(9.9);
    expect(dubbing60Credits).toBe(19.8);
    expect(dubbing60Credits).toBe(dubbing30Credits * 2);
    expect(voiceChangerCredits).toBe(3);
    expect(lipsyncCredits).toBe(6);

    // Passing text payload does NOT leak into character pricing for Music/SFX
    expect(getAudioActionCredits("music", { duration: 60, text: "A".repeat(5000) })).toBe(10);
    expect(getAudioActionCredits("video2audio", { duration: 5, text: "A".repeat(5000) })).toBe(4);
  });
});
