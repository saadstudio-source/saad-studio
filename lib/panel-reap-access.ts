// Access decision for GET /api/panel/reap/status (pure, unit-tested).
//
// A caller may only poll a Reap project that belongs to one of THEIR own Reap
// generations. The project binding is only knowable while the job is in flight
// (the row's mediaUrl is the marker `task:reap:<projectId>`); once the job is
// finished the row holds the final media URL instead. So:
//
//   in flight, marker matches  → "poll"       (ask Reap, persist the output)
//   in flight, marker differs  → "denied"     (someone else's project)
//   finished (real media URL)  → "completed"  (serve the stored URL; Reap is NOT
//                                              called, so a finished row can
//                                              never be used to pull an
//                                              arbitrary projectId)
//   failed marker              → "failed"
//   no media yet               → "poll" only if the usage record proves the
//                                project, otherwise "denied"

export type ReapAccess =
  | { access: "poll" }
  | { access: "completed"; url: string }
  | { access: "failed" }
  | { access: "denied" };

export interface ReapGenerationSnapshot {
  modelUsed: string | null;
  mediaUrl: string | null;
  /** providerRequestId from the generation's usage record, if any. */
  usageRequestId?: string | null;
}

export function classifyReapGeneration(generation: ReapGenerationSnapshot, projectId: string): ReapAccess {
  if (!String(generation.modelUsed ?? "").startsWith("reap:")) return { access: "denied" };

  const marker = `task:reap:${projectId}`;
  const media = String(generation.mediaUrl ?? "").trim();

  if (media.startsWith("task:")) return media === marker ? { access: "poll" } : { access: "denied" };
  if (/^error[: ]/i.test(media)) return { access: "failed" };
  if (media) return { access: "completed", url: media };

  return generation.usageRequestId === `reap:${projectId}` ? { access: "poll" } : { access: "denied" };
}
