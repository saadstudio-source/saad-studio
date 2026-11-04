"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ChangeEvent, type DragEvent, type MouseEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Aperture,
  ArrowUp,
  Brush,
  Camera,
  Wrench,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  Folder,
  FolderPlus,
  ImageIcon,
  Lightbulb,
  Maximize2,
  Paperclip,
  Plus,
  ScanFace,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Trash2,
  UploadCloud,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  IMAGE_MODELS,
  formatCreditAmount,
  getImageCreditCost,
  getImageUpscaleTargetResolution,
  getImageUtilityCreditCost,
  type ImageModel,
} from "@/lib/image-models";
import { DEFAULT_GOOGLE_IMAGE_MODEL_ID, getDefaultImageModel } from "@/lib/google-image-model-specs";
import { useFullDynamicModels } from "@/hooks/use-dynamic-models";
import { useGenerationGate } from "@/hooks/use-generation-gate";
import { AssetInspector, type Asset } from "@/components/AssetInspector";
import { useAssetStore } from "@/hooks/use-asset-store";
import { useSearchParams } from "next/navigation";
import NextImage from "next/image";
import { useLanguage } from "@/lib/use-language";
import { SaadLoader } from "@/components/saad-loader";
import { ReferenceStudioModal } from "@/components/ReferenceStudioModal";
import { ReferenceActionTiles } from "@/components/ReferenceActionTiles";
import { RailToolButton } from "@/components/RailToolButton";
import { IMAGE_TOOL_TABS } from "@/lib/reference-tool-tabs";
import { PromptEditorModal } from "@/components/PromptEditorModal";
import { withPresetsAppended } from "@/lib/reference-prompt-injector";
import { HOOK_CHARACTERS } from "@/lib/hook-studio-config";
import { useAuthenticatedFetch } from "@/hooks/use-authenticated-fetch";
import { useActiveProfile } from "@/lib/profile-context";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ImageModelCapabilityBadges } from "@/components/image/ImageModelCapabilityBadges";

type ToolId = "create" | "relight" | "inpaint" | "upscale" | "face-swap" | "enhance";

const ANNUAL_UNLIMITED_IMAGE_MODEL_IDS = new Set([
  "flux-2/pro",
  "flux-2/flex",
  "seedream/4.5-text-to-image",
  "seedream/4.5-edit",
  "seedream/5-pro",
  "google/nano-banana",
  "gpt-image/1.5-text-to-image",
  "gpt-image/1.5-image-to-image",
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
  "nano-banana-2",
  "nano-banana-pro",
  "nano-banana-2-lite",
]);
const ANNUAL_UNLIMITED_IMAGE_PLAN_IDS = new Set(["pro", "max"]);
const EXCLUDED_ANNUAL_UNLIMITED_IMAGE_MODEL_IDS = new Set([
  "google/imagen4-ultra",
  "flux-2/max",
]);
const HIDDEN_IMAGE_PAGE_MODEL_IDS = new Set([
  "wan/2-7-image-pro",
  "flux-2/pro",
  "flux-2/flex",
  "flux-2/max",
  "grok-imagine/text-to-image",
  "grok-imagine/image-to-image",
  "qwen2/text-to-image",
  "qwen2/image-edit",
  "qwen/image-to-image",
  "seedream/4.5-text-to-image",
  "seedream/4.5-edit",
  "seedream/5-lite-text-to-image",
  "seedream/5-lite-image-to-image",
  "seedream/5-pro-text-to-image",
  "seedream/5-pro-image-to-image",
  "gpt-image-2-image-to-image",
  "gpt-image/1.5-text-to-image",
  "gpt-image/1.5-image-to-image",
  "z-image",
]);
const HIDDEN_IMAGE_PAGE_MODEL_LABELS = new Set([
  "wan 2.7 image pro",
  "flux.2 pro",
  "flux.2 flex",
  "flux.2 max",
  "grok imagine",
  "grok imagine i2i",
  "qwen image t2i",
  "qwen2 image edit",
  "qwen image i2i",
  "seedream 4.5 t2i",
  "seedream 4.5 edit",
  "seedream 5 lite t2i",
  "seedream 5 lite i2i",
  "z-image",
]);
const isHiddenImagePageModel = (model: Pick<ImageModel, "id" | "label">) =>
  HIDDEN_IMAGE_PAGE_MODEL_IDS.has(model.id.toLowerCase()) ||
  HIDDEN_IMAGE_PAGE_MODEL_LABELS.has(model.label.trim().toLowerCase());
const VISIBLE_IMAGE_MODELS = IMAGE_MODELS.filter((model) => !isHiddenImagePageModel(model));
const DEFAULT_VISIBLE_IMAGE_MODEL = getDefaultImageModel(VISIBLE_IMAGE_MODELS) ?? IMAGE_MODELS.find((model) => model.id === DEFAULT_GOOGLE_IMAGE_MODEL_ID) ?? IMAGE_MODELS[0];

function isAnnualUnlimitedImageQuality(value?: string | null) {
  const normalized = String(value ?? "1K").trim().toLowerCase();
  return ["1k", "1024", "1024x1024", "basic", "low", "medium", "speed", "standard"].includes(normalized);
}

function isAnnualUnlimitedImageModel(modelId: string) {
  if (EXCLUDED_ANNUAL_UNLIMITED_IMAGE_MODEL_IDS.has(modelId)) return false;
  return ANNUAL_UNLIMITED_IMAGE_MODEL_IDS.has(modelId);
}

function sortReferenceFilesByNaturalName(files: File[]): File[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => {
      const byName = a.file.name.localeCompare(b.file.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return byName || a.index - b.index;
    })
    .map(({ file }) => file);
}

function appendReferenceFiles(prev: File[], next: File[]): File[] {
  return sortReferenceFilesByNaturalName([...prev, ...next]);
}

// Shared with /gallery so albums sync across pages
const ALBUMS_STORAGE_KEY = "saad_studio_gallery_albums_v1";
interface Album { id: string; name: string; assetIds: string[] }
function loadAlbums(): Album[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ALBUMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a: any) => a && a.id && a.name) : [];
  } catch { return []; }
}
function saveAlbums(albums: Album[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(albums)); } catch { /* quota */ }
}

function normalizeImageResponseUrls(data: any): string[] {
  const collect = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }
    if (Array.isArray(value)) return value.flatMap(collect);
    if (typeof value === "object") {
      const rec = value as Record<string, unknown>;
      return collect(rec.url ?? rec.imageUrl ?? rec.mediaUrl ?? rec.downloadUrl);
    }
    return [];
  };

  for (const candidate of [
    data?.imageUrls,
    data?.resultUrls,
    data?.outputs,
    data?.output,
    data?.images,
    data?.urls,
    data?.imageUrl,
    data?.mediaUrl,
    data?.url,
    data?.data,
    data,
  ]) {
    const urls = collect(candidate);
    if (urls.length) return urls;
  }

  return [];
}

type ResultItem = {
  id: string;
  url: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  tool: ToolId;
  model: string;
  prompt: string;
  aspect: string;
  isPending?: boolean;
  status?: string;
  isFailed?: boolean;
  failureReason?: string;
  creditsRefunded?: boolean;
  providerRequestId?: string;
};

function resultOriginalUrl(item: ResultItem): string {
  return item.originalUrl || item.url;
}

function resultThumbnailUrl(item: ResultItem): string {
  return item.thumbnailUrl || item.url;
}

function imageDownloadHref(item: ResultItem): string {
  const originalUrl = resultOriginalUrl(item);
  if (!originalUrl) return "#";
  const filename = `saadstudio-image-${item.id}`;
  return `/api/download?url=${encodeURIComponent(originalUrl)}&filename=${encodeURIComponent(filename)}`;
}
function resultAspectRatioNumber(item: Pick<ResultItem, "width" | "height" | "aspect" | "isFailed">): number {
  if (item.isFailed) return 16 / 9;
  if (typeof item.width === "number" && typeof item.height === "number" && item.width > 0 && item.height > 0) {
    return item.width / item.height;
  }

  const aspect = String(item.aspect || "").trim().toLowerCase();
  const ratioMatch = aspect.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    if (width > 0 && height > 0) return width / height;
  }

  const sizeMatch = aspect.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
  if (sizeMatch) {
    const width = Number(sizeMatch[1]);
    const height = Number(sizeMatch[2]);
    if (width > 0 && height > 0) return width / height;
  }

  if (aspect.includes("portrait")) return 9 / 16;
  if (aspect.includes("landscape")) return 16 / 9;
  if (aspect.includes("source")) return 1;
  return 1;
}

function resultAspectRatioValue(item: Pick<ResultItem, "width" | "height" | "aspect" | "isFailed">): string {
  const ratio = resultAspectRatioNumber(item);
  return `${Math.max(0.35, Math.min(3.2, ratio))} / 1`;
}


function normalizeGenerationError(value?: string | null): string {
  const text = String(value || "").trim();
  if (!text) return "Generation failed. Please try again.";
  return text
    .replace(/^failed:\s*/i, "")
    .replace(/^error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Generation failed. Please try again.";
}

function imageFailureTitle(reason?: string | null): string {
  const lower = normalizeGenerationError(reason).toLowerCase();
  if (lower.includes("restricted") || lower.includes("content") || lower.includes("policy") || lower.includes("copyright")) {
    return "Restricted content detected";
  }
  return "Generation failed";
}

function mapAssetToResultItem(asset: any, fallback?: Partial<ResultItem>): ResultItem {
  const isFailed = Boolean(asset?.isFailed || ["failed", "error", "cancelled", "canceled"].includes(String(asset?.status || "").toLowerCase()));
  return {
    id: String(asset?.id || fallback?.id || uid("img")),
    url: isFailed ? "" : String(asset?.originalUrl || asset?.url || fallback?.url || ""),
    originalUrl: isFailed ? "" : String(asset?.originalUrl || asset?.url || fallback?.originalUrl || fallback?.url || ""),
    thumbnailUrl: isFailed ? undefined : (typeof asset?.thumbnailUrl === "string" ? asset.thumbnailUrl : fallback?.thumbnailUrl),
    width: typeof asset?.width === "number" ? asset.width : fallback?.width,
    height: typeof asset?.height === "number" ? asset.height : fallback?.height,
    tool: fallback?.tool || "create",
    model: String(asset?.model || fallback?.model || "Image"),
    prompt: String(asset?.prompt || fallback?.prompt || ""),
    aspect: String(asset?.resolution || fallback?.aspect || "1:1"),
    status: typeof asset?.status === "string" ? asset.status : fallback?.status,
    isFailed,
    failureReason: typeof asset?.failureReason === "string" ? asset.failureReason : fallback?.failureReason,
    creditsRefunded: Boolean(asset?.creditsRefunded || fallback?.creditsRefunded),
    providerRequestId: asset?.providerRequestId || fallback?.providerRequestId,
  };
}

function resultInspectorAsset(item: ResultItem): Asset {
  return {
    id: item.id,
    type: "image",
    url: resultOriginalUrl(item),
    prompt: item.prompt,
    model: item.model,
    title: "Generated image",
    resolution: item.aspect,
    providerRequestId: item.providerRequestId,
  };
}

type CharacterReference = {
  id: string;
  name: string;
  description?: string;
  referenceUrls: string[];
  coverUrl?: string | null;
  status: string;
  metadata?: {
    characterPackage?: {
      mainIdentity?: string;
      faceMemory?: string;
      bodyProfile?: string;
      outfitMemory?: string;
      styleDna?: string;
      consistencyProfile?: string;
      cinematicMetadata?: string[];
      states?: Record<string, string>;
    };
  };
};

const RATIO_OPTION_CATALOG = [
  { value: "16:9", width: 1920, height: 1080, cls: "ratio-16-9" },
  { value: "3:2", width: 1620, height: 1080, cls: "ratio-3-2" },
  { value: "4:3", width: 1440, height: 1080, cls: "ratio-4-3" },
  { value: "5:4", width: 1350, height: 1080, cls: "ratio-5-4" },
  { value: "1:1", width: 1024, height: 1024, cls: "ratio-1-1" },
  { value: "4:5", width: 1080, height: 1350, cls: "ratio-4-5" },
  { value: "3:4", width: 1080, height: 1440, cls: "ratio-3-4" },
  { value: "2:3", width: 1080, height: 1620, cls: "ratio-2-3" },
  { value: "9:16", width: 1080, height: 1920, cls: "ratio-9-16" },
  { value: "21:9", width: 2560, height: 1080, cls: "ratio-21-9" },
  { value: "4:1", width: 4096, height: 1024, cls: "ratio-4-1" },
  { value: "8:1", width: 4096, height: 512, cls: "ratio-8-1" },
  { value: "1:4", width: 512, height: 2048, cls: "ratio-1-4" },
  { value: "1:8", width: 512, height: 4096, cls: "ratio-1-8" },
] as const;

type RatioOption = { value: string; width: number; height: number; cls: string };

function ratioOptionForValue(value: string): RatioOption {
  const fromCatalog = RATIO_OPTION_CATALOG.find((ratio) => ratio.value === value);
  if (fromCatalog) return fromCatalog;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  const width = match ? Number(match[1]) : 1;
  const height = match ? Number(match[2]) : 1;
  return {
    value,
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1,
    cls: "ratio-auto",
  };
}

function ratioIconStyle(ratio: RatioOption) {
  const maxWidth = 38;
  const maxHeight = 34;
  const scale = Math.min(maxWidth / ratio.width, maxHeight / ratio.height);
  return {
    width: Math.max(6, Math.round(ratio.width * scale)),
    height: Math.max(6, Math.round(ratio.height * scale)),
  };
}

const LIGHTING_PRESETS = [
  { id: "studio", name: "Studio Light", prompt: "Professional studio lighting setup, three-point lighting" },
  { id: "golden-hour", name: "Golden Hour", prompt: "Warm golden hour sunlight, sunset lighting" },
  { id: "moonlight", name: "Moonlight", prompt: "Cool blue moonlight illumination" },
  { id: "softbox", name: "Soft Box", prompt: "Large soft diffused lighting" },
  { id: "spotlight", name: "Spotlight", prompt: "Dramatic single spotlight" },
  { id: "neon", name: "Neon", prompt: "Vibrant neon lighting, cyberpunk atmosphere" },
  { id: "candle", name: "Candlelight", prompt: "Warm candlelight illumination" },
  { id: "overcast", name: "Overcast", prompt: "Soft overcast diffused daylight" },
  { id: "dramatic", name: "Dramatic", prompt: "High contrast dramatic lighting" },
] as const;

type LightingPresetId = (typeof LIGHTING_PRESETS)[number]["id"];

const TOOLS = [
  { id: "create" as ToolId, label: "CREATE", icon: Wand2 },
  { id: "enhance" as ToolId, label: "ENHANCE", icon: Zap },
  { id: "relight" as ToolId, label: "RELIGHT", icon: Lightbulb },
  { id: "inpaint" as ToolId, label: "INPAINT", icon: Brush },
  { id: "upscale" as ToolId, label: "UPSCALE", icon: Aperture },
  { id: "face-swap" as ToolId, label: "FACE SWAP", icon: ScanFace },
];

const EDIT_MODELS = IMAGE_MODELS.filter((m) =>
  [
    "google/nano-banana-edit",
    "gpt-image-2-image-to-image",
    "gpt-image/1.5-image-to-image",
  ].includes(m.id) && !isHiddenImagePageModel(m),
);

// All models that accept real image inputs (any inputType) — includes Nano Banana (up to 14 imgs), edit, and pure img2img
const ENHANCE_MODELS = IMAGE_MODELS.filter(
  (m) => m.imageInputField !== undefined && m.maxRefImages > 0 && !isHiddenImagePageModel(m),
);

const uid = (prefix = "id") => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      // Compress to max 1536px & JPEG 85% to stay under Vercel 4.5MB body limit
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1536;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

async function buildInpaintGuideImage(sourceDataUrl: string, maskDataUrl: string): Promise<string> {
  const [source, mask] = await Promise.all([dataUrlToImage(sourceDataUrl), dataUrlToImage(maskDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  ctx.drawImage(source, 0, 0);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(mask, 0, 0, source.width, source.height);
  ctx.globalAlpha = 1;
  return canvas.toDataURL("image/png");
}


function SliderField({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const { t, lang } = useImageTranslation();
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-zinc-400"><span>{t(label)}</span><span>{value}</span></div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-pink-500" />
    </section>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { t, lang } = useImageTranslation();
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
      <span>{t(label)}</span>
      <span className={cn("inline-flex h-5 w-9 items-center rounded-full p-0.5 transition", checked ? "bg-pink-500" : "bg-zinc-700")}>
        <span className={cn("h-4 w-4 rounded-full bg-white transition", checked ? "translate-x-4" : "translate-x-0")} />
      </span>
    </button>
  );
}

function CountSelector({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const { t, lang } = useImageTranslation();
  return (
    <section className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">{t(label)}</p>
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} onClick={() => onChange(n)} className={cn("rounded-lg border py-2 text-sm", value === n ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{n}</button>
        ))}
      </div>
    </section>
  );
}

function ModelDropdown({ selected, onSelect, models }: { selected: ImageModel; onSelect: (m: ImageModel) => void; models: ImageModel[] }) {
  const { t, lang } = useImageTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || (m.group && m.group.toLowerCase().includes(q)))
      : models;
  }, [query, models]);

  // Group models by group/family for clean organization
  const modelGroups = useMemo(() => {
    const groups: { name: string; models: ImageModel[] }[] = [];
    filteredModels.forEach((m) => {
      const gName = m.group || "Other";
      let group = groups.find((g) => g.name === gName);
      if (!group) {
        group = { name: gName, models: [] };
        groups.push(group);
      }
      group.models.push(m);
    });
    return groups;
  }, [filteredModels]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10 hover:ring-white/20 transition-all text-left group"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/15 ring-1 ring-pink-500/30 shrink-0">
            <ImageIcon className="h-4 w-4 text-pink-400" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-white">{selected.label}</p>
          </div>
          {selected.badge ? (
            <span className="shrink-0 rounded-full bg-lime-300 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">
              {selected.badge}
            </span>
          ) : null}
          <ChevronDown className={cn("h-4 w-4 text-zinc-400 transition shrink-0", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className="z-[9999] p-0 rounded-2xl overflow-hidden border border-white/10 bg-[#090e1a]/95 backdrop-blur-2xl shadow-2xl w-[520px] max-w-[94vw]"
      >
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10 flex-1 mr-3">
            <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search model")}
              className="w-full bg-transparent text-xs text-white placeholder:text-zinc-400 focus:outline-none"
            />
          </div>
          <span className="text-[11px] text-zinc-400 font-mono shrink-0">
            {filteredModels.length} {lang === "ar" ? "موديل" : "models"}
          </span>
        </div>

        <div className="max-h-[380px] overflow-y-auto py-1 divide-y divide-white/[0.04]">
          {modelGroups.map((group) => (
            <div key={group.name} className="py-1">
              <div className="px-3.5 py-1 flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                  {group.name}
                </span>
              </div>
              {group.models.map((model) => {
                const isSelected = selected.id === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      onSelect(model);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1.5 px-3.5 py-2 text-left hover:bg-white/[0.07] transition-colors group",
                      isSelected && "bg-white/10"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <p className={cn("truncate text-xs font-semibold", isSelected ? "text-white" : "text-zinc-200 group-hover:text-white")}>
                          {model.label}
                        </p>
                        {model.badge ? (
                          <span className="shrink-0 rounded-full bg-lime-300 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">
                            {model.badge}
                          </span>
                        ) : null}
                      </div>
                      {isSelected ? <Check className="h-3.5 w-3.5 text-pink-400 shrink-0" /> : null}
                    </div>

                    <ImageModelCapabilityBadges model={model} className="w-full" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function UploadBox({ label, file, onFile, required = false, accept = "image/*" }: { label: string; file: File | null; onFile: (f: File | null) => void; required?: boolean; accept?: string }) {
  const { t, lang } = useImageTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const acceptVideo = accept.includes("video");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = event.dataTransfer.files?.[0] || null;
    const isImage = Boolean(dropped?.type?.startsWith("image/"));
    const isVideo = Boolean(dropped?.type?.startsWith("video/"));
    if (dropped && (isImage || (acceptVideo && isVideo))) {
      onFile(dropped);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
  };

  return (
    <div className="space-y-1.5">
      {label ? <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">{t(label)}{required ? " *" : ""}</p> : null}
      <label
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "group relative flex h-24 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed bg-white/[0.03] hover:border-pink-400/40 select-none",
          dragActive ? "border-pink-400/60 bg-pink-500/[0.08]" : "border-white/15",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
        {preview ? (
          file?.type.startsWith("video/") ? (
            <video src={preview} className="h-full w-full object-cover pointer-events-none" muted playsInline />
          ) : (
            <img src={preview} alt="upload" className="h-full w-full object-cover pointer-events-none" />
          )
        ) : (
          <div className="flex flex-col items-center gap-1 text-zinc-400 pointer-events-none">
            <UploadCloud className="h-5 w-5" />
            <span className="text-xs">{dragActive ? "Drop here" : acceptVideo ? "Upload or drag media" : "Upload or drag image"}</span>
          </div>
        )}
        {file ? (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFile(null); }}
            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-zinc-300 z-10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>
    </div>
  );
}

function SettingsAccordion({ label, summary, children, defaultOpen = false }: { label: string; summary?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const { t, lang } = useImageTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03]">
      <button
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-zinc-400">{label}</span>
        <div className="flex items-center gap-2">
          {summary && !open ? <span className="text-[11px] text-pink-400">{summary}</span> : null}
          <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform duration-200", open && "rotate-180")} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.06] px-3 pb-3 pt-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Gateway card — leads to /image-presets ───────────────────────── */
function StyleLibraryGatewayCard({ onOpen }: { onOpen: () => void }) {
  const { t, lang } = useImageTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden w-full text-start lg:block group relative overflow-hidden rounded-2xl border border-amber-400/25 bg-black/40 transition-all hover:border-amber-400/55 hover:shadow-xl hover:shadow-amber-500/20"
    >
      {/* Hero image — tall to give the collage room to breathe */}
      <div className="relative h-44 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/preset/card.webp"
          alt="Style Library — featured styles"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          fetchPriority="high"
        />
        {/* Vignette so text below remains separable from the art */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-transparent" />
      </div>

      {/* Text */}
      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200 ring-1 ring-amber-400/40">
            {t("New")}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-amber-300/70">
            {t("18 styles")}
          </span>
        </div>
        <h3 className="mt-1.5 text-sm font-black text-white">
          {t("Style Library")}
        </h3>
        <p className="mt-0.5 text-[11px] leading-5 text-zinc-400">
          {t("Tap a curated style — the prompt, model, and aspect ratio apply instantly.")}
        </p>
        <div className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 group-hover:text-amber-200">
          {t("Browse styles")}
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </div>
      </div>
    </button>
  );
}

function CompareSlider({
  before,
  after,
  onInspect,
}: {
  before: string;
  after: string;
  onInspect?: (url: string) => void;
}) {
  const [position, setPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { lang } = useLanguage();
  const isAr = lang === "ar";

  const updatePosition = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(pos);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-[360px] select-none overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl group cursor-ew-resize"
      onMouseDown={(e) => {
        setIsDragging(true);
        updatePosition(e.clientX);
      }}
      onMouseMove={(e) => {
        if (isDragging || e.buttons === 1) updatePosition(e.clientX);
      }}
      onMouseUp={() => setIsDragging(false)}
      onTouchMove={(e) => {
        if (e.touches[0]) updatePosition(e.touches[0].clientX);
      }}
    >
      {/* Before Image (Base Full Image) */}
      <img
        src={before}
        alt="Before"
        className="absolute inset-0 h-full w-full object-contain select-none pointer-events-none"
        draggable={false}
      />

      {/* After Image (Clipped Overlay — same aspect ratio & coordinate alignment) */}
      <div
        className="absolute inset-0 h-full w-full pointer-events-none select-none"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      >
        <img
          src={after}
          alt="After"
          className="h-full w-full object-contain select-none pointer-events-none"
          draggable={false}
        />
      </div>

      {/* Vertical Divider Line with Glowing Handle */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none z-20 flex items-center justify-center -translate-x-1/2"
        style={{ left: `${position}%` }}
      >
        <div className="h-full w-0.5 bg-gradient-to-b from-pink-500/80 via-white to-pink-500/80 shadow-[0_0_12px_rgba(236,72,153,0.9)]" />
        <div className="absolute top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/90 text-white shadow-xl ring-2 ring-pink-500 backdrop-blur-md transition-transform group-hover:scale-110">
          <SlidersHorizontal className="h-3.5 w-3.5 text-pink-400 rotate-90" />
        </div>
      </div>

      {/* Floating Badges (Before / After) */}
      <div className="pointer-events-none absolute top-4 left-4 z-20">
        <span className="rounded-full bg-slate-950/80 backdrop-blur-md px-3 py-1 text-xs font-bold uppercase tracking-wider text-zinc-300 ring-1 ring-white/10 shadow-lg">
          {isAr ? "قبل" : "Before"}
        </span>
      </div>

      <div className="pointer-events-none absolute top-4 right-4 z-20">
        <span className="rounded-full bg-pink-500/20 backdrop-blur-md px-3 py-1 text-xs font-bold uppercase tracking-wider text-pink-300 ring-1 ring-pink-500/40 shadow-lg">
          {isAr ? "بعد" : "After"}
        </span>
      </div>

      {/* Quick Action: Click to inspect in full HD / Zoom */}
      <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onInspect) onInspect(position > 50 ? before : after);
          }}
          className="flex items-center gap-1.5 rounded-xl bg-slate-900/85 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/15 backdrop-blur-md hover:bg-slate-800 hover:ring-pink-500/50 transition-all shadow-xl active:scale-95 cursor-pointer"
          title={isAr ? "مشاهدة وتكبير الصورة" : "Inspect full-size image"}
        >
          <Maximize2 className="h-3.5 w-3.5 text-pink-400" />
          <span>{isAr ? "مشاهدة بدقة كاملة" : "Inspect Image"}</span>
        </button>
      </div>

      {/* Transparent full-card range input for smooth interaction */}
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Comparison slider"
        className="absolute inset-0 h-full w-full opacity-0 cursor-ew-resize z-10"
      />
    </div>
  );
}

import { ImageResultGrid as ResultGrid, DeleteImageDialog } from "@/components/image/ImageResultGrid";
import { PresetSlideOver } from "@/components/image/PresetSlideOver";
import type { ImagePreset } from "@/lib/image-presets";

// Album Picker modal — shared visual with /gallery
function AlbumPicker({ albums, count, onPick, onCreate, onClose }: { albums: Album[]; count: number; onPick: (id: string) => void; onCreate: (name: string) => void; onClose: () => void }) {
  const { t, lang } = useImageTranslation();
  const [newName, setNewName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1222] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{lang === "ar" ? "إضافة العناصر المحددة للألبوم" : `Add ${count} item(s) to album`}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        {albums.length > 0 && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {albums.map((album) => (
              <button key={album.id} onClick={() => onPick(album.id)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm">
                <span className="inline-flex items-center gap-2"><Folder className="h-4 w-4 text-amber-300" />{album.name}</span>
                <span className="text-xs text-slate-400">{album.assetIds.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-white/10">
          <label className="text-xs text-slate-400">{t("Create new album")}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onCreate(newName); }}
              placeholder={t("Album name")}
              className="flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-400/50"
            />
            <button onClick={() => onCreate(newName)} disabled={!newName.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-400/40 bg-amber-500/20 text-sm text-amber-100 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
              <FolderPlus className="h-3.5 w-3.5" />
              {t("Create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InpaintWorkspace({ source, setSource, brushSize, setBrushSize, maskVersion, setMaskVersion, registerMaskExporter }: { source: File | null; setSource: (f: File | null) => void; brushSize: number; setBrushSize: (v: number) => void; maskVersion: number; setMaskVersion: Dispatch<SetStateAction<number>>; registerMaskExporter: (fn: () => string | null) => void; }) {
  const { t, lang } = useImageTranslation();
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const undoStackRef = useRef<ImageData[]>([]);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const sourceUrl = useMemo(() => (source ? URL.createObjectURL(source) : null), [source]);

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  const saveUndo = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    undoStackRef.current.push(ctx.getImageData(0, 0, mask.width, mask.height));
  }, []);

  useEffect(() => {
    registerMaskExporter(() => {
      const mask = maskCanvasRef.current;
      if (!mask) return null;
      return mask.toDataURL("image/png");
    });
  }, [registerMaskExporter]);

  useEffect(() => {
    if (!sourceUrl) return;
    const img = new Image();
    img.onload = () => {
      const base = baseCanvasRef.current;
      const mask = maskCanvasRef.current;
      if (!base || !mask) return;
      const maxW = 980;
      const maxH = 620;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      base.width = w; base.height = h; mask.width = w; mask.height = h;
      const baseCtx = base.getContext("2d");
      const maskCtx = mask.getContext("2d", { willReadFrequently: true });
      if (!baseCtx || !maskCtx) return;
      baseCtx.clearRect(0, 0, w, h);
      baseCtx.drawImage(img, 0, 0, w, h);
      maskCtx.fillStyle = "#000";
      maskCtx.fillRect(0, 0, w, h);
      undoStackRef.current = [];
      setMaskVersion((v) => v + 1);
    };
    img.src = sourceUrl;
  }, [sourceUrl, setMaskVersion]);

  const paint = (x: number, y: number) => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    if (lastPointRef.current) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    lastPointRef.current = { x, y };
  };

  const pointFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mask = maskCanvasRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = mask && rect.width ? mask.width / rect.width : 1;
    const scaleY = mask && rect.height ? mask.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const undo = () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    ctx.putImageData(prev, 0, 0);
    setMaskVersion(maskVersion + 1);
  };

  const clearMask = () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    saveUndo();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, mask.width, mask.height);
    setMaskVersion(maskVersion + 1);
  };

  return (
    <div className="h-full min-h-[320px] space-y-3">
      <UploadBox label="Upload image" file={source} onFile={setSource} required />
      <div className="flex items-center gap-2">
        <button onClick={undo} className="rounded-lg bg-white/7 px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-white/10">{t("Undo")}</button>
        <button onClick={clearMask} className="rounded-lg bg-white/7 px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-white/10">{t("Clear Mask")}</button>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">{t("Brush")}
          <input type="range" min={5} max={100} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-28 accent-pink-500" />
          <span>{brushSize}px</span>
        </div>
      </div>
      <div className="flex h-[420px] items-center justify-center overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4">
        {!source ? <p className="text-sm text-zinc-500">{t("Upload image to start painting mask.")}</p> : null}
        <div className={cn("relative shrink-0", !source && "hidden")}>
          <canvas ref={baseCanvasRef} className="block" />
          <canvas
            ref={maskCanvasRef}
            className="absolute inset-0 block cursor-crosshair"
            style={{ opacity: 0.4 }}
            onMouseDown={(e) => { isDrawingRef.current = true; saveUndo(); const p = pointFromEvent(e); paint(p.x, p.y); }}
            onMouseMove={(e) => { if (!isDrawingRef.current) return; const p = pointFromEvent(e); paint(p.x, p.y); }}
            onMouseUp={() => { isDrawingRef.current = false; lastPointRef.current = null; setMaskVersion((v) => v + 1); }}
            onMouseLeave={() => { isDrawingRef.current = false; lastPointRef.current = null; }}
          />
        </div>
      </div>
    </div>
  );
}

function useImageTranslation() {
  const { lang } = useLanguage();

  const dict: Record<string, Record<string, string>> = {
    en: {
      "Ratio: ": "Ratio: ",
      "Style: ": "Style: ",
      "Sort: ": "Sort: ",
      "Image": "Image",
      "Video": "Video"
    },
    ar: {
      // Sidebar Accordion Headers
      "Model": "النموذج",
      "Character Reference": "مرجع الشخصية",
      "Aspect Ratio": "الأبعاد",
      "Number of Images": "عدد الصور",
      "Resolution": "الدقة",
      "Quality": "الجودة",

      // Workspace status messages
      "ENHANCE — Photo Restoration": "التحسين — ترميم الصور",
      "Upload a photo in the settings panel → click Enhance Photo": "ارفع صورة في لوحة الإعدادات ← اضغط على زر تحسين الصورة",
      "Uses true image-to-image AI to preserve identity while improving quality": "يستخدم الذكاء الاصطناعي الفعلي (صورة إلى صورة) للحفاظ على الملامح مع تحسين الجودة",
      "Upload image and relight": "ارفع صورة واضبط الإضاءة",
      "Upload media and upscale": "ارفع الوسائط وكبّر دقتها",
      "Upload source and target images": "ارفع الصور المصدر والهدف لتبديل الوجه",
      "Start generating to see results.": "ابدأ التوليد لرؤية النتائج.",
      "Load more": "تحميل المزيد",
      "Loading...": "جار التحميل...",
      "Upload image to start painting mask.": "ارفع صورة للبدء في رسم القناع.",

      // Sidebar Right Panel Settings
      "New from Saad Studio": "جديد من استوديو سعد",
      "No saved character": "لا توجد شخصية محفوظة",
      "Create a reusable character": "إنشاء شخصية قابلة للاستخدام",
      "This model does not accept reference images. Choose an image-to-image model to use this character.": "هذا النموذج لا يقبل صوراً مرجعية. اختر نموذج صورة إلى صورة لاستخدام هذه الشخصية.",
      "Upload image to relight": "ارفع صورة لضبط الإضاءة",
      "Lighting Preset": "قالب الإضاءة",
      "Brightness": "السطوع",
      "Contrast": "التباين",
      "Temperature": "درجة حرارة اللون",
      "Shadow Intensity": "شدة الظلال",
      "Light Direction": "اتجاه الضوء",
      "Number of Variations": "عدد المتغيرات",
      "Edit Model": "نموذج التعديل",
      "Brush Size": "حجم الفرشاة",
      "Enhancement Model": "نموذج التحسين",
      "Input Images": "الصور المدخلة",
      "Required": "مطلوب",
      "Optional": "اختياري",
      "✦ True Image-to-Image": "✦ صورة إلى صورة فعلي",
      "ENHANCE sends your photo directly as input to the AI — preserves identity. Unlike CREATE which uses it as loose inspiration.": "خاصية التحسين ترسل صورتك مباشرة كمدخل للذكاء الاصطناعي للحفاظ على الملامح بدقة، بخلاف خاصية الإنشاء التي تستخدمها كمجرد إلهام.",
      "Upload image": "ارفع صورة",
      "Scale Factor": "معامل التكبير",
      "Denoise": "إزالة الضوضاء",
      "Sharpen": "زيادة الحدة",
      "Face Enhancement": "تحسين ملامح الوجه",
      "Color Enhancement": "تحسين الألوان",
      "Output Format": "صيغة المخرجات",
      "Source face": "الوجه المصدر",
      "Target image": "الصورة الهدف",
      "Face Blend": "دمج الوجه",
      "Keep target expression": "الحفاظ على تعابير الوجه الهدف",
      "Match skin tones": "مطابقة لون البشرة",
      "Target Face Index": "مؤشر الوجه المستهدف",

      // Selection toolbar
      "Exit selection": "إلغاء التحديد",
      "Select": "تحديد",
      "Unselect all": "إلغاء تحديد الكل",
      "Select all": "تحديد الكل",
      "selected": "محدد",
      "Preparing ZIP...": "جاري التجهيز...",
      "Download": "تحميل",
      "Add to album": "إضافة إلى الألبوم",
      "Delete selected": "حذف المحدد",

      // Album Picker Modal
      "Add {count} item(s) to album": "إضافة العناصر المحددة للألبوم",
      "Create new album": "إنشاء ألبوم جديد",
      "Album name": "اسم الألبوم",
      "Create": "إنشاء",

      // Tool buttons
      "CREATE": "إنشاء",
      "ENHANCE": "تحسين",
      "RELIGHT": "إضاءة",
      "INPAINT": "تعديل الرسم",
      "UPSCALE": "تكبير الدقة",
      "FACE SWAP": "تبديل الوجه",

      // Main UI Controls
      "Add character": "إضافة شخصية",
      "Unlimited": "غير محدود",
      "Drop images here to add as reference": "أفلت الصور هنا لإضافتها كمرجع",
      "Describe what you want to generate...": "صف ما تريد توليده...",
      "Generate Image - Unlimited": "توليد صورة - غير محدود",
      "Generate Image": "توليد صورة",
      "Generate another": "توليد صورة أخرى",
      "cr": "نقطة",
      "Image Settings": "إعدادات الصورة",
      "Enhance Settings": "إعدادات التحسين",
      "Relight Settings": "إعدادات الإضاءة",
      "Inpaint Workspace": "مساحة تعديل الرسم",
      "Inpaint Settings": "إعدادات تعديل الرسم",
      "Upscale Settings": "إعدادات تكبير الدقة",
      "Face Swap Settings": "إعدادات تبديل الوجه",
      "Settings": "الإعدادات",
      "Undo": "تراجع",
      "Clear Mask": "مسح القناع",
      "Brush": "الفرشاة",
      "Upload or drag media": "ارفع أو اسحب الوسائط هنا",
      "Upload or drag image": "ارفع أو اسحب الصورة هنا",
      "Drop here": "أفلته هنا",
      "Style Library": "مكتبة الأنماط",
      "Tap a curated style — the prompt, model, and aspect ratio apply instantly.": "اضغط على نمط منسق — سيتم تطبيق الوصف والنموذج والأبعاد فوراً.",
      "Browse styles": "تصفح الأنماط",
      "New": "جديد",
      "18 styles": "18 نمطاً",
      "Preview": "معاينة",
      "Unselect": "إلغاء التحديد",
      "Use": "استخدام",
      "Remix": "ريمكس",
      "Delete": "حذف",
      "Enhancement instructions (optional) — e.g. \"cinematic, 8K, sharp\"...": "تعليمات التحسين (اختياري) — مثل: سينمائي، بدقة 8K، حاد...",
      "Enhance Photo": "تحسين الصورة",
      "Describe the lighting you want...": "صف الإضاءة التي تريدها...",
      "Describe what should replace the painted area...": "صف ما يجب أن يحل محل المنطقة المرسومة...",
      "Swap Face": "تبديل الوجه",
      "Search model": "البحث عن نموذج",

      // Model families
      "Cinema Studio": "سينما استوديو",
      "Nano Banana": "نانو بنانا",
      "Seedance": "سيدانس",
      "Kling": "كلينغ",
      "GPT Image": "GPT صور"
    }
  };

  const t = (key: string) => {
    if (!key) return "";
    const cleanKey = key.trim();
    return dict[lang]?.[cleanKey] || key;
  };

  return { t, lang };
}

export default function ImageWorkspacePage() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { t, lang } = useImageTranslation();
  const searchParams = useSearchParams();
  const { guardGeneration, getSafeErrorMessage } = useGenerationGate();
  const { addAsset } = useAssetStore();

  const { imageModels: rawImageModels } = useFullDynamicModels();

  const visibleImageModels = useMemo(() => {
    const list = rawImageModels.length > 0 ? rawImageModels : IMAGE_MODELS;
    return list.filter((model) => !isHiddenImagePageModel(model) && model.isActive !== false);
  }, [rawImageModels]);

  const editModels = useMemo(() => {
    const list = rawImageModels.length > 0 ? rawImageModels : IMAGE_MODELS;
    return list.filter((m) =>
      [
        "google/nano-banana-edit",
        "gpt-image-2-image-to-image",
        "gpt-image/1.5-image-to-image",
      ].includes(m.id) && !isHiddenImagePageModel(m) && m.isActive !== false
    );
  }, [rawImageModels]);

  const enhanceModels = useMemo(() => {
    const list = rawImageModels.length > 0 ? rawImageModels : IMAGE_MODELS;
    return list.filter((m) => m.imageInputField !== undefined && m.maxRefImages > 0 && !isHiddenImagePageModel(m) && m.isActive !== false);
  }, [rawImageModels]);

  const [activeTool, setActiveTool] = useState<ToolId>("create");
  const { fetchWithAuth } = useAuthenticatedFetch();
  const { activeProfile } = useActiveProfile();
  const [selectedModel, setSelectedModel] = useState<ImageModel>(DEFAULT_VISIBLE_IMAGE_MODEL);
  const [hasAnnualUnlimitedImages, setHasAnnualUnlimitedImages] = useState(false);
  const [annualUnlimitedEnabled, setAnnualUnlimitedEnabled] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numImages, setNumImages] = useState(1);
  const [prompt, setPrompt] = useState("");
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

  const [quality, setQuality] = useState("standard");
  const [resolution, setResolution] = useState("1k");
  const [outputFormat, setOutputFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionPopupRef = useRef<HTMLDivElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  const referencePreviews = useMemo(() => {
    return referenceFiles.map((file, idx) => ({
      file,
      url: URL.createObjectURL(file),
      tag: `Image${idx + 1}`,
      name: file.name,
    }));
  }, [referenceFiles]);

  useEffect(() => {
    return () => {
      referencePreviews.forEach((item) => {
        try {
          URL.revokeObjectURL(item.url);
        } catch {}
      });
    };
  }, [referencePreviews]);

  const filteredMentionItems = useMemo(() => {
    if (!mentionOpen) return [];
    if (!mentionQuery) return referencePreviews;
    return referencePreviews.filter((p) =>
      p.tag.toLowerCase().includes(mentionQuery) ||
      p.name.toLowerCase().includes(mentionQuery) ||
      p.tag.replace("Image", "").includes(mentionQuery)
    );
  }, [mentionOpen, mentionQuery, referencePreviews]);

  const insertMention = useCallback((tag: string) => {
    const textarea = promptTextareaRef.current;
    const selStart = textarea?.selectionStart ?? prompt.length;
    const selEnd = textarea?.selectionEnd ?? selStart;
    const textBeforeCursor = prompt.slice(0, selStart);
    const textAfterCursor = prompt.slice(selEnd);

    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex !== -1) {
      const replacement = `@${tag} `;
      const newPrompt = textBeforeCursor.slice(0, atIndex) + replacement + textAfterCursor;
      setPrompt(newPrompt);
      setMentionOpen(false);

      requestAnimationFrame(() => {
        if (textarea) {
          const newPos = atIndex + replacement.length;
          textarea.focus();
          textarea.setSelectionRange(newPos, newPos);
        }
      });
    } else {
      setMentionOpen(false);
    }
  }, [prompt]);

  const handlePromptChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);

    const selStart = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, selStart);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_]*)$/);

    if (match && referencePreviews.length > 0) {
      setMentionOpen(true);
      setMentionQuery(match[1].toLowerCase());
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  }, [referencePreviews.length]);

  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filteredMentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredMentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredMentionItems.length) % filteredMentionItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredMentionItems[mentionIndex] || filteredMentionItems[0];
        if (selected) {
          insertMention(selected.tag);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
  }, [mentionOpen, filteredMentionItems, mentionIndex, insertMention]);

  useEffect(() => {
    if (!mentionOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (
        mentionPopupRef.current &&
        !mentionPopupRef.current.contains(e.target as Node) &&
        promptTextareaRef.current &&
        !promptTextareaRef.current.contains(e.target as Node)
      ) {
        setMentionOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mentionOpen]);
  const [characters, setCharacters] = useState<CharacterReference[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [relightFile, setRelightFile] = useState<File | null>(null);
  const [relightPreset, setRelightPreset] = useState<LightingPresetId>(LIGHTING_PRESETS[0].id);
  const [relightBrightness, setRelightBrightness] = useState(50);
  const [relightContrast, setRelightContrast] = useState(50);
  const [relightTemperature, setRelightTemperature] = useState(50);
  const [relightShadow, setRelightShadow] = useState(50);
  const [relightDirection, setRelightDirection] = useState("center");
  const [relightVariations, setRelightVariations] = useState(1);
  const [inpaintFile, setInpaintFile] = useState<File | null>(null);
  const [inpaintModelId, setInpaintModelId] = useState(EDIT_MODELS[0]?.id || "google/nano-banana-edit");
  const [inpaintVariations, setInpaintVariations] = useState(1);
  const [brushSize, setBrushSize] = useState(30);
  const [maskVersion, setMaskVersion] = useState(0);
  const maskExporterRef = useRef<() => string | null>(() => null);
  const [upscaleFile, setUpscaleFile] = useState<File | null>(null);
  const [upscaleScale, setUpscaleScale] = useState(2);
  const [upDenoise, setUpDenoise] = useState(true);
  const [upSharpen, setUpSharpen] = useState(true);
  const [upFace, setUpFace] = useState(false);
  const [upColor, setUpColor] = useState(false);
  const [upFormat, setUpFormat] = useState<"png" | "webp" | "jpg">("png");
  const [upQuality, setUpQuality] = useState(95);
  const [faceSource, setFaceSource] = useState<File | null>(null);
  const [faceTarget, setFaceTarget] = useState<File | null>(null);
  const [faceBlend, setFaceBlend] = useState(80);
  const [faceExpression, setFaceExpression] = useState(true);
  const [faceSkin, setFaceSkin] = useState(true);
  const [faceIndex, setFaceIndex] = useState(0);
  const [enhanceFiles, setEnhanceFiles] = useState<File[]>([]);
  const [enhanceModelId, setEnhanceModelId] = useState(
    ENHANCE_MODELS.find((m) => m.id === "google/nano-banana-edit")?.id ?? ENHANCE_MODELS[0]?.id ?? "google/nano-banana-edit",
  );
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const generating = activeGenerationCount > 0;
  const beginGeneration = useCallback(() => setActiveGenerationCount((count) => count + 1), []);
  const finishGeneration = useCallback(() => setActiveGenerationCount((count) => Math.max(0, count - 1)), []);
  const lastSubmitAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [pendingItems, setPendingItems] = useState<ResultItem[]>([]);
  const [resultsPage, setResultsPage] = useState(0);
  const [resultsHasMore, setResultsHasMore] = useState(false);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);
  const [compare, setCompare] = useState<{ before: string; after: string } | null>(null);
  const [inspectorAsset, setInspectorAsset] = useState<Asset | null>(null);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [aspectRatioDropdownOpen, setAspectRatioDropdownOpen] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [deletingImages, setDeletingImages] = useState(false);

  useEffect(() => {
    if (rawImageModels.length > 0) {
      setSelectedModel((prev) => {
        const found = visibleImageModels.find((m) => m.id === prev.id);
        if (found) return found;
        const def = getDefaultImageModel(visibleImageModels) ?? visibleImageModels.find((model) => model.id === DEFAULT_GOOGLE_IMAGE_MODEL_ID) ?? visibleImageModels[0];
        return def ?? prev;
      });

      setInpaintModelId((prev) => {
        const found = editModels.find((m) => m.id === prev);
        return found ? prev : (editModels[0]?.id ?? prev);
      });

      setEnhanceModelId((prev) => {
        const found = enhanceModels.find((m) => m.id === prev);
        return found ? prev : (enhanceModels[0]?.id ?? prev);
      });
    }
  }, [rawImageModels, visibleImageModels, editModels, enhanceModels]);

  const [showReferenceStudioModal, setShowReferenceStudioModal] = useState(false);
  const [showStyleLibrary, setShowStyleLibrary] = useState(false);
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

  useEffect(() => {
    const requestedTool = searchParams.get("tool");
    if (requestedTool && TOOLS.some((tool) => tool.id === requestedTool)) {
      setActiveTool(requestedTool as ToolId);
      setCompare(null);
    }

    const requestedModel = searchParams.get("model");
    if (requestedModel) {
      const model = visibleImageModels.find((m) => m.id === requestedModel);
      if (model) setSelectedModel(model);
    }

    const requestedCharacter = searchParams.get("characterId");
    if (requestedCharacter) setSelectedCharacterId(requestedCharacter);

    // ── Style Library preset hydration ──────────────────────────────
    // When the user clicks a card on /image-presets, we land here with
    // ?prompt= ?aspect= ?quality= ?preset=… params. Apply them once.
    const requestedPrompt = searchParams.get("prompt");
    if (requestedPrompt) setPrompt(requestedPrompt);

    const requestedAspect = searchParams.get("aspect");
    if (requestedAspect) setAspectRatio(requestedAspect);

    const requestedQuality = searchParams.get("quality");
    if (requestedQuality) setQuality(requestedQuality);

    // If we applied any preset params, strip them from the URL so a
    // page refresh doesn't reapply them on top of the user's edits.
    if (
      searchParams.get("preset") ||
      requestedPrompt ||
      requestedAspect ||
      requestedQuality
    ) {
      const url = new URL(window.location.href);
      ["prompt", "aspect", "quality", "preset"].forEach((k) =>
        url.searchParams.delete(k),
      );
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  const hasAnyReferenceSelection = Boolean(
    selectedStyle ||
      selectedElementId ||
      selectedLocationId ||
      selectedCameraId ||
      selectedEffectId ||
      selectedCharacterPresetId ||
      selectedShotTypeId ||
      selectedFilmStockId ||
      selectedMovieLookId ||
      selectedTonalLookId ||
      selectedLightingId ||
      selectedMotionBlurId ||
      selectedGrainId ||
      selectedHalationId,
  );

  const applyStylePreset = useCallback((preset: ImagePreset) => {
    setPrompt(preset.prompt);
    if (preset.model) {
      const model = visibleImageModels.find((m) => m.id === preset.model);
      if (model) setSelectedModel(model);
    }
    if (preset.aspect) setAspectRatio(preset.aspect);
    if (preset.quality) setQuality(preset.quality);
    setShowStyleLibrary(false);
  }, [visibleImageModels]);

  // Refetchable: a character created inside the Reference Studio would otherwise
  // never appear here, so selectedCharacter would stay null and the picked
  // character would show no chip at all.
  const refreshCharacters = useCallback(async () => {
    if (isAuthLoaded && !isSignedIn) return;
    try {
      const res = await fetch("/api/characters", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.characters)) setCharacters(data.characters);
    } catch {
      setCharacters([]);
    }
  }, [isAuthLoaded, isSignedIn]);

  useEffect(() => {
    void refreshCharacters();
  }, [refreshCharacters]);

  const loadPersistedImages = useCallback(async (nextPage = 0, mode: "replace" | "append" = "replace", overrideProfileId?: string) => {
    if (isAuthLoaded && !isSignedIn) return;
    if (mode === "append") setLoadingMoreResults(true);
    try {
      const targetProfileId = overrideProfileId !== undefined
        ? overrideProfileId
        : (activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : ""));

      const params = new URLSearchParams({
        type: "image",
        page: String(nextPage),
        limit: "25",
        ...(targetProfileId ? { profileId: targetProfileId } : {}),
      });
      const res = await fetchWithAuth(`/api/assets?${params.toString()}`, { cache: "no-cache" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.assets)) {
        if (mode === "replace") {
          setResults([]);
        }
        return;
      }

      const mapped: ResultItem[] = data.assets.map((asset: any) => mapAssetToResultItem(asset));
      setResults((prev) => {
        if (mode === "append") {
          return [...prev, ...mapped.filter((item) => !prev.some((existing) => existing.id === item.id))];
        }
        return mapped.map((m) => {
          const existing = prev.find((p) => p.id === m.id);
          if (existing && (!m.url || m.url.startsWith("failed:")) && existing.url && !existing.url.startsWith("failed:")) {
            return { ...m, url: existing.url, originalUrl: existing.originalUrl || existing.url };
          }
          return m;
        });
      });
      setResultsPage(typeof data?.page === "number" ? data.page : nextPage);
      setResultsHasMore(Boolean(data?.hasMore));
    } catch {
      if (mode === "replace") {
        setResults([]);
      }
    } finally {
      if (mode === "append") setLoadingMoreResults(false);
    }
  }, [activeProfile?.id, fetchWithAuth, isAuthLoaded, isSignedIn]);

  useEffect(() => {
    void loadPersistedImages(0, "replace");
  }, [loadPersistedImages]);

  useEffect(() => {
    const handleProfileSwitch = (e: Event) => {
      const customEvent = e as CustomEvent<{ profileId?: string }>;
      const newProfileId = customEvent.detail?.profileId ?? (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : "");
      // Immediately clear results for instant responsive feedback
      setResults([]);
      setResultsPage(0);
      setResultsHasMore(false);
      void loadPersistedImages(0, "replace", newProfileId || "");
    };
    window.addEventListener("saad-profile-switched", handleProfileSwitch);
    return () => window.removeEventListener("saad-profile-switched", handleProfileSwitch);
  }, [loadPersistedImages]);

  // Recover an in-flight generation that was interrupted by a page refresh.
  // Strategy: if a pending marker exists in localStorage, show placeholders + poll
  // /api/assets every 3s until a new image (createdAt > startedAt) appears, OR until
  // 5 minutes pass (then auto-clear).
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    try {
      const raw = localStorage.getItem("ff_image_pending_job");
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        startedAt: number; tool: ToolId; model: string; prompt: string; aspect: string; expectedCount: number;
      };
      if (!saved || !saved.startedAt) { localStorage.removeItem("ff_image_pending_job"); return; }
      // Auto-discard markers older than 5 min
      if (Date.now() - saved.startedAt > 5 * 60 * 1000) { localStorage.removeItem("ff_image_pending_job"); return; }

      // Re-show placeholders so the user knows generation is still being recovered
      const placeholders: ResultItem[] = Array.from({ length: Math.max(1, saved.expectedCount || 1) }, () => ({
        id: uid("recover"),
        url: "",
        tool: saved.tool,
        model: saved.model,
        prompt: saved.prompt,
        aspect: saved.aspect,
        isPending: true,
      }));
      setPendingItems((prev) => [...placeholders, ...prev]);
      beginGeneration();

      const finish = (matched: ResultItem[] | null) => {
        if (cancelled) return;
        if (matched && matched.length) {
          setResults((prev) => {
            const known = new Set(prev.map((r) => r.id));
            const fresh = matched.filter((m) => !known.has(m.id));
            return [...fresh, ...prev];
          });
        }
        setPendingItems((prev) => prev.filter((p) => !placeholders.some((ph) => ph.id === p.id)));
        finishGeneration();
        try { localStorage.removeItem("ff_image_pending_job"); } catch {}
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      };

      const tryRecover = async () => {
        try {
          const res = await fetch("/api/assets?type=image", { cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(data?.assets)) return;
          const fresh = data.assets.filter((a: any) => {
            const t = new Date(a.createdAt || 0).getTime();
            return t >= saved.startedAt - 2000; // small clock-skew tolerance
          });
          if (fresh.length > 0) {
            const matched: ResultItem[] = fresh.map((a: any) => mapAssetToResultItem(a, { tool: saved.tool, model: saved.model, prompt: saved.prompt, aspect: saved.aspect }));
            finish(matched);
          } else if (Date.now() - saved.startedAt > 5 * 60 * 1000) {
            finish(null);
          }
        } catch {/* keep polling */}
      };

      void tryRecover();
      pollTimer = setInterval(tryRecover, 3000);
    } catch {/* ignore */}

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [beginGeneration, finishGeneration]);

  const selectedRatio = useMemo(() => ratioOptionForValue(aspectRatio), [aspectRatio]);
  const availableRatioOptions = useMemo(
    () => selectedModel.aspectRatios.map(ratioOptionForValue),
    [selectedModel.aspectRatios],
  );
  useEffect(() => {
    if (selectedModel.aspectRatios.length > 0 && !selectedModel.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(selectedModel.aspectRatios[0]);
      setAspectRatioDropdownOpen(false);
    }
  }, [aspectRatio, selectedModel.aspectRatios]);

  const resolutionOptions = selectedModel.resolutions ?? [];
  useEffect(() => {
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(resolution)) setResolution(resolutionOptions[0]);
  }, [resolution, resolutionOptions]);

  const createNeedsImage = selectedModel.inputType === "image-to-image" && Boolean((selectedModel as any).requiresReference) && !(selectedModel as any).text_api_route;
  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedCharacterId) || null,
    [characters, selectedCharacterId],
  );
  const qualityOptions = useMemo(() => {
    const options = selectedModel.qualityParam ?? [];
    return options;
  }, [selectedModel]);
  const selectedQuality = qualityOptions.length ? (quality || qualityOptions[0]) : undefined;
  const canUseAnnualUnlimitedCreate = activeTool === "create" &&
    hasAnnualUnlimitedImages &&
    isAnnualUnlimitedImageModel(selectedModel.id) &&
    isAnnualUnlimitedImageQuality(selectedQuality);
  const isAnnualUnlimitedCreate = canUseAnnualUnlimitedCreate && annualUnlimitedEnabled;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const subscription = data?.subscription;
        const planId = String(subscription?.planId ?? "").toLowerCase();
        setHasAnnualUnlimitedImages(Boolean(
          subscription?.active &&
            subscription?.billingInterval === "annual" &&
            ANNUAL_UNLIMITED_IMAGE_PLAN_IDS.has(planId),
        ));
      })
      .catch(() => {
        if (!cancelled) setHasAnnualUnlimitedImages(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canUseAnnualUnlimitedCreate && annualUnlimitedEnabled) {
      setAnnualUnlimitedEnabled(false);
    }
  }, [annualUnlimitedEnabled, canUseAnnualUnlimitedCreate]);

  const composer = useMemo(() => {
    const creditLabel = (credits: number) => `${formatCreditAmount(credits)} ${t("cr")}`;
    if (activeTool === "create") {
      if (isAnnualUnlimitedCreate) {
        return { placeholder: t("Describe what you want to generate..."), button: t("Generate Image - Unlimited"), promptEnabled: true };
      }
      const credits = getImageCreditCost(selectedModel, numImages, selectedQuality, resolution, referenceFiles.length);
      return { placeholder: t("Describe what you want to generate..."), button: t("Generate Image") + " - " + creditLabel(credits), promptEnabled: true };
    }
    if (activeTool === "enhance") {
      const model = enhanceModels.find((entry) => entry.id === enhanceModelId) ?? enhanceModels[0];
      const credits = model ? getImageCreditCost(model, 1) : 0;
      return { placeholder: t("Enhancement instructions (optional) - e.g. \"cinematic, 8K, sharp\"..."), button: t("Enhance Photo") + " - " + creditLabel(credits), promptEnabled: true };
    }
    if (activeTool === "relight") return { placeholder: t("Describe the lighting you want..."), button: t("Relight Image") + " - " + creditLabel(getImageCreditCost(EDIT_MODELS[0], relightVariations)), promptEnabled: true };
    if (activeTool === "inpaint") {
      const model = editModels.find((entry) => entry.id === inpaintModelId) ?? editModels[0];
      const credits = model ? getImageCreditCost(model, inpaintVariations) : 0;
      return { placeholder: t("Describe what should replace the painted area..."), button: t("Inpaint") + " - " + creditLabel(credits), promptEnabled: true };
    }
    if (activeTool === "upscale") return { placeholder: t("Upload media to upscale"), button: t("Upscale Image") + " - " + creditLabel(getImageUtilityCreditCost("upscale", getImageUpscaleTargetResolution(upscaleScale))), promptEnabled: false };
    return { placeholder: t("Upload source face and target above"), button: t("Swap Face") + " - " + creditLabel(getImageUtilityCreditCost("faceSwap")), promptEnabled: false };
  }, [activeTool, editModels, enhanceModelId, enhanceModels, inpaintModelId, inpaintVariations, isAnnualUnlimitedCreate, numImages, relightVariations, resolution, selectedModel, selectedQuality, t, upscaleScale]);

  useEffect(() => {
    setNumImages(Math.min(Math.max(1, numImages), selectedModel.maxImages));
    if (selectedModel.aspectRatios.length && !selectedModel.aspectRatios.includes(aspectRatio)) setAspectRatio(selectedModel.aspectRatios[0]);
    if (qualityOptions.length && !qualityOptions.includes(quality)) setQuality(qualityOptions[0]);
  }, [selectedModel, numImages, aspectRatio, quality, qualityOptions]);

  const canGenerate = useMemo(() => {
    if (activeTool === "create") return Boolean(prompt.trim()) && (!createNeedsImage || referenceFiles.length > 0 || Boolean(selectedCharacter));
    if (activeTool === "relight") return Boolean(relightFile && prompt.trim());
    if (activeTool === "inpaint") return Boolean(inpaintFile && prompt.trim());
    if (activeTool === "upscale") return Boolean(upscaleFile);
    if (activeTool === "enhance") return enhanceFiles.length > 0;
    return Boolean(faceSource && faceTarget);
  }, [activeTool, createNeedsImage, enhanceFiles.length, faceSource, faceTarget, inpaintFile, prompt, referenceFiles.length, relightFile, selectedCharacter, upscaleFile]);

  const estimatedCredits = useMemo(() => {
    if (activeTool === "create") {
      if (isAnnualUnlimitedCreate) return 0;
      return getImageCreditCost(selectedModel, numImages, selectedQuality, resolution);
    }
    if (activeTool === "enhance") {
      const model = enhanceModels.find((entry) => entry.id === enhanceModelId) ?? enhanceModels[0];
      return model ? getImageCreditCost(model, 1) : 0;
    }
    if (activeTool === "relight") return getImageCreditCost(EDIT_MODELS[0], relightVariations);
    if (activeTool === "inpaint") {
      const model = editModels.find((entry) => entry.id === inpaintModelId) ?? editModels[0];
      return model ? getImageCreditCost(model, inpaintVariations) : 0;
    }
    if (activeTool === "upscale") return getImageUtilityCreditCost("upscale", getImageUpscaleTargetResolution(upscaleScale));
    return getImageUtilityCreditCost("faceSwap");
  }, [activeTool, editModels, enhanceModelId, enhanceModels, inpaintModelId, inpaintVariations, isAnnualUnlimitedCreate, numImages, relightVariations, resolution, selectedModel, selectedQuality, upscaleScale]);

  const addResultItems = useCallback((urls: string[], tool: ToolId, model: string, p: string, aspect: string, records?: Partial<ResultItem>[]) => {
    const newItems = urls.map((url, index) => ({
      id: records?.[index]?.id || uid("img"),
      url,
      originalUrl: records?.[index]?.originalUrl || url,
      thumbnailUrl: records?.[index]?.thumbnailUrl,
      width: records?.[index]?.width,
      height: records?.[index]?.height,
      tool,
      model,
      prompt: p,
      aspect,
    }));
    setResults((prev) => [...newItems, ...prev]);
    newItems.forEach((item) => addAsset({ type: "image", url: resultOriginalUrl(item), prompt: item.prompt, model: item.model, resolution: item.aspect, title: item.prompt.slice(0, 60) }));
  }, [addAsset]);

  const generateCreate = useCallback(async () => {
    const maxRef = selectedModel.maxRefImages;
    const filesToSend = maxRef > 0 ? referenceFiles.slice(0, maxRef) : [];
    const uploadedReferenceUrls = await Promise.all(filesToSend.map(fileToDataUrl));
    const characterReferenceUrls = selectedCharacter?.referenceUrls?.slice(0, Math.max(0, maxRef)) ?? [];
    const imageUrls = maxRef > 0
      ? [...characterReferenceUrls, ...uploadedReferenceUrls].slice(0, maxRef)
      : [];
    const pkg = selectedCharacter?.metadata?.characterPackage;
    const characterPrompt = selectedCharacter
      ? [
          `Use the selected Character Package: ${selectedCharacter.name}.`,
          pkg?.mainIdentity ? `Main Identity: ${pkg.mainIdentity}` : selectedCharacter.description,
          pkg?.faceMemory ? `Face Memory: ${pkg.faceMemory}` : "Preserve the same face, identity, ethnicity, proportions, and recognizable features.",
          pkg?.bodyProfile ? `Body Profile: ${pkg.bodyProfile}` : "",
          pkg?.outfitMemory ? `Outfit Memory: ${pkg.outfitMemory}` : "",
          pkg?.styleDna ? `Style DNA: ${pkg.styleDna}` : "",
          pkg?.states?.hero ? `Active State: ${pkg.states.hero}` : "",
          pkg?.consistencyProfile ? `Consistency Profile: ${pkg.consistencyProfile}` : "",
        ].filter(Boolean).join("\n")
      : "";
    const basePrompt = characterPrompt ? `${characterPrompt}\n\n${prompt}` : prompt;
    // Inject Style/Effect/Camera/Sketch/Location/Element systemPromptAddon into the prompt
    // so the model actually applies the selected preset (thumbnails are just index cards).
    const effectivePrompt = withPresetsAppended(basePrompt, {
      selectedStyleId: selectedStyle,
      selectedEffectId,
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
    const activeQuality = qualityOptions.length ? (quality || qualityOptions[0]) : (quality || undefined);
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const body: Record<string, unknown> = {
      prompt: effectivePrompt,
      modelId: selectedModel.id,
      aspectRatio,
      numImages,
      quality: activeQuality,
      resolution: resolutionOptions.length ? resolution : activeQuality,
      outputFormat: selectedModel.id.includes("gpt-image-2.5") ? outputFormat : undefined,
      useAnnualUnlimited: isAnnualUnlimitedCreate,
      profileId: currentProfileId,
    };
    if (imageUrls.length > 0) {
      // Always send imageInputField so the route knows which API field to use
      if (selectedModel.imageInputField) body.imageInputField = selectedModel.imageInputField;
      if (imageUrls.length === 1) body.imageUrl = imageUrls[0];
      else body.imageUrls = imageUrls;
    }
    // 1. Call /api/generate/image
    const res = await fetchWithAuth("/api/generate/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Generation failed");
    const urls = normalizeImageResponseUrls(data);
    if (!urls.length) throw new Error("Generation completed but no image URL was returned");

    // 2. Display results immediately in UI for instant feedback
    const generationId = data.generationId || data.taskId || data.id;
    const initialRecords: Partial<ResultItem>[] = generationId && urls[0]
      ? [{ id: String(generationId), originalUrl: urls[0], thumbnailUrl: urls[0] }]
      : [];
    addResultItems(urls, "create", selectedModel.label, prompt, aspectRatio, initialRecords);

    // 3. Persist to permanent storage in background non-blockingly
    if (generationId && urls.length) {
      void (async () => {
        try {
          const persistRes = await fetchWithAuth("/api/assets/persist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generationId, mediaUrl: urls[0], profileId: currentProfileId }),
          });
          const persistData = await persistRes.json();
          if (persistRes.ok && persistData.url) {
            void loadPersistedImages(0, "replace");
          }
        } catch (err) {
          console.warn("[image-persist] Background storage sync warning:", err);
        }
      })();
    } else {
      void loadPersistedImages(0, "replace");
    }
  }, [addResultItems, aspectRatio, isAnnualUnlimitedCreate, loadPersistedImages, numImages, prompt, quality, qualityOptions, referenceFiles, selectedCharacter, selectedModel, selectedStyle, selectedEffectId, selectedCameraId, selectedSketchId, selectedShotTypeId, selectedFilmStockId, selectedMovieLookId, selectedLightingId, selectedMotionBlurId, selectedGrainId, selectedHalationId, selectedTonalLookId, selectedLocationId, selectedElementId, selectedPalette]);

  const generateRelight = useCallback(async () => {
    if (!relightFile) throw new Error("Upload image first");
    const preset = LIGHTING_PRESETS.find((p) => p.id === relightPreset) || LIGHTING_PRESETS[0];
    const imgData = await fileToDataUrl(relightFile);
    const payload = { model: "seedream/4.5-edit", prompt: `Relight this image with ${preset.prompt}. Brightness:${relightBrightness} Contrast:${relightContrast} Temperature:${relightTemperature > 50 ? "warm" : "cool"} Direction:${relightDirection}`, image: imgData, num_images: relightVariations };
    console.log("RELIGHT_PAYLOAD", payload);
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const res = await fetchWithAuth("/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: payload.prompt,
        modelId: "seedream/4.5-edit",
        numImages: relightVariations,
        imageInputField: "image_urls",
        imageUrl: imgData,
        profileId: currentProfileId,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Relight failed");
    const urls = normalizeImageResponseUrls(data);
    if (!urls.length) throw new Error("Relight completed but no image URL was returned");
    const before = URL.createObjectURL(relightFile);
    if (urls[0]) setCompare({ before, after: urls[0] });
    addResultItems(urls, "relight", "Seedream 4.5 Edit", payload.prompt, "source");
  }, [activeProfile?.id, addResultItems, fetchWithAuth, relightBrightness, relightContrast, relightDirection, relightFile, relightPreset, relightTemperature, relightVariations]);

  const generateInpaint = useCallback(async () => {
    if (!inpaintFile) throw new Error("Upload image first");
    const maskData = maskExporterRef.current();
    if (!maskData) throw new Error("Mask is missing");
    const imageData = await fileToDataUrl(inpaintFile);
    const guideImage = await buildInpaintGuideImage(imageData, maskData);
    const payload = { model: inpaintModelId, prompt, image: imageData, mask: maskData, guide: guideImage, num_images: inpaintVariations };
    console.log("INPAINT_PAYLOAD", payload);
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const res = await fetchWithAuth("/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${prompt}. Apply edits only where the mask/painted area is indicated.`,
        modelId: inpaintModelId,
        numImages: inpaintVariations,
        imageInputField: "image_urls",
        imageUrl: guideImage,
        profileId: currentProfileId,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Inpaint failed");
    const urls = normalizeImageResponseUrls(data);
    if (!urls.length) throw new Error("Inpaint completed but no image URL was returned");
    const before = URL.createObjectURL(inpaintFile);
    if (urls[0]) setCompare({ before, after: urls[0] });
    addResultItems(urls, "inpaint", inpaintModelId, prompt, "source");
  }, [activeProfile?.id, addResultItems, fetchWithAuth, inpaintFile, inpaintModelId, inpaintVariations, prompt]);

  const generateUpscale = useCallback(async () => {
    if (!upscaleFile) throw new Error("Upload media first");
    if (!upscaleFile.type.startsWith("image/")) {
      throw new Error("Image page upscale supports image files only.");
    }
    const data = await fileToDataUrl(upscaleFile);
    const payload = { endpoint: "/api/upscale", media: data, scale: upscaleScale, denoise: upDenoise, sharpen: upSharpen, face_enhance: upFace, color_enhance: upColor, format: upFormat, quality: upQuality };
    console.log("UPSCALE_PAYLOAD", payload);
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const res = await fetchWithAuth("/api/generate/upscale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: data,
        scale: upscaleScale,
        denoise: upDenoise,
        sharpen: upSharpen,
        faceEnhance: upFace,
        colorEnhance: upColor,
        format: upFormat,
        quality: upQuality,
        profileId: currentProfileId,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Upscale failed");
    const out = (json.videoUrl || json.imageUrl || json.mediaUrl) as string | undefined;
    if (!out) throw new Error("Upscale did not return output URL");
    const before = URL.createObjectURL(upscaleFile);
    setCompare({ before, after: out });
    addResultItems([out], "upscale", "Video Upscaler Pro", "Upscaled media", "source");
  }, [activeProfile?.id, addResultItems, fetchWithAuth, upColor, upDenoise, upFace, upFormat, upQuality, upSharpen, upscaleFile, upscaleScale]);

  const generateFaceSwap = useCallback(async () => {
    if (!faceSource || !faceTarget) throw new Error("Upload source and target");
    const sourceData = await fileToDataUrl(faceSource);
    const targetData = await fileToDataUrl(faceTarget);
    const payload = {
      model: "wavespeed-ai/image-face-swap-pro",
      sourceImageUrl: sourceData,
      targetImageUrl: targetData,
      face_index: faceIndex,
      blend: faceBlend / 100,
      match_expression: faceExpression,
      match_skin: faceSkin,
    };
    console.log("FACE_SWAP_PAYLOAD", payload);
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const res = await fetchWithAuth("/api/generate/face-swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        profileId: currentProfileId,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Face swap failed");
    const out = data.imageUrl as string | undefined;
    if (!out) throw new Error("Face swap did not return image URL");
    const before = URL.createObjectURL(faceTarget);
    setCompare({ before, after: out });
    addResultItems([out], "face-swap", "Image Face Swap Pro", "Face swap result", "source");
  }, [activeProfile?.id, addResultItems, faceBlend, faceExpression, faceIndex, faceSkin, faceSource, faceTarget, fetchWithAuth]);

  const generateEnhance = useCallback(async () => {
    if (!enhanceFiles.length) throw new Error("Upload at least one image first");
    const enhanceModel = enhanceModels.find((m) => m.id === enhanceModelId) ?? enhanceModels[0];
    if (!enhanceModel) throw new Error("No enhancement model available");
    const maxRef = enhanceModel.maxRefImages;
    const filesToSend = enhanceFiles.slice(0, maxRef > 0 ? maxRef : 1);
    const imgDataArray = await Promise.all(filesToSend.map(fileToDataUrl));
    const enhancePrompt =
      prompt.trim() ||
      "Enhance and restore this photo. Preserve the subject's exact identity, face features, skin tone, and appearance. Improve sharpness, detail, and remove noise and blur. Photorealistic, high quality.";
    const currentProfileId = activeProfile?.id || (typeof window !== "undefined" ? localStorage.getItem("saad_active_profile_id") : undefined);
    const body: Record<string, unknown> = {
      prompt: enhancePrompt,
      modelId: enhanceModel.id,
      numImages: 1,
      imageInputField: enhanceModel.imageInputField,
      profileId: currentProfileId,
    };
    if (imgDataArray.length === 1) {
      body.imageUrl = imgDataArray[0];
    } else {
      body.imageUrls = imgDataArray;
    }
    const res = await fetchWithAuth("/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Enhancement failed");
    const urls = normalizeImageResponseUrls(data);
    if (!urls.length) throw new Error("Enhancement completed but no image URL was returned");
    const before = URL.createObjectURL(enhanceFiles[0]);
    if (urls[0]) setCompare({ before, after: urls[0] });
    addResultItems(urls, "enhance", enhanceModel.label, enhancePrompt, "source");
  }, [activeProfile?.id, addResultItems, enhanceFiles, enhanceModelId, fetchWithAuth, prompt]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    const now = Date.now();
    if (now - lastSubmitAtRef.current < 800) return;
    lastSubmitAtRef.current = now;
    const gate = await guardGeneration({ requiredCredits: estimatedCredits, action: `image:${activeTool}` });
    if (!gate.ok) {
      if (gate.reason === "error") setError(gate.message ?? getSafeErrorMessage(gate.message));
      return;
    }
    const pendingCount = activeTool === "create" ? numImages : activeTool === "relight" ? relightVariations : activeTool === "inpaint" ? inpaintVariations : 1;
    const pendingModel = activeTool === "create" ? selectedModel.label : activeTool === "enhance" ? (enhanceModels.find((m) => m.id === enhanceModelId)?.label ?? enhanceModelId) : activeTool === "relight" ? "Seedream 4.5 Edit" : activeTool === "inpaint" ? inpaintModelId : activeTool === "upscale" ? "Upscaler" : "Face Swap";
    const pendingAspect = activeTool === "create" ? aspectRatio : "source";
    const pendingPrompt = prompt || t("Generating...");
    const placeholders: ResultItem[] = Array.from({ length: pendingCount }, () => ({
      id: uid("pending"),
      url: "",
      tool: activeTool,
      model: pendingModel,
      prompt: pendingPrompt,
      aspect: pendingAspect,
      isPending: true,
    }));

    setPendingItems((prev) => [...placeholders, ...prev]);
    beginGeneration();
    setError(null);
    // Persist generation marker so we can recover after a page refresh
    try {
      localStorage.setItem("ff_image_pending_job", JSON.stringify({
        startedAt: Date.now(),
        tool: activeTool,
        model: pendingModel,
        prompt: pendingPrompt,
        aspect: pendingAspect,
        expectedCount: pendingCount,
      }));
    } catch {}
    try {
      if (activeTool === "create") await generateCreate();
      if (activeTool === "enhance") await generateEnhance();
      if (activeTool === "relight") await generateRelight();
      if (activeTool === "inpaint") await generateInpaint();
      if (activeTool === "upscale") await generateUpscale();
      if (activeTool === "face-swap") await generateFaceSwap();
    } catch (e) {
      console.error("[image generation] actual error:", e);
      setError(getSafeErrorMessage(e));
    } finally {
      setPendingItems((prev) => prev.filter((item) => !placeholders.some((ph) => ph.id === item.id)));
      finishGeneration();
      try { localStorage.removeItem("ff_image_pending_job"); } catch {}
    }
  }, [activeTool, aspectRatio, beginGeneration, canGenerate, enhanceModelId, estimatedCredits, finishGeneration, generateCreate, generateEnhance, generateFaceSwap, generateInpaint, generateRelight, generateUpscale, getSafeErrorMessage, guardGeneration, inpaintModelId, inpaintVariations, numImages, prompt, relightVariations, selectedModel.label]);

  const handleDelete = useCallback((id: string) => {
    setDeleteTargetIds([id]);
  }, []);

  const handleBulkDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setDeleteTargetIds(ids);
  }, []);

  const cancelImageDelete = useCallback(() => {
    if (deletingImages) return;
    setDeleteTargetIds([]);
  }, [deletingImages]);

  const confirmImageDelete = useCallback(async () => {
    if (deleteTargetIds.length === 0 || deletingImages) return;
    const ids = deleteTargetIds;
    setDeletingImages(true);
    try {
      const response = await fetch("/api/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids }),
      });
      if (!response.ok) throw new Error("Failed to delete image generation.");
      const idSet = new Set(ids);
      setResults((prev) => prev.filter((item) => !idSet.has(item.id)));
      setDeleteTargetIds([]);
    } catch {
      void loadPersistedImages(0, "replace");
    } finally {
      setDeletingImages(false);
    }
  }, [deleteTargetIds, deletingImages, loadPersistedImages]);

  // Use a generated image as a reference for the next generation. If the active
  // model doesn't accept references, switch to a sensible image-to-image default.
  const handleUseAsReference = useCallback(async (item: ResultItem) => {
    try {
      // Try direct fetch first; many CDNs (KIE temp domain) block CORS, so
      // fall back to our authenticated server-side proxy when that happens.
      let blob: Blob | null = null;
      const requiresProxy = item.url.includes("backblazeb2.com") ||
                            item.url.includes("r2.dev") ||
                            item.url.includes("supabase.co") ||
                            item.url.includes("cloudflare");
      if (!requiresProxy) {
        try {
          const direct = await fetch(resultOriginalUrl(item), { mode: "cors" });
          if (direct.ok) blob = await direct.blob();
        } catch { /* CORS or network — fall through to proxy */ }
      }
      if (!blob) {
        const proxied = await fetch(`/api/proxy-image?url=${encodeURIComponent(resultOriginalUrl(item))}`);
        if (!proxied.ok) throw new Error(`Proxy returned ${proxied.status}`);
        blob = await proxied.blob();
      }
      const ext = (blob.type.split("/")[1] || "png").split("+")[0];
      const file = new File([blob], `result_${item.id}.${ext}`, { type: blob.type || "image/png" });

      // Pick a target model that accepts image references.
      const acceptsRefs = selectedModel.imageInputField !== undefined && selectedModel.maxRefImages > 0;
      const targetModel = acceptsRefs
        ? selectedModel
        : (visibleImageModels.find((m) => m.id === "google/nano-banana-edit")
            ?? visibleImageModels.find((m) => m.imageInputField !== undefined && m.maxRefImages > 0)
            ?? selectedModel);

      if (targetModel.id !== selectedModel.id) setSelectedModel(targetModel);
      setActiveTool("create");
      setReferenceFiles((prev) => {
        const cap = Math.max(1, targetModel.maxRefImages || 1);
        return appendReferenceFiles(prev, [file]).slice(-cap);
      });
    } catch (err) {
      console.error("Failed to use image as reference", err);
    }
  }, [selectedModel]);

  const handleReuse = useCallback((item: ResultItem) => {
    if (item.prompt) setPrompt(item.prompt);
    if (item.model) {
      const match = visibleImageModels.find((m) => m.id === item.model || m.label.toLowerCase() === item.model?.toLowerCase());
      if (match) setSelectedModel(match);
    }
    if (item.aspect) {
      setAspectRatio(item.aspect);
    }
    setActiveTool("create");
  }, [visibleImageModels]);

  const handleInpaintTool = useCallback(async (item: ResultItem) => {
    try {
      let blob: Blob | null = null;
      try {
        const direct = await fetch(resultOriginalUrl(item), { mode: "cors" });
        if (direct.ok) blob = await direct.blob();
      } catch { /* proxy */ }
      if (!blob) {
        const proxied = await fetch(`/api/proxy-image?url=${encodeURIComponent(resultOriginalUrl(item))}`);
        if (proxied.ok) blob = await proxied.blob();
      }
      if (blob) {
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const file = new File([blob], `inpaint_${item.id}.${ext}`, { type: blob.type || "image/png" });
        setInpaintFile(file);
        setActiveTool("inpaint");
      }
    } catch (err) {
      console.error("Failed to load inpaint image", err);
    }
  }, []);

  const handleUpscaleTool = useCallback(async (item: ResultItem) => {
    try {
      let blob: Blob | null = null;
      try {
        const direct = await fetch(resultOriginalUrl(item), { mode: "cors" });
        if (direct.ok) blob = await direct.blob();
      } catch { /* proxy */ }
      if (!blob) {
        const proxied = await fetch(`/api/proxy-image?url=${encodeURIComponent(resultOriginalUrl(item))}`);
        if (proxied.ok) blob = await proxied.blob();
      }
      if (blob) {
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const file = new File([blob], `upscale_${item.id}.${ext}`, { type: blob.type || "image/png" });
        setUpscaleFile(file);
        setActiveTool("upscale");
      }
    } catch (err) {
      console.error("Failed to load upscale image", err);
    }
  }, []);

  const handleRelightTool = useCallback(async (item: ResultItem) => {
    try {
      let blob: Blob | null = null;
      try {
        const direct = await fetch(resultOriginalUrl(item), { mode: "cors" });
        if (direct.ok) blob = await direct.blob();
      } catch { /* proxy */ }
      if (!blob) {
        const proxied = await fetch(`/api/proxy-image?url=${encodeURIComponent(resultOriginalUrl(item))}`);
        if (proxied.ok) blob = await proxied.blob();
      }
      if (blob) {
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const file = new File([blob], `relight_${item.id}.${ext}`, { type: blob.type || "image/png" });
        setRelightFile(file);
        setActiveTool("relight");
      }
    } catch (err) {
      console.error("Failed to load relight image", err);
    }
  }, []);

  const renderWorkspace = () => {
    if (activeTool === "create") {
      return (
        <ResultGrid
          items={[...pendingItems, ...results]}
          onInspect={setInspectorAsset}
          onRemix={(item) => {
            setActiveTool("create");
            setPrompt(`Remix this style: ${item.prompt}`);
          }}
          onReuse={handleReuse}
          onUse={handleUseAsReference}
          onInpaint={handleInpaintTool}
          onUpscale={handleUpscaleTool}
          onRelight={handleRelightTool}
          onDelete={handleDelete}
          onBulkDelete={handleBulkDelete}
          hasMore={resultsHasMore}
          loadingMore={loadingMoreResults}
          onLoadMore={() => void loadPersistedImages(resultsPage + 1, "append")}
        />
      );
    }
    if (generating) {
      return (
        <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-slate-950/80 p-6 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-pink-500/5 via-transparent to-transparent pointer-events-none" />
          <SaadLoader
            modelLabel={selectedModel?.label || "Image Studio"}
            toolLabel={activeTool.toUpperCase()}
          />
        </div>
      );
    }
    if (activeTool === "inpaint") return <InpaintWorkspace source={inpaintFile} setSource={setInpaintFile} brushSize={brushSize} setBrushSize={setBrushSize} maskVersion={maskVersion} setMaskVersion={setMaskVersion} registerMaskExporter={(fn) => { maskExporterRef.current = fn; }} />;
    if (compare) return <CompareSlider before={compare.before} after={compare.after} onInspect={(url) => setInspectorAsset({ type: "image", url, title: activeTool.toUpperCase() })} />;
    if (activeTool === "enhance") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 text-zinc-400">
          <Zap className="h-10 w-10 text-amber-400/60" />
          <div className="text-center">
            <p className="text-sm font-semibold text-amber-300">{t("ENHANCE — Photo Restoration")}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("Upload a photo in the settings panel → click Enhance Photo")}</p>
            <p className="mt-1 text-xs text-zinc-600">{t("Uses true image-to-image AI to preserve identity while improving quality")}</p>
          </div>
        </div>
      );
    }
    return <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-zinc-500">{activeTool === "relight" ? t("Upload image and relight") : activeTool === "upscale" ? t("Upload media and upscale") : t("Upload source and target images")}</div>;
  };

  const renderRightPanel = () => {
    if (activeTool === "create") {
      return <>
        {hasAnyReferenceSelection ? (
        <SettingsAccordion label="References & Styling" summary={selectedStyle || "None"} defaultOpen>
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
        </SettingsAccordion>
        ) : null}

        <SettingsAccordion label="Model" summary={selectedModel.label} defaultOpen>
          <ModelDropdown selected={selectedModel} onSelect={setSelectedModel} models={visibleImageModels} />
        </SettingsAccordion>

        {selectedModel.aspectRatios.length ? (
          <SettingsAccordion label="Aspect Ratio" summary={aspectRatio} defaultOpen>
            <div>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={aspectRatioDropdownOpen}
                onClick={() => setAspectRatioDropdownOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-pink-500"
              >
                <span className="flex items-center gap-3">
                  <span className="ratio-menu-icon" aria-hidden="true">
                    <span className="ratio-shape" style={ratioIconStyle(selectedRatio)} />
                  </span>
                  <span className="font-semibold">{selectedRatio.value}</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 text-zinc-400 transition", aspectRatioDropdownOpen && "rotate-180")} />
              </button>

              {aspectRatioDropdownOpen ? (
                <div role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#080a12] p-1.5 shadow-2xl shadow-black/50">
                  {availableRatioOptions.map((ratio) => (
                    <button
                      key={ratio.value}
                      type="button"
                      role="option"
                      aria-selected={aspectRatio === ratio.value}
                      onClick={() => {
                        setAspectRatio(ratio.value);
                        setAspectRatioDropdownOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-white",
                        aspectRatio === ratio.value && "bg-pink-500/10 text-pink-200",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span className={cn("ratio-menu-icon", aspectRatio === ratio.value && "active")} aria-hidden="true">
                          <span className="ratio-shape" style={ratioIconStyle(ratio)} />
                        </span>
                        <span className="font-semibold">{ratio.value}</span>
                      </span>
                      {aspectRatio === ratio.value ? <Check className="h-4 w-4 text-pink-300" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </SettingsAccordion>
        ) : null}

        {selectedModel.maxImages > 1 ? (
          <SettingsAccordion label="Number of Images" summary={String(numImages)} defaultOpen>
            <div className="num-selector">
              {(selectedModel.maxImages > 4 ? [1, 2, 4, 8, 15] : [1, 2, 3, 4])
                .filter((n) => n <= selectedModel.maxImages)
                .map((n) => (
                  <button key={n} onClick={() => setNumImages(Math.min(n, selectedModel.maxImages))} className={cn("num-btn", numImages === n && "active")}>{n}</button>
                ))}
            </div>
            {selectedModel.maxImages > 4 && numImages > 1 ? (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                {t("For consistent multi-image results, include the count in your prompt (e.g. \"3 images. First,... Second,... Third,...\"). Start with 2–4 for stability.")}
              </p>
            ) : null}
          </SettingsAccordion>
        ) : null}

        {qualityOptions.length ? (
          <SettingsAccordion label={qualityOptions.some((q) => /k$/i.test(q)) ? "Resolution" : "Quality"} summary={quality || qualityOptions[0]} defaultOpen>
            <select
              aria-label={t("Image quality or resolution")}
              value={quality || qualityOptions[0]}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
            >
              {qualityOptions.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </SettingsAccordion>
        ) : null}
        {resolutionOptions.length ? (
          <SettingsAccordion label="Resolution" summary={resolution} defaultOpen>
            <select aria-label="Image resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-pink-500">
              {resolutionOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </SettingsAccordion>
        ) : null}
        {selectedModel.id.includes("gpt-image-2.5") ? (
          <SettingsAccordion label="Output format" summary={outputFormat} defaultOpen={false}>
            <select aria-label="Image output format" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as "png" | "jpeg" | "webp")} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-pink-500">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </SettingsAccordion>
        ) : null}

        {/* ── Gateway card → /image-presets ── */}
        <StyleLibraryGatewayCard onOpen={() => setShowStyleLibrary(true)} />

      </>;
    }

    if (activeTool === "relight") {
      return <>
        <UploadBox label="Upload image to relight" file={relightFile} onFile={setRelightFile} required />
        <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Lighting Preset</p><div className="grid grid-cols-3 gap-2">{LIGHTING_PRESETS.map((preset) => <button key={preset.id} onClick={() => setRelightPreset(preset.id)} className={cn("rounded-xl border px-2 py-2 text-left text-[11px]", relightPreset === preset.id ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{preset.name}</button>)}</div></section>
        <SliderField label="Brightness" value={relightBrightness} onChange={setRelightBrightness} />
        <SliderField label="Contrast" value={relightContrast} onChange={setRelightContrast} />
        <SliderField label="Temperature" value={relightTemperature} onChange={setRelightTemperature} />
        <SliderField label="Shadow Intensity" value={relightShadow} onChange={setRelightShadow} />
        <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Light Direction</p><div className="grid grid-cols-3 gap-1.5 text-xs">{["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"].map((d) => <button key={d} onClick={() => setRelightDirection(d)} className={cn("rounded-md border py-1.5", relightDirection === d ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{d}</button>)}</div></section>
        <CountSelector label="Number of Variations" value={relightVariations} onChange={setRelightVariations} />
      </>;
    }

    if (activeTool === "inpaint") {
      return <>
        <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Edit Model</p><select aria-label={t("Edit model selection")} value={inpaintModelId} onChange={(e) => setInpaintModelId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100">{editModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></section>
        <CountSelector label="Number of Variations" value={inpaintVariations} onChange={setInpaintVariations} />
        <SliderField label="Brush Size" value={brushSize} onChange={setBrushSize} min={5} max={100} />
      </>;
    }

    if (activeTool === "enhance") {
      const currentEnhanceModel = enhanceModels.find((m) => m.id === enhanceModelId) ?? enhanceModels[0];
      const maxSlots = currentEnhanceModel?.maxRefImages ?? 1;
      return <>
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Enhancement Model</p>
          <select
            aria-label={t("Enhancement model selection")}
            value={enhanceModelId}
            onChange={(e) => { setEnhanceModelId(e.target.value); setEnhanceFiles([]); }}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
          >
            {enhanceModels.map((model) => (
              <option key={model.id} value={model.id}>{model.label} (max {model.maxRefImages} img)</option>
            ))}
          </select>
        </section>

        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
            Input Images
            <span className="ml-2 font-normal normal-case text-zinc-600">{enhanceFiles.length}/{maxSlots} added</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: Math.min(maxSlots, 6) }).map((_, i) => {
              const file = enhanceFiles[i] ?? null;
              const preview = file ? URL.createObjectURL(file) : null;
              return (
                <div key={i} className="relative">
                  <label className={cn(
                    "flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border text-xs transition",
                    file ? "border-pink-400/50 bg-pink-500/5" : "border-dashed border-white/15 bg-white/3 text-zinc-600 hover:border-white/30",
                  )}>
                    {preview ? (
                      <img src={preview} alt="" className="h-full w-full rounded-xl object-cover" />
                    ) : (
                      <><UploadCloud className="mb-1 h-5 w-5" /><span>{i === 0 ? t("Required") : t("Optional")}</span></>
                    )}
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setEnhanceFiles((prev) => {
                          const next = [...prev];
                          next[i] = f;
                          return next.filter(Boolean);
                        });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {file && (
                    <button
                      onClick={() => setEnhanceFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-zinc-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-relaxed text-amber-200">
          <strong className="text-amber-300">{t("✦ True Image-to-Image")}</strong><br />
          {t("ENHANCE sends your photo directly as input to the AI — preserves identity. Unlike CREATE which uses it as loose inspiration.")}
        </div>
      </>;
    }

    if (activeTool === "upscale") {
      return <>
        <UploadBox label="Upload image" file={upscaleFile} onFile={setUpscaleFile} required accept="image/*" />
        <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Scale Factor</p><div className="grid grid-cols-2 gap-2">{[2, 4].map((n) => <button key={n} onClick={() => setUpscaleScale(n)} className={cn("rounded-xl border py-2 text-sm font-semibold", upscaleScale === n ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{n}x</button>)}</div></section>
        <ToggleField label="Denoise" checked={upDenoise} onChange={setUpDenoise} />
        <ToggleField label="Sharpen" checked={upSharpen} onChange={setUpSharpen} />
        <ToggleField label="Face Enhancement" checked={upFace} onChange={setUpFace} />
        <ToggleField label="Color Enhancement" checked={upColor} onChange={setUpColor} />
        <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Output Format</p><div className="grid grid-cols-3 gap-2">{(["png", "webp", "jpg"] as const).map((f) => <button key={f} onClick={() => setUpFormat(f)} className={cn("rounded-lg border py-2 text-sm uppercase", upFormat === f ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{f}</button>)}</div>{(upFormat === "jpg" || upFormat === "webp") ? <SliderField label="Quality" value={upQuality} onChange={setUpQuality} min={80} max={100} /> : null}</section>
      </>;
    }

    return <>
      <UploadBox label="Source face" file={faceSource} onFile={setFaceSource} required />
      <UploadBox label="Target image" file={faceTarget} onFile={setFaceTarget} required />
      <SliderField label="Face Blend" value={faceBlend} onChange={setFaceBlend} min={0} max={100} />
      <ToggleField label="Keep target expression" checked={faceExpression} onChange={setFaceExpression} />
      <ToggleField label="Match skin tones" checked={faceSkin} onChange={setFaceSkin} />
      <section className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">Target Face Index</p><div className="grid grid-cols-4 gap-2">{[0,1,2,3].map((i) => <button key={i} onClick={() => setFaceIndex(i)} className={cn("rounded-lg border py-2 text-sm", faceIndex === i ? "border-pink-400 bg-pink-500/10 text-pink-300" : "border-white/10 bg-white/5 text-zinc-400")}>{i+1}</button>)}</div></section>
    </>;
  };

  const handleAttach = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files).filter((f) => f.type.startsWith("image/")) : [];
    if (!files.length) return;
    const maxRef = selectedModel.maxRefImages;
    if (maxRef <= 0) return;
    setReferenceFiles((prev) => appendReferenceFiles(prev, files).slice(0, maxRef));
    event.target.value = "";
  };

  const [composerDragActive, setComposerDragActive] = useState(false);
  const composerDragDepthRef = useRef(0);

  const hasImageFileDrag = useCallback((dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return false;
    const items = Array.from(dataTransfer.items || []);
    if (items.length > 0) {
      return items.some((item) => item.kind === "file" && item.type.startsWith("image/"));
    }
    return Array.from(dataTransfer.files || []).some((file) => file.type.startsWith("image/"));
  }, []);

  useEffect(() => {
    const preventBrowserFileDrop = (event: globalThis.DragEvent) => {
      if (!hasImageFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    window.addEventListener("dragover", preventBrowserFileDrop);
    window.addEventListener("drop", preventBrowserFileDrop);
    return () => {
      window.removeEventListener("dragover", preventBrowserFileDrop);
      window.removeEventListener("drop", preventBrowserFileDrop);
    };
  }, [hasImageFileDrag]);

  const handleComposerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    composerDragDepthRef.current += 1;
    e.dataTransfer.dropEffect = "copy";
    setComposerDragActive(true);
  };

  const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setComposerDragActive(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
    if (composerDragDepthRef.current === 0) setComposerDragActive(false);
  };

  const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    composerDragDepthRef.current = 0;
    setComposerDragActive(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    const maxRef = selectedModel.maxRefImages;
    if (dropped.length && maxRef > 0) {
      setReferenceFiles((prev) => appendReferenceFiles(prev, dropped).slice(0, maxRef));
    }
  };

  return (
    <>
      <style jsx global>{`
        .ratio-card { width: 64px; height: 64px; border: 2px solid rgba(255,255,255,0.12); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all .2s; background: transparent; color: #7f8aa3; }
        .ratio-card.active { border-color: #ec4899; background: rgba(236,72,153,0.08); color: #ec4899; }
        .ratio-card .ratio-shape { border: 1.5px solid currentColor; border-radius: 2px; }
        .ratio-menu-icon { width: 42px; height: 34px; display: inline-flex; align-items: center; justify-content: center; color: #94a3b8; flex: 0 0 42px; }
        .ratio-menu-icon .ratio-shape { display: block; border: 1.5px solid currentColor; border-radius: 2px; }
        .ratio-menu-icon.active { color: #f9a8d4; }
        .ratio-auto .ratio-shape { width: 28px; height: 28px; border-style: dashed; }
        .ratio-1-1 .ratio-shape { width: 28px; height: 28px; }
        .ratio-1-4 .ratio-shape { width: 10px; height: 40px; }
        .ratio-1-8 .ratio-shape { width: 8px; height: 42px; }
        .ratio-2-3 .ratio-shape { width: 22px; height: 34px; }
        .ratio-3-2 .ratio-shape { width: 34px; height: 22px; }
        .ratio-3-4 .ratio-shape { width: 24px; height: 32px; }
        .ratio-4-1 .ratio-shape { width: 42px; height: 10px; }
        .ratio-4-3 .ratio-shape { width: 32px; height: 24px; }
        .ratio-4-5 .ratio-shape { width: 24px; height: 30px; }
        .ratio-5-4 .ratio-shape { width: 30px; height: 24px; }
        .ratio-8-1 .ratio-shape { width: 42px; height: 8px; }
        .ratio-9-16 .ratio-shape { width: 20px; height: 36px; }
        .ratio-16-9 .ratio-shape { width: 36px; height: 20px; }
        .ratio-21-9 .ratio-shape { width: 42px; height: 18px; }        .ratio-label { margin-top: 4px; font-size: 10px; color: inherit; }
        .num-selector { display:flex; gap:8px; }
        .num-btn { width:48px; height:40px; border-radius:8px; border:1.5px solid rgba(255,255,255,.12); background:transparent; color:#7f8aa3; font-size:15px; font-weight:600; }
        .num-btn.active { background:#ec4899; border-color:#ec4899; color:#fff; }
        .btn-generate { background: linear-gradient(135deg, #ec4899, #be185d); color: white; font-weight: 700; font-size: 15px; border: none; transition: transform 0.15s, box-shadow 0.15s; }
        .btn-generate:hover { transform: scale(1.02); box-shadow: 0 0 24px rgba(236, 72, 153, 0.3); }
      `}</style>

      <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-slate-950 pb-[60px] md:pb-0">
        <aside className="hidden w-20 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-black/30 py-4 md:flex">
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-600/80 to-violet-600/80"><Camera className="h-4 w-4 text-white" /></div>
          {TOOLS.map((tool) => <RailToolButton key={tool.id} active={activeTool === tool.id} icon={tool.icon} label={t(tool.label)} onClick={() => { setActiveTool(tool.id); setCompare(null); }} />)}
          <RailToolButton
            active={showReferenceStudioModal}
            icon={Wrench}
            label={lang === "ar" ? "الأدوات" : "Tools"}
            badge={IMAGE_TOOL_TABS.length}
            onClick={() => setShowReferenceStudioModal((v) => !v)}
          />
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.045) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          {/* overflow-clip keeps the waiting panel off-screen. Not overflow-hidden:
              that still allows programmatic scrolling, and one scrollIntoView inside
              the panel shifted this column 34px with no scrollbar to undo it. */}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-clip">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{error ? <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}{renderWorkspace()}</div>
            <PresetSlideOver
              open={showStyleLibrary}
              onClose={() => setShowStyleLibrary(false)}
              onApply={applyStylePreset}
              isAr={lang === "ar"}
            />
            {/* Reference Studio — slides over the gallery, same as the Style Library */}
            <ReferenceStudioModal
              isOpen={showReferenceStudioModal}
              onClose={() => {
                setShowReferenceStudioModal(false);
                // picks up characters created or deleted while the studio was open
                void refreshCharacters();
              }}
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
                  // Built-in 3D preset — prompt-only path via withPresetsAppended.
                  setSelectedCharacterPresetId(id);
                  setSelectedCharacterId("");
                } else {
                  // User character — activate the full Character Package flow.
                  setSelectedCharacterId(id);
                  setSelectedCharacterPresetId(null);
                  // Auto-switch to a reference-capable model so the character actually influences the output.
                  if (selectedModel.maxRefImages <= 0) {
                    const compatible = visibleImageModels.find((m) => m.maxRefImages > 0);
                    if (compatible) setSelectedModel(compatible);
                  }
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
              onSelectPalette={(pal) => {
                setSelectedPalette(pal);
              }}
              onAttachFile={(file) => {
                const targetUrl = file.url.startsWith("blob:") || file.url.startsWith("data:")
                  ? file.url
                  : `/api/proxy-image?url=${encodeURIComponent(file.url)}`;
                fetch(targetUrl)
                  .then((r) => r.blob())
                  .then((blob) => {
                    const f = new File([blob], `${file.name || "ref"}.jpg`, { type: "image/jpeg" });
                    setReferenceFiles((prev) => appendReferenceFiles(prev, [f]));
                  })
                  .catch((err) => console.error("Failed to attach reference file:", err));
              }}
              isAr={lang === "ar"}
              variant="panel"
            />
          </div>
          <div className="relative z-10 border-t border-white/10 p-3">
            <div
              className={cn("rounded-2xl border p-2 backdrop-blur-xl transition-colors", composerDragActive ? "border-pink-400/60 bg-pink-500/[0.06]" : "border-white/10 bg-black/55")}
              onDragOver={handleComposerDragOver}
              onDragEnter={handleComposerDragEnter}
              onDragLeave={handleComposerDragLeave}
              onDrop={handleComposerDrop}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                  {/* Film strip: fills the empty run beside the tiles so the row reads as a reel */}
                  <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-black via-zinc-900/90 to-black">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-[9px]"
                      style={{ backgroundImage: "repeating-linear-gradient(to right, transparent 0 8px, rgba(255,255,255,0.16) 8px 15px)" }}
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-[9px]"
                      style={{ backgroundImage: "repeating-linear-gradient(to right, transparent 0 8px, rgba(255,255,255,0.16) 8px 15px)" }}
                    />
                    <div className="relative flex items-center gap-2 overflow-x-auto px-2 py-[13px] custom-scrollbar">
                  {/* Reference Section matching Screenshots 2, 3, 4 */}
                  {activeTool === "create" ? (
                    referenceFiles.length === 0 ? (
                      /* Empty State Reference Tile (Screenshots 2 & 3) */
                      <div className="relative">
                        <input
                          type="file"
                          multiple={selectedModel.maxRefImages > 1}
                          accept="image/*"
                          disabled={selectedModel.maxRefImages <= 0}
                          className="hidden"
                          id="image-attach"
                          onChange={handleAttach}
                        />
                        <label
                          htmlFor={selectedModel.maxRefImages > 0 ? "image-attach" : undefined}
                          title={
                            selectedModel.maxRefImages > 0
                              ? `Attach reference images (max ${selectedModel.maxRefImages})`
                              : "This model does not accept reference images"
                          }
                          className={cn(
                            "group relative flex flex-col justify-between w-14 h-[68px] sm:w-16 sm:h-[74px] shrink-0 -rotate-3 hover:rotate-0 rounded-2xl border transition-transform duration-200 p-2 select-none shadow-lg",
                            selectedModel.maxRefImages > 0
                              ? "cursor-pointer border-white/10 bg-zinc-800/80 hover:border-white/25 hover:bg-zinc-700/80 shadow-md"
                              : "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-40"
                          )}
                        >
                          <Plus className={cn("h-4 w-4 transition", selectedModel.maxRefImages > 0 ? "text-zinc-400 group-hover:text-white" : "text-zinc-600")} />
                          <div className="flex flex-col text-left leading-tight">
                            <span className={cn("text-[11px] font-bold", selectedModel.maxRefImages > 0 ? "text-zinc-200" : "text-zinc-500")}>Image</span>
                            <span className={cn("text-[10px] font-medium", selectedModel.maxRefImages > 0 ? "text-zinc-400" : "text-zinc-600")}>
                              Refs(0/{selectedModel.maxRefImages})
                            </span>
                          </div>
                        </label>
                      </div>
                    ) : (
                      /* Populated State Thumbnails + Add Tile (Screenshot 4) */
                      <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full custom-scrollbar">
                        <input
                          type="file"
                          multiple={selectedModel.maxRefImages > 1}
                          accept="image/*"
                          disabled={referenceFiles.length >= selectedModel.maxRefImages}
                          className="hidden"
                          id="image-attach"
                          onChange={handleAttach}
                        />
                        {referencePreviews.map((item, idx) => (
                          <div
                            key={`${item.file.name}_${idx}`}
                            className="group relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl overflow-hidden ring-1 ring-white/15 bg-black/40 shadow-sm"
                          >
                            <img src={item.url} alt={item.tag} className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setReferenceFiles((prev) => prev.filter((_, i) => i !== idx))}
                              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/80 hover:bg-red-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow"
                              title="Remove reference"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <span className="absolute bottom-1 left-1 text-[9px] font-semibold text-white/90 bg-black/60 px-1 rounded backdrop-blur-xs">
                              {item.tag}
                            </span>
                          </div>
                        ))}

                        {referenceFiles.length < selectedModel.maxRefImages && (
                          <label
                            htmlFor="image-attach"
                            title={`Add more images (${referenceFiles.length}/${selectedModel.maxRefImages})`}
                            className="group relative flex flex-col justify-between w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-xl border border-white/10 bg-zinc-800/80 hover:border-white/25 hover:bg-zinc-700/80 cursor-pointer p-1.5 transition text-left select-none shadow-md"
                          >
                            <Plus className="h-3.5 w-3.5 text-zinc-400 group-hover:text-white transition" />
                            <div className="flex flex-col leading-tight">
                              <span className="text-[10px] font-bold text-zinc-200">Image</span>
                              <span className="text-[9px] font-medium text-zinc-400">({referenceFiles.length}/{selectedModel.maxRefImages})</span>
                            </div>
                          </label>
                        )}
                      </div>
                    )
                  ) : null}
                    </div>
                  </div>


                  {canUseAnnualUnlimitedCreate ? (
                    <button
                      type="button"
                      onClick={() => setAnnualUnlimitedEnabled((value) => !value)}
                      className={cn(
                        "flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold transition",
                        annualUnlimitedEnabled
                          ? "border-pink-400/30 bg-pink-500/10 text-pink-200"
                          : "border-white/10 bg-white/5 text-zinc-500 hover:text-zinc-300",
                      )}
                      title={annualUnlimitedEnabled ? "Unlimited generation enabled" : "Use credits instead of unlimited"}
                    >
                      <span>{t("Unlimited")}</span>
                      <span
                        className={cn(
                          "relative h-5 w-9 rounded-full transition",
                          annualUnlimitedEnabled ? "bg-gradient-to-r from-pink-500 to-violet-500" : "bg-zinc-700",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition",
                            annualUnlimitedEnabled ? "left-4" : "left-0.5",
                          )}
                        />
                      </span>
                    </button>
                  ) : null}
                </div>
              <div className="relative flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10 shadow-2xl backdrop-blur-xl">
                {composerDragActive ? (
                  <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border border-dashed border-pink-300/70 bg-slate-950/80 text-center shadow-[0_0_40px_rgba(236,72,153,0.18)] backdrop-blur-sm">
                    <div className="rounded-2xl border border-pink-300/30 bg-pink-500/10 px-5 py-4 text-sm font-semibold text-pink-100">
                      <UploadCloud className="mx-auto mb-2 h-6 w-6 text-pink-200" />
                      {t("Drop images here to add as reference")}
                      <div className="mt-1 text-xs font-medium text-pink-100/70">{t("Release to attach the image without changing the prompt")}</div>
                    </div>
                  </div>
                ) : null}
                {/* Floating Mention Autocomplete Popover (Screenshot 5) */}
                <AnimatePresence>
                  {mentionOpen && filteredMentionItems.length > 0 && (
                    <motion.div
                      ref={mentionPopupRef}
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.96 }}
                      transition={{ duration: 0.12 }}
                      className="absolute bottom-full left-3 mb-2 z-50 min-w-[170px] max-w-[240px] max-h-[260px] overflow-y-auto rounded-xl border border-white/15 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-xl custom-scrollbar"
                    >
                      <div className="flex flex-col gap-0.5">
                        {filteredMentionItems.map((item, idx) => {
                          const isSelected = idx === mentionIndex;
                          return (
                            <button
                              key={item.tag}
                              type="button"
                              onMouseEnter={() => setMentionIndex(idx)}
                              onClick={() => insertMention(item.tag)}
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition select-none",
                                isSelected
                                  ? "bg-white/15 text-white"
                                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <img
                                src={item.url}
                                alt={item.tag}
                                className="h-7 w-7 rounded-md object-cover ring-1 ring-white/20 shrink-0"
                              />
                              <span className="truncate">{item.tag}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="w-full flex-1 min-h-[64px]">
                  <textarea
                    ref={promptTextareaRef}
                    value={prompt}
                    onChange={handlePromptChange}
                    onKeyDown={handlePromptKeyDown}
                    onPaste={(e) => {
                      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                        const pastedFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                        if (pastedFiles.length > 0) {
                          e.preventDefault();
                          const maxRef = selectedModel.maxRefImages;
                          if (maxRef > 0) {
                            setReferenceFiles((prev) => appendReferenceFiles(prev, pastedFiles).slice(0, maxRef));
                          }
                        }
                      }
                    }}
                    placeholder={
                      activeTool === "create" && referenceFiles.length > 0
                        ? 'Use @ to reference images and explain their role (e.g. "use the composition from...")'
                        : composer.placeholder
                    }
                    disabled={!composer.promptEnabled}
                    rows={Math.min(8, Math.max(3, prompt.split("\n").length))}
                    className="w-full flex-1 resize-y bg-transparent p-1.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-60 overflow-y-auto leading-relaxed custom-scrollbar min-h-[64px] max-h-[220px]"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-white/5 pt-2 gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/30"><Sparkles className="h-4 w-4" /></div>

                    {/* Prompt Editor (Ctrl+E) Button with Tooltip */}
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => setShowPromptEditorModal(true)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200 hover:bg-white/10 transition-all"
                        aria-label={lang === "ar" ? "محرر ومساعد الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                        title={lang === "ar" ? "محرر ومساعد الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                      >
                        <SquarePen className="h-4 w-4" />
                      </button>
                      {/* Tooltip on Hover */}
                      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 whitespace-nowrap bg-neutral-900/95 text-slate-200 border border-white/15 text-[11px] font-medium px-2.5 py-1 rounded-md shadow-xl backdrop-blur-md">
                        {lang === "ar" ? "محرر الوصف (Ctrl+E)" : "Prompt editor (Ctrl+E)"}
                      </div>
                    </div>
                    {activeTool === "create" ? (
                      selectedCharacter ? (
                        <button
                          type="button"
                          onClick={() => setMobileSettingsOpen(true)}
                          className="relative flex items-center gap-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-2 py-1.5 text-xs text-fuchsia-100 hover:bg-fuchsia-500/15"
                          title="Selected character reference"
                        >
                          {selectedCharacter.coverUrl ? (
                            <img src={selectedCharacter.coverUrl} alt={selectedCharacter.name} className="h-8 w-8 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-zinc-500">
                              <ScanFace className="h-4 w-4" />
                            </div>
                          )}
                          <span className="max-w-[160px] truncate font-semibold">{selectedCharacter.name}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedCharacterId(""); }}
                            className="ml-1 rounded-full bg-black/40 p-0.5 text-white/80 hover:text-white"
                            title="Clear character"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </button>
                      ) : (
                        <a
                          href="/character"
                          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                          title="Create a character reference"
                        >
                          <ScanFace className="h-4 w-4 text-fuchsia-300" />
                          <span className="font-semibold">{t("Add character")}</span>
                        </a>
                      )
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    {prompt && (
                      <button onClick={() => setPrompt("")} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white"><X className="h-4 w-4" /></button>
                    )}
                    <button onClick={handleGenerate} disabled={!canGenerate} className={cn("btn-generate rounded-xl px-4 py-2 text-sm font-semibold shadow-md", !canGenerate && "cursor-not-allowed opacity-40")}>{generating ? t("Generate another") : composer.button}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="hidden w-[320px] shrink-0 flex-col border-l border-white/10 bg-black/25 lg:flex">
          <div className="border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-white"><SlidersHorizontal className="h-4 w-4 text-pink-400" /> {activeTool === "create" ? t("Image Settings") : activeTool === "enhance" ? t("Enhance Settings") : activeTool === "relight" ? t("Relight Settings") : activeTool === "inpaint" ? t("Inpaint Settings") : activeTool === "upscale" ? t("Upscale Settings") : t("Face Swap Settings")}</div></div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">{renderRightPanel()}</div>
        </aside>

        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/10 bg-black/90 p-1.5 md:hidden">
          {TOOLS.map((tool) => { const Icon = tool.icon; return <button key={tool.id} onClick={() => { setActiveTool(tool.id); setCompare(null); }} className={cn("rounded-xl px-2 py-1.5 text-[9px]", activeTool === tool.id ? "bg-white/10 text-pink-300" : "text-zinc-500")}><Icon className="mx-auto mb-0.5 h-4 w-4" />{t(tool.label)}</button>; })}
          <button onClick={() => setMobileSettingsOpen(true)} className="rounded-xl px-2 py-1.5 text-[9px] text-zinc-500"><Settings2 className="mx-auto mb-0.5 h-4 w-4" />{t("Settings")}</button>
        </div>

        <AnimatePresence>{mobileSettingsOpen ? <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => setMobileSettingsOpen(false)} /><motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="fixed bottom-0 left-0 right-0 z-50 h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-slate-950 p-4 md:hidden"><div className="mb-4 flex items-center justify-between"><p className="text-sm font-semibold text-white">{t("Settings")}</p><button onClick={() => setMobileSettingsOpen(false)} className="rounded-lg bg-white/5 p-2 text-zinc-400"><X className="h-4 w-4" /></button></div><div className="space-y-4">{renderRightPanel()}</div></motion.div></> : null}</AnimatePresence>


        {/* Prompt Editor (Ctrl+E) Modal */}
        <PromptEditorModal
          isOpen={showPromptEditorModal}
          onClose={() => setShowPromptEditorModal(false)}
          initialPrompt={prompt}
          onApply={(p) => setPrompt(p)}
          mediaType="image"
          lang={lang}
        />
      </div>

      <DeleteImageDialog
        open={deleteTargetIds.length > 0}
        count={deleteTargetIds.length}
        deleting={deletingImages}
        onCancel={cancelImageDelete}
        onConfirm={() => void confirmImageDelete()}
      />
      <AnimatePresence>{inspectorAsset ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/80 p-4" onClick={() => setInspectorAsset(null)}><motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }} className="mx-auto h-[82vh] max-w-5xl overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}><AssetInspector asset={inspectorAsset} onClose={() => setInspectorAsset(null)} /></motion.div></motion.div> : null}</AnimatePresence>
    </>
  );
}
