import {
  refundGenerationCharge,
  rollbackGenerationCharge,
  setGenerationMediaUrl,
  spendCredits,
} from "@/lib/credit-ledger";
import type { ModelRoutingConfig, RouteTarget } from "@/lib/model-routing-registry";
import { decideProviderRoute } from "@/lib/routing/provider-router";

type InlineChargeInput = {
  userId: string;
  profileId?: string | null;
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
  generationType?: string | null;
  mode?: string | null;
  inputType?: string | null;
  requestPayload?: unknown;
  estimatedProviderCostUsd?: number | null;
};

export type InlineProviderResult = {
  mediaUrl: string;
  taskId?: string | null;
  additionalUrls?: string[];
  responseData?: unknown;
};

export type InlineOrchestrationResult<TProviderResult extends InlineProviderResult> = {
  generationId: string;
  remainingCredits: number;
  chargedCredits: number;
  route: RouteTarget;
  providerResult: TProviderResult;
};

export function resolveInlineGenerationRoute(input: {
  modelId: string;
  currentRoute: RouteTarget;
  routingConfig?: ModelRoutingConfig | null;
}): RouteTarget {
  if (!input.routingConfig || input.routingConfig.modelId !== input.modelId) {
    return input.currentRoute;
  }

  return decideProviderRoute(input.routingConfig).selected;
}

export async function runInlineGeneration<TProviderResult extends InlineProviderResult>(input: {
  modelId: string;
  modality: string;
  currentRoute: RouteTarget;
  routingConfig?: ModelRoutingConfig | null;
  charge: InlineChargeInput;
  execute: (context: { generationId: string; route: RouteTarget }) => Promise<TProviderResult>;
  afterCharge?: (context: { generationId: string; route: RouteTarget; remainingCredits: number }) => Promise<void>;
  attachMediaFailure?: "throw" | "log";
  failureCreditAction?: "refund" | "rollback";
  logPrefix?: string;
}): Promise<InlineOrchestrationResult<TProviderResult>> {
  const route = resolveInlineGenerationRoute({
    modelId: input.modelId,
    currentRoute: input.currentRoute,
    routingConfig: input.routingConfig,
  });

  const spent = await spendCredits(input.charge);
  const generationId = spent.generationId;

  try {
    if (input.afterCharge) {
      await input.afterCharge({
        generationId,
        route,
        remainingCredits: spent.remainingCredits,
      });
    }

    const providerResult = await input.execute({ generationId, route });

    if (providerResult.mediaUrl) {
      try {
        await setGenerationMediaUrl(generationId, providerResult.mediaUrl);
      } catch (error) {
        if (input.attachMediaFailure === "log") {
          console.error(`[${input.logPrefix ?? input.modality}] Failed to attach media URL to generation`, error);
        } else {
          throw error;
        }
      }
    }

    return {
      generationId,
      remainingCredits: spent.remainingCredits,
      chargedCredits: input.charge.credits,
      route,
      providerResult,
    };
  } catch (error) {
    if (input.failureCreditAction === "rollback") {
      await rollbackGenerationCharge(
        generationId,
        input.charge.userId,
        input.charge.credits,
      ).catch(() => {});
    } else {
      await refundGenerationCharge(generationId, input.charge.userId, input.charge.credits, {
        reason: "generation_refund_provider_failed",
        clearMediaUrl: true,
      }).catch(() => {});
    }
    throw error;
  }
}
