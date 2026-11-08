import { describe, expect, it } from "vitest";
import {
  IMAGE_MODELS,
  getWaveSpeedGptImage25Credits,
  isWaveSpeedGptImageModelId,
  normalizeGptImageTier,
} from "@/lib/image-models";
import { normalizeDynamicImageModels } from "@/lib/dynamic-model-loader";
import { pickDynamicImageProvider } from "@/lib/image-provider-select";
import { OPENAI_IMAGE_MODEL_MAP } from "@/lib/openai-image-routing";
import { buildWaveSpeedImageInput, resolveWaveSpeedImageModelRoute } from "@/lib/wavespeed-image-routing";

const TEXT_26 = "gpt-image-2.6-flare-text-to-image";

describe("GPT Image provider selection (catalog rows)", () => {
  const catalog = normalizeDynamicImageModels(IMAGE_MODELS as never) as Array<{ id: string; group?: string; text_api_route?: string; upstreamModelId?: string }>;
  const target = (m: (typeof catalog)[number]) => m.text_api_route || m.upstreamModelId || m.id;

  it("sends every GPT Image 2.5 / 2.6 catalog row to WaveSpeed, never to OpenAI direct", () => {
    const rows = catalog.filter((m) => /gpt-image-2\.[56]/.test(m.id));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(pickDynamicImageProvider(target(row), row.group), row.id).toBe("wavespeed");
      expect(resolveWaveSpeedImageModelRoute(target(row), false, 1), row.id).not.toBeNull();
    }
  });

  it("keeps the direct OpenAI rows on OpenAI", () => {
    for (const id of Object.keys(OPENAI_IMAGE_MODEL_MAP)) {
      const row = catalog.find((m) => m.id === id)!;
      expect(pickDynamicImageProvider(target(row), row.group), id).toBe("openai");
    }
  });

  it("does not change the provider of any other catalog row", () => {
    const legacy = (route: string, group?: string) =>
      /^(google|gemini|imagen)/i.test(route) || /google/i.test(group || "") ? "google"
        : /^(openai|dall-e)/i.test(route) || /openai/i.test(group || "") ? "openai" : "wavespeed";
    for (const row of catalog.filter((m) => !/gpt-image-2\.[56]/.test(m.id))) {
      expect(pickDynamicImageProvider(target(row), row.group), row.id).toBe(legacy(target(row), row.group));
    }
  });
});

describe("GPT Image billing and dispatch use the same tier", () => {
  it("normalises case, padding and imageSize-only requests", () => {
    expect(normalizeGptImageTier(" MAX ", "4K ")).toEqual({ ok: true, quality: "max", resolution: "4k" });
    expect(normalizeGptImageTier("high", undefined, "2K")).toEqual({ ok: true, quality: "high", resolution: "2k" });
    expect(normalizeGptImageTier(undefined, undefined)).toEqual({ ok: true, quality: "medium", resolution: "1k" });
    expect(normalizeGptImageTier("", "  ")).toEqual({ ok: true, quality: "medium", resolution: "1k" });
  });

  it("rejects unknown values instead of defaulting to a cheap tier", () => {
    expect(normalizeGptImageTier("ultra", "1k").ok).toBe(false);
    expect(normalizeGptImageTier("low", "8k").ok).toBe(false);
    expect(normalizeGptImageTier("low", "1024").ok).toBe(false);
  });

  it.each([
    [" MAX", "4K "],
    ["Max", "4k"],
    ["max", undefined, " 4k"],
  ])("bills and renders messy input (%j, %j, %j) as the same max/4k", (quality, resolution, imageSize) => {
    const tier = normalizeGptImageTier(quality, resolution, imageSize);
    expect(tier.ok).toBe(true);
    if (!tier.ok) return;
    const route = resolveWaveSpeedImageModelRoute(TEXT_26, false, 1)!;
    const payload = buildWaveSpeedImageInput(route, { prompt: "p", aspectRatio: "1:1", quality: tier.quality, resolution: tier.resolution, imageSize: tier.resolution });
    expect(payload).toMatchObject({ quality: "max", resolution: "4k" });
    expect(getWaveSpeedGptImage25Credits(TEXT_26, 1, tier.quality, tier.resolution)).toBe(15);
  });

  it("fails closed in the pricing backstop: unknown tiers cost the dearest price", () => {
    expect(getWaveSpeedGptImage25Credits(TEXT_26, 1, "ultra", "1k")).toBe(15);
    expect(getWaveSpeedGptImage25Credits(TEXT_26, 1, "low", "8k")).toBe(15);
    expect(getWaveSpeedGptImage25Credits(TEXT_26, 1, " MAX ", "4K ")).toBe(15);
  });

  it("recognises and prices upper-case model ids like the canonical ones", () => {
    const upper = "GPT-IMAGE-2.6-FLARE-TEXT-TO-IMAGE";
    expect(isWaveSpeedGptImageModelId(upper)).toBe(true);
    expect(getWaveSpeedGptImage25Credits(upper, 1, "max", "4k")).toBe(getWaveSpeedGptImage25Credits(TEXT_26, 1, "max", "4k"));
    const editUpper = "GPT-IMAGE-2.6-SUNBURST-IMAGE-TO-IMAGE";
    expect(getWaveSpeedGptImage25Credits(editUpper, 1, "low", "1k", 1)).toBe(1);
    // the router lower-cases ids, so the upper-case id reaches the same endpoint
    expect(resolveWaveSpeedImageModelRoute(upper, false, 1)?.model).toBe("openai/gpt-image-2.6-flare/text-to-image");
  });
});

describe("GPT Image pricing follows the route that is actually called", () => {
  const rows = IMAGE_MODELS.filter((m) => /gpt-image-2\.[56]/.test(m.id));
  const tiers = ["low", "medium", "high", "xhigh", "max"];
  const resolutions = ["1k", "2k", "4k"];

  it("prices the provider route id exactly like the site id (text/edit table, references, count)", () => {
    for (const row of rows) {
      const edit = row.inputType !== "text-to-image";
      const route = resolveWaveSpeedImageModelRoute(row.id, edit, 1)!;
      for (const quality of tiers) {
        for (const resolution of resolutions) {
          expect(getWaveSpeedGptImage25Credits(route.model, 2, quality, resolution, 3), `${row.id} ${quality}/${resolution}`)
            .toBe(getWaveSpeedGptImage25Credits(row.id, 2, quality, resolution, 3));
        }
      }
    }
  });

  it("recognises the GPT route behind a label / upstream-style lookup, where the client string is not a site id", () => {
    // The route resolves the catalog row by id, label or upstream id, then calls the row's route.
    // The gate must therefore key on the route, which is a GPT endpoint for every such row.
    for (const row of rows) {
      const edit = row.inputType !== "text-to-image";
      const route = resolveWaveSpeedImageModelRoute(row.id, edit, 1)!;
      expect(isWaveSpeedGptImageModelId(row.label), `${row.label} is not a site id`).toBe(false);
      expect(isWaveSpeedGptImageModelId(route.model), row.id).toBe(true);
      // max / 4k on the route is the top of the band for text and edit alike
      expect(getWaveSpeedGptImage25Credits(route.model, 1, "max", "4k", edit ? 1 : 0), row.id).toBe(15);
    }
  });
});
