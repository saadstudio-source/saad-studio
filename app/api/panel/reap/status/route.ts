/** GET /api/panel/reap/status?projectId=...&generationId=...
 *
 * Polls Reap for project status. When the project completes the final
 * URL is persisted to R2 (so the panel can display it directly without
 * worrying about Reap link expiry) and the Generation row is updated.
 *
 * Returns:
 *   { status: "queued"|"processing"|"completed"|"failed"|...,
 *     progress?: number,
 *     url?: string,         // R2-hosted on completion
 *     urls?: string[],      // for edit-videos (multi-clip)
 *     metadata?: any,
 *     error?: string } */

import { NextRequest, NextResponse } from "next/server";
import { extractPanelToken, verifyPanelToken } from "@/lib/panel-auth";
import { saveAdditionalGenerationUrls, ensureUserRow, finalizeReapGeneration } from "@/lib/credit-ledger";
import { completeTaskGeneration } from "@/lib/generation/task-orchestrator";
import { hitRateLimit, panelRateLimitResponse, getRequestIp } from "@/lib/panel-rate-limit";
import prismadb from "@/lib/prismadb";
import { pollReapStatus } from "@/lib/providers/reap";
import { persistProviderUrl } from "@/lib/providers/persist-output";
import { normalizeMediaUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Ownership gate: a caller may only poll (and have outputs persisted for) a Reap
 * project that belongs to one of THEIR generations. Without this, any signed-in
 * user who learned someone else's generationId could overwrite that row's media
 * URL, and any projectId could be pulled into their own storage.
 *
 *  - generationId given: the row must be the caller's own Reap generation, and
 *    while it is still in flight its task marker must be this projectId.
 *  - generationId omitted (older panel builds): the project must still be an
 *    in-flight job owned by the caller.
 */
async function ownsReapProject(userId: string, projectId: string, generationId: string | null): Promise<boolean> {
  const marker = `task:reap:${projectId}`;

  if (generationId) {
    const generation = await prismadb.generation.findFirst({
      where: { id: generationId, userId },
      select: { mediaUrl: true, modelUsed: true },
    });
    if (!generation || !String(generation.modelUsed ?? "").startsWith("reap:")) return false;
    if (generation.mediaUrl?.startsWith("task:") && generation.mediaUrl !== marker) return false;
    return true;
  }

  const inFlight = await prismadb.generation.findFirst({
    where: { userId, mediaUrl: marker },
    select: { id: true },
  });
  return Boolean(inFlight);
}

export async function GET(req: NextRequest) {
  const token = extractPanelToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const verified = verifyPanelToken(token);
  if (!verified) return NextResponse.json({ error: "Invalid or expired panel token." }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  const generationId = req.nextUrl.searchParams.get("generationId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const rate = hitRateLimit({
    key: `panel:reap:status:${verified.userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) return panelRateLimitResponse(rate.retryAfterSec);

  try {
    const userId = verified.userId;
    await ensureUserRow(userId);

    if (!(await ownsReapProject(userId, projectId, generationId))) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const result = await pollReapStatus(projectId);

    // Not done yet → just relay the status.
    if (result.status !== "completed") {
      return NextResponse.json({
        status: result.status,
        progress: result.progress,
        error: result.error,
      });
    }

    // Completed: persist the asset(s) to R2 so the panel gets a stable URL.
    const persistedUrls: string[] = [];
    if (Array.isArray(result.urls) && result.urls.length) {
      for (let i = 0; i < result.urls.length; i++) {
        const localId = i === 0
          ? generationId ?? `reap-${projectId}`
          : `${generationId ?? `reap-${projectId}`}-${i}`;
        const persisted = await persistProviderUrl({
          url: result.urls[i],
          userId,
          generationId: localId,
          assetType: "VIDEO",
        });
        persistedUrls.push(persisted);
      }
    } else if (result.url) {
      const persisted = await persistProviderUrl({
        url: result.url,
        userId,
        generationId: generationId ?? `reap-${projectId}`,
        assetType: "VIDEO",
      });
      persistedUrls.push(persisted);
    }

    // Save the primary URL on the Generation row, secondary URLs as extras.
    if (generationId && persistedUrls[0]) {
      await completeTaskGeneration({
        generationId,
        mediaUrl: persistedUrls[0],
      }).catch(() => {});
      if (persistedUrls.length > 1) {
        // Look up the prompt + modelUsed off the existing row to keep the
        // saveAdditionalGenerationUrls signature happy.
        const row = await prismadb.generation
          .findUnique({
            where: { id: generationId },
            select: { prompt: true, modelUsed: true },
          })
          .catch(() => null);
        await saveAdditionalGenerationUrls(
          userId,
          row?.prompt ?? "Reap output",
          row?.modelUsed ?? `reap:${projectId}`,
          "VIDEO",
          persistedUrls.slice(1),
        ).catch(() => {});
      }
    }

    const rawDur = result.metadata?.duration ?? result.metadata?.inputDuration ?? result.metadata?.outputDuration;
    const actualDuration = typeof rawDur === "number" ? rawDur : (typeof rawDur === "string" ? parseFloat(rawDur) : null);
    await finalizeReapGeneration(projectId, actualDuration, userId).catch(() => {});

    return NextResponse.json({
      status: "completed",
      url: persistedUrls[0] ? normalizeMediaUrl(persistedUrls[0]) : null,
      urls: persistedUrls.map((u) => normalizeMediaUrl(u) as string),
      metadata: result.metadata,
    });
  } catch (err) {
    console.error("[panel/reap/status]", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate limit|too many requests|429/i.test(msg)) {
      return NextResponse.json({
        status: "processing",
        progress: undefined,
        rateLimited: true,
      });
    }
    return NextResponse.json({ error: `Reap status check failed: ${msg}` }, { status: 502 });
  }
}
