export type WaveSpeedImageReferenceField = "image" | "images";

export interface WaveSpeedImageRouteConfig {
  model: string;
  referenceField?: WaveSpeedImageReferenceField;
  requiresReference?: boolean;
  maxReferenceImages: number;
  outputCountField?: "num_images" | "max_images";
  maxOutputImages: number;
  inputShape: "aspect-resolution" | "seedream-pro" | "seedream-lite-size" | "size" | "aspect-only";
}

function normalizeSeedream5ProResolution(value: unknown): "1k" | "2k" {
  const normalized = String(value ?? "1k").trim().toLowerCase();
  return normalized.includes("2") ? "2k" : "1k";
}

function normalizeSeedream5LiteSize(value: unknown): string {
  const normalized = String(value ?? "2K").trim().toLowerCase();
  if (normalized.includes("4")) return "4096*4096";
  return "2048*2048";
}

function parseAspectRatio(value: unknown): [number, number] {
  const normalized = String(value ?? "1:1").trim().toLowerCase();
  if (normalized === "auto") return [1, 1];
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return [1, 1];
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? [width, height] : [1, 1];
}

function roundToMultiple(value: number, step = 16): number {
  return Math.max(step, Math.round(value / step) * step);
}

export function normalizeWaveSpeedImageSize(aspectRatio: unknown, quality: unknown): string {
  const normalizedQuality = String(quality ?? "1K").trim().toLowerCase();
  const longEdge = normalizedQuality.includes("4")
    ? 4096
    : normalizedQuality.includes("2") || normalizedQuality.includes("high")
      ? 2048
      : 1024;
  const [rw, rh] = parseAspectRatio(aspectRatio);
  if (rw >= rh) {
    return `${longEdge}*${roundToMultiple(longEdge * (rh / rw))}`;
  }
  return `${roundToMultiple(longEdge * (rw / rh))}*${longEdge}`;
}

export function resolveWaveSpeedImageModelRoute(
  modelId: string,
  hasReferenceImages: boolean,
  numImages: number,
): WaveSpeedImageRouteConfig | null {
  const id = modelId.toLowerCase();
  const wantsMulti = numImages > 1;

  // GPT Image 2.5 and 2.6 (Flare + Sunburst): same WaveSpeed contract, versioned endpoint.
  //   site id:  gpt-image-<ver>-<tier>-text-to-image | gpt-image-<ver>-<tier>-image-to-image
  //   provider: openai/gpt-image-<ver>-<tier>/text-to-image | openai/gpt-image-<ver>-<tier>/edit
  const gptImage = id.match(/^(?:openai\/)?gpt-image-(2\.[56])-(flare|sunburst)(?:-(text-to-image|image-to-image)|\/(text-to-image|edit))$/);
  if (gptImage) {
    const [, version, tier, siteKind, providerKind] = gptImage;
    const edit = siteKind === "image-to-image" || providerKind === "edit";
    const base = `openai/gpt-image-${version}-${tier}`;
    return edit
      ? { model: `${base}/edit`, referenceField: "images", requiresReference: true, maxReferenceImages: 16, maxOutputImages: 1, inputShape: "aspect-resolution" }
      : { model: `${base}/text-to-image`, maxReferenceImages: 0, maxOutputImages: 1, inputShape: "aspect-resolution" };
  }

  if (id === "seedream/4.5-text-to-image" || id === "bytedance/seedream-v4.5") {
    return {
      model: wantsMulti ? "bytedance/seedream-v4.5/sequential" : "bytedance/seedream-v4.5",
      maxReferenceImages: 0,
      outputCountField: wantsMulti ? "max_images" : undefined,
      maxOutputImages: 15,
      inputShape: "size",
    };
  }

  if (id === "seedream/4.5-edit" || id === "bytedance/seedream-v4.5/edit") {
    return {
      model: wantsMulti ? "bytedance/seedream-v4.5/edit-sequential" : "bytedance/seedream-v4.5/edit",
      referenceField: "images",
      requiresReference: true,
      maxReferenceImages: 10,
      outputCountField: wantsMulti ? "max_images" : undefined,
      maxOutputImages: 15,
      inputShape: "size",
    };
  }

  if (
    id === "seedream/5-lite"
    || id === "seedream/5-lite-text-to-image"
    || id === "bytedance/seedream-v5.0-lite"
    || id === "bytedance/seedream-v5.0-lite/sequential"
  ) {
    const edit = hasReferenceImages;
    return {
      model: edit
        ? wantsMulti ? "bytedance/seedream-v5.0-lite/edit-sequential" : "bytedance/seedream-v5.0-lite/edit"
        : wantsMulti ? "bytedance/seedream-v5.0-lite/sequential" : "bytedance/seedream-v5.0-lite",
      referenceField: edit ? "images" : undefined,
      requiresReference: edit,
      maxReferenceImages: edit ? 10 : 0,
      outputCountField: wantsMulti ? "max_images" : undefined,
      maxOutputImages: 15,
      inputShape: "seedream-lite-size",
    };
  }

  if (
    id === "seedream/5-lite-image-to-image"
    || id === "bytedance/seedream-v5.0-lite/edit"
    || id === "bytedance/seedream-v5.0-lite/edit-sequential"
  ) {
    return {
      model: wantsMulti ? "bytedance/seedream-v5.0-lite/edit-sequential" : "bytedance/seedream-v5.0-lite/edit",
      referenceField: "images",
      requiresReference: true,
      maxReferenceImages: 10,
      outputCountField: wantsMulti ? "max_images" : undefined,
      maxOutputImages: 15,
      inputShape: "seedream-lite-size",
    };
  }

  if (id === "seedream/5-pro-text-to-image" || id === "bytedance/seedream-v5.0-pro") {
    return {
      model: "bytedance/seedream-v5.0-pro",
      maxReferenceImages: 0,
      maxOutputImages: 1,
      inputShape: "seedream-pro",
    };
  }

  if (
    id === "seedream/5-pro-image-to-image"
    || id === "bytedance/seedream-v5.0-pro/edit"
    || id === "seedream/5-pro"
  ) {
    return {
      model: hasReferenceImages ? "bytedance/seedream-v5.0-pro/edit" : "bytedance/seedream-v5.0-pro",
      referenceField: hasReferenceImages ? "images" : undefined,
      requiresReference: hasReferenceImages,
      maxReferenceImages: hasReferenceImages ? 10 : 0,
      maxOutputImages: 1,
      inputShape: "seedream-pro",
    };
  }

  if (id === "z-image") {
    return {
      model: "wavespeed-ai/z-image/base",
      referenceField: hasReferenceImages ? "image" : undefined,
      maxReferenceImages: hasReferenceImages ? 1 : 0,
      maxOutputImages: 4,
      inputShape: "size",
    };
  }

  if (id === "qwen2/text-to-image") {
    return {
      model: "wavespeed-ai/qwen-image-2.0/text-to-image",
      maxReferenceImages: 0,
      maxOutputImages: 4,
      inputShape: "size",
    };
  }

  if (id === "qwen2/image-edit") {
    return {
      model: "wavespeed-ai/qwen-image-2.0/edit",
      referenceField: "images",
      requiresReference: true,
      maxReferenceImages: 3,
      maxOutputImages: 1,
      inputShape: "size",
    };
  }

  if (id === "qwen/image-to-image") {
    return {
      model: "wavespeed-ai/qwen-image/edit",
      referenceField: "image",
      requiresReference: true,
      maxReferenceImages: 1,
      maxOutputImages: 1,
      inputShape: "size",
    };
  }

  // Grok Imagine (x-ai) official WaveSpeed endpoints
  if (
    id === "grok-imagine" ||
    id === "grok-imagine/text-to-image" ||
    id === "grok-imagine/image-to-image" ||
    id.includes("grok-imagine") ||
    id.includes("grok")
  ) {
    const edit = hasReferenceImages || id.includes("image-to-image") || id.includes("edit");
    const isV2 = id.includes("v2.0") || id.includes("v2");
    const targetModel = isV2
      ? (edit ? "x-ai/grok-imagine-image-v2.0/edit" : "x-ai/grok-imagine-image-v2.0/text-to-image")
      : (edit ? "x-ai/grok-imagine-image-quality/edit" : "x-ai/grok-imagine-image-quality/text-to-image");

    return {
      model: targetModel,
      referenceField: edit ? (isV2 ? "images" : "image") : undefined,
      requiresReference: edit,
      maxReferenceImages: edit ? 1 : 0,
      outputCountField: "num_images",
      maxOutputImages: 4,
      inputShape: "aspect-resolution",
    };
  }

  if (id === "wan/2-7-image-pro") {
    return {
      model: hasReferenceImages ? "alibaba/wan-2.7/image-edit-pro" : "alibaba/wan-2.7/text-to-image-pro",
      referenceField: hasReferenceImages ? "images" : undefined,
      requiresReference: hasReferenceImages,
      maxReferenceImages: hasReferenceImages ? 3 : 0,
      maxOutputImages: 12,
      inputShape: "size",
    };
  }

  const flux = id.match(/^flux-2\/(pro|flex|max)(?:-(text-to-image|image-to-image))?$/);
  if (flux) {
    const tier = flux[1];
    const edit = hasReferenceImages || flux[2] === "image-to-image";
    return {
      model: `wavespeed-ai/flux-2-${tier}/${edit ? "edit" : "text-to-image"}`,
      referenceField: edit ? "images" : undefined,
      requiresReference: edit,
      maxReferenceImages: edit ? 3 : 0,
      maxOutputImages: 4,
      inputShape: "size",
    };
  }

  // Universal fallback for custom endpoints registered via admin portal (e.g. provider/model-path)
  if (modelId.includes("/") || modelId.includes("-")) {
    const cleanModel = normalizeWaveSpeedModelEndpoint(modelId, hasReferenceImages);
    if (cleanModel.includes("/")) {
      return {
        model: cleanModel,
        referenceField: hasReferenceImages ? "images" : undefined,
        requiresReference: false,
        maxReferenceImages: hasReferenceImages ? 4 : 0,
        maxOutputImages: 4,
        inputShape: cleanModel.includes("grok") ? "aspect-only" : "aspect-resolution",
      };
    }
  }

  return null;
}

export function normalizeWaveSpeedModelEndpoint(route: string, hasReferenceImages = false): string {
  let clean = route.trim().replace(/^https?:\/\/[^\/]+\/api\/v3\//i, "");

  if (!clean.includes("/") && clean.startsWith("x-ai-")) {
    clean = clean.replace(/^x-ai-/, "x-ai/");
  } else if (!clean.includes("/") && clean.startsWith("bytedance-")) {
    clean = clean.replace(/^bytedance-/, "bytedance/");
  } else if (!clean.includes("/") && clean.startsWith("alibaba-")) {
    clean = clean.replace(/^alibaba-/, "alibaba/");
  } else if (!clean.includes("/") && clean.startsWith("kwaivgi-")) {
    clean = clean.replace(/^kwaivgi-/, "kwaivgi/");
  } else if (!clean.includes("/") && clean.startsWith("wavespeed-ai-")) {
    clean = clean.replace(/^wavespeed-ai-/, "wavespeed-ai/");
  }

  if (clean.includes("/") && !clean.endsWith("/text-to-image") && !clean.endsWith("/edit") && !clean.endsWith("/image-to-image")) {
    if (clean.endsWith("-text-to-image")) {
      clean = clean.replace(/-text-to-image$/, "/text-to-image");
    } else if (clean.endsWith("-edit")) {
      clean = clean.replace(/-edit$/, "/edit");
    } else if (clean.endsWith("-image-to-image")) {
      clean = clean.replace(/-image-to-image$/, "/image-to-image");
    }
  }

  if (clean.includes("grok")) {
    const isEdit = hasReferenceImages || clean.includes("edit") || clean.includes("image-to-image");
    if (clean.includes("v2.0") || clean.includes("v2")) {
      return isEdit ? "x-ai/grok-imagine-image-v2.0/edit" : "x-ai/grok-imagine-image-v2.0/text-to-image";
    }
    return isEdit ? "x-ai/grok-imagine-image-quality/edit" : "x-ai/grok-imagine-image-quality/text-to-image";
  }

  return clean;
}

export function buildWaveSpeedImageInput(
  config: WaveSpeedImageRouteConfig,
  params: {
    prompt: string;
    aspectRatio?: string;
    quality?: string | null;
    resolution?: string | null;
    imageSize?: string | null;
    numImages?: number;
    referenceUrls?: string[];
    negativePrompt?: string | null;
    outputFormat?: "png" | "jpeg" | "webp";
    /** GPT Image 2.6 only: planning depth before drawing (low | medium | high). Free. */
    complexity?: string | null;
  },
): Record<string, unknown> {
  const requestedQuality = params.quality ?? params.resolution ?? params.imageSize;
  const requestedResolution = params.resolution ?? params.imageSize ?? "1k";
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    output_format: "jpeg",
  };

  if (params.negativePrompt) {
    input.negative_prompt = params.negativePrompt;
  }

  if (config.model.includes("grok")) {
    const ar = String(params.aspectRatio || "1:1").trim();
    input.aspect_ratio = ar === "auto" ? "1:1" : ar;
    const res = String(requestedQuality ?? "1k").trim().toLowerCase();
    input.resolution = res.includes("2") ? "2k" : "1k";
    input.quality = res.includes("2") || res.includes("high") || res.includes("pro") ? "high" : "medium";
  } else if (config.inputShape === "aspect-only") {
    const ar = String(params.aspectRatio || "1:1").trim();
    input.aspect_ratio = ar === "auto" ? "1:1" : ar;
  } else if (config.inputShape === "aspect-resolution" || config.inputShape === "seedream-pro") {
    input.aspect_ratio = params.aspectRatio === "auto" ? undefined : params.aspectRatio;
    input.resolution = config.inputShape === "seedream-pro"
      ? normalizeSeedream5ProResolution(requestedResolution)
      : String(requestedResolution).trim().toLowerCase();
    if (/gpt-image-2\.[56]/.test(config.model)) {
      input.quality = String(params.quality ?? "medium").trim().toLowerCase();
      input.output_format = params.outputFormat ?? "png";
      // Only 2.6 documents `complexity`; omit it unless asked so the provider default (high) applies.
      const complexity = String(params.complexity ?? "").trim().toLowerCase();
      if (config.model.includes("gpt-image-2.6") && ["low", "medium", "high"].includes(complexity)) {
        input.complexity = complexity;
      }
    }
  } else if (config.inputShape === "seedream-lite-size") {
    input.size = normalizeSeedream5LiteSize(requestedQuality);
  } else {
    input.size = normalizeWaveSpeedImageSize(params.aspectRatio, requestedQuality);
    input.enable_base64_output = false;
    input.enable_sync_mode = false;
  }

  const refs = (params.referenceUrls ?? []).slice(0, config.maxReferenceImages);
  if (config.referenceField === "images") {
    input.images = refs;
  } else if (config.referenceField === "image" && refs[0]) {
    input.image = refs[0];
  }

  if (config.outputCountField) {
    input[config.outputCountField] = Math.max(1, Math.min(config.maxOutputImages, Math.ceil(Number(params.numImages) || 1)));
  }

  Object.keys(input).forEach((key) => {
    if (input[key] === undefined) delete input[key];
  });
  return input;
}
