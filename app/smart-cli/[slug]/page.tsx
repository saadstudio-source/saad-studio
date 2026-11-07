import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, ExternalLink } from "lucide-react";

import TopNavbar from "@/components/TopNavbar";
import CopyButton from "@/components/smart-cli/CopyButton";
import {
  SMART_CLI_CONNECTOR_NAME,
  SMART_CLI_CONNECT_LINK,
  SMART_CLI_MCP_URL,
  SMART_CLI_PRESETS,
  claudeTryUrl,
  getPreset,
  isClientTabId,
} from "@/lib/smart-cli-presets";

export const dynamicParams = false;

export function generateStaticParams() {
  return SMART_CLI_PRESETS.map((preset) => ({ slug: preset.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const preset = getPreset(params.slug);
  if (!preset) return {};
  return { title: `${preset.title} | Smart CLI`, description: preset.description };
}

export default function SmartCliPresetPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { tab?: string };
}) {
  const preset = getPreset(params.slug);
  if (!preset) notFound();

  const tab = isClientTabId(searchParams.tab) ? searchParams.tab : "claude";
  const related = preset.related
    .map((slug) => getPreset(slug))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <>
      <TopNavbar />
      <main className="min-h-screen bg-[#05070b] pt-14 text-white">
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <Link href={`/smart-cli?tab=${tab}`} className="hover:text-white">
              Presets
            </Link>
            <span>/</span>
            <span className="text-white">{preset.title}</span>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div>
              <div className="rounded-xl border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.14),transparent_40%),#0c111b] p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-200">{preset.category}</span>
                  {preset.tools.map((tool) => (
                    <span key={tool} className="rounded-md bg-white/10 px-2 py-1 font-mono text-xs text-slate-300">
                      {tool}
                    </span>
                  ))}
                </div>
                <p className="mt-6 text-sm leading-7 text-slate-300">
                  Calls {preset.tools.length === 1 ? "this tool" : "these tools"} in order through the {SMART_CLI_CONNECTOR_NAME} connector, using your account credits.
                </p>
              </div>

              <section className="mt-10">
                <h2 className="text-xl font-black">Start in 3 steps</h2>
                <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-[#0c111b]">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white">1. Copy the {SMART_CLI_CONNECTOR_NAME} connector URL</h3>
                      <p className="mt-1 text-sm text-slate-400">You will paste this URL into Claude in the next step.</p>
                    </div>
                    <CopyButton
                      value={SMART_CLI_MCP_URL}
                      copiedLabel="URL copied"
                      className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white hover:bg-white/10"
                    >
                      Copy connector URL
                    </CopyButton>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white">2. Connect {SMART_CLI_CONNECTOR_NAME} in Claude</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Open Customize → Connectors, add a custom connector named {SMART_CLI_CONNECTOR_NAME}, paste the URL, and sign in.
                      </p>
                    </div>
                    <a
                      href={SMART_CLI_CONNECT_LINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      Open Claude settings
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white">3. Run your first prompt</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Copy the example prompt into a new Claude chat with {SMART_CLI_CONNECTOR_NAME} enabled. Adapt it to your brief and attach any references before sending it.
                      </p>
                    </div>
                    <CopyButton
                      value={preset.prompt}
                      copiedLabel="Prompt copied"
                      className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white hover:bg-white/10"
                    >
                      Copy prompt
                    </CopyButton>
                  </div>
                </div>
              </section>
            </div>

            <aside className="h-fit rounded-xl border border-white/10 bg-[#0c111b] p-6 lg:sticky lg:top-20">
              <h1 className="text-3xl font-black uppercase leading-tight">{preset.title}</h1>
              <p className="mt-4 text-sm leading-6 text-slate-400">{preset.description}</p>
              <div className="mt-5 rounded-lg border border-white/10 bg-black/40 p-4">
                <p className="whitespace-pre-line text-sm leading-6 text-slate-200">{preset.prompt}</p>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <a
                  href={claudeTryUrl(preset.prompt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Try in Claude
                  <ArrowUpRight className="h-4 w-4" />
                </a>
                <CopyButton
                  value={preset.prompt}
                  copiedLabel=""
                  aria-label="Copy prompt"
                  className="h-11 w-11 rounded-lg border border-white/10 bg-white/[0.06] text-white hover:bg-white/10"
                />
              </div>
            </aside>
          </div>

          {related.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xl font-black">Recommended presets</h2>
              <p className="mt-1 text-sm text-slate-400">Explore related workflows for your next project.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {related.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/smart-cli/${item.slug}?tab=${tab}`}
                    className="rounded-lg border border-white/10 bg-[#0c111b] p-5 transition hover:border-cyan-300/40"
                  >
                    <h3 className="font-bold text-white">{item.title}</h3>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-400">{item.description}</p>
                    <span className="mt-3 inline-block rounded-md bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-200">{item.category}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
