import { describe, expect, it } from "vitest";
import { buildWaveSpeedImageInput, resolveWaveSpeedImageModelRoute } from "@/lib/wavespeed-image-routing";
import { IMAGE_MODELS, getImageCreditCost } from "@/lib/image-models";

describe("WaveSpeed GPT Image 2.5 routing", () => {
  it.each([
    ["gpt-image-2.5-flare-text-to-image", "openai/gpt-image-2.5-flare/text-to-image"],
    ["gpt-image-2.5-flare-image-to-image", "openai/gpt-image-2.5-flare/edit"],
    ["gpt-image-2.5-sunburst-text-to-image", "openai/gpt-image-2.5-sunburst/text-to-image"],
    ["gpt-image-2.5-sunburst-image-to-image", "openai/gpt-image-2.5-sunburst/edit"],
  ])("routes %s to WaveSpeed %s", (id, route) => {
    const config = resolveWaveSpeedImageModelRoute(id, id.endsWith("image-to-image"), 1);
    expect(config?.model).toBe(route);
  });

  it("maps the complete documented text request without dropping quality, resolution, ratio, or format", () => {
    const config = resolveWaveSpeedImageModelRoute("gpt-image-2.5-flare-text-to-image", false, 1)!;
    expect(buildWaveSpeedImageInput(config, { prompt: "test", aspectRatio: "21:9", quality: "xhigh", resolution: "4k" })).toMatchObject({
      prompt: "test", aspect_ratio: "21:9", quality: "xhigh", resolution: "4k", output_format: "png",
    });
  });

  it("maps edit references to the official images field and caps them at 16", () => {
    const config = resolveWaveSpeedImageModelRoute("gpt-image-2.5-sunburst-image-to-image", true, 1)!;
    const refs = Array.from({ length: 20 }, (_, index) => `https://example.com/${index}.png`);
    const input = buildWaveSpeedImageInput(config, { prompt: "edit", aspectRatio: "3:1", quality: "max", resolution: "2k", referenceUrls: refs });
    expect(input.images).toHaveLength(16);
    expect(input).toMatchObject({ aspect_ratio: "3:1", quality: "max", resolution: "2k" });
  });

  it("keeps 2.5 on its own cost table, not the 2.6 one", () => {
    const text25 = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.5-sunburst-text-to-image")!;
    const text26 = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.6-sunburst-text-to-image")!;
    // 2.5 high/1k costs $0.09 of a $0.01..$1.00 span; 2.6 high/1k costs $0.06 of a $0.03..$0.85 span.
    expect(getImageCreditCost(text25, 1, "high", "1k")).toBe(2.13);
    expect(getImageCreditCost(text26, 1, "high", "1k")).toBe(1.51);
  });

  it("prices 2.5 inside the owner's 1..15 credit band, ordered by provider cost", () => {
    const text = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.5-flare-text-to-image")!;
    const edit = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.5-flare-image-to-image")!;
    expect(getImageCreditCost(text, 1, "low", "1k")).toBe(1);
    expect(getImageCreditCost(text, 1, "max", "4k")).toBe(15);
    expect(getImageCreditCost(edit, 1, "low", "1k", 1)).toBe(1);
    expect(getImageCreditCost(edit, 1, "max", "4k", 1)).toBe(15);
    expect(getImageCreditCost(text, 1, "medium", "1k")).toBe(1.2);
  });
});

describe("WaveSpeed GPT Image 2.6 (Flare + Sunburst)", () => {
  const ids = [
    ["gpt-image-2.6-flare-text-to-image", false, "openai/gpt-image-2.6-flare/text-to-image"],
    ["gpt-image-2.6-flare-image-to-image", true, "openai/gpt-image-2.6-flare/edit"],
    ["gpt-image-2.6-sunburst-text-to-image", false, "openai/gpt-image-2.6-sunburst/text-to-image"],
    ["gpt-image-2.6-sunburst-image-to-image", true, "openai/gpt-image-2.6-sunburst/edit"],
  ] as const;

  it.each(ids)("routes %s to the documented WaveSpeed endpoint", (id, edit, route) => {
    const config = resolveWaveSpeedImageModelRoute(id, edit, 1)!;
    expect(config.model).toBe(route);
    expect(config.referenceField).toBe(edit ? "images" : undefined);
    expect(config.maxReferenceImages).toBe(edit ? 16 : 0);
  });

  it("also accepts the provider path as an id", () => {
    expect(resolveWaveSpeedImageModelRoute("openai/gpt-image-2.6-flare/edit", true, 1)?.model).toBe("openai/gpt-image-2.6-flare/edit");
  });

  it("registers all four rows with the documented capabilities", () => {
    const rows = IMAGE_MODELS.filter((model) => model.id.includes("gpt-image-2.6"));
    expect(rows.map((row) => row.id).sort()).toEqual(ids.map(([id]) => id).sort());
    for (const row of rows) {
      expect(row.group).toBe("OpenAI Images");
      expect(row.qualityParam).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(row.resolutions).toEqual(["1k", "2k", "4k"]);
      expect(row.complexityParam).toEqual(["low", "medium", "high"]);
      expect(row.maxRefImages).toBe(16);
      expect(row.aspectRatios).toEqual(["auto", "1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"]);
    }
  });

  it("sends complexity only for 2.6 and only when valid", () => {
    const flare26 = resolveWaveSpeedImageModelRoute("gpt-image-2.6-flare-text-to-image", false, 1)!;
    expect(buildWaveSpeedImageInput(flare26, { prompt: "p", aspectRatio: "1:1", quality: "high", resolution: "2k", complexity: "low" })).toMatchObject({
      quality: "high", resolution: "2k", complexity: "low", output_format: "png",
    });
    expect(buildWaveSpeedImageInput(flare26, { prompt: "p", aspectRatio: "1:1", complexity: "extreme" })).not.toHaveProperty("complexity");
    expect(buildWaveSpeedImageInput(flare26, { prompt: "p", aspectRatio: "1:1" })).not.toHaveProperty("complexity");
    const flare25 = resolveWaveSpeedImageModelRoute("gpt-image-2.5-flare-text-to-image", false, 1)!;
    expect(buildWaveSpeedImageInput(flare25, { prompt: "p", aspectRatio: "1:1", complexity: "low" })).not.toHaveProperty("complexity");
  });

  it("caps edit references at 16 and uses the images field", () => {
    const config = resolveWaveSpeedImageModelRoute("gpt-image-2.6-sunburst-image-to-image", true, 1)!;
    const refs = Array.from({ length: 20 }, (_, index) => `https://example.com/${index}.png`);
    const input = buildWaveSpeedImageInput(config, { prompt: "edit", aspectRatio: "3:1", quality: "max", resolution: "4k", referenceUrls: refs });
    expect(input.images).toHaveLength(16);
    expect(input).toMatchObject({ aspect_ratio: "3:1", quality: "max", resolution: "4k" });
  });

  it("sets the cheapest tier to 1 credit and the dearest to 15 credits", () => {
    for (const id of ["gpt-image-2.6-flare-text-to-image", "gpt-image-2.6-sunburst-text-to-image"]) {
      const text = IMAGE_MODELS.find((model) => model.id === id)!;
      expect(getImageCreditCost(text, 1, "low", "1k")).toBe(1);
      expect(getImageCreditCost(text, 1, "max", "4k")).toBe(15);
    }
    for (const id of ["gpt-image-2.6-flare-image-to-image", "gpt-image-2.6-sunburst-image-to-image"]) {
      const edit = IMAGE_MODELS.find((model) => model.id === id)!;
      expect(getImageCreditCost(edit, 1, "low", "1k", 1)).toBe(1);
      expect(getImageCreditCost(edit, 1, "max", "4k", 1)).toBe(15);
    }
  });

  it("never prices a higher quality or resolution below a lower one", () => {
    const text = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.6-flare-text-to-image")!;
    const qualities = ["low", "medium", "high", "xhigh", "max"];
    const resolutions = ["1k", "2k", "4k"];
    for (const resolution of resolutions) {
      const prices = qualities.map((quality) => getImageCreditCost(text, 1, quality, resolution));
      expect(prices, resolution).toEqual([...prices].sort((a, b) => a - b));
    }
    for (const quality of qualities) {
      const prices = resolutions.map((resolution) => getImageCreditCost(text, 1, quality, resolution));
      expect(prices, quality).toEqual([...prices].sort((a, b) => a - b));
    }
  });

  it("places the middle tiers by provider cost on the 1..15 line", () => {
    const text = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.6-flare-text-to-image")!;
    expect(getImageCreditCost(text, 1, "medium", "1k")).toBe(1.34);
    expect(getImageCreditCost(text, 1, "xhigh", "4k")).toBe(6.98);
    expect(getImageCreditCost(text, 1, "max", "1k")).toBe(4.76);
  });

  it("adds extra edit references on the same line and multiplies by image count", () => {
    const edit = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.6-sunburst-image-to-image")!;
    const one = getImageCreditCost(edit, 1, "medium", "1k", 1);
    const three = getImageCreditCost(edit, 1, "medium", "1k", 3);
    expect(three).toBeGreaterThan(one);
    expect(getImageCreditCost(edit, 2, "medium", "1k", 1)).toBe(parseFloat((one * 2).toFixed(2)));
  });
});
