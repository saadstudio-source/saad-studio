import { describe, expect, it } from "vitest";
import { IMAGE_MODELS } from "@/lib/image-models";
import { describeQualityOptions, describeResolutionOptions } from "@/lib/image-option-labels";

describe("image quality / resolution labels", () => {
  it("names all five quality tiers with the shown descriptions", () => {
    const info = describeQualityOptions(["low", "medium", "high", "xhigh", "max"])!;
    expect(info.low).toEqual({ title: "Low", description: "Fastest and cheapest" });
    expect(info.medium).toEqual({ title: "Medium", description: "Balanced visuals" });
    expect(info.high).toEqual({ title: "High", description: "High visual fidelity" });
    expect(info.xhigh).toEqual({ title: "Extra High", description: "Extra detail" });
    expect(info.max).toEqual({ title: "Max", description: "Maximum quality" });
  });

  it("names the three resolutions with their pixel size", () => {
    const info = describeResolutionOptions(["1k", "2k", "4k"])!;
    expect(info["1k"]).toEqual({ title: "1K", description: "1024px" });
    expect(info["2k"]).toEqual({ title: "2K", description: "2048px" });
    expect(info["4k"]).toEqual({ title: "4K", description: "4096px" });
  });

  it("falls back (null) when any option is unknown, so other models keep the plain select", () => {
    expect(describeQualityOptions(["speed", "quality"])).toBeNull();
    expect(describeQualityOptions(["low", "ultra"])).toBeNull();
    expect(describeResolutionOptions(["512px", "1k"])).toBeNull();
    expect(describeQualityOptions([])).toBeNull();
  });

  it("covers every GPT Image 2.5 / 2.6 row, and the value sent to the provider is untouched", () => {
    const rows = IMAGE_MODELS.filter((m) => /gpt-image-2\.[56]/.test(m.id));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const quality = describeQualityOptions(row.qualityParam!)!;
      const resolution = describeResolutionOptions(row.resolutions!)!;
      expect(Object.keys(quality), row.id).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(Object.keys(resolution), row.id).toEqual(["1k", "2k", "4k"]);
    }
  });
});
