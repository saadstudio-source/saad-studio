"use client";

import React, { useState, useRef, useEffect, useId, useCallback } from "react";
import {
  Wand2,
  Film,
  Maximize2,
  Crop,
  Scissors,
  SunMedium,
  Gauge,
  Box,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  X,
  Upload,
  Info,
  Layers,
  Sparkles,
  Sliders,
  Check,
} from "lucide-react";
import { uploadVideoRequestFile } from "@/lib/video-upload-helper";

export interface EditPanelState {
  activeTool: string | null;
  isReady: boolean;
  calculatedCredits: number;
  buttonLabel: string;
  placeholder: string;
  isPromptDisabled: boolean;
  executeGenerate: () => Promise<void>;
}

export interface EditVideoSidebarPanelProps {
  lang?: "ar" | "en";
  userCredits?: number;
  initialTool?: string | null;
  promptText?: string;
  isSubmitting?: boolean;
  fetchWithAuth?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  guardGeneration?: (opts: { requiredCredits: number; action: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
  onTaskCreated?: (task: any) => void;
  onError?: (msg: string) => void;
  onSwitchToExtend?: () => void;
  onStateChange?: (state: EditPanelState) => void;
  onAppendPrompt?: (text: string) => void;
}

export function EditVideoSidebarPanel({
  lang = "en",
  userCredits = 100,
  initialTool = null,
  promptText = "",
  isSubmitting = false,
  fetchWithAuth = fetch,
  guardGeneration,
  onTaskCreated,
  onError,
  onSwitchToExtend,
  onStateChange,
  onAppendPrompt,
}: EditVideoSidebarPanelProps) {
  const isAr = lang === "ar";
  const objectSwapVideoInputId = useId();
  const objectSwapImageInputId = useId();
  const upscaleVideoInputId = useId();
  const editVideoInputId = useId();

  // Active sub-tool: null means show the 9-tool menu list matching Image 4
  const [activeTool, setActiveTool] = useState<string | null>(initialTool);

  // Sync initialTool prop
  useEffect(() => {
    if (initialTool) setActiveTool(initialTool);
  }, [initialTool]);

  // Shared error state
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Tool 1: Object Swap State
  // -------------------------------------------------------------
  const [swapVideo, setSwapVideo] = useState<File | null>(null);
  const [swapVideoPreview, setSwapVideoPreview] = useState<string | null>(null);
  const [swapDuration, setSwapDuration] = useState<number>(5);
  const [swapMeta, setSwapMeta] = useState<{ resolution?: string; sizeMb?: string } | null>(null);

  const [target, setTarget] = useState<string>("");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [swapMode, setSwapMode] = useState<"change" | "background">("change");
  const [swapResolution, setSwapResolution] = useState<"480p" | "540p" | "768p" | "1080p">("768p");
  const [swapSeed, setSwapSeed] = useState<string>("");
  const [showSwapAdvanced, setShowSwapAdvanced] = useState<boolean>(false);

  const swapVideoRef = useRef<HTMLInputElement | null>(null);
  const swapImageRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------------------------------------
  // Tool 2: Upscale State
  // -------------------------------------------------------------
  const [upscaleVideo, setUpscaleVideo] = useState<File | null>(null);
  const [upscaleVideoPreview, setUpscaleVideoPreview] = useState<string | null>(null);
  const [upscaleDuration, setUpscaleDuration] = useState<number>(5);
  const [upscaleResolution, setUpscaleResolution] = useState<"720p" | "1080p" | "2k" | "4k">("1080p");
  const [upscaleScale, setUpscaleScale] = useState<"2x" | "4x">("2x");
  const upscaleVideoRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------------------------------------
  // Tool 3: Edit Video State
  // -------------------------------------------------------------
  const [editPromptVideo, setEditPromptVideo] = useState<File | null>(null);
  const [editPromptVideoPreview, setEditPromptVideoPreview] = useState<string | null>(null);
  const [editPromptDuration, setEditPromptDuration] = useState<number>(5);
  const editPromptVideoRef = useRef<HTMLInputElement | null>(null);

  // Quick chips
  const targetChips = ["jacket", "hair", "car", "shoes", "shirt", "glasses", "sky", "watch"];
  const styleChips = [
    "cyberpunk neon leather jacket",
    "golden luxury royal suit",
    "futuristic metallic armor",
    "retro vintage denim jacket",
  ];

  // Pricing calculations
  const calculateObjectSwapCredits = useCallback((): number => {
    const dur = Math.min(15, Math.max(3, swapDuration));
    const rateMap: Record<string, number> = {
      "480p": 0.15,
      "540p": 0.17,
      "768p": 0.20,
      "1080p": 0.40,
    };
    const rate = rateMap[swapResolution] ?? 0.20;
    const baseFee = dur * rate;
    const refFee = referenceImage ? 0.02 : 0;
    return Math.ceil((baseFee + refFee) * 1.4 * 40);
  }, [swapDuration, swapResolution, referenceImage]);

  const calculateUpscaleCredits = useCallback((): number => {
    const dur = Math.min(600, Math.max(3, Math.ceil(upscaleDuration)));
    const usdPerFiveSeconds = {
      "720p": 0.025,
      "1080p": 0.025,
      "2k": 0.05,
      "4k": 0.1,
    }[upscaleResolution];
    return Number((dur * (usdPerFiveSeconds / 5) * 1.4 * 40).toFixed(2));
  }, [upscaleDuration, upscaleResolution]);

  const calculateEditPromptCredits = useCallback((): number => {
    const dur = Math.min(15, Math.max(3, editPromptDuration));
    return parseFloat((dur * 4.2).toFixed(1));
  }, [editPromptDuration]);

  // Submit Handlers (Invoked by unified central execution button)
  const handleGenerateObjectSwap = useCallback(async () => {
    if (!swapVideo) {
      const err = isAr ? "يرجى رفع فيديو المصدر" : "Please upload source video";
      setSubmissionError(err);
      onError?.(err);
      return;
    }
    if (!target.trim()) {
      const err = isAr ? "يرجى تحديد العنصر المراد تغييره" : "Please specify target element";
      setSubmissionError(err);
      onError?.(err);
      return;
    }
    if (!promptText.trim() && !referenceImage) {
      const err = isAr
        ? "يرجى وصف العنصر البديل في بوكس البرومبت أو رفع صورة مرجعية"
        : "Please describe replacement in the prompt box or upload reference image";
      setSubmissionError(err);
      onError?.(err);
      return;
    }

    const credits = calculateObjectSwapCredits();
    if (guardGeneration) {
      const check = await guardGeneration({ requiredCredits: credits, action: "object-swap" });
      if (!check.ok) {
        setSubmissionError(check.message || (isAr ? "الرصيد لا يكفي" : "Insufficient credits"));
        return;
      }
    }

    setSubmissionError(null);
    try {
      const videoUrl = await uploadVideoRequestFile(swapVideo, fetchWithAuth);
      let imageUrl: string | undefined = undefined;
      if (referenceImage) {
        imageUrl = await uploadVideoRequestFile(referenceImage, fetchWithAuth);
      }

      const payload: Record<string, any> = {
        video: videoUrl,
        target: target.trim(),
        mode: swapMode,
        resolution: swapResolution,
      };
      if (promptText.trim()) payload.change_to = promptText.trim();
      if (imageUrl) payload.image = imageUrl;
      if (swapSeed.trim()) payload.seed = parseInt(swapSeed.trim(), 10);

      const res = await fetchWithAuth("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelRoute: "wavespeed-ai/openjutsu/object-swap",
          payload,
          profileId: typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") || undefined : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.taskId) {
        throw new Error(data.error || data.message || "Failed to initiate object swap task");
      }
      onTaskCreated?.({
        taskId: data.taskId,
        type: "object-swap",
        duration: swapDuration,
        prompt: `Object swap: ${target} -> ${promptText.trim() || "reference image"}`,
      });
    } catch (err: any) {
      setSubmissionError(err.message || "Error submitting request");
      onError?.(err.message);
    }
  }, [
    swapVideo,
    target,
    promptText,
    referenceImage,
    swapMode,
    swapResolution,
    swapSeed,
    swapDuration,
    calculateObjectSwapCredits,
    guardGeneration,
    fetchWithAuth,
    onTaskCreated,
    onError,
    isAr,
  ]);

  const handleGenerateUpscale = useCallback(async () => {
    if (!upscaleVideo) {
      const err = isAr ? "يرجى رفع الفيديو المطلوب تكبيره" : "Please upload video to upscale";
      setSubmissionError(err);
      onError?.(err);
      return;
    }
    const credits = calculateUpscaleCredits();
    if (guardGeneration) {
      const check = await guardGeneration({ requiredCredits: credits, action: "video-upscale" });
      if (!check.ok) {
        setSubmissionError(check.message || "Insufficient credits");
        return;
      }
    }

    setSubmissionError(null);
    try {
      const videoUrl = await uploadVideoRequestFile(upscaleVideo, fetchWithAuth);
      const res = await fetchWithAuth("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelRoute: "wavespeed-ai/video-upscaler",
          payload: {
            video: videoUrl,
            target_resolution: upscaleResolution,
            scale: upscaleScale,
          },
          profileId: typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") || undefined : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.taskId) throw new Error(data.error || "Failed to create upscale task");
      onTaskCreated?.({
        taskId: data.taskId,
        type: "upscale",
        duration: upscaleDuration,
        prompt: `Upscale video to ${upscaleResolution.toUpperCase()}`,
      });
    } catch (err: any) {
      setSubmissionError(err.message);
      onError?.(err.message);
    }
  }, [
    upscaleVideo,
    upscaleResolution,
    upscaleScale,
    upscaleDuration,
    calculateUpscaleCredits,
    guardGeneration,
    fetchWithAuth,
    onTaskCreated,
    onError,
    isAr,
  ]);

  const handleGenerateEditVideo = useCallback(async () => {
    if (!editPromptVideo || !promptText.trim()) {
      const err = isAr
        ? "يرجى رفع الفيديو وكتابة وصف التعديل في بوكس البرومبت"
        : "Please upload video and provide edit prompt in prompt box";
      setSubmissionError(err);
      onError?.(err);
      return;
    }
    const credits = calculateEditPromptCredits();
    if (guardGeneration) {
      const check = await guardGeneration({ requiredCredits: credits, action: "edit-video" });
      if (!check.ok) {
        setSubmissionError(check.message || "Insufficient credits");
        return;
      }
    }

    setSubmissionError(null);
    try {
      const videoUrl = await uploadVideoRequestFile(editPromptVideo, fetchWithAuth);
      const res = await fetchWithAuth("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelRoute: "kwaivgi/kling-v4.0/video-edit",
          payload: {
            video: videoUrl,
            prompt: promptText.trim(),
          },
          profileId: typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") || undefined : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.taskId) throw new Error(data.error || "Failed to create edit video task");
      onTaskCreated?.({
        taskId: data.taskId,
        type: "edit-video",
        duration: editPromptDuration,
        prompt: promptText.trim(),
      });
    } catch (err: any) {
      setSubmissionError(err.message);
      onError?.(err.message);
    }
  }, [
    editPromptVideo,
    promptText,
    editPromptDuration,
    calculateEditPromptCredits,
    guardGeneration,
    fetchWithAuth,
    onTaskCreated,
    onError,
    isAr,
  ]);

  // Synchronize state with parent (central prompt box & central action button)
  useEffect(() => {
    let isReady = false;
    let calculatedCredits = 0;
    let buttonLabel = isAr ? "تطبيق التعديل" : "Apply Edit";
    let placeholder = "";
    let isPromptDisabled = false;
    let executeGenerate = async () => {};

    if (activeTool === "object-swap") {
      isReady = Boolean(swapVideo && target.trim() && (promptText.trim() || referenceImage));
      calculatedCredits = calculateObjectSwapCredits();
      buttonLabel = isAr ? "توليد استبدال العنصر" : "Generate Swap";
      placeholder = isAr
        ? "صف العنصر البديل المراد استبداله (Change To): مثلاً golden luxury jacket..."
        : "Describe the replacement object (Change To): e.g. golden luxury jacket...";
      isPromptDisabled = false;
      executeGenerate = handleGenerateObjectSwap;
    } else if (activeTool === "upscale") {
      isReady = Boolean(upscaleVideo);
      calculatedCredits = calculateUpscaleCredits();
      buttonLabel = isAr ? "رفع دقة الفيديو" : "Upscale Video";
      placeholder = isAr
        ? "أداة رفع دقة الفيديو لا تتطلب وصفاً نصياً"
        : "Video Upscaler does not require a text prompt";
      isPromptDisabled = true;
      executeGenerate = handleGenerateUpscale;
    } else if (activeTool === "edit-video") {
      isReady = Boolean(editPromptVideo && promptText.trim());
      calculatedCredits = calculateEditPromptCredits();
      buttonLabel = isAr ? "تطبيق التعديل" : "Apply Edit";
      placeholder = isAr
        ? "اكتب التعديل بدقة: أضف أمطاراً ليلية، غيّر ألوان الإضاءة، أضف دخاناً..."
        : "Describe targeted changes: add cinematic night rain, change color palette...";
      isPromptDisabled = false;
      executeGenerate = handleGenerateEditVideo;
    } else {
      isReady = false;
      calculatedCredits = 0;
      buttonLabel = isAr ? "اختر أداة تحرير" : "Select an Editing Tool";
      placeholder = isAr
        ? "اختر أداة تحرير من اللوحة الجانبية للبدء..."
        : "Select an editing tool from the sidebar to begin...";
      isPromptDisabled = true;
      executeGenerate = async () => {};
    }

    onStateChange?.({
      activeTool,
      isReady,
      calculatedCredits,
      buttonLabel,
      placeholder,
      isPromptDisabled,
      executeGenerate,
    });
  }, [
    activeTool,
    swapVideo,
    target,
    promptText,
    referenceImage,
    swapResolution,
    swapDuration,
    swapMode,
    upscaleVideo,
    upscaleResolution,
    upscaleScale,
    upscaleDuration,
    editPromptVideo,
    editPromptDuration,
    calculateObjectSwapCredits,
    calculateUpscaleCredits,
    calculateEditPromptCredits,
    handleGenerateObjectSwap,
    handleGenerateUpscale,
    handleGenerateEditVideo,
    isAr,
    onStateChange,
  ]);

  // =============================================================
  // SUB-VIEW 1: Object Swap
  // =============================================================
  if (activeTool === "object-swap") {
    const isSwapReady = Boolean(swapVideo && target.trim() && (promptText.trim() || referenceImage));

    return (
      <div className="flex flex-col gap-4 text-white animate-in fade-in duration-200">
        {/* Back Button & Title */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTool(null)}
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>{isAr ? "كافة أدوات التحرير" : "All Editing Tools"}</span>
          </button>
          <span className="text-[14px] font-bold text-cyan-400 flex items-center gap-1.5">
            <Layers size={15} />
            <span>Object Swap</span>
          </span>
        </div>

        {/* Video Upload Dropzone */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={objectSwapVideoInputId} className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "فيديو المصدر (3–15 ثانية)" : "Source Video (3–15s)"}
          </label>
          <div
            onClick={() => swapVideoRef.current?.click()}
            className={`relative rounded-xl border border-dashed transition-all cursor-pointer min-h-[105px] p-3 flex flex-col items-center justify-center text-center overflow-hidden ${
              swapVideo
                ? "border-cyan-500/50 bg-cyan-950/15"
                : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            <input
              id={objectSwapVideoInputId}
              ref={swapVideoRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setSwapVideo(file);
                  const url = URL.createObjectURL(file);
                  setSwapVideoPreview(url);
                  const temp = document.createElement("video");
                  temp.preload = "metadata";
                  temp.src = url;
                  temp.onloadedmetadata = () => {
                    const dur = Math.min(15, Math.max(3, Math.round(temp.duration || 5)));
                    setSwapDuration(dur);
                    setSwapMeta({
                      resolution: `${temp.videoWidth}×${temp.videoHeight}`,
                      sizeMb: (file.size / (1024 * 1024)).toFixed(1) + " MB",
                    });
                  };
                }
                e.target.value = "";
              }}
            />

            {swapVideo ? (
              <div className="relative w-full flex flex-col items-center">
                {swapVideoPreview && (
                  <div className="w-full h-24 rounded-lg overflow-hidden relative border border-white/10 bg-black/60 mb-2">
                    <video src={swapVideoPreview} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSwapVideo(null);
                        setSwapVideoPreview(null);
                        setSwapMeta(null);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/70 hover:bg-red-500 text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[12px] font-mono text-zinc-300">
                  <span>{swapDuration}s</span>
                  {swapMeta?.resolution && <span>• {swapMeta.resolution}</span>}
                  {swapMeta?.sizeMb && <span>• {swapMeta.sizeMb}</span>}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className="w-9 h-9 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Upload size={16} />
                </div>
                <span className="text-[13px] font-semibold text-zinc-100">
                  {isAr ? "اضغط لرفع فيديو أو اسحبه هنا" : "Upload video to modify"}
                </span>
                <span className="text-[11.5px] text-zinc-400">OpenJutsu Object Swap (3-15s)</span>
              </div>
            )}
          </div>
        </div>

        {/* Target Element Input (stays inside sidebar) */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "العنصر المراد تغييره (Target)" : "Target Element to Replace"}
          </label>
          <input
            type="text"
            placeholder={isAr ? "مثال: jacket, hair, car, shoes, glasses..." : "e.g. jacket, hair, car, shoes..."}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-cyan-500/60"
          />
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {targetChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setTarget(chip)}
                className="text-[11.5px] px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 text-zinc-300 border border-white/5 transition-colors"
              >
                +{chip}
              </button>
            ))}
          </div>
        </div>

        {/* Unified Prompt Single Source of Truth Info Card */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-cyan-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-cyan-400" />
              <span>{isAr ? "العنصر البديل (Change To)" : "Replacement Object"}</span>
            </span>
            <span className="text-[11px] text-zinc-400">{isAr ? "بوكس البرومبت الرئيسي" : "Main Prompt Box"}</span>
          </div>
          <div className="text-[12px] text-zinc-300 leading-relaxed">
            {promptText.trim() ? (
              <div className="text-white font-medium bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10 font-mono text-[12.5px] truncate">
                &ldquo;{promptText}&rdquo;
              </div>
            ) : (
              <p className="text-zinc-400 italic">
                {isAr
                  ? "اكتب وصف العنصر البديل مباشرة في بوكس البرومبت الرئيسي أسفل شاشة المعاينة."
                  : "Describe the replacement object directly in the main prompt box below preview."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="text-[11px] text-zinc-400 w-full">
              {isAr ? "أفكار سريعة للوصف:" : "Quick style ideas:"}
            </span>
            {styleChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onAppendPrompt?.(chip)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-cyan-500/20 hover:text-cyan-200 text-zinc-300 border border-white/5 transition-colors"
              >
                +{chip}
              </button>
            ))}
          </div>
        </div>

        {/* Resolution Dropdown Menu */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "دقة المعالجة" : "Resolution"}
          </span>
          <select
            value={swapResolution}
            onChange={(e) => setSwapResolution(e.target.value as any)}
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-cyan-500/60 font-mono cursor-pointer"
          >
            <option value="480p">480p • Fast</option>
            <option value="540p">540p • Mobile</option>
            <option value="768p">768p • HD (Recommended)</option>
            <option value="720p">720p • HD</option>
            <option value="1080p">1080p • Full HD</option>
          </select>
        </div>

        {/* Secondary / Advanced Settings (Collapsible Accordion) */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSwapAdvanced(!showSwapAdvanced)}
            className="w-full px-3.5 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors"
          >
            <span className="text-[13px] font-semibold text-zinc-200 flex items-center gap-2">
              <Sliders size={14} className="text-cyan-400" />
              <span>{isAr ? "خيارات متقدمة وإضافية" : "Advanced & Secondary Options"}</span>
            </span>
            <ChevronDown
              size={16}
              className={`text-zinc-400 transition-transform ${showSwapAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showSwapAdvanced && (
            <div className="p-3.5 pt-0 space-y-3.5 border-t border-white/5 text-[13px]">
              {/* Optional Reference Image */}
              <div className="space-y-1.5 pt-2">
                <label htmlFor={objectSwapImageInputId} className="text-[12px] font-semibold text-zinc-300 flex items-center justify-between">
                  <span>{isAr ? "صورة مرجعية اختيارية" : "Reference Image (Optional)"}</span>
                  <span className="text-[11.5px] text-cyan-400 font-mono font-bold">+1.12 cr</span>
                </label>
                <div
                  onClick={() => swapImageRef.current?.click()}
                  className="rounded-xl border border-dashed border-white/10 p-2.5 flex items-center gap-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                >
                  <input
                    id={objectSwapImageInputId}
                    ref={swapImageRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setReferenceImage(file);
                        setReferenceImagePreview(URL.createObjectURL(file));
                      }
                      e.target.value = "";
                    }}
                  />
                  {referenceImage ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2.5">
                        {referenceImagePreview && (
                          <img src={referenceImagePreview} alt="Ref" className="w-8 h-8 rounded-lg object-cover" />
                        )}
                        <span className="text-[12px] text-zinc-200 truncate max-w-[170px]">{referenceImage.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReferenceImage(null);
                          setReferenceImagePreview(null);
                        }}
                        className="p-1 rounded-md text-zinc-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-zinc-400 py-0.5">
                      <Upload size={14} className="text-cyan-400" />
                      <span className="text-[12px]">{isAr ? "رفع صورة لتحديد التفاصيل" : "Upload reference image"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Swap Mode Segmented Switch */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-zinc-300">
                  {isAr ? "نمط الاستبدال" : "Swap Mode"}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapMode("change")}
                    className={`py-2 px-3 rounded-lg text-[12.5px] font-semibold transition-all border ${
                      swapMode === "change"
                        ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                        : "bg-black/30 border-white/5 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {isAr ? "استبدال كائن" : "Swap Object"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapMode("background")}
                    className={`py-2 px-3 rounded-lg text-[12.5px] font-semibold transition-all border ${
                      swapMode === "background"
                        ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                        : "bg-black/30 border-white/5 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {isAr ? "استبدال الخلفية" : "Swap Background"}
                  </button>
                </div>
              </div>

              {/* Custom Seed */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-zinc-300">
                  {isAr ? "البذرة العشوائية (Seed)" : "Random Seed (Optional)"}
                </label>
                <input
                  type="text"
                  placeholder="Random"
                  value={swapSeed}
                  onChange={(e) => setSwapSeed(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[12.5px] text-zinc-100 outline-none focus:border-cyan-500/60"
                />
              </div>
            </div>
          )}
        </div>

        {/* Error notice */}
        {submissionError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-[12.5px] text-red-300 leading-relaxed">
            {submissionError}
          </div>
        )}

        {/* Input Readiness helper notice */}
        {!isSwapReady && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
            <p className="text-[12px] text-zinc-400 leading-normal">
              {!swapVideo
                ? (isAr ? "يرجى رفع فيديو المصدر أعلاه للبدء." : "Upload source video above to begin.")
                : !target.trim()
                ? (isAr ? "يرجى كتابة العنصر المراد تغييره (Target)." : "Specify target element to replace.")
                : (isAr ? "اكتب وصف العنصر البديل في بوكس البرومبت لتفعيل زر التوليد." : "Describe replacement in prompt box to enable generation.")}
            </p>
          </div>
        )}
      </div>
    );
  }

  // =============================================================
  // SUB-VIEW 2: Video Upscaler
  // =============================================================
  if (activeTool === "upscale") {
    const isUpscaleReady = Boolean(upscaleVideo);

    return (
      <div className="flex flex-col gap-4 text-white animate-in fade-in duration-200">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTool(null)}
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>{isAr ? "كافة أدوات التحرير" : "All Editing Tools"}</span>
          </button>
          <span className="text-[14px] font-bold text-cyan-400 flex items-center gap-1.5">
            <Maximize2 size={15} />
            <span>Video Upscaler</span>
          </span>
        </div>

        {/* Video Upload Dropzone */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={upscaleVideoInputId} className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "الفيديو المطلوب رفع دقته" : "Video to Upscale"}
          </label>
          <div
            onClick={() => upscaleVideoRef.current?.click()}
            className={`relative rounded-xl border border-dashed transition-all cursor-pointer min-h-[110px] p-3 flex flex-col items-center justify-center text-center overflow-hidden ${
              upscaleVideo
                ? "border-cyan-500/50 bg-cyan-950/15"
                : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            <input
              id={upscaleVideoInputId}
              ref={upscaleVideoRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setUpscaleVideo(file);
                  const url = URL.createObjectURL(file);
                  setUpscaleVideoPreview(url);
                  const temp = document.createElement("video");
                  temp.preload = "metadata";
                  temp.src = url;
                  temp.onloadedmetadata = () => {
                    setUpscaleDuration(Math.round(temp.duration || 5));
                  };
                }
                e.target.value = "";
              }}
            />

            {upscaleVideo ? (
              <div className="relative w-full flex flex-col items-center">
                {upscaleVideoPreview && (
                  <div className="w-full h-24 rounded-lg overflow-hidden relative border border-white/10 bg-black/60 mb-2">
                    <video src={upscaleVideoPreview} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUpscaleVideo(null);
                        setUpscaleVideoPreview(null);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/70 hover:bg-red-500 text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <span className="text-[12px] font-mono text-zinc-300">
                  {upscaleDuration}s • {(upscaleVideo.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Maximize2 size={18} />
                </div>
                <span className="text-[14px] font-semibold text-zinc-100">
                  {isAr ? "رفع الفيديو لزيادة دقته" : "Upload video to upscale"}
                </span>
                <span className="text-[12px] text-zinc-400">Supports up to 4K Enhancement</span>
              </div>
            )}
          </div>
        </div>

        {/* Target Resolution Dropdown */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "الدقة المستهدفة" : "Target Resolution"}
          </span>
          <select
            value={upscaleResolution}
            onChange={(e) => setUpscaleResolution(e.target.value as any)}
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-cyan-500/60 font-mono cursor-pointer"
          >
            <option value="1080p">1080p • Full HD</option>
            <option value="2k">2K • Quad HD (2560x1440)</option>
            <option value="4k">4K • Ultra HD (3840x2160)</option>
          </select>
        </div>

        {/* Scale Factor Dropdown */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "معامل التكبير" : "Scale Factor"}
          </span>
          <select
            value={upscaleScale}
            onChange={(e) => setUpscaleScale(e.target.value as any)}
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-cyan-500/60 font-mono cursor-pointer"
          >
            <option value="2x">2x Scaling</option>
            <option value="4x">4x Scaling</option>
          </select>
        </div>

        {/* Prompt Disabled Notice */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3 flex items-center gap-2.5">
          <Info size={16} className="text-cyan-400 shrink-0" />
          <p className="text-[12px] text-zinc-300 leading-relaxed">
            {isAr
              ? "أداة رفع الدقة تعمل مباشرة على ترقية بكسلات الفيديو دون الحاجة إلى وصف نصي."
              : "Video Upscaler works directly on video pixels and does not require a prompt."}
          </p>
        </div>

        {submissionError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-[12.5px] text-red-300 leading-relaxed">
            {submissionError}
          </div>
        )}

        {/* Input Readiness helper notice */}
        {!isUpscaleReady && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
            <p className="text-[12px] text-zinc-400 leading-normal">
              {isAr ? "يرجى رفع ملف الفيديو أعلاه لتفعيل زر رفع الدقة." : "Upload video file above to enable upscaling."}
            </p>
          </div>
        )}
      </div>
    );
  }

  // =============================================================
  // SUB-VIEW 3: Edit Video (Prompt-based)
  // =============================================================
  if (activeTool === "edit-video") {
    const isEditReady = Boolean(editPromptVideo && promptText.trim());

    return (
      <div className="flex flex-col gap-4 text-white animate-in fade-in duration-200">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTool(null)}
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>{isAr ? "كافة أدوات التحرير" : "All Editing Tools"}</span>
          </button>
          <span className="text-[14px] font-bold text-cyan-400 flex items-center gap-1.5">
            <Wand2 size={15} />
            <span>Edit Video</span>
          </span>
        </div>

        {/* Video Upload Dropzone */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={editVideoInputId} className="text-[13px] font-semibold text-zinc-300">
            {isAr ? "الفيديو المراد تعديله" : "Video to Edit"}
          </label>
          <div
            onClick={() => editPromptVideoRef.current?.click()}
            className={`relative rounded-xl border border-dashed transition-all cursor-pointer min-h-[110px] p-3 flex flex-col items-center justify-center text-center overflow-hidden ${
              editPromptVideo
                ? "border-cyan-500/50 bg-cyan-950/15"
                : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            <input
              id={editVideoInputId}
              ref={editPromptVideoRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setEditPromptVideo(file);
                  const url = URL.createObjectURL(file);
                  setEditPromptVideoPreview(url);
                  const temp = document.createElement("video");
                  temp.preload = "metadata";
                  temp.src = url;
                  temp.onloadedmetadata = () => {
                    setEditPromptDuration(Math.min(15, Math.max(3, Math.round(temp.duration || 5))));
                  };
                }
                e.target.value = "";
              }}
            />

            {editPromptVideo ? (
              <div className="relative w-full flex flex-col items-center">
                {editPromptVideoPreview && (
                  <div className="w-full h-24 rounded-lg overflow-hidden relative border border-white/10 bg-black/60 mb-2">
                    <video src={editPromptVideoPreview} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditPromptVideo(null);
                        setEditPromptVideoPreview(null);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/70 hover:bg-red-500 text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <span className="text-[12px] font-mono text-zinc-300">
                  {editPromptDuration}s • {(editPromptVideo.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Wand2 size={18} />
                </div>
                <span className="text-[14px] font-semibold text-zinc-100">
                  {isAr ? "رفع الفيديو المراد تعديله" : "Upload video to edit"}
                </span>
                <span className="text-[12px] text-zinc-400">Kling Video Edit (3-15s)</span>
              </div>
            )}
          </div>
        </div>

        {/* Unified Prompt Info Card */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-cyan-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-cyan-400" />
              <span>{isAr ? "وصف التعديل المطلوب" : "Edit Description Prompt"}</span>
            </span>
            <span className="text-[11px] text-zinc-400">{isAr ? "بوكس البرومبت الرئيسي" : "Main Prompt Box"}</span>
          </div>
          <div className="text-[12px] text-zinc-300 leading-relaxed">
            {promptText.trim() ? (
              <div className="text-white font-medium bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10 font-mono text-[12.5px] truncate">
                &ldquo;{promptText}&rdquo;
              </div>
            ) : (
              <p className="text-zinc-400 italic">
                {isAr
                  ? "اكتب التعديلات المطلوبة (مثل: إضافة أمطار ليلية، تغيير الإضاءة، إضافة دخان) في بوكس البرومبت الرئيسي أسفل شاشة المعاينة."
                  : "Describe targeted changes (e.g. night rain, lighting changes, mist) in the main prompt box below preview."}
              </p>
            )}
          </div>
        </div>

        {submissionError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-[12.5px] text-red-300 leading-relaxed">
            {submissionError}
          </div>
        )}

        {/* Input Readiness helper notice */}
        {!isEditReady && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
            <p className="text-[12px] text-zinc-400 leading-normal">
              {!editPromptVideo
                ? (isAr ? "يرجى رفع الفيديو أعلاه أولاً." : "Upload video above first.")
                : (isAr ? "اكتب وصف التعديل في بوكس البرومبت الرئيسي لتفعيل زر التوليد." : "Enter edit description in the main prompt box to enable generation.")}
            </p>
          </div>
        )}
      </div>
    );
  }

  // =============================================================
  // ROOT VIEW: Tool Menu List matching Image 4
  // =============================================================
  const toolItems = [
    {
      id: "edit-video",
      title: isAr ? "تعديل الفيديو" : "Edit Video",
      desc: isAr ? "تطبيق تعديلات دقيقة بالوصف" : "Make targeted changes",
      icon: Wand2,
      active: true,
    },
    {
      id: "extend-video",
      title: isAr ? "تمديد الفيديو" : "Extend Video",
      desc: isAr ? "توليد استمرارية وإطالة للفيديو" : "Generate a continuation",
      icon: Film,
      active: true,
      onSelect: () => onSwitchToExtend?.(),
    },
    {
      id: "object-swap",
      title: isAr ? "استبدال العناصر" : "Object Swap",
      desc: isAr ? "استبدال عناصر أو تغيير الخلفية" : "Swap objects or background",
      icon: Layers,
      active: true,
      badge: "READY",
    },
    {
      id: "upscale",
      title: isAr ? "رفع دقة الفيديو" : "Upscale",
      desc: isAr ? "زيادة الدقة حتى 4K" : "Increase resolution",
      icon: Maximize2,
      active: true,
    },
    {
      id: "reframe",
      title: isAr ? "إعادة التأطير" : "Reframe",
      desc: isAr ? "تغيير الأبعاد لكل المنصات" : "Resize and reposition for any format",
      icon: Crop,
      active: false,
      badge: "SOON",
    },
    {
      id: "remove-bg",
      title: isAr ? "إزالة الخلفية" : "Remove Background",
      desc: isAr ? "عزل وقص الكائنات بدقة" : "Cut out the object",
      icon: Scissors,
      active: false,
      badge: "NEW",
    },
    {
      id: "sdr-hdr",
      title: isAr ? "تحويل إلى HDR" : "SDR to HDR",
      desc: isAr ? "تحويل ألوان الفيديو إلى HDR" : "Convert SDR footage to HDR",
      icon: SunMedium,
      active: false,
      badge: "NEW",
    },
    {
      id: "fps-boost",
      title: isAr ? "زيادة الفريمات" : "FPS Boost",
      desc: isAr ? "رفع سرعة الإطارات إلى 60fps" : "Increase frame rate",
      icon: Gauge,
      active: false,
      badge: "NEW",
    },
    {
      id: "depth-map",
      title: isAr ? "خريطة العمق" : "Depth Map",
      desc: isAr ? "استخراج خرائط العمق الثلاثية" : "Depth maps from media",
      icon: Box,
      active: false,
      badge: "NEW",
    },
  ];

  return (
    <div className="flex flex-col gap-3.5 text-white">
      {/* Hero Banner Card */}
      <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#070b15] p-4 shadow-lg group">
        <div className="absolute top-0 right-0 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <div className="text-[16px] font-bold tracking-wide text-white uppercase flex items-center gap-2">
            <Sparkles size={16} className="text-cyan-400" />
            <span>{isAr ? "أدوات التحرير" : "EDITING TOOLS"}</span>
          </div>
          <p className="text-[12.5px] text-zinc-400 mt-1 leading-snug">
            {isAr ? "تعديل، استبدال، إعادة تأطير، وتغيير زوايا الفيديو" : "Modify, restyle, change angles, transform"}
          </p>
        </div>
      </div>

      {/* Tools List */}
      <div className="flex flex-col divide-y divide-white/[0.04]">
        {toolItems.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                if (tool.onSelect) {
                  tool.onSelect();
                } else if (tool.active) {
                  setActiveTool(tool.id);
                }
              }}
              disabled={!tool.active && !tool.onSelect}
              className={`w-full py-3 px-2.5 flex items-center justify-between text-left transition-all rounded-xl ${
                tool.active || tool.onSelect
                  ? "hover:bg-white/[0.05] cursor-pointer group"
                  : "opacity-60 cursor-not-allowed"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-cyan-400 group-hover:border-cyan-500/40 transition-colors flex-shrink-0">
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-zinc-100 group-hover:text-white truncate">
                    {tool.title}
                  </div>
                  <div className="text-[12px] text-zinc-400 truncate">
                    {tool.desc}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-shrink-0 ml-2">
                {tool.badge && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                      tool.badge === "READY"
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                    }`}
                  >
                    {tool.badge}
                  </span>
                )}
                <ChevronRight
                  size={16}
                  className="text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all"
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
