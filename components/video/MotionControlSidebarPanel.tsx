"use client";

import React, { useState, useRef, useEffect, useId, useCallback } from "react";
import {
  Film,
  User,
  ChevronRight,
  ChevronDown,
  Info,
  X,
  Sparkles,
  Sliders,
  Volume2,
  VolumeX,
} from "lucide-react";
import { uploadVideoRequestFile } from "@/lib/video-upload-helper";

export interface MotionControlSidebarPanelProps {
  lang?: "ar" | "en";
  userCredits?: number;
  promptText?: string;
  isSubmitting?: boolean;
  fetchWithAuth?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  guardGeneration?: (opts: { requiredCredits: number; action: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
  onTaskCreated?: (task: any) => void;
  onError?: (msg: string) => void;
  onStateChange?: (state: {
    isReady: boolean;
    calculatedCredits: number;
    videoDuration: number;
    executeGenerate: () => Promise<void>;
  }) => void;
}

export function MotionControlSidebarPanel({
  lang = "en",
  userCredits = 100,
  promptText = "",
  isSubmitting = false,
  fetchWithAuth = fetch,
  guardGeneration,
  onTaskCreated,
  onError,
  onStateChange,
}: MotionControlSidebarPanelProps) {
  const isAr = lang === "ar";
  const motionVideoInputId = useId();
  const characterImageInputId = useId();

  // Media state
  const [motionVideo, setMotionVideo] = useState<File | null>(null);
  const [motionVideoPreview, setMotionVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoMeta, setVideoMeta] = useState<{ resolution?: string; sizeMb?: string } | null>(null);

  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [characterImagePreview, setCharacterImagePreview] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ dimensions?: string; sizeMb?: string } | null>(null);

  // Settings
  const [selectedModelRoute, setSelectedModelRoute] = useState<string>("kwaivgi/kling-v2.6-std/motion-control");
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const [sceneControlEnabled, setSceneControlEnabled] = useState<boolean>(true);
  const [sceneMode, setSceneMode] = useState<"video" | "image">("video");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [keepSound, setKeepSound] = useState<boolean>(true);
  const [customSeed, setCustomSeed] = useState<string>("");
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Handle Motion Video selection & duration extraction
  const handleSelectMotionVideo = (file: File) => {
    if (!file.type.startsWith("video/")) {
      const err = isAr ? "يرجى اختيار ملف فيديو صالح" : "Please select a valid video file";
      onError?.(err);
      return;
    }
    setMotionVideo(file);
    const url = URL.createObjectURL(file);
    setMotionVideoPreview(url);

    const tempVid = document.createElement("video");
    tempVid.preload = "metadata";
    tempVid.src = url;
    tempVid.onloadedmetadata = () => {
      const dur = Math.min(30, Math.max(3, Math.round(tempVid.duration || 5)));
      setVideoDuration(dur);
      setVideoMeta({
        resolution: `${tempVid.videoWidth}×${tempVid.videoHeight}`,
        sizeMb: (file.size / (1024 * 1024)).toFixed(1) + " MB",
      });
    };
  };

  // Handle Character Image selection & dimension extraction
  const handleSelectCharacterImage = (file: File) => {
    if (!file.type.startsWith("image/")) {
      const err = isAr ? "يرجى اختيار ملف صورة صالح" : "Please select a valid image file";
      onError?.(err);
      return;
    }
    setCharacterImage(file);
    const url = URL.createObjectURL(file);
    setCharacterImagePreview(url);

    const tempImg = new Image();
    tempImg.src = url;
    tempImg.onload = () => {
      setImageMeta({
        dimensions: `${tempImg.naturalWidth}×${tempImg.naturalHeight}`,
        sizeMb: (file.size / (1024 * 1024)).toFixed(1) + " MB",
      });
    };
  };

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleSelectMotionVideo(file);
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleSelectCharacterImage(file);
  };

  // Pricing calculation
  const calculateCredits = useCallback((): number => {
    const dur = Math.min(30, Math.max(3, videoDuration));
    if (selectedModelRoute === "kwaivgi/kling-v2.6-std/motion-control") {
      return parseFloat((dur * 0.07 * 1.4 * 40).toFixed(1));
    }
    const perSec = quality === "1080p" ? 8.94 : 6.70;
    return parseFloat((dur * perSec).toFixed(1));
  }, [videoDuration, selectedModelRoute, quality]);

  const calculatedCredits = calculateCredits();
  const isReady = Boolean(motionVideo && characterImage);

  // Execution function triggered by central Generate button
  const executeGenerate = useCallback(async () => {
    if (!motionVideo) {
      const msg = isAr ? "يرجى رفع فيديو الحركة المرجعي أولاً" : "Please upload a motion reference video first";
      onError?.(msg);
      return;
    }
    if (!characterImage) {
      const msg = isAr ? "يرجى رفع صورة الشخصية" : "Please upload a character image";
      onError?.(msg);
      return;
    }

    if (guardGeneration) {
      const check = await guardGeneration({
        requiredCredits: calculatedCredits,
        action: "motion-transfer",
      });
      if (!check.ok) {
        onError?.(check.message || (isAr ? "رصيدك لا يكفي لإتمام هذه العملية" : "Insufficient credits"));
        return;
      }
    }

    try {
      const motionVideoUrl = await uploadVideoRequestFile(motionVideo, fetchWithAuth);
      const characterImageUrl = await uploadVideoRequestFile(characterImage, fetchWithAuth);

      const payload: Record<string, any> = {
        video: motionVideoUrl,
        image: characterImageUrl,
        character_orientation: sceneMode,
        keep_original_sound: keepSound,
      };

      if (customSeed.trim()) {
        payload.seed = parseInt(customSeed.trim(), 10);
      }
      if (promptText.trim()) {
        payload.prompt = promptText.trim();
      }

      const response = await fetchWithAuth("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelRoute: selectedModelRoute,
          payload,
          profileId: typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") || undefined : undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.taskId) {
        throw new Error(data.error || data.message || (isAr ? "فشل إنشاء مهمة توليد نقل الحركة" : "Failed to create motion control task"));
      }

      onTaskCreated?.({
        taskId: data.taskId,
        type: "motion-transfer",
        duration: videoDuration,
        prompt: promptText.trim() || "Kling Motion Control",
      });
    } catch (err: any) {
      const msg = err.message || (isAr ? "حدث خطأ أثناء الإرسال" : "An error occurred during submission");
      onError?.(msg);
    }
  }, [
    motionVideo,
    characterImage,
    guardGeneration,
    calculatedCredits,
    sceneMode,
    keepSound,
    customSeed,
    promptText,
    selectedModelRoute,
    videoDuration,
    fetchWithAuth,
    onTaskCreated,
    onError,
    isAr,
  ]);

  // Synchronize state with parent (central action bar)
  useEffect(() => {
    onStateChange?.({
      isReady,
      calculatedCredits,
      videoDuration,
      executeGenerate,
    });
  }, [isReady, calculatedCredits, videoDuration, executeGenerate, onStateChange]);

  return (
    <div className="flex flex-col gap-4 text-white">
      {/* 1. Header Banner */}
      <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#070b15] p-4 shadow-lg group">
        <div className="absolute top-0 right-0 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-start justify-between relative z-10 gap-2">
          <div>
            <div className="text-[16px] font-bold tracking-wide text-white uppercase flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-400" />
              <span>{isAr ? "التحكم في الحركة" : "MOTION CONTROL"}</span>
            </div>
            <p className="text-[12.5px] text-zinc-400 mt-1 leading-snug">
              {isAr ? "التحكم في حركة الشخصية باستخدام فيديو مرجعي" : "Control motion with video references"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[12px] text-zinc-300 hover:text-white font-medium transition-all shrink-0"
          >
            <Info size={13} className="text-cyan-400" />
            <span>{isAr ? "كيف يعمل" : "How it works"}</span>
          </button>
        </div>

        {showHowItWorks && (
          <div className="mt-3.5 pt-3 border-t border-white/10 text-[12px] text-zinc-300 space-y-2 leading-relaxed animate-in fade-in duration-200">
            <div className="flex items-start gap-2">
              <span className="font-bold text-cyan-400">1.</span>
              <span>{isAr ? "ارفع فيديو حركة واضحاً مدته بين 3 و 30 ثانية." : "Upload a clear motion video (3 to 30 seconds)."}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold text-cyan-400">2.</span>
              <span>{isAr ? "ارفع صورة لشخصيتك مع وضوح كامل للوجه والجسم." : "Upload your character image with visible face and body."}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold text-cyan-400">3.</span>
              <span>{isAr ? "اكتب توجيهاً اختيارياً للإضاءة أو الكاميرا في بوكس البرومبت الرئيسي بالأسفل." : "Provide optional camera/lighting style in the main prompt box below."}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Motion Video Dropzone */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={motionVideoInputId} className="text-[13px] font-semibold text-zinc-300">
          {isAr ? "فيديو الحركة المرجعي (3–30 ثانية) *" : "Motion Reference Video (3–30s) *"}
        </label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleVideoDrop}
          onClick={() => videoInputRef.current?.click()}
          className={`relative rounded-2xl border border-dashed transition-all cursor-pointer min-h-[115px] p-3.5 flex flex-col items-center justify-center text-center overflow-hidden ${
            motionVideo
              ? "border-cyan-500/50 bg-cyan-950/15"
              : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25"
          }`}
        >
          <input
            id={motionVideoInputId}
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSelectMotionVideo(file);
              e.target.value = "";
            }}
          />

          {motionVideo ? (
            <div className="relative w-full h-full flex flex-col items-center">
              {motionVideoPreview && (
                <div className="w-full h-28 rounded-xl overflow-hidden relative border border-white/10 bg-black/60 mb-2">
                  <video
                    src={motionVideoPreview}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMotionVideo(null);
                      setMotionVideoPreview(null);
                      setVideoMeta(null);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-red-500 text-white transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap justify-center text-[11px]">
                <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
                  {videoDuration}s
                </span>
                {videoMeta?.resolution && (
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-zinc-300 font-mono">
                    {videoMeta.resolution}
                  </span>
                )}
                {videoMeta?.sizeMb && (
                  <span className="text-zinc-400 font-mono">{videoMeta.sizeMb}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 select-none py-1">
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Film size={18} />
              </div>
              <div className="space-y-0.5">
                <p className="text-[14px] font-semibold text-zinc-100">
                  {isAr ? "إضافة حركة لنسخها" : "Add motion to copy"}
                </p>
                <p className="text-[12px] text-zinc-400">
                  {isAr ? "مدة الفيديو: 3–30 ثانية" : "Video duration: 3–30 seconds"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Character Image Dropzone */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={characterImageInputId} className="text-[13px] font-semibold text-zinc-300">
          {isAr ? "صورة الشخصية المستهدفة *" : "Target Character Image *"}
        </label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleImageDrop}
          onClick={() => imageInputRef.current?.click()}
          className={`relative rounded-2xl border border-dashed transition-all cursor-pointer min-h-[115px] p-3.5 flex flex-col items-center justify-center text-center overflow-hidden ${
            characterImage
              ? "border-cyan-500/50 bg-cyan-950/15"
              : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25"
          }`}
        >
          <input
            id={characterImageInputId}
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSelectCharacterImage(file);
              e.target.value = "";
            }}
          />

          {characterImage ? (
            <div className="relative w-full h-full flex flex-col items-center">
              {characterImagePreview && (
                <div className="w-full h-28 rounded-xl overflow-hidden relative border border-white/10 bg-black/60 mb-2">
                  <img
                    src={characterImagePreview}
                    alt="Character preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCharacterImage(null);
                      setCharacterImagePreview(null);
                      setImageMeta(null);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-red-500 text-white transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap justify-center text-[11px]">
                {imageMeta?.dimensions && (
                  <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
                    {imageMeta.dimensions}
                  </span>
                )}
                {imageMeta?.sizeMb && (
                  <span className="text-zinc-400 font-mono">{imageMeta.sizeMb}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 select-none py-1">
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <User size={18} />
              </div>
              <div className="space-y-0.5">
                <p className="text-[14px] font-semibold text-zinc-100">
                  {isAr ? "إضافة الشخصية" : "Add your character"}
                </p>
                <p className="text-[12px] text-zinc-400">
                  {isAr ? "صورة واضحة للوجه والجسم" : "Image with visible face and body"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Model Selector Dropdown */}
      <div className="space-y-1.5">
        <label className="text-[13px] font-semibold text-zinc-300">
          {isAr ? "نموذج نقل الحركة (AI Model)" : "Motion Model"}
        </label>
        <select
          value={selectedModelRoute}
          onChange={(e) => setSelectedModelRoute(e.target.value)}
          className="w-full bg-[#0a1220] text-[13.5px] text-zinc-100 border border-white/10 rounded-xl px-3.5 py-2.5 outline-none focus:border-cyan-500/60 cursor-pointer transition-colors"
        >
          <option value="kwaivgi/kling-v2.6-std/motion-control" className="bg-[#0a1220] text-zinc-100">
            Kling 2.6 Motion Control (3.92 cr/s)
          </option>
          <option value="kwaivgi/kling-v3.0-pro/motion-control" className="bg-[#0a1220] text-zinc-100">
            Kling 3.0 Motion Control (Pro)
          </option>
        </select>
      </div>

      {/* 5. Quality Dropdown */}
      <div className="space-y-1.5">
        <label className="text-[13px] font-semibold text-zinc-300">
          {isAr ? "دقة الإخراج (Resolution)" : "Output Quality"}
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
          className="w-full bg-[#0a1220] text-[13.5px] text-zinc-100 border border-white/10 rounded-xl px-3.5 py-2.5 outline-none focus:border-cyan-500/60 cursor-pointer transition-colors"
        >
          <option value="720p" className="bg-[#0a1220] text-zinc-100">
            720p HD (Standard)
          </option>
          <option value="1080p" className="bg-[#0a1220] text-zinc-100">
            1080p Full HD
          </option>
        </select>
      </div>

      {/* 6. Scene control mode */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-zinc-100">
            {isAr ? "وضع التحكم في المشهد" : "Scene control mode"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={sceneControlEnabled}
            onClick={() => setSceneControlEnabled(!sceneControlEnabled)}
            className={`w-10 h-5 rounded-full p-0.5 transition-colors relative ${
              sceneControlEnabled ? "bg-cyan-500" : "bg-white/15"
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full transition-transform ${
                sceneControlEnabled ? "translate-x-5 bg-white" : "translate-x-0 bg-zinc-300"
              }`}
            />
          </button>
        </div>

        {sceneControlEnabled && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSceneMode("video")}
              className={`py-2 px-3 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2 border ${
                sceneMode === "video"
                  ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                  : "bg-black/30 border-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Film size={14} />
              <span>{isAr ? "فيديو" : "Video"}</span>
            </button>
            <button
              type="button"
              onClick={() => setSceneMode("image")}
              className={`py-2 px-3 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2 border ${
                sceneMode === "image"
                  ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                  : "bg-black/30 border-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <User size={14} />
              <span>{isAr ? "صورة" : "Image"}</span>
            </button>
          </div>
        )}

        <p className="text-[12px] text-zinc-400 leading-normal">
          {isAr
            ? "حدد مصدر الخلفية: من صورة الشخصية أم من فيديو الحركة الأصلي."
            : "Choose where the background should come from: the character image or the motion video"}
        </p>
      </div>

      {/* 7. Advanced settings accordion */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-3.5 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors"
        >
          <span className="text-[13px] font-semibold text-zinc-200">
            {isAr ? "الإعدادات المتقدمة" : "Advanced settings"}
          </span>
          <ChevronDown
            size={16}
            className={`text-zinc-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>

        {showAdvanced && (
          <div className="p-3.5 pt-0 space-y-3.5 border-t border-white/5 text-[13px]">
            {/* Keep sound toggle */}
            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <span className="text-zinc-200 font-medium">{isAr ? "الصوت الأصلي" : "Original Audio"}</span>
                <p className="text-[12px] text-zinc-400">
                  {isAr ? "الاحتفاظ بصوت فيديو الحركة" : "Keep audio from the motion video"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={keepSound}
                onClick={() => setKeepSound(!keepSound)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors relative ${
                  keepSound ? "bg-cyan-500" : "bg-white/15"
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full transition-transform ${
                    keepSound ? "translate-x-4 bg-white" : "translate-x-0 bg-zinc-300"
                  }`}
                />
              </button>
            </div>

            {/* Custom Seed */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-zinc-300">
                {isAr ? "البذرة العشوائية (Seed)" : "Seed (Optional)"}
              </label>
              <input
                type="text"
                placeholder={isAr ? "رقم عشوائي أو اتركه فارغاً" : "Random or enter seed"}
                value={customSeed}
                onChange={(e) => setCustomSeed(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-cyan-500/60"
              />
            </div>
          </div>
        )}
      </div>

      {/* Input Readiness helper notice */}
      {!isReady && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
          <p className="text-[12px] text-zinc-400 leading-normal">
            {!motionVideo && !characterImage
              ? (isAr ? "يرجى رفع فيديو الحركة وصورة الشخصية أعلاه للتفعيل." : "Upload motion video and character image above to enable generation.")
              : !motionVideo
              ? (isAr ? "يرجى إضافة فيديو الحركة لتفعيل زر التوليد." : "Add motion video to enable generation.")
              : (isAr ? "يرجى إضافة صورة الشخصية لتفعيل زر التوليد." : "Add character image to enable generation.")}
          </p>
        </div>
      )}
    </div>
  );
}
