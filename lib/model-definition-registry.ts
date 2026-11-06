import { getDynamicImageModels, getDynamicVideoModels, type DynamicImageModel, type DynamicVideoModel } from "@/lib/dynamic-model-loader";
import { resolveImageModelSource, resolveVideoModelSource, type RuntimeSourceProvider } from "@/lib/model-source-map";

export const MODEL_DEFINITION_MODALITIES = ["image", "video", "audio", "3d", "tool"] as const;
export const MODEL_DEFINITION_STATUSES = ["active", "disabled", "deprecated", "draft"] as const;
export const MODEL_PARAMETER_TYPES = ["select", "number", "boolean", "text", "file", "file_list"] as const;

export type ModelDefinitionModality = (typeof MODEL_DEFINITION_MODALITIES)[number];
export type ModelDefinitionStatus = (typeof MODEL_DEFINITION_STATUSES)[number];
export type ModelParameterType = (typeof MODEL_PARAMETER_TYPES)[number];

export type ModelCapabilityKey =
  | "textToImage"
  | "imageToImage"
  | "textToVideo"
  | "imageToVideo"
  | "videoToVideo"
  | "textToAudio"
  | "textTo3D"
  | "imageTo3D"
  | "multiviewTo3D"
  | "sketchTo3D"
  | "lyrics"
  | "instrumental"
  | "referenceImages"
  | "referenceVideos"
  | "referenceAudios"
  | "audioInput"
  | "audioOutput"
  | "multipleOutputs"
  | "seed"
  | "negativePrompt"
  | "loop"
  | "transparentBackground"
  | "extendVideo"
  | "editVideo";

export type ModelDefinitionProvenance = {
  source: "curated_registry" | "admin_model_registry" | "knowledge_publish";
  sourceUrl: string | null;
  documentId: string | null;
  section: string | null;
  approvedAt: string | null;
};

export type ModelParameterDefinition = {
  id: string;
  label: string;
  type: ModelParameterType;
  required: boolean;
  defaultValue: string | number | boolean | null;
  options?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
  visible: boolean;
  supported: boolean;
  provenance?: ModelDefinitionProvenance[];
};

export type ModelParameterRule = {
  when: { parameterId: string; equals: string | number | boolean };
  then: { parameterId: string; options?: Array<string | number | boolean>; min?: number; max?: number; supported?: boolean };
};

export type ModelReferenceInputDefinition = {
  supported: boolean;
  min: number;
  max: number;
  required: boolean;
};

export type CentralModelDefinition = {
  modelId: string;
  displayName: string;
  modality: ModelDefinitionModality;
  status: ModelDefinitionStatus;
  sourceModelId: string;
  version: string | null;
  pricingRef: string;
  routingRef: string;
  capabilities: Partial<Record<ModelCapabilityKey, boolean | number | string[]>>;
  parameters: ModelParameterDefinition[];
  parameterRules: ModelParameterRule[];
  inputs: {
    referenceImages: ModelReferenceInputDefinition;
    referenceVideos: ModelReferenceInputDefinition;
    referenceAudios: ModelReferenceInputDefinition;
  };
  outputs: {
    mediaTypes: Array<"image" | "video" | "audio" | "text" | "3d">;
    multipleOutputs: boolean;
    maxOutputs: number;
  };
  limits: Record<string, number | string | boolean | null>;
  defaults: Record<string, string | number | boolean | null>;
  runtimeSource: RuntimeSourceProvider;
  definitionSource: "central" | "legacy_fallback";
  provenance: ModelDefinitionProvenance[];
};

export type DynamicMusicModel = {
  id: string;
  label: string;
  sublabel: string;
  badge?: string | null;
  group: string;
  avatar?: string;
  hasLyrics: boolean;
  durations: number[];
  defaultDuration: number;
  maxDuration: number;
  maxReferenceImages: number;
  isActive?: boolean;
};

export type DynamicThreeDModel = {
  id: string;
  label: string;
  badge?: string | null;
  badgeColor?: string;
  modes: Array<"text" | "image" | "multiview" | "sketch">;
  price?: string;
  endpoints: Record<string, string>;
  isActive?: boolean;
};

export type DynamicLipsyncModel = {
  id: string;
  name: string;
  family: string;
  family_label: string;
  family_color: string;
  badge?: string;
  description: string;
  api_route: string;
  route_confirmed: boolean;
  acceptedMedia?: "video" | "image_or_video";
  isActive?: boolean;
};

export type DynamicTTSVoice = {
  id: string;
  name: string;
};

export type DynamicTTSModel = {
  id: string;
  name: string;
  family: string;
  badge?: string;
  description: string;
  provider: "elevenlabs" | "google";
  voices: DynamicTTSVoice[];
  defaultVoice: string;
  hasEmotion?: boolean;
  hasStability?: boolean;
  hasClarity?: boolean;
  hasSpeed?: boolean;
  isActive?: boolean;
};

export const CURATED_MUSIC_MODELS: DynamicMusicModel[] = [
  {
    id: "google/lyria-3-pro/music",
    label: "Google Lyria Pro",
    sublabel: "Professional-grade music generation",
    badge: "NEW",
    group: "Google",
    avatar: "🎼",
    hasLyrics: true,
    durations: [15, 30, 60, 90, 120, 180, 240, 300],
    defaultDuration: 60,
    maxDuration: 300,
    maxReferenceImages: 10,
    isActive: true,
  },
  {
    id: "google/lyria-3-clip/music",
    label: "Google Lyria Fast",
    sublabel: "Stable & rapid music generation",
    badge: "HOT",
    group: "Google",
    avatar: "🎶",
    hasLyrics: true,
    durations: [15, 30, 60, 90, 120, 180],
    defaultDuration: 30,
    maxDuration: 180,
    maxReferenceImages: 10,
    isActive: true,
  },
];

export const CURATED_THREE_D_MODELS: DynamicThreeDModel[] = [
  {
    id: "tripo3d-2.5",
    label: "Tripo3D 2.5",
    badge: "RECOMMENDED",
    badgeColor: "bg-violet-500",
    modes: ["image", "multiview"],
    price: "$0.10",
    endpoints: {
      image: "tripo3d/v2.5/image-to-3d",
      multiview: "tripo3d/v2.5/multiview-to-3d",
    },
    isActive: true,
  },
  {
    id: "hunyuan3d-3.1",
    label: "Hunyuan3D 3.1",
    badge: "NEW",
    badgeColor: "bg-emerald-500",
    modes: ["text", "image"],
    price: "$0.0225",
    endpoints: {
      text: "wavespeed-ai/hunyuan-3d-v3.1/text-to-3d-rapid",
      image: "wavespeed-ai/hunyuan-3d-v3.1/image-to-3d-rapid",
    },
    isActive: true,
  },
  {
    id: "hunyuan3d-3",
    label: "Hunyuan3D 3",
    badge: null,
    badgeColor: "",
    modes: ["text", "image", "sketch"],
    price: "$0.375",
    endpoints: {
      text: "wavespeed-ai/hunyuan3d-v3/text-to-3d",
      image: "wavespeed-ai/hunyuan3d-v3/image-to-3d",
      sketch: "wavespeed-ai/hunyuan3d-v3/sketch-to-3d",
    },
    isActive: true,
  },
  {
    id: "meshy-6",
    label: "Meshy 6",
    badge: null,
    badgeColor: "",
    modes: ["text", "image"],
    price: "$0.20",
    endpoints: {
      text: "wavespeed-ai/meshy6/text-to-3d",
      image: "wavespeed-ai/meshy6/image-to-3d",
    },
    isActive: true,
  },
  {
    id: "hyper3d-rodin-2",
    label: "Hyper3D Rodin 2",
    badge: "PRO",
    badgeColor: "bg-amber-500",
    modes: ["text", "image"],
    price: "$0.40",
    endpoints: {
      text: "hyper3d/rodin-v2/text-to-3d",
      image: "hyper3d/rodin-v2/image-to-3d",
    },
    isActive: true,
  },
];

export const CURATED_LIPSYNC_MODELS: DynamicLipsyncModel[] = [
  {
    id: "sync-lipsync-3",
    name: "LipSync 3",
    family: "sync",
    family_label: "Sync",
    family_color: "#6366f1",
    badge: "NEW",
    description: "High-fidelity video and audio lip-sync. Provide a source video and a speech recording.",
    api_route: "sync/lipsync-3",
    route_confirmed: true,
    acceptedMedia: "video",
    isActive: true,
  },
  {
    id: "kling-ai-avatar-pro",
    name: "Kling AI Avatar 2.0",
    family: "kling",
    family_label: "Kling",
    family_color: "#06b6d4",
    badge: "PRO",
    description: "Sync avatar lips to audio. Provide a clear face portrait image and an audio recording.",
    api_route: "kling/ai-avatar-pro",
    route_confirmed: true,
    acceptedMedia: "image_or_video",
    isActive: true,
  },
  {
    id: "infinitalk-from-audio",
    name: "Infinitalk API-AI lip-sync generator",
    family: "other",
    family_label: "Infinitalk",
    family_color: "#10b981",
    badge: "PRO",
    description: "Speech to video talking head lip-sync generator. Provide a clear face portrait image and an audio recording.",
    api_route: "infinitalk/from-audio",
    route_confirmed: true,
    acceptedMedia: "image_or_video",
    isActive: true,
  },
  {
    id: "bytedance-seedance-2",
    name: "Seedance 2.0",
    family: "seedance",
    family_label: "Seedance",
    family_color: "#f59e0b",
    badge: "NEW",
    description: "Audio-driven reference video generation. Provide reference image/video and audio source.",
    api_route: "bytedance/seedance-2",
    route_confirmed: true,
    acceptedMedia: "image_or_video",
    isActive: true,
  },
  {
    id: "bytedance-seedance-2-fast",
    name: "Seedance 2.0 Fast",
    family: "seedance",
    family_label: "Seedance",
    family_color: "#ec4899",
    badge: "FAST",
    description: "Faster audio-driven reference video generation. Provide reference image/video and audio source.",
    api_route: "bytedance/seedance-2-fast",
    route_confirmed: true,
    acceptedMedia: "image_or_video",
    isActive: true,
  },
];

export const CURATED_GEMINI_TTS_VOICES: DynamicTTSVoice[] = [
  { id: "Sulafat", name: "Sulafat (أنثى - Warm)" },
  { id: "Zephyr", name: "Zephyr (أنثى - Bright)" },
  { id: "Puck", name: "Puck (ذكر - Upbeat)" },
  { id: "Charon", name: "Charon (ذكر - Informative)" },
  { id: "Kore", name: "Kore (أنثى - Firm)" },
  { id: "Fenrir", name: "Fenrir (ذكر - Excitable)" },
  { id: "Leda", name: "Leda (أنثى - Youthful)" },
  { id: "Orus", name: "Orus (ذكر - Firm)" },
  { id: "Aoede", name: "Aoede (أنثى - Breezy)" },
  { id: "Callirrhoe", name: "Callirrhoe (أنثى - Easy-going)" },
  { id: "Autonoe", name: "Autonoe (أنثى - Bright)" },
  { id: "Enceladus", name: "Enceladus (ذكر - Breathy)" },
  { id: "Iapetus", name: "Iapetus (ذكر - Clear)" },
  { id: "Umbriel", name: "Umbriel (ذكر - Easy-going)" },
  { id: "Algieba", name: "Algieba (ذكر - Smooth)" },
  { id: "Despina", name: "Despina (أنثى - Smooth)" },
  { id: "Erinome", name: "Erinome (أنثى - Clear)" },
  { id: "Algenib", name: "Algenib (ذكر - Gravelly)" },
  { id: "Rasalgethi", name: "Rasalgethi (ذكر - Informative)" },
  { id: "Laomedeia", name: "Laomedeia (أنثى - Upbeat)" },
  { id: "Achernar", name: "Achernar (أنثى - Soft)" },
  { id: "Alnilam", name: "Alnilam (ذكر - Firm)" },
  { id: "Schedar", name: "Schedar (أنثى - Even)" },
  { id: "Gacrux", name: "Gacrux (أنثى - Mature)" },
  { id: "Pulcherrima", name: "Pulcherrima (أنثى - Forward)" },
  { id: "Achird", name: "Achird (ذكر - Friendly)" },
  { id: "Zubenelgenubi", name: "Zubenelgenubi (ذكر - Casual)" },
  { id: "Vindemiatrix", name: "Vindemiatrix (أنثى - Gentle)" },
  { id: "Sadachbia", name: "Sadachbia (ذكر - Lively)" },
  { id: "Sadaltager", name: "Sadaltager (ذكر - Knowledgeable)" },
];

export const CURATED_ELEVENLABS_TTS_VOICES: DynamicTTSVoice[] = [
  { id: "Alicia", name: "Alicia (Expressive - Multilingual)" },
  { id: "Aria", name: "Aria (Multilingual - Expressive)" },
  { id: "Roger", name: "Roger (Confident - Narrator)" },
  { id: "Sarah", name: "Sarah (Warm - News / Commercial)" },
  { id: "Laura", name: "Laura (Upbeat - Conversational)" },
  { id: "Charlie", name: "Charlie (Casual - Deep)" },
  { id: "George", name: "George (Warm - Storyteller)" },
  { id: "Callum", name: "Callum (Intense - Gaming)" },
  { id: "River", name: "River (Relaxed - Natural)" },
  { id: "Liam", name: "Liam (Energetic - Young)" },
  { id: "Charlotte", name: "Charlotte (Seductive - Calm)" },
  { id: "Alice", name: "Alice (Clear - Direct)" },
  { id: "Matilda", name: "Matilda (Friendly - Warm)" },
  { id: "Will", name: "Will (Friendly - Natural)" },
  { id: "Jessica", name: "Jessica (Playful - Young)" },
  { id: "Eric", name: "Eric (Authoritative - Corporate)" },
  { id: "Chris", name: "Chris (Casual - Friendly)" },
  { id: "Brian", name: "Brian (Deep - Resonant)" },
  { id: "Daniel", name: "Daniel (Authoritative - Formal)" },
  { id: "Lily", name: "Lily (Warm - Commercial)" },
  { id: "Bill", name: "Bill (Deep - Documentary)" },
];

export const CURATED_TTS_MODELS: DynamicTTSModel[] = [
  {
    id: "elevenlabs/eleven-v4",
    name: "ElevenLabs Eleven V4",
    family: "elevenlabs",
    badge: "NEW",
    description: "Expressive multilingual speech with inline audio tags",
    provider: "elevenlabs",
    voices: CURATED_ELEVENLABS_TTS_VOICES,
    defaultVoice: "Alicia",
    hasEmotion: false,
    hasStability: true,
    hasClarity: true,
    hasSpeed: false,
    isActive: true,
  },
  {
    id: "elevenlabs/eleven-v4-turbo",
    name: "ElevenLabs Eleven V4 Turbo",
    family: "elevenlabs",
    badge: "NEW",
    description: "Fast expressive multilingual speech for rapid production",
    provider: "elevenlabs",
    voices: CURATED_ELEVENLABS_TTS_VOICES,
    defaultVoice: "Alicia",
    hasEmotion: false,
    hasStability: true,
    hasClarity: true,
    hasSpeed: false,
    isActive: true,
  },
  {
    id: "elevenlabs/text-to-speech-multilingual-v2",
    name: "ElevenLabs Multilingual v2",
    family: "elevenlabs",
    badge: "PRO",
    description: "State-of-the-art multilingual voice synthesis with emotional depth",
    provider: "elevenlabs",
    voices: CURATED_ELEVENLABS_TTS_VOICES,
    defaultVoice: "Aria",
    hasEmotion: false,
    hasStability: true,
    hasClarity: true,
    hasSpeed: true,
    isActive: true,
  },
  {
    id: "gemini-3.1-flash-live-preview",
    name: "Gemini 3.1 Flash Live",
    family: "google",
    badge: "FAST",
    description: "Ultra fast ultra-natural conversational speech synthesis",
    provider: "google",
    voices: CURATED_GEMINI_TTS_VOICES,
    defaultVoice: "Sulafat",
    hasEmotion: true,
    hasStability: false,
    hasClarity: false,
    hasSpeed: true,
    isActive: true,
  },
  {
    id: "gemini-3.1-flash-tts-preview",
    name: "Gemini 3.1 Flash TTS Preview",
    family: "google",
    badge: "NEW",
    description: "Advanced Google TTS preview with 30 studio voices",
    provider: "google",
    voices: CURATED_GEMINI_TTS_VOICES,
    defaultVoice: "Puck",
    hasEmotion: true,
    hasStability: false,
    hasClarity: false,
    hasSpeed: true,
    isActive: true,
  },
  {
    id: "gemini-2.5-flash-preview-tts",
    name: "Gemini 2.5 Flash Preview",
    family: "google",
    badge: "PREVIEW",
    description: "High speed Google Gemini speech generation",
    provider: "google",
    voices: CURATED_GEMINI_TTS_VOICES,
    defaultVoice: "Puck",
    hasEmotion: true,
    hasStability: false,
    hasClarity: false,
    hasSpeed: true,
    isActive: true,
  },
  {
    id: "gemini-2.5-pro-preview-tts",
    name: "Gemini 2.5 Pro Preview",
    family: "google",
    badge: "PRO",
    description: "High quality Google Gemini reasoning-guided speech generation",
    provider: "google",
    voices: CURATED_GEMINI_TTS_VOICES,
    defaultVoice: "Charon",
    hasEmotion: true,
    hasStability: false,
    hasClarity: false,
    hasSpeed: true,
    isActive: true,
  },
];

const REGISTRY_PROVENANCE: ModelDefinitionProvenance = {
  source: "curated_registry",
  sourceUrl: null,
  documentId: null,
  section: "static/dynamic model registry",
  approvedAt: null,
};

function selectParam(id: string, label: string, options: Array<string | number | boolean>, defaultValue: string | number | boolean | null = options[0] ?? null): ModelParameterDefinition | null {
  if (!options.length) return null;
  return {
    id,
    label,
    type: "select",
    required: false,
    defaultValue,
    options,
    visible: true,
    supported: true,
    provenance: [REGISTRY_PROVENANCE],
  };
}

function numberParam(id: string, label: string, max: number, defaultValue: number, min = 1): ModelParameterDefinition | null {
  if (!Number.isFinite(max) || max <= 0) return null;
  return {
    id,
    label,
    type: "number",
    required: false,
    defaultValue,
    min,
    max,
    step: 1,
    visible: true,
    supported: true,
    provenance: [REGISTRY_PROVENANCE],
  };
}

function compactParams(params: Array<ModelParameterDefinition | null>): ModelParameterDefinition[] {
  return params.filter(Boolean) as ModelParameterDefinition[];
}

export function buildImageModelDefinition(model: DynamicImageModel): CentralModelDefinition {
  const source = resolveImageModelSource(model);
  const maxImages = Math.max(1, Number(model.maxImages) || 1);
  const maxRefImages = Math.max(0, Number(model.maxRefImages) || 0);
  const supportsRefs = maxRefImages > 0;
  const isImageInput = model.inputType === "image-to-image" || model.inputType === "edit";

  return {
    modelId: model.id,
    displayName: model.label,
    modality: "image",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: model.upstreamModelId || model.id,
    version: null,
    pricingRef: model.id,
    routingRef: model.id,
    capabilities: {
      textToImage: model.inputType === "text-to-image",
      imageToImage: isImageInput,
      referenceImages: supportsRefs ? maxRefImages : false,
      multipleOutputs: maxImages > 1,
      seed: Boolean(model.grokMode || model.wanSequentialMode),
    },
    parameters: compactParams([
      selectParam("aspectRatio", "Aspect Ratio", model.aspectRatios || []),
      selectParam("quality", "Quality", model.qualityParam || []),
      numberParam("numOutputs", "Number of Outputs", maxImages, 1),
      numberParam("referenceImages", "Reference Images", maxRefImages, isImageInput ? Math.min(1, maxRefImages) : 0, 0),
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: supportsRefs, min: isImageInput && supportsRefs ? 1 : 0, max: maxRefImages, required: isImageInput && supportsRefs },
      referenceVideos: { supported: false, min: 0, max: 0, required: false },
      referenceAudios: { supported: false, min: 0, max: 0, required: false },
    },
    outputs: {
      mediaTypes: ["image"],
      multipleOutputs: maxImages > 1,
      maxOutputs: maxImages,
    },
    limits: {
      maxImages,
      maxReferenceImages: maxRefImages,
    },
    defaults: {
      aspectRatio: model.aspectRatios?.[0] ?? null,
      quality: model.qualityParam?.[0] ?? null,
      numOutputs: 1,
    },
    runtimeSource: source.runtimeSource,
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildVideoModelDefinition(model: DynamicVideoModel): CentralModelDefinition {
  const source = resolveVideoModelSource(model);
  const caps = model.capabilities;
  const durations = caps?.durations ?? [];
  const resolutions = caps?.resolutions ?? [];
  const aspectRatios = caps?.aspect_ratios ?? [];
  const maxReferenceImages = Math.max(0, Number(caps?.max_reference_images) || 0);
  const maxReferenceVideos = Math.max(0, Number(caps?.max_reference_videos) || 0);
  const maxReferenceAudios = Math.max(0, Number(caps?.max_reference_audios) || 0);
  const requiresImage = Boolean(caps?.requires_image);
  const requiresVideo = Boolean(caps?.requires_video);

  return {
    modelId: model.id,
    displayName: model.name,
    modality: "video",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: model.api_route || model.id,
    version: null,
    pricingRef: model.api_route || model.id,
    routingRef: model.api_route || model.id,
    capabilities: {
      textToVideo: !requiresImage && !requiresVideo,
      imageToVideo: requiresImage || Boolean(caps?.optional_image),
      videoToVideo: requiresVideo || Boolean(caps?.optional_video),
      referenceImages: maxReferenceImages || false,
      referenceVideos: maxReferenceVideos || false,
      referenceAudios: maxReferenceAudios || false,
      audioInput: maxReferenceAudios > 0,
      audioOutput: Boolean(caps?.has_sound),
      multipleOutputs: false,
      seed: Boolean(caps?.has_seed),
      negativePrompt: Boolean(caps?.has_negative_prompt),
      loop: Boolean(caps?.has_loop),
      extendVideo: Boolean(caps?.optional_video),
      editVideo: requiresVideo || Boolean(caps?.optional_video),
    },
    parameters: compactParams([
      selectParam("resolution", "Resolution", resolutions),
      selectParam("duration", "Duration", durations),
      selectParam("aspectRatio", "Aspect Ratio", aspectRatios),
      numberParam("referenceImages", "Reference Images", maxReferenceImages, requiresImage ? Math.min(1, maxReferenceImages) : 0, 0),
      numberParam("referenceVideos", "Reference Videos", maxReferenceVideos, requiresVideo ? Math.min(1, maxReferenceVideos) : 0, 0),
      numberParam("referenceAudios", "Reference Audios", maxReferenceAudios, 0, 0),
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: maxReferenceImages > 0 || requiresImage, min: requiresImage ? 1 : 0, max: maxReferenceImages, required: requiresImage },
      referenceVideos: { supported: maxReferenceVideos > 0 || requiresVideo, min: requiresVideo ? 1 : 0, max: maxReferenceVideos, required: requiresVideo },
      referenceAudios: { supported: maxReferenceAudios > 0, min: 0, max: maxReferenceAudios, required: false },
    },
    outputs: {
      mediaTypes: ["video"],
      multipleOutputs: false,
      maxOutputs: 1,
    },
    limits: {
      maxReferenceImages,
      maxReferenceVideos,
      maxReferenceAudios,
      maxReferenceVideoTotalSeconds: caps?.max_reference_video_total_seconds ?? 0,
      maxReferenceAudioTotalSeconds: caps?.max_reference_audio_total_seconds ?? 0,
    },
    defaults: {
      resolution: resolutions[0] ?? null,
      duration: durations[0] ?? null,
      aspectRatio: aspectRatios[0] ?? null,
    },
    runtimeSource: source.runtimeSource,
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildAudioModelDefinition(model: DynamicMusicModel): CentralModelDefinition {
  const maxRefImages = Math.max(0, Number(model.maxReferenceImages) || 0);
  const durations = model.durations || [model.defaultDuration];

  return {
    modelId: model.id,
    displayName: model.label,
    modality: "audio",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: model.id,
    version: null,
    pricingRef: model.id,
    routingRef: model.id,
    capabilities: {
      textToAudio: true,
      audioOutput: true,
      lyrics: Boolean(model.hasLyrics),
      instrumental: true,
      referenceImages: maxRefImages > 0 ? maxRefImages : false,
      multipleOutputs: false,
    },
    parameters: compactParams([
      selectParam("duration", "Duration", durations, model.defaultDuration),
      numberParam("referenceImages", "Reference Images", maxRefImages, 0, 0),
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: maxRefImages > 0, min: 0, max: maxRefImages, required: false },
      referenceVideos: { supported: false, min: 0, max: 0, required: false },
      referenceAudios: { supported: false, min: 0, max: 0, required: false },
    },
    outputs: {
      mediaTypes: ["audio"],
      multipleOutputs: false,
      maxOutputs: 1,
    },
    limits: {
      maxDuration: model.maxDuration || durations[durations.length - 1] || 300,
      maxReferenceImages: maxRefImages,
    },
    defaults: {
      duration: model.defaultDuration,
    },
    runtimeSource: "google",
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildThreeDModelDefinition(model: DynamicThreeDModel): CentralModelDefinition {
  const modes = model.modes || ["text", "image"];
  const requiresImage = modes.every((m) => m === "image" || m === "multiview");
  const supportsMultiview = modes.includes("multiview");
  const maxRefImages = supportsMultiview ? 4 : requiresImage ? 1 : 1;

  return {
    modelId: model.id,
    displayName: model.label,
    modality: "3d",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: Object.values(model.endpoints)[0] || model.id,
    version: null,
    pricingRef: `${model.id}.${modes[0]}`,
    routingRef: `${model.id}.${modes[0]}`,
    capabilities: {
      textTo3D: modes.includes("text"),
      imageTo3D: modes.includes("image"),
      multiviewTo3D: modes.includes("multiview"),
      sketchTo3D: modes.includes("sketch"),
      referenceImages: maxRefImages,
      multipleOutputs: false,
    },
    parameters: compactParams([
      selectParam("mode", "Generation Mode", modes, modes[0]),
      numberParam("referenceImages", "Reference Images", maxRefImages, requiresImage ? 1 : 0, 0),
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: modes.some((m) => m !== "text"), min: requiresImage ? 1 : 0, max: maxRefImages, required: requiresImage },
      referenceVideos: { supported: false, min: 0, max: 0, required: false },
      referenceAudios: { supported: false, min: 0, max: 0, required: false },
    },
    outputs: {
      mediaTypes: ["3d"],
      multipleOutputs: false,
      maxOutputs: 1,
    },
    limits: {
      maxReferenceImages: maxRefImages,
    },
    defaults: {
      mode: modes[0] ?? "text",
    },
    runtimeSource: "wavespeed",
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildLipsyncModelDefinition(model: DynamicLipsyncModel): CentralModelDefinition {
  const requiresVideo = model.acceptedMedia === "video";
  const acceptsImageOrVideo = model.acceptedMedia === "image_or_video" || !requiresVideo;

  return {
    modelId: model.id,
    displayName: model.name,
    modality: "video",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: model.api_route,
    version: null,
    pricingRef: model.api_route,
    routingRef: model.api_route,
    capabilities: {
      textToVideo: false,
      imageToVideo: acceptsImageOrVideo,
      videoToVideo: true,
      audioInput: true,
      audioOutput: true,
      referenceImages: acceptsImageOrVideo ? 1 : 0,
      referenceVideos: 1,
      referenceAudios: 1,
      multipleOutputs: false,
    },
    parameters: compactParams([
      selectParam("acceptedMedia", "Accepted Media", [model.acceptedMedia || "image_or_video"]),
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: acceptsImageOrVideo, min: requiresVideo ? 0 : 1, max: 1, required: !requiresVideo },
      referenceVideos: { supported: true, min: requiresVideo ? 1 : 0, max: 1, required: requiresVideo },
      referenceAudios: { supported: true, min: 1, max: 1, required: true },
    },
    outputs: {
      mediaTypes: ["video"],
      multipleOutputs: false,
      maxOutputs: 1,
    },
    limits: {
      maxReferenceImages: acceptsImageOrVideo ? 1 : 0,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
    },
    defaults: {
      acceptedMedia: model.acceptedMedia || "image_or_video",
    },
    runtimeSource: model.family === "kling" ? "kie" : "wavespeed",
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildTTSModelDefinition(model: DynamicTTSModel): CentralModelDefinition {
  const voiceIds = model.voices.map((v) => v.id);

  return {
    modelId: model.id,
    displayName: model.name,
    modality: "audio",
    status: model.isActive === false ? "disabled" : "active",
    sourceModelId: model.id,
    version: null,
    pricingRef: model.id,
    routingRef: model.id,
    capabilities: {
      textToAudio: true,
      audioOutput: true,
      referenceImages: false,
      referenceVideos: false,
      referenceAudios: false,
      multipleOutputs: false,
    },
    parameters: compactParams([
      selectParam("voice", "Voice", voiceIds, model.defaultVoice),
      model.hasSpeed ? numberParam("speed", "Speed", 2, 1, 0.5) : null,
      model.hasStability ? numberParam("stability", "Stability", 1, 0.5, 0) : null,
      model.hasClarity ? numberParam("clarity", "Clarity", 1, 0.75, 0) : null,
    ]),
    parameterRules: [],
    inputs: {
      referenceImages: { supported: false, min: 0, max: 0, required: false },
      referenceVideos: { supported: false, min: 0, max: 0, required: false },
      referenceAudios: { supported: false, min: 0, max: 0, required: false },
    },
    outputs: {
      mediaTypes: ["audio"],
      multipleOutputs: false,
      maxOutputs: 1,
    },
    limits: {
      maxTextLength: 5000,
    },
    defaults: {
      voice: model.defaultVoice,
    },
    runtimeSource: model.provider === "google" ? "google" : "wavespeed",
    definitionSource: "central",
    provenance: [REGISTRY_PROVENANCE],
  };
}

export function buildCentralModelDefinitions(input: {
  imageModels?: DynamicImageModel[];
  videoModels?: DynamicVideoModel[];
  musicModels?: DynamicMusicModel[];
  threeDModels?: DynamicThreeDModel[];
  lipsyncModels?: DynamicLipsyncModel[];
  ttsModels?: DynamicTTSModel[];
}): CentralModelDefinition[] {
  const images = input.imageModels ?? [];
  const videos = input.videoModels ?? [];
  const music = input.musicModels ?? [];
  const threeD = input.threeDModels ?? [];
  const lipsync = input.lipsyncModels ?? [];
  const tts = input.ttsModels ?? [];

  return [
    ...images.map(buildImageModelDefinition),
    ...videos.map(buildVideoModelDefinition),
    ...music.map(buildAudioModelDefinition),
    ...threeD.map(buildThreeDModelDefinition),
    ...lipsync.map(buildLipsyncModelDefinition),
    ...tts.map(buildTTSModelDefinition),
  ];
}

export async function getCentralModelDefinitions(): Promise<CentralModelDefinition[]> {
  const [imageModels, videoModels] = await Promise.all([getDynamicImageModels(), getDynamicVideoModels()]);
  return buildCentralModelDefinitions({
    imageModels,
    videoModels,
    musicModels: CURATED_MUSIC_MODELS,
    threeDModels: CURATED_THREE_D_MODELS,
    lipsyncModels: CURATED_LIPSYNC_MODELS,
    ttsModels: CURATED_TTS_MODELS,
  });
}

export async function getCentralizedDynamicImageModels(): Promise<DynamicImageModel[]> {
  const imageModels = await getDynamicImageModels();
  return applyCentralDefinitionsToImageModels(
    imageModels,
    buildCentralModelDefinitions({ imageModels, videoModels: [] }),
  );
}

export async function getCentralizedDynamicVideoModels(): Promise<DynamicVideoModel[]> {
  const videoModels = await getDynamicVideoModels();
  return applyCentralDefinitionsToVideoModels(
    videoModels,
    buildCentralModelDefinitions({ imageModels: [], videoModels }),
  );
}

export function getCentralizedDynamicMusicModels(customModels: DynamicMusicModel[] = CURATED_MUSIC_MODELS): DynamicMusicModel[] {
  const definitions = buildCentralModelDefinitions({ musicModels: customModels });
  return applyCentralDefinitionsToMusicModels(customModels, definitions);
}

export function getCentralizedDynamicThreeDModels(customModels: DynamicThreeDModel[] = CURATED_THREE_D_MODELS): DynamicThreeDModel[] {
  const definitions = buildCentralModelDefinitions({ threeDModels: customModels });
  return applyCentralDefinitionsToThreeDModels(customModels, definitions);
}

export function getCentralizedDynamicLipsyncModels(customModels: DynamicLipsyncModel[] = CURATED_LIPSYNC_MODELS): DynamicLipsyncModel[] {
  const definitions = buildCentralModelDefinitions({ lipsyncModels: customModels });
  return applyCentralDefinitionsToLipsyncModels(customModels, definitions);
}

export function getCentralizedDynamicTTSModels(customModels: DynamicTTSModel[] = CURATED_TTS_MODELS): DynamicTTSModel[] {
  const definitions = buildCentralModelDefinitions({ ttsModels: customModels });
  return applyCentralDefinitionsToTTSModels(customModels, definitions);
}

export function getModelDefinitionFromList(modelId: string, definitions: CentralModelDefinition[]): CentralModelDefinition | null {
  return definitions.find((definition) => definition.modelId === modelId || definition.sourceModelId === modelId) ?? null;
}

export function getModelDefinitionParameterOptions(definition: CentralModelDefinition | null, parameterId: string): string[] {
  if (!definition) return [];
  const param = definition.parameters.find((item) => item.id === parameterId);
  return Array.isArray(param?.options) ? param.options.map(String) : [];
}

function optionsFor(definition: CentralModelDefinition, parameterId: string): string[] {
  return getModelDefinitionParameterOptions(definition, parameterId);
}

function numberLimit(definition: CentralModelDefinition, parameterId: string, fallback: number): number {
  const param = definition.parameters.find((item) => item.id === parameterId);
  return Number.isFinite(param?.max) ? Number(param?.max) : fallback;
}

export function applyCentralDefinitionsToImageModels(models: DynamicImageModel[], definitions: CentralModelDefinition[]): DynamicImageModel[] {
  return models.map((model) => applyCentralDefinitionToImageModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionsToVideoModels(models: DynamicVideoModel[], definitions: CentralModelDefinition[]): DynamicVideoModel[] {
  return models.map((model) => applyCentralDefinitionToVideoModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionsToMusicModels(models: DynamicMusicModel[], definitions: CentralModelDefinition[]): DynamicMusicModel[] {
  return models.map((model) => applyCentralDefinitionToMusicModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionsToThreeDModels(models: DynamicThreeDModel[], definitions: CentralModelDefinition[]): DynamicThreeDModel[] {
  return models.map((model) => applyCentralDefinitionToThreeDModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionsToLipsyncModels(models: DynamicLipsyncModel[], definitions: CentralModelDefinition[]): DynamicLipsyncModel[] {
  return models.map((model) => applyCentralDefinitionToLipsyncModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionsToTTSModels(models: DynamicTTSModel[], definitions: CentralModelDefinition[]): DynamicTTSModel[] {
  return models.map((model) => applyCentralDefinitionToTTSModel(model, getModelDefinitionFromList(model.id, definitions)));
}

export function applyCentralDefinitionToImageModel(model: DynamicImageModel, definition: CentralModelDefinition | null): DynamicImageModel {
  if (!definition) return model;
  return {
    ...model,
    label: definition.displayName,
    upstreamModelId: definition.sourceModelId,
    aspectRatios: optionsFor(definition, "aspectRatio"),
    qualityParam: optionsFor(definition, "quality").length ? optionsFor(definition, "quality") : model.qualityParam,
    maxImages: numberLimit(definition, "numOutputs", model.maxImages),
    maxRefImages: definition.inputs.referenceImages.max,
    isActive: definition.status === "active",
  };
}

export function applyCentralDefinitionToVideoModel(model: DynamicVideoModel, definition: CentralModelDefinition | null): DynamicVideoModel {
  if (!definition) return model;
  return {
    ...model,
    name: definition.displayName,
    api_route: definition.sourceModelId,
    isActive: definition.status === "active",
    capabilities: {
      ...model.capabilities,
      aspect_ratios: optionsFor(definition, "aspectRatio"),
      durations: optionsFor(definition, "duration").map(Number).filter(Number.isFinite),
      resolutions: optionsFor(definition, "resolution"),
      max_reference_images: definition.inputs.referenceImages.max,
      max_reference_videos: definition.inputs.referenceVideos.max,
      max_reference_audios: definition.inputs.referenceAudios.max,
    },
  };
}

export function applyCentralDefinitionToMusicModel(model: DynamicMusicModel, definition: CentralModelDefinition | null): DynamicMusicModel {
  if (!definition) return model;
  const durations = optionsFor(definition, "duration").map(Number).filter(Number.isFinite);
  const maxDuration = Number(definition.limits.maxDuration) || (durations.length ? durations[durations.length - 1] : model.maxDuration);
  const defaultDuration = Number(definition.defaults.duration) || model.defaultDuration;

  return {
    ...model,
    label: definition.displayName,
    hasLyrics: Boolean(definition.capabilities.lyrics),
    durations: durations.length ? durations : model.durations,
    maxDuration,
    defaultDuration,
    maxReferenceImages: definition.inputs.referenceImages.max,
    isActive: definition.status === "active",
  };
}

export function applyCentralDefinitionToThreeDModel(model: DynamicThreeDModel, definition: CentralModelDefinition | null): DynamicThreeDModel {
  if (!definition) return model;
  const modes = optionsFor(definition, "mode") as Array<"text" | "image" | "multiview" | "sketch">;

  return {
    ...model,
    label: definition.displayName,
    modes: modes.length ? modes : model.modes,
    isActive: definition.status === "active",
  };
}

export function applyCentralDefinitionToLipsyncModel(model: DynamicLipsyncModel, definition: CentralModelDefinition | null): DynamicLipsyncModel {
  if (!definition) return model;
  const acceptedMedia = (optionsFor(definition, "acceptedMedia")[0] || model.acceptedMedia || "image_or_video") as "video" | "image_or_video";

  return {
    ...model,
    name: definition.displayName,
    api_route: definition.sourceModelId,
    acceptedMedia,
    isActive: definition.status === "active",
  };
}

export function applyCentralDefinitionToTTSModel(model: DynamicTTSModel, definition: CentralModelDefinition | null): DynamicTTSModel {
  if (!definition) return model;
  const voiceIds = optionsFor(definition, "voice");
  const filteredVoices = voiceIds.length
    ? model.voices.filter((v) => voiceIds.includes(v.id))
    : model.voices;

  return {
    ...model,
    name: definition.displayName,
    voices: filteredVoices.length ? filteredVoices : model.voices,
    defaultVoice: String(definition.defaults.voice || model.defaultVoice),
    isActive: definition.status === "active",
  };
}
