import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Clock3, Download, Music2, Sparkles } from "lucide-react";

import { verifyPreviewToken, type PreviewData } from "@/lib/smart-cli-preview";

// Branded Saad Studio page for media generated through an AI agent (Claude,
// ChatGPT, Gemini…). The link is signed (lib/smart-cli-preview.ts), so the page
// is public but cannot be forged or enumerated, and it expires after 30 days.

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<PreviewData["kind"], string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

export function generateMetadata({ params }: { params: { token: string } }): Metadata {
  const data = verifyPreviewToken(params.token);
  const base: Metadata = {
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
  if (!data) return { ...base, title: "Preview unavailable | Saad Studio" };

  const title = `${KIND_LABEL[data.kind]} made with Saad Studio`;
  const description = data.prompt ?? "Generated with Saad Studio.";
  return {
    ...base,
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Saad Studio",
      type: data.kind === "video" ? "video.other" : "website",
      images: data.kind === "image" ? data.urls.slice(0, 1).map((url) => ({ url })) : undefined,
    },
    twitter: { card: data.kind === "image" ? "summary_large_image" : "summary", title, description },
  };
}

function Brand() {
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href="/explore" className="flex items-center gap-3">
        <Image src="/logo-saad-transparent.png?v=3" alt="Saad Studio" width={36} height={36} className="h-9 w-9 object-contain" priority />
        <span className="font-display text-lg tracking-wide text-white">Saad Studio</span>
      </Link>
      <Link
        href="/explore"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Create your own
        <ArrowUpRight className="h-4 w-4 text-cyan-300" />
      </Link>
    </header>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">{children}</span>;
}

function Media({ data }: { data: PreviewData }) {
  if (data.kind === "video") {
    return (
      <div className="grid gap-3">
        {data.urls.map((url) => (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={url} src={url} controls playsInline preload="metadata" className="w-full rounded-2xl border border-white/10 bg-black" />
        ))}
      </div>
    );
  }

  if (data.kind === "audio") {
    return (
      <div className="grid gap-3">
        {data.urls.map((url) => (
          <div key={url} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-600/10 p-6">
            <div className="flex items-center gap-3 text-cyan-200">
              <Music2 className="h-6 w-6" />
              <span className="text-sm font-semibold">Audio</span>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={url} controls preload="metadata" className="w-full" />
          </div>
        ))}
      </div>
    );
  }

  const single = data.urls.length === 1;
  return (
    <div className={single ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
      {data.urls.map((url, index) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={data.prompt ?? `Generated image ${index + 1}`} loading={index === 0 ? "eager" : "lazy"} className="h-auto w-full object-contain transition duration-300 group-hover:scale-[1.01]" />
          {!single && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">{index + 1}</span>}
        </a>
      ))}
    </div>
  );
}

export default function PreviewPage({ params }: { params: { token: string } }) {
  const data = verifyPreviewToken(params.token);

  if (!data) {
    return (
      <main className="min-h-screen bg-[#060c18] px-4 py-8 text-white md:px-8">
        <div className="mx-auto max-w-3xl">
          <Brand />
          <div className="mt-16 rounded-2xl border border-white/10 bg-[#0c111b] p-10 text-center">
            <h1 className="text-2xl font-black">This preview is unavailable</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">The link is invalid or has expired. Ask your AI assistant to generate it again, or open Saad Studio to find it in your history.</p>
            <Link href="/explore" className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 text-sm font-bold text-white transition hover:brightness-110">
              Open Saad Studio
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const expires = new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const first = data.urls[0];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_30%),#060c18] px-4 py-8 text-white md:px-8">
      <div className="mx-auto max-w-4xl">
        <Brand />

        <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-[#0c111b]/90 shadow-2xl shadow-black/40">
          <div className="p-4 md:p-6">
            <Media data={data} />
          </div>

          <div className="border-t border-white/10 p-5 md:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{KIND_LABEL[data.kind]}</Badge>
              {data.model && <Badge>{data.model}</Badge>}
              {data.aspectRatio && <Badge>{data.aspectRatio}</Badge>}
              {data.durationSec ? <Badge>{data.durationSec}s</Badge> : null}
            </div>

            {data.prompt && <p className="mt-4 text-sm leading-7 text-slate-300">{data.prompt}</p>}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href={first}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Download className="h-4 w-4 text-cyan-300" />
                {data.kind === "image" ? "Open original" : "Open file"}
              </a>
              <Link
                href="/explore"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
              >
                <Sparkles className="h-4 w-4" />
                Create with Saad Studio
              </Link>
            </div>
          </div>
        </section>

        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Clock3 className="h-3.5 w-3.5" />
          Generated with Saad Studio through your AI assistant · link valid until {expires}
        </p>
      </div>
    </main>
  );
}
