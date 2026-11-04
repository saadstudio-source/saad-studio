"use client";

import Link from "next/link";
import { ArrowUpRight, Bot, Film, GitBranch, Layers3, Move3d, Sparkles } from "lucide-react";

type ToolCard = {
  title: string;
  arabic: string;
  description: string;
  icon: typeof Film;
  href?: string;
  status: "ready" | "catalog" | "planned";
  accent: string;
};

const tools: ToolCard[] = [
  {
    title: "Video Edit",
    arabic: "تحرير الفيديو بالذكاء الاصطناعي",
    description: "ارفع فيديو واكتب التعديل المطلوب. المسار الحالي يستخدم عقد Kling 4.0 Video Edit.",
    icon: Sparkles,
    href: "/video-edit",
    status: "ready",
    accent: "from-cyan-400/25 to-blue-500/5",
  },
  {
    title: "Video Extend",
    arabic: "تمديد الفيديو",
    description: "أكمل اللقطة من آخر إطار مع اختيار مدة التمديد وموديل الفيديو المناسب.",
    icon: Film,
    href: "/video-extend",
    status: "ready",
    accent: "from-violet-400/25 to-fuchsia-500/5",
  },
  {
    title: "Motion Transfer",
    arabic: "نقل الحركة",
    description: "Kling 2.6 Motion Control: صورة شخصية + فيديو حركة، اتجاه الشخصية، prompt اختياري وحفظ الصوت الأصلي.",
    icon: Move3d,
    href: "/video-tools/motion-transfer",
    status: "ready",
    accent: "from-amber-400/25 to-orange-500/5",
  },
  {
    title: "Object Swap",
    arabic: "استبدال العناصر",
    description: "OpenJutsu Object Swap: فيديو + target + change_to أو صورة مرجعية، مع 480p/540p/768p/1080p ومدى فوترة 3–15 ثانية.",
    icon: Layers3,
    href: "/video-tools/object-swap",
    status: "ready",
    accent: "from-emerald-400/25 to-teal-500/5",
  },
  {
    title: "WaveSpeed MCP",
    arabic: "كتالوج النماذج الذكي",
    description: "اكتشاف النماذج وقراءة schema والأسعار من الخادم قبل اعتمادها في سجل المنصة.",
    icon: Bot,
    href: "/admin/models",
    status: "catalog",
    accent: "from-pink-400/25 to-purple-500/5",
  },
  {
    title: "Video Upscaler",
    arabic: "رفع دقة الفيديو",
    description: "WaveSpeed Video Upscaler يرفع الفيديو إلى 720p أو 1080p أو 2K أو 4K حتى 10 دقائق.",
    icon: Film,
    href: "/video-tools/video-upscaler",
    status: "ready",
    accent: "from-sky-400/25 to-blue-500/5",
  },
];

const labels = {
  ready: "متاح الآن",
  catalog: "إدارة الكتالوج",
  planned: "قيد ربط مزود الخدمة",
} as const;

export default function VideoToolsPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-8 text-white md:px-10 lg:px-14">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">
              <GitBranch className="h-4 w-4" /> Creative tools
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Video tools</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              أدوات مستقلة للتحرير والتمديد ونقل الحركة وإدارة كتالوج WaveSpeed، بنفس نظام الأصول والرصيد الموجود في المنصة.
            </p>
          </div>
          <Link href="/video" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200 transition hover:border-cyan-400/40 hover:bg-cyan-400/10">
            العودة إلى Video <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const body = (
              <div className={`group relative flex min-h-[250px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${tool.accent} p-6 transition hover:-translate-y-0.5 hover:border-cyan-300/40`}>
                <div className="flex items-start justify-between">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-cyan-200"><Icon className="h-5 w-5" /></div>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${tool.status === "ready" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : tool.status === "catalog" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-200" : "border-amber-300/20 bg-amber-300/10 text-amber-200"}`}>{labels[tool.status]}</span>
                </div>
                <div className="mt-auto">
                  <h2 className="text-xl font-semibold">{tool.title}</h2>
                  <p className="mt-1 text-sm text-cyan-100/80">{tool.arabic}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{tool.description}</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-white/80">
                    {tool.href ? "فتح الأداة" : "سيظهر بعد تثبيت endpoint رسمي"} {tool.href && <ArrowUpRight className="h-3.5 w-3.5" />}
                  </div>
                </div>
              </div>
            );
            return tool.href ? <Link key={tool.title} href={tool.href}>{body}</Link> : <div key={tool.title}>{body}</div>;
          })}
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-cyan-300/10 p-3 text-cyan-200"><Bot className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold">كيف يعمل MCP هنا؟</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يعمل على الخادم فقط: يبحث في الكتالوج الحي، يقرأ schema والسعر، يقارنها بسجل المنصة، ثم ينتظر اعتماد المدير قبل تفعيل أي موديل مدفوع. لا يتم إرسال مفتاح WaveSpeed إلى المتصفح.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
