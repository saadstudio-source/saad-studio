// Extracted from app/api/video/route.ts so it can be exported and unit-tested (Next route files may only export handlers).
import { ValidationError } from "@/lib/media/public-url-resolver";
import { validateAndBuildSeedanceExactPayload, isSeedanceRoute } from "@/lib/seedance-validation";

export function mapToWavespeedInput(payload: Record<string, unknown>, route?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof payload.prompt === "string") out.prompt = payload.prompt;
  if (typeof payload.video === "string") out.video = payload.video;
  for (const key of ["target", "mode", "change_to", "character_orientation", "target_resolution"] as const) {
    if (typeof payload[key] === "string" && payload[key].trim()) out[key] = payload[key].trim();
  }
  if (typeof payload.keep_original_sound === "boolean") out.keep_original_sound = payload.keep_original_sound;
  if (typeof payload.seed === "number" && Number.isInteger(payload.seed)) out.seed = payload.seed;
  if (typeof payload.duration === "number") out.duration = payload.duration;
  else if (typeof payload.duration === "string") out.duration = Number.parseInt(payload.duration, 10);
  if (typeof payload.negative_prompt === "string" && payload.negative_prompt.trim()) {
    out.negative_prompt = payload.negative_prompt.trim();
  }
  if (payload.loop === true || payload.ping_pong === true || payload.is_loop === true) {
    out.loop = true;
  }
  if (typeof payload.cfg_scale === "number") out.cfg_scale = payload.cfg_scale;

  const requestedAspect =
    typeof payload.aspect_ratio === "string"
      ? payload.aspect_ratio
      : typeof payload.aspectRatio === "string"
        ? payload.aspectRatio
        : null;
  if (requestedAspect) out.aspect_ratio = requestedAspect;

  const requestedResolution =
    typeof payload.resolution === "string"
      ? payload.resolution
      : typeof payload.quality === "string"
        ? payload.quality
        : null;
  if (requestedResolution) out.resolution = requestedResolution;

  const imgSrc =
    (typeof payload.image === "string" ? payload.image : null) ||
    (typeof payload.first_frame_url === "string" ? payload.first_frame_url : null) ||
    (typeof payload.image_url === "string" ? payload.image_url : null);
  if (imgSrc) {
    out.image = imgSrc;
    out.image_url = imgSrc;
  }

  if (typeof payload.first_frame_url === "string") {
    out.first_frame_url = payload.first_frame_url;
    if (!out.image) out.image = payload.first_frame_url;
  }
  if (typeof payload.last_frame_url === "string") {
    out.last_frame_url = payload.last_frame_url;
  }

  const endImage =
    (typeof payload.end_image === "string" ? payload.end_image : null) ||
    (typeof payload.last_image === "string" ? payload.last_image : null) ||
    (typeof payload.last_frame_url === "string" ? payload.last_frame_url : null);
  if (endImage) {
    out.end_image = endImage;
    out.last_image = endImage;
  }

  if (Array.isArray(payload.reference_image_urls)) out.reference_image_urls = payload.reference_image_urls;
  if (Array.isArray(payload.image_urls) && !out.reference_image_urls) out.reference_image_urls = payload.image_urls;
  if (Array.isArray(payload.reference_video_urls)) out.reference_video_urls = payload.reference_video_urls;
  if (typeof payload.video_url === "string") out.reference_video_urls = [payload.video_url];
  if (Array.isArray(payload.video_urls) && !out.reference_video_urls) out.reference_video_urls = payload.video_urls;
  if (Array.isArray(payload.reference_audio_urls)) out.reference_audio_urls = payload.reference_audio_urls;
  if (Array.isArray(payload.audio_urls) && !out.reference_audio_urls) out.reference_audio_urls = payload.audio_urls;
  if (typeof payload.audio_url === "string" && !out.reference_audio_urls) out.reference_audio_urls = [payload.audio_url];

  const isI2VTargetRoute = typeof route === "string" && route.includes("image-to-video");
  const isExtendTargetRoute = typeof route === "string" && route.includes("video-extend");

  if (isI2VTargetRoute) {
    if (!out.image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string") {
      out.image = out.reference_image_urls[0];
      out.first_frame_url = out.reference_image_urls[0];
    }
    if (!out.end_image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[1] === "string") {
      out.end_image = out.reference_image_urls[1];
      out.last_image = out.reference_image_urls[1];
      out.last_frame_url = out.reference_image_urls[1];
    }
  } else if (isExtendTargetRoute) {
    if (!out.end_image && Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string") {
      out.end_image = out.reference_image_urls[0];
      out.last_image = out.reference_image_urls[0];
      out.last_frame_url = out.reference_image_urls[0];
    }
  }

  out.enable_web_search = payload.enable_web_search !== undefined ? !!payload.enable_web_search : false;

  // Guard Turbo resolution: Turbo routes only support 720p or 1080p
  const isSeedanceMiniTurboRoute = typeof route === "string" && route.includes("seedance-2.0-mini") && route.includes("turbo");
  if (isSeedanceMiniTurboRoute) {
    const rawRes = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "";
    if (rawRes === "480p" || rawRes === "4k") {
      throw new ValidationError(`Resolution '${rawRes}' not supported for this route. Allowed: 720p, 1080p.`);
    }
  }

  const isSeedance25TextRoute = route === "bytedance/seedance-2.5/text-to-video";
  const isSeedance25ImageRoute = route === "bytedance/seedance-2.5/image-to-video";
  const isSeedance25TextTurboRoute = route === "bytedance/seedance-2.5/text-to-video-turbo";
  const isSeedance25TurboImageRoute = route === "bytedance/seedance-2.5/image-to-video-turbo";
  const isSeedance25SpicyImageRoute = route === "bytedance/seedance-2.5/image-to-video-spicy";
  const isSeedanceBaseImageRoute = route === "bytedance/seedance-2.0/image-to-video";
  const isSeedanceTurboImageRoute = route === "bytedance/seedance-2.0/image-to-video-turbo";
  const isSeedanceMiniImageRoute = route === "bytedance/seedance-2.0-mini/image-to-video";
  const isWan30TextRoute = route === "alibaba/wan-3.0/text-to-video";
  const isWan30ImageRoute = route === "alibaba/wan-3.0/image-to-video";
  const isWan30ReferenceRoute = route === "alibaba/wan-3.0/reference-to-video";
  const isFlux3Route = typeof route === "string" && (route.startsWith("black-forest-labs/flux-3") || route.startsWith("black-forest-labs-flux-3"));
  const isFlux3ExtendRoute = isFlux3Route && route.includes("extend");
  const isFlux3StartEndRoute = isFlux3Route && route.includes("start-end");
  const isFlux3ImageRoute = isFlux3Route && route.includes("image-to-video");
  const isKling30ImageRoute =
    route === "kwaivgi/kling-v3.0-std/image-to-video" ||
    route === "kwaivgi/kling-v3.0-pro/image-to-video";
  const isMinimaxH3MaxRoute = typeof route === "string" && route.startsWith("wavespeed-ai/minimax-h3");
  const isMinimaxH3ReferenceRoute = route === "minimax/h3/reference-to-video" || route === "wavespeed-ai/minimax-h3/reference-to-video";
  const isKlingV3TurboImageRoute =
    route === "kwaivgi/kling-v3-turbo-std/image-to-video" ||
    route === "kwaivgi/kling-v3-turbo-pro/image-to-video";
  const isKlingO3Route = typeof route === "string" && route.startsWith("kwaivgi/kling-video-o3-");
  const isKling26Route = typeof route === "string" && route.startsWith("kwaivgi/kling-v2.6-") && route !== "kwaivgi/kling-v2.6-std/motion-control";
  const hasAudio = isSeedance25TextRoute || isSeedance25ImageRoute || isSeedance25TextTurboRoute || isSeedance25TurboImageRoute || isSeedance25SpicyImageRoute || isSeedanceBaseImageRoute || route?.includes("seedance-2.0-mini") || isSeedanceTurboImageRoute || isWan30TextRoute || isWan30ImageRoute || isWan30ReferenceRoute || isFlux3Route
    ? payload.generate_audio !== false
    : payload.sound === true || payload.generate_audio === true;
  out.generate_audio = hasAudio;
  const readKlingElementList = () => {
    const directElements = Array.isArray(payload.element_list)
      ? payload.element_list.slice(0, 3).filter((item) => item && typeof item === "object")
      : [];
    const imageElements = Array.isArray(payload.kling_elements)
      ? payload.kling_elements
          .slice(0, Math.max(0, 3 - directElements.length))
          .filter((item) => item && typeof item === "object")
      : [];
    return [...directElements, ...imageElements];
  };


  if (isMinimaxH3ReferenceRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideosFromList = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = [
      ...referenceVideosFromList,
      ...(typeof payload.video === "string" && payload.video.trim() ? [payload.video] : []),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const referenceAudios = Array.isArray(out.reference_audio_urls)
      ? out.reference_audio_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new ValidationError("Minimax H3 requires at least one reference image or reference video.");
    }
    if (referenceAudios.length > 0 && referenceImages.length === 0 && referenceVideos.length === 0) {
      throw new ValidationError("Minimax H3 reference audio cannot be provided alone.");
    }

    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) {
      exact.prompt = out.prompt
        .trim()
        .replace(/@Image(\d+)\b/g, "<Picture $1>")
        .replace(/@Video(\d+)\b/g, "<Video $1>")
        .replace(/@Audio(\d+)\b/g, "<Audio $1>");
    }
    else throw new ValidationError("Minimax H3 requires a prompt.");
    if (referenceImages.length > 0) exact.reference_images = referenceImages.slice(0, 9);
    if (referenceVideos.length > 0) exact.reference_videos = referenceVideos.slice(0, 3);
    if (referenceAudios.length > 0) exact.reference_audios = referenceAudios.slice(0, 3);
    if (typeof out.aspect_ratio === "string" && ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : (isMinimaxH3MaxRoute ? "480p" : "2k");
    exact.resolution = isMinimaxH3MaxRoute
      ? (resolution === "768p" ? "768p" : "480p")
      : (resolution === "2k" || resolution === "2 k" ? "2k" : "768p");
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(isMinimaxH3MaxRoute ? 3 : 5, duration)) : 5;
    if (isMinimaxH3MaxRoute) {
      const seed = Number(payload.seed ?? out.seed);
      if (Number.isInteger(seed)) exact.seed = seed;
    }
    return exact;
  }

  const isMinimaxH3TextOrImageRoute =
    route === "minimax/h3/text-to-video" ||
    route === "minimax/h3/image-to-video" ||
    route === "wavespeed-ai/minimax-h3/text-to-video" ||
    route === "wavespeed-ai/minimax-h3/image-to-video";
  if (isMinimaxH3TextOrImageRoute) {
    const exact: Record<string, unknown> = {};
    const prompt = typeof out.prompt === "string" && out.prompt.trim() ? out.prompt.trim() : "";
    if (!prompt) throw new ValidationError("Minimax H3 requires a prompt.");
    exact.prompt = prompt;
    if (route.includes("image-to-video")) {
      const startImage =
        (typeof out.image === "string" && out.image.trim() ? out.image.trim() : null) ||
        (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim() ? payload.first_frame_url.trim() : null) ||
        (typeof out.image_url === "string" && out.image_url.trim() ? out.image_url.trim() : null) ||
        null;
      if (!startImage) throw new ValidationError("Minimax H3 image-to-video requires a start image.");
      exact.image = startImage;
      const endImage =
        (typeof out.last_image === "string" && out.last_image.trim() ? out.last_image.trim() : null) ||
        (typeof out.end_image === "string" && out.end_image.trim() ? out.end_image.trim() : null) ||
        (typeof payload.last_frame_url === "string" && payload.last_frame_url.trim() ? payload.last_frame_url.trim() : null) ||
        null;
      if (endImage) exact.last_image = endImage;
    }
    if (typeof out.aspect_ratio === "string" && ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "9:21"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const isTextOrImageH3MaxRoute = route.startsWith("wavespeed-ai/minimax-h3");
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : (isTextOrImageH3MaxRoute ? "480p" : "2k");
    exact.resolution = isTextOrImageH3MaxRoute
      ? (resolution === "768p" ? "768p" : "480p")
      : (resolution === "2k" || resolution === "2 k" ? "2k" : "768p");
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(isTextOrImageH3MaxRoute ? 3 : 5, duration)) : 5;
    if (isTextOrImageH3MaxRoute) {
      const seed = Number(payload.seed ?? out.seed);
      if (Number.isInteger(seed)) exact.seed = seed;
    }
    return exact;
  }

  const isMinimaxHailuoRoute = typeof route === "string" && (route.startsWith("minimax/hailuo-") || route === "minimax/live-illustrations");
  if (isMinimaxHailuoRoute) {
    const exact: Record<string, unknown> = {};
    const prompt = typeof out.prompt === "string" && out.prompt.trim() ? out.prompt.trim() : "";
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof payload.first_frame_url === "string" ? payload.first_frame_url : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      (Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[0] === "string" ? out.reference_image_urls[0] : null) ||
      null;
    const endImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      (typeof payload.last_frame_url === "string" ? payload.last_frame_url : null) ||
      (Array.isArray(out.reference_image_urls) && typeof out.reference_image_urls[1] === "string" ? out.reference_image_urls[1] : null) ||
      null;

    const isFastRoute = route.includes("/fast") || route.includes("/fast-pro");
    const isLiveIllustrations = route === "minimax/live-illustrations";
    const isI2vOnly = isFastRoute || isLiveIllustrations || route.includes("/i2v-");
    const supportsEndFrame = route.startsWith("minimax/hailuo-02") && !isFastRoute;

    if (isI2vOnly && !startImage) {
      throw new ValidationError(`${route} requires an input image.`);
    }
    if (!prompt && !startImage) {
      throw new ValidationError("Prompt or image is required for video generation.");
    }

    if (prompt) exact.prompt = prompt;
    if (startImage) exact.image = startImage;
    if (endImage && supportsEndFrame) exact.end_image = endImage;

    const rawDuration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "6"), 10);
    if (route === "minimax/hailuo-2.3/t2v-pro" || route === "minimax/hailuo-2.3/i2v-pro") {
      exact.duration = 5;
    } else if (route === "minimax/hailuo-02/pro" || route === "minimax/hailuo-2.3/fast-pro") {
      exact.duration = 6;
    } else if (rawDuration === 10) {
      exact.duration = 10;
    } else {
      exact.duration = 6;
    }

    if (isFastRoute) {
      exact.go_fast = payload.go_fast !== false;
    } else {
      exact.enable_prompt_expansion = payload.enable_prompt_expansion !== false;
    }

    return exact;
  }

  if (isWan30TextRoute || isWan30ImageRoute || isWan30ReferenceRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceImageUrls)
        ? payload.referenceImageUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceVideoUrls)
        ? payload.referenceVideoUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const referenceAudios = Array.isArray(out.reference_audio_urls)
      ? out.reference_audio_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(payload.referenceAudioUrls)
        ? payload.referenceAudioUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const endImage =
      (typeof out.last_image === "string" ? out.last_image : null) ||
      (typeof out.last_frame_url === "string" ? out.last_frame_url : null) ||
      (typeof out.end_image === "string" ? out.end_image : null) ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    else throw new ValidationError("Wan 3.0 requires a prompt.");
    if (isWan30ImageRoute) {
      if (startImage) exact.image = startImage;
      else throw new ValidationError("Wan 3.0 Image-to-Video requires an image or reference image.");
      if (endImage) exact.last_image = endImage;
    }
    if (isWan30ReferenceRoute) {
      if (referenceImages.length > 0) exact.reference_images = referenceImages.slice(0, 10);
      if (referenceVideos.length > 0) exact.reference_videos = referenceVideos.slice(0, 5);
      if (referenceAudios.length > 0) exact.reference_audios = referenceAudios.slice(0, 5);
      if (!exact.reference_images && !exact.reference_videos && !exact.reference_audios) {
        throw new ValidationError("Wan 3.0 Reference-to-Video requires at least one reference image, video, or audio.");
      }
    }
    if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "720p";
    exact.resolution = ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p";
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(30, Math.max(2, duration)) : 5;
    if (typeof out.thinking_mode === "boolean") exact.thinking_mode = out.thinking_mode;
    exact.enable_audio = out.generate_audio !== false;
    if (typeof payload.seed === "number" && Number.isFinite(payload.seed)) exact.seed = payload.seed;
    return exact;
  }

  if (isFlux3Route) {
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) {
      exact.prompt = out.prompt.trim();
    } else {
      throw new ValidationError("Flux 3 requires a prompt.");
    }

    if (isFlux3ExtendRoute) {
      const video = typeof payload.video === "string" && payload.video.trim()
        ? payload.video.trim()
        : Array.isArray(out.reference_video_urls) && out.reference_video_urls[0]
          ? out.reference_video_urls[0]
          : null;
      if (!video) {
        throw new ValidationError("Flux 3 Video Extend requires a source video.");
      }
      exact.video = video;
    } else if (isFlux3StartEndRoute) {
      const startImage = (typeof out.image === "string" ? out.image : null) || (typeof payload.start_image === "string" ? payload.start_image : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[0] : null);
      const endImage = (typeof out.last_image === "string" ? out.last_image : null) || (typeof payload.end_image === "string" ? payload.end_image : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[1] : null);
      if (!startImage || !endImage) {
        throw new ValidationError("Flux 3 Start-End-to-Video requires both start_image and end_image.");
      }
      exact.start_image = startImage;
      exact.end_image = endImage;
    } else if (isFlux3ImageRoute) {
      const image = (typeof out.image === "string" ? out.image : null) || (typeof out.image_url === "string" ? out.image_url : null) || (Array.isArray(payload.image_urls) ? payload.image_urls[0] : null) || (Array.isArray(out.reference_image_urls) ? out.reference_image_urls[0] : null);
      if (!image) {
        throw new ValidationError("Flux 3 Image-to-Video requires an input image.");
      }
      exact.image = image;
    }

    if (typeof out.aspect_ratio === "string" && ["21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    const resolution = typeof out.resolution === "string" ? out.resolution.toLowerCase() : "720p";
    if (!route.includes("draft")) {
      exact.resolution = resolution === "1080p" ? "1080p" : "720p";
    }
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(20, Math.max(5, duration)) : 5;
    exact.generate_audio = out.generate_audio !== false;
    if (typeof payload.seed === "number" && Number.isFinite(payload.seed)) exact.seed = payload.seed;
    return exact;
  }

  if (isKling30ImageRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (startImage) exact.image = startImage;
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    if (finalImage) {
      exact.end_image = finalImage;
      exact.last_image = finalImage;
    }
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
    if (typeof out.cfg_scale === "number" && Number.isFinite(out.cfg_scale)) {
      exact.cfg_scale = Math.min(1, Math.max(0, out.cfg_scale));
    }
    exact.sound = payload.sound === true || payload.generate_audio === true;
    const shotType = typeof payload.shot_type === "string" ? payload.shot_type.trim() : "";
    if (Array.isArray(payload.multi_prompt)) {
      const multiPrompt = payload.multi_prompt
        .slice(0, 6)
        .filter((item) => item && typeof item === "object");
      if (multiPrompt.length > 0) {
        exact.multi_prompt = multiPrompt;
        if (shotType === "customize" || shotType === "intelligent") exact.shot_type = shotType;
      }
    }
    const elementList = readKlingElementList();
    if (elementList.length > 0) exact.element_list = elementList;
    return exact;
  }

  if (isKlingV3TurboImageRoute) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (startImage) exact.image = startImage;
    else throw new ValidationError("Kling V3 Turbo requires an image.");
    if (finalImage) {
      exact.end_image = finalImage;
      exact.last_image = finalImage;
    }
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const rawMultiPrompt = payload.multi_prompt;
    const hasMultiPromptInput = Array.isArray(rawMultiPrompt);
    const multiPrompt = hasMultiPromptInput
      ? (rawMultiPrompt as Array<Record<string, unknown>>)
          .slice(0, 6)
          .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
            if (!prompt) return null;
            const duration = typeof item.duration === "number" ? item.duration : Number.parseInt(String(item.duration || "1"), 10);
            if (!Number.isFinite(duration) || duration <= 0) {
              throw new ValidationError(`Kling V3 Turbo multi_prompt item ${index + 1} duration must be at least 1 second.`);
            }
            return { prompt, duration };
          })
          .filter((item: { prompt: string; duration: number } | null): item is { prompt: string; duration: number } => item !== null)
      : [];
    if (multiPrompt.length > 0) {
      const totalDuration = multiPrompt.reduce((sum: number, item: { prompt: string; duration: number }) => sum + item.duration, 0);
      if (totalDuration > 15) {
        throw new ValidationError("Kling V3 Turbo multi_prompt total duration must not exceed 15 seconds.");
      }
      exact.multi_prompt = multiPrompt;
    } else if (hasMultiPromptInput) {
      throw new ValidationError("Kling V3 Turbo multi_prompt must include at least one shot.");
    } else {
      if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
      const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
      const normalizedDuration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
      exact.duration = normalizedDuration;
    }
    return exact;
  }

  if (isKlingO3Route) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const referenceVideos = Array.isArray(out.reference_video_urls)
      ? out.reference_video_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    const normalizedDuration = Number.isFinite(duration) ? Math.min(15, Math.max(3, duration)) : 5;
    if (route?.includes("-pro/image-to-video")) {
      exact.duration = normalizedDuration >= 8 ? 10 : 5;
    } else {
      exact.duration = normalizedDuration;
    }
    exact.sound = payload.sound === true || payload.generate_audio === true;
    const shotType = typeof payload.shot_type === "string" ? payload.shot_type.trim() : "";
    if (Array.isArray(payload.multi_prompt)) {
      const multiPrompt = payload.multi_prompt.slice(0, 6).filter((item) => item && typeof item === "object");
      if (multiPrompt.length > 0) {
        exact.multi_prompt = multiPrompt;
        if (shotType === "customize" || shotType === "intelligent") exact.shot_type = shotType;
      }
    }
    const elementList = readKlingElementList();
    if (elementList.length > 0) exact.element_list = elementList;
    if (route?.includes("/reference-to-video")) {
      if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1"].includes(out.aspect_ratio)) exact.aspect_ratio = out.aspect_ratio;
      if (referenceVideos[0]) {
        exact.video = referenceVideos[0];
        exact.keep_original_sound = payload.keep_original_sound !== false;
      }
      const images = [...imageUrls, ...referenceImages].filter((value, index, list) => list.indexOf(value) === index);
      if (images.length > 0) exact.images = images.slice(0, referenceVideos[0] ? 4 : 7);
    } else if (route?.includes("/image-to-video")) {
      if (startImage) exact.image = startImage;
      if (finalImage) {
        exact.end_image = finalImage;
        exact.last_image = finalImage;
      }
    }
    return exact;
  }

  if (isKling26Route) {
    const referenceImages = Array.isArray(out.reference_image_urls)
      ? out.reference_image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const imageUrls = Array.isArray(payload.image_urls)
      ? payload.image_urls.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const startImage =
      (typeof out.image === "string" ? out.image : null) ||
      (typeof out.image_url === "string" ? out.image_url : null) ||
      imageUrls[0] ||
      referenceImages[0] ||
      null;
    const finalImage =
      (typeof out.end_image === "string" ? out.end_image : null) ||
      (typeof out.last_image === "string" ? out.last_image : null) ||
      imageUrls[1] ||
      referenceImages[1] ||
      null;
    const exact: Record<string, unknown> = {};
    if (typeof out.prompt === "string" && out.prompt.trim()) exact.prompt = out.prompt.trim();
    if (typeof out.negative_prompt === "string" && out.negative_prompt.trim()) exact.negative_prompt = out.negative_prompt.trim();
    if (out.loop === true) exact.loop = true;
    const duration = typeof out.duration === "number" ? out.duration : Number.parseInt(String(out.duration || "5"), 10);
    exact.duration = duration >= 8 ? 10 : 5;
    if (typeof out.cfg_scale === "number" && Number.isFinite(out.cfg_scale)) {
      exact.cfg_scale = Math.min(1, Math.max(0, out.cfg_scale));
    }
    if (route?.includes("/image-to-video")) {
      if (startImage) exact.image = startImage;
      if (finalImage) {
        exact.end_image = finalImage;
        exact.last_image = finalImage;
      }
      if (route.includes("-pro/")) {
        const sound = payload.sound === true || payload.generate_audio === true;
        exact.sound = sound;
        if (Array.isArray(payload.voice_list)) {
          const voiceList = payload.voice_list.slice(0, 2).filter((item) => item && typeof item === "object");
          if (voiceList.length > 0) exact.voice_list = voiceList;
        }
      }
    } else if (typeof out.aspect_ratio === "string" && ["16:9", "9:16", "1:1"].includes(out.aspect_ratio)) {
      exact.aspect_ratio = out.aspect_ratio;
    }
    return exact;
  }

  if (route && (isSeedanceRoute(route) || route.startsWith("bytedance/seedance-"))) {
    return validateAndBuildSeedanceExactPayload(route, out, payload);
  }

  return out;
}
