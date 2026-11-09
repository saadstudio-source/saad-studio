"use client";

import { useState, useCallback, useRef, useEffect, useMemo, Suspense, type DragEvent } from "react";
import { useGenerationGate } from "@/hooks/use-generation-gate";
import { motion, AnimatePresence } from "framer-motion";
import NextImage from "next/image";
import { useSearchParams } from "next/navigation";
import { SaadLoader } from "@/components/saad-loader";
import {
  Film, Sparkles, ChevronDown, ImageIcon,
  Video, Clapperboard, Layers,
  PenTool, Zap, Music2, Users, User,
  X, AlertCircle, Loader2, Upload, CheckCircle2, Settings,
  Play, Download, Trash2, Heart, Copy, MoreHorizontal,
  ExternalLink, RefreshCw, Share2,
  type LucideIcon, Languages, Volume2, Palette, Plus, AudioLines, Shapes,
  ZoomIn, Music, Minus, MinusCircle, Repeat, SquarePen, Info, AlertTriangle,
} from "lucide-react";

import { useLanguage } from "@/lib/use-language";
import { useAuth } from "@clerk/nextjs";
import { useFullDynamicModels } from "@/hooks/use-dynamic-models";
import { useAuthenticatedFetch } from "@/hooks/use-authenticated-fetch";

import type { MediaItem } from "@/components/MediaGrid";
import { AssetInspector, type Asset } from "@/components/AssetInspector";
import {
  WaveSpeedVideoModel,
  VIDEO_MODEL_REGISTRY,
  getModelGroups,
  DEFAULT_MODEL,
  getGoogleVideoConstraints,
  getSeedanceComposerMediaConflict,
  isGoogleVideoRoute,
  normalizeGoogleVideoOptions,
  supportsSeedanceComposerAspectRatio,
} from "@/lib/video-model-registry";
import { getGenerationCostSync, computeCreditsFromDynamicModel } from "@/lib/pricing";
import { saveVideoDraft, loadVideoDraft, clearVideoDraft } from "@/lib/video-draft-store";
import { getVideoCreditsByRoute } from "@/lib/credit-pricing";
import { useAssetStore } from "@/hooks/use-asset-store";
import { getFallbackUrls } from "@/lib/utils";
import { NewModelsBanner } from "@/components/NewModelsBanner";
import { ReferenceStudioModal } from "@/components/ReferenceStudioModal";
import { ReferenceActionTiles } from "@/components/ReferenceActionTiles";
import { ReferenceToolGrid } from "@/components/ReferenceToolGrid";
import { VIDEO_TOOL_TABS } from "@/lib/reference-tool-tabs";
import { PromptEditorModal } from "@/components/PromptEditorModal";
import { withPresetsAppended } from "@/lib/reference-prompt-injector";
import { HOOK_CHARACTERS } from "@/lib/hook-studio-config";
import { VideoHistoryList, DeleteGenerationDialog } from "@/components/video/VideoHistoryList";
import { AspectRatioPicker } from "@/components/generation/AspectRatioPicker";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ModelCapabilityBadges } from "@/components/video/ModelCapabilityBadges";
import { MotionControlSidebarPanel } from "@/components/video/MotionControlSidebarPanel";
import { EditVideoSidebarPanel } from "@/components/video/EditVideoSidebarPanel";

// -- Utilities -----------------------------------------------------------------

/** Translate opaque provider API error messages into user-friendly text. */
function normalizeGenerationError(raw: string | null | undefined): string {
  if (!raw) return "Generation failed. Please try again.";
  const lower = raw.toLowerCase();
  if (lower.includes("models task execute failed") || lower.includes("task execute failed")) {
    return "The model failed to execute your request. This is usually temporary — please try again.";
  }
  if (lower.includes("content") && (lower.includes("policy") || lower.includes("violation") || lower.includes("sensitive"))) {
    return "Your prompt may have triggered a content filter. Please revise it and try again.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  return raw
    .replace(/\b(kie(\.ai)?|wavespeed(\.ai)?)\b/gi, "Saad Studio")
    .replace(/https?:\/\/\S+/gi, "Saad Studio service");
}

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

import { reportMobileTelemetry } from "@/lib/mobile/client-telemetry";
import { downloadMediaFile } from "@/lib/client-download";

async function downloadVideoItem(item: MediaItem) {
  if (!hasPlayableVideo(item)) return;
  const filename = `saad-video-${item.id}.mp4`;
  try {
    const ok = await downloadMediaFile(item.src, filename, {
      title: item.prompt || "Saad Studio Video",
      fallbackExt: ".mp4",
    });
    reportMobileTelemetry({
      route: "/video",
      feature: "video_download",
      operation: "download",
      status: ok ? "SUCCESS" : "FAILURE",
    });
  } catch {
    reportMobileTelemetry({
      route: "/video",
      feature: "video_download",
      operation: "download",
      status: "FAILURE",
      errorCode: "DOWNLOAD_FAILED",
    });
  }
}

async function copyTextToClipboard(text?: string | null) {
  const value = text?.trim();
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function posterStatusLabel(status?: MediaItem["posterStatus"]) {
  if (status === "ready_video_frame") return "Video frame";
  if (status === "ready") return "Poster ready";
  if (status === "processing") return "Poster processing";
  if (status === "failed") return "Metadata preview";
  return "Preview";
}

function hasPlayableVideo(item: MediaItem) {
  const src = String(item.src || "");
  return Boolean(src && !item.isFailed && !src.startsWith("gradient:") && !src.startsWith("failed:") && !src.startsWith("error:"));
}

function buildVideoToolHref(path: string, item: MediaItem, sourceParam: "videoUrl" | "imageUrl" | "sourceUrl" = "videoUrl") {
  const params = new URLSearchParams();
  if (hasPlayableVideo(item)) params.set(sourceParam, item.src);
  if (item.prompt?.trim()) params.set("prompt", item.prompt.trim());
  params.set("source", "video-history");
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}

async function shareVideoItem(item: MediaItem) {
  const url = hasPlayableVideo(item) ? item.src : window.location.href;
  const title = item.prompt?.trim() || "Saad Studio video";
  try {
    if (navigator.share) {
      await navigator.share({ title, text: title, url });
      return;
    }
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") return;
  }
  await copyTextToClipboard(url);
}

function openVideoTool(path: string, item: MediaItem, sourceParam: "videoUrl" | "imageUrl" | "sourceUrl" = "videoUrl") {
  window.location.href = buildVideoToolHref(path, item, sourceParam);
}

function useVideoTranslation() {
  const { lang } = useLanguage();
  const dict: Record<string, Record<string, string>> = {
    en: {},
    ar: {
      "New": "جديد",
      "18 styles": "18 نمطاً",
      "Style Library": "مكتبة الأنماط",
      "Tap a curated style. The prompt, model, and aspect ratio apply instantly.": "اضغط على نمط مخصص. يتم تطبيق الوصف والنموذج والأبعاد فوراً.",
      "Generation failed. Please try again.": "فشل التوليد. يرجى المحاولة مرة أخرى.",
      "The model failed to execute your request. This is usually temporary — please try again.": "فشل النموذج في تنفيذ طلبك. هذا مؤقت عادةً — يرجى المحاولة مرة أخرى.",
      "Video Tools": "أدوات الفيديو",
      "Video Tools & Models": "أدوات ونماذج الفيديو",
      "Video Engines": "محركات الفيديو",
      "Tools": "الأدوات",
      "Model Settings": "إعدادات النموذج",
      "Model": "النموذج",
      "Create high fidelity cinematic videos and animations with top AI models.": "أنشئ فيديوهات ورسوم متحركة سينمائية عالية الدقة مع أفضل نماذج الذكاء الاصطناعي.",
      
      // Sidebar tool actions
      "Text to Video": "نص إلى فيديو",
      "Generate video clips using descriptive prompt text.": "توليد مقاطع فيديو باستخدام وصف نصي.",
      "Image to Video": "صورة إلى فيديو",
      "Animate a static image into a dynamic video clip.": "تحريك صورة ثابتة إلى مقطع فيديو ديناميكي.",
      "Lipsync / Audio": "مزامنة الشفاه / الصوت",
      "Match speaker avatar movement to any audio track.": "مطابقة حركة رمز المتحدث مع أي مسار صوتي.",
      
      // Sidebar headers & buttons
      "Frames": "الإطارات",
      "Start frame": "إطار البداية",
      "End frame": "إطار النهاية",
      "Upload image *": "تحميل صورة *",
      "Drop image here": "أفلت الصورة هنا",
      "Drop media here": "أفلت الوسائط هنا",
      "Drop images here": "أفلت الصور هنا",
      "Drop here": "أفلت هنا",
      "Optional": "اختياري",
      "Max ": "الحد الأقصى ",
      "Reference media": "وسائط مرجعية",
      "Reference images": "صور مرجعية",
      "Reference images mode is active; first/last frame inputs will be ignored for this generation.": "وضع مراجع الصور نشط، وسيتم تجاهل إدخالات إطارات البداية والنهاية في هذا التوليد.",
      "Kling uses Elements with @element_name, not @Image prompt tags.": "Kling يستخدم Elements بصيغة @element_name، وليس وسوم @Image داخل الوصف.",
      "Seedance supports @Image1..@Image9, @Video1..@Video3, and @Audio1..@Audio3. Audio requires at least one image or video reference.": "Seedance يدعم @Image1..@Image9 و@Video1..@Video3 و@Audio1..@Audio3. الصوت يحتاج صورة أو فيديو مرجعي واحد على الأقل.",
      "AI Model": "نموذج الذكاء الاصطناعي",
      "Character Reference": "مرجع الشخصية",
      "No saved character": "لا توجد شخصية محفوظة",
      "Create a reusable character": "إنشاء شخصية قابلة للاستخدام",
      "reusable character": "شخصية قابلة للاستخدام",
      "reference image(s)": "صور مرجعية",
      "reusable identity reference": "مرجع هوية قابل للاستخدام",
      "Kling 3.0 Elements needs at least 2 reference images for this character.": "عناصر Kling 3.0 تحتاج إلى صورتين مرجعيتين على الأقل لهذه الشخصية.",
      "Kling 3.0 Elements needs at least 3 reference images for this character.": "عناصر Kling 3.0 تحتاج إلى 3 صور مرجعية على الأقل لهذه الشخصية.",
      "N/A in multi-shot": "غير متاح في اللقطات المتعددة",
      "⚠ Both slots have the same image!": "⚠ كلا الحقلين يحتويان على نفس الصورة!",
      "Duration": "المدة",
      "Aspect Ratio": "الأبعاد",
      "Resolution": "الدقة",
      "Quality": "الجودة",
      "Orientation": "الاتجاه",
      "CFG Scale": "مقياس CFG",
      "Flexible": "مرن",
      "Strict": "دقيق",
      "Shot Type": "نوع اللقطة",
      "intelligent": "ذكية",
      "customize": "مخصصة",
      "Multi-shot": "لقطات متعددة",
      "Multiple scenes in one video": "مشاهد متعددة في فيديو واحد",
      "Shots": "لقطات",
      "Duration per shot": "مدة اللقطة",
      "each": "كل منها",
      "Auto divides ": "التقسيم التلقائي يقسم ",
      "s into ": " ثانية إلى ",
      " scene": " مشهد",
      " scenes using your prompt.": " مشاهد باستخدام الوصف الخاص بك.",
      "matches target": "يطابق الهدف",
      "remaining": "متبقي",
      "over": "زائد",
      "Shot": "لقطة",
      "Scene ": "المشهد ",
      " description…": " وصف…",
      "description…": "وصف…",
      "+ Add Shot": "+ إضافة لقطة",
      "max": "كحد أقصى",
      "Elements": "العناصر",
      "+ Add Element": "+ إضافة عنصر",
      "Elements let you reference consistent characters or objects using @element_name in your prompt.": "تسمح لك العناصر بالإشارة إلى شخصيات أو كائنات متسقة باستخدام @اسم_العنصر في الوصف الخاص بك.",
      "✓ Ready": "✓ جاهز",
      "⚠ Incomplete": "⚠ غير مكتمل",
      "Name (letters/digits only — used as @name)": "الاسم (أحرف/أرقام فقط — يُسخدم كـ @الاسم)",
      "Brief description of this element": "وصف قصير لهذا العنصر",
      "Req.": "مطلوب",
      "Opt.": "اختياري",
      "Upload at least 2 images for this element.": "ارفع صورتين على الأقل لهذا العنصر.",
      "⚠ Upload at least 2 images for this element.": "⚠ ارفع صورتين على الأقل لهذا العنصر.",
      "✓ @": "✓ @",
      " is in prompt": " موجود في الوصف",
      "⚠ Add to prompt:": "⚠ أضف إلى الوصف:",
      "+ Insert @": "+ إدراج @",
      "Generate Sound": "توليد الصوت",
      "AI-generated audio track - included": "مسار صوتي مولد بالذكاء الاصطناعي - متضمن",
      "included": "متضمن",
      "Negative Prompt": "الوصف السلبي (Negative Prompt)",
      "Negative prompt": "الوصف السلبي (Negative Prompt)",
      "Loop / Ping-Pong": "تكرار حلقي (Loop / Ping-Pong)",
      "Seamless looping playback": "تشغيل متكرر وسلس بدون فواصل",
      "Things to avoid…": "أشياء يجب تجنبها…",
      "Each element needs 2–4 images. Reference it in your prompt as @element_name.": "يحتاج كل عنصر إلى 2-4 صور. أشر إليه في الوصف الخاص بك كـ @اسم_العنصر.",
      "Name (e.g. hero, car, logo)": "الاسم (مثل: بطل، سيارة، شعار)",
      "Required": "مطلوب",
      "Generate Video": "توليد الفيديو",
      "Generate Lipsync": "توليد مزامنة الشفاه",
      "Sending…": "جاري الإرسال…",
      "running": "قيد التشغيل",
      "Select Video": "حدد الفيديو",
      "Upload media - ": "رفع وسائط - ",
      "Select Reference Image (": "حدد صورة مرجعية (",
      "Select End Frame": "حدد إطار النهاية",
      "Select Start Frame": "حدد إطار البداية",
      "Device": "الجهاز",
      "Generated Images": "الصور المولدة",
      "Generated Videos": "الفيديوهات المولدة",
      "Upload from device": "الرفع من الجهاز",
      "PNG, JPG, WebP": "PNG, JPG, WebP",
      "Image, Video or Audio": "صورة، فيديو أو صوت",
      "MP4, MOV, WebM": "MP4, MOV, WebM",
      "No generated images yet": "لا توجد صور مولدة بعد",
      "No generated videos yet": "لا توجد فيديوهات مولدة بعد",
      
      // Right sidebar headers/placeholders
      "Describe your video...": "صف الفيديو الخاص بك...",
      "Describe speaker text or audio requirements...": "صف نص المتحدث أو متطلبات الصوت...",
      "Prompt Composer": "منشئ الوصف",
      "Generate": "توليد",
      "Generate Video (": "توليد الفيديو (",
      "Generate Lipsync (": "توليد مزامنة الشفاه (",
      "Settings": "الإعدادات",
      "Close Settings": "إغلاق الإعدادات",
      "Customize generation parameters.": "تخصيص معايير التوليد.",
      "Workspace Gallery": "معرض مساحة العمل",
      "Sort:": "الترتيب:",
      "Newest first": "الأحدث أولاً",
      "Oldest first": "الأقدم أولاً",
      "Filter:": "التصفية:",
      "All models": "جميع النماذج",
      "Delete": "حذف",
      "Download": "تحميل",
      "Extend": "تمديد",
      "Upscale": "تكبير الدقة",
      "Remix": "إعادة مزج",
      "All": "الكل",
      "LATEST": "الأحدث",
      "Create your first video": "أنشئ أول فيديو لك",
      "Write a prompt and hit Generate to start creating": "اكتب وصفاً واضغط على توليد لبدء الإنشاء",
      "Select an asset to view details": "حدد عنصراً لعرض التفاصيل",
      
      // Tool names/descriptions for UI mapping
      "Kling 3.0": "Kling 3.0",
      "Kling Motion": "حركة Kling",
      "Seedance 2": "Seedance 2",
      "Veo 3.1 Fast": "Veo 3.1 السريع",
      "Hailuo I2V": "Hailuo I2V",
      "Sora 2": "Sora 2",
      "Luma Dream": "Luma Dream",
      "ByteDance Fast": "ByteDance السريع",
      "Grok Video": "فيديو Grok",
      
      // Sizes mapping
      "Landscape 16:9": "أفقي 16:9",
      "Portrait  9:16": "عمودي 9:16",
      "Landscape 4:3": "أفقي 4:3",
      "Portrait 3:4": "عمودي 3:4",
      "Adaptive": "متكيف",
      "Horizontal": "أفقي",
      "Vertical": "عمودي",
      "Auto-detect from content": "كشف تلقائي من المحتوى",
      
      // Lipsync details
      "Avatar Image": "صورة الرمز (Avatar)",
      "Upload speaker photo": "ارفع صورة المتحدث",
      "Voice / Audio": "الصوت / الملف الصوتي",
      "Record or upload speech": "سجل أو ارفع حديثاً صوتاً",
      "Upload audio": "ارفع ملفاً صوتياً",
      "Voice ID": "معرف الصوت",
      "Select voice...": "اختر صوتاً...",
      "Record speech...": "تسجيل الحديث...",
      "Speak now...": "تحدث الآن...",
      "Stop recording": "إيقاف التسجيل",
      "Upload audio clip": "رفع مقطع صوتي",
      "Audio source file": "ملف مصدر الصوت",
      "Microphone": "الميكروفون",
      "Text-to-Speech": "تحويل النص إلى كلام",
      "Write what the speaker will say": "اكتب ما سيقوله المتحدث",
      "Choose voice": "اختر الصوت",
      
      // Extra details
      "Scene Control Mode": "وضع التحكم بالمشهد",
      "Element List": "قائمة العناصر",
      "Element ID ": "معرف العنصر ",
      "Estimated cost:": "التكلفة التقديرية:",
      "Both slots have the same image!": "كلا الحقلين يحتويان على نفس الصورة!",
      "First/last frame inputs will be ignored.": "سيتم تجاهل إدخالات إطارات البداية والنهاية.",
      "Kling uses Elements with @element_name": "Kling يستخدم Elements بصيغة @element_name",
      "Element": "عنصر",
      "Element name": "اسم العنصر",
      "Element description": "وصف العنصر",
      "Upload at least 2 images": "ارفع صورتين على الأقل",
      "is in prompt": "موجود في الوصف",
      "Add to prompt:": "أضف إلى الوصف:",
      "Insert @": "إدراج @"
    }
  };
  const t = (key: string): string => {
    return dict[lang]?.[key] ?? key;
  };
  return { t, lang };
}


function validateVideoDuration(file: File, minSec = 3, maxSec = 15): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Could not read video duration."));
      } else if (duration < minSec || duration > maxSec) {
        reject(
          new Error(
            `Video duration must be between ${minSec}s and ${maxSec}s. Current duration: ${Math.round(duration)}s.`
          )
        );
      } else {
        resolve(duration);
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video metadata. Make sure it is a valid video file."));
    };
  });
}

async function readVideoDurationSeconds(file: File): Promise<number | null> {
  try {
    return await validateVideoDuration(file, 0.1, 60 * 60);
  } catch {
    return null;
  }
}

async function fileToDataURL(file: File, maxPx = 1920, quality = 0.85): Promise<string> {
  // For non-image files (video) return raw data URL without compression
  if (!file.type.startsWith("image/")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          const scale = maxPx / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function inferVideoUploadMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    aac: "audio/aac",
  };
  return (ext && byExt[ext]) || file.type || "application/octet-stream";
}

async function readVideoUploadError(response: Response, fallback = "Failed to upload media."): Promise<string> {
  try {
    const data = await response.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

async function uploadVideoRequestFile(
  file: File,
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const fileType = inferVideoUploadMimeType(file);
  const signRes = await authFetch("/api/media/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name || `video-reference-${Date.now()}`,
      fileType,
    }),
  });

  if (!signRes.ok) {
    throw new Error(await readVideoUploadError(signRes));
  }

  const signData = await signRes.json();
  const signedUrl = signData?.signedUrl;
  const publicUrl = signData?.publicUrl;
  if (!signedUrl || !publicUrl) {
    throw new Error("Failed to receive signed upload URL.");
  }

  const uploadRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": fileType },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(await readVideoUploadError(uploadRes));
  }

  return String(publicUrl);
}

function aspectRatioToNumbers(ratio: string | null | undefined): { w: number; h: number } {
  if (ratio === "9:16") return { w: 9, h: 16 };
  if (ratio === "1:1") return { w: 1, h: 1 };
  return { w: 16, h: 9 };
}

function targetCanvasSizeForRatio(ratio: string | null | undefined, maxLongSide = 1920) {
  const { w, h } = aspectRatioToNumbers(ratio);
  if (h > w) {
    return { width: Math.round((maxLongSide * w) / h), height: maxLongSide };
  }
  if (w > h) {
    return { width: maxLongSide, height: Math.round((maxLongSide * h) / w) };
  }
  return { width: maxLongSide, height: maxLongSide };
}

const ASPECT_RATIO_ORDER = ["16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "21:9", "landscape", "portrait", "adaptive"];

function sortAspectRatios(ratios: string[]): string[] {
  return [...ratios].sort((a, b) => {
    const ai = ASPECT_RATIO_ORDER.indexOf(a);
    const bi = ASPECT_RATIO_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function ratioIconStyle(ratio: string): { width: number; height: number } {
  const normalized = ratio === "landscape" ? "16:9" : ratio === "portrait" ? "9:16" : ratio;
  const [rawW, rawH] = normalized.split(":").map((value) => Number.parseFloat(value));
  const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
  const h = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;
  const max = 16;
  const min = 6;
  if (w >= h) return { width: max, height: Math.max(min, Math.round((max * h) / w)) };
  return { width: Math.max(min, Math.round((max * w) / h)), height: max };
}

// (AspectRatioPicker imported from @/components/generation/AspectRatioPicker)

async function fileToAspectDataURL(file: File, ratio: string | null | undefined, quality = 0.88): Promise<string> {
  if (!file.type.startsWith("image/")) return fileToDataURL(file);

  const raw = await fileToDataURL(file, 2400, quality);
  return imageSourceToAspectDataURL(raw, ratio, quality);
}

async function imageSourceToAspectDataURL(source: string, ratio: string | null | undefined, quality = 0.88): Promise<string> {
  if (!source || !source.startsWith("data:image/")) return source;

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(source);
    img.onload = () => {
      const { width, height } = targetCanvasSizeForRatio(ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source);
        return;
      }

      ctx.fillStyle = "#050507";
      ctx.fillRect(0, 0, width, height);

      const coverScale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
      const coverW = img.naturalWidth * coverScale;
      const coverH = img.naturalHeight * coverScale;
      ctx.globalAlpha = 0.35;
      ctx.filter = "blur(28px)";
      ctx.drawImage(img, (width - coverW) / 2, (height - coverH) / 2, coverW, coverH);

      const containScale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const containW = img.naturalWidth * containScale;
      const containH = img.naturalHeight * containScale;
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.drawImage(img, (width - containW) / 2, (height - containH) / 2, containW, containH);

      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = source;
  });
}

function sizeToRatio(size: string): string {
  const [w, h] = size.split("*").map(Number);
  if (!w || !h) return "16:9";
  return w > h ? "16:9" : "9:16";
}

function sizeLabel(size: string): string {
  const MAP: Record<string, string> = {
    "1280*720": "Landscape 16:9",
    "720*1280": "Portrait  9:16",
    "854*480":  "Landscape 16:9",
    "480*854":  "Portrait  9:16",
  };
  return MAP[size] ?? size;
}

function prettyModelName(name: string): string {
  let cleaned = name
    .replace(/\s*\((?:Wave\s*Speed|WaveSpeed|Google|KIE|KIE\.ai|wavespeed\.ai|Luma|Runway|Minimax)\)/gi, "")
    .replace(/\b(?:Wave\s*Speed|WaveSpeed|Google|KIE|KIE\.ai|wavespeed\.ai)\b/gi, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bMini\s+Max\b/g, "MiniMax")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function displayVideoModelName(model: WaveSpeedVideoModel, isEditMode: boolean): string {
  const name = prettyModelName(model.name);
  return isEditMode && model.api_route === "google/gemini-omni-1.2-flash"
    ? `${name} Edit`
    : name;
}

type VideoModeLabel = "Text To Video" | "Image To Video" | "Reference To Video" | "Video Extend" | "Video Edit" | "Video To Video";

/**
 * Reference input and start/end frames are separate provider endpoints with
 * disjoint parameters, so one request carries one or the other — never both.
 * The user picks the mode explicitly instead of us inferring it from whichever
 * box happened to get filled.
 */
type InputMode = "references" | "frames";

function getActiveVideoModeLabel(model: WaveSpeedVideoModel, input: {
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  hasMotionVideo: boolean;
  referenceImageCount: number;
  isExtendMode: boolean;
}): VideoModeLabel {
  const route = model.api_route;
  const isGoogle = route.startsWith("google/");
  if (input.hasMotionVideo) {
    if (input.isExtendMode && getGoogleVideoConstraints(route)?.extensionCapable) return "Video Extend";
    if (route === "google/gemini-omni-flash") return "Video Edit";
    if (isGoogle && (route.includes("veo3.1") || route.includes("veo-3.1"))) return "Video Extend";
    return "Video To Video";
  }
  if (input.referenceImageCount > 0 && model.capabilities.max_reference_images > 0) return "Reference To Video";
  if (input.hasStartFrame || input.hasEndFrame) return "Image To Video";
  return "Text To Video";
}
function splitShotDurations(totalDuration: number, shotCount: number): number[] {
  if (shotCount <= 0 || totalDuration <= 0) return [];
  const base = Math.floor(totalDuration / shotCount);
  const remainder = totalDuration % shotCount;
  if (base < 1) return [];
  return Array.from({ length: shotCount }, (_, idx) => base + (idx === shotCount - 1 ? remainder : 0));
}

function compactKlingSingleShotPrompt(value: string, maxChars = 2400): string {
  const prompt = value.trim();
  if (prompt.length <= maxChars) return prompt;

  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^duration\s*:/i.test(line));
  const priority: string[] = [];
  const rules: string[] = [];

  for (const line of lines) {
    if (
      /reference|preserve|no text|no extra|no watermark|original printed|vertical|9:16|4k|ultra realistic|cinematic|product|packaging|global cinematic rules/i.test(line)
    ) {
      priority.push(line);
    } else if (/^shot\s+\d+/i.test(line)) {
      priority.push(line.replace(/^SHOT\s+\d+\s*[—-]\s*/i, "Scene beat: "));
    } else if (/rules/i.test(line)) {
      rules.push(line);
    }
  }

  const compact = [
    "Create one coherent 15-second cinematic commercial. Preserve the uploaded reference product and frame continuity.",
    ...priority,
    ...rules,
    "Keep the result vertical 9:16, polished, realistic, stable, and free of added text overlays or watermarks.",
  ].join("\n");

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1).trim()}…` : compact;
}

function isSeedanceV2VideoModel(model: WaveSpeedVideoModel): boolean {
  return model.id.startsWith("bytedance-seedance-v2") || model.id.startsWith("bytedance-seedance-v25");
}

function isKling30Route(route: string): boolean {
  return route.startsWith("kwaivgi/kling-v3.0-") && !route.includes("/motion-control");
}

function supportsPromptReferenceTags(model: WaveSpeedVideoModel): boolean {
  return (
    model.id.startsWith("bytedance-seedance-v2") ||
    model.id.startsWith("bytedance-seedance-v25") ||
    model.api_route.startsWith("minimax/h3") ||
    model.api_route.startsWith("wavespeed-ai/minimax-h3") ||
    model.api_route === "google/gemini-omni-flash" ||
    model.api_route === "google/gemini-omni-video"
  );
}

function usesMinimaxH3PromptReferenceTags(model: WaveSpeedVideoModel): boolean {
  return model.api_route.startsWith("minimax/h3") || model.api_route.startsWith("wavespeed-ai/minimax-h3");
}

function usesSeedancePromptReferenceTags(model: WaveSpeedVideoModel): boolean {
  return model.api_route.startsWith("bytedance/seedance-");
}

function getDefaultDurationForModel(model: WaveSpeedVideoModel): number | null {
  if (model.api_route.startsWith("bytedance/seedance-2.5") && model.capabilities.durations.includes(5)) return 5;
  return model.capabilities.durations[0] ?? null;
}

function getDefaultAspectRatioForModel(model: WaveSpeedVideoModel): string | null {
  if (model.api_route.startsWith("bytedance/seedance-2.5") && model.capabilities.aspect_ratios.includes("16:9")) return "16:9";
  return model.capabilities.aspect_ratios?.[0] ?? null;
}

function getDefaultResolutionForModel(model: WaveSpeedVideoModel): string | null {
  if (model.api_route.startsWith("bytedance/seedance-2.5") && model.capabilities.resolutions.includes("720p")) return "720p";
  return model.capabilities.resolutions[0] ?? null;
}
function getReferenceFileLimits(model: WaveSpeedVideoModel) {
  const isKling30 = isKling30Route(model.api_route);
  const isWan30 = model.id === "alibaba-wan-3.0-video" || model.api_route.startsWith("alibaba/wan-3.0");
  return {
    images: isKling30 ? 3 : isWan30 ? 10 : Math.max(0, model.capabilities.max_reference_images || 0),
    videos: isWan30 ? 5 : Math.max(0, model.capabilities.max_reference_videos || 0),
    audios: isWan30 ? 5 : Math.max(0, model.capabilities.max_reference_audios || 0),
  };
}

/**
 * Downloads a stored asset back into a File so restored reference media flows
 * through the same previews, limit checks and upload path as a fresh pick.
 * Returns null when the asset is unreachable (expired link, CORS) so the caller
 * can report what could not be restored instead of failing the whole restore.
 */
async function fetchUrlAsFile(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size) return null;
    const name = url.split("?")[0].split("/").pop() || "reference";
    return new File([blob], name, { type: blob.type || "application/octet-stream" });
  } catch {
    return null;
  }
}

function isAllowedReferenceFile(file: File, model: WaveSpeedVideoModel): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("video/")) {
    return !!(model.capabilities.requires_video || model.capabilities.optional_video || model.capabilities.max_reference_videos > 0);
  }
  if (file.type.startsWith("audio/")) {
    return model.capabilities.max_reference_audios > 0;
  }
  return false;
}

function mergeReferenceFiles(current: File[], incoming: File[], model: WaveSpeedVideoModel): File[] {
  const incomingAllowed = incoming.filter((file) => isAllowedReferenceFile(file, model));
  const limits = getReferenceFileLimits(model);

  // Preserve insertion order: keep existing files first and append new files up to limits
  const currentImages = current.filter((f) => f.type.startsWith("image/"));
  const incomingImages = incomingAllowed.filter((f) => f.type.startsWith("image/"));
  const mergedImages = [...currentImages, ...incomingImages].slice(0, Math.max(1, limits.images));

  const currentVideos = current.filter((f) => f.type.startsWith("video/"));
  const incomingVideos = incomingAllowed.filter((f) => f.type.startsWith("video/"));
  const mergedVideos = limits.videos > 0 ? [...currentVideos, ...incomingVideos].slice(0, limits.videos) : [];

  const currentAudios = current.filter((f) => f.type.startsWith("audio/"));
  const incomingAudios = incomingAllowed.filter((f) => f.type.startsWith("audio/"));
  const mergedAudios = limits.audios > 0 ? [...currentAudios, ...incomingAudios].slice(0, limits.audios) : [];

  return [...mergedImages, ...mergedVideos, ...mergedAudios];
}

function getReferenceFileSummary(files: File[], model: WaveSpeedVideoModel): string {
  const limits = getReferenceFileLimits(model);
  const imageCount = files.filter((file) => file.type.startsWith("image/")).length;

  if (limits.videos > 0 || limits.audios > 0) {
    const videoCount = files.filter((file) => file.type.startsWith("video/")).length;
    const audioCount = files.filter((file) => file.type.startsWith("audio/")).length;
    return `Images ${imageCount}/${limits.images} | Videos ${videoCount}/${limits.videos} | Audio ${audioCount}/${limits.audios}`;
  }

  return `${imageCount}/${limits.images} reference image(s)`;
}

function getReferenceFileMaxLabel(model: WaveSpeedVideoModel): string {
  const limits = getReferenceFileLimits(model);
  if (limits.videos > 0 || limits.audios > 0) {
    return `${limits.images} images + ${limits.videos} videos + ${limits.audios} audio`;
  }
  return `${limits.images}`;
}

function getPromptReferenceTagHint(model: WaveSpeedVideoModel): string {
  const limits = getReferenceFileLimits(model);
  const parts: string[] = [];
  if (usesMinimaxH3PromptReferenceTags(model)) {
    if (limits.images > 0) parts.push(`<Picture 1>..<Picture ${limits.images}>`);
    if (limits.videos > 0) parts.push(`<Video 1>..<Video ${limits.videos}>`);
    if (limits.audios > 0) parts.push(`<Audio 1>..<Audio ${limits.audios}>`);
    const joined = parts.length > 0 ? parts.join(", ") : "<Picture 1>";
    return `Minimax H3 references use ${joined}. Assign each reference in the prompt with these exact angle-bracket tags.`;
  }
  const seedanceTags = usesSeedancePromptReferenceTags(model);
  if (limits.images > 0) parts.push(seedanceTags ? `@image1..@image${limits.images}` : `@Image1..@Image${limits.images}`);
  if (limits.videos > 0) parts.push(seedanceTags ? `@video1..@video${limits.videos}` : `@Video1..@Video${limits.videos}`);
  if (limits.audios > 0) parts.push(seedanceTags ? `@audio1..@audio${limits.audios}` : `@Audio1..@Audio${limits.audios}`);
  const joined = parts.length > 0 ? parts.join(", ") : seedanceTags ? "@image1" : "@Image1";
  return seedanceTags
    ? `Reference media supports ${joined}. Keep references in upload order.`
    : `Reference media supports ${joined}. Audio requires at least one image or video reference.`;
}

function getPromptReferenceDescriptors(files: File[], promptTagsEnabled: boolean, model?: WaveSpeedVideoModel) {
  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  const h3Tags = model ? usesMinimaxH3PromptReferenceTags(model) : false;
  const seedanceTags = model ? usesSeedancePromptReferenceTags(model) : false;

  return files.map((file, originalIndex) => {
    if (file.type.startsWith("video/")) {
      videoCount++;
      const tag = h3Tags ? `<Video ${videoCount}>` : seedanceTags ? `@video${videoCount}` : `@Video${videoCount}`;
      return { file, originalIndex, kind: "video" as const, tag, label: promptTagsEnabled ? tag : `Video ${videoCount}` };
    }
    if (file.type.startsWith("audio/")) {
      audioCount++;
      const tag = h3Tags ? `<Audio ${audioCount}>` : seedanceTags ? `@audio${audioCount}` : `@Audio${audioCount}`;
      return { file, originalIndex, kind: "audio" as const, tag, label: promptTagsEnabled ? tag : `Audio ${audioCount}` };
    }
    imageCount++;
    const tag = h3Tags ? `<Picture ${imageCount}>` : seedanceTags ? `@image${imageCount}` : `@Image${imageCount}`;
    return { file, originalIndex, kind: "image" as const, tag, label: promptTagsEnabled ? tag : `Image ${imageCount}` };
  });
}

// -- Constants -----------------------------------------------------------------

const BADGE_STYLE: Record<string, { bg: string; text: string }> = {
  TOP:  { bg: "rgba(245,158,11,0.15)",  text: "#fbbf24" },
  NEW:  { bg: "rgba(16,185,129,0.15)",  text: "#34d399" },
  New:  { bg: "rgba(236,72,153,0.16)",  text: "#f472b6" },
  PRO:  { bg: "rgba(139,92,246,0.15)",  text: "#a78bfa" },
  FAST: { bg: "rgba(14,165,233,0.15)",  text: "#38bdf8" },
  MINI: { bg: "rgba(16,185,129,0.15)",  text: "#34d399" },
  "4K": { bg: "rgba(236,72,153,0.16)",  text: "#f472b6" },
  TURBO: { bg: "rgba(236,72,153,0.16)", text: "#f472b6" },
  BUDGET: { bg: "rgba(14,165,233,0.15)", text: "#38bdf8" },
  SPICY: { bg: "rgba(239,68,68,0.15)", text: "#f87171" },
  "50% off": { bg: "rgba(236,72,153,0.16)", text: "#f472b6" },
};

type VideoToolId =
  | "create-video"
  | "image-to-video"
  | "kling-3"
  | "kling-motion"
  | "seedance-2"
  | "veo-fast"
  | "hailuo-i2v"
  | "lipsync";

type VideoTool = {
  id: VideoToolId;
  label: string;
  description: string;
  icon: LucideIcon;
};

const TOOLS: VideoTool[] = [
  { id: "create-video", label: "Text to Video", description: "Prompt based video generation", icon: Video },
  { id: "image-to-video", label: "Image to Video", description: "Animate an uploaded start frame", icon: ImageIcon },
  { id: "kling-3", label: "Kling 3.0", description: "Structured multi-shot generation", icon: Clapperboard },
  { id: "kling-motion", label: "Kling Motion", description: "Guided motion and camera control", icon: Zap },
  { id: "seedance-2", label: "Seedance 2", description: "Reference based cinematic video", icon: Sparkles },
  { id: "veo-fast", label: "Veo 3.1 Fast", description: "Fast commercial video drafts", icon: Video },
  { id: "hailuo-i2v", label: "Hailuo I2V", description: "Image to video animation preset", icon: PenTool },
];

const TOOL_ALIASES: Record<string, VideoToolId> = {
  "cinema-studio": "seedance-2",
  "mixed-media": "kling-3",
  "edit-video": "veo-fast",
  "click-to-ad": "veo-fast",
  "sora-trends": "veo-fast",
  "draw-to-video": "hailuo-i2v",
  "sketch-to-video": "hailuo-i2v",
  "ugc-factory": "veo-fast",
  "video-upscale": "veo-fast",
  "higgsfield-animate": "seedance-2",
  "vibe-motion": "veo-fast",
  "recast-studio": "veo-fast",
};

function resolveVideoTool(toolId: string | null): VideoToolId | null {
  if (!toolId) return null;
  if (TOOLS.some((tool) => tool.id === toolId)) return toolId as VideoToolId;
  return TOOL_ALIASES[toolId] ?? null;
}

const TOOL_DEFAULT_MODEL_ID: Record<VideoToolId, string> = {
  "create-video": "bytedance-seedance-v25-t2v-turbo",
  "image-to-video": "kling-v3-turbo",
  "kling-3": "kling-v3.0-pro-t2v",
  "kling-motion": "kling-v3.0-pro-t2v",
  "seedance-2": "bytedance-seedance-v25-t2v-turbo",
  "veo-fast": "google-veo3.1-fast-t2v",
  "hailuo-i2v": "minimax-hailuo-2.3-i2v-fast",
  "lipsync": "kling-ai-avatar-pro",
};

const TOOL_PROMPT_PREFIX: Record<VideoToolId, string> = {
  "create-video": "",
  "image-to-video": "Animate the uploaded start frame with natural cinematic motion. ",
  "kling-3": "Create a structured cinematic video with clear subject continuity and controlled composition. ",
  "kling-motion": "Use controlled camera motion and preserve subject identity across the motion. ",
  "seedance-2": "Create a cinematic reference-based video with smooth motion and strong scene consistency. ",
  "veo-fast": "Create a concise commercial-ready video with strong composition and clean motion. ",
  "hailuo-i2v": "Animate the uploaded image with natural movement, stable subject identity, and cinematic framing. ",
  "lipsync": "",
};

const LIPSYNC_MODELS: WaveSpeedVideoModel[] = [
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
    capabilities: {
      requires_image: true,
      optional_image: false,
      requires_video: false,
      has_end_frame: false,
      aspect_ratios: [],
      sizes: [],
      durations: [],
      resolutions: [],
      quality_param: "resolution",
      max_reference_images: 0,
      max_reference_videos: 0,
      max_reference_video_total_seconds: 0,
      max_reference_audios: 0,
      max_reference_audio_total_seconds: 0,
      has_negative_prompt: false,
      has_loop: false,
      has_seed: false,
      has_cfg_scale: false,
      has_sound: true,
      sound_param: "sound",
      has_shot_type: false,
      has_multi_prompt: false,
      has_element_list: false,
      has_scene_control: false,
      has_orientation: false,
      has_omni_tabs: false,
    }
  },
  {
    id: "infinitalk-from-audio",
    name: "Infinitalk API-AI lip-sync generator",
    family: "other",
    family_label: "Other",
    family_color: "#10b981",
    badge: "NEW",
    description: "Speech to video talking head lip-sync generator. Provide a clear face portrait image and an audio recording.",
    api_route: "infinitalk/from-audio",
    route_confirmed: true,
    capabilities: {
      requires_image: true,
      optional_image: false,
      requires_video: false,
      has_end_frame: false,
      aspect_ratios: [],
      sizes: [],
      durations: [],
      resolutions: [],
      quality_param: "resolution",
      max_reference_images: 0,
      max_reference_videos: 0,
      max_reference_video_total_seconds: 0,
      max_reference_audios: 0,
      max_reference_audio_total_seconds: 0,
      has_negative_prompt: false,
      has_loop: false,
      has_seed: false,
      has_cfg_scale: false,
      has_sound: true,
      sound_param: "sound",
      has_shot_type: false,
      has_multi_prompt: false,
      has_element_list: false,
      has_scene_control: false,
      has_orientation: false,
      has_omni_tabs: false,
    }
  }
];

const LIPSYNC_MODEL = LIPSYNC_MODELS[0];

const FAMILY_GRADIENTS: Record<string, string> = {
  wan22:     "from-orange-900 via-orange-800 to-slate-900",
  kling:     "from-cyan-900   via-cyan-800   to-slate-900",
  veo:       "from-blue-900   via-sky-800    to-slate-900",
  sora:      "from-violet-900 via-purple-800 to-slate-900",
  hailuo:    "from-amber-900  via-amber-800  to-slate-900",
  seedance:  "from-emerald-900 via-emerald-800 to-slate-900",
  gemini:    "from-green-900 via-emerald-800 to-slate-900",
  wan:       "from-amber-900 via-orange-800 to-slate-900",
  luma:      "from-purple-900 via-purple-800 to-slate-900",
  pika:      "from-pink-900   via-pink-800   to-slate-900",
  pixverse:  "from-rose-900   via-rose-800   to-slate-900",
  runway:    "from-teal-900   via-teal-800   to-slate-900",
  grok:      "from-red-900    via-red-800    to-slate-900",
  other:     "from-teal-900   via-teal-800   to-slate-900",
};

const HIDDEN_VIDEO_PAGE_MODEL_IDS = new Set([
  "kling-v2.5-turbo-t2v",
  "kling-v2.5-turbo-i2v",
  "openai-sora-2-t2v",
  "openai-sora-2-i2v",
  "xai-grok-imagine-t2v",
  "xai-grok-imagine-edit",
  "bytedance-seedance-v25-i2v-turbo",
  "bytedance-seedance-v25-i2v-spicy",
  "bytedance-seedance-v2-mini-spicy",
  // Google lists Veo 3 and Veo 3 Fast as Deprecated; they may stop serving
  // without notice. The registry rows stay so past generations still resolve.
  "google-veo3-t2v",
  "google-veo3-fast-t2v",
]);

function resolveSeedance25Route(baseRoute: string, hasImageInput: boolean, selectedResolution?: string | null): string {
  if (!baseRoute.startsWith("bytedance/seedance-2.5")) return baseRoute;
  if (!hasImageInput) return baseRoute;

  if (baseRoute === "bytedance/seedance-2.5/text-to-video") {
    return "bytedance/seedance-2.5/image-to-video";
  }
  if (baseRoute !== "bytedance/seedance-2.5/text-to-video-turbo") return baseRoute;

  const normalizedResolution = String(selectedResolution || "").trim().toLowerCase();
  if (normalizedResolution === "480p" || normalizedResolution === "4k") {
    return "bytedance/seedance-2.5/image-to-video";
  }

  return "bytedance/seedance-2.5/image-to-video-turbo";
}

function resolveWan30Route(baseRoute: string, hasImageInput: boolean, hasReferenceInput: boolean): string {
  if (!baseRoute.startsWith("alibaba/wan-3.0")) return baseRoute;
  if (hasReferenceInput) return "alibaba/wan-3.0/reference-to-video";
  return hasImageInput ? "alibaba/wan-3.0/image-to-video" : "alibaba/wan-3.0/text-to-video";
}

function resolveFlux3Route(baseRoute: string, hasImageInput: boolean, hasStartEndInput: boolean, hasVideoInput: boolean): string {
  if (!baseRoute.startsWith("black-forest-labs/flux-3") && !baseRoute.startsWith("black-forest-labs-flux-3")) return baseRoute;
  if (hasVideoInput) return "black-forest-labs/flux-3/video-extend";
  if (hasStartEndInput) return "black-forest-labs/flux-3/start-end-to-video";
  if (hasImageInput) return "black-forest-labs/flux-3/image-to-video";
  return "black-forest-labs/flux-3/text-to-video";
}

function resolveMinimaxH3Route(baseRoute: string, hasImageInput: boolean, hasReferenceInput: boolean): string {
  if (!baseRoute.startsWith("minimax/h3") && !baseRoute.startsWith("wavespeed-ai/minimax-h3") && baseRoute !== "minimax-h3") {
    return baseRoute;
  }
  const isH3Max = baseRoute.startsWith("wavespeed-ai/minimax-h3");
  const prefix = isH3Max ? "wavespeed-ai/minimax-h3" : "minimax/h3";
  if (hasReferenceInput) return `${prefix}/reference-to-video`;
  return hasImageInput ? `${prefix}/image-to-video` : `${prefix}/text-to-video`;
}
const MODEL_GROUPS = getModelGroups()
  .map((group) => ({
    ...group,
    models: group.models.filter((model) => !HIDDEN_VIDEO_PAGE_MODEL_IDS.has(model.id)),
  }))
  .filter((group) => group.models.length > 0);

type CharacterReference = {
  id: string;
  name: string;
  description?: string;
  referenceUrls: string[];
  coverUrl?: string | null;
  providerCharacterId?: string | null;
  status: string;
  metadata?: {
    characterPackage?: {
      mainIdentity?: string;
      faceMemory?: string;
      bodyProfile?: string;
      outfitMemory?: string;
      styleDna?: string;
      motionReferences?: string;
      consistencyProfile?: string;
      states?: Record<string, string>;
    };
  };
};

type CharacterSupportMode = "none" | "image_reference" | "kling_element" | "provider_character_id";

type CharacterSupport = {
  mode: CharacterSupportMode;
  label: string;
  minImages: number;
  maxImages: number;
  note: string;
};

const VIDEO_EDIT_CONTEXT_PREFIX = "saad_video_edit_context:";

function persistVideoEditContext(taskId: string, context: Record<string, unknown>) {
  if (typeof window === "undefined" || !taskId) return;
  try {
    const value = JSON.stringify({ ...context, savedAt: Date.now() });
    localStorage.setItem(`${VIDEO_EDIT_CONTEXT_PREFIX}${taskId}`, value);
    if (taskId.startsWith("gvo:")) {
      localStorage.setItem(`${VIDEO_EDIT_CONTEXT_PREFIX}gen-${taskId}`, value);
    }
  } catch {}
}

const NO_CHARACTER_SUPPORT: CharacterSupport = {
  mode: "none",
  label: "Not supported",
  minImages: 0,
  maxImages: 0,
  note: "This model does not accept saved character references.",
};

function getVideoCharacterSupport(model: WaveSpeedVideoModel): CharacterSupport {
  const route = model.api_route;

  if (model.id === "alibaba-wan-3.0-video" || route.startsWith("alibaba/wan-3.0") || model.family === "wan") {
    return {
      mode: "image_reference",
      label: "Reference images",
      minImages: 1,
      maxImages: Math.max(1, model.capabilities.max_reference_images || 10),
      note: "Wan 3.0 accepts saved character images as visual identity references.",
    };
  }

  if (model.id === "black-forest-labs-flux-3-video" || route.startsWith("black-forest-labs/flux-3") || model.family === "flux") {
    return {
      mode: "image_reference",
      label: "Reference frames",
      minImages: 1,
      maxImages: Math.max(1, model.capabilities.max_reference_images || 10),
      note: "Flux 3 accepts up to 10 reference images or frames for visual identity.",
    };
  }

  if (model.family === "kling" && model.capabilities.has_element_list) {
    return {
      mode: "kling_element",
      label: "Kling Element",
      minImages: 2,
      maxImages: 4,
      note: "Kling Elements requires 2-4 reference images. The character is injected into the prompt as @name.",
    };
  }

  if (model.id.startsWith("bytedance-seedance-v2") || model.id.startsWith("bytedance-seedance-v25")) {
    return {
      mode: "image_reference",
      label: "Reference images",
      minImages: 1,
      maxImages: 9,
      note: "Seedance accepts saved character images as visual references.",
    };
  }

  if (route === "google/veo3.1-fast-text-to-video" || route.startsWith("google/veo3.1")) {
    return {
      mode: "image_reference",
      label: "Reference-to-video",
      minImages: 1,
      maxImages: 3,
      note: "Veo 3.1 supports reference images for character identity.",
    };
  }

  if (route === "x-ai/grok-imagine-video/edit-video" || route.startsWith("x-ai/grok")) {
    return {
      mode: "image_reference",
      label: "Image references",
      minImages: 1,
      maxImages: 7,
      note: "Grok image-to-video can use saved character images as references.",
    };
  }

  if (route.includes("openai/sora-2")) {
    return {
      mode: "provider_character_id",
      label: "Provider character ID",
      minImages: 0,
      maxImages: 0,
      note: "Sora character reuse requires a provider character ID, not ordinary reference images.",
    };
  }

  if ((model.capabilities.max_reference_images || 0) > 0) {
    return {
      mode: "image_reference",
      label: "Reference images",
      minImages: 1,
      maxImages: model.capabilities.max_reference_images,
      note: `${model.name} accepts saved character images as visual references.`,
    };
  }

  return NO_CHARACTER_SUPPORT;
}

function normalizeCharacterTag(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return cleaned || "character";
}

function normalizeBrowserMediaUrl(url: string | null | undefined): string {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:|\/api\/media\/|\/)/i.test(value)) return value;
  if (/^(images|videos|audio|thumbnails|media)\//i.test(value)) {
    return `/api/media/${value.replace(/^\/+/, "")}`;
  }
  return value;
}

// -- Main Component -------------------------------------------------------------

function VideoPageInner() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { fetchWithAuth } = useAuthenticatedFetch();
  const { t, lang } = useVideoTranslation();
  const searchParams = useSearchParams();
  const [activeTool,    setActiveTool]    = useState<VideoToolId>("create-video");
  const [mainWorkflowTab, setMainWorkflowTab] = useState<"create" | "edit" | "motion">("create");
  const [activeEditTool, setActiveEditTool] = useState<string | null>(null);
  const [editPanelState, setEditPanelState] = useState<{
    activeTool: string | null;
    isReady: boolean;
    calculatedCredits: number;
    buttonLabel: string;
    placeholder: string;
    isPromptDisabled: boolean;
    executeGenerate: () => Promise<void>;
  } | null>(null);
  const [motionPanelState, setMotionPanelState] = useState<{
    isReady: boolean;
    calculatedCredits: number;
    videoDuration: number;
    executeGenerate: () => Promise<void>;
  } | null>(null);

  const { videoModels: dynamicVideoList, loading: dynamicLoading } = useFullDynamicModels();

  const dynamicModelGroups = useMemo(() => {
    if (!dynamicVideoList || dynamicVideoList.length === 0) {
      return MODEL_GROUPS;
    }
    const map = new Map<string, any>();
    const seenModelIds = new Set<string>();
    const seenGroupAndNames = new Set<string>();

    const activeList = dynamicVideoList.filter((m) => m.isActive !== false && !HIDDEN_VIDEO_PAGE_MODEL_IDS.has(m.id));

    for (const m of activeList) {
      if (seenModelIds.has(m.id)) continue;

      const groupName = (m.group || m.family_label || m.family || "Other").trim();
      const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const nameKey = `${groupKey}:${(m.name || "").trim().toLowerCase()}`;

      if (seenGroupAndNames.has(nameKey)) continue;
      seenModelIds.add(m.id);
      seenGroupAndNames.add(nameKey);

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          family: groupKey,
          family_label: groupName,
          family_color: m.family_color || (m as any).color || "#06b6d4",
          models: [],
        });
      }
      map.get(groupKey)!.models.push(m);
    }
    return Array.from(map.values());
  }, [dynamicVideoList]);

  const allModels = useMemo(() => {
    return dynamicModelGroups.flatMap((group) => group.models);
  }, [dynamicModelGroups]);

  const defaultModel = useMemo(() => {
    return allModels[0] || DEFAULT_MODEL;
  }, [allModels]);

  const [videoMode, setVideoMode] = useState<"generate" | "extend">("generate");
  const [extendSourceVideo, setExtendSourceVideo] = useState<File | null>(null);
  const [linkedExtendSourceUrl, setLinkedExtendSourceUrl] = useState<string>("");

  const extendCapableModels = useMemo(() => {
    return allModels.filter((m: any) =>
      (
        (typeof m.video_api_route === "string" && m.video_api_route.includes("video-extend")) ||
        Boolean(getGoogleVideoConstraints(m.api_route)?.extensionCapable)
      ) &&
      m.isActive !== false
    );
  }, [allModels]);

  const editCapableModels = useMemo(() => {
    return allModels.filter((m: any) =>
      m.isActive !== false && (
        typeof m.edit_api_route === "string" ||
        (typeof m.video_api_route === "string" && m.video_api_route.includes("video-edit")) ||
        m.api_route.includes("/edit-video")
      )
    );
  }, [allModels]);

  const displayModelGroups = useMemo(() => {
    if (videoMode !== "extend") return dynamicModelGroups;
    const map = new Map<string, any>();
    for (const m of extendCapableModels) {
      const groupName = (m.group || m.family_label || m.family || "Other").trim();
      const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          family: groupKey,
          family_label: groupName,
          family_color: m.family_color || (m as any).color || "#06b6d4",
          models: [],
        });
      }
      map.get(groupKey)!.models.push(m);
    }
    return Array.from(map.values());
  }, [videoMode, dynamicModelGroups, extendCapableModels]);

  const editModelGroups = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of editCapableModels) {
      const groupName = (m.group || m.family_label || m.family || "Other").trim();
      const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          family: groupKey,
          family_label: groupName,
          family_color: m.family_color || (m as any).color || "#06b6d4",
          models: [],
        });
      }
      map.get(groupKey)!.models.push(m);
    }
    return Array.from(map.values());
  }, [editCapableModels]);

  const modelGroupsForSelector = mainWorkflowTab === "edit"
    ? editModelGroups
    : displayModelGroups;

  const [selectedModel, setSelectedModel] = useState<WaveSpeedVideoModel>(DEFAULT_MODEL);
  const [modelOpen,     setModelOpen]     = useState(false);
  const [mobileModelOpen, setMobileModelOpen] = useState(false);
  const [characters, setCharacters] = useState<CharacterReference[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);

  useEffect(() => {
    if (allModels.length > 0 && selectedModel.id === DEFAULT_MODEL.id) {
      setSelectedModel(allModels[0]);
    }
  }, [allModels, selectedModel]);

  useEffect(() => {
    const centralModel = allModels.find((model) => model.id === selectedModel.id || model.api_route === selectedModel.api_route);
    if (centralModel && centralModel !== selectedModel) {
      setSelectedModel(centralModel);
    }
  }, [allModels, selectedModel.id, selectedModel.api_route]);

  useEffect(() => {
    if (mainWorkflowTab === "edit" && editCapableModels.length > 0 && !editCapableModels.some(m => m.id === selectedModel.id)) {
      selectModel(editCapableModels[0]);
    }
  }, [editCapableModels, mainWorkflowTab, selectedModel.id]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "edit") {
      setMainWorkflowTab("edit");
    } else if (requestedTab === "motion" || requestedTab === "motion-control") {
      setMainWorkflowTab("motion");
    } else if (requestedTab === "create") {
      setMainWorkflowTab("create");
    }

    const requestedSubTool = searchParams.get("tool");
    if (requestedSubTool === "object-swap") {
      setMainWorkflowTab("edit");
      setActiveEditTool("object-swap");
    } else if (requestedSubTool === "upscale" || requestedSubTool === "video-upscaler") {
      setMainWorkflowTab("edit");
      setActiveEditTool("upscale");
    } else if (requestedSubTool === "edit-video" || requestedSubTool === "edit") {
      setMainWorkflowTab("edit");
      setActiveEditTool("edit-video");
    } else if (requestedSubTool === "motion-transfer" || requestedSubTool === "motion") {
      setMainWorkflowTab("motion");
    }

    let requestedTool = resolveVideoTool(searchParams.get("tool"));
    const requestedAudioUrl = searchParams.get("audioUrl");
    if (requestedAudioUrl && /^https?:\/\//i.test(requestedAudioUrl)) {
      requestedTool = "lipsync";
    }
    if (requestedTool) setActiveTool(requestedTool);

    const requestedModel = searchParams.get("model");
    if (requestedModel) {
      const matched = allModels.find((model) => model.api_route === requestedModel || model.id === requestedModel);
      if (matched) {
        setSelectedModel(matched);
        const c = matched.capabilities;
        setDuration(getDefaultDurationForModel(matched));
        setAspectRatio(getDefaultAspectRatioForModel(matched));
        setSize(c.sizes[0] ?? null);
        setResolution(getDefaultResolutionForModel(matched));
      }
    }

    const requestedCharacter = searchParams.get("characterId");
    if (requestedCharacter) setSelectedCharacterId(requestedCharacter);
  }, [searchParams, allModels]);

  useEffect(() => {
    if (isAuthLoaded && !isSignedIn) return;
    let cancelled = false;
    const loadCharacters = async () => {
      try {
        const res = await fetchWithAuth("/api/characters", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(data?.characters)) {
          setCharacters(data.characters);
        }
      } catch {
        if (!cancelled) setCharacters([]);
      }
    };
    void loadCharacters();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, isAuthLoaded, isSignedIn]);

  // Prompt fields
  const [prompt,                setPrompt]                = useState("");
  const [negPrompt,             setNegPrompt]             = useState("");
  const [showNegPrompt,         setShowNegPrompt]         = useState(false);
  const [showPromptEditorModal, setShowPromptEditorModal] = useState(false);

  // Global keyboard shortcut for Prompt Editor (Ctrl+E / Cmd+E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setShowPromptEditorModal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Output controls — reset when model changes
  const [duration,    setDuration]    = useState<number | null>(DEFAULT_MODEL.capabilities.durations[0] ?? null);
  const [aspectRatio, setAspectRatio] = useState<string | null>(DEFAULT_MODEL.capabilities.aspect_ratios[0] ?? null);
  const [size,        setSize]        = useState<string | null>(DEFAULT_MODEL.capabilities.sizes[0] ?? null);
  const [resolution,  setResolution]  = useState<string | null>(DEFAULT_MODEL.capabilities.resolutions[0] ?? null);

  // Advanced controls
  const [loop,          setLoop]          = useState(false);
  const [cfgScale,      setCfgScale]      = useState(0.5);
  const [sound,         setSound]         = useState(false);
  const [shotType,      setShotType]      = useState<"intelligent" | "customize">("intelligent");
  const [multiPrompts,  setMultiPrompts]  = useState<string[]>([""]);
  const [elementList,   setElementList]   = useState<string[]>([""]);
  const [sceneControl,  setSceneControl]  = useState(false);
  const [orientation,   setOrientation]   = useState<"video" | "image">("video");
  const [omniTab,       setOmniTab]       = useState<"elements" | "frames">("elements");

  const [showReferenceStudioModal, setShowReferenceStudioModal] = useState(false);
  const [activeStudioTab, setActiveStudioTab] = useState("style");
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [selectedCharacterPresetId, setSelectedCharacterPresetId] = useState<string | null>(null);
  const [selectedSketchId, setSelectedSketchId] = useState<string | null>(null);
  const [selectedShotTypeId, setSelectedShotTypeId] = useState<string | null>(null);
  const [selectedFilmStockId, setSelectedFilmStockId] = useState<string | null>(null);
  const [selectedMovieLookId, setSelectedMovieLookId] = useState<string | null>(null);
  const [selectedLightingId, setSelectedLightingId] = useState<string | null>(null);
  const [selectedMotionBlurId, setSelectedMotionBlurId] = useState<string | null>(null);
  const [selectedGrainId, setSelectedGrainId] = useState<string | null>(null);
  const [selectedHalationId, setSelectedHalationId] = useState<string | null>(null);
  const [selectedTonalLookId, setSelectedTonalLookId] = useState<string | null>(null);
  const [selectedPalette, setSelectedPalette] = useState<{ id: string; name: string; colors: string[] } | null>(null);

  // Kling 3.0 structured elements (name + description + 2-4 images each, max 3 elements)
  type KlingEl = { name: string; description: string; files: File[]; previews: string[]; };
  const [klingEls, setKlingEls] = useState<KlingEl[]>([]);

  // Kling 3.0 multi-shot state (separate from generic multiPrompts — avoids cross-model pollution)
  const [kling30MultiEnabled, setKling30MultiEnabled] = useState(false);
  const [kling30MultiMode, setKling30MultiMode] = useState<"auto" | "custom">("auto");
  // custom shots: each has prompt + individual duration
  const [kling30CustomShots, setKling30CustomShots] = useState<Array<{ prompt: string; duration: number }>>([
    { prompt: "", duration: 5 },
  ]);

  // Image inputs
  const [startFrame,   setStartFrame]   = useState<File | null>(null);
  const [linkedStartFrameUrl, setLinkedStartFrameUrl] = useState<string | null>(null);
  const [endFrame,     setEndFrame]     = useState<File | null>(null);
  const [linkedEndFrameUrl, setLinkedEndFrameUrl] = useState<string | null>(null);
  const [motionVideo,  setMotionVideo]  = useState<File | null>(null);
  const [referenceImages, setReferenceImages] = useState<File[]>([]); // unified: image + video + audio for Seedance 2
  const [inputMode,    setInputMode]    = useState<InputMode>("references");
  const [startFramePreview, setStartFramePreview] = useState<string | null>(null);
  const [endFramePreview, setEndFramePreview] = useState<string | null>(null);
  const [motionVideoPreview, setMotionVideoPreview] = useState<string | null>(null);
  const [motionVideoDuration, setMotionVideoDuration] = useState<number | null>(null);
  // Detected aspect ratio of the uploaded start frame (Kling 3.0 i2v auto-adapts to this)
  const [startFrameRatio, setStartFrameRatio] = useState<string | null>(null);
  const referencePreviewUrlMapRef = useRef<Map<File, string>>(new Map());
  const referencePreviews = useMemo(() => {
    const map = referencePreviewUrlMapRef.current;
    const active = new Set(referenceImages);

    for (const [file, url] of Array.from(map.entries())) {
      if (!active.has(file)) {
        URL.revokeObjectURL(url);
        map.delete(file);
      }
    }

    return referenceImages.map((file) => {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return "";
      const existing = map.get(file);
      if (existing) return existing;
      const url = URL.createObjectURL(file);
      map.set(file, url);
      return url;
    });
  }, [referenceImages]);

  useEffect(() => {
    return () => {
      for (const url of Array.from(referencePreviewUrlMapRef.current.values())) URL.revokeObjectURL(url);
      referencePreviewUrlMapRef.current.clear();
    };
  }, []);
  const startFrameRef  = useRef<HTMLInputElement>(null);
  const endFrameRef    = useRef<HTMLInputElement>(null);
  const motionVideoRef = useRef<HTMLInputElement>(null);
  const referenceImagesRef = useRef<HTMLInputElement>(null);
  // Lipsync audio state
  const [lipsyncAudioFile, setLipsyncAudioFile] = useState<File | null>(null);
  const [lipsyncAudioPreview, setLipsyncAudioPreview] = useState<string | null>(null);
  const lipsyncAudioRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (motionVideo) {
      validateVideoDuration(motionVideo, 3, 30)
        .then((dur) => setMotionVideoDuration(dur))
        .catch(() => setMotionVideoDuration(null));
    } else {
      setMotionVideoDuration(null);
    }
  }, [motionVideo]);

  useEffect(() => {
    if (!lipsyncAudioFile) {
      setLipsyncAudioPreview(null);
      return;
    }
    const url = URL.createObjectURL(lipsyncAudioFile);
    setLipsyncAudioPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [lipsyncAudioFile]);

  useEffect(() => {
    const requestedPrompt = searchParams.get("prompt");
    if (requestedPrompt) setPrompt(requestedPrompt);

    const isEndParam = searchParams.get("end") === "true";
    let storedStartUrl: string | null = null;
    let storedEndUrl: string | null = null;

    if (typeof window !== "undefined") {
      try {
        storedStartUrl = sessionStorage.getItem("video_start_frame_payload");
        if (storedStartUrl) sessionStorage.removeItem("video_start_frame_payload");
      } catch {}
      try {
        storedEndUrl = sessionStorage.getItem("video_end_frame_payload");
        if (storedEndUrl) sessionStorage.removeItem("video_end_frame_payload");
      } catch {}
    }

    const requestedStartImageUrl = storedStartUrl || searchParams.get("startImageUrl") || (!isEndParam ? searchParams.get("imageUrl") : null);
    const requestedEndImageUrl = storedEndUrl || searchParams.get("endImageUrl") || searchParams.get("lastFrameUrl") || (isEndParam ? searchParams.get("imageUrl") : null);

    let cancelled = false;

    // 1. Process Start Frame
    if (requestedStartImageUrl && (requestedStartImageUrl.startsWith("http://") || requestedStartImageUrl.startsWith("https://") || requestedStartImageUrl.startsWith("data:") || requestedStartImageUrl.startsWith("blob:") || requestedStartImageUrl.startsWith("/"))) {
      setLinkedStartFrameUrl(requestedStartImageUrl);
      setStartFramePreview(requestedStartImageUrl);
      setStartFrame(null);
      setOmniTab("frames");

      if (requestedStartImageUrl.startsWith("data:") || requestedStartImageUrl.startsWith("blob:")) {
        void fetch(requestedStartImageUrl)
          .then(res => res.blob())
          .then(blob => {
            if (cancelled) return;
            const type = blob.type || "image/jpeg";
            const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
            setStartFrame(new File([blob], `linked-start-frame.${ext}`, { type }));
          })
          .catch(() => {
            if (!cancelled) setLinkedStartFrameUrl(requestedStartImageUrl);
          });
      } else {
        const fallbacks = getFallbackUrls(requestedStartImageUrl);
        const fetchUrl = fallbacks.find((u) => u.startsWith("/api/media/")) || requestedStartImageUrl;

        void fetch(fetchUrl)
          .then((res) => {
            if (!res.ok) throw new Error("Unable to load linked image");
            return res.blob();
          })
          .then((blob) => {
            if (cancelled) return;
            const type = blob.type || "image/jpeg";
            const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
            setStartFrame(new File([blob], `linked-start-frame.${ext}`, { type }));
            setLinkedStartFrameUrl(null);
          })
          .catch(() => {
            if (!cancelled) setLinkedStartFrameUrl(requestedStartImageUrl);
          });
      }
    }

    // 2. Process End Frame
    if (requestedEndImageUrl && (requestedEndImageUrl.startsWith("http://") || requestedEndImageUrl.startsWith("https://") || requestedEndImageUrl.startsWith("data:") || requestedEndImageUrl.startsWith("blob:") || requestedEndImageUrl.startsWith("/"))) {
      setLinkedEndFrameUrl(requestedEndImageUrl);
      setEndFramePreview(requestedEndImageUrl);
      setEndFrame(null);
      setOmniTab("frames");

      if (requestedEndImageUrl.startsWith("data:") || requestedEndImageUrl.startsWith("blob:")) {
        void fetch(requestedEndImageUrl)
          .then(res => res.blob())
          .then(blob => {
            if (cancelled) return;
            const type = blob.type || "image/jpeg";
            const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
            setEndFrame(new File([blob], `linked-end-frame.${ext}`, { type }));
          })
          .catch(() => {
            if (!cancelled) setLinkedEndFrameUrl(requestedEndImageUrl);
          });
      } else {
        const fallbacks = getFallbackUrls(requestedEndImageUrl);
        const fetchUrl = fallbacks.find((u) => u.startsWith("/api/media/")) || requestedEndImageUrl;

        void fetch(fetchUrl)
          .then((res) => {
            if (!res.ok) throw new Error("Unable to load linked end image");
            return res.blob();
          })
          .then((blob) => {
            if (cancelled) return;
            const type = blob.type || "image/jpeg";
            const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
            setEndFrame(new File([blob], `linked-end-frame.${ext}`, { type }));
            setLinkedEndFrameUrl(null);
          })
          .catch(() => {
            if (!cancelled) setLinkedEndFrameUrl(requestedEndImageUrl);
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Load audioUrl from searchParams
  useEffect(() => {
    const requestedAudioUrl = searchParams.get("audioUrl");
    if (!requestedAudioUrl || !/^https?:\/\//i.test(requestedAudioUrl)) return;

    let cancelled = false;

    const fallbacks = getFallbackUrls(requestedAudioUrl);
    const fetchUrl = fallbacks.find((u) => u.startsWith("/api/media/")) || requestedAudioUrl;

    void fetch(fetchUrl)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load linked audio");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const type = blob.type || "audio/mpeg";
        const ext = type.includes("wav") ? "wav" : type.includes("aac") ? "aac" : "mp3";
        setLipsyncAudioFile(new File([blob], `linked-audio.${ext}`, { type }));
      })
      .catch((err) => {
        console.error("Failed to load searchParam audio:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);



  // Media gallery picker
  type PickerTarget = "startFrame" | "endFrame" | "motionVideo" | "referenceImages";
  const [mediaPicker, setMediaPicker]     = useState<PickerTarget | null>(null);
  const [pickerGallery, setPickerGallery] = useState<
    Array<{
      id: string;
      url: string;
      type: string;
      posterUrl?: string;
      thumbnailUrl?: string;
      prompt?: string;
    }>
  >([]);
  const [pickerTab, setPickerTab]         = useState<"upload" | "images" | "videos" | "audio">("images");
  const [pickerLoading, setPickerLoading] = useState(false);

  const allowDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  const markDropZone = useCallback((event: DragEvent<HTMLElement>, zone: string) => {
    event.preventDefault();
    setActiveDropZone(zone);
  }, []);

  const clearDropZone = useCallback((event: DragEvent<HTMLElement>, zone: string) => {
    event.preventDefault();
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    setActiveDropZone((current) => (current === zone ? null : current));
  }, []);

  const guardSeedanceMediaSelection = useCallback((target: PickerTarget): boolean => {
    if (!selectedModel.api_route.startsWith("bytedance/seedance-")) return false;

    const hasStartFrame = Boolean(startFrame || linkedStartFrameUrl);
    const hasEndFrame = Boolean(endFrame || linkedEndFrameUrl);
    const hasReferences = referenceImages.length > 0;
    const conflict = getSeedanceComposerMediaConflict(selectedModel.api_route, {
      hasStartFrame: target === "startFrame" ? true : hasStartFrame,
      hasEndFrame: target === "endFrame" ? true : hasEndFrame,
      hasReferenceMedia: target === "referenceImages" ? true : hasReferences,
      isExtendMode: videoMode === "extend",
    });

    if (conflict === "frames_and_references_conflict") {
      setGenerationError(
        target === "referenceImages"
          ? lang === "ar"
            ? "لا يمكن إضافة References مع Start/End في طلب Seedance واحد. احذف إطارات البداية والنهاية أولاً، أو استخدمها بدون References."
            : "Seedance cannot combine References with Start/End frames. Remove the frames first, or use them without References."
          : lang === "ar"
            ? "لا يمكن إضافة Start/End مع References في طلب Seedance واحد. احذف المراجع أولاً، أو استخدمها بدون إطارات."
            : "Seedance cannot combine Start/End frames with References. Remove the references first, or use them without frames."
      );
      return true;
    }

    if (conflict === "end_requires_start") {
      setGenerationError(
        lang === "ar"
          ? "أضف Start Frame أولاً قبل اختيار End Frame في Seedance."
          : "Add a Start Frame before selecting an End Frame for Seedance."
      );
      return true;
    }

    return false;
  }, [endFrame, lang, linkedEndFrameUrl, linkedStartFrameUrl, referenceImages.length, selectedModel.api_route, startFrame, videoMode]);

  const selectFrameFile = useCallback((target: "startFrame" | "endFrame", file: File | null) => {
    if (file && guardSeedanceMediaSelection(target)) return;
    if (target === "startFrame") setStartFrame(file);
    else setEndFrame(file);
  }, [guardSeedanceMediaSelection]);

  const addReferenceFiles = useCallback((files: File[]) => {
    if (files.length === 0 || guardSeedanceMediaSelection("referenceImages")) return;
    setReferenceImages((prev) => mergeReferenceFiles(prev, files, selectedModel));
  }, [guardSeedanceMediaSelection, selectedModel]);

  const handleDropSingleImage = useCallback((event: DragEvent<HTMLElement>, setter: (file: File | null) => void) => {
    event.preventDefault();
    setActiveDropZone(null);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (!dropped || !dropped.type.startsWith("image/")) return;
    setter(dropped);
  }, []);

  const handleDropSingleVideo = useCallback((event: DragEvent<HTMLElement>, setter: (file: File | null) => void) => {
    event.preventDefault();
    setActiveDropZone(null);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (!dropped || !dropped.type.startsWith("video/")) return;
    setter(dropped);
  }, []);

  const handleDropReferenceImages = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setActiveDropZone(null);
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) => isAllowedReferenceFile(file, selectedModel));
    if (!dropped.length) return;
    if (getReferenceFileLimits(selectedModel).images <= 0) return;
    addReferenceFiles(dropped);
  }, [addReferenceFiles, selectedModel]);

  useEffect(() => {
    if (!startFrame) {
      setStartFramePreview(linkedStartFrameUrl);
      setStartFrameRatio(null);
      if (linkedStartFrameUrl) {
        const img = new window.Image();
        img.onload = () => {
          const r = img.naturalWidth / img.naturalHeight;
          const snapped = Math.abs(r - 1) < 0.15 ? "1:1" : (r > 1 ? "16:9" : "9:16");
          setStartFrameRatio(snapped);
        };
        img.src = linkedStartFrameUrl;
      }
      return;
    }
    const url = URL.createObjectURL(startFrame);
    setStartFramePreview(url);
    // Detect actual aspect ratio of the image so we can mirror Kling 3.0's auto-adapt behavior
    const img = new window.Image();
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight;
      const snapped = Math.abs(r - 1) < 0.15 ? "1:1" : (r > 1 ? "16:9" : "9:16");
      setStartFrameRatio(snapped);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [linkedStartFrameUrl, startFrame]);

  useEffect(() => {
    if (!endFrame) {
      setEndFramePreview(linkedEndFrameUrl);
      return;
    }
    const url = URL.createObjectURL(endFrame);
    setEndFramePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [linkedEndFrameUrl, endFrame]);

  useEffect(() => {
    if (!motionVideo) {
      setMotionVideoPreview(null);
      return;
    }
    const url = URL.createObjectURL(motionVideo);
    setMotionVideoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [motionVideo]);

  const [referenceVideoDurations, setReferenceVideoDurations] = useState<number[]>([]);
  useEffect(() => {
    const videos = referenceImages.filter((file) => file.type.startsWith("video/"));
    if (!videos.length) {
      setReferenceVideoDurations([]);
      return;
    }

    let cancelled = false;
    Promise.all(videos.map(readVideoDurationSeconds)).then((durations) => {
      if (cancelled) return;
      setReferenceVideoDurations(
        durations.filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration) && duration > 0),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [referenceImages]);

  // Generation state
  type PendingTask = {
    model: WaveSpeedVideoModel;
    promptText: string;
    ratio: string;
    duration: number | null;
    startImageUrl?: string;
    endImageUrl?: string;
    referenceImageUrls?: string[];
  };
  const [pendingTasks,    setPendingTasks]    = useState<Map<string, PendingTask>>(new Map());
  const [isSubmitting,    setIsSubmitting]    = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const pollRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const completedTaskRefs = useRef<Set<string>>(new Set());
  const resultUrlsRef = useRef<Set<string>>(new Set());

  // Results
  const [results, setResults] = useState<MediaItem[]>([]);
  const [videoResultsPage, setVideoResultsPage] = useState(0);
  const [videoResultsHasMore, setVideoResultsHasMore] = useState(false);
  const [loadingMoreVideos, setLoadingMoreVideos] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [inspectorAsset, setInspectorAsset] = useState<Asset | null>(null);

  const mapAssetToMediaItem = useCallback((asset: any): MediaItem | null => {
    const isFailed = Boolean(asset?.isFailed || String(asset?.status || "").toLowerCase() === "failed");
    const originalUrl = normalizeBrowserMediaUrl(asset?.originalUrl || asset?.url);
    if (!originalUrl && !isFailed) return null;
    const model = allModels.find((m) => m.api_route === asset.model || m.name === asset.model);
    const durationValue = typeof asset.duration === "number" && Number.isFinite(asset.duration)
      ? `${asset.duration}s`
      : typeof asset.duration === "string" && asset.duration
        ? asset.duration
        : "auto";
    return {
      id: String(asset.id),
      type: "video",
      src: isFailed ? `failed:${asset.id}` : originalUrl,
      poster: typeof asset.posterUrl === "string" ? asset.posterUrl : undefined,
      posterStatus: typeof asset.posterStatus === "string" ? asset.posterStatus : undefined,
      model: model?.name ?? (asset.model || "Video"),
      modelColor: model?.family_color ?? "#06b6d4",
      ratio: asset.resolution || asset.aspectRatio || "16:9",
      duration: durationValue,
      prompt: asset.prompt || "",
      providerRequestId: asset.providerRequestId,
      status: typeof asset.status === "string" ? asset.status : undefined,
      isFailed,
      failureReason: typeof asset.failureReason === "string" ? asset.failureReason : undefined,
      creditsRefunded: Boolean(asset.creditsRefunded),
      gradient: model ? (FAMILY_GRADIENTS[model.family] ?? "from-slate-900 via-slate-800 to-slate-900") : "from-slate-900 via-slate-800 to-slate-900",
      isFavorite: Boolean(asset.isFavorite),
      createdAt: asset.createdAt ? new Date(asset.createdAt) : new Date(),
      startImageUrl: typeof asset.startImageUrl === "string" ? asset.startImageUrl : undefined,
      endImageUrl: typeof asset.endImageUrl === "string" ? asset.endImageUrl : undefined,
      referenceImageUrls: Array.isArray(asset.referenceImageUrls) ? asset.referenceImageUrls : undefined,
      referenceVideoUrls: Array.isArray(asset.referenceVideoUrls) ? asset.referenceVideoUrls : undefined,
      referenceAudioUrls: Array.isArray(asset.referenceAudioUrls) ? asset.referenceAudioUrls : undefined,
    };
  }, [allModels]);

  const toggleVideoFavorite = useCallback(async (item: MediaItem) => {
    const nextFavorite = !item.isFavorite;
    setResults((prev) => prev.map((candidate) => (
      candidate.id === item.id ? { ...candidate, isFavorite: nextFavorite } : candidate
    )));

    try {
      const res = await fetchWithAuth("/api/assets/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, isFavorite: nextFavorite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        throw new Error(typeof data?.error === "string" ? data.error : "Favorite update failed.");
      }
    } catch (error) {
      setResults((prev) => prev.map((candidate) => (
        candidate.id === item.id ? { ...candidate, isFavorite: !nextFavorite } : candidate
      )));
      console.error("[video] favorite update failed", error);
    }
  }, [fetchWithAuth]);

  const mediaItemToInspectorAsset = useCallback((item: MediaItem): Asset => ({
    id: item.id,
    type: "video",
    url: item.src,
    title: item.model,
    prompt: item.prompt,
    model: item.model,
    resolution: item.ratio,
    duration: item.duration,
    date: item.createdAt
      ? item.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : undefined,
    providerRequestId: item.providerRequestId,
  }), []);
  const loadPersistedVideos = useCallback(async (nextPage = 0, mode: "replace" | "append" = "replace", overrideProfileId?: string) => {
    if (mode === "append") setLoadingMoreVideos(true);
    try {
      const targetProfileId = overrideProfileId !== undefined
        ? overrideProfileId
        : (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : "");

      const params = new URLSearchParams({
        type: "video",
        page: String(nextPage),
        limit: "12",
        ...(targetProfileId ? { profileId: targetProfileId } : {}),
      });
      const res = await fetchWithAuth(`/api/assets?${params.toString()}`, { cache: "no-cache" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.assets)) {
        if (mode === "replace") {
          setResults([]);
          resultUrlsRef.current = new Set();
        }
        return;
      }

      const pageSeen = new Set<string>();
      const mapped = data.assets.flatMap((asset: any) => {
        const item = mapAssetToMediaItem(asset);
        if (!item || pageSeen.has(item.id)) return [];
        pageSeen.add(item.id);
        return [item];
      });

      setResults((prev) => {
        const next = mode === "append" ? [...prev] : [];
        const seenIds = new Set(next.map((item) => item.id));
        for (const item of mapped) {
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          next.push(item);
        }
        resultUrlsRef.current = new Set(next.map((item) => item.src));
        return next;
      });
      setVideoResultsPage(typeof data?.page === "number" ? data.page : nextPage);
      setVideoResultsHasMore(Boolean(data?.hasMore));
    } catch {
      if (mode === "replace") {
        setResults([]);
        resultUrlsRef.current = new Set();
      }
    } finally {
      if (mode === "append") setLoadingMoreVideos(false);
    }
  }, [fetchWithAuth, mapAssetToMediaItem]);

  const confirmDeleteVideo = useCallback(async () => {
    const id = deleteTargetId;
    if (!id || deletingId) return;
    setDeletingId(id);
    setResults((prev) => prev.filter((item) => item.id !== id));
    try {
      const res = await fetchWithAuth("/api/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteTargetId(null);
    } catch {
      void loadPersistedVideos(0, "replace");
    } finally {
      setDeletingId(null);
    }
  }, [deleteTargetId, deletingId, fetchWithAuth, loadPersistedVideos]);

  useEffect(() => {
    void loadPersistedVideos(0, "replace");
  }, [loadPersistedVideos]);

  useEffect(() => {
    const handleProfileSwitch = (e: Event) => {
      const customEvent = e as CustomEvent<{ profileId?: string }>;
      const newProfileId = customEvent.detail?.profileId ?? (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : "");
      // Immediately clear results for instant responsive feedback
      setResults([]);
      resultUrlsRef.current = new Set();
      setVideoResultsPage(0);
      setVideoResultsHasMore(false);
      void loadPersistedVideos(0, "replace", newProfileId || "");
    };
    window.addEventListener("saad-profile-switched", handleProfileSwitch);
    return () => window.removeEventListener("saad-profile-switched", handleProfileSwitch);
  }, [loadPersistedVideos]);

  // ── Draft persistence ──────────────────────────────────────────────────────
  // A reload used to discard the prompt and every attachment. Scalars live in
  // localStorage and attachments in IndexedDB, which stores File objects as-is.
  const draftRestoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await loadVideoDraft();
      if (cancelled) {
        draftRestoredRef.current = true;
        return;
      }
      if (draft) {
        const { scalars, files } = draft;
        const model = scalars.modelId
          ? VIDEO_MODEL_REGISTRY.find((entry: WaveSpeedVideoModel) => entry.id === scalars.modelId)
          : undefined;
        if (model) setSelectedModel(model);
        if (scalars.prompt) setPrompt(scalars.prompt);
        if (scalars.negativePrompt) setNegPrompt(scalars.negativePrompt);
        if (scalars.duration !== null) setDuration(scalars.duration);
        if (scalars.aspectRatio !== null) setAspectRatio(scalars.aspectRatio);
        if (scalars.size !== null) setSize(scalars.size);
        if (scalars.resolution !== null) setResolution(scalars.resolution);
        setSound(scalars.sound);
        setInputMode(scalars.inputMode);
        if (scalars.linkedStartFrameUrl) setLinkedStartFrameUrl(scalars.linkedStartFrameUrl);
        if (scalars.linkedEndFrameUrl) setLinkedEndFrameUrl(scalars.linkedEndFrameUrl);
        if (scalars.referenceVideoDurations.length) setReferenceVideoDurations(scalars.referenceVideoDurations);
        if (files.referenceImages.length) setReferenceImages(files.referenceImages);
        if (files.startFrame) setStartFrame(files.startFrame);
        if (files.endFrame) setEndFrame(files.endFrame);
      }
      draftRestoredRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    // Debounced so typing a prompt does not write on every keystroke.
    const timer = window.setTimeout(() => {
      void saveVideoDraft(
        {
          modelId: selectedModel.id,
          prompt,
          negativePrompt: negPrompt,
          duration,
          aspectRatio,
          size,
          resolution,
          sound,
          inputMode,
          linkedStartFrameUrl,
          linkedEndFrameUrl,
          referenceVideoDurations,
          savedAt: Date.now(),
        },
        { referenceImages, startFrame, endFrame },
      );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    selectedModel.id,
    prompt,
    negPrompt,
    duration,
    aspectRatio,
    size,
    resolution,
    sound,
    inputMode,
    linkedStartFrameUrl,
    linkedEndFrameUrl,
    referenceVideoDurations,
    referenceImages,
    startFrame,
    endFrame,
  ]);

  // Capability shorthand
  const caps = selectedModel.capabilities;

  // ── Input mode: References vs Start/End frames ─────────────────────────────
  // Kling 3.0 declares reference-image slots but spends them on start/end frames
  // and has no reference-to-video endpoint, so it must stay single-mode. This
  // mirrors the `showReferenceImages` exclusions below.
  const referencePanelSuppressed =
    isKling30Route(selectedModel.api_route) ||
    selectedModel.api_route === "kwaivgi/kling-v3.0-std/image-to-video" ||
    selectedModel.api_route === "kwaivgi/kling-v3.0-pro/image-to-video";
  const supportsReferenceInput =
    !referencePanelSuppressed &&
    ((caps.max_reference_images || 0) > 0 ||
      (caps.max_reference_videos || 0) > 0 ||
      (caps.max_reference_audios || 0) > 0);
  const supportsFrameInput = caps.requires_image || caps.optional_image || caps.has_end_frame;
  const inputModeChoices = useMemo<InputMode[]>(() => {
    const modes: InputMode[] = [];
    if (supportsReferenceInput) modes.push("references");
    if (supportsFrameInput) modes.push("frames");
    return modes;
  }, [supportsReferenceInput, supportsFrameInput]);
  // Only a model offering both needs the switcher; single-mode models render as
  // before, and so do models whose single endpoint accepts both at once.
  const showInputModeTabs = inputModeChoices.length > 1 && !caps.combines_references_with_frames;
  const referenceModeActive = !showInputModeTabs || inputMode === "references";
  const frameModeActive     = !showInputModeTabs || inputMode === "frames";

  useEffect(() => {
    if (inputModeChoices.length > 0 && !inputModeChoices.includes(inputMode)) {
      setInputMode(inputModeChoices[0]);
    }
  }, [inputModeChoices, inputMode]);
  const characterSupport = useMemo(() => getVideoCharacterSupport(selectedModel), [selectedModel]);
  const selectableCharacters = useMemo(
    () => characterSupport.mode === "provider_character_id"
      ? characters.filter((character) => Boolean(character.providerCharacterId))
      : characters,
    [characters, characterSupport.mode],
  );
  const supportsCharacterReference = characterSupport.mode !== "none" && selectableCharacters.length > 0;
  const selectedCharacter = useMemo(
    () => supportsCharacterReference ? selectableCharacters.find((character) => character.id === selectedCharacterId) || null : null,
    [selectableCharacters, selectedCharacterId, supportsCharacterReference],
  );
  const isSoraModel = selectedModel.api_route.includes("openai/sora-2");
  const isWan30Model = selectedModel.api_route.startsWith("alibaba/wan-3.0");
  const isVeo31Model =
    selectedModel.api_route.startsWith("google/veo3.1") ||
    selectedModel.api_route === "google/veo-3.1-generate-preview" ||
    selectedModel.api_route === "google/gemini-omni-video" ||
    selectedModel.api_route === "google/gemini-omni-flash";
  const isLegacyGoogleVeo3Model =
    selectedModel.api_route === "google/veo3-fast-text-to-video" ||
    selectedModel.api_route === "google/veo3-text-to-video";
  const isGoogleVeoModel = isVeo31Model || isLegacyGoogleVeo3Model;
  const googleConstraints = getGoogleVideoConstraints(selectedModel.api_route);
  const normalizedGoogle = googleConstraints && isGoogleVideoRoute(selectedModel.api_route)
    ? normalizeGoogleVideoOptions(selectedModel.api_route, {
        duration,
        resolution,
        aspectRatio,
        referenceImageCount: referenceImages.filter((file) => file.type.startsWith("image/")).length,
        hasVideoInput: Boolean(motionVideo),
        hasStartImage: Boolean(startFrame || linkedStartFrameUrl),
        hasEndImage: Boolean(endFrame),
        requestedMode: videoMode === "extend" ? "video_extend" : undefined,
      })
    : null;
  const isVeo31LiteModel = selectedModel.api_route === "google/veo3.1-lite-text-to-video";
  const isVeo31FastModel = selectedModel.api_route === "google/veo3.1-fast-text-to-video";
  const isVeo31ExtensionCapableModel = Boolean(googleConstraints?.extensionCapable);
  const isGoogleVeoExtensionInput = isVeo31ExtensionCapableModel && Boolean(motionVideo);
  const hasVeo31ReferenceInput = isVeo31Model && (
    (frameModeActive && (Boolean(startFrame) || Boolean(linkedStartFrameUrl) || Boolean(endFrame))) ||
    (referenceModeActive && referenceImages.length > 0) ||
    isGoogleVeoExtensionInput
  );
  const isGoogleVeoHighResolution = isGoogleVeoModel && ["1080p", "4k"].includes((resolution ?? "").toLowerCase());
  const isVeo31FixedEightSecond = isVeo31Model && selectedModel.api_route !== "google/gemini-omni-flash" && (hasVeo31ReferenceInput || isGoogleVeoHighResolution);
  const durationChoices = isSoraModel ? [4, 8, 12] : normalizedGoogle ? (isVeo31FixedEightSecond ? [8] : googleConstraints?.durations ?? caps.durations) : isVeo31FixedEightSecond ? [8] : caps.durations;
  const resolutionChoices = isSoraModel
    ? []
    : normalizedGoogle
      ? (isGoogleVeoExtensionInput ? ["720p"] : googleConstraints?.resolutions ?? caps.resolutions)
      : isGoogleVeoExtensionInput
        ? ["720p"]
        : isVeo31LiteModel
          ? caps.resolutions.filter((value) => value.toLowerCase() !== "4k")
          : caps.resolutions;
  const seedanceUsesExplicitAspectRatio = supportsSeedanceComposerAspectRatio(
    selectedModel.api_route,
    Boolean(startFrame || linkedStartFrameUrl),
  );
  const effectiveAspectRatios = sortAspectRatios(
    !seedanceUsesExplicitAspectRatio
      ? []
      : isLegacyGoogleVeo3Model && resolution?.toLowerCase() === "1080p"
      ? ["16:9"]
      : Array.isArray(caps.aspect_ratios)
        ? caps.aspect_ratios
        : caps.sizes.length > 0
          ? []
          : ["16:9", "9:16", "1:1", "4:3", "3:4"]
  );

  const maxPromptChars = useMemo(() => {
    if (typeof selectedModel?.capabilities?.max_prompt_characters === "number" && selectedModel.capabilities.max_prompt_characters > 0) {
      return selectedModel.capabilities.max_prompt_characters;
    }
    const route = (selectedModel?.api_route || "").toLowerCase();
    const family = (selectedModel?.family || "").toLowerCase();
    if (route.includes("vidu") || family.includes("vidu")) return 1500;
    if (route.includes("minimax") || route.includes("hailuo") || family.includes("minimax") || family.includes("hailuo")) return 2000;
    if (route.includes("luma") || route.includes("dream-machine") || family.includes("luma")) return 2000;
    if (route.includes("pixverse") || family.includes("pixverse")) return 2000;
    if (route.includes("hunyuan") || family.includes("hunyuan")) return 2000;
    if (route.includes("cogvideo") || family.includes("cogvideo")) return 2000;
    if (route.includes("kling") || family.includes("kling")) return 2500;
    if (route.includes("seedance") || route.includes("bytedance") || family.includes("seedance")) return 2500;
    if (route.includes("veo") || route.includes("google") || family.includes("google")) return 2500;
    if (route.includes("sora") || family.includes("sora") || family.includes("openai")) return 2500;
    if (route.includes("wan") || family.includes("wan") || family.includes("alibaba")) return 2500;
    return 2500;
  }, [selectedModel]);

  const remainingPromptChars = maxPromptChars - prompt.length;
  const isPromptOverLimit = remainingPromptChars < 0;

  useEffect(() => {
    if (!isGoogleVeoModel) return;

    if (aspectRatio !== "16:9" && aspectRatio !== "9:16") {
      setAspectRatio("16:9");
    }

    if (isVeo31LiteModel && resolution?.toLowerCase() === "4k") {
      setResolution("720p");
    } else if (isLegacyGoogleVeo3Model && resolution?.toLowerCase() === "1080p" && aspectRatio === "9:16") {
      setAspectRatio("16:9");
    } else if (resolutionChoices.length > 0 && (!resolution || !resolutionChoices.includes(resolution))) {
      setResolution(resolutionChoices[0]);
    }

    if (isVeo31FixedEightSecond && duration !== 8) {
      setDuration(8);
    } else if (durationChoices.length > 0 && (duration == null || !durationChoices.includes(duration))) {
      setDuration(selectedModel.api_route.startsWith("bytedance/seedance-2.5") && durationChoices.includes(5) ? 5 : durationChoices.includes(8) ? 8 : durationChoices[0]);
    }

    if (sound) setSound(false);
  }, [
    aspectRatio,
    caps.durations,
    duration,
    durationChoices,
    isVeo31FixedEightSecond,
    isGoogleVeoModel,
    isLegacyGoogleVeo3Model,
    isGoogleVeoExtensionInput,
    isVeo31LiteModel,
    resolution,
    resolutionChoices,
    sound,
  ]);

  // -- Model selection ---------------------------------------------------------

  const selectModel = useCallback((m: WaveSpeedVideoModel) => {
    setSelectedModel(m);
    setModelOpen(false);
    const c = m.capabilities;
    setDuration(getDefaultDurationForModel(m));
    setAspectRatio(getDefaultAspectRatioForModel(m));
    setSize(c.sizes[0] ?? null);
    setResolution(getDefaultResolutionForModel(m));
    setShotType("intelligent");
    setMultiPrompts([""]);
    setElementList([""]);
    setKlingEls([]);
    setKling30MultiEnabled(false);
    setKling30MultiMode("auto");
    setKling30CustomShots([{ prompt: "", duration: 5 }]);
    setCfgScale(0.5);
    setSound(false);
    setSceneControl(false);
    setOrientation("video");
    setOmniTab("elements");
    const refSuppressed =
      isKling30Route(m.api_route) ||
      m.api_route === "kwaivgi/kling-v3.0-std/image-to-video" ||
      m.api_route === "kwaivgi/kling-v3.0-pro/image-to-video";
    setInputMode(
      !refSuppressed &&
      ((c.max_reference_images || 0) > 0 || (c.max_reference_videos || 0) > 0 || (c.max_reference_audios || 0) > 0)
        ? "references"
        : "frames",
    );

    // Clear any stale error from a previous model
    setGenerationError(null);
  }, []);

  /**
   * Pulls a past generation back into the composer so it can be re-run or
   * tweaked: model, prompt, aspect ratio, duration, start/end frames and
   * reference media.
   *
   * Start and end frames are restored as URLs, which the submit path already
   * understands, so nothing is re-uploaded. Reference media is fetched back
   * into File objects instead, because the composer's previews, limit checks
   * and draft persistence all work on files — converting here keeps those
   * paths untouched rather than adding a parallel URL-based one.
   */
  const restoreGenerationIntoComposer = useCallback(async (item: MediaItem) => {
    const model = VIDEO_MODEL_REGISTRY.find((entry: WaveSpeedVideoModel) => entry.name === item.model);
    // selectModel resets the whole composer, so it has to run before anything
    // below it or the restored values would be wiped.
    if (model) selectModel(model);

    const caps = (model ?? selectedModel).capabilities;
    setPrompt(item.prompt || "");

    if (item.ratio && (caps.aspect_ratios.length === 0 || caps.aspect_ratios.includes(item.ratio))) {
      setAspectRatio(item.ratio);
    }
    const seconds = Math.round(Number.parseFloat(String(item.duration ?? "").replace(/[^0-9.]/g, "")));
    if (Number.isFinite(seconds) && seconds > 0 && (caps.durations.length === 0 || caps.durations.includes(seconds))) {
      setDuration(seconds);
    }

    setStartFrame(null);
    setEndFrame(null);
    setLinkedStartFrameUrl(item.startImageUrl ?? null);
    setStartFramePreview(item.startImageUrl ?? null);
    setLinkedEndFrameUrl(item.endImageUrl ?? null);
    setEndFramePreview(item.endImageUrl ?? null);

    const limits = getReferenceFileLimits(model ?? selectedModel);
    const imageUrls = (item.referenceImageUrls ?? []).slice(0, limits.images);
    const videoUrls = (item.referenceVideoUrls ?? []).slice(0, limits.videos);
    const restoredFiles: File[] = [];
    let failedCount = 0;
    for (const url of [...imageUrls, ...videoUrls]) {
      const file = await fetchUrlAsFile(url);
      if (file && isAllowedReferenceFile(file, model ?? selectedModel)) restoredFiles.push(file);
      else failedCount += 1;
    }
    setReferenceImages(restoredFiles);
    setReferenceVideoDurations([]);

    const hasFrames = Boolean(item.startImageUrl || item.endImageUrl);
    setInputMode(hasFrames && restoredFiles.length === 0 ? "frames" : "references");

    setGenerationError(
      failedCount > 0
        ? lang === "ar"
          ? `تعذّر استرجاع ${failedCount} من الوسائط المرجعية — أعد رفعها يدوياً.`
          : `${failedCount} reference file(s) could not be restored — re-upload them manually.`
        : null,
    );

    document.getElementById("video-prompt-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    requestAnimationFrame(() => document.getElementById("video-prompt-input")?.focus());
  }, [selectModel, selectedModel, lang]);

  useEffect(() => {
    if (activeTool === "lipsync") {
      if (!LIPSYNC_MODELS.some((m) => m.id === selectedModel.id)) {
        setSelectedModel(LIPSYNC_MODEL);
      }
      // Reset configurations to prevent state leakage from other tools
      setStartFrame(null);
      setLinkedStartFrameUrl(null);
      setEndFrame(null);
      setMotionVideo(null);
      setReferenceImages([]);
      setShotType("intelligent");
      setMultiPrompts([""]);
      setElementList([""]);
      setKlingEls([]);
      setKling30MultiEnabled(false);
      setKling30MultiMode("auto");
      setKling30CustomShots([{ prompt: "", duration: 5 }]);
      setCfgScale(0.5);
      setSound(false);
      setSceneControl(false);
      setOrientation("video");
      return;
    }
    const toolModelId = TOOL_DEFAULT_MODEL_ID[activeTool];
    if (!toolModelId) return;
    const targetModel = allModels.find((m) => m.id === toolModelId);
    if (!targetModel) return;
    selectModel(targetModel);

    if (activeTool === "kling-motion") {
      setSceneControl(true);
      setOrientation("video");
    }
  }, [activeTool, allModels, selectModel]);

  useEffect(() => {
    if (!isSoraModel) return;
    if (duration == null || ![4, 8, 12].includes(duration)) {
      setDuration(4);
    }
    if (resolution != null) {
      setResolution(null);
    }
  }, [isSoraModel, duration, resolution]);

  // -- Polling -----------------------------------------------------------------
  // Cleanup all active intervals on unmount
  useEffect(() => {
    return () => { pollRefs.current.forEach(id => clearInterval(id)); };
  }, []);

  // -- Media picker -----------------------------------------------------------

  const loadPickerAssets = useCallback(async (type: "image" | "video" | "audio") => {
    setPickerLoading(true);
    try {
      const res  = await fetchWithAuth(`/api/assets?type=${type}&validOnly=true&limit=60`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.assets)) {
        setPickerGallery(data.assets);
      } else {
        setPickerGallery([]);
      }
    } catch {
      setPickerGallery([]);
    } finally {
      setPickerLoading(false);
    }
  }, [fetchWithAuth]);

  const openMediaPicker = useCallback(async (target: PickerTarget) => {
    if (guardSeedanceMediaSelection(target)) return;
    setMediaPicker(target);
    setPickerGallery([]);
    if (target === "motionVideo") {
      setPickerTab("videos");
      await loadPickerAssets("video");
    } else if (target === "referenceImages") {
      // For Seedance 2: default to images gallery; user can switch to videos
      setPickerTab("images");
      await loadPickerAssets("image");
    } else {
      setPickerTab("images");
      await loadPickerAssets("image");
    }
  }, [guardSeedanceMediaSelection, loadPickerAssets]);

  const pickGalleryAsset = useCallback(async (url: string, target: PickerTarget, assetType?: string) => {
    setMediaPicker(null);
    try {
      const lowerUrl = url.toLowerCase();
      const isVideo = assetType === "video" || /\.(mp4|mov|webm|avi|mkv|m4v|flv|3gp)(?:\?|$)/i.test(lowerUrl);
      const isAudio = assetType === "audio" || /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|$)/i.test(lowerUrl);
      
      let fetchUrl = url;
      if (isVideo || isAudio) {
        // Resolve fallbacks for media to get a same-origin proxy or direct CORS-enabled URL.
        const fallbacks = getFallbackUrls(url);
        const proxyUrl = fallbacks.find((u) => u.startsWith("/api/media/"));
        fetchUrl = proxyUrl || fallbacks[0] || url;
      } else {
        // For images, route through proxy-image to avoid CORS
        fetchUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      }

      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`Fetch returned ${res.status}`);
      const blob = await res.blob();
      const ext  = (url.split(".").pop()?.split("?")[0] ?? "jpg").toLowerCase();
      const mime = blob.type || (isAudio ? "audio/mpeg" : isVideo ? "video/mp4" : "image/jpeg");
      const file = new File([blob], `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`, { type: mime });
      if (target === "startFrame" || target === "endFrame") selectFrameFile(target, file);
      else if (target === "motionVideo") setMotionVideo(file);
      else if (target === "referenceImages") {
        addReferenceFiles([file]);
      }
    } catch (err) {
      console.error("[pickGalleryAsset] Failed to load gallery asset:", err);
      // Fallback: show a user-visible toast or error here if needed
    }
  }, [addReferenceFiles, selectFrameFile]);

  const pickDeviceFiles = useCallback(async (target: PickerTarget): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const anyWindow = window as any;
    if (typeof anyWindow.showOpenFilePicker !== "function") return false;
    if (!window.isSecureContext) return false;
    if (guardSeedanceMediaSelection(target)) return true;

    const multiple = target === "referenceImages";
    const referenceLimits = getReferenceFileLimits(selectedModel);
    const supportsReferenceMedia = referenceLimits.videos > 0 || referenceLimits.audios > 0;

    const types =
      target === "motionVideo"
        ? [
            {
              description: "Video",
              accept: { "video/*": [".mp4", ".mov", ".webm", ".mkv", ".avi"] },
            },
          ]
        : target === "referenceImages" && supportsReferenceMedia
          ? [
              {
                description: "Images",
                accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"] },
              },
              {
                description: "Videos",
                accept: { "video/*": [".mp4", ".mov", ".webm", ".mkv", ".avi"] },
              },
              {
                description: "Audio",
                accept: { "audio/*": [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"] },
              },
            ]
          : [
              {
                description: "Images",
                accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"] },
              },
            ];

    try {
      const handles = (await anyWindow.showOpenFilePicker({
        multiple,
        types,
        startIn: "downloads",
      })) as Array<{ getFile: () => Promise<File> }>;

      const files = await Promise.all(handles.map((h) => h.getFile()));
      if (files.length === 0) return true;

      if (target === "startFrame" || target === "endFrame") selectFrameFile(target, files[0] ?? null);
      else if (target === "motionVideo") setMotionVideo(files[0] ?? null);
      else if (target === "referenceImages") {
        addReferenceFiles(files);
      }

      return true;
    } catch (e: any) {
      if (e?.name === "AbortError") return true;
      return false;
    }
  }, [addReferenceFiles, guardSeedanceMediaSelection, selectFrameFile, selectedModel]);

  // -- Generate -----------------------------------------------------------------

  const { guardGeneration, getSafeErrorMessage } = useGenerationGate();
  const { addAsset } = useAssetStore();

  const startPolling = useCallback((taskId: string, ctx: PendingTask) => {
    if (pollRefs.current.has(taskId) || completedTaskRefs.current.has(taskId)) {
      return;
    }

    const removePending = () => {
      setPendingTasks(prev => { const n = new Map(prev); n.delete(taskId); return n; });
      if (pollRefs.current.has(taskId)) { clearInterval(pollRefs.current.get(taskId)!); pollRefs.current.delete(taskId); }
      // Remove from persisted list as well
      try {
        const raw = localStorage.getItem("ff_video_pending_jobs");
        if (raw) {
          const arr = JSON.parse(raw) as any[];
          const next = (Array.isArray(arr) ? arr : []).filter((j) => j && j.taskId !== taskId);
          if (next.length) localStorage.setItem("ff_video_pending_jobs", JSON.stringify(next));
          else localStorage.removeItem("ff_video_pending_jobs");
        }
      } catch {}
    };

    const poll = async () => {
      try {
        const res = await fetchWithAuth(`/api/video?taskId=${encodeURIComponent(taskId)}`);
        let data: { taskId: string; status: "created" | "processing" | "completed" | "failed"; outputs: string[]; error: string | null; } | null = null;
        const cloned = res.clone();
        try { data = await res.json(); } catch {
          if (!res.ok) { const text = await cloned.text().catch(() => ""); setGenerationError(text || `Server error (${res.status})`); removePending(); }
          return;
        }
        if (!res.ok || !data) { setGenerationError(data?.error ?? "Generation check failed"); removePending(); return; }
        if (data.status === "completed" && data.outputs.length > 0) {
          if (completedTaskRefs.current.has(taskId)) {
            removePending();
            return;
          }
          completedTaskRefs.current.add(taskId);

          const videoUrl = normalizeBrowserMediaUrl(data.outputs[0]);
          const durableBaseUrl = process.env.NEXT_PUBLIC_B2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_B2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
          const isDurableUrl =
            !!videoUrl &&
            ((durableBaseUrl && videoUrl.startsWith(durableBaseUrl)) ||
              videoUrl.includes("supabase.co/storage/v1/object/public"));
          const newItem: MediaItem = {
            id: "gen-" + taskId, type: "video", src: videoUrl,
            posterStatus: "pending",
            model: ctx.model.name, modelColor: ctx.model.family_color,
            ratio: ctx.ratio, duration: ctx.duration != null ? `${ctx.duration}s` : "auto",
            prompt: ctx.promptText,
            providerRequestId: taskId,
            gradient: FAMILY_GRADIENTS[ctx.model.family] ?? "from-slate-900 via-slate-800 to-slate-900",
            createdAt: new Date(),
            startImageUrl: ctx.startImageUrl,
            endImageUrl: ctx.endImageUrl,
            referenceImageUrls: ctx.referenceImageUrls,
          };
          const alreadyKnownUrl = resultUrlsRef.current.has(videoUrl);
          setResults(prev => {
            const alreadyShown = prev.some((item) => item.id === newItem.id || item.src === videoUrl);
            if (alreadyShown) return prev;
            resultUrlsRef.current.add(videoUrl);
            return [newItem, ...prev];
          });
          if (!alreadyKnownUrl) {
            addAsset({ type: "video", url: videoUrl, prompt: ctx.promptText, model: ctx.model.name, duration: ctx.duration != null ? `${ctx.duration}s` : undefined, providerRequestId: taskId });
          }
          if (videoUrl && !isDurableUrl) {
            void fetchWithAuth("/api/assets/persist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mediaUrl: videoUrl, assetType: "video" }),
            })
              .then((persistRes) => persistRes.ok ? persistRes.json() : null)
              .then((persistJson) => {
                const durableUrl = normalizeBrowserMediaUrl(persistJson?.url);
                if (!durableUrl) return;
                setResults((prev) =>
                  prev.map((item) =>
                    item.id === newItem.id || item.providerRequestId === taskId
                      ? { ...item, src: durableUrl, poster: typeof persistJson?.posterUrl === "string" ? persistJson.posterUrl : item.poster, posterStatus: typeof persistJson?.posterStatus === "string" ? persistJson.posterStatus : item.posterStatus }
                      : item
                  )
                );
              })
              .then(() => loadPersistedVideos(0, "replace"))
              .catch(() => {});
          }
          removePending();
          setGenerationError(null);
        } else if (data.status === "failed") {
          setGenerationError(normalizeGenerationError(data.error));
          removePending();
          void loadPersistedVideos(0, "replace");
        }
      } catch { setGenerationError("Failed to check generation status"); removePending(); }
    };

    poll();
    const intervalId = setInterval(poll, 4000);
    pollRefs.current.set(taskId, intervalId);
  }, [addAsset, fetchWithAuth, loadPersistedVideos]);

  // Resume any in-flight video generations that were interrupted by a page refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ff_video_pending_jobs");
      if (!raw) return;
      const arr = JSON.parse(raw) as any[];
      if (!Array.isArray(arr) || arr.length === 0) { localStorage.removeItem("ff_video_pending_jobs"); return; }
      const NOW = Date.now();
      const fresh = arr.filter((j) => j && j.taskId && (NOW - (j.startedAt || 0)) < 30 * 60 * 1000);
      if (fresh.length === 0) { localStorage.removeItem("ff_video_pending_jobs"); return; }
      // Restore pending markers + restart polling
      setPendingTasks((prev) => {
        const next = new Map(prev);
        for (const j of fresh) {
          const model = allModels.find((m) => m.api_route === j.modelRoute) ?? allModels[0];
          if (!model) continue;
          next.set(j.taskId, { model, promptText: j.promptText || "", ratio: j.ratio || "16:9", duration: j.duration ?? null });
        }
        return next;
      });
      for (const j of fresh) {
        const model = allModels.find((m) => m.api_route === j.modelRoute);
        if (!model) continue;
        startPolling(j.taskId, { model, promptText: j.promptText || "", ratio: j.ratio || "16:9", duration: j.duration ?? null });
      }
      // Persist trimmed list (in case some were stale)
      if (fresh.length !== arr.length) {
        try { localStorage.setItem("ff_video_pending_jobs", JSON.stringify(fresh)); } catch {}
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSelectedSeedance2Route =
    selectedModel.api_route === "bytedance/dreamina-v3.0/text-to-video-720p" ||
    selectedModel.api_route === "bytedance/seedance-v2/text-to-video" ||
    selectedModel.api_route === "bytedance/seedance-v2/text-to-video-fast" ||
    selectedModel.api_route.startsWith("bytedance/seedance-2.0") ||
    selectedModel.api_route.startsWith("bytedance/seedance-2.5");

  const activeVideoModeLabel = getActiveVideoModeLabel(selectedModel, {
    hasStartFrame: Boolean(startFrame || linkedStartFrameUrl || selectedCharacter?.referenceUrls?.[0]),
    hasEndFrame: Boolean(endFrame || linkedEndFrameUrl),
    hasMotionVideo: Boolean(motionVideo),
    referenceImageCount: referenceImages.filter((file) => file.type.startsWith("image/")).length,
    isExtendMode: videoMode === "extend",
  });

  const estimatedCredits = (() => {
    if (activeTool === "lipsync") {
      return 17;
    }
    const isMotionControl = selectedModel.api_route === "kwaivgi/kling-v3.0-pro/motion-control";
    const pricingDuration = isMotionControl
      ? (motionVideoDuration ? Math.round(motionVideoDuration) : 5)
      : (isVeo31FixedEightSecond ? 8 : (duration ?? (selectedModel.api_route === "google/gemini-omni-flash" ? 5 : isGoogleVeoModel ? 8 : 5)));
    if ((selectedModel as any).pricingConfig) {
      try {
        const res = (resolution as any) || "720p";
        return computeCreditsFromDynamicModel(selectedModel as any, {
          resolution: res === "480p" || res === "720p" || res === "1080p" || res === "4k" ? res : "720p",
          outputSec: pricingDuration,
          isExtend: videoMode === "extend",
          sourceContextSec: videoMode === "extend" ? 5 : undefined,
          isTurbo: (selectedModel as any).badge === "TURBO" || (selectedModel as any).badge === "FAST",
        });
      } catch {}
    }

    if (selectedModel.api_route.startsWith("bytedance/seedance-2.5")) {
      const seedance25HasImage = Boolean(startFrame || linkedStartFrameUrl);
      const seedance25Route = resolveSeedance25Route(selectedModel.api_route, seedance25HasImage, resolution);
      return getVideoCreditsByRoute(seedance25Route, {
        duration: pricingDuration,
        resolution: resolution ?? "720p",
        generate_audio: sound,
        reference_video_urls: referenceImages.filter((file) => file.type.startsWith("video/")).map((_, index) => `video-${index}`),
      });
    }
    const hasMinimaxH3EstimateImage =
      Boolean(startFrame || linkedStartFrameUrl || endFrame || linkedEndFrameUrl || selectedCharacter?.referenceUrls?.[0]);
    const hasMinimaxH3EstimateReference =
      referenceImages.length > 0 || (selectedCharacter?.referenceUrls?.length ?? 0) > 0;
    const pricingRoute = resolveMinimaxH3Route(selectedModel.api_route, hasMinimaxH3EstimateImage, hasMinimaxH3EstimateReference);
    return getVideoCreditsByRoute(pricingRoute, {
      duration: pricingDuration,
      resolution: resolution ?? undefined,
      reference_video_durations: referenceVideoDurations,
    });
  })();

  const handleGenerate = useCallback(async () => {
    const hasMain = prompt.trim().length > 0;
    const hasMulti = multiPrompts.some((s) => s.trim().length > 0);
    const multiOn = caps.has_multi_prompt && (multiPrompts.length > 1 || multiPrompts[0] !== "");

    // Kling 3.0 detected early — its own validation runs inside the block below
    const isKling30VideoEarly = isKling30Route(selectedModel.api_route);
    const isKling30StdImageEarly =
      selectedModel.api_route === "kwaivgi/kling-v3.0-std/image-to-video" ||
      selectedModel.api_route === "kwaivgi/kling-v3.0-pro/image-to-video";
    // Skip the generic prompt guard for Kling 3.0 and Lipsync
    if (activeTool !== "lipsync" && !isKling30VideoEarly && !isKling30StdImageEarly && !caps.requires_video && !hasMain && !(multiOn && hasMulti)) return;

    if (isPromptOverLimit) {
      setGenerationError(
        lang === "ar"
          ? `نص الوصف يتجاوز الحد الأقصى المسموح به لهذا النموذج (${maxPromptChars} حرف). يرجى تقليصه بمقدار ${prompt.length - maxPromptChars} حرف.`
          : `Prompt exceeds the maximum allowed limit of ${maxPromptChars} characters for this model by ${prompt.length - maxPromptChars} characters.`
      );
      return;
    }

    if (videoMode === "generate") {
      const seedanceMediaConflict = getSeedanceComposerMediaConflict(selectedModel.api_route, {
        hasStartFrame: Boolean(startFrame || linkedStartFrameUrl),
        hasEndFrame: Boolean(endFrame || linkedEndFrameUrl),
        hasReferenceMedia: referenceImages.length > 0,
      });
      if (seedanceMediaConflict === "end_requires_start") {
        setGenerationError(
          lang === "ar"
            ? "يتطلب إطار النهاية إضافة إطار بداية أولاً في موديلات Seedance."
            : "Seedance requires a Start Frame before an End Frame can be used."
        );
        return;
      }
      if (seedanceMediaConflict === "frames_and_references_conflict") {
        setGenerationError(
          lang === "ar"
            ? "لا يمكن الجمع بين Start/End وقائمة References في طلب Seedance واحد. استخدم إطارات البداية والنهاية، أو احذفها واستخدم المراجع."
            : "Seedance cannot combine Start/End frames with Reference media in one request. Use Start/End, or remove them and use References."
        );
        return;
      }
    }

    const refVids = referenceImages.filter((f) => f.type.startsWith("video/"));
    let submitReferenceVideoDurations = referenceVideoDurations;
    const isMinimaxH3Submit =
      selectedModel.api_route.startsWith("minimax/h3") ||
      selectedModel.api_route.startsWith("wavespeed-ai/minimax-h3") ||
      selectedModel.api_route === "minimax-h3";
    if (isMinimaxH3Submit && refVids.length > 0 && submitReferenceVideoDurations.length !== refVids.length) {
      submitReferenceVideoDurations = (await Promise.all(refVids.map(readVideoDurationSeconds)))
        .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration) && duration > 0);
    }
    const requiredCredits = isMinimaxH3Submit
      ? getVideoCreditsByRoute(
          resolveMinimaxH3Route(selectedModel.api_route, Boolean(startFrame || linkedStartFrameUrl || endFrame || linkedEndFrameUrl || selectedCharacter?.referenceUrls?.[0]), referenceImages.length > 0 || (selectedCharacter?.referenceUrls?.length ?? 0) > 0),
          {
            duration: isVeo31FixedEightSecond ? 8 : (duration ?? (selectedModel.api_route === "google/gemini-omni-flash" ? 5 : isGoogleVeoModel ? 8 : 5)),
            resolution: resolution ?? undefined,
            reference_video_durations: submitReferenceVideoDurations,
          },
        )
      : estimatedCredits;

    const gate = await guardGeneration({ requiredCredits, action: `video:${selectedModel.api_route}` });
    if (!gate.ok) {
      if (gate.reason === "error") setGenerationError(gate.message ?? getSafeErrorMessage(gate.message));
      return;
    }

    // Validate video durations on client-side before starting submission
    if (motionVideo) {
      try {
        await validateVideoDuration(motionVideo, 3, 30);
      } catch (err) {
        setGenerationError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    for (const vid of refVids) {
      try {
        await validateVideoDuration(vid, 3, 30);
      } catch (err) {
        setGenerationError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    setIsSubmitting(true);
    setGenerationError(null);

    try {
      if (activeTool === "lipsync") {
        if (!startFrame && !linkedStartFrameUrl) {
          setGenerationError("Please upload an avatar image.");
          setIsSubmitting(false);
          return;
        }
        if (!lipsyncAudioFile) {
          setGenerationError("Please upload an audio file.");
          setIsSubmitting(false);
          return;
        }

        // 1. Upload Avatar Image to get public URL
        let imgUrl = "";
        if (startFrame) {
          const imgBase64 = await fileToDataURL(startFrame);
          const imgRes = await fetchWithAuth("/api/upload/frame", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: startFrame.name,
              mimeType: startFrame.type || "image/png",
              base64: imgBase64,
            }),
          });
          const imgData = await imgRes.json().catch(() => ({}));
          if (!imgRes.ok || !imgData.url) {
            throw new Error(imgData.error || "Failed to upload avatar image.");
          }
          imgUrl = imgData.url;
        } else if (linkedStartFrameUrl) {
          imgUrl = linkedStartFrameUrl;
        }

        // 2. Upload Audio File to get public URL
        const audioBase64 = await fileToDataURL(lipsyncAudioFile);
        const audioRes = await fetchWithAuth("/api/upload/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: lipsyncAudioFile.name,
            mimeType: lipsyncAudioFile.type || "audio/mpeg",
            base64: audioBase64,
          }),
        });
        const audioData = await audioRes.json().catch(() => ({}));
        if (!audioRes.ok || !audioData.url) {
          throw new Error(audioData.error || "Failed to upload audio file.");
        }
        const audioUrl = audioData.url;

        // 3. Submit lipsync task to /api/generate/audio
        const lipsyncKey = `lipsync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const lipsyncRes = await fetchWithAuth("/api/generate/audio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": lipsyncKey,
          },
          body: JSON.stringify({
            actionType: "lip-sync",
            model: selectedModel.api_route || "kling/ai-avatar-pro",
            imageUrl: imgUrl,
            audioUrl: audioUrl,
            prompt: prompt.trim() || "Natural lip sync performance",
          }),
        });

        const lipsyncJson = await lipsyncRes.json().catch(() => ({}));
        if (!lipsyncRes.ok || !lipsyncJson.videoUrl) {
          throw new Error(lipsyncJson.error || "Generation failed on server.");
        }

        let finalVideoUrl = normalizeBrowserMediaUrl(lipsyncJson.videoUrl);

        // 4. Persist to DB / durable storage
        const durableBaseUrl = process.env.NEXT_PUBLIC_B2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_B2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
        const isDurableUrl =
          !!finalVideoUrl &&
          ((durableBaseUrl && finalVideoUrl.startsWith(durableBaseUrl)) ||
            finalVideoUrl.includes("supabase.co/storage/v1/object/public"));
        
        if (finalVideoUrl && !isDurableUrl) {
          try {
            const persistRes = await fetchWithAuth("/api/assets/persist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mediaUrl: finalVideoUrl, assetType: "video" }),
            });
            if (persistRes.ok) {
              const persistJson = await persistRes.json();
              if (persistJson?.url) finalVideoUrl = normalizeBrowserMediaUrl(persistJson.url);
            }
          } catch (e) {
            console.error("Persist failed", e);
          }
        }

        const newResult: MediaItem = {
          id: "gen-" + (lipsyncJson.generationId || crypto.randomUUID()),
          type: "video",
          src: finalVideoUrl,
          model: selectedModel.name,
          modelColor: selectedModel.family_color,
          ratio: "9:16",
          duration: "auto",
          prompt: prompt.trim() || "Natural lip sync performance",
          gradient: FAMILY_GRADIENTS[selectedModel.family] ?? "from-cyan-900 via-cyan-800 to-slate-900",
          createdAt: new Date(),
        };

        setResults(prev => {
          const alreadyShown = prev.some((item) => item.id === newResult.id || item.src === finalVideoUrl);
          if (alreadyShown) return prev;
          return [newResult, ...prev];
        });

        addAsset({
          type: "video",
          url: finalVideoUrl,
          prompt: prompt.trim() || "Natural lip sync performance",
          model: selectedModel.name,
        });

        setIsSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {};
      const toolPrefix = TOOL_PROMPT_PREFIX[activeTool] ?? "";

      const filledMultiPrompts = multiPrompts.filter((s) => s.trim());
      const basePrompt = hasMain
        ? prompt.trim()
        : filledMultiPrompts.map((s) => s.trim()).join(" | ");
      const selectedCharacterTag = selectedCharacter ? normalizeCharacterTag(selectedCharacter.name) : "";
      const rawCharacterUrls = [
        ...(selectedCharacter?.referenceUrls ?? []),
        ...(selectedCharacter?.coverUrl ? [selectedCharacter.coverUrl] : []),
      ];
      const characterReferenceUrls = supportsCharacterReference
        ? Array.from(new Set(rawCharacterUrls))
            .map((url) => {
              if (!url || typeof url !== "string") return "";
              const trimmed = url.trim();
              if (/^https?:\/\//i.test(trimmed)) return trimmed;
              if (trimmed.startsWith("/")) {
                return `${typeof window !== "undefined" ? window.location.origin : "https://www.saadstudio.app"}${trimmed}`;
              }
              if (/^(images|videos|audio|thumbnails|media)\//i.test(trimmed)) {
                return `${typeof window !== "undefined" ? window.location.origin : "https://www.saadstudio.app"}/api/media/${trimmed.replace(/^\/+/, "")}`;
              }
              return trimmed;
            })
            .filter((url) => typeof url === "string" && /^https?:\/\//i.test(url))
        : [];
      const pkg = selectedCharacter?.metadata?.characterPackage;
      const characterPrompt = selectedCharacter && characterSupport.mode !== "kling_element"
        ? [
            `Use the selected Character Package: ${selectedCharacter.name}.`,
            pkg?.mainIdentity ? `Main Identity: ${pkg.mainIdentity}` : selectedCharacter.description,
            pkg?.faceMemory ? `Face Memory: ${pkg.faceMemory}` : "Preserve the same face, identity, proportions, and recognizable features.",
            pkg?.bodyProfile ? `Body Profile: ${pkg.bodyProfile}` : "",
            pkg?.outfitMemory ? `Outfit Memory: ${pkg.outfitMemory}` : "",
            pkg?.styleDna ? `Style DNA: ${pkg.styleDna}` : "",
            pkg?.motionReferences ? `Motion Rules: ${pkg.motionReferences}` : "",
            pkg?.states?.motion ? `Active State: ${pkg.states.motion}` : "",
            pkg?.consistencyProfile ? `Consistency Profile: ${pkg.consistencyProfile}` : "",
          ].filter(Boolean).join("\n")
        : "";
      const klingCharacterPrompt = selectedCharacter && characterSupport.mode === "kling_element" && selectedCharacterTag
        ? (basePrompt.includes(`@${selectedCharacterTag}`) ? basePrompt : `@${selectedCharacterTag} ${basePrompt}`.trim())
        : basePrompt;
      const promptedText = characterPrompt ? `${characterPrompt}\n\n${basePrompt}` : klingCharacterPrompt;
      // Inject Style/Effect/Camera/Sketch/Location/Element systemPromptAddon into the prompt
      // so the model actually applies the selected preset (thumbnails are just index cards).
      const promptedWithPresets = withPresetsAppended(promptedText, {
        selectedStyleId: selectedStyle,
        selectedEffectId,
        selectedCharacterId: selectedCharacterPresetId,
        selectedCameraId,
        selectedSketchId,
        selectedShotTypeId,
        selectedFilmStockId,
        selectedMovieLookId,
        selectedLightingId,
        selectedMotionBlurId,
        selectedGrainId,
        selectedHalationId,
        selectedTonalLookId,
        selectedLocationId,
        selectedElementId,
        selectedPalette,
      });
      payload.prompt = toolPrefix ? `${toolPrefix} ${promptedWithPresets}` : promptedWithPresets;

      const isSeedanceV25 = selectedModel.id.startsWith("bytedance-seedance-v25");
      const isSeedanceV2 = selectedModel.id.startsWith("bytedance-seedance-v2") || isSeedanceV25;
      const isMinimaxH3 =
        selectedModel.api_route === "minimax/h3/reference-to-video" ||
        selectedModel.api_route === "wavespeed-ai/minimax-h3/reference-to-video";
      const isKling30Video = isKling30Route(selectedModel.api_route);
      const isKlingElementModel = selectedModel.family === "kling" && caps.has_element_list;
      const isKling30StdImage =
        selectedModel.api_route === "kwaivgi/kling-v3.0-std/image-to-video" ||
        selectedModel.api_route === "kwaivgi/kling-v3.0-pro/image-to-video";

      // Image inputs — saved characters + uploaded reference media take priority
      if (selectedCharacter && characterSupport.mode === "kling_element" && characterReferenceUrls.length < characterSupport.minImages) {
        setGenerationError(`${selectedCharacter.name} needs at least ${characterSupport.minImages} reference images for Kling 3.0 Elements.`);
        setIsSubmitting(false);
        return;
      }

      if (isSeedanceV2 || isMinimaxH3) {
        const activeReferenceFiles = (videoMode === "extend" || !referenceModeActive) ? [] : referenceImages;
        const refImgs = activeReferenceFiles.filter((f) => f.type.startsWith("image/"));
        const refVids = activeReferenceFiles.filter((f) => f.type.startsWith("video/"));
        const refAuds = activeReferenceFiles.filter((f) => f.type.startsWith("audio/"));
        const hasStartImage =
          frameModeActive &&
          (!!startFrame ||
            (characterSupport.mode === "image_reference" &&
              !!characterReferenceUrls[0]));
        const hasEndImage = frameModeActive && !!endFrame;
        const imageCount =
          refImgs.length +
          characterReferenceUrls.length +
          (hasStartImage ? 1 : 0) +
          (hasEndImage ? 1 : 0);
        const videoCount =
          refVids.length + (caps.requires_video && !!motionVideo ? 1 : 0);
        const audioCount = refAuds.length;

        if (isMinimaxH3 && audioCount > 0 && imageCount === 0 && videoCount === 0) {
          setGenerationError(
            "Minimax H3 does not support audio-only references. Add at least one reference image or video with the audio."
          );
          setIsSubmitting(false);
          return;
        }
      }

      if (characterSupport.mode === "provider_character_id" && selectedCharacter?.providerCharacterId) {
        payload.character_id_list = [selectedCharacter.providerCharacterId];
      }

      // 1. Explicit Start Frame (from Start frame box)
      // In references mode the frame boxes are hidden, so their values must not
      // reach the request — the provider resolves a different endpoint for each.
      let explicitStartUrl: string | null = null;
      if (!frameModeActive) {
        explicitStartUrl = null;
      } else if (startFrame) {
        try {
          explicitStartUrl = await uploadVideoRequestFile(startFrame, fetchWithAuth);
        } catch {
          explicitStartUrl = await fileToDataURL(startFrame);
        }
      } else if (linkedStartFrameUrl) {
        explicitStartUrl = linkedStartFrameUrl;
      } else if (characterSupport.mode === "image_reference" && characterReferenceUrls[0] && caps.requires_image) {
        explicitStartUrl = characterReferenceUrls[0];
      }

      if (explicitStartUrl) {
        payload.image = explicitStartUrl;
        payload.first_frame_url = explicitStartUrl;
      }

      // 2. Explicit End Frame (from End frame box)
      let explicitEndUrl: string | null = null;
      if (frameModeActive && caps.has_end_frame && (endFrame || linkedEndFrameUrl)) {
        if (endFrame) {
          try {
            explicitEndUrl = await uploadVideoRequestFile(endFrame, fetchWithAuth);
          } catch {
            explicitEndUrl = await fileToDataURL(endFrame);
          }
        } else if (linkedEndFrameUrl) {
          explicitEndUrl = linkedEndFrameUrl;
        }
      }

      if (explicitEndUrl) {
        payload.last_image = explicitEndUrl;
        payload.end_image = explicitEndUrl;
        payload.last_frame_url = explicitEndUrl;
      }

      // 3. Multimodal References (from Add references panel)
      const activeReferenceFiles = (videoMode === "extend" || !referenceModeActive) ? [] : referenceImages;
      const refImgs = activeReferenceFiles.filter((f) => f.type.startsWith("image/"));
      const refVids = activeReferenceFiles.filter((f) => f.type.startsWith("video/"));
      const refAuds = activeReferenceFiles.filter((f) => f.type.startsWith("audio/"));

      const maxRefImgs = Math.max(1, caps.max_reference_images || 9);
      const uploadedRefImgs = await Promise.all(
        refImgs.slice(0, maxRefImgs).map(async (f) => {
          try { return await uploadVideoRequestFile(f, fetchWithAuth); } catch { return await fileToDataURL(f); }
        })
      );

      const allRefImgs = [
        ...(characterSupport.mode === "image_reference" && !explicitStartUrl ? characterReferenceUrls : []),
        ...uploadedRefImgs,
      ].slice(0, maxRefImgs);

      const keepSeedanceTextReferences =
        selectedModel.api_route.startsWith("bytedance/seedance-") &&
        selectedModel.api_route.includes("/text-to-video") &&
        caps.max_reference_images > 0;
      const keepProviderReferenceMedia = keepSeedanceTextReferences || isMinimaxH3Submit;

      // If user uploaded 1 or 2 images and did not explicitly use separate start/end boxes:
      // Image 1 is Start Frame, and Image 2 is End Frame!
      // Seedance and Minimax H3 text/reference generation keep these as reference_images;
      // only the dedicated Start Frame box should switch it to image-to-video.
      if (!showInputModeTabs && !keepProviderReferenceMedia && !explicitStartUrl && allRefImgs.length >= 1 && refVids.length === 0 && refAuds.length === 0) {
        explicitStartUrl = allRefImgs[0];
        payload.image = explicitStartUrl;
        payload.first_frame_url = explicitStartUrl;
      }
      if (!showInputModeTabs && !keepProviderReferenceMedia && !explicitEndUrl && allRefImgs.length >= 2 && refVids.length === 0 && refAuds.length === 0) {
        explicitEndUrl = allRefImgs[1];
        payload.last_image = explicitEndUrl;
        payload.end_image = explicitEndUrl;
        payload.last_frame_url = explicitEndUrl;
      }

      if (allRefImgs.length > 0) {
        payload.reference_image_urls = allRefImgs;
      }

      if (refVids.length > 0) {
        const maxVids = Math.max(0, caps.max_reference_videos || 3);
        payload.reference_video_urls = await Promise.all(
          refVids.slice(0, maxVids).map((f) => uploadVideoRequestFile(f, fetchWithAuth))
        );
        if (isMinimaxH3Submit && submitReferenceVideoDurations.length > 0) {
          payload.reference_video_durations = submitReferenceVideoDurations.slice(0, maxVids);
        }
      }

      if (refAuds.length > 0) {
        const maxAuds = Math.max(0, caps.max_reference_audios || 3);
        payload.reference_audio_urls = await Promise.all(
          refAuds.slice(0, maxAuds).map((f) => uploadVideoRequestFile(f, fetchWithAuth))
        );
      }

      // 4. Motion Video (when applicable)
      if ((videoMode === "extend" || caps.requires_video || caps.optional_video) && motionVideo) {
        payload.video = await uploadVideoRequestFile(motionVideo, fetchWithAuth);
      }

      if (isVeo31Model) {
        const refs = Array.isArray(payload.reference_image_urls)
          ? payload.reference_image_urls.filter((value): value is string => typeof value === "string")
          : [];
        const hasStartImage = typeof payload.image === "string" || typeof payload.first_frame_url === "string";
        const hasEndImage = typeof payload.end_image === "string" || typeof payload.last_frame_url === "string" || typeof payload.last_image === "string";
        payload.enable_translation = true;
        payload.generation_type = refs.length > 0 && isVeo31FastModel
          ? "REFERENCE_2_VIDEO"
          : refs.length > 0 || hasStartImage || hasEndImage
            ? "FIRST_AND_LAST_FRAMES_2_VIDEO"
            : "TEXT_2_VIDEO";
      }
      payload.video_mode_label = activeVideoModeLabel;
      if (videoMode === "extend") {
        payload.google_video_mode = "Video Extend";
        payload.video_task = "extend";
      }

      // Size / Aspect ratio
      if (caps.sizes.length > 0 && size) {
        payload.size = size;
      }
      if (seedanceUsesExplicitAspectRatio && caps.aspect_ratios.length > 0 && aspectRatio) {
        payload.aspect_ratio = aspectRatio;
      }

      // Duration
      if (durationChoices.length > 0 && duration != null) {
        payload.duration = isVeo31FixedEightSecond ? 8 : duration;
      }
      const isMotionControl = selectedModel.api_route === "kwaivgi/kling-v3.0-pro/motion-control";
      if (isMotionControl) {
        payload.duration = motionVideoDuration ? Math.round(motionVideoDuration) : 5;
      }

      // Quality / Resolution
      if (resolutionChoices.length > 0 && resolution) {
        payload[caps.quality_param] = resolution;
      }

      // Prompt controls
      if (caps.has_negative_prompt && negPrompt.trim()) {
        payload.negative_prompt = negPrompt.trim();
      }
      if (caps.has_loop && loop) {
        payload.loop = true;
        payload.ping_pong = true;
      }
      if (caps.has_cfg_scale) {
        payload.cfg_scale = cfgScale;
      }
      if (caps.has_sound) {
        payload[caps.sound_param] = sound;
      }
      if (caps.has_multi_prompt) {
        const filled = multiPrompts
          .map((text, index) => ({ text: text.trim(), index }))
          .filter((item) => item.text.length > 0);
        if (filled.length > 0 && (multiOn || !caps.has_omni_tabs)) {
          if (duration != null && filled.length > duration) {
            setGenerationError(`For ${duration}s duration, maximum shots is ${duration}.`);
            setIsSubmitting(false);
            return;
          }
          const splitDurations = duration != null ? splitShotDurations(duration, filled.length) : [];
          if (duration != null && splitDurations.length !== filled.length) {
            setGenerationError("Invalid multi-shot split. Reduce shot count or increase duration.");
            setIsSubmitting(false);
            return;
          }
          // Validate each shot prompt length (API limit: 500 chars per shot)
          for (const item of filled) {
            if (item.text.length > 500) {
              setGenerationError(`Shot ${item.index + 1} prompt is too long (${item.text.length}/500 chars). Please shorten it.`);
              setIsSubmitting(false);
              return;
            }
          }
          payload.multi_prompt = filled.map((item, idx) => ({
            prompt: item.text,   // shot prompts are pure scene descriptions — no toolPrefix
            ...(duration != null ? { duration: splitDurations[idx] } : {}),
          }));
          if (caps.has_shot_type) {
            payload.shot_type = shotType;
          }
        }
      }
      if (caps.has_element_list) {
        // Reference images are passed as image_urls — element_list is for text IDs only
        const filled = elementList.filter(s => s.trim());
        if (filled.length > 0) {
          payload.element_list = filled.map(id => ({ id: id.trim() }));
        }
      }
      if (caps.has_scene_control) {
        payload.scene_control_mode = sceneControl;
      }
      if (caps.has_orientation) {
        payload.orientation = orientation;
      }

      if (isKlingElementModel) {
        // ── Kling 3.0 — fully spec-compliant payload builder ─────────────────
        const resolvedDuration = duration ?? 9;

        // Validate duration
        if (resolvedDuration < 3 || resolvedDuration > 15) {
          setGenerationError("Kling 3.0 duration must be between 3 and 15 seconds.");
          setIsSubmitting(false);
          return;
        }

        // Validate elements: each element needs 2+ images
        const invalidEl = klingEls.find(el => el.name.trim() && el.files.length < 2);
        if (invalidEl) {
          setGenerationError(`Element "${invalidEl.name}" needs at least 2 images.`);
          setIsSubmitting(false);
          return;
        }

        // Validate custom shots total duration
        if (kling30MultiEnabled && kling30MultiMode === "custom") {
          const activeCustom = kling30CustomShots.filter(s => s.prompt.trim());
          if (!activeCustom.length) {
            setGenerationError("Add at least one shot prompt in custom mode.");
            setIsSubmitting(false);
            return;
          }
          if (!kling30CustomDurationValid) {
            setGenerationError(
              `Shot durations must total exactly ${resolvedDuration}s (currently ${kling30CustomTotalDuration}s).`
            );
            setIsSubmitting(false);
            return;
          }
          if (activeCustom.length > 5) {
            setGenerationError("Maximum 5 shots allowed.");
            setIsSubmitting(false);
            return;
          }
        }

        // Validate single-shot prompt
        if (!kling30MultiEnabled && !hasMain) {
          setGenerationError("Kling 3.0 single-shot requires a prompt.");
          setIsSubmitting(false);
          return;
        }

        // Resolution → mode: "std" | "pro" | "4K"
        const normalizedResolution = resolution?.trim().toLowerCase();
        const modeValue =
          normalizedResolution === "4k"
            ? "4K"
            : normalizedResolution === "pro" || normalizedResolution === "1080p"
              ? "pro"
              : "std";

        // ── image_urls: read DIRECTLY from React state (authoritative source) ──
        // payload.image / payload.end_image are set by the generic block above,
        // but we re-read from state to guarantee no silent data loss.
        const imageUrls: string[] = [];
        const targetKlingRatio = aspectRatio ?? "16:9";
        const refImageFiles = referenceImages.filter(f => f.type.startsWith("image/"));
        const firstFrameDataUrl = startFrame
          ? await fileToAspectDataURL(startFrame, targetKlingRatio)
          : linkedStartFrameUrl
            ? await imageSourceToAspectDataURL(linkedStartFrameUrl, targetKlingRatio)
            : refImageFiles[0]
              ? await fileToAspectDataURL(refImageFiles[0], targetKlingRatio)
              : null;
        const lastFrameDataUrl =
          !kling30MultiEnabled && endFrame
            ? await fileToAspectDataURL(endFrame, targetKlingRatio)
            : !kling30MultiEnabled && linkedEndFrameUrl
              ? await imageSourceToAspectDataURL(linkedEndFrameUrl, targetKlingRatio)
              : !kling30MultiEnabled && refImageFiles.length >= 2
                ? await fileToAspectDataURL(refImageFiles[1], targetKlingRatio)
                : null;
        if (firstFrameDataUrl) imageUrls.push(firstFrameDataUrl);
        if (lastFrameDataUrl) imageUrls.push(lastFrameDataUrl);
        // Log so we can verify images are included
        console.log(
          `[Kling 3.0] image_urls built: targetRatio=${targetKlingRatio}, start=${firstFrameDataUrl ? "✓ (" + firstFrameDataUrl.slice(0, 40) + "…)" : "✗ none"}, end=${lastFrameDataUrl ? "✓" : kling30MultiEnabled ? "skipped (multi-shot)" : "✗ none"}`
        );

        // ── kling_elements ───────────────────────────────────────────────────
        delete payload.element_list;
        delete payload.reference_image_urls;
        const validKlingEls = klingEls
          .slice(0, 3)
          .filter((el) => el.name.trim() && el.description.trim() && el.files.length >= 2);
        const selectedCharacterElement = selectedCharacter && characterSupport.mode === "kling_element"
          ? {
              name: selectedCharacterTag,
              description: selectedCharacter.description?.trim() || selectedCharacter.name,
              element_input_urls: characterReferenceUrls.slice(0, characterSupport.maxImages),
            }
          : null;

        // ── multi_prompt: build from auto or custom mode ─────────────────────
        let multiPromptList: Array<{ prompt: string; duration: number }> = [];
        if (kling30MultiEnabled) {
          if (kling30MultiMode === "auto") {
            const shotCount = Math.min(5, Math.max(1, Math.floor(resolvedDuration / 3)));
            const splitD = splitShotDurations(resolvedDuration, shotCount);
            const baseP = promptedText.trim() || "Continue the scene";
            multiPromptList = Array.from({ length: shotCount }, (_, i) => ({
              prompt: baseP,
              duration: splitD[i] ?? 3,
            }));
          } else {
            multiPromptList = kling30CustomShots
              .filter(s => s.prompt.trim())
              .slice(0, 5)
              .map(s => {
                const shotPrompt = s.prompt.trim();
                const withCharacter = selectedCharacterTag && characterSupport.mode === "kling_element" && !shotPrompt.includes(`@${selectedCharacterTag}`)
                  ? `@${selectedCharacterTag} ${shotPrompt}`
                  : shotPrompt;
                return { prompt: withCharacter, duration: s.duration };
              });
          }
        }

        // ── Build final payload ──────────────────────────────────────────────
        // Remove all generic keys — Kling 3.0 uses its own field names
        delete payload.image; delete payload.first_frame_url;
        delete payload.end_image; delete payload.last_frame_url;
        delete payload.multi_prompt; delete payload.element_list;

        payload.image_urls = imageUrls;
        payload.multi_shots = kling30MultiEnabled;
        payload.multi_prompt = multiPromptList;
        payload.mode = modeValue;
        payload.sound = !!sound;
        payload.duration = resolvedDuration;
        payload.aspect_ratio = targetKlingRatio;
        const rawKlingPrompt = toolPrefix ? `${toolPrefix} ${promptedWithPresets.trim()}` : promptedWithPresets.trim();
        payload.prompt = kling30MultiEnabled ? "" : compactKlingSingleShotPrompt(rawKlingPrompt);

        if (validKlingEls.length > 0 || selectedCharacterElement) {
          const manualElements = await Promise.all(
            validKlingEls.slice(0, selectedCharacterElement ? 2 : 3).map(async (el) => ({
              name: el.name.trim(),
              description: el.description.trim(),
              element_input_urls: await Promise.all(el.files.slice(0, 4).map((f) => fileToDataURL(f))),
            }))
          );
          payload.kling_elements = selectedCharacterElement
            ? [selectedCharacterElement, ...manualElements]
            : manualElements;
        } else {
          delete payload.kling_elements;
        }

        // ── PAYLOAD VERIFICATION LOG ─────────────────────────────────────────
        // Logs a compact diagnostic payload (data URLs truncated to 60 chars)
        const debugPayload = {
          modelRoute: selectedModel.api_route,
          model: "kling-3.0/video",
          target_frame_ratio: targetKlingRatio,
          prompt: payload.prompt,
          mode: payload.mode,
          duration: payload.duration,
          aspect_ratio: payload.aspect_ratio,
          multi_shots: payload.multi_shots,
          sound: payload.sound,
          image_urls: (payload.image_urls as string[]).map(
            (u, i) => `[frame_${i}] ${u.slice(0, 60)}…`
          ),
          multi_prompt: payload.multi_prompt,
          kling_elements: Array.isArray(payload.kling_elements)
            ? (payload.kling_elements as Array<{name:string;description:string;element_input_urls:string[]}>).map(el => ({
                name: el.name,
                description: el.description,
                images: el.element_input_urls.map((u,i)=>`[el_img_${i}] ${u.slice(0,60)}…`),
              }))
            : [],
        };
        console.log("[Kling 3.0] ✅ Final payload (before send):", JSON.stringify(debugPayload, null, 2));
      }

      const payloadHasImageInput = Boolean(
        (typeof payload.image === "string" && payload.image.trim()) ||
        (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim()) ||
        (typeof payload.image_url === "string" && payload.image_url.trim()) ||
        (typeof payload.last_image === "string" && payload.last_image.trim()) ||
        (typeof payload.last_frame_url === "string" && payload.last_frame_url.trim()) ||
        (typeof payload.end_image === "string" && payload.end_image.trim()) ||
        (Array.isArray(payload.image_urls) && payload.image_urls.some((value) => typeof value === "string" && value.trim()))
      );
      let requestModelRoute = selectedModel.api_route;
      if (videoMode === "extend") {
        requestModelRoute = (selectedModel as any).video_api_route || selectedModel.api_route;
      } else if (requestModelRoute.startsWith("bytedance/seedance-2.5")) {
        requestModelRoute = resolveSeedance25Route(requestModelRoute, payloadHasImageInput, resolution);
      } else if (requestModelRoute.startsWith("alibaba/wan-3.0")) {
        const payloadHasWanReferenceInput = (
          Array.isArray(payload.reference_image_urls) &&
          payload.reference_image_urls.some((value) => typeof value === "string" && value.trim())
        ) || (
          Array.isArray(payload.reference_video_urls) &&
          payload.reference_video_urls.some((value) => typeof value === "string" && value.trim())
        ) || (
          Array.isArray(payload.reference_audio_urls) &&
          payload.reference_audio_urls.some((value) => typeof value === "string" && value.trim())
        );
        requestModelRoute = resolveWan30Route(requestModelRoute, payloadHasImageInput, payloadHasWanReferenceInput);
      } else if (requestModelRoute.startsWith("black-forest-labs/flux-3") || requestModelRoute === "black-forest-labs-flux-3-video") {
        const payloadHasVideoInput = Boolean(
          (typeof payload.video === "string" && payload.video.trim()) ||
          (Array.isArray(payload.reference_video_urls) && payload.reference_video_urls.some((value) => typeof value === "string" && value.trim()))
        );
        const payloadHasStartEndInput = Boolean(
          ((typeof payload.start_image === "string" && payload.start_image.trim()) || (Array.isArray(payload.image_urls) && payload.image_urls[0])) &&
          ((typeof payload.end_image === "string" && payload.end_image.trim()) || (typeof payload.last_image === "string" && payload.last_image.trim()) || (Array.isArray(payload.image_urls) && payload.image_urls[1]))
        );
        requestModelRoute = resolveFlux3Route(requestModelRoute, payloadHasImageInput, payloadHasStartEndInput, payloadHasVideoInput);
      } else if (requestModelRoute.startsWith("minimax/h3") || requestModelRoute.startsWith("wavespeed-ai/minimax-h3") || requestModelRoute === "minimax-h3") {
        const payloadHasH3ReferenceInput = Boolean(
          (Array.isArray(payload.reference_image_urls) && payload.reference_image_urls.some((value) => typeof value === "string" && value.trim())) ||
          (Array.isArray(payload.reference_video_urls) && payload.reference_video_urls.some((value) => typeof value === "string" && value.trim())) ||
          (Array.isArray(payload.reference_audio_urls) && payload.reference_audio_urls.some((value) => typeof value === "string" && value.trim()))
        );
        requestModelRoute = resolveMinimaxH3Route(requestModelRoute, payloadHasImageInput, payloadHasH3ReferenceInput);
      } else if (requestModelRoute.includes("seedance")) {
        const hasDirectStart = Boolean(
          (typeof payload.image === "string" && payload.image.trim()) ||
          (typeof payload.first_frame_url === "string" && payload.first_frame_url.trim()) ||
          (typeof payload.image_url === "string" && payload.image_url.trim())
        );
        const isTurbo = requestModelRoute.includes("turbo");
        const isSpicy = requestModelRoute.includes("spicy");
        const isExtend = requestModelRoute.includes("extend");
        const isEdit = requestModelRoute.includes("edit");

        if (requestModelRoute.includes("mini")) {
          if (isTurbo) {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0-mini/image-to-video-turbo" : "bytedance/seedance-2.0-mini/text-to-video-turbo";
          } else if (isSpicy) {
            requestModelRoute = "bytedance/seedance-2.0-mini/image-to-video-spicy";
          } else if (isExtend) {
            requestModelRoute = "bytedance/seedance-2.0-mini/video-extend";
          } else if (isEdit) {
            requestModelRoute = isTurbo ? "bytedance/seedance-2.0-mini/video-edit-turbo" : "bytedance/seedance-2.0-mini/video-edit";
          } else {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0-mini/image-to-video" : "bytedance/seedance-2.0-mini/text-to-video";
          }
        } else if (requestModelRoute.includes("fast")) {
          if (isTurbo) {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0-fast/image-to-video-turbo" : "bytedance/seedance-2.0-fast/text-to-video-turbo";
          } else if (isSpicy) {
            requestModelRoute = "bytedance/seedance-2.0-fast/image-to-video-spicy";
          } else if (isExtend) {
            requestModelRoute = "bytedance/seedance-2.0-fast/video-extend";
          } else if (isEdit) {
            requestModelRoute = isTurbo ? "bytedance/seedance-2.0-fast/video-edit-turbo" : "bytedance/seedance-2.0-fast/video-edit";
          } else {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0-fast/image-to-video" : "bytedance/seedance-2.0-fast/text-to-video";
          }
        } else {
          if (isTurbo) {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0/image-to-video-turbo" : "bytedance/seedance-2.0/text-to-video-turbo";
          } else if (isSpicy) {
            requestModelRoute = "bytedance/seedance-2.0/image-to-video-spicy";
          } else if (isExtend) {
            requestModelRoute = "bytedance/seedance-2.0/video-extend";
          } else if (isEdit) {
            requestModelRoute = isTurbo ? "bytedance/seedance-2.0/video-edit-turbo" : "bytedance/seedance-2.0/video-edit";
          } else {
            requestModelRoute = hasDirectStart ? "bytedance/seedance-2.0/image-to-video" : "bytedance/seedance-2.0/text-to-video";
          }
        }
      } else if (isKling30Route(requestModelRoute)) {
        const normalizedKlingQuality = typeof payload.mode === "string"
          ? payload.mode.toLowerCase()
          : typeof payload.resolution === "string"
            ? payload.resolution.toLowerCase()
            : typeof payload.quality === "string"
              ? payload.quality.toLowerCase()
              : "std";
        const wantsKlingPro = normalizedKlingQuality === "pro" || normalizedKlingQuality === "1080p";
        requestModelRoute = payloadHasImageInput
          ? (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/image-to-video" : "kwaivgi/kling-v3.0-std/image-to-video")
          : (wantsKlingPro ? "kwaivgi/kling-v3.0-pro/text-to-video" : "kwaivgi/kling-v3.0-std/text-to-video");
      }
      if (
        isKling30Route(requestModelRoute) ||
        requestModelRoute === "bytedance/seedance-v2/text-to-video" ||
        requestModelRoute === "bytedance/seedance-v2/text-to-video-fast" ||
        requestModelRoute.startsWith("bytedance/seedance-2.0")
      ) {
        console.log("[video POST] modelRoute sent:", requestModelRoute);
      }

      const idempotencyKey = `video-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const activeProfileId = typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : null;
      const res = await fetchWithAuth("/api/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...(activeProfileId ? { "x-profile-id": activeProfileId } : {}),
        },
        body: JSON.stringify({ modelRoute: requestModelRoute, payload, profileId: activeProfileId }),
      });

      let data: { taskId?: string; error?: string; publicError?: string } = {};
      const clonedRes = res.clone();
      try {
        data = await res.json();
      } catch {
        const text = await clonedRes.text().catch(() => "");
        const preview = text.slice(0, 200);
        console.error("[video POST] non-JSON response", res.status, preview);
        setGenerationError(getSafeErrorMessage(preview || `Server error (${res.status})`));
        setIsSubmitting(false);
        return;
      }

      if (!res.ok || !data.taskId) {
        console.error("[video POST] failed", {
          status: res.status,
          modelRoute: requestModelRoute,
          response: data,
        });
        setGenerationError(getSafeErrorMessage(data.publicError ?? data.error ?? "Failed to start generation"));
        setIsSubmitting(false);
        return;
      }

      // Update local credits display in header instantly
      if (typeof window !== "undefined" && gate.currentBalance != null) {
        const newBalance = Math.max(0, gate.currentBalance - estimatedCredits);
        window.dispatchEvent(new CustomEvent("saad-credits-updated", { detail: { balance: newBalance } }));
      }

      // Show the ratio the user explicitly requested. Kling frames are normalized
      // to this ratio before submit, so the pending/result card should match it.
      const isKling30 = isKling30Route(selectedModel.api_route);
      const _capturedRatio = isKling30
        ? (aspectRatio ?? "16:9")
        : (aspectRatio ?? (size ? sizeToRatio(size) : "16:9"));
      // Veo 3.1 accepts 4/6/8 — honor the user's choice (fallback to 8).
      const capturedDuration = isGoogleVeoModel ? (isVeo31FixedEightSecond ? 8 : (duration ?? (selectedModel.api_route === "google/gemini-omni-flash" ? 5 : 8))) : duration;
      persistVideoEditContext(data.taskId, {
        modelRoute: requestModelRoute,
        modelName: selectedModel.name,
        duration: capturedDuration,
        aspectRatio: _capturedRatio,
        quality: resolution,
        referenceImageUrls: Array.isArray(payload.reference_image_urls)
          ? payload.reference_image_urls.filter((value): value is string => typeof value === "string").slice(0, 3)
          : [],
        startImageUrl: typeof payload.image === "string"
          ? payload.image
          : typeof payload.first_frame_url === "string"
            ? payload.first_frame_url
            : undefined,
        endImageUrl: typeof payload.end_image === "string"
          ? payload.end_image
          : typeof payload.last_frame_url === "string"
            ? payload.last_frame_url
            : typeof payload.last_image === "string"
              ? payload.last_image
              : undefined,
      });
      const capturedStartImageUrl = typeof payload.image === "string"
        ? payload.image
        : typeof payload.first_frame_url === "string"
          ? payload.first_frame_url
          : undefined;
      const capturedEndImageUrl = typeof payload.end_image === "string"
        ? payload.end_image
        : typeof payload.last_frame_url === "string"
          ? payload.last_frame_url
          : typeof payload.last_image === "string"
            ? payload.last_image
            : undefined;
      const capturedReferenceImageUrls = Array.isArray(payload.reference_image_urls)
        ? payload.reference_image_urls.filter((value): value is string => typeof value === "string").slice(0, 9)
        : [];

      const pendingTaskInfo: PendingTask = {
        model: selectedModel,
        promptText: basePrompt,
        ratio: _capturedRatio,
        duration: capturedDuration,
        startImageUrl: capturedStartImageUrl,
        endImageUrl: capturedEndImageUrl,
        referenceImageUrls: capturedReferenceImageUrls,
      };

      setPendingTasks(prev => new Map(prev).set(data.taskId!, pendingTaskInfo));
      // Persist task so it survives a page refresh
      try {
        const raw = localStorage.getItem("ff_video_pending_jobs");
        const arr = raw ? (JSON.parse(raw) as any[]) : [];
        const list = Array.isArray(arr) ? arr : [];
        list.push({ taskId: data.taskId, modelRoute: selectedModel.api_route, promptText: basePrompt, ratio: _capturedRatio, duration: capturedDuration, startedAt: Date.now() });
        localStorage.setItem("ff_video_pending_jobs", JSON.stringify(list));
      } catch {}
      setIsSubmitting(false);
      startPolling(data.taskId, pendingTaskInfo);
    } catch (err) {
      setGenerationError(getSafeErrorMessage(err));
      setIsSubmitting(false);
    }
  }, [
    activeTool, videoMode, prompt, selectedModel, selectedCharacter, caps, supportsCharacterReference, characterSupport, isWan30Model, isVeo31Model, isGoogleVeoModel, isVeo31FastModel, isVeo31FixedEightSecond,
    startFrame, linkedStartFrameUrl, endFrame, linkedEndFrameUrl, motionVideo, referenceImages, size, aspectRatio, startFrameRatio, duration, resolution,
    negPrompt, cfgScale, sound, shotType, multiPrompts, elementList,
    sceneControl, orientation, selectedCharacterPresetId, selectedStyle, selectedEffectId, selectedCameraId, selectedSketchId, selectedShotTypeId, selectedFilmStockId, selectedMovieLookId, selectedLightingId, selectedMotionBlurId, selectedGrainId, selectedHalationId, selectedTonalLookId, selectedLocationId, selectedElementId, selectedPalette, startPolling,
    klingEls, kling30MultiEnabled, kling30MultiMode, kling30CustomShots,
    estimatedCredits, activeVideoModeLabel, seedanceUsesExplicitAspectRatio, fetchWithAuth, getSafeErrorMessage, guardGeneration,
  ]);

  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  const bStyle = selectedModel.badge
    ? BADGE_STYLE[selectedModel.badge as keyof typeof BADGE_STYLE]
    : null;

  const isKling30Video = isKling30Route(selectedModel.api_route);
  const isKlingElementModel = selectedModel.family === "kling" && caps.has_element_list;
  const isKling30Image =
    selectedModel.api_route === "kwaivgi/kling-v3.0-std/image-to-video" ||
    selectedModel.api_route === "kwaivgi/kling-v3.0-pro/image-to-video";
  const multiShotEnabled = caps.has_multi_prompt && (multiPrompts.length > 1 || multiPrompts[0] !== "");
  const showImageInput = caps.requires_image || caps.optional_image;
  // Kling 3.0 spec: end frame is NOT supported in multi-shot mode — uses kling30MultiEnabled (not generic)
  const showEndFrame   = caps.has_end_frame && !(isKling30Video && kling30MultiEnabled);
  const showVideoInput = caps.requires_video;
  const showOmniTabs   = caps.has_omni_tabs;
  // Kling 3.0 uses image_urls for start/end frames — no separate reference images section
  const showReferenceImages = caps.max_reference_images > 0 && !isKling30Video && !isKling30Image;
  const showSimpleKlingRefs = false; // Kling 3.0 now uses start/end frame inputs directly
  const showKling30Elements = isKlingElementModel;

  // Kling 3.0 computed values
  const kling30ShotCount = Math.min(5, Math.max(1, Math.floor((duration ?? 9) / 3)));
  const kling30CustomTotalDuration = kling30CustomShots.reduce((sum, s) => sum + s.duration, 0);
  const kling30DurationTarget = duration ?? 9;
  const kling30CustomDurationValid = kling30CustomTotalDuration === kling30DurationTarget;
  const kling30CustomDurationRemaining = kling30DurationTarget - kling30CustomTotalDuration;
  const maxShotsAllowed = (() => {
    if (!caps.has_multi_prompt) return 1;
    if (
      selectedModel.api_route === "kwaivgi/kling-v3-turbo-std/image-to-video" ||
      selectedModel.api_route === "kwaivgi/kling-v3-turbo-pro/image-to-video"
    ) {
      if (duration == null) return 6;
      return Math.max(1, Math.min(6, duration));
    }
    const hardMax = 5;
    if (duration == null) return hardMax;
    return Math.max(1, Math.min(hardMax, Math.floor(duration / 3)));
  })();
  const canAddMoreShots = multiPrompts.length < maxShotsAllowed;
  const hasMainPrompt = prompt.trim().length > 0;
  const hasMultiPrompt = multiPrompts.some((s) => s.trim().length > 0);
  const referenceFileSummary = getReferenceFileSummary(referenceImages, selectedModel);
  const referenceFileMaxLabel = getReferenceFileMaxLabel(selectedModel);
  const currentReferenceLimits = getReferenceFileLimits(selectedModel);
  const canPickReferenceVideos = currentReferenceLimits.videos > 0;
  const canPickReferenceAudio = currentReferenceLimits.audios > 0;
  const canPickReferenceMedia = canPickReferenceVideos || canPickReferenceAudio;
  const promptReferenceTagsEnabled = supportsPromptReferenceTags(selectedModel);
  const hasRequiredImageInput =
    !caps.requires_image || !!startFrame || !!linkedStartFrameUrl || referenceImages.length > 0 || Boolean(selectedCharacter?.referenceUrls?.length);
  const hasRequiredVideoInput = !caps.requires_video || !!motionVideo;
  const canGenerate = (
    videoMode === "extend"
      ? Boolean(motionVideo || extendSourceVideo || linkedExtendSourceUrl)
      : activeTool === "lipsync"
      ? Boolean((startFrame || linkedStartFrameUrl) && lipsyncAudioFile)
      : isKling30Video
      ? (
          (kling30MultiEnabled
            ? (kling30MultiMode === "auto"
                ? true // auto builds prompts automatically
                : kling30CustomShots.some(s => s.prompt.trim()) && kling30CustomDurationValid)
            : (hasMainPrompt || caps.requires_video)) &&
          hasRequiredImageInput &&
          hasRequiredVideoInput
        )
      : (
          (hasMainPrompt || (multiShotEnabled && hasMultiPrompt) || caps.requires_video || !!motionVideo) &&
          hasRequiredImageInput &&
          hasRequiredVideoInput
        )
  ) && !isPromptOverLimit;
  const activeMultiPromptIndexes = multiPrompts
    .map((value, index) => ({ value: value.trim(), index }))
    .filter((item) => item.value.length > 0);
  const shotDurationsByIndex = (() => {
    const out: Record<number, number> = {};
    if (duration == null || activeMultiPromptIndexes.length === 0) return out;
    const count = activeMultiPromptIndexes.length;
    const split = splitShotDurations(duration, count);
    activeMultiPromptIndexes.forEach((item, idx) => {
      out[item.index] = split[idx] ?? 0;
    });
    return out;
  })();

  const effectivePromptPlaceholder = useMemo(() => {
    if (mainWorkflowTab === "create") {
      return activeTool === "lipsync"
        ? t("Lipsync prompt (optional) e.g., talk naturally, smile...")
        : t("Describe the video you want to create…");
    }
    if (mainWorkflowTab === "edit") {
      return (
        editPanelState?.placeholder ||
        (lang === "ar" ? "اختر أداة تحرير من اللوحة الجانبية للبدء..." : "Select an editing tool from the sidebar to begin...")
      );
    }
    if (mainWorkflowTab === "motion") {
      return lang === "ar"
        ? "توجيه إضافي اختياري للحركة، الكاميرا، أو الستايل (اختياري)..."
        : "Optional motion, camera, or style guidance prompt (optional)...";
    }
    return t("Describe the video you want to create…");
  }, [mainWorkflowTab, activeTool, editPanelState, lang, t]);

  const isPromptDisabled = useMemo(() => {
    if (mainWorkflowTab === "edit") {
      return Boolean(editPanelState?.isPromptDisabled);
    }
    return false;
  }, [mainWorkflowTab, editPanelState]);

  const effectiveDisplayCredits = useMemo(() => {
    if (mainWorkflowTab === "create") return estimatedCredits;
    if (mainWorkflowTab === "edit") return editPanelState?.calculatedCredits ?? 0;
    if (mainWorkflowTab === "motion") return motionPanelState?.calculatedCredits ?? 0;
    return estimatedCredits;
  }, [mainWorkflowTab, estimatedCredits, editPanelState, motionPanelState]);

  const effectiveCanGenerate = useMemo(() => {
    if (mainWorkflowTab === "create") return canGenerate;
    if (mainWorkflowTab === "edit") return Boolean(editPanelState?.isReady);
    if (mainWorkflowTab === "motion") return Boolean(motionPanelState?.isReady);
    return canGenerate;
  }, [mainWorkflowTab, canGenerate, editPanelState, motionPanelState]);

  const effectiveButtonLabel = useMemo(() => {
    if (mainWorkflowTab === "create") {
      if (videoMode === "extend") return lang === "ar" ? "إطالة الفيديو" : "Extend Video";
      if (activeTool === "lipsync") return t("Generate Lipsync");
      return lang === "ar" ? "توليد الفيديو" : "Generate Video";
    }
    if (mainWorkflowTab === "edit") {
      return editPanelState?.buttonLabel || (lang === "ar" ? "تطبيق التعديل" : "Apply Edit");
    }
    if (mainWorkflowTab === "motion") {
      return lang === "ar" ? "توليد نقل الحركة" : "Generate Motion";
    }
    return lang === "ar" ? "توليد الفيديو" : "Generate Video";
  }, [mainWorkflowTab, videoMode, activeTool, editPanelState, lang, t]);

  const handleUnifiedGenerate = useCallback(async () => {
    if (isSubmitting) return;
    if (mainWorkflowTab === "create") {
      await handleGenerate();
    } else if (mainWorkflowTab === "edit") {
      if (editPanelState?.executeGenerate) {
        await editPanelState.executeGenerate();
      }
    } else if (mainWorkflowTab === "motion") {
      if (motionPanelState?.executeGenerate) {
        await motionPanelState.executeGenerate();
      }
    }
  }, [isSubmitting, mainWorkflowTab, handleGenerate, editPanelState, motionPanelState]);

  useEffect(() => {
    if (!supportsCharacterReference && selectedCharacterId) {
      setSelectedCharacterId("");
      return;
    }
    if (selectedCharacterId && !selectableCharacters.some((character) => character.id === selectedCharacterId)) {
      setSelectedCharacterId("");
    }
  }, [selectableCharacters, selectedCharacterId, supportsCharacterReference]);

  useEffect(() => {
    if (!caps.has_multi_prompt) return;
    setMultiPrompts((prev) => {
      if (prev.length <= maxShotsAllowed) return prev;
      return prev.slice(0, maxShotsAllowed);
    });
  }, [caps.has_multi_prompt, maxShotsAllowed]);

  // -- Render -------------------------------------------------------------------

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: "calc(100vh - 56px)", background: "#03060f", color: "#e2e8f0" }}
    >
      {/* -- Left Sidebar --------------------------------------------------- */}
      <aside
        className="hidden lg:flex flex-shrink-0 flex-col overflow-y-auto border-r"
        style={{ width: 220, borderColor: "rgba(255,255,255,0.05)", background: "#050a14" }}
      >
        <div className="mt-3 border-t px-3 pt-4" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
            {t("Tools")}
          </span>
          <div className="mt-2">
            <ReferenceToolGrid
              tabs={VIDEO_TOOL_TABS}
              columns={1}
              isAr={lang === "ar"}
              onOpenStudio={(tab) => {
                setActiveStudioTab(tab);
                setShowReferenceStudioModal(true);
              }}
            />
          </div>
        </div>
      </aside>

      {/* -- Center Panel --------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-[60px] lg:pb-0">
        {/* Results grid */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-clip">
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {results.length === 0 && pendingTasks.size === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 pb-16">
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 80, height: 80, borderRadius: 20,
                  background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.1)",
                }}
              >
                <Film size={40} style={{ color: "rgba(6,182,212,0.4)" }} />
              </motion.div>
              <div className="text-center">
                <p className="text-lg font-medium text-white">{t("Create your first video")}</p>
                <p className="mt-1 text-sm" style={{ color: "#94a3b8" }}>
                  {t("Write a prompt and hit Generate to start creating")}
                </p>
              </div>
            </div>
          ) : (
            <VideoHistoryList
              items={results}
              skeletonModels={Array.from(pendingTasks.values()).map(t => ({ name: t.model.name, ratio: t.ratio }))}
              hasMore={videoResultsHasMore}
              loadingMore={loadingMoreVideos}
              onLoadMore={() => void loadPersistedVideos(videoResultsPage + 1, "append")}
              onInspect={(item) => setInspectorAsset(mediaItemToInspectorAsset(item))}
              onToggleFavorite={toggleVideoFavorite}
              onReusePrompt={(item) => { void restoreGenerationIntoComposer(item); }}
              onDelete={(id) => setDeleteTargetId(id)}
            />
          )}
        </div>
          {/* Reference Studio — slides over the results, as on the image page */}
          <ReferenceStudioModal
            isOpen={showReferenceStudioModal}
            onClose={() => setShowReferenceStudioModal(false)}
            activeTab={activeStudioTab}
            setActiveTab={setActiveStudioTab}
            selectedStyle={selectedStyle}
            onSelectStyle={(id) => {
              setSelectedStyle(id);
              setShowReferenceStudioModal(false);
            }}
            selectedElementId={selectedElementId}
            onSelectElement={(id) => {
              setSelectedElementId(id);
              setShowReferenceStudioModal(false);
            }}
            selectedLocationId={selectedLocationId}
            onSelectLocation={(id) => {
              setSelectedLocationId(id);
              setShowReferenceStudioModal(false);
            }}
            selectedCameraId={selectedCameraId}
            onSelectCamera={(id) => {
              setSelectedCameraId(id);
              setShowReferenceStudioModal(false);
            }}
            selectedEffectId={selectedEffectId}
            onSelectEffect={(id) => {
              setSelectedEffectId(id);
              setShowReferenceStudioModal(false);
            }}
            selectedCharacterId={selectedCharacterId || selectedCharacterPresetId}
            onSelectCharacter={(id) => {
              if (!id) {
                setSelectedCharacterPresetId(null);
                setSelectedCharacterId("");
              } else if (HOOK_CHARACTERS.some((h) => h.id === id)) {
                setSelectedCharacterPresetId(id);
                setSelectedCharacterId("");
              } else {
                setSelectedCharacterId(id);
                setSelectedCharacterPresetId(null);
              }
              setShowReferenceStudioModal(false);
            }}
            useCharacterPackage={true}
            selectedSketchId={selectedSketchId}
            selectedShotTypeId={selectedShotTypeId}
            selectedFilmStockId={selectedFilmStockId}
            selectedMovieLookId={selectedMovieLookId}
            selectedLightingId={selectedLightingId}
            selectedMotionBlurId={selectedMotionBlurId}
            selectedGrainId={selectedGrainId}
            selectedHalationId={selectedHalationId}
            selectedTonalLookId={selectedTonalLookId}
            onSelectSketch={(id) => {
              setSelectedSketchId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectShotType={(id) => {
              setSelectedShotTypeId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectFilmStock={(id) => {
              setSelectedFilmStockId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectMovieLook={(id) => {
              setSelectedMovieLookId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectLighting={(id) => {
              setSelectedLightingId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectMotionBlur={(id) => {
              setSelectedMotionBlurId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectGrain={(id) => {
              setSelectedGrainId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectHalation={(id) => {
              setSelectedHalationId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectTonalLook={(id) => {
              setSelectedTonalLookId(id);
              setShowReferenceStudioModal(false);
            }}
            onSelectPalette={(pal) => setSelectedPalette(pal)}
            onAttachFile={(file) => {
              const targetUrl = file.url.startsWith("blob:") || file.url.startsWith("data:")
                ? file.url
                : `/api/proxy-image?url=${encodeURIComponent(file.url)}`;
              fetch(targetUrl)
                .then((r) => r.blob())
                .then((blob) => {
                  const f = new File([blob], `${file.name || "ref"}-${Date.now()}.jpg`, { type: "image/jpeg" });
                  addReferenceFiles([f]);
                })
                .catch((err) => console.error("Failed to attach reference file:", err));
            }}
            isAr={lang === "ar"}
            variant="panel"
          />
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {generationError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mx-4 mb-2 flex items-center gap-2 px-3 py-2.5 rounded-lg"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <AlertCircle size={13} style={{ color: "#f87171", flexShrink: 0 }} />
              <span className="text-[12px] flex-1" style={{ color: "#fca5a5" }}>{generationError}</span>
              <button aria-label={t("Dismiss error")} onClick={() => setGenerationError(null)}>
                <X size={12} style={{ color: "#a1a1aa" }} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified Studio Composite Prompt Card */}
        <div
          className="flex-shrink-0 mx-4 mb-4 mt-2 rounded-2xl flex flex-col gap-2 p-3 transition-all duration-200 shadow-2xl"
          style={{
            background: "rgba(10, 16, 28, 0.85)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255, 255, 255, 0.09)",
            boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.7)",
          }}
        >
          {/* Top Section inside Card: Reference Badges */}
          {referenceImages.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center pb-2.5 border-b border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mr-1 flex items-center gap-1">
                <Sparkles size={11} className="text-cyan-400" /> {promptReferenceTagsEnabled ? t("Click to insert reference:") : "Reference order:"}
              </span>
              {(() => {
                return getPromptReferenceDescriptors(referenceImages, promptReferenceTagsEnabled, selectedModel).map((ref) => {
                  const previewSrc = referencePreviews[ref.originalIndex];
                  const isImage = ref.kind === "image";
                  const isVideo = ref.kind === "video";
                  return (
                    <button
                      key={ref.originalIndex}
                      type="button"
                      disabled={!promptReferenceTagsEnabled}
                      onClick={promptReferenceTagsEnabled ? () => {
                        setPrompt(prev => prev ? `${prev} ${ref.tag}` : ref.tag);
                      } : undefined}
                      className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold shadow-sm ${promptReferenceTagsEnabled ? "transition-all hover:scale-[1.03] active:scale-[0.97]" : "cursor-default"}`}
                      style={{
                        background: "rgba(6, 182, 212, 0.12)",
                        border: "1px solid rgba(6, 182, 212, 0.3)",
                        color: "#22d3ee",
                      }}
                      title={promptReferenceTagsEnabled ? `Click to insert ${ref.tag} into prompt` : "Reference order sent to the model"}
                    >
                      {isImage && previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={ref.tag}
                          className="w-5 h-5 rounded object-cover border border-cyan-500/30"
                        />
                      ) : isVideo && previewSrc ? (
                        <video
                          src={previewSrc}
                          className="w-5 h-5 rounded object-cover border border-cyan-500/30"
                          muted
                          playsInline
                        />
                      ) : (
                        <span className="flex w-5 h-5 items-center justify-center rounded border border-cyan-500/30 bg-cyan-500/10">
                          {isVideo ? <Film size={12} /> : <Music2 size={12} />}
                        </span>
                      )}
                      <span className="font-mono text-[10px]">{ref.label}</span>
                    </button>
                  );
                });
              })()}
            </div>
          )}

          {/* Middle Section inside Card: Full Width Multi-Line Textarea */}
          <div id="video-prompt-composer" className="flex-1 w-full min-h-[64px]">
            <textarea
              id="video-prompt-input"
              rows={Math.min(8, Math.max(3, prompt.split('\n').length))}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onPaste={e => {
                if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                  const pastedFiles = Array.from(e.clipboardData.files).filter(f =>
                    f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/")
                  );
                  if (pastedFiles.length > 0) {
                    e.preventDefault();
                    addReferenceFiles(pastedFiles);
                  }
                }
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleUnifiedGenerate();
                }
              }}
              placeholder={effectivePromptPlaceholder}
              disabled={isPromptDisabled}
              className={`w-full bg-transparent outline-none text-[13.5px] sm:text-[14px] resize-y min-h-[64px] max-h-[220px] p-1.5 leading-relaxed overflow-y-auto custom-scrollbar ${
                isPromptDisabled ? "opacity-50 cursor-not-allowed select-none" : ""
              }`}
              style={{ color: "#f8fafc" }}
            />

            {/* Live Character Countdown Counter */}
            <div className="flex items-center justify-between px-1.5 pt-1 text-[11px]">
              <span className="text-slate-500 text-[10.5px]">
                {isPromptOverLimit ? (
                  <span className="text-red-400 font-semibold">
                    {lang === "ar" ? "تنبيه: تم تجاوز الحد الأقصى للأحرف" : "Warning: Character limit exceeded"}
                  </span>
                ) : null}
              </span>
              <span
                className={`font-mono transition-all ${
                  isPromptOverLimit
                    ? "text-red-400 font-bold bg-red-500/15 px-2 py-0.5 rounded-md border border-red-500/30 shadow-sm"
                    : remainingPromptChars <= 200
                      ? "text-amber-400 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded"
                      : "text-slate-400"
                }`}
                title={
                  lang === "ar"
                    ? `الحد الأقصى للنموذج: ${maxPromptChars} حرف | المتبقي: ${remainingPromptChars}`
                    : `Model limit: ${maxPromptChars} chars | Remaining: ${remainingPromptChars}`
                }
              >
                {lang === "ar"
                  ? (isPromptOverLimit
                      ? `تجاوز الحد بـ ${Math.abs(remainingPromptChars)} حرف (${prompt.length}/${maxPromptChars})`
                      : `متبقي: ${remainingPromptChars} / ${maxPromptChars}`)
                  : (isPromptOverLimit
                      ? `${Math.abs(remainingPromptChars)} over limit (${prompt.length}/${maxPromptChars})`
                      : `${remainingPromptChars} left (${prompt.length}/${maxPromptChars})`)}
              </span>
            </div>

            {/* Negative Prompt Expandable Box */}
            {caps.has_negative_prompt && (showNegPrompt || negPrompt.length > 0) && (
              <div className="w-full mt-2 pt-2 border-t border-white/[0.08] flex flex-col gap-1.5 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500/20 text-red-400 text-[11px] font-bold">
                      <Minus size={10} strokeWidth={3} />
                    </span>
                    <span className="font-semibold text-[11.5px] text-slate-300">
                      {t("Negative Prompt")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNegPrompt(false);
                      setNegPrompt("");
                    }}
                    className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors"
                    title={lang === "ar" ? "إغلاق الوصف السلبي" : "Close negative prompt"}
                  >
                    <X size={13} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={negPrompt}
                  onChange={e => setNegPrompt(e.target.value)}
                  placeholder={t("Things to avoid…")}
                  className="w-full bg-white/[0.03] rounded-lg border border-white/[0.08] outline-none text-[12.5px] p-2 leading-relaxed text-slate-200 placeholder:text-slate-500 resize-none focus:border-red-500/40 transition-colors"
                />
              </div>
            )}
          </div>

          {/* Bottom Section inside Card: Action Toolbar */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] gap-2 flex-wrap sm:flex-nowrap">
            {/* Left Action Tools */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center justify-center p-1.5 rounded-lg bg-white/5 border border-white/10 text-cyan-400">
                {(isSubmitting || pendingTasks.size > 0)
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Sparkles size={14} />
                }
              </div>

              {/* Negative Prompt Circle Tool Button with Tooltip */}
              {caps.has_negative_prompt && (
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => setShowNegPrompt(prev => !prev)}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-all ${
                      showNegPrompt || negPrompt
                        ? "bg-red-500/25 text-red-300 border border-red-500/50 shadow-sm"
                        : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10"
                    }`}
                    aria-label={t("Negative prompt")}
                    title={t("Negative prompt")}
                  >
                    <Minus size={13} strokeWidth={2.5} />
                  </button>
                  {/* Tooltip on Hover */}
                  <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 whitespace-nowrap bg-neutral-900/95 text-slate-200 border border-white/15 text-[11px] font-medium px-2.5 py-1 rounded-md shadow-xl backdrop-blur-md">
                    {t("Negative prompt")}
                  </div>
                </div>
              )}

              {/* Prompt Editor (Ctrl+E) Button with Tooltip */}
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => setShowPromptEditorModal(true)}
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10 transition-all"
                  aria-label={lang === "ar" ? "محرر ومساعد الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                  title={lang === "ar" ? "محرر ومساعد الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                >
                  <SquarePen size={13} strokeWidth={2} />
                </button>
                {/* Tooltip on Hover */}
                <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 whitespace-nowrap bg-neutral-900/95 text-slate-200 border border-white/15 text-[11px] font-medium px-2.5 py-1 rounded-md shadow-xl backdrop-blur-md">
                  {lang === "ar" ? "محرر الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const el = document.querySelector("[data-character-ref='1']") as HTMLElement | null;
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all hover:bg-white/10"
                style={{
                  background: selectedCharacter ? "rgba(217,70,239,0.12)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${selectedCharacter ? "rgba(217,70,239,0.25)" : "rgba(255,255,255,0.08)"}`,
                  color: selectedCharacter ? "#f5d0fe" : "#94a3b8",
                }}
                title={t("Character Reference")}
              >
                <Users size={14} />
                <span className="max-w-[140px] truncate text-[12px] font-semibold">
                  {selectedCharacter ? selectedCharacter.name : t("No character")}
                </span>
              </button>
            </div>

            {/* Right Action Tools */}
            <div className="flex items-center gap-2 ml-auto">
              {prompt && (
                <button
                  aria-label={lang === "ar" ? "مسح النص" : "Clear text"}
                  onClick={() => setPrompt("")}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
                  title={lang === "ar" ? "مسح النص" : "Clear text"}
                >
                  <X size={14} />
                </button>
              )}
              <button
                id="video-unified-generate-btn"
                onClick={handleUnifiedGenerate}
                disabled={isSubmitting || !effectiveCanGenerate}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-semibold transition-all shadow-md"
                style={{
                  background: isSubmitting || !effectiveCanGenerate
                    ? "rgba(255,255,255,0.05)"
                    : "linear-gradient(135deg, rgba(6,182,212,0.85), rgba(37,99,235,0.85))",
                  border: `1px solid ${isSubmitting || !effectiveCanGenerate ? "rgba(255,255,255,0.06)" : "rgba(6,182,212,0.4)"}`,
                  color: isSubmitting || !effectiveCanGenerate ? "#94a3b8" : "#ffffff",
                  cursor: isSubmitting || !effectiveCanGenerate ? "not-allowed" : "pointer",
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>{t("Sending…")}</span>
                  </>
                ) : (
                  <>
                    <Film size={13} className="text-cyan-400" />
                    <span>
                      {effectiveButtonLabel}
                      {" · "}
                      <span style={{ color: isSubmitting || !effectiveCanGenerate ? "#a1a1aa" : "#38bdf8", fontWeight: 700 }}>
                        {effectiveDisplayCredits} cr
                      </span>
                    </span>
                    {pendingTasks.size > 0 && (
                      <span style={{ background: "rgba(6,182,212,0.2)", border: "1px solid rgba(6,182,212,0.35)", borderRadius: 10, padding: "0 5px", fontSize: 10, color: "#06b6d4", lineHeight: 1.6 }}>
                        {pendingTasks.size}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* -- Right Sidebar --------------------------------------------------- */}
      <aside
        id="video-settings-sidebar"
        className="hidden lg:flex flex-shrink-0 flex-col border-l overflow-y-auto w-[400px]"
        style={{ width: 400, minWidth: 400, maxWidth: 400, borderColor: "rgba(255,255,255,0.05)", background: "#050a14" }}
      >
        {/* ── Workflow Navigation Tabs (Create Video | Edit Video | Motion Control) ── */}
        <div className="flex items-center border-b border-white/[0.08] px-3 pt-3 pb-0 justify-between text-[11px] font-semibold select-none flex-shrink-0 bg-[#050a14]">
          <button
            type="button"
            onClick={() => setMainWorkflowTab("create")}
            className={`pb-2.5 transition-all relative ${
              mainWorkflowTab === "create" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>{lang === "ar" ? "توليد فيديو" : "Create Video"}</span>
            {mainWorkflowTab === "create" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainWorkflowTab("edit")}
            className={`pb-2.5 transition-all relative ${
              mainWorkflowTab === "edit" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>{lang === "ar" ? "تعديل فيديو" : "Edit Video"}</span>
            {mainWorkflowTab === "edit" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainWorkflowTab("motion")}
            className={`pb-2.5 transition-all relative ${
              mainWorkflowTab === "motion" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>{lang === "ar" ? "نقل الحركة" : "Motion Control"}</span>
            {mainWorkflowTab === "motion" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
            )}
          </button>
        </div>

        {mainWorkflowTab === "edit" ? (
          <div className="p-4 flex-1">
            <EditVideoSidebarPanel
              lang={lang === "ar" ? "ar" : "en"}
              initialTool={activeEditTool}
              promptText={prompt}
              isSubmitting={isSubmitting}
              fetchWithAuth={fetchWithAuth}
              guardGeneration={guardGeneration}
              onStateChange={setEditPanelState}
              onAppendPrompt={(text) => setPrompt(prev => prev ? `${prev}, ${text}` : text)}
              onTaskCreated={(task) => {
                if (task.taskId) {
                  const pendingTaskInfo: PendingTask = {
                    model: selectedModel,
                    promptText: task.prompt || "Video Editing Task",
                    ratio: "16:9",
                    duration: task.duration || 5,
                  };
                  startPolling(task.taskId, pendingTaskInfo);
                }
              }}
              onError={(msg) => setGenerationError(msg)}
              onSwitchToExtend={() => {
                setMainWorkflowTab("create");
                setVideoMode("extend");
              }}
            />
          </div>
        ) : mainWorkflowTab === "motion" ? (
          <div className="p-4 flex-1">
            <MotionControlSidebarPanel
              lang={lang === "ar" ? "ar" : "en"}
              promptText={prompt}
              isSubmitting={isSubmitting}
              fetchWithAuth={fetchWithAuth}
              guardGeneration={guardGeneration}
              onStateChange={setMotionPanelState}
              onTaskCreated={(task) => {
                if (task.taskId) {
                  const pendingTaskInfo: PendingTask = {
                    model: selectedModel,
                    promptText: task.prompt || "Motion Control Task",
                    ratio: "16:9",
                    duration: task.duration || 5,
                  };
                  startPolling(task.taskId, pendingTaskInfo);
                }
              }}
              onError={(msg) => setGenerationError(msg)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-4 flex-1">
          <ReferenceActionTiles
            hideTiles
            onOpenStudio={(tab) => {
              setActiveStudioTab(tab);
              setShowReferenceStudioModal(true);
            }}
            selectedStyle={selectedStyle}
            selectedElementId={selectedElementId}
            selectedLocationId={selectedLocationId}
            selectedCameraId={selectedCameraId}
            selectedEffectId={selectedEffectId}
            selectedCharacterId={selectedCharacterPresetId}
            onClearStyle={() => setSelectedStyle(null)}
            onClearElement={() => setSelectedElementId(null)}
            onClearLocation={() => setSelectedLocationId(null)}
            onClearCamera={() => setSelectedCameraId(null)}
            onClearEffect={() => setSelectedEffectId(null)}
            onClearCharacter={() => setSelectedCharacterPresetId(null)}
            selectedShotTypeId={selectedShotTypeId}
            selectedFilmStockId={selectedFilmStockId}
            selectedMovieLookId={selectedMovieLookId}
            selectedTonalLookId={selectedTonalLookId}
            selectedLightingId={selectedLightingId}
            selectedMotionBlurId={selectedMotionBlurId}
            selectedGrainId={selectedGrainId}
            selectedHalationId={selectedHalationId}
            onClearShotType={() => setSelectedShotTypeId(null)}
            onClearFilmStock={() => setSelectedFilmStockId(null)}
            onClearMovieLook={() => setSelectedMovieLookId(null)}
            onClearTonalLook={() => setSelectedTonalLookId(null)}
            onClearLighting={() => setSelectedLightingId(null)}
            onClearMotionBlur={() => setSelectedMotionBlurId(null)}
            onClearGrain={() => setSelectedGrainId(null)}
            onClearHalation={() => setSelectedHalationId(null)}
            isAr={lang === "ar"}
          />
          {activeTool === "lipsync" ? (
            <div className="flex-grow flex flex-col gap-5">
              {/* Dynamic Avatar/Lipsync Info */}
              <div
                className="rounded-xl p-3"
                style={{
                  background: hexA(selectedModel.family_color, 0.06),
                  border: `1px solid ${hexA(selectedModel.family_color, 0.25)}`,
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0"
                    style={{ background: selectedModel.family_color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[13px] font-semibold" style={{ color: selectedModel.family_color }}>
                        {selectedModel.name}
                      </span>
                      {selectedModel.badge && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
                          style={{
                            background: hexA(selectedModel.family_color, 0.15),
                            color: selectedModel.family_color,
                          }}
                        >
                          {selectedModel.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: "#94a3b8" }}>
                      Sync avatar lips to audio. Provide a clear face portrait image and an audio recording.
                    </p>
                  </div>
                </div>
              </div>

              {/* Avatar Image Input */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8]">
                  Avatar Image
                </label>
                <div className="mt-2">
                  {startFramePreview ? (
                    <div className="group relative rounded-xl overflow-hidden border border-white/10 aspect-[3/4] bg-black/40">
                      <img
                        src={startFramePreview}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => {
                          setStartFrame(null);
                          setLinkedStartFrameUrl(null);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-slate-300 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openMediaPicker("startFrame")}
                      className="w-full aspect-[3/4] rounded-xl border border-dashed hover:border-cyan-500/50 bg-black/40 hover:bg-cyan-950/10 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-cyan-500 transition-all"
                      style={{ borderColor: "rgba(255,255,255,0.08)" }}
                    >
                      <ImageIcon size={24} />
                      <span className="text-xs font-semibold">Upload Avatar</span>
                      <span className="text-[10px] text-slate-600">Portrait recommended</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Audio File Input */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8]">
                  Voice / Audio
                </label>
                <div className="mt-2">
                  {lipsyncAudioFile ? (
                    <div className="relative rounded-xl p-3 border border-white/10 bg-black/40 flex flex-col gap-2">
                      <div className="flex items-center justify-between min-w-0 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Music2 size={16} className="text-[#06b6d4] flex-shrink-0" />
                          <span className="text-xs text-slate-300 font-medium truncate min-w-0">
                            {lipsyncAudioFile.name}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setLipsyncAudioFile(null);
                          }}
                          className="p-1 rounded bg-black/40 hover:bg-black/60 text-slate-400 hover:text-white transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {lipsyncAudioPreview && (
                        <audio
                          src={lipsyncAudioPreview}
                          controls
                          className="w-full h-8 mt-1 rounded bg-black/30 overflow-hidden text-xs"
                        />
                      )}
                      <span className="text-[9px] text-[#94a3b8]">
                        Size: {(lipsyncAudioFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  ) : (
                    <>
                      <input
                        type="file"
                        ref={lipsyncAudioRef}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setLipsyncAudioFile(file);
                        }}
                        accept="audio/*"
                        className="hidden"
                      />
                      <button
                        onClick={() => lipsyncAudioRef.current?.click()}
                        className="w-full py-8 rounded-xl border border-dashed hover:border-cyan-500/50 bg-black/40 hover:bg-cyan-950/10 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-cyan-500 transition-all"
                        style={{ borderColor: "rgba(255,255,255,0.08)" }}
                      >
                        <Music2 size={24} />
                        <span className="text-xs font-semibold">Upload Audio</span>
                        <span className="text-[10px] text-slate-600">MP3, WAV, AAC (Max 100MB)</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>


          {/* 0. References / Frames switcher (models supporting both input modes) */}
          {showInputModeTabs && videoMode !== "extend" && (
            <div
              className="flex rounded-lg overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {inputModeChoices.map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInputMode(mode)}
                  className="flex-1 py-2 text-[12px] font-semibold transition-all"
                  style={{
                    background: inputMode === mode ? hexA(selectedModel.family_color, 0.15) : "transparent",
                    color:      inputMode === mode ? selectedModel.family_color : "#a1a1aa",
                    borderBottom: inputMode === mode ? `2px solid ${selectedModel.family_color}` : "2px solid transparent",
                  }}
                >
                  {mode === "references"
                    ? (lang === "ar" ? "المراجع" : "References")
                    : (lang === "ar" ? "الإطارات" : "Frames")}
                </button>
              ))}
            </div>
          )}

          {/* 1. Reference Media Box (Always visible Status Bar with conditional thumbnails) */}
          {(showReferenceImages || showSimpleKlingRefs) && referenceModeActive && videoMode !== "extend" && (
            <div className="flex flex-col gap-2">
              {/* The Status Bar Row - Clickable as a single unified button with drag and drop */}
              <button
                type="button"
                onClick={() => openMediaPicker("referenceImages")}
                onDragOver={allowDrop}
                onDragEnter={(event) => markDropZone(event, "referenceImages")}
                onDragLeave={(event) => clearDropZone(event, "referenceImages")}
                onDrop={handleDropReferenceImages}
                className="flex flex-col gap-2 w-full bg-[#070b15] border border-slate-800/80 rounded-2xl p-2 pb-1.5 relative min-w-0 overflow-hidden hover:bg-[#0c1222] hover:border-slate-700/80 transition-all duration-200 group cursor-pointer"
              >
                {/* Row 1: The icons and Add media */}
                <div className="flex items-center justify-between w-full min-w-0 flex-nowrap pl-0.5">
                  <div className="flex items-center gap-1 flex-shrink-0 min-w-0">
                    {/* 1. Image Icon Button */}
                    <div
                      className="relative w-8 h-8 rounded-xl bg-[#111524] border border-slate-800 flex items-center justify-center flex-shrink-0"
                      title={lang === "ar" ? "الصور المرجعية" : "Reference Images"}
                    >
                      <ImageIcon className={`w-3.5 h-3.5 transition-all ${referenceImages.some(f => f.type.startsWith("image/")) ? "text-cyan-400" : "text-slate-400"}`} />
                      {referenceImages.some(f => f.type.startsWith("image/")) && (
                        <div className="absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full bg-cyan-500 shadow-[0_0_6px_#06b6d4]" />
                      )}
                    </div>

                    {/* 2. Video Icon Button */}
                    <div
                      className="relative w-8 h-8 rounded-xl bg-[#111524] border border-slate-800 flex items-center justify-center flex-shrink-0"
                      title={lang === "ar" ? "الفيديوهات المرجعية" : "Reference Videos"}
                    >
                      <Video className={`w-3.5 h-3.5 transition-all ${referenceImages.some(f => f.type.startsWith("video/")) ? "text-purple-400" : "text-slate-400"}`} />
                      {referenceImages.some(f => f.type.startsWith("video/")) && (
                        <div className="absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
                      )}
                    </div>

                    {/* 3. Audio Icon Button */}
                    <div
                      className="relative w-8 h-8 rounded-xl bg-[#111524] border border-slate-800 flex items-center justify-center flex-shrink-0"
                      title={lang === "ar" ? "الأصوات المرجعية" : "Reference Audio"}
                    >
                      <AudioLines className={`w-3.5 h-3.5 transition-all ${referenceImages.some(f => f.type.startsWith("audio/")) ? "text-teal-400" : "text-slate-400"}`} />
                      {referenceImages.some(f => f.type.startsWith("audio/")) && (
                        <div className="absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full bg-teal-500 shadow-[0_0_8px_#14b8a6]" />
                      )}
                    </div>

                    {/* 4. Character Icon Button */}
                    <div
                      className="relative w-8 h-8 rounded-xl bg-[#111524] border border-slate-800 flex items-center justify-center flex-shrink-0"
                      title={lang === "ar" ? "شخصية محفوظة" : "Saved Character"}
                    >
                      <User className={`w-3.5 h-3.5 transition-all ${selectedCharacterPresetId ? "text-pink-400" : "text-slate-400"}`} />
                      {selectedCharacterPresetId && (
                        <div className="absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full bg-pink-500 shadow-[0_0_8px_#ec4899]" />
                      )}
                    </div>

                    {/* 5. Style Icon Button */}
                    <div
                      className="relative w-8 h-8 rounded-xl bg-[#111524] border border-slate-800 flex items-center justify-center flex-shrink-0"
                      title={lang === "ar" ? "مكتبة الأنماط" : "Style Library"}
                    >
                      <Palette className={`w-3.5 h-3.5 transition-all ${selectedStyle ? "text-amber-400" : "text-slate-400"}`} />
                      {selectedStyle && (
                        <div className="absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full bg-amber-500 shadow-[0_0_8px_#eab308]" />
                      )}
                    </div>
                  </div>

                  <div className="h-4 w-[1px] bg-slate-800 mx-1 flex-shrink-0" />

                  <div className="flex-shrink-0 h-8 rounded-full bg-[#121624] border border-slate-800 flex items-center justify-center gap-1.5 px-2.5 transition-all duration-200 text-slate-350 group-hover:text-white">
                    <div className="w-5 h-5 rounded-full border border-dashed border-cyan-500/50 flex items-center justify-center text-cyan-400 group-hover:border-cyan-400 transition-colors">
                      <Plus className="w-2.5 h-2.5 flex-shrink-0" />
                    </div>
                    <span className="text-[10px] font-semibold tracking-tight">Add media</span>
                  </div>
                </div>

                {/* Divider Line */}
                <div className="w-full h-[1px] bg-slate-800/60 mt-0.5" />

                {/* Row 2: Subtitle text */}
                <div className="flex flex-col items-center justify-center gap-0.5 w-full select-none pointer-events-none pb-1">
                  <span className="text-[10px] font-semibold text-slate-400">Add references</span>
                  <span className="text-[9px] text-slate-500">Image, Video or Audio</span>
                </div>

                {activeDropZone === "referenceImages" && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-cyan-500/15 text-[10px] font-bold text-cyan-300 backdrop-blur-[1px] border border-dashed border-cyan-500/30">
                    {lang === "ar" ? "أفلت الوسائط هنا" : "Drop media here"}
                  </div>
                )}
              </button>

              {/* Row 2: Thumbnails grid (rendered below status bar when files are uploaded) */}
              {referenceImages.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5 pt-1 bg-black/20 border border-dashed border-slate-800/80 rounded-xl p-2.5">
                  {referencePreviews.map((src, i) => {
                    const file = referenceImages[i];
                    if (!file) return null;
                    const isImage = file.type.startsWith("image/");
                    const isVideo = file.type.startsWith("video/");
                    const isAudio = file.type.startsWith("audio/");
                    const descriptors = getPromptReferenceDescriptors(referenceImages, promptReferenceTagsEnabled, selectedModel);
                    const desc = descriptors[i];
                    const tag = desc ? desc.tag : `@ref${i + 1}`;

                    return (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-white/5 bg-black/40 group">
                        {isImage && src && (
                          <img src={src} alt={file.name} className="w-full h-full object-cover" />
                        )}
                        {isVideo && src && (
                          <video src={src} className="w-full h-full object-cover" muted playsInline />
                        )}
                        {isAudio && (
                          <div className="w-full h-full flex items-center justify-center bg-teal-500/10">
                            <AudioLines className="w-4 h-4 text-teal-400" />
                          </div>
                        )}

                        {/* Tag Overlay at the bottom */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/75 py-0.5 text-center text-[8px] font-bold text-slate-300 select-none truncate">
                          {tag}
                        </div>

                        {/* Individual Delete Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceImages((prev) => prev.filter((_, idx) => idx !== i));
                          }}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}

                  {/* Add More Reference Slot */}
                  {referenceImages.length < (currentReferenceLimits.images + currentReferenceLimits.videos + currentReferenceLimits.audios) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openMediaPicker("referenceImages");
                      }}
                      className="relative aspect-square rounded-lg border border-dashed border-slate-700/80 bg-slate-900/40 hover:bg-slate-800/60 hover:border-cyan-500/50 flex flex-col items-center justify-center gap-1 transition-all group"
                      title={lang === "ar" ? "إضافة مرجع آخر" : "Add another reference"}
                    >
                      <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-cyan-400 group-hover:border-cyan-500/40 transition-colors">
                        <Plus size={12} />
                      </div>
                      <span className="text-[9px] font-medium text-slate-400 group-hover:text-slate-200">
                        {lang === "ar" ? "إضافة" : "Add"}
                      </span>
                    </button>
                  )}
                </div>
              )}

              <input
                ref={referenceImagesRef}
                type="file"
                accept={canPickReferenceMedia ? "image/*,video/*,audio/*" : "image/*"}
                multiple
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files ?? []);
                  addReferenceFiles(files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {/* 1.5. Dedicated Video Extension inputs (Source Video + Optional End Frame) */}
          {videoMode === "extend" && (
            <div className="flex flex-col gap-2 p-2 rounded-xl bg-emerald-950/20 border border-emerald-800/40 mb-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                  {lang === "ar" ? "فيديو المصدر وإطار النهاية" : "Source Video & Target Frame"}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  max {selectedModel.pricingConfig?.extendMaxDuration ?? 15}s
                </span>
              </div>
              <div className="flex gap-2">
                {/* Source Video Dropzone */}
                <button
                  type="button"
                  onClick={() => openMediaPicker("motionVideo")}
                  onDragOver={allowDrop}
                  onDragEnter={(event) => markDropZone(event, "motionVideo")}
                  onDragLeave={(event) => clearDropZone(event, "motionVideo")}
                  onDrop={(event) => handleDropSingleVideo(event, setMotionVideo)}
                  className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                  style={{
                    height: 105,
                    borderColor: motionVideo ? "#10b981" : "rgba(16, 185, 129, 0.4)",
                    background:  motionVideo ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.03)",
                  }}
                >
                  <input
                    ref={motionVideoRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={e => setMotionVideo(e.target.files?.[0] ?? null)}
                  />
                  {motionVideo ? (
                    <>
                      {motionVideoPreview && (
                        <video
                          src={motionVideoPreview}
                          className="absolute inset-0 w-full h-full object-cover rounded-xl"
                          muted
                          playsInline
                          autoPlay
                          loop
                        />
                      )}
                      <button
                        type="button"
                        className="absolute top-2 left-2 z-10 rounded-full p-1"
                        style={{ background: "rgba(0,0,0,0.75)" }}
                        onClick={e => { e.stopPropagation(); setMotionVideo(null); }}
                      >
                        <X size={11} style={{ color: "#fff" }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(16, 185, 129, 0.15)" }}>
                        <Film size={16} className="text-emerald-400" />
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-300">
                        {lang === "ar" ? "فيديو المصدر *" : "Source Video *"}
                      </span>
                      <span className="text-[9px] text-zinc-400">
                        {lang === "ar" ? "ارفع الفيديو المراد إطالته" : "Upload source video"}
                      </span>
                    </>
                  )}
                  {activeDropZone === "motionVideo" && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-emerald-500/20 text-[12px] font-semibold text-emerald-300">
                      {lang === "ar" ? "أفلت الفيديو هنا" : "Drop video here"}
                    </span>
                  )}
                </button>

                {/* Target End Frame Dropzone (Conditional per model) */}
                {selectedModel.pricingConfig?.extendSupportsLastImage !== false && (
                  <button
                    type="button"
                    onClick={() => openMediaPicker("endFrame")}
                    onDragOver={allowDrop}
                    onDragEnter={(event) => markDropZone(event, "endFrame")}
                    onDragLeave={(event) => clearDropZone(event, "endFrame")}
                    onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("endFrame", file))}
                    className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                    style={{
                      height: 105,
                      borderColor: (endFrame || linkedEndFrameUrl || endFramePreview) ? "#06b6d4" : "rgba(255,255,255,0.1)",
                      background:  (endFrame || linkedEndFrameUrl || endFramePreview) ? "rgba(6, 182, 212, 0.08)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <input
                      ref={endFrameRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => selectFrameFile("endFrame", e.target.files?.[0] ?? null)}
                    />
                    {(endFrame || linkedEndFrameUrl || endFramePreview) ? (
                      <>
                        {endFramePreview && (
                          <img
                            src={endFramePreview}
                            alt="End frame preview"
                            className="absolute inset-0 w-full h-full object-cover rounded-xl"
                          />
                        )}
                        <button
                          type="button"
                          className="absolute top-2 left-2 z-10 rounded-full p-1"
                          style={{ background: "rgba(0,0,0,0.75)" }}
                          onClick={e => {
                            e.stopPropagation();
                            setEndFrame(null);
                            setLinkedEndFrameUrl(null);
                            setEndFramePreview(null);
                          }}
                        >
                          <X size={11} style={{ color: "#fff" }} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <ImageIcon size={14} style={{ color: "#94a3b8" }} />
                        </div>
                        <span className="text-[10px] text-zinc-300">
                          {lang === "ar" ? "إطار النهاية (اختياري)" : "Target End Frame"}
                        </span>
                        <span className="text-[9px] text-zinc-500">
                          {lang === "ar" ? "انتقال إلى صورة" : "Optional frame"}
                        </span>
                      </>
                    )}
                    {activeDropZone === "endFrame" && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                        {lang === "ar" ? "أفلت الصورة هنا" : "Drop image here"}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 2. Motion Control inputs (video + character) */}
          {showVideoInput && videoMode !== "extend" && (
            <div className="flex gap-2">
              {/* Motion reference video */}
              <button
                type="button"
                onClick={() => openMediaPicker("motionVideo")}
                onDragOver={allowDrop}
                onDragEnter={(event) => markDropZone(event, "motionVideo")}
                onDragLeave={(event) => clearDropZone(event, "motionVideo")}
                onDrop={(event) => handleDropSingleVideo(event, setMotionVideo)}
                className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                style={{
                  height: 100,
                  borderColor: motionVideo ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                  background:  motionVideo ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                }}
              >
                <input
                  ref={motionVideoRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={e => setMotionVideo(e.target.files?.[0] ?? null)}
                />
                {motionVideo ? (
                  <>
                    {motionVideoPreview && (
                      <video
                        src={motionVideoPreview}
                        className="absolute inset-0 w-full h-full object-cover rounded-xl"
                        muted
                        playsInline
                        autoPlay
                        loop
                      />
                    )}
                    <button
                      type="button"
                      className="absolute top-2 left-2 z-10 rounded-full p-1"
                      style={{ background: "rgba(0,0,0,0.75)" }}
                      onClick={e => { e.stopPropagation(); setMotionVideo(null); }}
                    >
                      <X size={11} style={{ color: "#fff" }} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <Film size={16} style={{ color: "#94a3b8" }} />
                    </div>
                    <span className="text-[10px] text-center leading-tight px-1" style={{ color: "#94a3b8" }}>Add motion to copy *</span>
                    <span className="text-[9px]" style={{ color: "#94a3b8" }}>3–30 seconds</span>
                  </>
                )}
                {activeDropZone === "motionVideo" && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                    Drop video here
                  </span>
                )}
              </button>

              {/* Character image */}
              <button
                type="button"
                onClick={() => openMediaPicker("startFrame")}
                onDragOver={allowDrop}
                onDragEnter={(event) => markDropZone(event, "startFrame")}
                onDragLeave={(event) => clearDropZone(event, "startFrame")}
                onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("startFrame", file))}
                className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                style={{
                  height: 100,
                  borderColor: startFrame ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                  background:  startFrame ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                }}
              >
                <input
                  ref={startFrameRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => selectFrameFile("startFrame", e.target.files?.[0] ?? null)}
                />
                {startFrame ? (
                  <>
                    {startFramePreview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={startFramePreview}
                        alt="Character image preview"
                        className="absolute inset-0 w-full h-full object-cover rounded-xl"
                      />
                    )}
                    <button
                      type="button"
                      className="absolute top-2 left-2 z-10 rounded-full p-1"
                      style={{ background: "rgba(0,0,0,0.75)" }}
                      onClick={e => { e.stopPropagation(); setStartFrame(null); }}
                    >
                      <X size={11} style={{ color: "#fff" }} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <ImageIcon size={16} style={{ color: "#94a3b8" }} />
                    </div>
                    <span className="text-[10px] text-center leading-tight px-1" style={{ color: "#94a3b8" }}>Add your character *</span>
                    <span className="text-[9px] text-center px-1" style={{ color: "#94a3b8" }}>Face and body</span>
                  </>
                )}
                {activeDropZone === "startFrame" && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                    Drop image here
                  </span>
                )}
              </button>
            </div>
          )}

          {/* 3. Omni Elements / Frames Tabs */}
          {showOmniTabs && (
            <div className="flex flex-col gap-2">
              <div
                className="flex rounded-lg overflow-hidden"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {(["elements", "frames"] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setOmniTab(tab)}
                    className="flex-1 py-2 text-[12px] font-semibold capitalize transition-all"
                    style={{
                      background: omniTab === tab ? hexA(selectedModel.family_color, 0.15) : "transparent",
                      color:      omniTab === tab ? selectedModel.family_color : "#a1a1aa",
                      borderBottom: omniTab === tab ? `2px solid ${selectedModel.family_color}` : "2px solid transparent",
                    }}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {omniTab === "elements" && (
                <button
                  type="button"
                  onClick={() => openMediaPicker("startFrame")}
                  onDragOver={allowDrop}
                  onDragEnter={(event) => markDropZone(event, "startFrame")}
                  onDragLeave={(event) => clearDropZone(event, "startFrame")}
                  onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("startFrame", file))}
                  className="relative flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-all w-full"
                  style={{
                    height: 110,
                    borderColor: (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                    background:  (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                  }}
                >
                  <input
                    ref={startFrameRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => selectFrameFile("startFrame", e.target.files?.[0] ?? null)}
                  />
                  {(startFrame || linkedStartFrameUrl || startFramePreview) ? (
                    <>
                      {startFramePreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={startFramePreview}
                          alt="Element image preview"
                          className="absolute inset-0 w-full h-full object-cover rounded-xl"
                        />
                      )}
                      <button
                        type="button"
                        className="absolute top-2 left-2 z-10 rounded-full p-1"
                        style={{ background: "rgba(0,0,0,0.75)" }}
                        onClick={e => { e.stopPropagation(); setStartFrame(null); setLinkedStartFrameUrl(null); setStartFramePreview(null); }}
                      >
                        <X size={11} style={{ color: "#fff" }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <ImageIcon size={18} style={{ color: "#94a3b8" }} />
                      </div>
                      <span className="text-[12px] font-medium" style={{ color: "#94a3b8" }}>Add consistent element</span>
                      <span className="text-[11px]" style={{ color: "#94a3b8" }}>Character, person or object</span>
                    </>
                  )}
                </button>
              )}

              {omniTab === "frames" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openMediaPicker("startFrame")}
                    onDragOver={allowDrop}
                    onDragEnter={(event) => markDropZone(event, "startFrame")}
                    onDragLeave={(event) => clearDropZone(event, "startFrame")}
                    onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("startFrame", file))}
                    className="relative flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-all"
                    style={{
                      height: 110,
                      borderColor: (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                      background:  (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <input
                      ref={startFrameRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => selectFrameFile("startFrame", e.target.files?.[0] ?? null)}
                    />
                    {(startFrame || linkedStartFrameUrl || startFramePreview) ? (
                      <>
                        {startFramePreview && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={startFramePreview}
                            alt="Start frame preview"
                            className="absolute inset-0 w-full h-full object-cover rounded-xl"
                          />
                        )}
                        <button
                          type="button"
                          className="absolute top-2 left-2 z-10 rounded-full p-1"
                          style={{ background: "rgba(0,0,0,0.75)" }}
                          onClick={e => { e.stopPropagation(); setStartFrame(null); setLinkedStartFrameUrl(null); setStartFramePreview(null); }}
                        >
                          <X size={11} style={{ color: "#fff" }} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <ImageIcon size={16} style={{ color: "#94a3b8" }} />
                        </div>
                        <span className="text-[11px]" style={{ color: "#94a3b8" }}>Start frame</span>
                      </>
                    )}
                    {activeDropZone === "startFrame" && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                        Drop image here
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => openMediaPicker("endFrame")}
                    onDragOver={allowDrop}
                    onDragEnter={(event) => markDropZone(event, "endFrame")}
                    onDragLeave={(event) => clearDropZone(event, "endFrame")}
                    onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("endFrame", file))}
                    className="relative flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-all"
                    style={{
                      height: 110,
                      borderColor: (endFrame || linkedEndFrameUrl || endFramePreview) ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                      background:  (endFrame || linkedEndFrameUrl || endFramePreview) ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <input
                      ref={endFrameRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => selectFrameFile("endFrame", e.target.files?.[0] ?? null)}
                    />
                    {(endFrame || linkedEndFrameUrl || endFramePreview) ? (
                      <>
                        {endFramePreview && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={endFramePreview}
                            alt="End frame preview"
                            className="absolute inset-0 w-full h-full object-cover rounded-xl"
                          />
                        )}
                        <button
                          type="button"
                          className="absolute top-2 left-2 z-10 rounded-full p-1"
                          style={{ background: "rgba(0,0,0,0.75)" }}
                          onClick={e => { e.stopPropagation(); setEndFrame(null); setLinkedEndFrameUrl(null); setEndFramePreview(null); }}
                        >
                          <X size={11} style={{ color: "#fff" }} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <ImageIcon size={16} style={{ color: "#94a3b8" }} />
                        </div>
                        <span className="text-[11px]" style={{ color: "#94a3b8" }}>End frame</span>
                      </>
                    )}
                    {activeDropZone === "endFrame" && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                        Drop image here
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. Image inputs (Start / End frame) (non-Omni / non-Motion Control) */}
          {!showVideoInput && !showOmniTabs && !isKling30Video && frameModeActive && videoMode !== "extend" && (showImageInput || showEndFrame) && (
            <div className="flex gap-2">
              {showImageInput && (
                <button
                  type="button"
                  onClick={() => openMediaPicker("startFrame")}
                  onDragOver={allowDrop}
                  onDragEnter={(event) => markDropZone(event, "startFrame")}
                  onDragLeave={(event) => clearDropZone(event, "startFrame")}
                  onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("startFrame", file))}
                  className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                  style={{
                    height: 100,
                    borderColor: (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                    background:  (startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                  }}
                >
                  <input
                    ref={startFrameRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => selectFrameFile("startFrame", e.target.files?.[0] ?? null)}
                  />
                  {(startFrame || linkedStartFrameUrl || startFramePreview) ? (
                    <>
                      {startFramePreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={startFramePreview}
                          alt="Start frame preview"
                          className="absolute inset-0 w-full h-full object-cover rounded-xl"
                        />
                      )}
                      <button
                        type="button"
                        className="absolute top-2 left-2 z-10 rounded-full p-1"
                        style={{ background: "rgba(0,0,0,0.75)" }}
                        onClick={e => { e.stopPropagation(); setStartFrame(null); setLinkedStartFrameUrl(null); setStartFramePreview(null); }}
                      >
                        <X size={11} style={{ color: "#fff" }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.06)" }}
                      >
                        <ImageIcon size={14} style={{ color: "#94a3b8" }} />
                      </div>
                      <span className="text-[10px]" style={{ color: "#94a3b8" }}>
                        {caps.requires_image ? "Upload image *" : "Start frame"}
                      </span>
                    </>
                  )}
                  {activeDropZone === "startFrame" && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                      Drop image here
                    </span>
                  )}
                </button>
              )}

              {showEndFrame && (
                <button
                  type="button"
                  onClick={() => openMediaPicker("endFrame")}
                  onDragOver={allowDrop}
                  onDragEnter={(event) => markDropZone(event, "endFrame")}
                  onDragLeave={(event) => clearDropZone(event, "endFrame")}
                  onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("endFrame", file))}
                  className="relative flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-all"
                  style={{
                    height: 100,
                    borderColor: (endFrame || linkedEndFrameUrl || endFramePreview) ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                    background:  (endFrame || linkedEndFrameUrl || endFramePreview) ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                  }}
                >
                  <input
                    ref={endFrameRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => selectFrameFile("endFrame", e.target.files?.[0] ?? null)}
                  />
                  {(endFrame || linkedEndFrameUrl || endFramePreview) ? (
                    <>
                      {endFramePreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={endFramePreview}
                          alt="End frame preview"
                          className="absolute inset-0 w-full h-full object-cover rounded-xl"
                        />
                      )}
                      <button
                        type="button"
                        className="absolute top-2 left-2 z-10 rounded-full p-1"
                        style={{ background: "rgba(0,0,0,0.75)" }}
                        onClick={e => { e.stopPropagation(); setEndFrame(null); setLinkedEndFrameUrl(null); setEndFramePreview(null); }}
                      >
                        <X size={11} style={{ color: "#fff" }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.06)" }}
                      >
                        <ImageIcon size={14} style={{ color: "#94a3b8" }} />
                      </div>
                      <span className="text-[10px]" style={{ color: "#94a3b8" }}>End frame</span>
                    </>
                  )}
                  {activeDropZone === "endFrame" && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-cyan-500/15 text-[12px] font-semibold text-cyan-300">
                      Drop image here
                    </span>
                  )}
                </button>
              )}
            </div>
          )}



          {/* 6. Uploaded reference list tags and Hint Text */}
          {(showReferenceImages || showSimpleKlingRefs) && referenceModeActive && referenceImages.length > 0 && (
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-wrap gap-2 items-center">
                {getPromptReferenceDescriptors(referenceImages, promptReferenceTagsEnabled, selectedModel).map((ref) => {
                  const isImage = ref.kind === "image";
                  const isVideo = ref.kind === "video";
                  return (
                    <div
                      key={ref.originalIndex}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border group"
                      style={{
                        background: "rgba(6, 182, 212, 0.04)",
                        borderColor: "rgba(6, 182, 212, 0.2)",
                      }}
                    >
                      {isVideo ? (
                        <Film size={12} className="text-cyan-400" />
                      ) : isImage ? (
                        <ImageIcon size={12} className="text-cyan-400" />
                      ) : (
                        <AudioLines size={12} className="text-cyan-400" />
                      )}
                      <span className="text-[11px] font-bold text-cyan-400 font-mono">{ref.tag}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReferenceImages((prev) => prev.filter((_, idx) => idx !== ref.originalIndex));
                        }}
                        className="text-cyan-500 hover:text-red-400 transition-colors ml-0.5"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500 mt-0.5">
                {showSimpleKlingRefs
                  ? "Kling uses Elements with @element_name, not @Image prompt tags."
                  : canPickReferenceMedia
                    ? getPromptReferenceTagHint(selectedModel)
                    : "Reference images mode is active; first/last frame inputs will be ignored for this generation."}
              </p>
            </div>
          )}          {/* Mode Switcher: Generate Video vs Video Extension */}
          <div className="flex gap-1.5 p-1 rounded-xl bg-zinc-950/80 border border-zinc-800/80 mb-1">
            <button
              type="button"
              onClick={() => {
                setVideoMode("generate");
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                videoMode === "generate"
                  ? "text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 bg-transparent"
              }`}
            >
              <Clapperboard size={13} />
              <span>{lang === "ar" ? "توليد فيديو" : "Generate Video"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setVideoMode("extend");
                if (extendCapableModels.length > 0 && !extendCapableModels.some(m => m.id === selectedModel.id)) {
                  selectModel(extendCapableModels[0]);
                }
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                videoMode === "extend"
                  ? "text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 bg-transparent"
              }`}
            >
              <Play size={13} />
              <span>{lang === "ar" ? "إطالة فيديو" : "Video Extension"}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300">
                {extendCapableModels.length}
              </span>
            </button>
          </div>

          {/* Fix #1: Info Banner ثابت أعلى تبويبة Extend */}
          {videoMode === "extend" && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 p-3 mb-2">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <p className="text-[11px] font-semibold text-emerald-300">
                    {lang === "ar" ? "كيف تُحسب تكلفة الإطالة" : "How Extension Cost Is Calculated"}
                  </p>
                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    {lang === "ar"
                      ? "معظم الموديلات تحاسبك على الثواني المضافة فقط. Seedance 2.5 استثناء — يحاسب على جزء من الفيديو الأصلي + الجزء الجديد لضمان استمرارية سلسة."
                      : "Most models charge only for the added seconds. Seedance 2.5 is an exception — it bills for a portion of the source video + the new segment to ensure seamless continuity."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Fix #2: تنبيه ديناميكي خاص لـ Seedance 2.5 */}
          {videoMode === "extend" && (selectedModel as any).pricingConfig?.extendBillingMode === "source_plus_new_segment" && (
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 p-3 my-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <p className="text-[11px] font-semibold text-amber-300">
                    {lang === "ar" ? "⚡ ملاحظة خاصة — Seedance 2.5" : "⚡ Special note — Seedance 2.5"}
                  </p>
                  <p className="text-[10px] text-zinc-300 leading-relaxed">
                    {lang === "ar"
                      ? ((selectedModel as any).pricingConfig?.extendUserHintAr
                          ? (selectedModel as any).pricingConfig.extendUserHintAr.replace("{sourceSec}", String((selectedModel as any).pricingConfig?.extendDefaultSourceContextSec ?? 5))
                          : `يقرأ الموديل ${(selectedModel as any).pricingConfig?.extendDefaultSourceContextSec ?? 5} ثوانٍ من الفيديو الأصلي لفهم الحركة، ثم يضيف الجزء الجديد. التكلفة = (سياق + إضافة) × السعر.`)
                      : ((selectedModel as any).pricingConfig?.extendUserHintEn
                          ? (selectedModel as any).pricingConfig.extendUserHintEn.replace("{sourceSec}", String((selectedModel as any).pricingConfig?.extendDefaultSourceContextSec ?? 5))
                          : `The model reads ${(selectedModel as any).pricingConfig?.extendDefaultSourceContextSec ?? 5}s from source to understand motion, then generates the new segment. Cost = (source context + new segment) × rate.`)}
                  </p>
                  <p className="text-[10px] text-amber-200 leading-relaxed">
                    💡 {lang === "ar"
                      ? ((selectedModel as any).pricingConfig?.extendTipAr ?? "نصيحة: إذا كنت تريد جيلاً جديداً بنفس الشخصية فقط، استخدم Seedance 2.5 T2V/I2V مع رفرنس صورة — أرخص وأسرع.")
                      : ((selectedModel as any).pricingConfig?.extendTipEn ?? "Tip: If you just want a new generation with the same character, use Seedance 2.5 T2V/I2V with an image reference — cheaper and faster.")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* -- AI Model dropdown ------------------------------------------- */}
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
              {videoMode === "extend" ? (lang === "ar" ? "نموذج الإطالة (Extension Model)" : "Extension Model") : "AI Model"}
            </label>
            {(activeTool as string) !== "lipsync" ? (
              // Regular video models
              <Popover open={modelOpen} onOpenChange={setModelOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selectedModel.family_color }} />
                    <span className="flex-1 truncate text-[13px]" style={{ color: "#e2e8f0" }}>{displayVideoModelName(selectedModel, false)}</span>
                    {videoMode === "extend" && (
                      (selectedModel as any).pricingConfig?.extendBillingMode === "source_plus_new_segment" ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 font-mono">
                          SOURCE+NEW
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-mono">
                          NEW ONLY
                        </span>
                      )
                    )}
                    {bStyle && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
                        style={{ background: bStyle.bg, color: bStyle.text }}
                      >
                        {selectedModel.badge}
                      </span>
                    )}
                    <ChevronDown
                      size={13}
                      style={{
                        color: "#94a3b8",
                        transform: modelOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }}
                    />
                  </button>
                </PopoverTrigger>

                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={6}
                  collisionPadding={16}
                  className="z-50 p-0 rounded-2xl overflow-hidden border border-white/10 bg-[#090e1a]/95 backdrop-blur-2xl shadow-2xl w-[640px] max-w-[94vw]"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07] bg-white/[0.02]">
                    <span className="text-[12px] font-semibold text-slate-200 tracking-wide">
                      {lang === "ar" ? "اختر موديل الفيديو وخصائصه" : "Select Video Model"}
                    </span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {modelGroupsForSelector.reduce((acc, g) => acc + g.models.length, 0)} {lang === "ar" ? "موديل" : "models"}
                    </span>
                  </div>

                  <div className="max-h-[380px] overflow-y-auto py-1.5 divide-y divide-white/[0.04]">
                    {modelGroupsForSelector.map((g, gIdx) => (
                      <div key={g.family} className="py-1">
                        <div className="px-4 py-1.5 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.family_color }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                            {g.family_label}
                          </span>
                        </div>
                        {g.models.map((m: any) => {
                          const bs = m.badge ? BADGE_STYLE[m.badge as keyof typeof BADGE_STYLE] : null;
                          const isSelected = selectedModel.id === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => selectModel(m)}
                              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 transition-all text-left group hover:bg-white/[0.05]"
                              style={{
                                background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
                              }}
                            >
                              {/* Left: Indicator, Model Name & Badge */}
                              <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0 transition-transform group-hover:scale-125"
                                  style={{ background: m.family_color }}
                                />
                                <span className={`text-[13px] font-medium truncate max-w-[150px] ${isSelected ? "text-white font-semibold" : "text-slate-300 group-hover:text-white"}`}>
                                  {displayVideoModelName(m, false)}
                                </span>
                                {videoMode === "extend" && (
                                  m.pricingConfig?.extendBillingMode === "source_plus_new_segment" ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 font-mono">
                                      SOURCE+NEW
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-mono">
                                      NEW ONLY
                                    </span>
                                  )
                                )}
                                {bs && (
                                  <span
                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
                                    style={{ background: bs.bg, color: bs.text }}
                                  >
                                    {m.badge}
                                  </span>
                                )}
                              </div>

                              {/* Right: Badges exactly matching user's image */}
                              <ModelCapabilityBadges model={m} className="flex-1 justify-end" />
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              // Lipsync models only
              <Popover open={modelOpen} onOpenChange={setModelOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selectedModel.family_color }} />
                    <span className="flex-1 text-[13px]" style={{ color: "#e2e8f0" }}>{displayVideoModelName(selectedModel, false)}</span>
                    {bStyle && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
                        style={{ background: bStyle.bg, color: bStyle.text }}
                      >
                        {selectedModel.badge}
                      </span>
                    )}
                    <ChevronDown
                      size={13}
                      style={{
                        color: "#94a3b8",
                        transform: modelOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }}
                    />
                  </button>
                </PopoverTrigger>

                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={6}
                  collisionPadding={16}
                  className="z-50 p-0 rounded-2xl overflow-hidden border border-white/10 bg-[#090e1a]/95 backdrop-blur-2xl shadow-2xl w-[580px] max-w-[94vw]"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07] bg-white/[0.02]">
                    <span className="text-[12px] font-semibold text-slate-200 tracking-wide">
                      {lang === "ar" ? "اختر موديل مزامنة الشفاه (Lipsync)" : "Select Lipsync Model"}
                    </span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {LIPSYNC_MODELS.length} {lang === "ar" ? "موديل" : "models"}
                    </span>
                  </div>

                  <div className="max-h-[340px] overflow-y-auto py-1.5 divide-y divide-white/[0.04]">
                    {LIPSYNC_MODELS.map(m => {
                      const bs = m.badge ? BADGE_STYLE[m.badge as keyof typeof BADGE_STYLE] : null;
                      const isSelected = selectedModel.id === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => selectModel(m)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 transition-all text-left group hover:bg-white/[0.05]"
                          style={{
                            background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.family_color }} />
                            <span className={`text-[13px] font-medium truncate ${isSelected ? "text-white font-semibold" : "text-slate-300 group-hover:text-white"}`}>
                              {prettyModelName(m.name)}
                            </span>
                            {bs && (
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
                                style={{ background: bs.bg, color: bs.text }}
                              >
                                {m.badge}
                              </span>
                            )}
                          </div>

                          <ModelCapabilityBadges model={m} className="flex-1 justify-end" />
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {supportsCharacterReference && (
            <div className="flex flex-col gap-2" data-character-ref="1">
              <label htmlFor="character-select" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Character Reference</label>
              <select
                id="character-select"
                aria-label={t("Character Reference")}
                value={selectedCharacterId}
                onChange={(e) => setSelectedCharacterId(e.target.value || "")}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e2e8f0",
                }}
              >
                <option value="">No saved character</option>
                {selectableCharacters.map((character) => (
                  <option key={character.id} value={character.id}>{character.name}</option>
                ))}
              </select>
              {selectedCharacter ? (
                <div className="flex gap-3 rounded-xl p-2" style={{ background: hexA(selectedModel.family_color, 0.08), border: `1px solid ${hexA(selectedModel.family_color, 0.22)}` }}>
                  {selectedCharacter.coverUrl ? (
                    <img src={selectedCharacter.coverUrl} alt={selectedCharacter.name} className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <Users size={18} style={{ color: selectedModel.family_color }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold" style={{ color: "#e2e8f0" }}>{selectedCharacter.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px]" style={{ color: "#a1a1aa" }}>{selectedCharacter.description || "Reusable identity reference"}</p>
                    <p className="mt-1 text-[10px]" style={{ color: selectedModel.family_color }}>{characterSupport.label} · {selectedCharacter.referenceUrls.length} reference image(s)</p>
                  </div>
                </div>
              ) : selectableCharacters.length === 0 ? (
                <div className="rounded-xl border border-white/10 px-3 py-2 text-[11px] text-slate-500">
                  {characterSupport.note}
                </div>
              ) : (
                <a href="/character" className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-center text-[11px] text-slate-400 hover:border-white/20 hover:text-slate-300">
                  Create a reusable character
                </a>
              )}
              {selectedCharacter && characterSupport.mode === "kling_element" && selectedCharacter.referenceUrls.length < characterSupport.minImages && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                  Kling 3.0 Elements needs at least {characterSupport.minImages} reference images for this character.
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              KLING 3.0 — Dedicated full-spec panel
              ════════════════════════════════════════════════════════════ */}
          {isKling30Video && (
            <div className="flex flex-col gap-4">

              {/* -- Start / End Frame ---------------------------------------- */}
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Frames</label>

                {/* Side-by-side cards */}
                <div className="grid grid-cols-2 gap-3">

                  {/* ── Start frame ── */}
                  <button
                    onClick={() => openMediaPicker("startFrame")}
                    onDragOver={allowDrop}
                    onDragEnter={(event) => markDropZone(event, "startFrame")}
                    onDragLeave={(event) => clearDropZone(event, "startFrame")}
                    onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("startFrame", file))}
                    className="relative flex flex-col items-center justify-center gap-2 rounded-2xl transition-all overflow-hidden aspect-square w-full"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: `1px solid ${(startFrame || linkedStartFrameUrl || startFramePreview) ? hexA(selectedModel.family_color, 0.4) : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <input ref={startFrameRef} type="file" accept="image/*" className="hidden" onChange={e => selectFrameFile("startFrame", e.target.files?.[0] ?? null)} />
                    {(startFrame || linkedStartFrameUrl || startFramePreview) ? (
                      <>
                        {startFramePreview && <img src={startFramePreview} alt="Start" className="absolute inset-0 w-full h-full object-contain" style={{ padding: 8, background: "#000" }} />}
                        <button aria-label={t("Remove start frame")} className="absolute top-2 left-2 z-10 rounded-full p-1" style={{ background: "rgba(0,0,0,0.75)" }} onClick={e => { e.stopPropagation(); setStartFrame(null); setLinkedStartFrameUrl(null); setStartFramePreview(null); }}><X size={14} style={{ color: "#fff" }} /></button>
                      </>
                    ) : (
                      <>
                        <div className="rounded-full p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <ImageIcon size={20} style={{ color: "#a1a1aa" }} />
                        </div>
                        <span className="text-[12px] font-medium" style={{ color: "#94a3b8" }}>Start frame</span>
                      </>
                    )}
                    {activeDropZone === "startFrame" && <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-cyan-500/15 text-[11px] font-semibold text-cyan-300">Drop here</span>}
                  </button>

                  {/* ── End frame ── */}
                  {!kling30MultiEnabled ? (
                    <button
                      onClick={() => openMediaPicker("endFrame")}
                      onDragOver={allowDrop}
                      onDragEnter={(event) => markDropZone(event, "endFrame")}
                      onDragLeave={(event) => clearDropZone(event, "endFrame")}
                      onDrop={(event) => handleDropSingleImage(event, (file) => selectFrameFile("endFrame", file))}
                      className="relative flex flex-col items-center justify-center gap-2 rounded-2xl transition-all overflow-hidden aspect-square w-full"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${(endFrame || linkedEndFrameUrl || endFramePreview) ? hexA(selectedModel.family_color, 0.4) : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      <input ref={endFrameRef} type="file" accept="image/*" className="hidden" onChange={e => selectFrameFile("endFrame", e.target.files?.[0] ?? null)} />
                      {(endFrame || linkedEndFrameUrl || endFramePreview) ? (
                        <>
                          {endFramePreview && <img src={endFramePreview} alt="End" className="absolute inset-0 w-full h-full object-contain" style={{ padding: 8, background: "#000" }} />}
                          <button aria-label={t("Remove end frame")} className="absolute top-2 left-2 z-10 rounded-full p-1" style={{ background: "rgba(0,0,0,0.75)" }} onClick={e => { e.stopPropagation(); setEndFrame(null); setLinkedEndFrameUrl(null); setEndFramePreview(null); }}><X size={14} style={{ color: "#fff" }} /></button>
                        </>
                      ) : (
                        <>
                          <div className="rounded-full p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <ImageIcon size={20} style={{ color: "#a1a1aa" }} />
                          </div>
                          <span className="text-[12px] font-medium" style={{ color: "#94a3b8" }}>End frame</span>
                        </>
                      )}
                      {activeDropZone === "endFrame" && <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-purple-500/15 text-[11px] font-semibold text-purple-300">Drop here</span>}
                    </button>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl aspect-square w-full opacity-25" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span className="text-[10px] text-center px-2" style={{ color: "#94a3b8" }}>N/A in multi-shot</span>
                    </div>
                  )}
                </div>

                {/* Duplicate warning */}
                {startFrame && endFrame && !kling30MultiEnabled && startFrame.size === endFrame.size && (
                  <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <span className="text-[9px] font-semibold" style={{ color: "#f87171" }}>⚠ Both slots have the same image!</span>
                  </div>
                )}
              </div>

              {/* -- Duration slider ------------------------------------------ */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="duration-range-slider" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Duration</label>
                  <span className="text-[13px] font-bold" style={{ color: selectedModel.family_color }}>{duration ?? 9}s</span>
                </div>
                <input
                  id="duration-range-slider"
                  aria-label={t("Video duration slider")}
                  type="range"
                  min={3}
                  max={15}
                  step={1}
                  value={duration ?? 9}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setDuration(v);
                    // Auto mode: clamp custom shots if over new max
                    if (kling30MultiMode === "custom") {
                      const maxShots = Math.min(5, Math.floor(v / 3));
                      setKling30CustomShots(prev => prev.slice(0, Math.max(1, maxShots)));
                    }
                  }}
                  className="w-full h-1.5 rounded outline-none cursor-pointer"
                  style={{ accentColor: selectedModel.family_color }}
                />
                <div className="flex justify-between text-[10px]" style={{ color: "#94a3b8" }}>
                  <span>3s</span>
                  {kling30MultiEnabled && kling30MultiMode === "auto" && (
                    <span style={{ color: "#a1a1aa" }}>→ {kling30ShotCount} shot{kling30ShotCount > 1 ? "s" : ""}</span>
                  )}
                  <span>15s</span>
                </div>
              </div>

              {/* -- Aspect Ratio --------------------------------------------- */}
              {effectiveAspectRatios.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Aspect Ratio</label>
                  <AspectRatioPicker
                    value={aspectRatio}
                    options={effectiveAspectRatios}
                    onChange={setAspectRatio}
                    accent={selectedModel.family_color}
                  />
                </div>
              )}

              {/* -- Resolution (720p std / 1080p pro / 4K) ------------------- */}
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Resolution</label>
                <div className="flex gap-1">
                  {([["std", "720p"], ["pro", "1080p"], ["4K", "4K"]] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setResolution(val)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all"
                      style={{
                        background: resolution === val ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                        border:     resolution === val ? `1px solid ${hexA(selectedModel.family_color, 0.5)}` : "1px solid rgba(255,255,255,0.06)",
                        color:      resolution === val ? selectedModel.family_color : "#a1a1aa",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px]" style={{ color: "#94a3b8" }}>
                  {resolution === "4K"
                    ? (aspectRatio === "16:9" ? "3840×2160" : aspectRatio === "9:16" ? "2160×3840" : "2160×2160")
                    : resolution === "pro"
                    ? (aspectRatio === "16:9" ? "1920×1080" : aspectRatio === "9:16" ? "1080×1920" : "1080×1080")
                    : (aspectRatio === "16:9" ? "1280×720" : aspectRatio === "9:16" ? "720×1280" : "720×720")}
                </p>
              </div>

              {/* -- Multi-shot toggle ---------------------------------------- */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium" style={{ color: "#94a3b8" }}>Multi-shot</span>
                  <span className="text-[10px]" style={{ color: "#94a3b8" }}>Multiple scenes in one video</span>
                </div>
                <button
                  onClick={() => {
                    const next = !kling30MultiEnabled;
                    setKling30MultiEnabled(next);
                    if (next && endFrame) setEndFrame(null); // clear end frame when enabling multi-shot
                  }}
                  className="relative w-10 h-5 rounded-full transition-all flex-shrink-0"
                  style={{ background: kling30MultiEnabled ? hexA(selectedModel.family_color, 0.7) : "rgba(255,255,255,0.08)" }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                    style={{ left: kling30MultiEnabled ? "calc(100% - 18px)" : 2 }}
                  />
                </button>
              </div>

              {/* -- Multi-shot Builder --------------------------------------- */}
              {kling30MultiEnabled && (
                <div className="flex flex-col gap-3">
                  {/* Auto / Custom tabs */}
                  <div
                    className="flex rounded-lg overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    {(["auto", "custom"] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setKling30MultiMode(mode)}
                        className="flex-1 py-2 text-[12px] font-semibold capitalize transition-all"
                        style={{
                          background: kling30MultiMode === mode ? hexA(selectedModel.family_color, 0.15) : "transparent",
                          color:      kling30MultiMode === mode ? selectedModel.family_color : "#a1a1aa",
                          borderBottom: kling30MultiMode === mode ? `2px solid ${selectedModel.family_color}` : "2px solid transparent",
                        }}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* AUTO MODE */}
                  {kling30MultiMode === "auto" && (
                    <div
                      className="rounded-xl p-3 flex flex-col gap-1"
                      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${hexA(selectedModel.family_color, 0.15)}` }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px]" style={{ color: "#94a3b8" }}>Shots</span>
                        <span className="text-[14px] font-bold" style={{ color: selectedModel.family_color }}>{kling30ShotCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px]" style={{ color: "#94a3b8" }}>Duration per shot</span>
                        <span className="text-[12px]" style={{ color: "#a1a1aa" }}>≈ {Math.floor((duration ?? 9) / kling30ShotCount)}s each</span>
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: "#94a3b8" }}>
                        Auto divides {duration ?? 9}s into {kling30ShotCount} scene{kling30ShotCount > 1 ? "s" : ""} using your prompt.
                      </p>
                    </div>
                  )}

                  {/* CUSTOM MODE */}
                  {kling30MultiMode === "custom" && (
                    <div className="flex flex-col gap-2">
                      {/* Duration status bar */}
                      <div
                        className="flex items-center justify-between rounded-lg px-3 py-2"
                        style={{
                          background: kling30CustomDurationValid ? "rgba(16,185,129,0.08)" : kling30CustomDurationRemaining < 0 ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                          border: `1px solid ${kling30CustomDurationValid ? "rgba(16,185,129,0.3)" : kling30CustomDurationRemaining < 0 ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                        }}
                      >
                        <span className="text-[11px]" style={{ color: kling30CustomDurationValid ? "#34d399" : kling30CustomDurationRemaining < 0 ? "#f87171" : "#fbbf24" }}>
                          {kling30CustomDurationValid
                            ? `✓ ${kling30CustomTotalDuration}s — matches target`
                            : kling30CustomDurationRemaining > 0
                              ? `${kling30CustomTotalDuration}s / ${kling30DurationTarget}s — ${kling30CustomDurationRemaining}s remaining`
                              : `${kling30CustomTotalDuration}s / ${kling30DurationTarget}s — ${Math.abs(kling30CustomDurationRemaining)}s over`}
                        </span>
                      </div>

                      {/* Shot list */}
                      <div className="flex flex-col gap-1.5">
                        {kling30CustomShots.map((shot, i) => (
                          <div
                            key={i}
                            className="flex flex-col gap-1 rounded-xl p-2"
                            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${hexA(selectedModel.family_color, 0.15)}` }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: hexA(selectedModel.family_color, 0.15), color: selectedModel.family_color }}
                              >
                                Shot {i + 1}
                              </span>
                              {/* Duration input */}
                              <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                                <button
                                  onClick={() => setKling30CustomShots(prev => prev.map((s, idx) => idx === i ? { ...s, duration: Math.max(1, s.duration - 1) } : s))}
                                  className="w-5 h-5 rounded flex items-center justify-center text-[12px] font-bold"
                                  style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                                >−</button>
                                <span className="text-[11px] w-6 text-center" style={{ color: selectedModel.family_color }}>{shot.duration}s</span>
                                <button
                                  onClick={() => setKling30CustomShots(prev => prev.map((s, idx) => idx === i ? { ...s, duration: Math.min(12, s.duration + 1) } : s))}
                                  className="w-5 h-5 rounded flex items-center justify-center text-[12px] font-bold"
                                  style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                                >+</button>
                              </div>
                              {kling30CustomShots.length > 1 && (
                                <button onClick={() => setKling30CustomShots(prev => prev.filter((_, idx) => idx !== i))}>
                                  <X size={10} style={{ color: "#94a3b8" }} />
                                </button>
                              )}
                            </div>
                            <textarea
                              value={shot.prompt}
                              onChange={e => setKling30CustomShots(prev => prev.map((s, idx) => idx === i ? { ...s, prompt: e.target.value } : s))}
                              placeholder={`Scene ${i + 1} description…`}
                              rows={2}
                              className="w-full bg-transparent rounded-lg px-2 py-1.5 text-[11px] outline-none resize-none"
                              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${hexA(selectedModel.family_color, 0.15)}`, color: "#94a3b8" }}
                            />
                          </div>
                        ))}
                      </div>

                      {/* Add shot button */}
                      {kling30CustomShots.length < Math.min(5, Math.floor((duration ?? 9) / 1)) && (
                        <button
                          onClick={() => setKling30CustomShots(prev => [...prev, { prompt: "", duration: 3 }])}
                          className="text-[11px] py-2 rounded-lg transition-all"
                          style={{ background: hexA(selectedModel.family_color, 0.08), color: selectedModel.family_color, border: `1px dashed ${hexA(selectedModel.family_color, 0.3)}` }}
                        >
                          + Add Shot ({kling30CustomShots.length}/5 max)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* -- Elements system ------------------------------------------ */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                    Elements
                  </label>
                  {klingEls.length < 3 && (
                    <button
                      onClick={() => setKlingEls(prev => [...prev, { name: "", description: "", files: [], previews: [] }])}
                      className="text-[10px] px-2 py-0.5 rounded-md transition-all"
                      style={{ background: hexA(selectedModel.family_color, 0.12), color: selectedModel.family_color, border: `1px solid ${hexA(selectedModel.family_color, 0.3)}` }}
                    >
                      + Add Element
                    </button>
                  )}
                </div>
                {klingEls.length === 0 && (
                  <p className="text-[10px]" style={{ color: "#94a3b8" }}>
                    Elements let you reference consistent characters or objects using <span style={{ color: "#a1a1aa" }}>@element_name</span> in your prompt.
                  </p>
                )}
                {klingEls.map((el, elIdx) => {
                  const trimmedName = el.name.trim();
                  const trimmedDesc = el.description.trim();
                  const validImages = el.files.filter(Boolean).length;
                  const isInPrompt = trimmedName ? new RegExp(`@${trimmedName}\\b`, "i").test(prompt) : false;
                  const isComplete = trimmedName && trimmedDesc && validImages >= 2 && isInPrompt;
                  return (
                  <div
                    key={elIdx}
                    className="flex flex-col gap-2 rounded-xl p-3"
                    style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${isComplete ? "rgba(16,185,129,0.4)" : hexA(selectedModel.family_color, 0.2)}` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium" style={{ color: selectedModel.family_color }}>Element {elIdx + 1}</span>
                        {isComplete ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>✓ Ready</span>
                        ) : (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>⚠ Incomplete</span>
                        )}
                      </div>
                      <button onClick={() => setKlingEls(prev => prev.filter((_, i) => i !== elIdx))}><X size={11} style={{ color: "#94a3b8" }} /></button>
                    </div>
                    <input
                      value={el.name}
                      onChange={e => setKlingEls(prev => prev.map((v, i) => i === elIdx ? { ...v, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") } : v))}
                      placeholder="Name (letters/digits only — used as @name)"
                      className="w-full bg-transparent rounded-lg px-3 py-2 text-[12px] outline-none"
                      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${trimmedName ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`, color: "#94a3b8" }}
                    />
                    <input
                      value={el.description}
                      onChange={e => setKlingEls(prev => prev.map((v, i) => i === elIdx ? { ...v, description: e.target.value } : v))}
                      placeholder="Brief description of this element"
                      className="w-full bg-transparent rounded-lg px-3 py-2 text-[12px] outline-none"
                      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${trimmedDesc ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`, color: "#94a3b8" }}
                    />
                    {/* Image slots (2 required + 2 optional) */}
                    <div className="grid grid-cols-4 gap-1">
                      {Array.from({ length: 4 }).map((_, imgIdx) => {
                        const preview = el.previews[imgIdx];
                        const hasFile = !!el.files[imgIdx];
                        const isRequired = imgIdx < 2;
                        return (
                          <label
                            key={imgIdx}
                            className="relative flex flex-col items-center justify-center rounded-lg border border-dashed cursor-pointer overflow-hidden"
                            style={{ height: 52, borderColor: hasFile ? hexA(selectedModel.family_color, 0.5) : isRequired ? "rgba(100,116,139,0.4)" : "rgba(255,255,255,0.06)", background: hasFile ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)" }}
                          >
                            <input
                              type="file" accept="image/*" className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const url = URL.createObjectURL(file);
                                setKlingEls(prev => prev.map((v, i) => {
                                  if (i !== elIdx) return v;
                                  const newFiles = [...v.files];
                                  const newPreviews = [...v.previews];
                                  if (newPreviews[imgIdx]) URL.revokeObjectURL(newPreviews[imgIdx]);
                                  newFiles[imgIdx] = file;
                                  newPreviews[imgIdx] = url;
                                  return { ...v, files: newFiles, previews: newPreviews };
                                }));
                              }}
                            />
                            {preview ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                <button
                                  type="button" className="absolute top-0.5 right-0.5 z-10"
                                  onClick={e => {
                                    e.preventDefault();
                                    setKlingEls(prev => prev.map((v, i) => {
                                      if (i !== elIdx) return v;
                                      const nf = [...v.files]; const np = [...v.previews];
                                      if (np[imgIdx]) URL.revokeObjectURL(np[imgIdx]);
                                      nf.splice(imgIdx, 1); np.splice(imgIdx, 1);
                                      return { ...v, files: nf, previews: np };
                                    }));
                                  }}
                                ><X size={9} style={{ color: "#fff" }} /></button>
                              </>
                            ) : (
                              <span className="text-[8px] text-center px-1" style={{ color: isRequired ? "#a1a1aa" : "#94a3b8" }}>
                                {isRequired ? "Req." : "Opt."}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    {el.files.filter(Boolean).length < 2 && (
                      <span className="text-[10px]" style={{ color: "#ef4444" }}>⚠ Upload at least 2 images for this element.</span>
                    )}
                    {trimmedName && (
                      <div className="flex items-center gap-1.5 flex-wrap rounded-lg px-2 py-1.5" style={{
                        background: isInPrompt ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
                        border: `1px solid ${isInPrompt ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                      }}>
                        {isInPrompt ? (
                          <span className="text-[9px] font-semibold" style={{ color: "#34d399" }}>✓ @{trimmedName} is in prompt</span>
                        ) : (
                          <>
                            <span className="text-[9px]" style={{ color: "#f87171" }}>⚠ Add to prompt:</span>
                            <button
                              onClick={() => setPrompt(prev => prev.trimEnd() + (prev ? " " : "") + `@${trimmedName}`)}
                              className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: hexA(selectedModel.family_color, 0.18), color: selectedModel.family_color, border: `1px solid ${hexA(selectedModel.family_color, 0.4)}` }}
                            >
                              + Insert @{trimmedName}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              {/* -- Sound ---------------------------------------------------- */}
              {caps.has_sound && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Music2 size={13} style={{ color: "#94a3b8" }} />
                    <div className="flex flex-col">
                      <span className="text-[12px]" style={{ color: "#a1a1aa" }}>Generate Sound</span>
                      <span className="text-[10px]" style={{ color: "#94a3b8" }}>AI-generated audio track - included</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSound(v => !v)}
                    className="relative w-10 h-5 rounded-full transition-all flex-shrink-0"
                    style={{ background: sound ? hexA(selectedModel.family_color, 0.7) : "rgba(255,255,255,0.08)" }}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: sound ? "calc(100% - 18px)" : 2 }} />
                  </button>
                </div>
              )}

              {/* -- Loop / Ping-Pong ------------------------------------------- */}
              {caps.has_loop && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Repeat size={13} style={{ color: "#94a3b8" }} />
                    <div className="flex flex-col">
                      <span className="text-[12px]" style={{ color: "#a1a1aa" }}>{t("Loop / Ping-Pong")}</span>
                      <span className="text-[10px]" style={{ color: "#94a3b8" }}>{t("Seamless looping playback")}</span>
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={loop}
                    aria-label={t("Toggle Loop")}
                    onClick={() => setLoop(v => !v)}
                    className="relative w-10 h-5 rounded-full transition-all flex-shrink-0"
                    style={{ background: loop ? hexA(selectedModel.family_color, 0.7) : "rgba(255,255,255,0.08)" }}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: loop ? "calc(100% - 18px)" : 2 }} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              GENERIC controls — shown for all models EXCEPT Kling 3.0
              ════════════════════════════════════════════════════════════ */}
          {!isKling30Video && (<>

          {/* -- Veo 3.1 — Duration buttons (Google spec: 4 / 6 / 8 only) ---- */}

          {/* -- Duration ---------------------------------------------------- */}
          {durationChoices.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="duration-select" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Duration
              </label>
              <div className="relative">
                <select
                  id="duration-select"
                  aria-label={t("Duration")}
                  value={duration ?? durationChoices[0]}
                  onChange={e => setDuration(Number(e.target.value))}
                  className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-lg text-[13px] outline-none cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${hexA(selectedModel.family_color, 0.25)}`,
                    color: selectedModel.family_color,
                  }}
                >
                  {durationChoices.map(d => (
                    <option key={d} value={d} style={{ background: "#0a1220", color: "#e2e8f0" }}>
                      {d}s
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94a3b8" }} />
              </div>
            </div>
          )}

          {/* -- Aspect ratio ------------------------------------------------ */}
          {effectiveAspectRatios.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="aspect-ratio-select" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Aspect Ratio
              </label>
              <AspectRatioPicker
                id="aspect-ratio-select"
                value={aspectRatio}
                options={effectiveAspectRatios}
                onChange={setAspectRatio}
                accent={selectedModel.family_color}
              />
            </div>
          )}

          {/* -- Orientation / Size (for size-based models like Sora 2) ------- */}
          {caps.sizes.length > 0 && size != null && (
            <div className="flex flex-col gap-2">
              <label htmlFor="orientation-select" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Orientation
              </label>
              <div className="relative">
                <select
                  id="orientation-select"
                  aria-label={t("Orientation")}
                  value={size}
                  onChange={e => setSize(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-lg text-[13px] outline-none cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${hexA(selectedModel.family_color, 0.25)}`,
                    color: selectedModel.family_color,
                  }}
                >
                  {caps.sizes.map(s => (
                    <option key={s} value={s} style={{ background: "#0a1220", color: "#e2e8f0" }}>
                      {sizeLabel(s)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94a3b8" }} />
              </div>
            </div>
          )}

          {/* -- Quality ----------------------------------------------------- */}
          {resolutionChoices.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="quality-select" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Quality
              </label>
              <div className="relative">
                <select
                  id="quality-select"
                  aria-label={t("Quality")}
                  value={resolution ?? resolutionChoices[0]}
                  onChange={e => setResolution(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-lg text-[13px] outline-none cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "#e2e8f0",
                  }}
                >
                  {resolutionChoices.map(r => (
                    <option key={r} value={r} style={{ background: "#0a1220", color: "#e2e8f0" }}>
                      {r === "std" ? "std" : r === "pro" ? "pro" : r.toLowerCase() === "4k" ? "4K" : r.toLowerCase() === "2k" ? "2K" : r}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "#94a3b8" }}
                />
              </div>
            </div>
          )}

          {/* -- Scene Control Mode (Kling Motion) -------------------------- */}
          {caps.has_scene_control && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color: "#a1a1aa" }}>Scene Control Mode</span>
              </div>
              <button
                role="switch"
                aria-checked={sceneControl}
                aria-label={t("Toggle Scene Control Mode")}
                onClick={() => setSceneControl(v => !v)}
                className="relative w-9 h-5 rounded-full transition-all"
                style={{ background: sceneControl ? hexA(selectedModel.family_color, 0.6) : "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: sceneControl ? "calc(100% - 18px)" : 2 }}
                />
              </button>
            </div>
          )}

          {/* -- Orientation (Kling Motion) ---------------------------------- */}
          {caps.has_orientation && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Orientation
              </label>
              <div className="flex gap-1">
                {(["video", "image"] as const).map(o => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    className="flex-1 py-2 rounded-lg text-[12px] font-medium capitalize transition-all"
                    style={{
                      background: orientation === o ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                      border:     orientation === o ? `1px solid ${hexA(selectedModel.family_color, 0.4)}` : "1px solid rgba(255,255,255,0.06)",
                      color:      orientation === o ? selectedModel.family_color : "#a1a1aa",
                    }}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* -- CFG Scale --------------------------------------------------- */}
          {caps.has_cfg_scale && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="cfg-scale-range-slider" className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                  CFG Scale
                </label>
                <span className="text-[12px]" style={{ color: selectedModel.family_color }}>
                  {cfgScale.toFixed(1)}
                </span>
              </div>
              <input
                id="cfg-scale-range-slider"
                aria-label={t("CFG Scale slider")}
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={cfgScale}
                onChange={e => setCfgScale(parseFloat(e.target.value))}
                className="w-full h-1 rounded outline-none"
                style={{ accentColor: selectedModel.family_color }}
              />
              <div className="flex justify-between text-[10px]" style={{ color: "#94a3b8" }}>
                <span>Flexible</span>
                <span>Strict</span>
              </div>
            </div>
          )}

          {/* -- Multi-Prompt (Kling) ----------------------------------------- */}
          {caps.has_multi_prompt && showOmniTabs && (
            <div className="flex items-center justify-between">
              <span className="text-[12px]" style={{ color: "#a1a1aa" }}>Multi-shot</span>
              <button
                role="switch"
                aria-checked={multiShotEnabled}
                aria-label={t("Toggle Multi-shot Mode")}
                onClick={() => setMultiPrompts(prev => prev.length === 1 && prev[0] === "" ? ["", ""] : [""])}
                className="relative w-9 h-5 rounded-full transition-all"
                style={{ background: multiShotEnabled ? hexA(selectedModel.family_color, 0.6) : "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: multiShotEnabled ? "calc(100% - 18px)" : 2 }}
                />
              </button>
            </div>
          )}

          {/* -- Shot Type (Kling) -------------------------------------------- */}
          {caps.has_shot_type && multiShotEnabled && (
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                Shot Type
              </label>
              <div className="flex gap-1">
                {(["intelligent", "customize"] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setShotType(st)}
                    className="flex-1 py-2 rounded-lg text-[12px] font-medium capitalize transition-all"
                    style={{
                      background: shotType === st ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                      border:     shotType === st ? `1px solid ${hexA(selectedModel.family_color, 0.4)}` : "1px solid rgba(255,255,255,0.06)",
                      color:      shotType === st ? selectedModel.family_color : "#a1a1aa",
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          )}
          {caps.has_multi_prompt && showOmniTabs && multiShotEnabled && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                  Multi-Shot Prompts
                </label>
                <button
                  onClick={() => {
                    if (!canAddMoreShots) return;
                    setMultiPrompts(prev => [...prev, ""]);
                  }}
                  disabled={!canAddMoreShots}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-all"
                  style={{
                    background: hexA(selectedModel.family_color, 0.12),
                    color: canAddMoreShots ? selectedModel.family_color : "#a1a1aa",
                    border: `1px solid ${canAddMoreShots ? hexA(selectedModel.family_color, 0.3) : "rgba(100,116,139,0.4)"}`,
                    cursor: canAddMoreShots ? "pointer" : "not-allowed",
                    opacity: canAddMoreShots ? 1 : 0.6,
                  }}
                >
                  + Add Shot
                </button>
              </div>
                {duration != null && activeMultiPromptIndexes.length > 0 && (
                  <span className="text-[10px]" style={{ color: "#a1a1aa" }}>
                    Total {duration}s split across {activeMultiPromptIndexes.length} shot(s). Remainder goes to the last shot.
                  </span>
                )}
              <span className="text-[10px]" style={{ color: "#a1a1aa" }}>
                Max shots for current duration: {maxShotsAllowed}
              </span>
              <div className="flex flex-col gap-1.5">
                {multiPrompts.map((mp, i) => (
                  <div key={i} className="relative">
                    <textarea
                      value={mp}
                      onChange={e => setMultiPrompts(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                      placeholder={`Shot ${i + 1} scene…`}
                      rows={2}
                      className="w-full bg-transparent rounded-lg px-3 py-2 pr-16 text-[12px] outline-none resize-none"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${hexA(selectedModel.family_color, 0.2)}`,
                        color: "#94a3b8",
                      }}
                    />
                    {shotDurationsByIndex[i] != null && (
                      <span
                        className="absolute top-1.5 right-7 text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                      >
                        {shotDurationsByIndex[i]}s
                      </span>
                    )}
                    {multiPrompts.length > 2 && (
                      <button
                        onClick={() => setMultiPrompts(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1.5 right-1.5"
                      >
                        <X size={11} style={{ color: "#94a3b8" }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {caps.has_multi_prompt && !showOmniTabs && (
            <div className="flex items-center justify-between">
              <span className="text-[12px]" style={{ color: "#a1a1aa" }}>Multi-shot</span>
              <button
                role="switch"
                aria-checked={multiShotEnabled}
                aria-label={t("Toggle Multi-shot Mode")}
                onClick={() => setMultiPrompts(prev => prev.length === 1 && prev[0] === "" ? ["", ""] : [""])}
                className="relative w-9 h-5 rounded-full transition-all"
                style={{ background: multiShotEnabled ? hexA(selectedModel.family_color, 0.6) : "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: multiShotEnabled ? "calc(100% - 18px)" : 2 }}
                />
              </button>
            </div>
          )}
          {caps.has_multi_prompt && !showOmniTabs && multiShotEnabled && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                  Multi-Shot Prompts
                </label>
                <button
                  onClick={() => {
                    if (!canAddMoreShots) return;
                    setMultiPrompts(prev => [...prev, ""]);
                  }}
                  disabled={!canAddMoreShots}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-all"
                  style={{
                    background: hexA(selectedModel.family_color, 0.12),
                    color:      canAddMoreShots ? selectedModel.family_color : "#a1a1aa",
                    border:     `1px solid ${canAddMoreShots ? hexA(selectedModel.family_color, 0.3) : "rgba(100,116,139,0.4)"}`,
                    cursor:     canAddMoreShots ? "pointer" : "not-allowed",
                    opacity:    canAddMoreShots ? 1 : 0.6,
                  }}
                >
                  + Add Shot
                </button>
              </div>
              {duration != null && activeMultiPromptIndexes.length > 0 && (
                <span className="text-[10px]" style={{ color: "#a1a1aa" }}>
                  Total {duration}s split across {activeMultiPromptIndexes.length} shot(s). Remainder goes to the last shot.
                </span>
              )}
              <span className="text-[10px]" style={{ color: "#a1a1aa" }}>
                Max shots for current duration: {maxShotsAllowed}
              </span>
              <div className="flex flex-col gap-1.5">
                {multiPrompts.map((mp, i) => (
                  <div key={i} className="relative">
                    <textarea
                      value={mp}
                      onChange={e => setMultiPrompts(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                      placeholder={`Shot ${i + 1} scene…`}
                      rows={2}
                      className="w-full bg-transparent rounded-lg px-3 py-2 pr-7 text-[12px] outline-none resize-none"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border:     `1px solid ${hexA(selectedModel.family_color, 0.2)}`,
                        color:      "#94a3b8",
                      }}
                    />
                    {shotDurationsByIndex[i] != null && (
                      <span
                        className="absolute top-1.5 right-7 text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                      >
                        {shotDurationsByIndex[i]}s
                      </span>
                    )}
                    {multiPrompts.length > 1 && (
                      <button
                        onClick={() => setMultiPrompts(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1.5 right-1.5"
                      >
                        <X size={11} style={{ color: "#94a3b8" }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -- Element List (Kling) ----------------------------------------- */}
          {caps.has_element_list && !showOmniTabs && !isKlingElementModel && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                  Element List
                </label>
                <button
                  onClick={() => setElementList((prev) => [...prev, ""])}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", color: "#a1a1aa", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  + Add
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {elementList.map((el, i) => (
                  <div key={i} className="relative">
                    <input
                      value={el}
                      onChange={e => setElementList(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                      placeholder={`Element ID ${i + 1}`}
                      className="w-full bg-transparent rounded-lg px-3 py-2 pr-7 text-[12px] outline-none"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border:     "1px solid rgba(255,255,255,0.06)",
                        color:      "#94a3b8",
                      }}
                    />
                    {elementList.length > 1 && (
                      <button
                        onClick={() => setElementList(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1.5 right-1.5"
                      >
                        <X size={11} style={{ color: "#94a3b8" }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -- Kling 3.0 Elements (name + description + 2-4 images, max 3) -- */}
          {showKling30Elements && !showOmniTabs && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                  Elements
                </label>
                {klingEls.length < 3 && (
                  <button
                    onClick={() => setKlingEls(prev => [...prev, { name: "", description: "", files: [], previews: [] }])}
                    className="text-[10px] px-2 py-0.5 rounded-md transition-all"
                    style={{ background: hexA(selectedModel.family_color, 0.12), color: selectedModel.family_color, border: `1px solid ${hexA(selectedModel.family_color, 0.3)}` }}
                  >
                    + Add Element
                  </button>
                )}
              </div>
              <p className="text-[10px] -mt-2" style={{ color: "#a1a1aa" }}>
                Each element needs 2–4 images. Reference it in your prompt as <span style={{ color: "#94a3b8" }}>@element_name</span>.
              </p>
              {klingEls.map((el, elIdx) => (
                <div
                  key={elIdx}
                  className="flex flex-col gap-2 rounded-xl p-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${hexA(selectedModel.family_color, 0.2)}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium" style={{ color: selectedModel.family_color }}>Element {elIdx + 1}</span>
                    <button onClick={() => setKlingEls(prev => prev.filter((_, i) => i !== elIdx))}>
                      <X size={11} style={{ color: "#94a3b8" }} />
                    </button>
                  </div>
                  <input
                    value={el.name}
                    onChange={e => setKlingEls(prev => prev.map((v, i) => i === elIdx ? { ...v, name: e.target.value } : v))}
                    placeholder="Name (e.g. hero, car, logo)"
                    className="w-full bg-transparent rounded-lg px-3 py-2 text-[12px] outline-none"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}
                  />
                  <input
                    value={el.description}
                    onChange={e => setKlingEls(prev => prev.map((v, i) => i === elIdx ? { ...v, description: e.target.value } : v))}
                    placeholder="Brief description of this element"
                    className="w-full bg-transparent rounded-lg px-3 py-2 text-[12px] outline-none"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}
                  />
                  {/* Image slots (2-4) */}
                  <div className="grid grid-cols-4 gap-1">
                    {Array.from({ length: 4 }).map((_, imgIdx) => {
                      const preview = el.previews[imgIdx];
                      const hasFile = !!el.files[imgIdx];
                      return (
                        <label
                          key={imgIdx}
                          className="relative flex flex-col items-center justify-center rounded-lg border border-dashed cursor-pointer overflow-hidden"
                          style={{
                            height: 56,
                            borderColor: hasFile ? hexA(selectedModel.family_color, 0.5) : "rgba(255,255,255,0.1)",
                            background:  hasFile ? hexA(selectedModel.family_color, 0.07) : "rgba(255,255,255,0.02)",
                          }}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const url = URL.createObjectURL(file);
                              setKlingEls(prev => prev.map((v, i) => {
                                if (i !== elIdx) return v;
                                const newFiles = [...v.files];
                                const newPreviews = [...v.previews];
                                // Revoke old preview if present
                                if (newPreviews[imgIdx]) URL.revokeObjectURL(newPreviews[imgIdx]);
                                newFiles[imgIdx] = file;
                                newPreviews[imgIdx] = url;
                                return { ...v, files: newFiles, previews: newPreviews };
                              }));
                            }}
                          />
                          {preview ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover" />
                              <button
                                type="button"
                                className="absolute top-0.5 right-0.5 z-10"
                                onClick={e => {
                                  e.preventDefault();
                                  setKlingEls(prev => prev.map((v, i) => {
                                    if (i !== elIdx) return v;
                                    const newFiles = [...v.files];
                                    const newPreviews = [...v.previews];
                                    if (newPreviews[imgIdx]) URL.revokeObjectURL(newPreviews[imgIdx]);
                                    newFiles.splice(imgIdx, 1);
                                    newPreviews.splice(imgIdx, 1);
                                    return { ...v, files: newFiles, previews: newPreviews };
                                  }));
                                }}
                              >
                                <X size={9} style={{ color: "#fff" }} />
                              </button>
                            </>
                          ) : (
                            <span className="text-[9px]" style={{ color: imgIdx < 2 ? "#a1a1aa" : "#94a3b8" }}>
                              {imgIdx < 2 ? "Required" : "Optional"}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {el.files.length < 2 && (
                    <span className="text-[10px]" style={{ color: "#ef4444" }}>Upload at least 2 images for this element.</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* -- Sound toggle ------------------------------------------------ */}
          {caps.has_sound && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music2 size={13} style={{ color: "#94a3b8" }} />
                <span className="text-[12px]" style={{ color: "#a1a1aa" }}>Generate Sound</span>
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24" }}
                >
                  included
                </span>
              </div>
              <button
                role="switch"
                aria-checked={sound}
                aria-label={t("Toggle Sound Generation")}
                onClick={() => setSound(v => !v)}
                className="relative w-9 h-5 rounded-full transition-all"
                style={{ background: sound ? hexA(selectedModel.family_color, 0.6) : "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: sound ? "calc(100% - 18px)" : 2 }}
                />
              </button>
            </div>
          )}

          {/* -- Loop / Ping-Pong ------------------------------------------- */}
          {caps.has_loop && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat size={13} style={{ color: "#94a3b8" }} />
                <div className="flex flex-col">
                  <span className="text-[12px]" style={{ color: "#a1a1aa" }}>{t("Loop / Ping-Pong")}</span>
                  <span className="text-[10px]" style={{ color: "#94a3b8" }}>{t("Seamless looping playback")}</span>
                </div>
              </div>
              <button
                role="switch"
                aria-checked={loop}
                aria-label={t("Toggle Loop")}
                onClick={() => setLoop(v => !v)}
                className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
                style={{ background: loop ? hexA(selectedModel.family_color, 0.6) : "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: loop ? "calc(100% - 18px)" : 2 }}
                />
              </button>
            </div>
          )}

          </>)} {/* end !isKling30Video generic controls */}
          </>)}

          {/* Fix #3: Cost Breakdown Widget (تفصيل التكلفة الحية) */}
          {videoMode === "extend" && (
            <div className="rounded-xl bg-zinc-950/60 border border-zinc-800/60 p-3 my-2 space-y-2">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                {lang === "ar" ? "تفصيل التكلفة" : "Cost Breakdown"}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">{lang === "ar" ? "الجزء الجديد" : "New segment"}</span>
                  <span className="font-mono text-zinc-300">{duration ?? 5}s</span>
                </div>
                {(selectedModel as any).pricingConfig?.extendBillingMode === "source_plus_new_segment" && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">{lang === "ar" ? "سياق المصدر" : "Source context"}</span>
                    <span className="font-mono text-amber-400">
                      {(selectedModel as any).pricingConfig?.extendDefaultSourceContextSec ?? 5}s
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-500">{lang === "ar" ? "الدقة" : "Resolution"}</span>
                  <span className="font-mono text-zinc-300">{resolution ?? "720p"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{lang === "ar" ? "السعر/ثانية" : "Rate/s"}</span>
                  <span className="font-mono text-zinc-300">
                    ${((selectedModel as any).pricingConfig?.extendStickerRates?.[resolution ?? "720p"] ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{lang === "ar" ? "خصم المزود" : "Provider discount"}</span>
                  <span className="font-mono text-emerald-400">
                    {Math.round((1 - ((selectedModel as any).pricingConfig?.discountMultiplier ?? 0.9)) * 100)}%
                  </span>
                </div>
                <div className="flex justify-between col-span-2 pt-1.5 border-t border-zinc-800/60">
                  <span className="text-zinc-400 font-semibold">{lang === "ar" ? "المجموع" : "Total"}</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {estimatedCredits} credits
                  </span>
                </div>
              </div>
            </div>
          )}



        </div>
        )}
      </aside>

      {/* ── Media Gallery Picker Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {mediaPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(10px)" }}
            onClick={() => setMediaPicker(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 12 }}
              animate={{ scale: 1,    opacity: 1, y: 0 }}
              exit={{ scale: 0.94,    opacity: 0, y: 8 }}
              transition={{ duration: 0.2, type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
              className="flex flex-col rounded-2xl overflow-hidden"
              style={{
                width: "min(720px, 92vw)",
                height: "min(540px, 82vh)",
                background: "#0a1220",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "0 32px 72px rgba(0,0,0,0.85)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-2">
                  {mediaPicker === "motionVideo"
                    ? <Film size={15} style={{ color: selectedModel.family_color }} />
                    : <ImageIcon size={15} style={{ color: selectedModel.family_color }} />
                  }
                  <span className="text-[14px] font-semibold" style={{ color: "#e2e8f0" }}>
                    {mediaPicker === "motionVideo"
                      ? "Select Video"
                      : mediaPicker === "referenceImages" && canPickReferenceMedia
                        ? `Upload media - ${referenceFileSummary}`
                        : mediaPicker === "referenceImages"
                          ? `Select Reference Image (${referenceFileSummary})`
                          : mediaPicker === "endFrame" ? "Select End Frame" : "Select Start Frame"}
                  </span>
                </div>
                <button
                  onClick={() => setMediaPicker(null)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/08 transition-all"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <X size={13} style={{ color: "#a1a1aa" }} />
                </button>
              </div>

              {/* Tabs */}
              <div
                className="flex items-center gap-1 px-5 py-2.5 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                {/* Upload from device */}
                <button
                  onClick={() => setPickerTab("upload")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                  style={{
                    background: pickerTab === "upload" ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                    border:     `1px solid ${pickerTab === "upload" ? hexA(selectedModel.family_color, 0.35) : "rgba(255,255,255,0.06)"}`,
                    color:      pickerTab === "upload" ? selectedModel.family_color : "#a1a1aa",
                  }}
                >
                  <Upload size={11} />
                  Device
                </button>
                {/* Generated images */}
                <button
                  onClick={async () => { setPickerTab("images"); await loadPickerAssets("image"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                  style={{
                    background: pickerTab === "images" ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                    border:     `1px solid ${pickerTab === "images" ? hexA(selectedModel.family_color, 0.35) : "rgba(255,255,255,0.06)"}`,
                    color:      pickerTab === "images" ? selectedModel.family_color : "#a1a1aa",
                  }}
                >
                  <ImageIcon size={11} />
                  Generated Images
                </button>
                {/* Generated videos */}
                <button
                  onClick={async () => { setPickerTab("videos"); await loadPickerAssets("video"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                  style={{
                    background: pickerTab === "videos" ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                    border:     `1px solid ${pickerTab === "videos" ? hexA(selectedModel.family_color, 0.35) : "rgba(255,255,255,0.06)"}`,
                    color:      pickerTab === "videos" ? selectedModel.family_color : "#a1a1aa",
                  }}
                >
                  <Film size={11} />
                  Generated Videos
                </button>
                {/* Generated audio */}
                <button
                  onClick={async () => { setPickerTab("audio"); await loadPickerAssets("audio"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                  style={{
                    background: pickerTab === "audio" ? hexA(selectedModel.family_color, 0.15) : "rgba(255,255,255,0.04)",
                    border:     `1px solid ${pickerTab === "audio" ? hexA(selectedModel.family_color, 0.35) : "rgba(255,255,255,0.06)"}`,
                    color:      pickerTab === "audio" ? selectedModel.family_color : "#a1a1aa",
                  }}
                >
                  <AudioLines size={11} />
                  Generated Audio
                </button>
              </div>

              {/* Content area */}
              <div className="flex-1 overflow-y-auto p-4">
                {pickerTab === "upload" ? (
                  /* Device upload zone with 100% native iOS/Android tap support */
                  <label
                    className="w-full h-full min-h-48 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-all hover:border-opacity-60 cursor-pointer"
                    style={{ borderColor: hexA(selectedModel.family_color, 0.3) }}
                  >
                    <input
                      type="file"
                      className="hidden"
                      multiple={mediaPicker === "referenceImages"}
                      accept={
                        mediaPicker === "motionVideo"
                          ? "video/mp4,video/quicktime,video/webm,video/x-matroska"
                          : mediaPicker === "referenceImages" && canPickReferenceMedia
                            ? "image/*,video/*,audio/*"
                            : "image/*"
                      }
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length === 0) return;
                        const target = mediaPicker;
                        if (target === "startFrame") {
                          if (guardSeedanceMediaSelection("startFrame")) return;
                          selectFrameFile("startFrame", files[0]);
                          setLinkedStartFrameUrl(null);
                        } else if (target === "endFrame") {
                          if (guardSeedanceMediaSelection("endFrame")) return;
                          selectFrameFile("endFrame", files[0]);
                          setLinkedEndFrameUrl(null);
                        } else if (target === "motionVideo") {
                          setMotionVideo(files[0]);
                        } else if (target === "referenceImages") {
                          addReferenceFiles(files);
                        }
                        e.target.value = "";
                        setMediaPicker(null);
                      }}
                    />
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center pointer-events-none"
                      style={{ background: hexA(selectedModel.family_color, 0.1) }}
                    >
                      <Upload size={24} style={{ color: selectedModel.family_color }} />
                    </div>
                    <div className="text-center pointer-events-none">
                      <p className="text-[14px] font-semibold" style={{ color: "#e2e8f0" }}>
                        Upload from device
                      </p>
                      <p className="text-[12px] mt-1" style={{ color: "#94a3b8" }}>
                        {mediaPicker === "motionVideo"
                          ? "MP4, MOV, WebM"
                          : mediaPicker === "referenceImages" && canPickReferenceMedia
                            ? "Image, Video or Audio"
                            : "PNG, JPG, WebP"}
                      </p>
                    </div>
                  </label>
                ) : pickerLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 size={24} className="animate-spin" style={{ color: "#94a3b8" }} />
                  </div>
                ) : pickerGallery.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-3">
                    {pickerTab === "images"
                      ? <ImageIcon size={32} style={{ color: "#94a3b8" }} />
                      : pickerTab === "audio"
                        ? <AudioLines size={32} style={{ color: "#94a3b8" }} />
                        : <Film      size={32} style={{ color: "#94a3b8" }} />
                    }
                    <p className="text-[12px]" style={{ color: "#94a3b8" }}>
                      No {pickerTab === "images" ? "generated images" : pickerTab === "audio" ? "generated audio" : "generated videos"} yet
                    </p>
                    <button
                      onClick={() => {
                        setPickerTab("upload");
                      }}
                      className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg transition-all"
                      style={{
                        background: hexA(selectedModel.family_color, 0.12),
                        border: `1px solid ${hexA(selectedModel.family_color, 0.3)}`,
                        color: selectedModel.family_color,
                      }}
                    >
                      <Upload size={11} /> Upload from device
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {pickerGallery.map(asset => (
                      <button
                        key={asset.id}
                        onClick={() => pickGalleryAsset(asset.url, mediaPicker!, asset.type)}
                        className="group relative overflow-hidden rounded-xl transition-all ring-0 hover:ring-2"
                        style={{
                          aspectRatio: "1",
                          // @ts-expect-error ring color
                          "--tw-ring-color": selectedModel.family_color,
                          ringColor: selectedModel.family_color,
                        }}
                      >
                        {asset.type === "video" ? (
                          <div className="relative w-full h-full bg-slate-900">
                            {asset.posterUrl || asset.thumbnailUrl ? (
                              <img
                                src={asset.posterUrl || asset.thumbnailUrl}
                                alt="Video preview"
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover pointer-events-none"
                              />
                            ) : (
                              <video
                                src={asset.url}
                                preload="metadata"
                                muted
                                playsInline
                                className="w-full h-full object-cover pointer-events-none"
                              />
                            )}
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] text-white flex items-center gap-1">
                              <Film size={9} />
                              <span>Video</span>
                            </div>
                          </div>
                        ) : asset.type === "audio" ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-950/80 px-2">
                            <AudioLines size={24} style={{ color: selectedModel.family_color }} />
                            <span className="line-clamp-2 text-center text-[10px] font-semibold text-slate-200">
                              {asset.prompt || "Audio"}
                            </span>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.thumbnailUrl || asset.url}
                            alt="Gallery asset"
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                        {/* Hover overlay */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          style={{ background: hexA(selectedModel.family_color, 0.35) }}
                        >
                          <CheckCircle2 size={22} style={{ color: "#fff" }} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Mobile Bottom Tool Bar (lg:hidden) -------------------------------- */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-0 border-t lg:hidden" style={{ background: "#050a14", borderColor: "rgba(255,255,255,0.08)", height: 60 }}>
        <div className="flex-1 flex items-center gap-0 overflow-x-auto scrollbar-none px-2">
          {TOOLS.map(t => {
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTool(t.id)}
                className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg transition-all"
                style={{ minWidth: 52, color: active ? "#06b6d4" : "#94a3b8" }}
              >
                <t.icon size={16} />
                <span className="text-[9px] font-medium leading-tight whitespace-nowrap" style={{ maxWidth: 52, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.label.split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setMobileSettingsOpen(true)}
          className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 h-full border-l"
          style={{ borderColor: "rgba(255,255,255,0.08)", color: "#94a3b8" }}
        >
          <Settings size={18} />
          <span className="text-[9px] font-medium">Settings</span>
        </button>
      </div>

      {/* -- Mobile Settings Overlay (lg:hidden) -------------------------------- */}
      <AnimatePresence>
        {mobileSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setMobileSettingsOpen(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 rounded-t-2xl overflow-y-auto"
              style={{ background: "#050a14", maxHeight: "85vh", borderTop: "1px solid rgba(255,255,255,0.08)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <span className="text-sm font-semibold text-white">Model Settings</span>
                <button onClick={() => setMobileSettingsOpen(false)} className="p-1 rounded-lg" style={{ color: "#a1a1aa" }}>
                  <X size={18} />
                </button>
              </div>
              <div className="px-4 py-4">
                {/* References & Styling (mobile) */}
                <div className="mb-4">
                  <ReferenceActionTiles
                    hideTiles
                    onOpenStudio={(tab) => {
                      setActiveStudioTab(tab);
                      setShowReferenceStudioModal(true);
                      setMobileSettingsOpen(false);
                    }}
                    selectedStyle={selectedStyle}
                    selectedElementId={selectedElementId}
                    selectedLocationId={selectedLocationId}
                    selectedCameraId={selectedCameraId}
                    selectedEffectId={selectedEffectId}
                    selectedCharacterId={selectedCharacterPresetId}
                    onClearStyle={() => setSelectedStyle(null)}
                    onClearElement={() => setSelectedElementId(null)}
                    onClearLocation={() => setSelectedLocationId(null)}
                    onClearCamera={() => setSelectedCameraId(null)}
                    onClearEffect={() => setSelectedEffectId(null)}
                    onClearCharacter={() => setSelectedCharacterPresetId(null)}
                    selectedShotTypeId={selectedShotTypeId}
                    selectedFilmStockId={selectedFilmStockId}
                    selectedMovieLookId={selectedMovieLookId}
                    selectedTonalLookId={selectedTonalLookId}
                    selectedLightingId={selectedLightingId}
                    selectedMotionBlurId={selectedMotionBlurId}
                    selectedGrainId={selectedGrainId}
                    selectedHalationId={selectedHalationId}
                    onClearShotType={() => setSelectedShotTypeId(null)}
                    onClearFilmStock={() => setSelectedFilmStockId(null)}
                    onClearMovieLook={() => setSelectedMovieLookId(null)}
                    onClearTonalLook={() => setSelectedTonalLookId(null)}
                    onClearLighting={() => setSelectedLightingId(null)}
                    onClearMotionBlur={() => setSelectedMotionBlurId(null)}
                    onClearGrain={() => setSelectedGrainId(null)}
                    onClearHalation={() => setSelectedHalationId(null)}
                    isAr={lang === "ar"}
                  />
                </div>

                {/* Model selector (inline dropdown) */}
                <div className="mb-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>Model</label>
                  <div className="relative">
                    <button
                      onClick={() => setMobileModelOpen(v => !v)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left"
                      style={{ background: hexA(selectedModel.family_color, 0.08), border: `1px solid ${hexA(selectedModel.family_color, 0.3)}`, color: "#e2e8f0" }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selectedModel.family_color }} />
                      <span className="flex-1 text-sm font-medium truncate">{displayVideoModelName(selectedModel, mainWorkflowTab === "edit")}</span>
                      {bStyle && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: bStyle.bg, color: bStyle.text }}>{selectedModel.badge}</span>
                      )}
                      <ChevronDown size={14} style={{ color: "#94a3b8", transform: mobileModelOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                    </button>

                    <AnimatePresence>
                      {mobileModelOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="mt-1 rounded-lg overflow-y-auto py-1"
                          style={{
                            background: "#0a1220",
                            border: "1px solid rgba(255,255,255,0.08)",
                            boxShadow: "0 16px 32px rgba(0,0,0,0.6)",
                            maxHeight: 280,
                          }}
                        >
                          {(activeTool as string) === "lipsync" ? (
                            LIPSYNC_MODELS.map(m => {
                              const bs = m.badge ? BADGE_STYLE[m.badge as keyof typeof BADGE_STYLE] : null;
                              const active = selectedModel.id === m.id;
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => { selectModel(m); setMobileModelOpen(false); }}
                                  className="w-full flex flex-col gap-1.5 px-4 py-2.5 transition-colors text-left"
                                  style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent", color: active ? "#e2e8f0" : "#94a3b8" }}
                                >
                                  <div className="flex items-center gap-2 w-full">
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.family_color }} />
                                    <span className="flex-1 text-left text-[13px]">{displayVideoModelName(m, mainWorkflowTab === "edit")}</span>
                                    {bs && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ background: bs.bg, color: bs.text }}>{m.badge}</span>
                                    )}
                                  </div>
                                  <ModelCapabilityBadges model={m} />
                                </button>
                              );
                            })
                          ) : (
                            modelGroupsForSelector.map((g, gIdx) => (
                              <div key={g.family} className={gIdx === 0 ? "pt-1" : ""}>
                                {gIdx > 0 && <div className="mx-3 my-1.5 border-t border-slate-800/80" />}
                                {g.models.map((m: any) => {
                                  const bs = m.badge ? BADGE_STYLE[m.badge as keyof typeof BADGE_STYLE] : null;
                                  const active = selectedModel.id === m.id;
                                  return (
                                    <button
                                      key={m.id}
                                      onClick={() => { selectModel(m); setMobileModelOpen(false); }}
                                      className="w-full flex flex-col gap-1.5 px-4 py-2.5 transition-colors text-left"
                                      style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent", color: active ? "#e2e8f0" : "#94a3b8" }}
                                    >
                                      <div className="flex items-center gap-2 w-full">
                                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.family_color }} />
                                        <span className="flex-1 text-left text-[13px]">{displayVideoModelName(m, mainWorkflowTab === "edit")}</span>
                                        {bs && (
                                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ background: bs.bg, color: bs.text }}>{m.badge}</span>
                                        )}
                                      </div>
                                      <ModelCapabilityBadges model={m} />
                                    </button>
                                  );
                                })}
                              </div>
                            ))
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Duration */}
                {durationChoices.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>{t("Duration")}</label>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full ring-1 ring-white/10" style={{ background: hexA(selectedModel.family_color, 0.15), color: selectedModel.family_color }}>
                        {duration ?? durationChoices[0]}s
                      </span>
                    </div>
                    {durationChoices.length <= 6 ? (
                      <div className="flex flex-wrap gap-2">
                        {durationChoices.map(d => (
                          <button key={d} onClick={() => setDuration(d)}
                            className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all"
                            style={{ background: duration === d ? hexA(selectedModel.family_color, 0.2) : "rgba(255,255,255,0.04)", color: duration === d ? selectedModel.family_color : "#a1a1aa", border: `1px solid ${duration === d ? hexA(selectedModel.family_color, 0.4) : "rgba(255,255,255,0.06)"}` }}
                          >{d}s</button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5 px-0.5">
                        <input
                          type="range"
                          min={Math.min(...durationChoices)}
                          max={Math.max(...durationChoices)}
                          step={1}
                          value={duration ?? durationChoices[0]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const closest = durationChoices.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
                            setDuration(closest);
                          }}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                        <div className="flex justify-between text-[10px] text-zinc-500 font-semibold">
                          <span>{Math.min(...durationChoices)}s</span>
                          <span>{Math.max(...durationChoices)}s</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Aspect ratio */}
                {effectiveAspectRatios.length > 0 && (
                  <div className="mb-4">
                    <label className="mb-2 block text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>Aspect Ratio</label>
                    <AspectRatioPicker
                      value={aspectRatio}
                      options={effectiveAspectRatios}
                      onChange={setAspectRatio}
                      accent={selectedModel.family_color}
                    />
                  </div>
                )}

                {/* Quality / Resolution (mobile) */}
                {resolutionChoices.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>Quality</label>
                    <div className="flex flex-wrap gap-2">
                      {resolutionChoices.map(r => (
                        <button
                          key={r}
                          onClick={() => setResolution(r)}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                          style={{
                            background: (resolution ?? resolutionChoices[0]) === r ? hexA(selectedModel.family_color, 0.2) : "rgba(255,255,255,0.04)",
                            color: (resolution ?? resolutionChoices[0]) === r ? selectedModel.family_color : "#a1a1aa",
                            border: `1px solid ${(resolution ?? resolutionChoices[0]) === r ? hexA(selectedModel.family_color, 0.4) : "rgba(255,255,255,0.06)"}`,
                          }}
                        >
                          {r === "std" ? "std" : r === "pro" ? "pro" : r.toLowerCase() === "4k" ? "4K" : r.toLowerCase() === "2k" ? "2K" : r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reference Images (mobile) */}
                {(showReferenceImages || showSimpleKlingRefs) && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
                        {canPickReferenceMedia ? "Reference Media" : "Reference Images"}
                      </label>
                      {referenceImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setReferenceImages([])}
                          className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2 mb-2">
                      <label
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer text-center"
                        style={{
                          background: referenceImages.length > 0 ? hexA(selectedModel.family_color, 0.12) : "rgba(255,255,255,0.04)",
                          border: `1px solid ${referenceImages.length > 0 ? hexA(selectedModel.family_color, 0.4) : "rgba(255,255,255,0.08)"}`,
                          color: referenceImages.length > 0 ? selectedModel.family_color : "#e2e8f0",
                        }}
                      >
                        <input
                          type="file"
                          multiple
                          accept={canPickReferenceMedia ? "image/*,video/*,audio/*" : "image/*"}
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length > 0) {
                              addReferenceFiles(files);
                            }
                          }}
                        />
                        <Upload size={13} />
                        <span className="text-xs font-semibold">
                          {referenceImages.length > 0 ? `Add More (${referenceImages.length})` : "Upload Device"}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => { setMobileSettingsOpen(false); openMediaPicker("referenceImages"); }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl transition-all text-xs font-medium"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          color: "#a1a1aa",
                        }}
                      >
                        <ImageIcon size={13} />
                        <span>Gallery</span>
                      </button>
                    </div>
                    {referenceImages.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto py-1">
                        {referenceImages.map((f, idx) => (
                          <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black/40">
                            {f.type.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={referencePreviews[idx] || ""} alt="Ref preview" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-white/70">
                                {f.type.startsWith("video/") ? "VID" : "AUD"}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReferenceImages((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 text-white"
                            >
                              <X size={9} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showSimpleKlingRefs && (
                      <p className="text-[10px] mt-1" style={{ color: "#94a3b8" }}>
                        Kling uses Elements with @element_name
                      </p>
                    )}
                  </div>
                )}

                {/* Start Frame (mobile) */}
                {(showImageInput || showEndFrame) && !showVideoInput && (
                  <div className="mb-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>
                      Image Inputs
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {showImageInput && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-white/50 font-medium">Start Frame</span>
                          {(startFrame || linkedStartFrameUrl || startFramePreview) ? (
                            <div className="relative w-full h-20 rounded-xl overflow-hidden border border-white/10 bg-black/40">
                              {startFramePreview && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={startFramePreview} alt="Start frame" className="w-full h-full object-cover" />
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setStartFrame(null);
                                  setLinkedStartFrameUrl(null);
                                  setStartFramePreview(null);
                                }}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <label
                                className="flex-1 flex flex-col items-center justify-center gap-1 p-2 rounded-xl border border-dashed transition-all cursor-pointer text-center"
                                style={{
                                  borderColor: hexA(selectedModel.family_color, 0.35),
                                  background: "rgba(255,255,255,0.03)",
                                }}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setStartFrame(file);
                                      setLinkedStartFrameUrl(null);
                                    }
                                  }}
                                />
                                <Upload size={14} style={{ color: selectedModel.family_color }} />
                                <span className="text-[10px] font-semibold text-white/80">Device</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => { setMobileSettingsOpen(false); openMediaPicker("startFrame"); }}
                                className="flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-xl transition-all text-center"
                                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                              >
                                <ImageIcon size={14} className="text-white/60" />
                                <span className="text-[10px] text-white/60">Gallery</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {showEndFrame && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-white/50 font-medium">End Frame</span>
                          {(endFrame || linkedEndFrameUrl || endFramePreview) ? (
                            <div className="relative w-full h-20 rounded-xl overflow-hidden border border-white/10 bg-black/40">
                              {endFramePreview && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={endFramePreview} alt="End frame" className="w-full h-full object-cover" />
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setEndFrame(null);
                                  setLinkedEndFrameUrl(null);
                                  setEndFramePreview(null);
                                }}
                                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <label
                                className="flex-1 flex flex-col items-center justify-center gap-1 p-2 rounded-xl border border-dashed transition-all cursor-pointer text-center"
                                style={{
                                  borderColor: hexA(selectedModel.family_color, 0.35),
                                  background: "rgba(255,255,255,0.03)",
                                }}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setEndFrame(file);
                                      setLinkedEndFrameUrl(null);
                                    }
                                  }}
                                />
                                <Upload size={14} style={{ color: selectedModel.family_color }} />
                                <span className="text-[10px] font-semibold text-white/80">Device</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => { setMobileSettingsOpen(false); openMediaPicker("endFrame"); }}
                                className="flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-xl transition-all text-center"
                                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                              >
                                <ImageIcon size={14} className="text-white/60" />
                                <span className="text-[10px] text-white/60">Gallery</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Audio Input (mobile, lipsync only) */}
                {activeTool === "lipsync" && (
                  <div className="mb-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>Voice / Audio</label>
                    {lipsyncAudioFile ? (
                      <div className="relative rounded-xl p-3 border border-white/10 bg-black/40 flex flex-col gap-2">
                        <div className="flex items-center justify-between min-w-0 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Music2 size={16} className="text-[#06b6d4] flex-shrink-0" />
                            <span className="text-xs text-slate-300 font-medium truncate min-w-0">
                              {lipsyncAudioFile.name}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setLipsyncAudioFile(null);
                            }}
                            className="p-1 rounded bg-black/40 hover:bg-black/60 text-slate-400 hover:text-white transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {lipsyncAudioPreview && (
                          <audio
                            src={lipsyncAudioPreview}
                            controls
                            className="w-full h-8 mt-1 rounded bg-black/30 overflow-hidden text-xs"
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        <input
                          type="file"
                          ref={lipsyncAudioRef}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setLipsyncAudioFile(file);
                          }}
                          accept="audio/*"
                          className="hidden"
                        />
                        <button
                          onClick={() => lipsyncAudioRef.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl transition-all"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            color: "#a1a1aa",
                          }}
                        >
                          <Music2 size={14} />
                          <span className="text-sm font-medium">Add audio file</span>
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Credits estimate */}
                <div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="text-xs" style={{ color: "#94a3b8" }}>Estimated cost</span>
                  <span className="text-sm font-semibold" style={{ color: selectedModel.family_color }}>{estimatedCredits} credits</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DeleteGenerationDialog
        open={Boolean(deleteTargetId)}
        deleting={Boolean(deletingId)}
        onCancel={() => {
          if (!deletingId) setDeleteTargetId(null);
        }}
        onConfirm={confirmDeleteVideo}
      />
      {/* Asset Inspector Modal */}
      <AnimatePresence>
        {inspectorAsset ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/80 p-4"
            onClick={() => setInspectorAsset(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className="mx-auto h-[82vh] max-w-5xl overflow-hidden rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <AssetInspector asset={inspectorAsset} onClose={() => setInspectorAsset(null)} />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Prompt Editor (Ctrl+E) Modal */}
      <PromptEditorModal
        isOpen={showPromptEditorModal}
        onClose={() => setShowPromptEditorModal(false)}
        initialPrompt={prompt}
        onApply={(p) => setPrompt(p)}
        mediaType="video"
        lang={lang}
      />
    </div>
  );
}

// -- Export --------------------------------------------------------------------

export default function VideoPage() {
  return (
    <Suspense>
      <VideoPageInner />
    </Suspense>
  );
}
