import { describe, expect, it } from "vitest";

import {
  applyCentralDefinitionsToImageModels,
  applyCentralDefinitionsToVideoModels,
  applyCentralDefinitionsToMusicModels,
  applyCentralDefinitionsToThreeDModels,
  applyCentralDefinitionsToLipsyncModels,
  applyCentralDefinitionsToTTSModels,
  applyCentralDefinitionToImageModel,
  applyCentralDefinitionToVideoModel,
  applyCentralDefinitionToMusicModel,
  applyCentralDefinitionToThreeDModel,
  applyCentralDefinitionToLipsyncModel,
  applyCentralDefinitionToTTSModel,
  buildCentralModelDefinitions,
  getCentralizedDynamicMusicModels,
  getCentralizedDynamicThreeDModels,
  getCentralizedDynamicLipsyncModels,
  getCentralizedDynamicTTSModels,
  getModelDefinitionParameterOptions,
  CURATED_MUSIC_MODELS,
  CURATED_THREE_D_MODELS,
  CURATED_LIPSYNC_MODELS,
  CURATED_TTS_MODELS,
  type CentralModelDefinition,
  type DynamicMusicModel,
  type DynamicThreeDModel,
  type DynamicLipsyncModel,
  type DynamicTTSModel,
} from "@/lib/model-definition-registry";
import type { DynamicImageModel, DynamicVideoModel } from "@/lib/dynamic-model-loader";

const imageModel: DynamicImageModel = {
  id: "gpt-image-2-text-to-image",
  label: "GPT Image 2",
  sublabel: "Official OpenAI text-to-image",
  badge: "NEW",
  group: "OpenAI Images",
  inputType: "text-to-image",
  aspectRatios: ["1:1", "16:9"],
  maxImages: 1,
  maxRefImages: 0,
  qualityParam: ["low", "medium"],
  creditCost: 2,
  isActive: true,
};

const videoModel: DynamicVideoModel = {
  id: "bytedance-seedance-v2-t2v",
  name: "Seedance 2.0",
  family: "seedance",
  family_label: "Seedance",
  family_color: "#10b981",
  badge: "NEW",
  description: "Seedance video",
  api_route: "bytedance/seedance-2.0/text-to-video",
  route_confirmed: true,
  isActive: true,
  creditCost: 5,
  capabilities: {
    requires_image: false,
    optional_image: true,
    requires_video: false,
    optional_video: false,
    has_end_frame: true,
    aspect_ratios: ["16:9", "9:16"],
    sizes: [],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    quality_param: "resolution",
    max_reference_images: 4,
    max_reference_videos: 0,
    max_reference_video_total_seconds: 0,
    max_reference_audios: 0,
    max_reference_audio_total_seconds: 0,
    has_negative_prompt: false,
    has_loop: false,
    has_seed: false,
    has_cfg_scale: false,
    has_sound: true,
    sound_param: "generate_audio",
    has_shot_type: false,
    has_multi_prompt: false,
    has_element_list: false,
    has_scene_control: false,
    has_orientation: false,
    has_omni_tabs: false,
  },
};

function withChangedParam(definition: CentralModelDefinition, parameterId: string, options: Array<string | number>): CentralModelDefinition {
  return {
    ...definition,
    parameters: definition.parameters.map((parameter) =>
      parameter.id === parameterId ? { ...parameter, options } : parameter,
    ),
  };
}

function withChangedParamMax(definition: CentralModelDefinition, parameterId: string, max: number): CentralModelDefinition {
  return {
    ...definition,
    parameters: definition.parameters.map((parameter) =>
      parameter.id === parameterId ? { ...parameter, max } : parameter,
    ),
  };
}

function withChangedVideoCapabilities(definition: CentralModelDefinition): CentralModelDefinition {
  const withResolution = withChangedParam(definition, "resolution", ["720p", "1080p", "4k"]);
  const withDuration = withChangedParam(withResolution, "duration", [5, 10, 15]);
  const withAspect = withChangedParam(withDuration, "aspectRatio", ["16:9", "9:16", "21:9"]);
  return {
    ...withAspect,
    displayName: "Seedance Central Updated",
    inputs: {
      ...withAspect.inputs,
      referenceImages: { supported: true, min: 0, max: 8, required: false },
    },
  };
}

describe("central model definition registry", () => {
  it("builds central definitions for image, video, audio, and 3d models", () => {
    const definitions = buildCentralModelDefinitions({
      imageModels: [imageModel],
      videoModels: [videoModel],
      musicModels: CURATED_MUSIC_MODELS,
      threeDModels: CURATED_THREE_D_MODELS,
    });

    expect(definitions.length).toBeGreaterThanOrEqual(4);

    // Check image
    const imgDef = definitions.find((d) => d.modelId === "gpt-image-2-text-to-image");
    expect(imgDef).toMatchObject({
      modality: "image",
      definitionSource: "central",
    });

    // Check video
    const vidDef = definitions.find((d) => d.modelId === "bytedance-seedance-v2-t2v");
    expect(vidDef).toMatchObject({
      modality: "video",
      sourceModelId: "bytedance/seedance-2.0/text-to-video",
    });

    // Check music
    const musicDef = definitions.find((d) => d.modelId === "google/lyria-3-pro/music");
    expect(musicDef).toMatchObject({
      modality: "audio",
      displayName: "Google Lyria Pro",
      runtimeSource: "google",
    });

    // Check 3d
    const threeDDef = definitions.find((d) => d.modelId === "tripo3d-2.5");
    expect(threeDDef).toMatchObject({
      modality: "3d",
      displayName: "Tripo3D 2.5",
      runtimeSource: "wavespeed",
    });
  });

  it("propagates image model definition changes into the existing consumer shape", () => {
    const [definition] = buildCentralModelDefinitions({ imageModels: [imageModel], videoModels: [] });
    const changed = withChangedParam(
      { ...definition, displayName: "GPT Image 2 Pro", inputs: { ...definition.inputs, referenceImages: { supported: true, min: 0, max: 8, required: false } } },
      "quality",
      ["low", "medium", "high", "4K"],
    );

    const consumerModel = applyCentralDefinitionToImageModel(imageModel, changed);

    expect(consumerModel.label).toBe("GPT Image 2 Pro");
    expect(consumerModel.qualityParam).toEqual(["low", "medium", "high", "4K"]);
    expect(consumerModel.maxRefImages).toBe(8);
  });

  it("propagates video capabilities into Create Video's existing model shape", () => {
    const [definition] = buildCentralModelDefinitions({ imageModels: [], videoModels: [videoModel] });
    const changed = withChangedVideoCapabilities(definition);

    const consumerModel = applyCentralDefinitionToVideoModel(videoModel, changed);

    expect(consumerModel.name).toBe("Seedance Central Updated");
    expect(consumerModel.capabilities.resolutions).toEqual(["720p", "1080p", "4k"]);
    expect(consumerModel.capabilities.durations).toEqual([5, 10, 15]);
    expect(consumerModel.capabilities.aspect_ratios).toEqual(["16:9", "9:16", "21:9"]);
    expect(consumerModel.capabilities.max_reference_images).toBe(8);
  });

  it("propagates music definition changes (durations, limits, lyrics) directly to Music consumers", () => {
    const rawMusic = CURATED_MUSIC_MODELS[0];
    const [definition] = buildCentralModelDefinitions({ musicModels: [rawMusic] });

    const changedDef: CentralModelDefinition = {
      ...definition,
      displayName: "Google Lyria Pro Extended",
      capabilities: {
        ...definition.capabilities,
        lyrics: false,
      },
      parameters: definition.parameters.map((p) =>
        p.id === "duration" ? { ...p, options: [30, 60, 120, 600] } : p,
      ),
      limits: {
        ...definition.limits,
        maxDuration: 600,
        maxReferenceImages: 20,
      },
      defaults: {
        ...definition.defaults,
        duration: 120,
      },
      inputs: {
        ...definition.inputs,
        referenceImages: { supported: true, min: 0, max: 20, required: false },
      },
    };

    const consumerMusic = applyCentralDefinitionToMusicModel(rawMusic, changedDef);

    expect(consumerMusic.label).toBe("Google Lyria Pro Extended");
    expect(consumerMusic.hasLyrics).toBe(false);
    expect(consumerMusic.durations).toEqual([30, 60, 120, 600]);
    expect(consumerMusic.maxDuration).toBe(600);
    expect(consumerMusic.defaultDuration).toBe(120);
    expect(consumerMusic.maxReferenceImages).toBe(20);
  });

  it("propagates 3D definition changes (modes, display name) directly to 3D consumers", () => {
    const raw3D = CURATED_THREE_D_MODELS[0];
    const [definition] = buildCentralModelDefinitions({ threeDModels: [raw3D] });

    const changedDef: CentralModelDefinition = {
      ...definition,
      displayName: "Tripo3D 2.5 Ultra",
      parameters: definition.parameters.map((p) =>
        p.id === "mode" ? { ...p, options: ["image", "multiview", "sketch"] } : p,
      ),
    };

    const consumer3D = applyCentralDefinitionToThreeDModel(raw3D, changedDef);

    expect(consumer3D.label).toBe("Tripo3D 2.5 Ultra");
    expect(consumer3D.modes).toEqual(["image", "multiview", "sketch"]);
  });

  it("resolves centralized dynamic music and 3d models via dedicated getters", () => {
    const musicModels = getCentralizedDynamicMusicModels();
    expect(musicModels.length).toBe(2);
    expect(musicModels[0].id).toBe("google/lyria-3-pro/music");
    expect(musicModels[0].label).toBe("Google Lyria Pro");

    const threeDModels = getCentralizedDynamicThreeDModels();
    expect(threeDModels.length).toBe(5);
    expect(threeDModels.map((m) => m.id)).toEqual([
      "tripo3d-2.5",
      "hunyuan3d-3.1",
      "hunyuan3d-3",
      "meshy-6",
      "hyper3d-rodin-2",
    ]);

    const lipsyncModels = getCentralizedDynamicLipsyncModels();
    expect(lipsyncModels.length).toBe(5);
    expect(lipsyncModels[0].id).toBe("sync-lipsync-3");

    const ttsModels = getCentralizedDynamicTTSModels();
    expect(ttsModels.length).toBe(7);
    expect(ttsModels.some((m) => m.id === "elevenlabs/text-to-speech-multilingual-v2")).toBe(true);
    expect(ttsModels.some((m) => m.id === "gemini-3.1-flash-tts-preview")).toBe(true);
  });

  it("propagates lipsync definition changes (display name, acceptedMedia, route) directly to Lipsync consumers", () => {
    const rawLipsync = CURATED_LIPSYNC_MODELS[0];
    const [definition] = buildCentralModelDefinitions({ lipsyncModels: [rawLipsync] });

    const changedDef: CentralModelDefinition = {
      ...definition,
      displayName: "LipSync 3 Ultra Pro",
      sourceModelId: "sync/lipsync-3-ultra",
      parameters: definition.parameters.map((p) =>
        p.id === "acceptedMedia" ? { ...p, options: ["image_or_video"] } : p,
      ),
    };

    const consumerLipsync = applyCentralDefinitionToLipsyncModel(rawLipsync, changedDef);

    expect(consumerLipsync.name).toBe("LipSync 3 Ultra Pro");
    expect(consumerLipsync.api_route).toBe("sync/lipsync-3-ultra");
    expect(consumerLipsync.acceptedMedia).toBe("image_or_video");
  });

  it("propagates TTS definition changes (display name, voices, defaultVoice) directly to TTS consumers", () => {
    const rawTTS = CURATED_TTS_MODELS.find((model) => model.id === "gemini-3.1-flash-tts-preview")!;
    const [definition] = buildCentralModelDefinitions({ ttsModels: [rawTTS] });

    const changedDef: CentralModelDefinition = {
      ...definition,
      displayName: "Gemini 3.1 Live Custom Voices",
      defaults: { ...definition.defaults, voice: "Zephyr" },
      parameters: definition.parameters.map((p) =>
        p.id === "voice" ? { ...p, options: ["Zephyr", "Puck"] } : p,
      ),
    };

    const consumerTTS = applyCentralDefinitionToTTSModel(rawTTS, changedDef);

    expect(consumerTTS.name).toBe("Gemini 3.1 Live Custom Voices");
    expect(consumerTTS.defaultVoice).toBe("Zephyr");
    expect(consumerTTS.voices.map((v) => v.id)).toEqual(["Zephyr", "Puck"]);
  });

  it("keeps UI/runtime parity by resolving migrated consumers from the same central definition", () => {
    const [definition] = buildCentralModelDefinitions({ imageModels: [], videoModels: [videoModel] });
    const changed = withChangedVideoCapabilities(definition);
    const uiConsumerModels = applyCentralDefinitionsToVideoModels([videoModel], [changed]);
    const runtimeConsumerModels = applyCentralDefinitionsToVideoModels([videoModel], [changed]);

    expect(uiConsumerModels[0].name).toBe("Seedance Central Updated");
    expect(runtimeConsumerModels[0].name).toBe("Seedance Central Updated");
    expect(uiConsumerModels[0].capabilities.resolutions).toContain("4k");
    expect(runtimeConsumerModels[0].capabilities.resolutions).toContain("4k");
    expect(uiConsumerModels[0].capabilities.durations).toContain(15);
    expect(runtimeConsumerModels[0].capabilities.durations).toContain(15);
    expect(uiConsumerModels[0].capabilities.aspect_ratios).toContain("21:9");
    expect(runtimeConsumerModels[0].capabilities.aspect_ratios).toContain("21:9");
    expect(uiConsumerModels[0].capabilities.max_reference_images).toBe(8);
    expect(runtimeConsumerModels[0].capabilities.max_reference_images).toBe(8);
  });

  it("does not expose unsupported central options to migrated consumer shapes", () => {
    const [definition] = buildCentralModelDefinitions({ imageModels: [], videoModels: [videoModel] });
    const changed = withChangedParam(definition, "resolution", ["720p"]);
    const [consumerModel] = applyCentralDefinitionsToVideoModels([videoModel], [changed]);

    expect(getModelDefinitionParameterOptions(changed, "resolution")).toEqual(["720p"]);
    expect(consumerModel.capabilities.resolutions).toEqual(["720p"]);
    expect(consumerModel.capabilities.resolutions).not.toContain("4k");
  });

  it("propagates central image output, aspect, quality, and reference limits through batch helpers", () => {
    const [definition] = buildCentralModelDefinitions({ imageModels: [imageModel], videoModels: [] });
    const withQuality = withChangedParam(definition, "quality", ["low", "medium", "4K"]);
    const withAspect = withChangedParam(withQuality, "aspectRatio", ["1:1", "16:9", "21:9"]);
    const withOutputs = withChangedParamMax(withAspect, "numOutputs", 4);
    const changed = {
      ...withOutputs,
      displayName: "GPT Image Central Updated",
      inputs: {
        ...withOutputs.inputs,
        referenceImages: { supported: true, min: 0, max: 8, required: false },
      },
    };

    const [consumerModel] = applyCentralDefinitionsToImageModels([imageModel], [changed]);

    expect(consumerModel.label).toBe("GPT Image Central Updated");
    expect(consumerModel.qualityParam).toContain("4K");
    expect(consumerModel.aspectRatios).toContain("21:9");
    expect(consumerModel.maxImages).toBe(4);
    expect(consumerModel.maxRefImages).toBe(8);
  });
});
