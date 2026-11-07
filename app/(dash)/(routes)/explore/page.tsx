"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SaadLoader } from "@/components/saad-loader";
import {
  ArrowUpRight,
  Eye,
  Heart,
  Play,
  ScrollText,
  Sparkles,
  Star,
  Zap,
  Wand2,
  Video,
  Layers,
  TrendingUp,
  Aperture,
  Paintbrush,
  Box,
  Monitor,
  LayoutGrid,
  ChevronDown,
  Info,
  Copy,
  Check,
  Search,
  Loader2,
  X,
  Camera,
  Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePromoMedia, promoUrl } from "@/hooks/use-promo-media";
import { usePromoContent, promoText } from "@/hooks/use-promo-content";
import { DEFAULT_EXPLORE_MODULES, type ExploreMedia, type ExploreModule } from "@/lib/explore-cms";
import { useLanguage } from "@/lib/use-language";
import Footer from "@/components/Footer";
import { getCameraMovements } from "@/lib/camera-movements-library";
import { SEEDANCE_PROMPTS } from "@/lib/seedance-prompts-library";

// ─── Types and Constants ───

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type ShowcaseItem = {
  id: string;
  title: string;
  slug: string;
  model: string;
  provider: string;
  video_url: string;
  thumbnail_url: string;
  prompt: string;
  tags: string[];
  featured: boolean;
  views: number;
  likes: number;
  created_at: string;
  aspect_ratio?: string;
};

type FeedResponse = {
  items: ShowcaseItem[];
  nextCursor?: string | null;
};

function compactNumber(value: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const GPT_IMAGE_2_MODEL_ID = "gpt-image-2-text-to-image";
const GPT_IMAGE_2_SHOTS = [
  "/GPT%20Image%202/SHOT%201.webp",
  "/GPT%20Image%202/SHOT%202.webp",
  "/GPT%20Image%202/SHOT%203.webp",
  "/GPT%20Image%202/SHOT%204.webp",
  "/GPT%20Image%202/SHOT%205.webp",
  "/GPT%20Image%202/SHOT%206.webp",
  "/GPT%20Image%202/SHOT%207.webp",
  "/GPT%20Image%202/SHOT%208.webp",
  "/GPT%20Image%202/SHOT%209.webp",
] as const;

const SEEDANCE_2_HERO = "/seedance%202/Hero.webp";
const SEEDANCE_2_SHOTS = [
  "/seedance%202/1%20(1).webp",
  "/seedance%202/1%20(2).webp",
  "/seedance%202/1%20(3).webp",
  "/seedance%202/1%20(4).webp",
  "/seedance%202/1%20(5).webp",
  "/seedance%202/1%20(6).webp",
  "/seedance%202/1%20(7).webp",
  "/seedance%202/1%20(8).webp",
] as const;

const TRANSITIONS_HERO = "/transitions/Hero.webp";
const TRANSITIONS_SHOTS = [
  "/transitions/1%20(1).webp",
  "/transitions/1%20(2).webp",
  "/transitions/1%20(3).webp",
  "/transitions/1%20(4).webp",
  "/transitions/1%20(5).webp",
  "/transitions/1%20(6).webp",
  "/transitions/1%20(7).webp",
  "/transitions/1%20(8).webp",
  "/transitions/1%20(9).webp",
] as const;

const INITIAL_STUDIO_CREATIONS: ShowcaseItem[] = [
  {
    id: "flower-shop-robot",
    title: "The Flower Shop Arrival",
    slug: "flower-shop-arrival",
    model: "SEEDANCE 2.0",
    provider: "Saad Studio",
    video_url: "https://saadstudio-storage.s3.eu-central-003.backblazeb2.com/reference-thumbnails/seedance/flying-carpet.webp",
    thumbnail_url: "https://saadstudio-storage.s3.eu-central-003.backblazeb2.com/reference-thumbnails/seedance/flying-carpet.webp",
    prompt: "A cute small white ceramic delivery robot with digital eyes arrives at a glowing flower shop.",
    tags: ["Seedance", "Cinematic"],
    featured: true,
    views: 262000,
    likes: 4800,
    created_at: "2026-08-03T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "vintage-engraved-portrait",
    title: "Vintage Engraved Portrait Illustration",
    slug: "vintage-engraved-portrait",
    model: "NANO BANANA",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&fit=crop&q=80",
    prompt: "Ultra realistic 4K vintage engraved style portrait illustration of an elegant woman.",
    tags: ["Portrait", "Engraving"],
    featured: true,
    views: 185000,
    likes: 3400,
    created_at: "2026-08-05T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "corporate-building-transform",
    title: "Corporate Building Transformation",
    slug: "corporate-building-transformation",
    model: "3D RENDER",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&fit=crop&q=80",
    prompt: "Clean minimal corporate 3D architectural visual render.",
    tags: ["Architecture", "3D"],
    featured: true,
    views: 210000,
    likes: 5200,
    created_at: "2026-08-05T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "sumerian-egyptian-civilization",
    title: "Sumerian & Egyptian Civilizations | Cinematic AI",
    slug: "sumerian-egyptian-civilizations",
    model: "GEMINI OMNI",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&fit=crop&q=80",
    prompt: "Monumental ancient guardian statue with glowing runes against cinematic sunlit clouds.",
    tags: ["History", "Cinematic"],
    featured: true,
    views: 620000,
    likes: 12800,
    created_at: "2026-08-05T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "character-pose-grid",
    title: "Character Pose Reference Grid",
    slug: "character-pose-grid",
    model: "SEEDREAM 5",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&fit=crop&q=80",
    prompt: "Consistent character multi-pose studio reference set.",
    tags: ["Character", "Studio"],
    featured: true,
    views: 195000,
    likes: 4100,
    created_at: "2026-08-03T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "sketch-to-video",
    title: "Sketch to Realistic Video",
    slug: "sketch-to-video",
    model: "GEMINI OMNI",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&fit=crop&q=80",
    prompt: "Hand-drawn line sketch transforming into live-action footage.",
    tags: ["Animation", "Realism"],
    featured: true,
    views: 312000,
    likes: 7600,
    created_at: "2026-08-01T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "vr-match-cut-polar",
    title: "VR Match Cut — Polar Bear to Home",
    slug: "vr-match-cut-polar",
    model: "CINEMATIC",
    provider: "Saad Studio",
    video_url: "https://saadstudio-storage.s3.eu-central-003.backblazeb2.com/reference-thumbnails/seedance/vr-match-cut.webp",
    thumbnail_url: "https://saadstudio-storage.s3.eu-central-003.backblazeb2.com/reference-thumbnails/seedance/vr-match-cut.webp",
    prompt: "Cinematic VR match cut transition from icy arctic landscape to cozy modern living room.",
    tags: ["VR", "Transition"],
    featured: true,
    views: 175000,
    likes: 9500,
    created_at: "2026-08-04T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
  {
    id: "cyberpunk-360-showcase",
    title: "Cyberpunk Character 360° Showcase",
    slug: "cyberpunk-360-showcase",
    model: "CHARACTER",
    provider: "Saad Studio",
    video_url: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&fit=crop&q=80",
    thumbnail_url: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&fit=crop&q=80",
    prompt: "Futuristic neon city hologram platform full 360 camera orbit around hero in high-tech suit.",
    tags: ["Cyberpunk", "360"],
    featured: true,
    views: 540000,
    likes: 11200,
    created_at: "2026-08-02T12:00:00.000Z",
    aspect_ratio: "16:9",
  },
];

const KLING_3_HERO = "/Kling%203.0/Hero.webp";
const KLING_3_SHOTS = [
  "/Kling%203.0/1%20(1).webp",
  "/Kling%203.0/1%20(2).webp",
  "/Kling%203.0/1%20(3).webp",
  "/Kling%203.0/1%20(4).webp",
  "/Kling%203.0/1%20(5).webp",
  "/Kling%203.0/1%20(6).webp",
  "/Kling%203.0/1%20(7).webp",
  "/Kling%203.0/1%20(8).webp",
] as const;

type IraqImageItem = {
  id: string;
  title: string;
  imageUrl: string;
  model: string;
  creator: string;
  prompt: string;
  views: number;
  likes: number;
  tags: string[];
};

const IRAQ_IMAGES: IraqImageItem[] = [
  {
    id: "iraq-1",
    title: "Futuristic Baghdad Skyline",
    imageUrl: "/explore/iraq/skyline.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A hyper-realistic futuristic Baghdad skyline at night along the Tigris River, showcasing modern organic architecture inspired by Zaha Hadid, glowing skyscrapers with neon blue and amber lights, futuristic suspension bridges.",
    views: 1240,
    likes: 852,
    tags: ["Architecture", "Sci-Fi"]
  },
  {
    id: "iraq-2",
    title: "Mesopotamian Future Museum",
    imageUrl: "/explore/iraq/museum.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A hyper-modern futuristic museum in Baghdad blending ancient Mesopotamian Babylonian brickwork and ziggurat patterns with towering glass facades, holographic projections, hanging gardens.",
    views: 942,
    likes: 671,
    tags: ["Architecture", "History"]
  },
  {
    id: "iraq-3",
    title: "Baghdad Metro Station",
    imageUrl: "/explore/iraq/metro.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "Interior of a sleek, futuristic metro station in Baghdad, modern design with arches inspired by traditional Islamic architecture, gold and white colors, glass ceilings showing skyscrapers.",
    views: 742,
    likes: 580,
    tags: ["Photography", "Architecture"]
  },
  {
    id: "iraq-4",
    title: "Futuristic Babylon City",
    imageUrl: "/explore/iraq/babylon.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A futuristic metropolis built around the ruins of Babylon, giant holographic Ishtar Gate shining blue and purple at night, neon ziggurats, elevated transit hyperloops, cyberpunk style.",
    views: 1850,
    likes: 1240,
    tags: ["Cyberpunk", "Sci-Fi"]
  },
  {
    id: "iraq-5",
    title: "Zaha Hadid Baghdad Cultural Center",
    imageUrl: "/explore/iraq/cultural_center.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A spectacular modern cultural center in Baghdad, designed in the style of Zaha Hadid, featuring sweeping white concrete curves, large glass panels, reflecting pools, landscaped gardens.",
    views: 1105,
    likes: 792,
    tags: ["Architecture", "Photography"]
  },
  {
    id: "iraq-6",
    title: "Modern Tigris Riverwalk",
    imageUrl: "/explore/iraq/riverwalk.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A modern riverwalk park along the Tigris River in Baghdad, high-rise skyscrapers in the background, sleek streetlights, palm trees reflecting the sunset, beautiful reflection on the water.",
    views: 890,
    likes: 540,
    tags: ["Photography", "Nature"]
  },
  {
    id: "iraq-7",
    title: "Mesopotamian Eco-City Marshes",
    imageUrl: "/explore/iraq/eco_city.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A futuristic Mesopotamian eco-city built in the marshes of southern Iraq, with solar-powered floating houses of high-tech design, green vegetation, clean canals with electric boats.",
    views: 1024,
    likes: 712,
    tags: ["Sci-Fi", "Nature"]
  },
  {
    id: "iraq-8",
    title: "Iraq Space Center & Observatory",
    imageUrl: "/explore/iraq/space_center.png",
    model: "Flux Pro",
    creator: "Saad Studio AI",
    prompt: "A futuristic space center and observatory in the desert of Iraq, modern high-tech white domes and parabolic telescope dishes, space launch pad in the background under a night sky full of stars.",
    views: 1530,
    likes: 994,
    tags: ["Sci-Fi", "Nature"]
  }
];

const BLUEPRINTS = [
  {
    id: "bp-1",
    title: "3D Reference View Creator",
    imageUrl: "/explore/iraq/cultural_center.png",
    tag: "3D Model",
    badge: "New",
    href: "/image?tool=create&model=flux-2/pro-text-to-image&prompt=3d%20reference%20view%20of%20a%20modern%20iraqi%20monument%2C%20white%20curves%2C%20studio%20background&aspect=1:1"
  },
  {
    id: "bp-2",
    title: "Motion Product Showcase",
    imageUrl: "/explore/iraq/metro.png",
    tag: "Motion",
    badge: "",
    href: "/video?prompt=motion%20product%20showcase%20of%20a%20futuristic%20iraqi%20high-tech%20metro%20train%2C%20sleek%20cinematic%20movement"
  },
  {
    id: "bp-3",
    title: "Cinematic Scenario Product Film",
    imageUrl: "/explore/iraq/skyline.png",
    tag: "Cinematic",
    badge: "Hot",
    href: "/video?prompt=cinematic%20scenario%20product%20film%20of%20baghdad%20modern%20skyscrapers%2C%20golden%20hour%20reflections%2C%20sweeping%20camera"
  },
  {
    id: "bp-4",
    title: "Mesopotamian Cyberpunk Style",
    imageUrl: "/explore/iraq/babylon.png",
    tag: "Style Preset",
    badge: "New",
    href: "/image?tool=create&preset=cyberpunk&prompt=cyberpunk%20reborn%20babylon%2C%20neon%20gates%20and%20ziggurats%2C%20rainy%20night"
  },
  {
    id: "bp-5",
    title: "Tilt-Shift Miniature Effect",
    imageUrl: "/explore/iraq/riverwalk.png",
    tag: "Photography",
    badge: "",
    href: "/image?tool=create&preset=photography&prompt=tilt-shift%20miniature%20effect%20of%20the%20tigris%20riverwalk%20park%20in%20baghdad%2C%20tiny%20people%20and%20cars%2C%20toy-like%20depth%20of%20field"
  },
  {
    id: "bp-6",
    title: "Eco-City Architecture Render",
    imageUrl: "/explore/iraq/eco_city.png",
    tag: "Architecture",
    badge: "New",
    href: "/image?tool=create&preset=cinematic&aspect=16:9&prompt=architectural%20render%20of%20a%20floating%20eco-city%20in%20the%20iraqi%20marshes%2C%20solar%20powered%20design"
  }
];

// ─── Sub-Components for Official Ads/Banners ───

function GptImage2ModelAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/gpt-image-2";
  const href = promoText(content, slotId, "ctaHref", `/image?tool=create&model=${encodeURIComponent(GPT_IMAGE_2_MODEL_ID)}`);
  const galleryShots = GPT_IMAGE_2_SHOTS.slice(1).map((shot, index) => promoUrl(promo, `${slotId}/gallery-${index + 1}`, shot));
  const heroShot = promoUrl(promo, `${slotId}/hero`, GPT_IMAGE_2_SHOTS[0]);
  const title = promoText(content, slotId, "title", "Meet GPT Image 2");
  const subtitle = promoText(content, slotId, "subtitle", "4K images with near-perfect text rendering");
  const cta = promoText(content, slotId, "cta", "Try Model");
  const badge = promoText(content, slotId, "badge", "NEW MODEL");

  return (
    <section className="w-full px-4 md:px-8 py-6 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-3xl border border-white/10 bg-[#080b11] shadow-2xl transition-all duration-300 hover:border-cyan-400/30"
      >
        <div className="relative grid min-h-[480px] gap-0 lg:grid-cols-[22rem_1fr] xl:grid-cols-[26rem_1fr]">
          {/* Left Hero Card */}
          <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden border-b border-white/10 p-8 text-center lg:border-b-0 lg:border-r border-white/10">
            {/* Background Image */}
            <img
              src={heroShot}
              alt="GPT Image 2 hero"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-90 transition duration-700 group-hover:scale-105"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/70" />

            {/* Hero Text Content */}
            <div className="relative z-10 flex flex-col items-center max-w-xs">
              <span className="rounded-full bg-white/10 border border-white/15 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-zinc-300 backdrop-blur-md">
                {t(badge)}
              </span>
              <h2 className="mt-4 text-2xl sm:text-3xl font-black leading-tight text-white drop-shadow-md">
                {t(title)}
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed drop-shadow">
                {t(subtitle)}
              </p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-black text-black shadow-lg transition duration-200 group-hover:scale-105">
                <Play className="h-3.5 w-3.5 fill-black" />
                {t(cta)}
              </span>
            </div>
          </div>

          {/* Right Gallery Bento Grid */}
          <div className="relative min-h-[440px] overflow-hidden p-4 bg-black/40">
            <div className="grid h-full min-h-[400px] grid-cols-2 sm:grid-cols-4 gap-3">
              {galleryShots.slice(0, 8).map((shot, index) => {
                const isWide = index === 0 || index === 7;
                return (
                  <div
                    key={shot}
                    className={cn(
                      "relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] shadow-md",
                      isWide ? "col-span-2 aspect-video" : "col-span-1 aspect-square sm:aspect-auto"
                    )}
                  >
                    <img
                      src={shot}
                      alt={`GPT Image 2 showcase ${index + 1}`}
                      className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
                      loading={index < 3 ? "eager" : "lazy"}
                    />
                    <div className="absolute inset-0 bg-black/10 transition group-hover:bg-transparent" />
                  </div>
                );
              })}
            </div>

            {/* Bottom floating CTA button */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/95 backdrop-blur-md px-5 py-2.5 text-xs font-extrabold text-black shadow-2xl transition duration-200 group-hover:scale-105 group-hover:bg-white">
                <span>{t(cta)}</span>
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function CanvasModelAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/canvas";
  const href = promoText(content, slotId, "ctaHref", "https://www.saadstudio.app/canvas");
  const image = promoUrl(promo, `${slotId}/hero`, "/canvas.webp");
  const title = promoText(content, slotId, "title", "Canvas");
  const cta = promoText(content, slotId, "cta", "Open");

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#08090d] shadow-2xl shadow-black/50"
      >
        <div className="relative min-h-[430px]">
          <img
            src={image}
            alt="Canvas model hero"
            className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/72 via-black/25 to-black/5" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/10 to-black/10" />
          <div className="relative flex min-h-[430px] items-end px-7 py-10 md:px-12 lg:px-16">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-lg border border-white/15 bg-black/45 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-black/40 backdrop-blur">
                {title}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                {t(cta)}
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function Seedance2ModelAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/seedance-2";
  const href = promoText(content, slotId, "ctaHref", "/video?tool=create-video&model=bytedance-seedance-v2-t2v");
  const hero = promoUrl(promo, `${slotId}/hero`, SEEDANCE_2_HERO);
  const galleryShots = SEEDANCE_2_SHOTS.map((shot, index) => promoUrl(promo, `${slotId}/gallery-${index + 1}`, shot));
  const title = promoText(content, slotId, "title", "Seedance 2");
  const subtitle = promoText(content, slotId, "subtitle", "Fast cinematic video generation with smooth motion and flexible references.");
  const cta = promoText(content, slotId, "cta", "Try Model");
  const badge = promoText(content, slotId, "badge", "VIDEO MODEL");
  const galleryLayout = [
    "col-span-6 row-span-4",
    "col-span-6 row-span-2",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-6 row-span-3",
    "col-span-6 row-span-3",
  ];

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#07090c] shadow-2xl shadow-black/50"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,rgba(45,212,191,0.18),transparent_30%),linear-gradient(90deg,#040506_0%,#07100f_55%,#050606_100%)]" />
        <div className="relative grid min-h-[520px] gap-0 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_30rem]">
          <div className="relative min-h-[500px] overflow-hidden border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
            <div className="grid h-full min-h-[500px] grid-cols-12 grid-rows-8 gap-3">
              {galleryShots.map((shot, index) => (
                <div
                  key={shot}
                  className={cn(
                    "relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] shadow-xl shadow-black/30",
                    galleryLayout[index],
                  )}
                >
                  <img
                    src={shot}
                    alt={`Seedance 2 showcase ${index + 1}`}
                    className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]"
                    loading={index < 3 ? "eager" : "lazy"}
                  />
                  <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/5" />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/45 to-transparent" />
            <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                View all of Seedance 2
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>

          <div className="relative flex min-h-[430px] flex-col items-center justify-start overflow-hidden px-6 py-9 text-center">
            <img
              src={hero}
              alt="Seedance 2 hero"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-95 transition duration-700 group-hover:scale-[1.03]"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/72" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-transparent to-black/20" />
            <div className="relative z-10">
              <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/55">{t(badge)}</div>
              <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-teal-200/50 to-transparent" />
              <h2 className="mt-5 text-3xl font-black leading-tight text-white md:text-4xl">{t(title)}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">{t(subtitle)}</p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-slate-950 transition group-hover:scale-[1.03]">
                <Play className="h-4 w-4 fill-current" />
                {t(cta)}
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/25 to-transparent" />
          </div>
        </div>
      </Link>
    </section>
  );
}

function NextSceneEngineAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/next-scene-engine";
  const href = promoText(content, slotId, "ctaHref", "/shots");
  const image = promoUrl(promo, `${slotId}/hero`, "/NEXT%20SCENE%20ENGINE.webp");
  const title = promoText(content, slotId, "title", "NEXT SCENE ENGINE");
  const cta = promoText(content, slotId, "cta", "Open");

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#08090d] shadow-2xl shadow-black/50"
      >
        <div className="relative min-h-[430px]">
          <img
            src={image}
            alt="Next Scene Engine hero"
            className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/78 via-black/34 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/10" />
          <div className="relative flex min-h-[430px] items-end px-7 py-10 md:px-12 lg:px-16">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-lg border border-white/15 bg-black/45 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-black/40 backdrop-blur">
                {title}
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                {t(cta)}
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function TransitionsModelAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/transitions";
  const href = promoText(content, slotId, "ctaHref", "https://www.saadstudio.app/apps/tool/transitions");
  const hero = promoUrl(promo, `${slotId}/hero`, TRANSITIONS_HERO);
  const galleryShots = TRANSITIONS_SHOTS.map((shot, index) => promoUrl(promo, `${slotId}/gallery-${index + 1}`, shot));
  const title = promoText(content, slotId, "title", "Transitions");
  const subtitle = promoText(content, slotId, "subtitle", "Create stylized scene changes and motion bridges between your clips.");
  const cta = promoText(content, slotId, "cta", "Open Tool");
  const badge = promoText(content, slotId, "badge", "VIDEO TOOL");
  const galleryLayout = [
    "col-span-6 row-span-4",
    "col-span-6 row-span-2",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-6 row-span-3",
  ];

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#07090c] shadow-2xl shadow-black/50"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_48%,rgba(59,130,246,0.16),transparent_30%),linear-gradient(90deg,#050608_0%,#070b12_45%,#050506_100%)]" />
        <div className="relative grid min-h-[520px] gap-0 lg:grid-cols-[24rem_1fr] xl:grid-cols-[30rem_1fr]">
          <div className="relative flex min-h-[430px] flex-col items-center justify-start overflow-hidden border-b border-white/10 px-6 py-9 text-center lg:border-b-0 lg:border-r">
            <img
              src={hero}
              alt="Transitions hero"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-95 transition duration-700 group-hover:scale-[1.03]"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/76 via-black/20 to-black/78" />
            <div className="relative z-10">
              <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/55">{t(badge)}</div>
              <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-blue-200/50 to-transparent" />
              <h2 className="mt-5 text-3xl font-black leading-tight text-white md:text-4xl">{t(title)}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">{t(subtitle)}</p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-slate-950 transition group-hover:scale-[1.03]">
                <Play className="h-4 w-4 fill-current" />
                {t(cta)}
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/25 to-transparent" />
          </div>

          <div className="relative min-h-[520px] overflow-hidden p-4">
            <div className="grid h-full min-h-[500px] grid-cols-12 grid-rows-8 gap-3">
              {galleryShots.map((shot, index) => (
                <div
                  key={shot}
                  className={cn(
                    "relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] shadow-xl shadow-black/30",
                    galleryLayout[index],
                  )}
                >
                  <img
                    src={shot}
                    alt={`Transitions showcase ${index + 1}`}
                    className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]"
                    loading={index < 3 ? "eager" : "lazy"}
                  />
                  <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/5" />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/45 to-transparent" />
            <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                View transitions
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function NanoBananaAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/nano-banana";
  const href = promoText(content, slotId, "ctaHref", "/image?tool=create&model=nano-banana-pro");
  const image = promoUrl(promo, `${slotId}/hero`, "/nano.webp");
  const cta = promoText(content, slotId, "cta", "Open");

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#08090d] shadow-2xl shadow-black/50"
      >
        <div className="relative min-h-[430px]">
          <img
            src={image}
            alt="Nano Banana hero"
            className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
            loading="eager"
          />
          .
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/34 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/10" />
          <div className="relative flex min-h-[430px] items-end px-7 py-10 md:px-12 lg:px-16">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-lg border border-white/15 bg-black/45 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-black/40 backdrop-blur">
                نانوبنانا
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                {t(cta)}
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function Kling3ModelAd() {
  const { t } = useExploreTranslation();
  const promo = usePromoMedia();
  const content = usePromoContent();
  const slotId = "explore/ad/kling-3";
  const href = promoText(content, slotId, "ctaHref", "/video?tool=create-video&model=kling-v3.0-pro-t2v");
  const hero = promoUrl(promo, `${slotId}/hero`, KLING_3_HERO);
  const galleryShots = KLING_3_SHOTS.map((shot, index) => promoUrl(promo, `${slotId}/gallery-${index + 1}`, shot));
  const title = promoText(content, slotId, "title", "Kling 3.0");
  const subtitle = promoText(content, slotId, "subtitle", "Cinematic motion, strong scene continuity, and polished video generation.");
  const cta = promoText(content, slotId, "cta", "Try Model");
  const badge = promoText(content, slotId, "badge", "VIDEO MODEL");
  const galleryLayout = [
    "col-span-6 row-span-4",
    "col-span-6 row-span-2",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-3 row-span-3",
    "col-span-6 row-span-3",
    "col-span-6 row-span-3",
  ];

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={href}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#07090c] shadow-2xl shadow-black/50"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,rgba(124,58,237,0.2),transparent_30%),linear-gradient(90deg,#050506_0%,#0c0813_55%,#050506_100%)]" />
        <div className="relative grid min-h-[520px] gap-0 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_30rem]">
          <div className="relative min-h-[500px] overflow-hidden border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
            <div className="grid h-full min-h-[500px] grid-cols-12 grid-rows-8 gap-3">
              {galleryShots.map((shot, index) => (
                <div
                  key={shot}
                  className={cn(
                    "relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] shadow-xl shadow-black/30",
                    galleryLayout[index],
                  )}
                >
                  <img
                    src={shot}
                    alt={`Kling 3.0 showcase ${index + 1}`}
                    className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]"
                    loading={index < 3 ? "eager" : "lazy"}
                  />
                  <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/5" />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/45 to-transparent" />
            <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                View all of Kling 3.0
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
          </div>

          <div className="relative flex min-h-[430px] flex-col items-center justify-start overflow-hidden px-6 py-9 text-center">
            <img
              src={hero}
              alt="Kling 3.0 hero"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-95 transition duration-700 group-hover:scale-[1.03]"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/74 via-black/18 to-black/76" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-transparent to-black/35" />
            <div className="relative z-10">
              <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/55">{t(badge)}</div>
              <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-violet-200/50 to-transparent" />
              <h2 className="mt-5 text-3xl font-black leading-tight text-white md:text-4xl">{t(title)}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">{t(subtitle)}</p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-slate-950 transition group-hover:scale-[1.03]">
                <Play className="h-4 w-4 fill-current" />
                {t(cta)}
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/25 to-transparent" />
          </div>
        </div>
      </Link>
    </section>
  );
}

function CameraMovementsAd() {
  const { t } = useExploreTranslation();
  const movements = useMemo(() => getCameraMovements().slice(0, 8), []);

  return (
    <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 rounded-full px-2.5 py-0.5 font-bold text-amber-300 uppercase tracking-wider">
              {t("CAMERA LIBRARY")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">62 {t("Presets")}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t("62 Cinematic Camera Movements")}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mt-1">
            {t("Dolly, zoom, orbit, drone, tracking, and crane camera moves with instant ready-to-copy prompts for any AI video model.")}
          </p>
        </div>

        <Link
          href="/camera-movements"
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black px-5 py-2.5 text-xs font-black shadow-lg transition duration-200 hover:scale-105 self-start sm:self-center shrink-0"
        >
          <Camera className="w-4 h-4" />
          <span>{t("Explore Camera Moves")}</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Large 4-Column Grid of Cinematic Camera Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {movements.slice(0, 8).map((m) => (
          <Link
            key={m.id}
            href="/camera-movements"
            className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-amber-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <img
                src={m.imageUrl}
                alt={m.nameEn}
                className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />
              <div className="absolute top-2.5 left-2.5">
                <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-amber-300 px-2 py-0.5 rounded-md uppercase">
                  {m.tag}
                </span>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <Camera className="w-2.5 h-2.5 text-amber-400" />
                </div>
                <span className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition-colors">
                  {m.nameEn}
                </span>
              </div>
              <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                Public
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <Link
          href="/camera-movements"
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-6 py-3 text-xs font-black text-white shadow-xl transition hover:scale-105 backdrop-blur-md"
        >
          <span>{t("Explore all 62 camera moves")}</span>
          <ArrowUpRight className="w-4 h-4 text-amber-400" />
        </Link>
      </div>
    </section>
  );
}

function PromptsLibraryAd() {
  const { t } = useExploreTranslation();
  const prompts = useMemo(() => SEEDANCE_PROMPTS.slice(0, 8), []);

  return (
    <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] bg-fuchsia-500/15 border border-fuchsia-500/30 rounded-full px-2.5 py-0.5 font-bold text-fuchsia-300 uppercase tracking-wider">
              {t("PROMPTS REPOSITORY")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">16 {t("Curated Prompts")}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t("Cinematic Video Prompts Library")}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mt-1">
            {t("Curated, battle-tested AI video prompts for cinematic stories, high-end ads, animations, and FPV shots.")}
          </p>
        </div>

        <Link
          href="/prompt"
          className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 text-black px-5 py-2.5 text-xs font-black shadow-lg transition duration-200 hover:scale-105 self-start sm:self-center shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>{t("Browse Prompts")}</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Large 4-Column Grid of Cinematic Prompt Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {prompts.map((p) => (
          <Link
            key={p.id}
            href="/prompt"
            className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-fuchsia-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <img
                src={p.thumbnailUrl}
                alt={p.title}
                className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />
              <div className="absolute top-2.5 left-2.5">
                <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-fuchsia-300 px-2 py-0.5 rounded-md uppercase">
                  {p.category}
                </span>
              </div>
              <div className="absolute bottom-2 right-2.5">
                <span className="text-[10px] font-bold text-zinc-300 bg-black/60 px-1.5 py-0.5 rounded">
                  {p.views} views
                </span>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center shrink-0">
                  <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" />
                </div>
                <span className="text-xs font-bold text-white truncate group-hover:text-fuchsia-300 transition-colors">
                  {p.title}
                </span>
              </div>
              <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                Public
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <Link
          href="/prompt"
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-6 py-3 text-xs font-black text-white shadow-xl transition hover:scale-105 backdrop-blur-md"
        >
          <span>{t("Explore all cinematic prompts")}</span>
          <ArrowUpRight className="w-4 h-4 text-fuchsia-400" />
        </Link>
      </div>
    </section>
  );
}

function ImageEditToolsAd() {
  const { t } = useExploreTranslation();

  const editTools = [
    {
      title: "AI 4K Upscaler",
      titleAr: "رفع الدقة إلى 4K",
      desc: "Restore details & enhance sharpness",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&fit=crop&q=80",
      tag: "4K UHD",
      tool: "upscale",
    },
    {
      title: "Smart Inpaint & Object Eraser",
      titleAr: "إزالة وتعديل العناصر",
      desc: "Remove unwanted objects or replace items",
      image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&fit=crop&q=80",
      tag: "INPAINT",
      tool: "inpaint",
    },
    {
      title: "Face Swap Pro",
      titleAr: "استبدال الوجوه الاحترافي",
      desc: "Seamless face blending with skin matching",
      image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&fit=crop&q=80",
      tag: "PRO",
      tool: "faceswap",
    },
    {
      title: "Dynamic AI Relighting",
      titleAr: "إعادة توزيع الإضاءة",
      desc: "Studio lighting control and color grading",
      image: "https://images.unsplash.com/photo-1557683316-973673baf926?w=600&fit=crop&q=80",
      tag: "LIGHTING",
      tool: "relight",
    },
  ];

  return (
    <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] bg-cyan-500/15 border border-cyan-500/30 rounded-full px-2.5 py-0.5 font-bold text-cyan-300 uppercase tracking-wider">
              {t("AI RETOUCH SUITE")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">{t("Professional Editing")}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t("AI Image Studio & Retouch Tools")}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mt-1">
            {t("4K AI Upscaler, Smart Object Inpaint & Eraser, Face Swap Pro, and dynamic AI Relighting in one place.")}
          </p>
        </div>

        <Link
          href="/edit"
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black px-5 py-2.5 text-xs font-black shadow-lg transition duration-200 hover:scale-105 self-start sm:self-center shrink-0"
        >
          <Wand2 className="w-4 h-4" />
          <span>{t("Launch Image Editor")}</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* 4-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {editTools.map((tool) => (
          <Link
            key={tool.tool}
            href={`/edit?tool=${tool.tool}`}
            className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-cyan-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <img
                src={tool.image}
                alt={tool.title}
                className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />
              <div className="absolute top-2.5 left-2.5">
                <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-cyan-300 px-2 py-0.5 rounded-md uppercase">
                  {tool.tag}
                </span>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                  <Wand2 className="w-2.5 h-2.5 text-cyan-400" />
                </div>
                <span className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                  {tool.title}
                </span>
              </div>
              <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                Tool
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StoryboardStudioAd() {
  const { t } = useExploreTranslation();

  const storyboardCards = [
    {
      title: "Storyboard Production",
      titleAr: "إنتاج القصة المصورة",
      desc: "Multi-panel cinematic sequences",
      image: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&fit=crop&q=80",
      tag: "PRODUCTION",
    },
    {
      title: "Short Drama Studio",
      titleAr: "مسلسلات الدراما القصيرة",
      desc: "Episode storytelling & continuity",
      image: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=600&fit=crop&q=80",
      tag: "SHORT DRAMA",
    },
    {
      title: "Comic & Manga Drama",
      titleAr: "الكوميكس والقصص المصورة",
      desc: "Stylized comic panels with bubbles",
      image: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&fit=crop&q=80",
      tag: "COMIC DRAMA",
    },
    {
      title: "Multi-Character Consistency",
      titleAr: "ثبات وتوحيد الشخصيات",
      desc: "Lock identity across all story panels",
      image: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&fit=crop&q=80",
      tag: "CONSISTENCY",
    },
  ];

  return (
    <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] bg-rose-500/15 border border-rose-500/30 rounded-full px-2.5 py-0.5 font-bold text-rose-300 uppercase tracking-wider">
              {t("STORYBOARD & DRAMA")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">{t("Multi-Panel Production")}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t("Storyboard & Short Drama Studio")}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mt-1">
            {t("Create multi-panel storyboards, cinematic short dramas, and comics with character consistency and up to 4K quality.")}
          </p>
        </div>

        <Link
          href="/storyboard"
          className="inline-flex items-center gap-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-black px-5 py-2.5 text-xs font-black shadow-lg transition duration-200 hover:scale-105 self-start sm:self-center shrink-0"
        >
          <Film className="w-4 h-4" />
          <span>{t("Open Storyboard Studio")}</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* 4-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {storyboardCards.map((card, idx) => (
          <Link
            key={idx}
            href="/storyboard"
            className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-rose-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <img
                src={card.image}
                alt={card.title}
                className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />
              <div className="absolute top-2.5 left-2.5">
                <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-rose-300 px-2 py-0.5 rounded-md uppercase">
                  {card.tag}
                </span>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Film className="w-2.5 h-2.5 text-rose-400" />
                </div>
                <span className="text-xs font-bold text-white truncate group-hover:text-rose-300 transition-colors">
                  {card.title}
                </span>
              </div>
              <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                Drama
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StudioCreationsAd() {
  const { t } = useExploreTranslation();

  const previewCards = [
    {
      title: "The Flower Shop Arrival",
      desc: "Seedance 2.0 Mini cinematic video",
      image: "https://saadstudio-storage.s3.eu-central-003.backblazeb2.com/reference-thumbnails/seedance/flying-carpet.webp",
      tag: "SEEDANCE 2.0",
      model: "Seedance 2.0 Mini",
    },
    {
      title: "Vintage Engraved Portrait",
      desc: "Nano Banana Pro vintage line illustration",
      image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&fit=crop&q=80",
      tag: "NANO BANANA",
      model: "Nano Banana Pro",
    },
    {
      title: "Corporate Building Transformation",
      desc: "Nano Banana Pro 3D architectural render",
      image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&fit=crop&q=80",
      tag: "3D RENDER",
      model: "Nano Banana Pro",
    },
    {
      title: "Sumerian & Egyptian Civilizations",
      desc: "Google Gemini Omni Cinematic Masterpiece",
      image: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&fit=crop&q=80",
      tag: "GEMINI OMNI",
      model: "Google Gemini Omni",
    },
  ];

  return (
    <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] bg-cyan-500/15 border border-cyan-500/30 rounded-full px-2.5 py-0.5 font-bold text-cyan-300 uppercase tracking-wider">
              {t("STUDIO SHOWCASE")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">{t("Live Community Feed")}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {t("Studio Creations & Live Showcase")}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl mt-1">
            {t("Browse real creations generated across Saad Studio models, copy prompts, and discover state-of-the-art AI video and image models.")}
          </p>
        </div>

        <Link
          href="/creations"
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black px-5 py-2.5 text-xs font-black shadow-lg transition duration-200 hover:scale-105 self-start sm:self-center shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>{t("View All Creations")}</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* 4-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {previewCards.map((card, idx) => (
          <Link
            key={idx}
            href="/creations"
            className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-cyan-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <img
                src={card.image}
                alt={card.title}
                className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />
              <div className="absolute top-2.5 left-2.5">
                <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-cyan-300 px-2 py-0.5 rounded-md uppercase">
                  {card.tag}
                </span>
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                  <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                </div>
                <span className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                  {card.title}
                </span>
              </div>
              <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                Live
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ExploreModuleMedia({ media, className, eager = false }: { media: ExploreMedia; className: string; eager?: boolean }) {
  if (media.type === "video") {
    return (
      <video
        src={media.url}
        className={className}
        muted
        loop
        playsInline
        autoPlay
        preload={eager ? "auto" : "metadata"}
      />
    );
  }

  return (
    <img
      src={media.url}
      alt={media.alt || ""}
      className={className}
      loading={eager ? "eager" : "lazy"}
    />
  );
}

const DYNAMIC_GALLERY_LAYOUTS = [
  "col-span-6 row-span-4",
  "col-span-6 row-span-2",
  "col-span-3 row-span-3",
  "col-span-3 row-span-3",
  "col-span-3 row-span-3",
  "col-span-3 row-span-3",
  "col-span-6 row-span-3",
  "col-span-6 row-span-3",
  "col-span-6 row-span-3",
];

function DynamicGallery({ module, reverse = false }: { module: ExploreModule; reverse?: boolean }) {
  const { t } = useExploreTranslation();
  const gallery = module.gallery.length ? module.gallery : [module.hero];
  const heroPanel = (
    <div className="relative flex min-h-[430px] flex-col items-center justify-start overflow-hidden px-6 py-9 text-center">
      <ExploreModuleMedia
        media={module.hero}
        className="absolute inset-0 h-full w-full object-cover object-center opacity-95 transition duration-700 group-hover:scale-[1.03]"
        eager
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/74 via-black/18 to-black/76" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-transparent to-black/35" />
      <div className="relative z-10">
        {module.badge ? <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/55">{t(module.badge)}</div> : null}
        <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        <h2 className="mt-5 text-3xl font-black leading-tight text-white md:text-4xl">{t(module.title)}</h2>
        {module.subtitle ? <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">{t(module.subtitle)}</p> : null}
        {module.cta ? (
          <span className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-slate-950 transition group-hover:scale-[1.03]">
            <Play className="h-4 w-4 fill-current" />
            {t(module.cta)}
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/25 to-transparent" />
    </div>
  );

  const galleryPanel = (
    <div className="relative min-h-[520px] overflow-hidden border-white/10 p-4 lg:border-r">
      <div className="grid h-full min-h-[500px] grid-cols-12 grid-rows-8 gap-3">
        {gallery.slice(0, 9).map((media, index) => (
          <div
            key={media.id}
            className={cn(
              "relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] shadow-xl shadow-black/30",
              DYNAMIC_GALLERY_LAYOUTS[index] ?? "col-span-3 row-span-3",
            )}
          >
            <ExploreModuleMedia
              media={media}
              className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]"
              eager={index < 3}
            />
            <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/5" />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black via-black/45 to-transparent" />
      {module.cta ? (
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
            {t(module.cta)}
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={module.href || "#"}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#07090c] shadow-2xl shadow-black/50"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,rgba(124,58,237,0.16),transparent_30%),linear-gradient(90deg,#050506_0%,#0c0813_55%,#050506_100%)]" />
        <div className={cn("relative grid min-h-[520px] gap-0 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_30rem]", reverse && "lg:grid-cols-[24rem_1fr] xl:grid-cols-[30rem_1fr]")}>
          {reverse ? (
            <>
              <div className="border-b border-white/10 lg:border-b-0 lg:border-r">{heroPanel}</div>
              {galleryPanel}
            </>
          ) : (
            <>
              {galleryPanel}
              {heroPanel}
            </>
          )}
        </div>
      </Link>
    </section>
  );
}

function DynamicBanner({ module }: { module: ExploreModule }) {
  const { t } = useExploreTranslation();
  return (
    <section className="w-full px-5 pb-8 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <Link
        href={module.href || "#"}
        className="group relative mx-auto block overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#08090d] shadow-2xl shadow-black/50"
      >
        <div className="relative min-h-[430px]">
          <ExploreModuleMedia
            media={module.hero}
            className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
            eager
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/78 via-black/34 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/10" />
          <div className="relative flex min-h-[430px] items-end px-7 py-10 md:px-12 lg:px-16">
            <div className="flex max-w-2xl flex-wrap items-center gap-3">
              <span className="inline-flex rounded-lg border border-white/15 bg-black/45 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-black/40 backdrop-blur">
                {t(module.title)}
              </span>
              {module.cta ? (
                <span className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-2xl shadow-black/45 transition group-hover:scale-[1.04] group-hover:bg-slate-100">
                  {t(module.cta)}
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              ) : null}
              {module.subtitle ? <p className="basis-full text-sm leading-6 text-white/75">{t(module.subtitle)}</p> : null}
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}

function DynamicExploreModule({ module }: { module: ExploreModule }) {
  if (!module.enabled) return null;
  if (module.layout === "banner") return <DynamicBanner module={module} />;
  return <DynamicGallery module={module} reverse={module.layout === "gallery-right"} />;
}

function PreviewVideo({
  videoUrl,
  posterUrl,
  title,
  className,
  onDuration,
  shouldPlay = false,
}: {
  videoUrl: string;
  posterUrl?: string | null;
  title: string;
  className?: string;
  onDuration?: (seconds: number) => void;
  shouldPlay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);

  const play = useCallback(async () => {
    if (!videoRef.current) return;
    setPlaying(true);
    try {
      videoRef.current.currentTime = 0;
      await videoRef.current.play();
    } catch {
      setPlaying(false);
    }
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (typeof window !== "undefined") {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduceMotion) return;
    }
    if (shouldPlay) {
      void play();
    } else {
      pause();
      try {
        el.currentTime = 0.05;
      } catch {}
    }
  }, [pause, play, shouldPlay, videoUrl]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={title}
          className={cn("absolute inset-0 h-full w-full object-cover transition duration-700", playing ? "scale-110 opacity-0" : "scale-100 opacity-100")}
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.22),transparent_35%),radial-gradient(circle_at_70%_10%,rgba(236,72,153,0.16),transparent_30%),linear-gradient(135deg,#050812,#070b18_45%,#111827)] transition duration-700",
            playing || frameReady ? "scale-110 opacity-0" : "scale-100 opacity-100",
          )}
        />
      )}
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const duration = (event.currentTarget as HTMLVideoElement).duration;
          if (Number.isFinite(duration) && duration > 0) onDuration?.(duration);
          try {
            (event.currentTarget as HTMLVideoElement).currentTime = 0.05;
          } catch {}
        }}
        onLoadedData={() => setFrameReady(true)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition duration-700",
          playing || (!posterUrl && frameReady) ? "scale-100 opacity-100" : "scale-110 opacity-0",
        )}
      />
    </div>
  );
}

type MediaCardItem = {
  key: string;
  kind: "showcase";
  id: string;
  type: "video" | "image";
  title: string;
  model: string;
  creator: string;
  prompt: string;
  tags: string[];
  featured: boolean;
  views: number;
  likes: number;
  createdAt: string;
  videoUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
};

function toMediaCardItemFromShowcase(item: ShowcaseItem): MediaCardItem {
  return {
    key: `showcase:${item.id}`,
    kind: "showcase",
    id: item.id,
    type: "video",
    title: item.title,
    model: item.model,
    creator: item.provider,
    prompt: item.prompt,
    tags: item.tags ?? [],
    featured: Boolean(item.featured),
    views: Number(item.views ?? 0),
    likes: Number(item.likes ?? 0),
    createdAt: item.created_at,
    videoUrl: item.video_url,
    imageUrl: null,
    thumbnailUrl: item.thumbnail_url,
  };
}

function ReelCard({
  item,
  size = "normal",
  autoplayKey,
  onAutoplayRequest,
  className,
}: {
  item: MediaCardItem;
  size?: "wide" | "tall" | "normal";
  autoplayKey: string | null;
  onAutoplayRequest: (key: string) => void;
  className?: string;
}) {
  const { t } = useExploreTranslation();
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);

  const likeItem = async () => {
    if (item.kind !== "showcase") return;
    await fetch(`/api/showcase/${item.id}`, { method: "PATCH" });
  };

  useEffect(() => {
    if (item.type !== "video" || !item.videoUrl) return;
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        const visible = Boolean(first?.isIntersecting);
        setInView(visible);
        if (visible) onAutoplayRequest(item.key);
      },
      { threshold: 0.35, rootMargin: "220px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.key, item.type, item.videoUrl, onAutoplayRequest]);

  const shouldPlay = item.type === "video" && Boolean(item.videoUrl) && (hovered || (inView && autoplayKey === item.key));

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      whileHover={{ y: -2, scale: 1.01 }}
      className={cn(
        "group relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30 transition",
        className,
      )}
      ref={(node) => {
        cardRef.current = node;
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn("relative", size === "wide" ? "aspect-[16/9]" : size === "tall" ? "aspect-[3/4]" : "aspect-[4/5]")}>
        {item.type === "video" && item.videoUrl ? (
          <PreviewVideo
            videoUrl={item.videoUrl}
            posterUrl={item.thumbnailUrl}
            title={item.title}
            onDuration={setDurationSec}
            shouldPlay={shouldPlay}
          />
        ) : item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.22),transparent_35%),radial-gradient(circle_at_70%_10%,rgba(236,72,153,0.16),transparent_30%),linear-gradient(135deg,#050812,#070b18_45%,#111827)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-95" />
        <div className="absolute inset-0 bg-cyan-300/0 transition group-hover:bg-cyan-300/[0.03]" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          {item.featured && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/35 bg-amber-300/15 px-2.5 py-1 text-[11px] font-bold text-amber-100 backdrop-blur">
              <Star className="h-3 w-3" />
              {t("Featured")}
            </span>
          )}
          <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-bold text-white/90 backdrop-blur">
            {item.model}
          </span>
        </div>
        <div className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/35 backdrop-blur transition group-hover:scale-110 group-hover:bg-white group-hover:text-black">
          <Play className="h-4 w-4 fill-current" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/90">{item.creator}</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
              {item.type === "video" ? formatDuration(durationSec || 0) : t("Image")}
            </div>
          </div>
          <h3 className="mt-2 text-xl font-black leading-tight text-white">{t(item.title)}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">{t(item.prompt)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-white/80">
            {item.kind === "showcase" ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                  <Eye className="h-3.5 w-3.5" />
                  {compactNumber(item.views)}
                </span>
                <button onClick={() => void likeItem()} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 transition hover:bg-pink-500/25">
                  <Heart className="h-3.5 w-3.5" />
                  {compactNumber(item.likes)}
                </button>
                {item.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="rounded-full bg-white/10 px-2 py-1">
                    {t(tag)}
                  </span>
                ))}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                Live
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function DiscoverSection({
  kicker,
  title,
  subtitle,
  ctaLabel,
  items,
  accentClassName,
  autoplayKey,
  onAutoplayRequest,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  items: MediaCardItem[];
  accentClassName: string;
  autoplayKey: string | null;
  onAutoplayRequest: (key: string) => void;
}) {
  const { t } = useExploreTranslation();
  const gridItems = items.slice(0, 6);

  return (
    <section className="w-full px-5 pb-12 md:px-10 lg:px-14 xl:px-20 max-w-[1600px] mx-auto">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className={cn("relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/40 lg:col-span-4", accentClassName)}>
          <div className="relative z-10">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">{kicker}</div>
            <div className="mt-4 text-2xl font-black leading-tight text-white">{t(title)}</div>
            <div className="mt-3 text-sm leading-6 text-slate-200/90">{t(subtitle)}</div>
            <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950 transition hover:scale-[1.02]">
              <Sparkles className="h-4 w-4" />
              {ctaLabel}
            </button>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white/75 backdrop-blur">
                <Play className="h-3.5 w-3.5" />
                {t("Demos")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white/75 backdrop-blur">
                <ScrollText className="h-3.5 w-3.5" />
                {t("Tutorials")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white/75 backdrop-blur">
                <Zap className="h-3.5 w-3.5" />
                {t("Best settings")}
              </span>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-black/50" />
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-pink-400/10 blur-3xl" />
        </div>

        <div className="lg:col-span-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:grid-rows-3">
            {gridItems.map((item, index) => {
              const span =
                index === 0
                  ? "md:col-span-2 md:row-span-3"
                  : index === 5
                    ? "md:col-span-2"
                    : "md:col-span-1";
              const size = index === 0 ? "tall" : index === 5 ? "wide" : "normal";

              return (
                <ReelCard
                  key={item.key}
                  item={item}
                  size={size}
                  autoplayKey={autoplayKey}
                  onAutoplayRequest={onAutoplayRequest}
                  className={span}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Main Page Component ───

function useExploreTranslation() {
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
      "YOURS TO CREATE": "أنشئ كما تريد",
      "ASK ME AND I'LL GIVE YOU WHAT YOU WANT": "اطلب وسأصنع لك ما تريد",
      "Type a prompt...": "اكتب فكرة أو توجيه...",
      "Image": "صورة",
      "Video": "فيديو",
      "Ratio: ": "الأبعاد: ",
      "Style: ": "النمط: ",
      "Generate": "توليد",
      "Demos": "عروض تجريبية",
      "Tutorials": "شروحات",
      "Best settings": "أفضل الإعدادات",
      "Try this model": "جرب هذا النموذج",
      "Studio Creations": "أعمال الاستوديو",
      "Live Feed": "تحديثات مباشرة",
      "latest": "الأحدث",
      "featured": "المميزة",
      "trending": "الالرائجة",
      "Loading creations...": "جاري تحميل الأعمال...",
      "No creations published yet.": "لم يتم نشر أي أعمال بعد.",
      "Search Iraq gallery...": "البحث في معرض العراق...",
      "All": "الكل",
      "Architecture": "الهندسة المعمارية",
      "Sci-Fi": "الخيال العلمي",
      "Photography": "التصوير الفوتوغرافي",
      "History": "التاريخ",
      "Nature": "الطبيعة",
      "Sort: ": "ترتيب: ",
      "Trending": "الرائج",
      "Likes": "الإعجابات",
      "Views": "المشاهدات",
      "No results found matching your search filters.": "لم يتم العثور على نتائج تطابق فلاتر البحث.",
      "Copy Prompt": "نسخ التوجيه",
      "Copied!": "تم النسخ!",
      "Community Creations (Iraq & Baghdad)": "أعمال المجتمع (العراق وبغداد)",
      "Featured Blueprints": "مخططات مميزة",
      "Templates": "قوالب",
      "View More": "عرض المزيد",
      "Create Preset": "إنشاء نمط",
      "Clear History": "مسح المحادثة",
      "Clear History (مسح المحادثة)": "مسح المحادثة",
      "Smart Explore Assistant": "مساعد الاستكشاف الذكي",
      "مساعد الاستكشاف الذكي": "مساعد الاستكشاف الذكي",
      "Thinking and writing...": "جاري التفكير والكتابة...",
      "جاري التفكير والكتابة...": "جاري التفكير والكتابة...",
      "Smart redirect incoming": "توجيه ذكي وشيك",
      "توجيه ذكي وشيك": "توجيه ذكي وشيك",
      "Cancel Redirect": "إلغاء التوجيه",
      "إلغاء التوجيه": "إلغاء التوجيه",
      "Featured": "مميز",
      "Iraq Space Center & Observatory": "مركز العراق للفضاء والمرصد",
      "Mesopotamian Eco-City Marshes": "أهوار المدينة البيئية الرافدينية",
      "Zaha Hadid Baghdad Cultural Center": "مركز زها حديد الثقافي في بغداد",
      "Modern Tigris Riverwalk": "ممشى دجلة الحديث",
      "Futuristic Babylon City": "مدينة بابل المستقبلية",
      "Baghdad Metro Station": "محطة مترو بغداد",
      "Mesopotamian Future Museum": "متحف الرافدين المستقبلي",
      "Futuristic Baghdad Skyline": "أفق بغداد المستقبلي",
      "3D Reference View Creator": "منشئ مرجع العرض ثلاثي الأبعاد",
      "Motion Product Showcase": "معرض المنتجات الحركية",
      "Cinematic Scenario Product Film": "فيلم سيناريو سينمائي للمنتجات",
      "Mesopotamian Cyberpunk Style": "نمط السايبربانك بلاد الرافدين",
      "Tilt-Shift Miniature Effect": "تأثير المنمنمات (Tilt-Shift)",
      "Eco-City Architecture Render": "رندر العمارة للمدينة البيئية",
      "NEW MODEL": "نموذج جديد",
      "Meet GPT Image 2": "تعرف على GPT Image 2",
      "4K images with near-perfect text rendering": "صور بدقة 4K مع كتابة نصوص مثالية تقريباً",
      "Try Model": "تجربة النموذج",
      "Canvas": "الكانفاس",
      "Open": "فتح",
      "VIDEO MODEL": "نموذج فيديو",
      "Seedance 2": "سيدانس 2",
      "Fast cinematic video generation with smooth motion and flexible references.": "توليد سريع للفيديو السينمائي مع حركة سلسة ومراجع مرنة.",
      "NEXT SCENE ENGINE": "محرك المشهد التالي",
      "VIDEO TOOL": "أداة الفيديو",
      "Transitions": "الانتقالات",
      "Create stylized scene changes and motion bridges between your clips.": "إنشاء تغييرات مشاهد مميزة وجسور حركية بين مقاطعك.",
      "Nano Banana": "نانو بنانا",
      "Kling 3.0": "كلينغ 3.0",
      "Cinematic motion, strong scene continuity, and polished video generation.": "حركة سينمائية، استمرارية قوية للمشهد، وتوليد فيديو مصقول.",
      "Open Tool": "فتح الأداة",
      "Image Gen": "توليد الصور",
      "Video Gen": "توليد الفيديو",
      "3D Gen": "توليد ثلاثي الأبعاد",
      "Blueprints": "مخططات",
      "Realtime": "الوقت الفعلي",
      "Flow": "التدفق",
      "Upscaler": "محسن الدقة",
      "Draw": "رسم",
      "Hot": "شائع",
      "MODEL": "نموذج",
      "CAMERA LIBRARY": "مكتبة الكاميرا",
      "62 Cinematic Camera Movements": "62 حركة كاميرا سينمائية",
      "Dolly, zoom, orbit, drone, tracking, and crane camera moves with instant ready-to-copy prompts for any AI video model.": "حركات دولّي، زوم، أوربت، درون، رافعة، وتتبع مع برومبتات جاهزة للنسخ والاستخدام في أي موديل فيديو.",
      "Explore Camera Moves": "استكشف حركات الكاميرا",
      "PROMPTS REPOSITORY": "مكتبة البرومبتات",
      "Cinematic Video Prompts Library": "مكتبة برومبتات الفيديو السينمائية",
      "Curated, battle-tested AI video prompts for cinematic stories, high-end ads, animations, and FPV shots.": "برومبتات فيديو سينمائية منسقة ومختبرة للقصص السينمائية، الإعلانات الفاخرة، الأنيمشن، ولقطات FPV.",
      "Browse Prompts": "تصفح البرومبتات",
      "AI RETOUCH SUITE": "أدوات التعديل والمعالجة",
      "AI Image Studio & Retouch Tools": "استوديو تعديل ومعالجة الصور بالذكاء الاصطناعي",
      "4K AI Upscaler, Smart Object Inpaint & Eraser, Face Swap Pro, and dynamic AI Relighting in one place.": "تكبير الدقة حتى 4K، إزالة وتعديل العناصر، استبدال الوجوه، وإعادة توزيع الإضاءة الذكية في مكان واحد.",
      "Launch Image Editor": "فتح محرر الصور",
      "STORYBOARD & DRAMA": "القصة المصورة والدراما",
      "Storyboard & Short Drama Studio": "استوديو القصة المصورة والدراما القصيرة",
      "Create multi-panel storyboards, cinematic short dramas, and comics with character consistency and up to 4K quality.": "إنتاج القصص المصورة المتتالية، مسلسلات الدراما القصيرة، والكوميكس مع ثبات الشخصيات بدقة حتى 4K.",
      "Open Storyboard Studio": "فتح القصة المصورة",
      "Multi-Panel Production": "إنتاج اللوحات المتتالية",
      "STUDIO SHOWCASE": "معرض إبداعات الاستوديو",
      "Studio Creations & Live Showcase": "معرض إبداعات ونماذج الاستوديو الحية",
      "View All Creations": "تصفح كافة إبداعات الاستوديو",
      "View All": "عرض الكل",
      "Explore all Studio Creations": "استكشف كافة أعمال الاستوديو",
      "views": "مشاهدة",
      "هيرو للموديل + مصغرات لأعماله + مواد تعليمية وإعدادات موصى بها.": "نموذج البطل + مصغرات الأعمال + الشروحات والإعدادات الموصى بها."
    }
  };

  const t = (key: string) => {
    if (!key) return "";
    const cleanKey = key.trim();
    return dict[lang]?.[cleanKey] || key;
  };

  return { t, lang };
}

export default function ExplorePage() {
  const { t, lang } = useExploreTranslation();
  const router = useRouter();

  // CMS & API States
  const [cmsModules, setCmsModules] = useState<ExploreModule[]>(DEFAULT_EXPLORE_MODULES);
  const [items, setItems] = useState<ShowcaseItem[]>(INITIAL_STUDIO_CREATIONS);
  const [itemsCursor, setItemsCursor] = useState<string | null>(null);
  const [featured, setFeatured] = useState<ShowcaseItem[]>(INITIAL_STUDIO_CREATIONS);
  const [featuredCursor, setFeaturedCursor] = useState<string | null>(null);
  const [trending, setTrending] = useState<ShowcaseItem[]>(INITIAL_STUDIO_CREATIONS);
  const [trendingCursor, setTrendingCursor] = useState<string | null>(null);
  const [autoplayKey, setAutoplayKey] = useState<string | null>(null);
  const [activeFeed, setActiveFeed] = useState<"latest" | "featured" | "trending">("latest");
  const [loadingCreations, setLoadingCreations] = useState(false);
  const [activeMediaItem, setActiveMediaItem] = useState<ShowcaseItem | null>(null);

  // Prompt Generator states
  const [promptText, setPromptText] = useState("");
  const [activeMedia, setActiveMedia] = useState<"image" | "video">("image");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [selectedStyle, setSelectedStyle] = useState("Dynamic");
  const [chatHistory, setChatHistory] = useState<Array<{ sender: "user" | "agent"; text: string }>>([]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Increment view count in database and update UI state when showcase item is previewed
  useEffect(() => {
    if (activeMediaItem) {
      fetch(`/api/showcase/${activeMediaItem.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.item) {
            const updatedItem = data.item;
            const updateList = (list: ShowcaseItem[]) =>
              list.map((u) => (u.id === updatedItem.id ? { ...u, views: updatedItem.views } : u));
            setItems(updateList);
            setFeatured(updateList);
            setTrending(updateList);
            setActiveMediaItem((current) => {
              if (current && current.id === updatedItem.id) {
                return { ...current, views: updatedItem.views };
              }
              return current;
            });
          }
        })
        .catch(() => {});
    }
  }, [activeMediaItem?.id]);

  const [heroTextIndex, setHeroTextIndex] = useState(0);
  const heroTexts = ["YOURS TO CREATE", "ASK ME AND I'LL GIVE YOU WHAT YOU WANT"];

  useEffect(() => {
    const interval = setInterval(() => {
      setHeroTextIndex((prev) => (prev + 1) % heroTexts.length);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  // Column Count calculations to prevent random layout shifts during CSS columns redistribution
  const [columnCount, setColumnCount] = useState(1);
  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width >= 1280) setColumnCount(4);
      else if (width >= 1024) setColumnCount(3);
      else if (width >= 640) setColumnCount(2);
      else setColumnCount(1);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const columnsData = useMemo(() => {
    const list = activeFeed === "featured" ? featured : activeFeed === "trending" ? trending : items;
    const cols: ShowcaseItem[][] = Array.from({ length: columnCount }, () => []);
    list.forEach((item, index) => {
      cols[index % columnCount].push(item);
    });
    return cols;
  }, [activeFeed, featured, trending, items, columnCount]);

  // Dropdown states
  const [showAspectDropdown, setShowAspectDropdown] = useState(false);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [sortBy, setSortBy] = useState<"Trending" | "Likes" | "Views">("Trending");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // References
  const aspectRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (aspectRef.current && !aspectRef.current.contains(event.target as Node)) {
        setShowAspectDropdown(false);
      }
      if (styleRef.current && !styleRef.current.contains(event.target as Node)) {
        setShowStyleDropdown(false);
      }
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch showcase items
  const loadInitial = useCallback(async () => {
    try {
      const [latestRes, featuredRes, trendingRes] = await Promise.all([
        fetch("/api/showcase?take=30", { cache: "no-store" }),
        fetch("/api/showcase/featured?take=18", { cache: "no-store" }),
        fetch("/api/showcase/trending?take=30", { cache: "no-store" }),
      ]);

      const latestJson = latestRes.ok ? ((await latestRes.json()) as FeedResponse) : { items: [] };
      const featuredJson = featuredRes.ok ? ((await featuredRes.json()) as FeedResponse) : { items: [] };
      const trendingJson = trendingRes.ok ? ((await trendingRes.json()) as FeedResponse) : { items: [] };

      if (latestJson.items && latestJson.items.length > 0) {
        setItems(latestJson.items);
      }
      setItemsCursor(latestJson.nextCursor ?? null);

      if (featuredJson.items && featuredJson.items.length > 0) {
        setFeatured(featuredJson.items);
      }
      setFeaturedCursor((featuredJson as any).nextCursor ?? null);

      if (trendingJson.items && trendingJson.items.length > 0) {
        setTrending(trendingJson.items);
      }
      setTrendingCursor((trendingJson as any).nextCursor ?? null);
    } catch (err) {
      console.error("Failed to load creations:", err);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Fetch CMS Modules configurations
  useEffect(() => {
    let cancelled = false;
    const loadCms = async () => {
      try {
        const res = await fetch("/api/explore/cms", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(json?.config?.modules)) {
          setCmsModules(json.config.modules);
        }
      } catch {
        if (!cancelled) setCmsModules(DEFAULT_EXPLORE_MODULES);
      }
    };
    void loadCms();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestAutoplay = useCallback((key: string) => {
    setAutoplayKey((prev) => (prev === key ? prev : key));
  }, []);

  const handleCancelRedirect = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
    setPendingUrl(null);
    setChatHistory((prev) => [
      ...prev,
      { sender: "agent", text: "تم إلغاء التوجيه. يمكنك الاستمرار في التحدث معي أو طلب أي أداة تريد استخدامها!" }
    ]);
  };

  const handleGenerate = async () => {
    if (!promptText.trim()) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
    setPendingUrl(null);

    const userMessage = promptText.trim();
    setPromptText("");
    setChatHistory((prev) => [...prev, { sender: "user", text: userMessage }]);
    setIsAgentTyping(true);

    try {
      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMessage,
          history: chatHistory,
        }),
      });
      const data = await res.json().catch(() => null);
      setIsAgentTyping(false);

      if (res.ok && data?.response) {
        setChatHistory((prev) => [...prev, { sender: "agent", text: data.response }]);

        if (data.action === "redirect" && data.path) {
          const url = new URL(data.path, window.location.origin);
          if (data.query) {
            Object.entries(data.query).forEach(([key, val]) => {
              if (val) url.searchParams.set(key, String(val));
            });
          }

          const targetUrl = url.pathname + url.search;
          setPendingUrl(targetUrl);

          let count = 4;
          setCountdown(count);

          timerRef.current = setInterval(() => {
            count -= 1;
            if (count <= 0) {
              clearInterval(timerRef.current!);
              timerRef.current = null;
              router.push(targetUrl);
            } else {
              setCountdown(count);
            }
          }, 1000);
        }
      } else {
        throw new Error("Routing failed");
      }
    } catch (err) {
      setIsAgentTyping(false);
      setChatHistory((prev) => [
        ...prev,
        { sender: "agent", text: "عذراً، واجهت مشكلة في الاتصال بمساعد التوجيه. سأقوم بتوجيهك تلقائياً للأداة الافتراضية." }
      ]);
      const fallbackUrl = activeMedia === "video"
        ? `/video?prompt=${encodeURIComponent(userMessage)}`
        : `/image?tool=create&prompt=${encodeURIComponent(userMessage)}&aspect=${aspectRatio}&preset=${selectedStyle.toLowerCase()}`;
      setTimeout(() => {
        router.push(fallbackUrl);
      }, 2000);
    }
  };

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered Iraq grid items
  const filteredIraqImages = useMemo(() => {
    let list = [...IRAQ_IMAGES];
    if (activeCategory !== "All") {
      list = list.filter((img) => img.tags.includes(activeCategory));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((img) =>
        img.title.toLowerCase().includes(q) || img.prompt.toLowerCase().includes(q)
      );
    }
    if (sortBy === "Likes") {
      list.sort((a, b) => b.likes - a.likes);
    } else if (sortBy === "Views") {
      list.sort((a, b) => b.views - a.views);
    }
    return list;
  }, [activeCategory, searchQuery, sortBy]);

  // distribute Iraq items into columns
  const iraqColumns = useMemo(() => {
    const col1: IraqImageItem[] = [];
    const col2: IraqImageItem[] = [];
    const col3: IraqImageItem[] = [];
    filteredIraqImages.forEach((item, index) => {
      if (index % 3 === 0) col1.push(item);
      else if (index % 3 === 1) col2.push(item);
      else col3.push(item);
    });
    return [col1, col2, col3];
  }, [filteredIraqImages]);

  return (
    <main className="w-full min-h-screen bg-[#02050e] text-white relative pb-20 overflow-x-hidden">

      {/* Ambient colorful glow spots */}
      <div className="absolute top-0 left-[-10%] w-[50%] h-[600px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12),transparent_70%)] pointer-events-none" />
      <div className="absolute top-[-100px] right-[-10%] w-[40%] h-[700px] bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.08),transparent_70%)] pointer-events-none" />

      {/* ════════════════════════════════════════════════
          HERO BANNER
      ════════════════════════════════════════════════ */}
      <section className="relative w-full min-h-[520px] lg:h-[560px] py-16 flex flex-col items-center justify-center border-b border-white/5">
        
        {/* Background Image with Cinematic Overlay */}
        <div className="absolute inset-0 z-0">
          <img
            src="/explore/iraq/skyline.png"
            alt="Baghdad Skyline Backdrop"
            className="w-full h-full object-cover opacity-35 scale-105 blur-[2px]"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#02050e] via-[#02050e]/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#02050e] via-transparent to-[#02050e]" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 w-full max-w-6xl px-4 flex flex-col items-center text-center">
          
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-3xl md:text-5xl font-black tracking-widest text-white uppercase drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] mb-6 min-h-[4.5rem] flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.span
                  key={heroTextIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.4 }}
                >
                  {t(heroTexts[heroTextIndex])}
                </motion.span>
              </AnimatePresence>
            </h1>
          </motion.div>

          {/* ── Prompt Generator Container ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="w-full max-w-4xl bg-black/60 border border-white/10 rounded-2xl p-4 shadow-[0_12px_45px_rgba(0,0,0,0.8)] backdrop-blur-xl hover:border-white/20 transition-all duration-300 flex flex-col gap-3.5 text-right"
          >
            {/* ── Conversational Messages Feed (Nested Inside Prompt Box) ── */}
            {chatHistory.length > 0 && (
              <div className="flex flex-col gap-3 pb-3.5 border-b border-white/5 max-h-[220px] overflow-y-auto pr-1 scrollbar-none">
                <div className="flex items-center justify-between text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => setChatHistory([])}
                    className="hover:text-zinc-300 transition"
                  >
                    {t("Clear History (مسح المحادثة)")}
                  </button>
                  <span>{t("Smart Explore Assistant")}</span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {chatHistory.map((msg, index) => {
                    const isUser = msg.sender === "user";
                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex items-start gap-2.5 text-xs max-w-[85%] rounded-xl p-3 leading-relaxed",
                          isUser
                            ? "self-end bg-zinc-800/40 text-zinc-200 rounded-tr-none border border-white/[0.02]"
                            : "self-start bg-violet-600/[0.03] text-violet-200 border border-violet-500/10 rounded-tl-none"
                        )}
                      >
                        {!isUser && (
                          <div className="w-5 h-5 rounded bg-violet-600/10 border border-violet-500/25 flex items-center justify-center shrink-0 text-violet-300 font-bold text-[9px]">
                            AI
                          </div>
                        )}
                        <div className="flex-1">
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}

                  {isAgentTyping && (
                    <div className="self-start flex items-center gap-2 bg-violet-600/[0.01] border border-violet-500/5 rounded-xl rounded-tl-none p-3 text-zinc-400 text-xs">
                      <Loader2 size={12} className="animate-spin text-violet-500 shrink-0" />
                      <span>{t("Thinking and writing...")}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Input Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <Search className="w-5 h-5 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  placeholder={t("Type a prompt...")}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
                  className="flex-1 bg-transparent border-none text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 text-sm md:text-base py-1 min-w-0 w-full"
                />
              </div>
              
              {/* Media Switcher Pill */}
              <div className="flex bg-white/5 rounded-xl p-1 border border-white/5 shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setActiveMedia("image")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeMedia === "image" ? "bg-white/10 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("Image")}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMedia("video")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeMedia === "video" ? "bg-white/10 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  {t("Video")}
                </button>
              </div>
            </div>

            {/* Settings & Generate Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5 mt-2.5">
              
              <div className="flex items-center gap-2.5">
                {/* Aspect Ratio Selector */}
                <div className="relative" ref={aspectRef}>
                  <button
                    type="button"
                    onClick={() => setShowAspectDropdown(!showAspectDropdown)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition"
                  >
                    <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{t("Ratio: ")}{aspectRatio}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${showAspectDropdown ? "rotate-180" : ""}`} />
                  </button>
                  
                  <AnimatePresence>
                    {showAspectDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bottom-full left-0 z-50 mb-2 w-32 bg-[#090d16] border border-white/10 rounded-xl p-1 shadow-2xl backdrop-blur-xl"
                      >
                        {["1:1", "16:9", "9:16", "4:3", "3:4"].map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => {
                              setAspectRatio(ratio);
                              setShowAspectDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition ${
                              aspectRatio === ratio ? "bg-white/10 text-white font-bold" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Style Preset Selector */}
                <div className="relative" ref={styleRef}>
                  <button
                    type="button"
                    onClick={() => setShowStyleDropdown(!showStyleDropdown)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition"
                  >
                    <Star className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{t("Style: ")}{t(selectedStyle)}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${showStyleDropdown ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {showStyleDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bottom-full left-0 z-50 mb-2 w-40 bg-[#090d16] border border-white/10 rounded-xl p-1 shadow-2xl backdrop-blur-xl"
                      >
                        {["Dynamic", "Photography", "Anime", "3D Render", "Cinematic"].map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => {
                              setSelectedStyle(style);
                              setShowStyleDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition ${
                              selectedStyle === style ? "bg-white/10 text-white font-bold" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Generate Trigger Button */}
              <button
                type="button"
                onClick={handleGenerate}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 rounded-xl text-xs font-extrabold text-black shadow-lg shadow-cyan-500/25 transition-all duration-300 transform active:scale-95 shrink-0"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {t("Generate")}
              </button>

            </div>

            {/* Countdown widget inside prompt box */}
            {countdown !== null && pendingUrl && (
              <div className="border-t border-white/5 pt-3.5 flex flex-col sm:flex-row items-center justify-between gap-4 bg-violet-600/[0.02] p-3.5 rounded-xl border border-violet-500/10 mt-1">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin flex items-center justify-center text-[10px] font-bold text-violet-300">
                    {countdown}
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-zinc-200 block">{t("Smart redirect incoming")}</span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">{lang === "ar" ? `سيتم نقلك للأداة المطلوبة خلال ${countdown} ثوانٍ.` : `You will be redirected in ${countdown} seconds.`}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCancelRedirect}
                  className="px-3.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-[11px] font-bold text-red-400 transition"
                >
                  {t("Cancel Redirect")}
                </button>
              </div>
            )}
          </motion.div>

          {/* ── Quick Circles Tools Row ── */}
          <div className="w-full max-w-4xl flex flex-wrap justify-center sm:justify-between gap-4 sm:gap-0 mt-10">
            {[
              { label: "Image Gen", icon: Wand2, badge: "", href: "/image" },
              { label: "Video Gen", icon: Video, badge: "", href: "/video" },
              { label: "Camera Moves", icon: Camera, badge: "NEW", href: "/camera-movements" },
              { label: "Prompts", icon: Sparkles, badge: "NEW", href: "/prompt" },
              { label: "3D Gen", icon: Box, badge: "", href: "/3d" },
              { label: "Realtime", icon: Monitor, badge: "NEW", href: "/canvas" },
              { label: "Flow", icon: TrendingUp, badge: "", href: "/video" },
              { label: "Upscaler", icon: Aperture, badge: "NEW", href: "/edit?tool=upscale" },
              { label: "Draw", icon: Paintbrush, badge: "", href: "/edit" }
            ].map((tool, idx) => (
              <Link href={tool.href} key={idx} className="flex flex-col items-center gap-2 group cursor-pointer shrink-0">
                <div className="relative w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center shadow-lg group-hover:bg-white/[0.08] group-hover:border-white/20 group-hover:scale-105 transition-all duration-200">
                  <tool.icon className="w-6 h-6 lg:w-8 lg:h-8 text-zinc-300 group-hover:text-white transition-colors" />
                  {tool.badge && (
                    <span className="absolute -top-1.5 -right-1.5 lg:-top-2 lg:-right-2 bg-emerald-500 text-[8px] lg:text-[9px] font-black text-black px-1.5 lg:px-2 py-0.5 rounded-full uppercase tracking-wider shadow-lg">
                      {tool.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-zinc-400 group-hover:text-white transition-colors">
                  {t(tool.label)}
                </span>
              </Link>
            ))}
          </div>

        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FEATURED AD BANNERS (New Tools: Camera Moves, Prompts, Image Edit, Storyboard, Studio Creations)
      ════════════════════════════════════════════════ */}
      <CameraMovementsAd />
      <PromptsLibraryAd />
      <ImageEditToolsAd />
      <StoryboardStudioAd />
      <StudioCreationsAd />

      {/* ════════════════════════════════════════════════
          STUDIO CREATIONS FEED (معرض أعمال الاستوديو والأعمال الجديدة)
      ════════════════════════════════════════════════ */}
      <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto border-b border-white/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <h2 className="text-xl font-bold tracking-tight text-white">{t("Studio Creations")}</h2>
            <span className="text-[10px] bg-cyan-400/10 border border-cyan-400/20 rounded-full px-2.5 py-0.5 font-bold text-cyan-200 uppercase tracking-wider">
              {t("Live Feed")}
            </span>
            <Link
              href="/creations"
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition flex items-center gap-1 ml-2"
            >
              <span>{t("View All")}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex bg-white/5 rounded-xl p-1 border border-white/5 self-end sm:self-auto">
            {(["latest", "featured", "trending"] as const).map((feed) => (
              <button
                key={feed}
                type="button"
                onClick={() => setActiveFeed(feed)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                  activeFeed === feed ? "bg-white/10 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t(feed)}
              </button>
            ))}
          </div>
        </div>

        {/* 4-Card 2-Row Clean Grid matching Image 2 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {(activeFeed === "featured" ? featured : activeFeed === "trending" ? trending : items).slice(0, 8).map((item) => {
            const isVideo = item.video_url && 
              !item.video_url.endsWith(".png") && 
              !item.video_url.endsWith(".jpg") && 
              !item.video_url.endsWith(".jpeg") && 
              !item.video_url.endsWith(".webp") &&
              !item.video_url.endsWith(".gif");

            return (
              <div
                key={item.id}
                onClick={() => setActiveMediaItem(item)}
                onMouseEnter={() => setAutoplayKey(`creations:${item.id}`)}
                onMouseLeave={() => setAutoplayKey(null)}
                className="group relative flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#070a12] shadow-xl hover:border-cyan-500/40 hover:scale-[1.02] transition-all duration-300 cursor-pointer"
              >
                {/* 16:9 Media Container */}
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  {isVideo ? (
                    <PreviewVideo
                      videoUrl={item.video_url}
                      posterUrl={item.thumbnail_url}
                      title={item.title}
                      shouldPlay={autoplayKey === `creations:${item.id}`}
                    />
                  ) : (
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      className="w-full h-full object-cover transition duration-700 group-hover:scale-105"
                      loading="lazy"
                    />
                  )}

                  {/* Dark gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80" />

                  {/* Top-Left Category/Model Tag Badge */}
                  <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
                    <span className="bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-black text-cyan-300 px-2 py-0.5 rounded-md uppercase tracking-wider">
                      {item.model || "STUDIO"}
                    </span>
                  </div>

                  {/* Top-Right Video indicator */}
                  {isVideo && (
                    <div className="absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded-full border border-white/20 bg-black/50 backdrop-blur flex items-center justify-center text-white pointer-events-none">
                      <Video className="w-3 h-3" />
                    </div>
                  )}

                  {/* Bottom-Right Views Count */}
                  <div className="absolute bottom-2.5 right-2.5 z-10 pointer-events-none">
                    <span className="text-[9px] font-bold text-zinc-300 bg-black/60 backdrop-blur-md border border-white/10 px-2 py-0.5 rounded">
                      {compactNumber(item.views || 1000)} {t("views")}
                    </span>
                  </div>
                </div>

                {/* Bottom Bar: Icon + Title + PUBLIC Tag */}
                <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#080c16]">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                      <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                    </div>
                    <span className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-zinc-500 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                    PUBLIC
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Explore All Link Button */}
        <div className="mt-8 flex justify-center">
          <Link
            href="/creations"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black px-6 py-3 text-xs font-black shadow-lg shadow-cyan-500/20 transition duration-200 hover:scale-105"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t("Explore all Studio Creations")}</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        {/* ── Fullscreen Lightbox Modal ── */}
        <AnimatePresence>
          {activeMediaItem && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
              onClick={() => setActiveMediaItem(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative max-w-5xl w-full bg-[#080b11] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Left Column: Media Player */}
                <div className="flex-1 bg-black flex items-center justify-center relative min-h-[300px] md:min-h-0">
                  {activeMediaItem.video_url && 
                    !activeMediaItem.video_url.endsWith(".png") && 
                    !activeMediaItem.video_url.endsWith(".jpg") && 
                    !activeMediaItem.video_url.endsWith(".jpeg") && 
                    !activeMediaItem.video_url.endsWith(".webp") &&
                    !activeMediaItem.video_url.endsWith(".gif") ? (
                    <video
                      src={activeMediaItem.video_url}
                      controls
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain max-h-[70vh] md:max-h-[80vh]"
                    />
                  ) : (
                    <img
                      src={activeMediaItem.thumbnail_url}
                      alt={activeMediaItem.title}
                      className="w-full h-full object-contain max-h-[70vh] md:max-h-[80vh]"
                    />
                  )}
                </div>

                {/* Right Column: Info Panel */}
                <div className="w-full md:w-[360px] p-6 flex flex-col justify-between border-t md:border-t-0 md:border-l border-white/10 overflow-y-auto">
                  <div>
                    <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 tracking-wider">
                      <span>{activeMediaItem.provider}</span>
                      <span>{new Date(activeMediaItem.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                    <h3 className="mt-2 text-lg font-extrabold text-white leading-tight">
                      {activeMediaItem.title}
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="bg-white/5 border border-white/10 text-[9px] font-black text-cyan-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                        {activeMediaItem.model}
                      </span>
                    </div>

                    <div className="mt-5 space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">Prompt</label>
                      <p className="text-xs text-zinc-300 bg-white/[0.02] border border-white/5 rounded-xl p-3 font-mono leading-relaxed select-all text-right">
                        {activeMediaItem.prompt}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleCopyPrompt(activeMediaItem.id, activeMediaItem.prompt)}
                      className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-400 hover:text-cyan-300 transition"
                    >
                      {copiedId === activeMediaItem.id ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400">Prompt {t("Copied!")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>{t("Copy Prompt")}</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMediaItem(null)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-bold transition"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* Close Button top-right */}
                <button
                  type="button"
                  onClick={() => setActiveMediaItem(null)}
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white border border-white/10 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ════════════════════════════════════════════════
          FEATURED MODEL SHOWCASES (Image & Video Models - Bottom)
      ════════════════════════════════════════════════ */}
      <GptImage2ModelAd />
      <Seedance2ModelAd />

      {/* ════════════════════════════════════════════════
          FEATURED BLUEPRINTS (Horizontal Cards Row)
      ════════════════════════════════════════════════ */}
      <section className="w-full px-4 md:px-8 py-10 max-w-[1600px] mx-auto">
        
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-white">{t("Featured Blueprints")}</h2>
            <span className="text-[10px] bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 font-bold text-zinc-400">
              {t("Templates")}
            </span>
          </div>
          <Link href="/image-presets" className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition flex items-center gap-1">
            {t("View More")}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Horizontal Slider */}
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent scroll-smooth">
          {BLUEPRINTS.map((bp) => (
            <Link
              key={bp.id}
              href={bp.href}
              className="flex-shrink-0 w-64 h-80 rounded-2xl border border-white/10 overflow-hidden relative block group cursor-pointer shadow-lg hover:border-white/20 hover:scale-[1.01] transition-all duration-300 bg-zinc-950"
            >
              {/* Background Preset */}
              <img
                src={bp.imageUrl}
                alt={bp.title}
                className="absolute inset-0 w-full h-full object-cover transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
              
              {/* Badges on Card */}
              <div className="absolute left-3 top-3 flex items-center gap-2">
                {bp.badge && (
                  <span className="bg-emerald-500 text-[9px] font-black text-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                    {t(bp.badge)}
                  </span>
                )}
                <span className="bg-black/50 border border-white/10 text-[9px] font-black text-zinc-200 px-2 py-0.5 rounded-md uppercase backdrop-blur-md">
                  {t(bp.tag)}
                </span>
              </div>

              {/* Title & Overlay button */}
              <div className="absolute inset-x-0 bottom-0 p-4">
                <h3 className="text-base font-bold leading-tight text-white mb-2 group-hover:text-cyan-300 transition-colors">
                  {t(bp.title)}
                </h3>
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-cyan-400 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-1 group-hover:translate-y-0">
                  <span>Create Preset</span>
                  <ArrowUpRight className="w-3 h-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>

      </section>


      {/* ════════════════════════════════════════════════
          COMMUNITY CREATIONS (Iraq Masonry & Filters)
      ════════════════════════════════════════════════ */}
      <section className="w-full px-4 md:px-8 py-6 max-w-[1600px] mx-auto">
        
        {/* Section Heading & Category Filters */}
        <div className="flex flex-col gap-6 border-b border-white/5 pb-6 mb-8">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-bold tracking-tight text-white">{t("Community Creations (Iraq & Baghdad)")}</h2>
            
            {/* Search Input bar */}
            <div className="relative max-w-sm w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder={t("Search Iraq gallery...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:border-white/20 transition text-zinc-200"
              />
            </div>
          </div>

          {/* Filtering Pill bars */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            
            <div className="flex flex-wrap gap-2">
              {/* Category selector pills */}
              {["All", "Architecture", "Sci-Fi", "Photography", "History", "Nature"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    activeCategory === cat
                      ? "bg-white/10 text-white border border-white/15"
                      : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {t(cat)}
                </button>
              ))}
            </div>

            {/* Sorting pill selection */}
            <div className="relative" ref={sortRef}>
              <button
                type="button"
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                className="flex items-center gap-1.5 px-4 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition"
              >
                <span>{t("Sort: ")}{t(sortBy)}</span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              </button>

              <AnimatePresence>
                {showSortDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute right-0 top-full mt-2 w-32 bg-[#090d16] border border-white/10 rounded-xl p-1 shadow-2xl z-40 backdrop-blur-xl"
                  >
                    {(["Trending", "Likes", "Views"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setSortBy(mode);
                          setShowSortDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition ${
                          sortBy === mode ? "bg-white/10 text-white font-bold" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {t(mode)}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </div>

        {/* ── Masonry Grid Rendering ── */}
        {filteredIraqImages.length === 0 ? (
          <div className="w-full py-20 flex flex-col items-center justify-center border border-white/5 rounded-2xl bg-white/[0.01]">
            <Info className="w-8 h-8 text-zinc-500 mb-3" />
            <p className="text-sm text-zinc-400 font-medium">{t("No results found matching your search filters.")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {iraqColumns.map((columnItems, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-6">
                {columnItems.map((item) => (
                  <div
                    key={item.id}
                    className="relative rounded-2xl overflow-hidden border border-white/5 bg-white/[0.01] hover:border-white/15 transition-all duration-300 group shadow-lg"
                  >
                    
                    {/* Render Image with proper tag sizing */}
                    <div className="relative w-full overflow-hidden bg-zinc-950">
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-auto object-cover transition duration-700 group-hover:scale-[1.01]"
                        loading="lazy"
                      />
                      
                      {/* Dark overlay showing on hover */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-4" />
                    </div>

                    {/* Metadata & Actions inside Card */}
                    <div className="p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-400">{item.creator}</span>
                        <span className="text-[10px] bg-white/5 border border-white/10 rounded-md px-2 py-0.5 font-bold text-zinc-400">
                          {item.model}
                        </span>
                      </div>
                      
                      <h3 className="text-sm font-bold text-zinc-100 leading-snug">{t(item.title)}</h3>
                      
                      {/* Small Prompt Display box */}
                      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed bg-white/[0.02] border border-white/5 rounded-lg p-2 font-mono">
                        {t(item.prompt)}
                      </p>

                      {/* Interactive Bottom Bar */}
                      <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-1">
                        
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                            <Eye className="w-3.5 h-3.5" />
                            {item.views}
                          </span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-pink-500 transition"
                          >
                            <Heart className="w-3.5 h-3.5" />
                            {item.likes}
                          </button>
                        </div>

                        {/* Prompt copying Action button */}
                        <button
                          type="button"
                          onClick={() => handleCopyPrompt(item.id, item.prompt)}
                          className="flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">{t("Copied!")}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>{t("Copy Prompt")}</span>
                            </>
                          )}
                        </button>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

      </section>

      <Footer />
    </main>
  );
}
