// Display names + one-line descriptions for the image Quality / Resolution pickers.
// The provider value (e.g. "xhigh", "4k") is never changed; this only decides how it is shown.

export interface ImageOptionInfo {
  title: string;
  description: string;
}

const QUALITY_INFO: Record<string, ImageOptionInfo> = {
  low: { title: "Low", description: "Fastest and cheapest" },
  medium: { title: "Medium", description: "Balanced visuals" },
  high: { title: "High", description: "High visual fidelity" },
  xhigh: { title: "Extra High", description: "Extra detail" },
  max: { title: "Max", description: "Maximum quality" },
};

// Resolution is a size tier: the long edge is the listed pixel count, the other side follows the aspect ratio.
const RESOLUTION_INFO: Record<string, ImageOptionInfo> = {
  "1k": { title: "1K", description: "1024px" },
  "2k": { title: "2K", description: "2048px" },
  "4k": { title: "4K", description: "4096px" },
};

function lookup(table: Record<string, ImageOptionInfo>, values: readonly string[]): Record<string, ImageOptionInfo> | null {
  if (!values.length) return null;
  const out: Record<string, ImageOptionInfo> = {};
  for (const value of values) {
    const info = table[String(value).trim().toLowerCase()];
    if (!info) return null; // unknown value in the list: keep the plain select for the whole list
    out[value] = info;
  }
  return out;
}

/** Info for every option when ALL of them are known quality tiers (low..max), else null. */
export function describeQualityOptions(values: readonly string[]) {
  return lookup(QUALITY_INFO, values);
}

/** Info for every option when ALL of them are 1k / 2k / 4k, else null. */
export function describeResolutionOptions(values: readonly string[]) {
  return lookup(RESOLUTION_INFO, values);
}
