"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import {
  Clapperboard,
  Zap,
  ImageIcon,
  ArrowRight,
  Clock,
  Gauge,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const montserrat = { className: "font-sans" };

// ─── Data ─────────────────────────────────────────────────────────────────────
const POWERHOUSES = [
  {
    id: "kling",
    name: "Kling O3",
    category: "Cinematic Video",
    categoryAr: "فيديو سينمائي",
    icon: Clapperboard,
    iconColor: "text-violet-400",
    description:
      "The undisputed king of cinematic, long-form video generation with absolute temporal consistency. Every frame, a masterpiece.",
    descriptionAr:
      "الملك الذي لا ينازع في توليد مقاطع الفيديو السينمائية الطويلة.",
    badge: "Up to 120s · 4K Resolution",
    badgeIcon: Clock,
    // gradient for the border glow
    borderGlow: "from-violet-500 via-purple-500 to-blue-500",
    glowColor: "rgba(139,92,246,0.35)",
    glowColorStrong: "rgba(139,92,246,0.6)",
    cardBg: "from-violet-950/60 via-slate-950/80 to-slate-950/90",
    accentBg: "bg-violet-500/10",
    accentRing: "ring-violet-500/25",
    accentText: "text-violet-300",
    accentFill: "from-violet-600/20 to-transparent",
    tag: "🎬",
    label: "King of Cinema",
    cta: "/video?model=kling-o3",
  },
  {
    id: "seedance",
    name: "Seedance 2.0",
    category: "Text & Image to Video",
    categoryAr: "نص وصورة إلى فيديو",
    icon: Zap,
    iconColor: "text-emerald-400",
    description:
      "Lightning-fast Text-to-Video and Image-to-Video engine. Hyper-realistic motion physics that blur the line between AI and reality.",
    descriptionAr:
      "محرك فائق السرعة لتحويل النص والصورة إلى فيديو بحركة خارقة الواقعية.",
    badge: "Zero Latency · Ultra-Smooth FPS",
    badgeIcon: Gauge,
    borderGlow: "from-emerald-400 via-teal-400 to-cyan-500",
    glowColor: "rgba(52,211,153,0.3)",
    glowColorStrong: "rgba(52,211,153,0.55)",
    cardBg: "from-emerald-950/60 via-slate-950/80 to-slate-950/90",
    accentBg: "bg-emerald-500/10",
    accentRing: "ring-emerald-500/25",
    accentText: "text-emerald-300",
    accentFill: "from-emerald-600/20 to-transparent",
    tag: "⚡",
    label: "Speed Daemon",
    cta: "/video?model=seedance-2",
  },
  {
    id: "nano",
    name: "Nano Banana Pro",
    category: "Image Generation",
    categoryAr: "توليد الصور",
    icon: ImageIcon,
    iconColor: "text-orange-400",
    description:
      "The ultimate image generator. Unprecedented detail, surgical prompt adherence, and dynamic lighting that feels physically real.",
    descriptionAr:
      "المولّد الأقوى للصور — تفاصيل غير مسبوقة وإضاءة تبدو حقيقية.",
    badge: "100M+ Parameters · Photorealism",
    badgeIcon: Star,
    borderGlow: "from-orange-400 via-rose-400 to-pink-500",
    glowColor: "rgba(251,146,60,0.3)",
    glowColorStrong: "rgba(251,146,60,0.55)",
    cardBg: "from-orange-950/50 via-slate-950/80 to-slate-950/90",
    accentBg: "bg-orange-500/10",
    accentRing: "ring-orange-500/25",
    accentText: "text-orange-300",
    accentFill: "from-orange-600/20 to-transparent",
    tag: "🍌",
    label: "Photo King",
    cta: "/image?model=nano-banana-pro",
  },
] as const;

// ─── Framer variants ───────────────────────────────────────────────────────────
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.05 } },
};

const headerVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" as const } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 60, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.65, ease: "easeOut" as const },
  },
};

// ─── 3-D Tilt Card ────────────────────────────────────────────────────────────
function TiltCard({
  model,
  index,
}: {
  model: (typeof POWERHOUSES)[number];
  index: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Raw motion values for pointer position
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  // Spring-smoothed versions
  const x = useSpring(rawX, { stiffness: 200, damping: 20 });
  const y = useSpring(rawY, { stiffness: 200, damping: 20 });

  // Map pointer offset → tilt degrees
  const rotateX = useTransform(y, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-8, 8]);

  // Map pointer offset → dynamic specular highlight shift
  const glareX = useTransform(x, [-0.5, 0.5], ["-20%", "120%"]);
  const glareY = useTransform(y, [-0.5, 0.5], ["-20%", "120%"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    rawX.set(nx);
    rawY.set(ny);
  };

  const handleMouseLeave = () => {
    rawX.set(0);
    rawY.set(0);
  };

  return (
    <motion.div
      variants={cardVariants}
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 1000,
      }}
      whileHover={{ z: 20 }}
      className="relative group cursor-pointer"
    >
      {/* ── Animated glow border ─────────────────────────────────────────── */}
      <motion.div
        className={cn(
          "absolute -inset-px rounded-2xl bg-gradient-to-br opacity-60 group-hover:opacity-100 transition-opacity duration-500 blur-sm",
          model.borderGlow
        )}
      />
      <motion.div
        className={cn(
          "absolute -inset-px rounded-2xl bg-gradient-to-br",
          model.borderGlow
        )}
        style={{ opacity: 0.4 }}
      />

      {/* ── Outer shadow pulse ───────────────────────────────────────────── */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        animate={{
          boxShadow: [
            `0 0 0px 0px ${model.glowColor}`,
            `0 0 40px 8px ${model.glowColorStrong}`,
            `0 0 0px 0px ${model.glowColor}`,
          ],
        }}
        transition={{
          duration: 3.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: index * 0.9,
        }}
      />

      {/* ── Card body ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "relative z-10 rounded-2xl bg-gradient-to-b p-6 xl:p-8",
          "bg-black/60 backdrop-blur-2xl border border-white/10",
          "flex flex-col gap-6 overflow-hidden"
        )}
      >
        {/* Dynamic glare highlight following mouse */}
        <motion.div
          className="pointer-events-none absolute -inset-1 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle 200px at ${glareX} ${glareY}, rgba(255,255,255,0.06), transparent 70%)`,
          }}
        />

        {/* Corner accent fill */}
        <div
          className={cn(
            "absolute top-0 right-0 h-40 w-40 rounded-bl-[80px] bg-gradient-to-b opacity-30",
            model.accentFill
          )}
        />

        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          {/* Icon + names */}
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ring-2 transition-all duration-300",
                model.accentBg,
                model.accentRing,
                "group-hover:scale-110 group-hover:ring-4"
              )}
            >
              <model.icon className={cn("h-7 w-7", model.iconColor)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">{model.tag}</span>
                <h3
                  className={cn(
                    "text-xl font-bold text-white",
                    montserrat.className
                  )}
                >
                  {model.name}
                </h3>
              </div>
              <p className={cn("text-xs font-semibold uppercase tracking-wider", model.accentText)}>
                {model.category}
              </p>
            </div>
          </div>

          {/* "King / Daemon / King" label pill */}
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ring-1",
              model.accentBg,
              model.accentRing,
              model.accentText
            )}
          >
            {model.label}
          </span>
        </div>

        {/* ── Description ─────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-base leading-relaxed text-zinc-300">
            {model.description}
          </p>
          <p className="text-xs leading-relaxed text-zinc-600" dir="rtl">
            {model.descriptionAr}
          </p>
        </div>

        {/* ── Stats badge ──────────────────────────────────────────────────── */}
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-4 py-3 ring-1",
            model.accentBg,
            model.accentRing
          )}
        >
          <model.badgeIcon className={cn("h-4 w-4 shrink-0", model.iconColor)} />
          <span className={cn("text-sm font-semibold", model.accentText)}>
            {model.badge}
          </span>
        </div>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <Link href={model.cta} className="mt-auto">
          <motion.div
            whileHover={{ x: 4 }}
            className={cn(
              "group/cta flex items-center justify-between rounded-xl px-5 py-3.5 text-sm font-semibold transition-all duration-300",
              "bg-gradient-to-r",
              model.borderGlow,
              "text-white shadow-lg hover:shadow-xl"
            )}
          >
            <span>Try {model.name}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-1" />
          </motion.div>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Marquee strip (model stats) ─────────────────────────────────────────────
const STRIP_ITEMS = [
  "🎬 Kling O3 · 120s Video",
  "⚡ Seedance 2.0 · Zero Latency",
  "🍌 Nano Banana Pro · 4K",
  "🏆 Industry-leading AI",
  "🎬 Kling O3 · 120s Video",
  "⚡ Seedance 2.0 · Zero Latency",
  "🍌 Nano Banana Pro · 4K",
  "🏆 Industry-leading AI",
];

// ─── Main Section ─────────────────────────────────────────────────────────────
export const PowerhouseSection = () => {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      {/* ── Background ambience ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0">
        {/* Left orb – violet */}
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-violet-700/12 blur-[100px]" />
        {/* Right orb – emerald */}
        <div className="absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-emerald-700/12 blur-[100px]" />
        {/* Center bottom – orange */}
        <div className="absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-orange-700/10 blur-[80px]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.1 }}
        >
          {/* ── Section Header ───────────────────────────────────────────── */}
          <motion.div
            variants={headerVariants}
            className="mx-auto mb-16 max-w-4xl text-center"
          >
            {/* Eyebrow */}
            <motion.div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-violet-300">
                Production Powerhouses · عمالقة الإنتاج
              </span>
            </motion.div>

            {/* Main headline */}
            <h2
              className={cn(
                "text-4xl font-extrabold leading-tight sm:text-5xl xl:text-6xl",
                montserrat.className
              )}
            >
              <span className="block text-white">Massive Production</span>
              <span className="block bg-gradient-to-r from-violet-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
                Scale.
              </span>
            </h2>

            {/* Glow under headline */}
            <div className="mx-auto mt-2 h-px w-32 bg-gradient-to-r from-transparent via-violet-400 to-transparent" />

            {/* Sub-headline */}
            <p className="mx-auto mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg">
              Powered by the industry&apos;s most aggressive AI models.
              <span className="block mt-1 text-sm text-zinc-600" dir="rtl">
                مدعومة بأعتى نماذج الذكاء الاصطناعي في الصناعة.
              </span>
            </p>

            {/* Live stat pills */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {[
                { value: "120s", label: "Max Video Length", color: "text-violet-300 ring-violet-500/25 bg-violet-500/10" },
                { value: "4K", label: "Native Resolution", color: "text-emerald-300 ring-emerald-500/25 bg-emerald-500/10" },
                { value: "100M+", label: "Model Parameters", color: "text-orange-300 ring-orange-500/25 bg-orange-500/10" },
              ].map((s) => (
                <div
                  key={s.label}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-4 py-2 ring-1 text-sm font-semibold",
                    s.color
                  )}
                >
                  <span className="text-base font-extrabold">{s.value}</span>
                  <span className="text-xs font-normal text-zinc-500">{s.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ── Cards Grid ──────────────────────────────────────────────── */}
          <div
            className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8"
            style={{ perspective: "1200px" }}
          >
            {POWERHOUSES.map((model, i) => (
              <TiltCard key={model.id} model={model} index={i} />
            ))}
          </div>

          {/* ── Bottom trust bar ─────────────────────────────────────────── */}
          <motion.div
            variants={headerVariants}
            className="mt-16 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <p className="text-sm text-zinc-600">
              All models available on every plan ·
            </p>
            <div className="flex items-center gap-2">
              {["Free", "Pro", "Enterprise"].map((plan) => (
                <span
                  key={plan}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-400"
                >
                  {plan}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* ── Scrolling ticker strip ───────────────────────────────────────── */}
      <div className="relative mt-20 overflow-hidden border-y border-white/[0.04] bg-white/[0.02] py-3">
        <motion.div
          className="flex gap-10 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        >
          {STRIP_ITEMS.concat(STRIP_ITEMS).map((item, i) => (
            <span
              key={i}
              className="text-xs font-semibold uppercase tracking-widest text-zinc-600"
            >
              {item}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default PowerhouseSection;
