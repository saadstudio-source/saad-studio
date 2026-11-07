import { clerkClient } from "@clerk/nextjs/server";
import prismadb from "@/lib/prismadb";
import { scheduleImageThumbnailGeneration } from "@/lib/image-thumbnails";
import { scheduleVideoPosterGeneration } from "@/lib/video-posters";
import { WELCOME_SIGNUP_CREDITS } from "@/lib/credits-config";
import { SAAD_PLANS } from "@/lib/pricing-models";
import { isStorageConfigured, uploadUrlToStorage } from "@/lib/supabase-storage";
import { maybeSendLowCreditAlert } from "@/lib/notifications";
import { runCreditReconciliation } from "@/lib/credit-reconciler";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class InsufficientCreditsError extends Error {
  constructor(public readonly currentBalance: number, public readonly requiredCredits: number) {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export class PolicyBlockedError extends Error {
  constructor(public readonly reason: string, public readonly publicMessage: string) {
    super(publicMessage);
    this.name = "PolicyBlockedError";
  }
}

export class CreditAdvanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CreditAdvanceError";
  }
}

export async function ensureUserRow(userId: string) {
  const existing = await prismadb.user.findUnique({ where: { id: userId } });
  if (existing) return existing;

  const clerk = await clerkClient();
  const clerkUser = await clerk.users.getUser(userId).catch(() => null);
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? `${userId}@unknown`;
  const name = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || null;

  // Welcome bonus is OFF by default. Only set creditsExpireAt when we
  // actually allocate something — a zero-credit account doesn't need a
  // ticking 30-day expiry.
  const welcome = Math.max(0, Math.floor(WELCOME_SIGNUP_CREDITS));

  try {
    return await prismadb.user.create({
      data: {
        id: userId,
        email,
        name,
        creditBalance: welcome,
        creditsExpireAt: welcome > 0 ? new Date(Date.now() + THIRTY_DAYS_MS) : null,
        role: "USER",
        isBanned: false,
      },
    });
  } catch {
    // Unique-constraint race or email already used by another row
    const retry = await prismadb.user.findUnique({ where: { id: userId } });
    if (retry) return retry;
    const byEmail = await prismadb.user.findUnique({ where: { email } });
    if (byEmail) return byEmail;
    throw new Error(`Cannot create DB row for user ${userId}`);
  }
}

export async function ensureWelcomeCredits(userId: string) {
  const user = await ensureUserRow(userId);
  // No-op when the welcome bonus is disabled — never silently top up.
  if (WELCOME_SIGNUP_CREDITS <= 0) return user;
  if (user.creditBalance > 0) return user;

  const [generationCount, transactionCount] = await Promise.all([
    prismadb.generation.count({ where: { userId } }),
    prismadb.adminTransaction.count({ where: { userId } }),
  ]);

  if (generationCount > 0 || transactionCount > 0 || user.monthlyCredits > 0) {
    return user;
  }

  return prismadb.user.update({
    where: { id: userId },
    data: {
      creditBalance: WELCOME_SIGNUP_CREDITS,
      creditsExpireAt: user.creditsExpireAt ?? new Date(Date.now() + THIRTY_DAYS_MS),
    },
  });
}
export type CreditLedgerReason =
  | "generation_charge"
  | "generation_refund_provider_failed"
  | "generation_refund_blocked_result"
  | "generation_refund_no_output"
  | "generation_refund_partial_failure"
  | "subscription_grant"
  | "topup_grant"
  | "annual_credit_advance_draw"
  | "annual_advance_repayment"
  | "annual_monthly_renewal"
  | "monthly_credits_expired"
  | (string & {});

export type CreditLedgerOperationType =
  | "reserve"
  | "charge"
  | "reconcile"
  | "refund"
  | "reversal"
  | "admin_adjustment";

export class CreditLedgerUnavailableError extends Error {
  constructor() {
    super("Credit ledger infrastructure is unavailable.");
    this.name = "CreditLedgerUnavailableError";
  }
}

function inferLedgerOperationType(reason: CreditLedgerReason, delta: number): CreditLedgerOperationType {
  const normalized = String(reason).toLowerCase();
  if (normalized.includes("reversal")) return "reversal";
  if (normalized.includes("reconcile") || normalized.includes("renewal") || normalized.includes("expired")) return "reconcile";
  if (normalized.includes("refund")) return "refund";
  if (normalized.includes("advance") || normalized.includes("grant") || normalized.includes("topup") || normalized.includes("subscription")) {
    return "admin_adjustment";
  }
  if (delta < 0) return "charge";
  return "admin_adjustment";
}

export async function tryCreateCreditLedgerEntry(
  tx: any,
  data: {
    userId: string;
    generationId?: string | null;
    projectId?: string | null;
    jobId?: string | null;
    idempotencyKey?: string | null;
    providerUsageRecordId?: string | null;
    quoteSnapshotId?: string | null;
    originalEntryId?: string | null;
    delta: number;
    reason: CreditLedgerReason;
    operationType?: CreditLedgerOperationType;
    status?: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!tx?.creditLedgerEntry?.create) {
    throw new CreditLedgerUnavailableError();
  }
  await tx.creditLedgerEntry.create({
    data: {
      userId: data.userId,
      generationId: data.generationId ?? null,
      projectId: data.projectId ?? null,
      jobId: data.jobId ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
      providerUsageRecordId: data.providerUsageRecordId ?? null,
      quoteSnapshotId: data.quoteSnapshotId ?? null,
      originalEntryId: data.originalEntryId ?? null,
      delta: data.delta,
      reason: data.reason,
      operationType: data.operationType ?? inferLedgerOperationType(data.reason, data.delta),
      status: data.status ?? "settled",
      metadata: data.metadata ?? undefined,
    },
  });
}

// ─── Credit Expiry & Renewal ─────────────────────────────────────────────────

export async function handleCreditExpiry(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await runCreditReconciliation({ targetUserId: userId, dryRun: false });
  } catch (error) {
    console.error(`[handleCreditExpiry] Reconciliation failed for user ${userId}:`, error);
    // If reconciliation failed, fail fast or re-throw so unverified credits cannot be spent
    throw error;
  }
}

/**
 * Return the user's existing expiry IF it is still in the future, otherwise
 * fall back to (now + 30 days). Used by topups: they MUST NOT extend the
 * current cycle (no rollover), but new users with no active cycle still
 * need a 30-day window to spend what they just purchased.
 */
export function preserveExpiryOrFresh(current: Date | null | undefined): Date {
  const now = Date.now();
  if (current && current.getTime() > now) return current;
  return new Date(now + THIRTY_DAYS_MS);
}

/**
 * Allocate subscription credits to a user after payment.
 *
 * Behaviour (no rollover — matches the stated business model):
 *   - creditBalance = plan.credits         → replaces the balance, any
 *                                              unused credits from the
 *                                              previous cycle are discarded.
 *   - monthlyCredits = plan.credits        → recorded for auto-renew use.
 *   - creditsExpireAt = now + 30 days      → fresh 30-day window starts.
 *                                              Annual subscribers refresh
 *                                              monthly via handleCreditExpiry().
 *
 * Same function used by Stripe webhook AND manual admin-approval flow,
 * so both payment paths behave identically.
 */
export async function allocateSubscriptionCredits(
  userId: string,
  planId: string,
  billingInterval: "monthly" | "annual",
): Promise<void> {
  void billingInterval;
  await ensureUserRow(userId);
  const plan = SAAD_PLANS.find((p) => p.id === planId);
  if (!plan) return;

  // The Podcast Automation plan (id: "podcast") has 0 credits.
  // Approving/renewing it should not reset or modify the user's credits balance.
  if (planId === "podcast") return;

  const now = new Date();
  await prismadb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        creditBalance: plan.credits,
        monthlyCredits: plan.credits,
        creditsExpireAt: new Date(now.getTime() + THIRTY_DAYS_MS),
        lastCreditRenewal: now,
        creditAdvanceBalance: 0,
        creditAdvanceRequestedAt: null,
        creditAdvanceCycleEnd: null,
      },
    });

    await tryCreateCreditLedgerEntry(tx, {
      userId,
      delta: plan.credits,
      reason: "subscription_grant",
      operationType: "admin_adjustment",
    });
  });
}

function sameCycleEnd(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return Boolean(a && b && a.getTime() === b.getTime());
}

export const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export function isWithinLastTwoMonthsOfSubscription(
  stripeCurrentPeriodEnd: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!stripeCurrentPeriodEnd) return false;
  return now.getTime() >= stripeCurrentPeriodEnd.getTime() - SIXTY_DAYS_MS;
}

export async function requestAnnualCreditAdvance(userId: string, requestedAmount?: number) {
  await ensureUserRow(userId);
  await handleCreditExpiry(userId);

  const now = new Date();

  return await prismadb.$transaction(async (tx) => {
    const [user, subscription] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: {
          creditBalance: true,
          monthlyCredits: true,
          creditsExpireAt: true,
          creditAdvanceBalance: true,
          creditAdvanceCycleEnd: true,
        },
      }),
      tx.userSubscription.findUnique({
        where: { userId },
        select: {
          billingInterval: true,
          planId: true,
          stripePriceId: true,
          stripeCurrentPeriodEnd: true,
        },
      }),
    ]);

    const isSubscriptionActive = Boolean(
      subscription?.stripePriceId &&
        subscription?.stripeCurrentPeriodEnd &&
        subscription.stripeCurrentPeriodEnd.getTime() > now.getTime(),
    );

    if (!isSubscriptionActive || subscription?.billingInterval !== "annual") {
      throw new CreditAdvanceError("annual_subscription_required", "Credit advance is available for active annual subscriptions only.");
    }

    // Restrict credit advance in the last two months (60 days) of the subscription
    if (isWithinLastTwoMonthsOfSubscription(subscription?.stripeCurrentPeriodEnd, now)) {
      throw new CreditAdvanceError(
        "last_two_months_restriction",
        "لا يمكن طلب السلفة خلال آخر شهرين من الاشتراك السنوي. (Credit advance is not available during the last two months of the annual subscription.)"
      );
    }

    if (!user?.creditsExpireAt || user.creditsExpireAt.getTime() <= now.getTime()) {
      throw new CreditAdvanceError("no_active_credit_cycle", "No active credit cycle is available for advance credits.");
    }

    if (sameCycleEnd(user.creditAdvanceCycleEnd, user.creditsExpireAt)) {
      throw new CreditAdvanceError("already_requested_this_cycle", "Credit advance was already requested for this credit cycle.");
    }

    const planCredits = subscription.planId
      ? (SAAD_PLANS.find((p) => p.id === subscription.planId)?.credits ?? 0)
      : 0;
    const monthlyCredits = Math.max(0, Math.floor(planCredits || user.monthlyCredits || 0));
    if (monthlyCredits <= 0) {
      throw new CreditAdvanceError("no_monthly_allowance", "No monthly allowance is configured for this annual subscription.");
    }

    const amount = requestedAmount == null
      ? monthlyCredits
      : Math.max(0, Math.floor(requestedAmount));

    if (amount <= 0 || amount > monthlyCredits) {
      throw new CreditAdvanceError("invalid_advance_amount", "Advance amount must be between 1 and the monthly allowance.");
    }

    // ATOMIC CAS UPDATE: Guard against concurrent requests claiming the same cycle
    const updateClaim = await tx.user.updateMany({
      where: {
        id: userId,
        OR: [
          { creditAdvanceCycleEnd: null },
          { creditAdvanceCycleEnd: { not: user.creditsExpireAt } },
        ],
      },
      data: {
        creditBalance: { increment: amount },
        creditAdvanceBalance: { increment: amount },
        creditAdvanceRequestedAt: now,
        creditAdvanceCycleEnd: user.creditsExpireAt,
      },
    });

    if (updateClaim.count === 0) {
      throw new CreditAdvanceError("already_requested_this_cycle", "Credit advance was already requested for this credit cycle.");
    }

    const updated = await tx.user.findUnique({
      where: { id: userId },
      select: {
        creditBalance: true,
        monthlyCredits: true,
        creditsExpireAt: true,
        creditAdvanceBalance: true,
        creditAdvanceRequestedAt: true,
        creditAdvanceCycleEnd: true,
      },
    });

    if (!updated) {
      throw new Error("User not found after advance update");
    }

    await tryCreateCreditLedgerEntry(tx, {
      userId,
      delta: amount,
      reason: `annual_credit_advance_draw: +${amount} cr`,
      operationType: "admin_adjustment",
    });

    return {
      credited: amount,
      creditBalance: updated.creditBalance,
      monthlyCredits: updated.monthlyCredits,
      creditsExpireAt: updated.creditsExpireAt,
      creditAdvanceBalance: updated.creditAdvanceBalance,
      creditAdvanceRequestedAt: updated.creditAdvanceRequestedAt,
      creditAdvanceCycleEnd: updated.creditAdvanceCycleEnd,
    };
  });
}

/**
 * Add stand-alone topup credits to a user.
 *
 * STRICT NO-ROLLOVER POLICY:
 *   - creditBalance is incremented by the purchased amount.
 *   - creditsExpireAt is INHERITED from the user's current cycle. The topup
 *     does NOT extend the cycle and the topup credits die together with the
 *     rest of the pool when the cycle ends — there is no carryover into
 *     the next month, ever.
 *   - For users with no active cycle (free users / expired credits), the
 *     topup opens a single fresh 30-day window so the purchase is usable.
 */
export async function applyTopupCredits(userId: string, credits: number): Promise<void> {
  const safeCredits = Math.max(0, Math.floor(credits));
  if (!userId || safeCredits <= 0) return;
  await ensureUserRow(userId);

  const existing = await prismadb.user.findUnique({
    where: { id: userId },
    select: { creditsExpireAt: true },
  });

  const finalExpiry = preserveExpiryOrFresh(existing?.creditsExpireAt);

  await prismadb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        creditBalance: { increment: safeCredits },
        creditsExpireAt: finalExpiry,
      },
    });

    await tryCreateCreditLedgerEntry(tx, {
      userId,
      delta: safeCredits,
      reason: "topup_grant",
      operationType: "admin_adjustment",
    });
  });
}

type SpendCreditsInput = {
  userId: string;
  credits: number;
  prompt: string;
  assetType: string;
  modelUsed: string;
  mediaUrl?: string | null;
  resolution?: string | null;
  duration?: number | null;
  aspectRatio?: string | null;
  quality?: string | null;
  providerName?: string | null;
  providerModel?: string | null;
  providerRequestId?: string | null;
  providerCostUsd?: number | null;
  providerTokens?: number | null;
  providerCredits?: number | null;
  providerCostSource?: string | null;
  profileId?: string | null;

  // Snapshot fields
  generationType?: string | null;
  mode?: string | null;
  inputType?: string | null;
  requestPayload?: any;
  estimatedProviderCostUsd?: number | null;
  idempotency?: {
    route: string;
    key: string | null;
    operationType?: string;
  };
};


function inferGenerationType(assetType: string): "image" | "video" {
  const t = String(assetType || "").toLowerCase();
  return t.includes("video") ? "video" : "image";
}

function isPublicHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function resolveProviderTrackingFallback(input: {
  modelUsed: string;
  duration?: number | null;
  resolution?: string | null;
  quality?: string | null;
  providerName?: string | null;
  providerModel?: string | null;
  providerCostUsd?: number | null;
  providerCostSource?: string | null;
  providerCredits?: number | null;
  providerTokens?: number | null;
}) {
  let providerName = input.providerName;
  let providerModel = input.providerModel;
  let providerCostUsd = input.providerCostUsd;
  let providerCostSource = input.providerCostSource;
  let providerCredits = input.providerCredits;
  let providerTokens = input.providerTokens;

  const modelLower = (input.modelUsed || "").toLowerCase();

  if (!providerName) {
    if (modelLower.includes("dreamina") || modelLower.includes("seedance") || modelLower.includes("byteplus") || modelLower.includes("bytedance")) {
      providerName = "BytePlus";
    } else if (modelLower.includes("veo") || modelLower.includes("gemini") || modelLower.includes("google") || modelLower.includes("banana") || modelLower.includes("imagen")) {
      providerName = "Google";
    } else if (modelLower.includes("openai") || modelLower.includes("sora") || modelLower.includes("gpt") || modelLower.includes("dall-e")) {
      providerName = "OpenAI";
    } else if (modelLower.includes("wavespeed") || modelLower.includes("heartmula") || modelLower.includes("music_gen") || modelLower.includes("music") || modelLower.includes("transition")) {
      providerName = "WaveSpeed";
    } else if (modelLower.includes("reap") || modelLower.includes("clipcraft")) {
      providerName = "Reap";
    } else {
      providerName = "KIE.ai";
    }
  }

  if (!providerModel) {
    providerModel = input.modelUsed;
  }

  if (providerCostUsd === undefined || providerCostUsd === null) {
    try {
      const { resolveProviderCostPrecedence } = await import("./provider-cost-capture");
      const precedenceRes = resolveProviderCostPrecedence({
        generationId: "preflight",
        modelRef: input.modelUsed,
        providerName,
        providerModel,
        providerRoute: (input as any).providerRoute || (input as any).routeModel,
        durationSec: input.duration || 5,
        quality: input.quality,
        resolution: input.resolution,
        actualCostUsd: input.providerCostSource === "actual" ? input.providerCostUsd : undefined,
      });

      providerCostUsd = precedenceRes.providerCostUsd;
      providerCostSource = precedenceRes.providerCostSource;
      providerName = precedenceRes.providerName;
      if (precedenceRes.providerModel) {
        providerModel = precedenceRes.providerModel;
      }
      if (providerName === "KIE.ai" && precedenceRes.providerCostUsd !== null && providerCredits === null) {
        providerCredits = precedenceRes.providerCostUsd / 0.005;
      }
    } catch (e) {
      console.error("[resolveProviderTrackingFallback] Failed to estimate provider cost:", e);
      providerCostUsd = null;
      providerCostSource = "unknown";
    }
  }

  return {
    providerName,
    providerModel,
    providerCostUsd,
    providerCostSource: providerCostSource || "unknown",
    providerCredits,
    providerTokens,
  };
}

async function createRequestSnapshot(
  tx: any,
  generationId: string,
  userId: string,
  input: SpendCreditsInput,
  resolved: any,
  credits: number
) {
  try {
    const payload = input.requestPayload || null;
    let mode = input.mode || null;
    let generationType = input.generationType || null;
    let duration = input.duration ?? null;
    let resolution = input.resolution ?? null;
    let aspectRatio = input.aspectRatio ?? null;
    let quality = input.quality ?? null;
    let inputType = input.inputType || null;

    // Try to infer from payload if not explicitly passed
    if (payload && typeof payload === "object") {
      // mode
      if (!mode) {
        mode = payload.mode ?? payload.quality ?? payload.style ?? null;
      }
      // generationType
      if (!generationType) {
        generationType = payload.generation_type ?? payload.generationType ?? payload.type ?? null;
        if (!generationType) {
          const hasDirectImage = !!(
            payload.image_url ??
            payload.imageUrl ??
            payload.image ??
            payload.images ??
            payload.first_frame_url ??
            payload.firstFrameUrl ??
            payload.start_image ??
            payload.startImage ??
            payload.imageUrls ??
            payload.imageUrlList
          );
          const hasReferences = !!(
            payload.reference_image_urls ??
            payload.referenceImageUrls ??
            payload.reference_video_urls ??
            payload.referenceVideoUrls ??
            payload.reference_audio_urls ??
            payload.referenceAudioUrls
          );
          const isVideo = String(input.assetType || "").toLowerCase().includes("video");
          if (isVideo) {
            generationType = hasDirectImage ? "image-to-video" : hasReferences ? "reference-to-video" : "text-to-video";
          } else {
            generationType = hasDirectImage ? "image-to-image" : "text-to-image";
          }
        }
      }
      // duration
      if (duration === null || duration === undefined) {
        duration = payload.duration ?? payload.duration_seconds ?? payload.seconds ?? null;
      }
      // resolution
      if (!resolution) {
        resolution = payload.resolution ?? payload.target_res ?? payload.size ?? null;
      }
      // aspectRatio
      if (!aspectRatio) {
        aspectRatio = payload.aspect_ratio ?? payload.aspectRatio ?? payload.ratio ?? null;
      }
      // quality
      if (!quality) {
        quality = payload.quality ?? payload.mode ?? null;
      }
      // inputType
      if (!inputType) {
        const hasDirectVideo = !!(
          payload.videoUrl ??
          payload.video_url ??
          payload.video
        );
        const hasDirectImage = !!(
          payload.imageUrl ??
          payload.image_url ??
          payload.image ??
          payload.first_frame_url ??
          payload.firstFrameUrl
        );
        const hasReferences = !!(
          payload.reference_image_urls ??
          payload.referenceImageUrls ??
          payload.reference_video_urls ??
          payload.referenceVideoUrls ??
          payload.reference_audio_urls ??
          payload.referenceAudioUrls
        );
        if (hasDirectVideo) inputType = "video";
        else if (hasDirectImage) inputType = "image";
        else if (hasReferences) inputType = "reference";
        else inputType = "text";
      }
    }

    // Coerce values to clean types
    if (duration !== null && duration !== undefined) {
      duration = Number(duration);
      if (isNaN(duration)) duration = null;
    }
    if (mode !== null && mode !== undefined) mode = String(mode);
    if (generationType !== null && generationType !== undefined) generationType = String(generationType);
    if (resolution !== null && resolution !== undefined) resolution = String(resolution);
    if (aspectRatio !== null && aspectRatio !== undefined) aspectRatio = String(aspectRatio);
    if (quality !== null && quality !== undefined) quality = String(quality);
    if (inputType !== null && inputType !== undefined) inputType = String(inputType);

    let modelName = resolved.providerModel ?? null;
    let providerName = resolved.providerName ?? null;
    const isMiniModel =
      input.modelUsed === "bytedance-seedance-v2-t2v-mini" ||
      input.modelUsed === "bytedance/seedance-v2/text-to-video-mini" ||
      input.modelUsed === "bytedance/seedance-2-mini" ||
      String(modelName).toLowerCase().includes("mini");

    if (isMiniModel) {
      modelName = "seedance-2.0-mini";
      providerName = "BytePlus";
    }

    await tx.generationRequestSnapshot.create({
      data: {
        generationId,
        userId,
        provider: providerName,
        model: modelName,
        generationType,
        duration,
        resolution,
        aspectRatio,
        quality,
        mode,
        inputType,
        userCreditsCharged: credits,
        estimatedProviderCostUsd: resolved.providerCostUsd ?? null,
        requestPayload: payload,
      },
    });
  } catch (error) {
    console.error("[createRequestSnapshot] Failed to write generation request snapshot:", error);
  }
}

export async function spendCredits(input: SpendCreditsInput) {
  const credits = Math.max(0, Math.ceil(input.credits));
  if (credits <= 0) {
    throw new Error(`Invalid credit amount: ${input.credits}`);
  }

  await ensureUserRow(input.userId);

  // Handle credit expiry/renewal before checking balance
  await handleCreditExpiry(input.userId);

  const result = await prismadb.$transaction(async (tx) => {
    const updatedCount = await tx.user.updateMany({
      where: {
        id: input.userId,
        creditBalance: { gte: credits },
      },
      data: { creditBalance: { decrement: credits } },
    });

    if (updatedCount.count !== 1) {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { creditBalance: true },
      });
      const balance = user?.creditBalance ?? 0;
      throw new InsufficientCreditsError(balance, credits);
    }

    const updated = await tx.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });

    const resolved = await resolveProviderTrackingFallback({
      modelUsed: input.modelUsed,
      duration: input.duration,
      resolution: input.resolution,
      quality: input.quality,
      providerName: input.providerName,
      providerModel: input.providerModel,
      providerCostUsd: input.providerCostUsd,
      providerCostSource: input.providerCostSource,
      providerCredits: input.providerCredits,
      providerTokens: input.providerTokens,
    });

    const generation = await tx.generation.create({
      data: {
        userId: input.userId,
        profileId: input.profileId ?? null,
        prompt: input.prompt,
        assetType: input.assetType,
        modelUsed: input.modelUsed,
        mediaUrl: input.mediaUrl ?? null,
        outputUrl: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? input.mediaUrl : null,
        type: inferGenerationType(input.assetType),
        status: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? "completed" : "queued",
        cost: credits,
        resolution: input.resolution ?? null,
        duration: input.duration ?? null,
        aspectRatio: input.aspectRatio ?? null,
        quality: input.quality ?? null,
        providerName: resolved.providerName ?? null,
        providerModel: resolved.providerModel ?? null,
        providerRequestId: input.providerRequestId ?? null,
        providerCostUsd: resolved.providerCostUsd ?? null,
        providerTokens: resolved.providerTokens ?? null,
        providerCredits: resolved.providerCredits ?? null,
        providerCostSource: resolved.providerCostSource ?? null,
      },
      select: { id: true },
    });

    const providerUsageRecord = await tx.providerUsageRecord.create({
      data: {
        userId: input.userId,
        generationId: generation.id,
        providerName: resolved.providerName ?? null,
        providerModel: resolved.providerModel ?? null,
        providerRequestId: input.providerRequestId ?? null,
        providerCostUsd: resolved.providerCostUsd ?? null,
        providerTokens: resolved.providerTokens ?? null,
        providerCredits: resolved.providerCredits ?? null,
        providerCostSource: resolved.providerCostSource ?? null,
        duration: input.duration ?? null,
        resolution: input.resolution ?? null,
        quality: input.quality ?? null,
        aspectRatio: input.aspectRatio ?? null,
        status: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? "completed" : "queued",
      },
      select: { id: true },
    });

    await createRequestSnapshot(tx, generation.id, input.userId, input, resolved, credits);

    await tryCreateCreditLedgerEntry(tx as any, {
      userId: input.userId,
      generationId: generation.id,
      providerUsageRecordId: providerUsageRecord.id,
      idempotencyKey: input.idempotency?.key ?? null,
      delta: -credits,
      reason: "generation_charge",
      operationType: "charge",
    });

    if (input.idempotency?.key) {
      await (tx as any).apiIdempotency.update({
        where: {
          userId_route_operationType_key: {
            userId: input.userId,
            route: input.idempotency.route,
            operationType: input.idempotency.operationType ?? "generation",
            key: input.idempotency.key,
          },
        },
        data: { generationId: generation.id },
      });
    }

    return { remainingCredits: Math.max(0, updated?.creditBalance ?? 0), generationId: generation.id };
  });

  await maybeSendLowCreditAlert(input.userId, result.remainingCredits).catch((error) => {
    console.error("[credit alert] failed:", error);
  });

  return result;
}

export async function recordFreeGeneration(input: Omit<SpendCreditsInput, "credits">) {
  await ensureUserRow(input.userId);

  const resolved = await resolveProviderTrackingFallback({
    modelUsed: input.modelUsed,
    duration: input.duration,
    resolution: input.resolution,
    quality: input.quality,
    providerName: input.providerName,
    providerModel: input.providerModel,
    providerCostUsd: input.providerCostUsd,
    providerCostSource: input.providerCostSource,
    providerCredits: input.providerCredits,
    providerTokens: input.providerTokens,
  });

  const generation = await prismadb.generation.create({
    data: {
      userId: input.userId,
      profileId: input.profileId ?? null,
      prompt: input.prompt,
      assetType: input.assetType,
      modelUsed: input.modelUsed,
      mediaUrl: input.mediaUrl ?? null,
      outputUrl: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? input.mediaUrl : null,
      type: inferGenerationType(input.assetType),
      status: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? "completed" : "queued",
      cost: 0,
      resolution: input.resolution ?? null,
      duration: input.duration ?? null,
      aspectRatio: input.aspectRatio ?? null,
      quality: input.quality ?? null,
      providerName: resolved.providerName ?? null,
      providerModel: resolved.providerModel ?? null,
      providerRequestId: input.providerRequestId ?? null,
      providerCostUsd: resolved.providerCostUsd ?? null,
      providerTokens: resolved.providerTokens ?? null,
      providerCredits: resolved.providerCredits ?? null,
      providerCostSource: resolved.providerCostSource ?? null,
    },
    select: { id: true },
  });

  await prismadb.providerUsageRecord.create({
    data: {
      userId: input.userId,
      generationId: generation.id,
      providerName: resolved.providerName ?? null,
      providerModel: resolved.providerModel ?? null,
      providerRequestId: input.providerRequestId ?? null,
      providerCostUsd: resolved.providerCostUsd ?? null,
      providerTokens: resolved.providerTokens ?? null,
      providerCredits: resolved.providerCredits ?? null,
      providerCostSource: resolved.providerCostSource ?? null,
      duration: input.duration ?? null,
      resolution: input.resolution ?? null,
      quality: input.quality ?? null,
      aspectRatio: input.aspectRatio ?? null,
      status: input.mediaUrl && isPublicHttpUrl(input.mediaUrl) ? "completed" : "queued",
    },
  });

  await createRequestSnapshot(prismadb, generation.id, input.userId, { ...input, credits: 0 }, resolved, 0);

  return { remainingCredits: null, generationId: generation.id };
}

export async function refundCredits(userId: string, credits: number) {
  const safeCredits = Math.max(0, Math.floor(credits));
  if (safeCredits <= 0) return;
  await ensureUserRow(userId);
  await prismadb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: safeCredits } },
    });
    await tryCreateCreditLedgerEntry(tx, {
      userId,
      delta: safeCredits,
      reason: "generation_refund_provider_failed",
      operationType: "refund",
    });
  });
}

export async function refundCreditsWithReason(
  userId: string,
  credits: number,
  reason: Exclude<CreditLedgerReason, "generation_charge">,
  generationId?: string | null,
): Promise<void> {
  const safeCredits = Math.max(0, Math.floor(credits));
  if (!userId || safeCredits <= 0) return;
  await ensureUserRow(userId);
  await prismadb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: safeCredits } },
    });
    await tryCreateCreditLedgerEntry(tx as any, {
      userId,
      generationId: generationId ?? null,
      delta: safeCredits,
      reason,
      operationType: "refund",
    });
  });
}


type RefundGenerationChargeOptions = {
  reason: CreditLedgerReason;
  clearMediaUrl?: boolean;
  flagGeneration?: boolean;
};

export async function refundGenerationCharge(
  generationId: string,
  userId: string,
  credits: number,
  options: RefundGenerationChargeOptions,
): Promise<void> {
  if (!generationId || !userId) return;

  const clearMediaUrl = options.clearMediaUrl !== false;
  const flagGeneration = options.flagGeneration === true;

  await prismadb.$transaction(async (tx) => {
    const generation = await tx.generation.findUnique({
      where: { id: generationId },
      select: { id: true, cost: true, isFlagged: true },
    });

    if (!generation || generation.cost <= 0) return;
    const refundCredits = Math.max(0, Math.floor(generation.cost));
    if (refundCredits <= 0) return;

    const claim = await tx.generation.updateMany({
      where: { id: generationId, userId, cost: generation.cost },
      data: {
        cost: 0,
        ...(clearMediaUrl ? { mediaUrl: null, outputUrl: null } : {}),
        status: "failed",
        ...(flagGeneration && !generation.isFlagged ? { isFlagged: true } : {}),
      },
    });
    if ((claim.count ?? 0) !== 1) return;

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: refundCredits } },
    });

    await tryCreateCreditLedgerEntry(tx as any, {
      userId,
      generationId,
      delta: refundCredits,
      reason: options.reason,
      operationType: "refund",
      metadata: {
        requestedCredits: credits,
        refundedCredits: refundCredits,
      },
    });
  });
}

export async function setGenerationMediaUrl(generationId: string, mediaUrl: string) {
  if (!generationId || !mediaUrl) return;
  const gen = await prismadb.generation.findUnique({
    where: { id: generationId },
    select: { id: true, userId: true, assetType: true },
  });

  let finalUrl: string | null = mediaUrl;
  if (gen && isStorageConfigured() && isPublicHttpUrl(mediaUrl)) {
    const persisted = await uploadUrlToStorage({
      remoteUrl: mediaUrl,
      userId: gen.userId,
      assetType: gen.assetType,
      generationId: gen.id,
    });
    if (!persisted) {
      throw new Error(`Failed to persist generated ${gen.assetType} media to active storage before completing generation ${generationId}`);
    }
    finalUrl = persisted;
  }

  await prismadb.generation.updateMany({
    where: { id: generationId },
    data: {
      mediaUrl: finalUrl,
      outputUrl: finalUrl,
      status: finalUrl && finalUrl.startsWith("task:") ? "processing" : "completed",
      ...(gen ? { type: inferGenerationType(gen.assetType) } : {}),
    },
  });

  await prismadb.providerUsageRecord.updateMany({
    where: { generationId },
    data: {
      status: finalUrl && finalUrl.startsWith("task:") ? "processing" : "completed",
    },
  }).catch((e) => console.error("[setGenerationMediaUrl] Failed to update ProviderUsageRecord status:", e));

  const generationType = gen ? inferGenerationType(gen.assetType) : undefined;
  if (gen && finalUrl && !finalUrl.startsWith("task:") && !finalUrl.startsWith("failed:")) {
    if (generationType === "video") scheduleVideoPosterGeneration(generationId, "setGenerationMediaUrl");
    if (generationType === "image") scheduleImageThumbnailGeneration(generationId, "setGenerationMediaUrl");
  }

  void maybeScanAndFlagGeneration(generationId).catch(() => {});
}

/**
 * When a single generation produces multiple images (e.g. numImages=4),
 * the main generation record already holds the first URL.
 * Call this to persist each additional URL as a separate zero-cost record
 * so all images appear in the user's gallery after page refresh.
 */
export async function saveAdditionalGenerationUrls(
  userId: string,
  prompt: string,
  modelUsed: string,
  assetType: string,
  additionalUrls: string[],
  profileId?: string | null,
): Promise<void> {
  if (!additionalUrls.length || !userId) return;
  const prepared = await Promise.all(
    additionalUrls.map(async (url, idx) => {
      let finalUrl: string | null = url;
      if (isStorageConfigured() && isPublicHttpUrl(url)) {
        const persisted = await uploadUrlToStorage({
          remoteUrl: url,
          userId,
          assetType,
          generationId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${idx}`,
        });
        if (!persisted) {
          throw new Error(`Failed to persist additional generated ${assetType} media to active storage`);
        }
        finalUrl = persisted;
      }
      return {
        userId,
        profileId: profileId ?? null,
        prompt,
        mediaUrl: finalUrl,
        outputUrl: finalUrl,
        assetType,
        modelUsed,
        type: inferGenerationType(assetType),
        status: finalUrl ? "completed" : "queued",
        cost: 0,
      };
    }),
  );

  const created = [] as { id: string; type: string | null; mediaUrl: string | null }[];
  for (const data of prepared) {
    const row = await prismadb.generation.create({ data, select: { id: true, type: true, mediaUrl: true } });
    created.push(row);
  }

  for (const row of created) {
    if (row.type === "image" && row.mediaUrl) scheduleImageThumbnailGeneration(row.id, "additional-image-url");
  }
  void maybeScanAndFlagRecentGenerationsByMediaUrls(userId, additionalUrls).catch(() => {});
}

export async function setGenerationTaskMarker(generationId: string, taskId: string) {
  if (!generationId || !taskId) return;
  await prismadb.generation.updateMany({
    where: { id: generationId },
    data: { mediaUrl: `task:${taskId}`, outputUrl: null, status: "processing" },
  });
  await prismadb.providerUsageRecord.updateMany({
    where: { generationId },
    data: { providerRequestId: taskId, status: "processing" },
  }).catch((e) => console.error("[setGenerationTaskMarker] Failed to sync ProviderUsageRecord:", e));
}

export async function setGenerationCompletedWithoutMedia(generationId: string) {
  if (!generationId) return;
  await prismadb.generation.updateMany({
    where: { id: generationId },
    data: { status: "completed" },
  });
  await prismadb.providerUsageRecord.updateMany({
    where: { generationId },
    data: { status: "completed" },
  }).catch((e) => console.error("[setGenerationCompletedWithoutMedia] Failed to update ProviderUsageRecord status:", e));
}

export async function setActualProviderUsage(
  generationId: string,
  data: {
    providerName: string;
    providerModel?: string | null;
    providerRequestId?: string | null;
    status?: string | null;
  },
) {
  if (!generationId) return;
  await prismadb.generation.updateMany({
    where: { id: generationId },
    data: {
      providerName: data.providerName,
      providerModel: data.providerModel ?? null,
      ...(data.providerRequestId !== undefined ? { providerRequestId: data.providerRequestId } : {}),
    },
  });
  await prismadb.providerUsageRecord.updateMany({
    where: { generationId },
    data: {
      providerName: data.providerName,
      providerModel: data.providerModel ?? null,
      ...(data.providerRequestId !== undefined ? { providerRequestId: data.providerRequestId } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  }).catch((e) => console.error("[setActualProviderUsage] Failed to sync ProviderUsageRecord:", e));
}

export async function rollbackGenerationCharge(generationId: string, userId: string, credits: number) {
  if (!generationId || !userId) return;

  await prismadb.$transaction(async (tx) => {
    const generation = await tx.generation.findUnique({
      where: { id: generationId },
      select: { id: true, cost: true },
    });

    // Already rolled back or missing.
    if (!generation || generation.cost <= 0) return;
    const refundCredits = Math.max(0, Math.floor(generation.cost));
    if (refundCredits <= 0) return;

    const claim = await tx.generation.updateMany({
      where: { id: generationId, userId, cost: generation.cost },
      data: {
        cost: 0,
        mediaUrl: null,
        outputUrl: null,
        status: "failed",
        isFlagged: true,
      },
    });
    if ((claim.count ?? 0) !== 1) return;

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: refundCredits } },
    });

    await tryCreateCreditLedgerEntry(tx as any, {
      userId,
      generationId,
      delta: refundCredits,
      reason: "generation_refund_provider_failed",
      operationType: "refund",
      metadata: {
        requestedCredits: credits,
        refundedCredits: refundCredits,
      },
    });
  });
}

type GenerationPrecheckInput = {
  prompt: string;
  negativePrompt?: string | null;
  extraText?: string | null;
};

export type GenerationPrecheckResult =
  | { allowed: true }
  | { allowed: false; message: string; reason: string };

function getPrecheckEnabled(): boolean {
  const raw = String(process.env.GENERATION_PRECHECK_ENABLED ?? "1").trim();
  return raw !== "0";
}

function getOpenAiPrecheckBlocking(): boolean {
  const raw = String(process.env.GENERATION_PRECHECK_OPENAI_BLOCKING ?? "0").trim();
  return raw === "1";
}

function normalizeCombinedText(input: GenerationPrecheckInput): string {
  const parts = [input.prompt, input.negativePrompt ?? "", input.extraText ?? ""]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.join("\n").slice(0, 8000);
}

export function keywordBlocksPrompt(text: string): boolean {
  let p = (text || "").toLowerCase().trim();
  if (!p) return false;

  // Bypass if the prompt is just a reference tag (e.g. "@image1")
  if (/^@image[1-9]$/i.test(p)) {
    return false;
  }

  // Strip any base64 data URLs to prevent random false positives from base64 characters matching keywords
  p = p.replace(/data:image\/[^;]+;base64,[^\s]+/g, "");
  p = p.replace(/base64,[^\s]+/g, "");

  p = p.replace(/\bnude[-\s]?(berry|beige|pink|brown|peach|rose|mauve|lipstick|makeup|shade|color|tone|palette)\b/gi, "$1");
  p = p.replace(/\b(lipstick|makeup|shade|color|tone|palette)[-\s]?nude\b/gi, "$1");
  const patterns: RegExp[] = [
    /\b(nude|naked|porn|porno|sex\s*act|explicit|genitals|penis|vagina)\b/i,
    /\b(blowjob|handjob|anal|cumshot|orgasm)\b/i,
    /(عاري|عريان|تعري|إباحي|إباحية|سكس|جنس|قضيب|مهبل)/i,
  ];
  return patterns.some((re) => re.test(p));
}

async function openAiPromptModeration(text: string, model: string): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(2_500),
  }).catch(() => null);

  if (!res || !res.ok) return false;
  const json = (await res.json().catch(() => null)) as any;
  return Boolean(json?.results?.[0]?.flagged);
}

export async function precheckGenerationPolicy(input: GenerationPrecheckInput): Promise<GenerationPrecheckResult> {
  if (!getPrecheckEnabled()) return { allowed: true };

  const text = normalizeCombinedText(input);
  if (!text) return { allowed: true };

  if (keywordBlocksPrompt(text)) {
    console.warn("[safety] keyword check failed for text:", JSON.stringify(text));
    return {
      allowed: false,
      message: "Request blocked by safety policy.",
      reason: "keyword_blocked",
    };
  }

  const model = String(process.env.GENERATION_PRECHECK_OPENAI_MODEL ?? "omni-moderation-latest").trim()
    || "omni-moderation-latest";
  const flagged = await openAiPromptModeration(text, model).catch(() => false);
  if (flagged && getOpenAiPrecheckBlocking()) {
    return {
      allowed: false,
      message: "Request blocked by safety policy.",
      reason: "openai_moderation_flagged",
    };
  }

  return { allowed: true };
}

type NsfwScanConfig = {
  enabled: boolean;
  provider: "openai" | "keywords";
  openAiModel: string;
  includeImageUrls: boolean;
};

function getNsfwScanConfig(): NsfwScanConfig {
  const enabled = String(process.env.NSFW_SCAN_ENABLED ?? "").trim() === "1";
  const providerRaw = String(process.env.NSFW_SCAN_PROVIDER ?? "openai").trim().toLowerCase();
  const provider: "openai" | "keywords" = providerRaw === "keywords" ? "keywords" : "openai";
  const openAiModel = String(process.env.NSFW_SCAN_OPENAI_MODEL ?? "omni-moderation-latest").trim()
    || "omni-moderation-latest";
  const includeImageUrls = String(process.env.NSFW_SCAN_INCLUDE_IMAGE_URLS ?? "").trim() === "1";
  return { enabled, provider, openAiModel, includeImageUrls };
}

function isLikelyHttpImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const base = url.split("?")[0].toLowerCase();
  return base.endsWith(".png") || base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".webp") || base.endsWith(".gif");
}

async function flagGeneration(generationId: string): Promise<void> {
  await prismadb.generation.updateMany({
    where: { id: generationId },
    data: { isFlagged: true },
  });
}

async function openAiTextModeration(prompt: string, model: string): Promise<boolean> {
  return await openAiPromptModeration(prompt, model).catch(() => false);
}

async function openAiImageUrlModeration(imageUrl: string, model: string): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    }),
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);

  if (!res || !res.ok) return false;
  const json = (await res.json().catch(() => null)) as any;
  return Boolean(json?.results?.[0]?.flagged);
}

async function maybeScanAndFlagGeneration(generationId: string): Promise<void> {
  const cfg = getNsfwScanConfig();
  if (!cfg.enabled) return;

  const gen = await prismadb.generation.findUnique({
    where: { id: generationId },
    select: { id: true, prompt: true, mediaUrl: true, assetType: true, isFlagged: true },
  });
  if (!gen || gen.isFlagged) return;

  if (keywordBlocksPrompt(gen.prompt)) {
    await flagGeneration(gen.id);
    return;
  }

  if (cfg.provider === "openai") {
    const flaggedByText = await openAiTextModeration(gen.prompt, cfg.openAiModel).catch(() => false);
    if (flaggedByText) {
      await flagGeneration(gen.id);
      return;
    }

    const mediaUrl = typeof gen.mediaUrl === "string" ? gen.mediaUrl : "";
    if (cfg.includeImageUrls && mediaUrl && isLikelyHttpImageUrl(mediaUrl)) {
      const flaggedByImage = await openAiImageUrlModeration(mediaUrl, cfg.openAiModel).catch(() => false);
      if (flaggedByImage) {
        await flagGeneration(gen.id);
        return;
      }
    }
  }
}

async function maybeScanAndFlagRecentGenerationsByMediaUrls(userId: string, mediaUrls: string[]): Promise<void> {
  const cfg = getNsfwScanConfig();
  if (!cfg.enabled) return;
  if (!userId || !mediaUrls.length) return;

  const since = new Date(Date.now() - 10 * 60_000);
  const gens = await prismadb.generation.findMany({
    where: {
      userId,
      createdAt: { gte: since },
      mediaUrl: { in: mediaUrls },
      isFlagged: false,
    },
    select: { id: true },
    take: Math.min(25, mediaUrls.length),
  });

  await Promise.all(gens.map((g) => maybeScanAndFlagGeneration(g.id).catch(() => {})));
}

export async function finalizeReapGeneration(
  projectId: string,
  duration: number | null,
  /** When given, only that user's generations are finalized (callers acting for a user must pass it). */
  userId?: string,
): Promise<void> {
  if (!projectId) return;

  const generations = await prismadb.generation.findMany({
    where: {
      OR: [
        { mediaUrl: `task:reap:${projectId}` },
        { mediaUrl: `task:clipcraft:${projectId}` }
      ],
      ...(userId ? { userId } : {}),
    }
  });

  for (const gen of generations) {
    let actualDuration = duration;
    let actualCostUsd = gen.providerCostUsd;
    let actualCostSource = gen.providerCostSource || "estimated";

    if (actualDuration && actualDuration > 0) {
      try {
        const { estimateProviderCostSync } = await import("./pricing");
        const est = estimateProviderCostSync({
          modelRef: gen.modelUsed,
          providerName: gen.providerName || "Reap",
          providerModel: gen.providerModel,
          durationSec: actualDuration,
          resolution: gen.resolution,
          quality: gen.quality,
        });
        actualCostUsd = est.usd;
        actualCostSource = "actual";
      } catch (e) {
        console.error("[finalizeReapGeneration] Failed to estimate provider cost:", e);
      }
    }

    await prismadb.generation.update({
      where: { id: gen.id },
      data: {
        duration: actualDuration ?? gen.duration,
        providerCostUsd: actualCostUsd,
        providerCostSource: actualCostSource,
      }
    });

    await prismadb.providerUsageRecord.updateMany({
      where: { generationId: gen.id },
      data: {
        duration: actualDuration ?? gen.duration,
        providerCostUsd: actualCostUsd,
        providerCostSource: actualCostSource,
        status: "completed",
      }
    });
  }
}

export async function updateProviderUsageRecord(
  generationId: string,
  data: {
    providerRequestId?: string | null;
    providerCostUsd?: number | null;
    providerTokens?: number | null;
    providerCredits?: number | null;
    providerCostSource?: string | null;
    duration?: number | null;
    resolution?: string | null;
    quality?: string | null;
    status?: string | null;
    rawPayloadSafe?: string | null;
  }
) {
  try {
    const existing = await prismadb.providerUsageRecord.findFirst({
      where: { generationId }
    });

    if (existing) {
      await prismadb.providerUsageRecord.update({
        where: { id: existing.id },
        data: {
          providerRequestId: data.providerRequestId !== undefined ? data.providerRequestId : existing.providerRequestId,
          providerCostUsd: data.providerCostUsd !== undefined ? data.providerCostUsd : existing.providerCostUsd,
          providerTokens: data.providerTokens !== undefined ? data.providerTokens : existing.providerTokens,
          providerCredits: data.providerCredits !== undefined ? data.providerCredits : existing.providerCredits,
          providerCostSource: data.providerCostSource !== undefined ? data.providerCostSource : existing.providerCostSource,
          duration: data.duration !== undefined ? data.duration : existing.duration,
          resolution: data.resolution !== undefined ? data.resolution : existing.resolution,
          quality: data.quality !== undefined ? data.quality : existing.quality,
          status: data.status !== undefined ? data.status : existing.status,
          rawPayloadSafe: data.rawPayloadSafe !== undefined ? data.rawPayloadSafe : existing.rawPayloadSafe,
        }
      });
      if (data.providerCostUsd !== undefined || data.providerCostSource !== undefined) {
        await prismadb.generation.updateMany({
          where: { id: generationId },
          data: {
            ...(data.providerCostUsd !== undefined ? { providerCostUsd: data.providerCostUsd } : {}),
            ...(data.providerCostSource !== undefined ? { providerCostSource: data.providerCostSource } : {}),
            ...(data.providerRequestId !== undefined ? { providerRequestId: data.providerRequestId } : {}),
          },
        }).catch(() => {});
      }
    } else {
      const gen = await prismadb.generation.findUnique({
        where: { id: generationId },
        select: { userId: true }
      });
      if (gen) {
        await prismadb.providerUsageRecord.create({
          data: {
            userId: gen.userId,
            generationId,
            providerRequestId: data.providerRequestId ?? null,
            providerCostUsd: data.providerCostUsd ?? null,
            providerTokens: data.providerTokens ?? null,
            providerCredits: data.providerCredits ?? null,
            providerCostSource: data.providerCostSource ?? null,
            duration: data.duration ?? null,
            resolution: data.resolution ?? null,
            quality: data.quality ?? null,
            status: data.status ?? null,
            rawPayloadSafe: data.rawPayloadSafe ?? null,
          }
        });
      }
    }
  } catch (e) {
    console.error("[updateProviderUsageRecord] Failed:", e);
  }
}

export async function updateProviderUsageRecordByRequestId(
  requestId: string,
  data: {
    providerCostUsd?: number | null;
    providerTokens?: number | null;
    providerCredits?: number | null;
    providerCostSource?: string | null;
    duration?: number | null;
    resolution?: string | null;
    quality?: string | null;
    status?: string | null;
    rawPayloadSafe?: string | null;
  }
) {
  try {
    const existing = await prismadb.providerUsageRecord.findFirst({
      where: { providerRequestId: requestId }
    });

    if (existing) {
      await prismadb.providerUsageRecord.update({
        where: { id: existing.id },
        data: {
          providerCostUsd: data.providerCostUsd !== undefined ? data.providerCostUsd : existing.providerCostUsd,
          providerTokens: data.providerTokens !== undefined ? data.providerTokens : existing.providerTokens,
          providerCredits: data.providerCredits !== undefined ? data.providerCredits : existing.providerCredits,
          providerCostSource: data.providerCostSource !== undefined ? data.providerCostSource : existing.providerCostSource,
          duration: data.duration !== undefined ? data.duration : existing.duration,
          resolution: data.resolution !== undefined ? data.resolution : existing.resolution,
          quality: data.quality !== undefined ? data.quality : existing.quality,
          status: data.status !== undefined ? data.status : existing.status,
          rawPayloadSafe: data.rawPayloadSafe !== undefined ? data.rawPayloadSafe : existing.rawPayloadSafe,
        }
      });
    }
  } catch (e) {
    console.error("[updateProviderUsageRecordByRequestId] Failed:", e);
  }
}
