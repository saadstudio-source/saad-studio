import { describe, expect, it } from "vitest";

import { classifyReapGeneration } from "@/lib/panel-reap-access";

const PROJECT = "proj-abc";
const reapRow = (mediaUrl: string | null, usageRequestId?: string | null) => ({
  modelUsed: "reap:captions",
  mediaUrl,
  usageRequestId,
});

describe("classifyReapGeneration", () => {
  it("polls an in-flight job whose marker matches the project", () => {
    expect(classifyReapGeneration(reapRow(`task:reap:${PROJECT}`), PROJECT)).toEqual({ access: "poll" });
  });

  it("denies an in-flight job that belongs to a different project", () => {
    expect(classifyReapGeneration(reapRow("task:reap:other-project"), PROJECT)).toEqual({ access: "denied" });
    expect(classifyReapGeneration(reapRow("task:clipcraft:proj-abc"), PROJECT)).toEqual({ access: "denied" });
  });

  it("serves a finished row from the database and never asks Reap again", () => {
    const result = classifyReapGeneration(reapRow("https://cdn.example/out.mp4"), PROJECT);
    expect(result).toEqual({ access: "completed", url: "https://cdn.example/out.mp4" });
    // The stored URL is returned whatever projectId the caller supplied.
    expect(classifyReapGeneration(reapRow("videos/u1/out.mp4"), "someone-elses-project")).toEqual({
      access: "completed",
      url: "videos/u1/out.mp4",
    });
  });

  it("reports failed rows without leaking the stored error text", () => {
    expect(classifyReapGeneration(reapRow("error: provider said no"), PROJECT)).toEqual({ access: "failed" });
    expect(classifyReapGeneration(reapRow("Error provider said no"), PROJECT)).toEqual({ access: "failed" });
  });

  it("only polls a row without media when the usage record proves the project", () => {
    expect(classifyReapGeneration(reapRow(null, `reap:${PROJECT}`), PROJECT)).toEqual({ access: "poll" });
    expect(classifyReapGeneration(reapRow(null, "reap:other"), PROJECT)).toEqual({ access: "denied" });
    expect(classifyReapGeneration(reapRow(null), PROJECT)).toEqual({ access: "denied" });
    expect(classifyReapGeneration(reapRow("   ", null), PROJECT)).toEqual({ access: "denied" });
  });

  it("denies generations that are not Reap jobs", () => {
    expect(classifyReapGeneration({ modelUsed: "kling-3.0/video", mediaUrl: `task:reap:${PROJECT}` }, PROJECT)).toEqual({ access: "denied" });
    expect(classifyReapGeneration({ modelUsed: null, mediaUrl: "https://cdn.example/x.mp4" }, PROJECT)).toEqual({ access: "denied" });
  });
});
