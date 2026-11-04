import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("components/video/EditVideoSidebarPanel.tsx", "utf8");

describe("video tools sidebar contracts", () => {
  it("uses the registered Kling 4.0 edit endpoint", () => {
    expect(source).toContain('modelRoute: "kwaivgi/kling-v4.0/video-edit"');
    expect(source).not.toContain('modelRoute: "kwaivgi/kling-v2.6-std/video-edit"');
  });

  it("exposes all official standard upscaler resolutions and backend pricing rates", () => {
    expect(source).toContain('<option value="720p">');
    expect(source).toContain('"720p": 0.025');
    expect(source).toContain('"1080p": 0.025');
    expect(source).toContain('"2k": 0.05');
    expect(source).toContain('"4k": 0.1');
    expect(source).toContain('Math.min(600, Math.max(3, Math.ceil(upscaleDuration)))');
  });
});
