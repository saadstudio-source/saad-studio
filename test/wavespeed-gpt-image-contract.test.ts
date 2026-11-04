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

  it("uses the official text/edit price tables with the platform multiplier", () => {
    const text = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.5-flare-text-to-image")!;
    const edit = IMAGE_MODELS.find((model) => model.id === "gpt-image-2.5-flare-image-to-image")!;
    expect(getImageCreditCost(text, 1, "medium", "1k")).toBe(1.34);
    expect(getImageCreditCost(text, 1, "max", "4k")).toBe(56);
    expect(getImageCreditCost(edit, 1, "medium", "1k")).toBe(1.9);
  });
});
