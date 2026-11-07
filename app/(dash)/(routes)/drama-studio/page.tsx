"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Film,
  Sparkles,
  Clapperboard,
  Layers,
  ArrowRight,
  ArrowLeft,
  Users,
  Music,
  Tv,
  CheckCircle2,
  Compass,
  Play,
  Monitor,
  Flame,
} from "lucide-react";
import { useLanguage } from "@/lib/use-language";

const DRAMA_GENRES = [
  { id: "thriller", ar: "غموض وتشويق", en: "Mystery & Thriller", emoji: "🔍" },
  { id: "drama", ar: "دراما إنسانية", en: "Human Drama", emoji: "🎭" },
  { id: "scifi", ar: "خيال علمي", en: "Sci-Fi & Cyberpunk", emoji: "🚀" },
  { id: "comedy", ar: "كوميديا ساخرة", en: "Dark Comedy", emoji: "⚡" },
  { id: "action", ar: "أكشن سينمائي", en: "Cinematic Action", emoji: "🎬" },
  { id: "historical", ar: "تاريخي وملحمي", en: "Historical Epic", emoji: "⚔️" },
];

const DRAMA_PIPELINE_STEPS = [
  {
    step: "01",
    titleAr: "بناء القصة والشخصيات",
    titleEn: "Story & Characters",
    descAr: "تحديد الشخصيات، الملامح، البيئات، وملامح الحبكة عبر كل حلقة.",
    descEn: "Define character traits, environments, and story arcs across episodes.",
    icon: Users,
    color: "from-amber-500/20 to-amber-600/5 text-amber-400 border-amber-500/20",
  },
  {
    step: "02",
    titleAr: "هندسة الستوريبورد والمشاهد",
    titleEn: "Storyboard & Beats",
    descAr: "تقسيم الحلقات إلى لقطات متتابعة مع توجيه زوايا الكاميرا والإضاءة.",
    descEn: "Break down episodes into visual boards with precise framing and lighting.",
    icon: Clapperboard,
    color: "from-rose-500/20 to-rose-600/5 text-rose-400 border-rose-500/20",
  },
  {
    step: "03",
    titleAr: "التوليد السينمائي متعدد المسارات",
    titleEn: "Multi-Track Video Production",
    descAr: "توليد مشاهد الفيديو بأحدث نماذج الذكاء الاصطناعي مع الحفاظ على ثبات الشخصيات.",
    descEn: "Generate cinematic takes with consistent identity across consecutive scenes.",
    icon: Film,
    color: "from-cyan-500/20 to-cyan-600/5 text-cyan-400 border-cyan-500/20",
  },
  {
    step: "04",
    titleAr: "التنسيق الصوتي والمونتاج النهائي",
    titleEn: "Audio & Final Assembly",
    descAr: "إضافة الحوار، الدبلجة، المؤثرات الصوتية والموسيقى التصويرية في حلقة متكاملة.",
    descEn: "Orchestrate dialogue, Foley SFX, and score into broadcast-ready episodes.",
    icon: Music,
    color: "from-emerald-500/20 to-emerald-600/5 text-emerald-400 border-emerald-500/20",
  },
];

export default function DramaStudioPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const isRTL = lang === "ar";
  const [storyIdea, setStoryIdea] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("thriller");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");

  const handleStartPlanning = (e: React.FormEvent) => {
    e.preventDefault();
    const query = new URLSearchParams();
    if (storyIdea.trim()) query.set("prompt", storyIdea.trim());
    query.set("genre", selectedGenre);
    query.set("ratio", aspectRatio);
    query.set("type", "short-drama");
    router.push(`/storyboard?${query.toString()}`);
  };

  return (
    <div className={`min-h-screen bg-[#07090f] text-zinc-100 pb-20 ${isRTL ? "rtl" : "ltr"}`}>
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-amber-500/10 via-rose-500/5 to-transparent blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16">
        {/* Header Badge */}
        <div className="flex flex-col items-center text-center space-y-4">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold tracking-wide shadow-inner shadow-amber-500/10"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>{isRTL ? "استوديو صناعة المسلسلات والدراما التفاعلية" : "AI Drama Studio & Microdrama Suite"}</span>
            <span className="px-1.5 py-0.5 rounded-md bg-amber-400 text-black text-[10px] font-black uppercase">NEW</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-zinc-200 to-zinc-400 leading-tight max-w-3xl"
          >
            {isRTL
              ? "إنتاج مسلسلات قصيرة وسيناريوهات درامية بالذكاء الاصطناعي"
              : "Produce AI Microdrama Series & Cinematic Screenplays"}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-sm sm:text-base text-zinc-400 max-w-2xl leading-relaxed"
          >
            {isRTL
              ? "صمم مسلسلك القصير حلقة بحلقة، حافظ على ثبات الشخصيات عبر كافة المشاهد، وادمج السرد السينمائي مع هندسة الصوت المتطورة من منصة واحدة."
              : "Craft viral vertical microdramas, maintain character consistency across consecutive scenes, and produce broadcast-ready multi-episode productions."}
          </motion.p>
        </div>

        {/* Story Composer Box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-10 bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-xl rounded-2xl p-5 sm:p-7 shadow-2xl shadow-black/60 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <form onSubmit={handleStartPlanning} className="space-y-6 relative z-10">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2">
                {isRTL ? "فكرة المسلسل أو القصة الدرامية" : "Drama Concept or Story Prompt"}
              </label>
              <textarea
                value={storyIdea}
                onChange={(e) => setStoryIdea(e.target.value)}
                placeholder={
                  isRTL
                    ? "مثال: مسلسل تشويق قصير من 3 حلقات عن محقق يكتشف أدلة غامضة في برج مهجور، مع تقلبات غير متوقعة في اللحظات الأخيرة..."
                    : "e.g., A 3-episode suspense microdrama about an investigator uncovering cryptic secrets in a neon-lit cyberpunk city with a shocking finale..."
                }
                rows={3}
                className="w-full bg-zinc-950/70 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition-all resize-none"
              />
            </div>

            {/* Genre Pills */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5">
                {isRTL ? "التصنيف الدرامي" : "Story Genre"}
              </span>
              <div className="flex flex-wrap gap-2">
                {DRAMA_GENRES.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGenre(g.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                      selectedGenre === g.id
                        ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20"
                        : "bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/50"
                    }`}
                  >
                    <span>{g.emoji}</span>
                    <span>{isRTL ? g.ar : g.en}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio & Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-zinc-800/60">
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400 font-medium">
                  {isRTL ? "أبعاد الفيديو:" : "Format:"}
                </span>
                <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setAspectRatio("9:16")}
                    className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                      aspectRatio === "9:16"
                        ? "bg-amber-500 text-black"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    9:16 {isRTL ? "(عمودي ريلز)" : "(Vertical)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAspectRatio("16:9")}
                    className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                      aspectRatio === "16:9"
                        ? "bg-amber-500 text-black"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    16:9 {isRTL ? "(سينمائي شاشة)" : "(Widescreen)"}
                  </button>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-rose-500 hover:opacity-95 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-transform active:scale-95"
              >
                <span>{isRTL ? "بدء التخطيط والإنتاج السينمائي" : "Start Drama Production"}</span>
                {isRTL ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </motion.div>

        {/* Quick Launch Hubs */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/storyboard"
            className="group block p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-amber-500/30 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <Clapperboard className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-200 group-hover:text-amber-400 transition-colors">
                  {isRTL ? "استوديو الستوريبورد" : "Storyboard Studio"}
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {isRTL ? "تصميم وتوليد لوحات المشاهد للدراما" : "Generate multi-panel drama storyboards"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/video"
            className="group block p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-cyan-500/30 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-200 group-hover:text-cyan-400 transition-colors">
                  {isRTL ? "استوديو الفيديو السينمائي" : "Cinema Video Studio"}
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {isRTL ? "توليد المشاهد بنماذج Kling و Hailuo و Veo" : "Generate takes with Kling, Hailuo & Veo"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/canvas"
            className="group block p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-purple-500/30 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                <Monitor className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-200 group-hover:text-purple-400 transition-colors">
                  {isRTL ? "لوحة العمل الإبداعية" : "AI Creative Canvas"}
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {isRTL ? "ربط المشاهد ومسارات العمل البصرية" : "Connect nodes, visual flow & character references"}
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Drama Production Pipeline Steps */}
        <div className="mt-16">
          <div className="text-center mb-8">
            <h2 className="text-lg sm:text-2xl font-extrabold text-zinc-200">
              {isRTL ? "منهجية الإنتاج المتكاملة في Drama Studio" : "Full Drama Production Pipeline"}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-500 mt-1">
              {isRTL ? "أربع مراحل متسلسلة لتحويل النص إلى عمل درامي كامل" : "Four integrated stages from scriptwriting to final assemble"}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {DRAMA_PIPELINE_STEPS.map((step) => {
              const IconComponent = step.icon;
              return (
                <div
                  key={step.step}
                  className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/70 relative overflow-hidden"
                >
                  <div className="text-[10px] font-black tracking-widest text-zinc-500 uppercase mb-3">
                    STAGE {step.step}
                  </div>
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${step.color} border flex items-center justify-center mb-3`}>
                    <IconComponent className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-200 mb-1.5">
                    {isRTL ? step.titleAr : step.titleEn}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {isRTL ? step.descAr : step.descEn}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
