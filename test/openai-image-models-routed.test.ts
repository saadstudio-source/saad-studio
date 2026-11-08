import { describe, it, expect } from "vitest";
import { IMAGE_MODELS } from "@/lib/image-models";
import { OPENAI_IMAGE_MODEL_MAP } from "@/lib/openai-image-routing";
import { resolveWaveSpeedImageModelRoute } from "@/lib/wavespeed-image-routing";

/**
 * Every row in the "OpenAI Images" group must be served by exactly one provider path:
 * the direct OpenAI map, or a WaveSpeed route (GPT Image 2.5 / 2.6). A row that is in
 * neither does not fail loudly: the route falls through and the generation dies at the
 * provider. These tests make that mistake fail here instead.
 */
const openAiRows = IMAGE_MODELS.filter((m) => m.group === "OpenAI Images");
const isWaveSpeedGpt = (id: string) => /gpt-image-2\.[56]/.test(id);

describe("OpenAI image models are routed to a provider", () => {
  it("has OpenAI rows to check", () => {
    expect(openAiRows.length).toBeGreaterThan(0);
  });

  it("serves every row through the OpenAI map or a WaveSpeed route", () => {
    const unrouted = openAiRows
      .filter((m) => !OPENAI_IMAGE_MODEL_MAP[m.id])
      .filter((m) => !resolveWaveSpeedImageModelRoute(m.id, m.inputType !== "text-to-image", 1))
      .map((m) => m.id);
    expect(unrouted).toEqual([]);
  });

  it("never serves a row from both providers", () => {
    const both = openAiRows
      .filter((m) => OPENAI_IMAGE_MODEL_MAP[m.id] && isWaveSpeedGpt(m.id))
      .map((m) => m.id);
    expect(both).toEqual([]);
  });

  it("maps only ids that exist in IMAGE_MODELS", () => {
    const known = new Set(IMAGE_MODELS.map((m) => m.id));
    const orphans = Object.keys(OPENAI_IMAGE_MODEL_MAP).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("routes GPT Image 2.5 and 2.6 through WaveSpeed, not the direct OpenAI map", () => {
    for (const version of ["2.5", "2.6"]) {
      for (const tier of ["flare", "sunburst"]) {
        expect(OPENAI_IMAGE_MODEL_MAP[`gpt-image-${version}-${tier}-text-to-image`]).toBeUndefined();
        expect(OPENAI_IMAGE_MODEL_MAP[`gpt-image-${version}-${tier}-image-to-image`]).toBeUndefined();
        expect(resolveWaveSpeedImageModelRoute(`gpt-image-${version}-${tier}-text-to-image`, false, 1)?.model)
          .toBe(`openai/gpt-image-${version}-${tier}/text-to-image`);
        expect(resolveWaveSpeedImageModelRoute(`gpt-image-${version}-${tier}-image-to-image`, true, 1)?.model)
          .toBe(`openai/gpt-image-${version}-${tier}/edit`);
      }
    }
  });

  it("gives every GPT Image 2.5 / 2.6 row the documented WaveSpeed contract", () => {
    const rows = openAiRows.filter((m) => isWaveSpeedGpt(m.id));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.maxRefImages, row.id).toBe(16);
      expect(row.qualityParam, row.id).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(row.resolutions, row.id).toEqual(["1k", "2k", "4k"]);
      expect(row.aspectRatios, row.id).toContain("auto");
      expect(row.aspectRatios, row.id).toHaveLength(16);
      expect(row.creditCost, row.id).toBe(2.0);
    }
  });
});
