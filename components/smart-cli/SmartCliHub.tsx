"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Coins,
  Command,
  ExternalLink,
  Film,
  Gauge,
  Globe2,
  Image as ImageIcon,
  Images,
  Languages,
  Layers,
  Layers3,
  MessageCircle,
  Mic,
  Music,
  PlaySquare,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Type,
  Upload,
  User,
  Wrench,
  X,
} from "lucide-react";

import TopNavbar from "@/components/TopNavbar";
import CopyButton from "@/components/smart-cli/CopyButton";
import { cn } from "@/lib/utils";
import {
  CLAUDE_CODE_AGENT_PROMPT,
  CLAUDE_CODE_COMMAND,
  CONNECT_GUIDES,
  OTHER_GUIDE_IDS,
  PRESET_CATEGORIES,
  SMART_CLI_AGENT_SETUP_PROMPT,
  SMART_CLI_CONNECT_LINK,
  SMART_CLI_CHATGPT_MCP_URL,
  SMART_CLI_MCP_URL,
  SMART_CLI_PRESETS,
  chatgptTryUrl,
  claudeTryUrl,
  isClientTabId,
  getPreset,
  type ClientTabId,
  type GuideStep,
  type PresetCategory,
} from "@/lib/smart-cli-presets";

type GuideGroup = "claude" | "chatgpt" | "other";

interface ClientTab {
  id: ClientTabId;
  label: string;
  icon: typeof MessageCircle;
  disabled?: boolean;
  badge?: string;
}

const CLIENT_TABS: ClientTab[] = [
  { id: "claude", label: "Claude", icon: MessageCircle },
  { id: "claude-code", label: "Claude Code", icon: Terminal },
  { id: "chatgpt", label: "ChatGPT", icon: Sparkles },
  { id: "cli", label: "CLI", icon: Terminal },
  { id: "other", label: "Other", icon: Globe2 },
];

const HERO_TARGET: Record<ClientTabId, string> = {
  claude: "Claude",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  cli: "your agent",
  other: "your agent",
};

// Mirrors the tools actually wired in app/api/smart-cli/mcp/route.ts and
// lib/smart-cli-extra-tools.ts (same grouping Claude shows in Tool permissions).
// If you add or remove a tool there, update this list.
const TOOL_GROUPS = [
  {
    title: "Create",
    note: "Spend credits — Claude asks for your approval first.",
    tools: [
      { icon: ImageIcon, title: "generate_image", text: "Generate an image with model, aspect ratio and resolution control." },
      { icon: Layers, title: "generate_storyboard", text: "Several concept variations from one idea, to pick before rendering." },
      { icon: PlaySquare, title: "generate_video", text: "Render a video from a prompt, optionally from a chosen first frame." },
      { icon: Music, title: "generate_music", text: "Generate a music track (30 s clip or up to 5 min), with or without vocals." },
      { icon: Mic, title: "text_to_speech", text: "Turn a script into multilingual speech with a choice of voices." },
      { icon: Film, title: "post_produce_video", text: "Captions, reframe, dubbing, transcription or auto-clips on an existing video." },
    ],
  },
  {
    title: "Read-only",
    note: "Never spend credits or change anything.",
    tools: [
      { icon: Layers3, title: "list_models", text: "Available image and video models with their capabilities." },
      { icon: Images, title: "show_generations", text: "Your recent images, videos and audio, to reuse or review." },
      { icon: Coins, title: "check_balance", text: "Your current credit balance." },
      { icon: User, title: "get_account", text: "Name, balance and subscription status." },
      { icon: Gauge, title: "quote_generation", text: "Exact credit price of an image or video before you generate it." },
      { icon: Activity, title: "get_job_status", text: "Progress and result of a generation by id." },
      { icon: Activity, title: "get_post_production_status", text: "Progress and final file of a post-production job." },
      { icon: Languages, title: "list_dubbing_languages", text: "Languages a video can be dubbed into." },
      { icon: Languages, title: "list_translation_languages", text: "Languages supported for caption and transcript translation." },
      { icon: Type, title: "list_caption_presets", text: "Caption styles available for post-production." },
    ],
  },
  {
    title: "Files & cleanup",
    note: "Upload local files; delete only when you explicitly ask.",
    tools: [
      { icon: Upload, title: "create_upload_url", text: "One-time signed URL to upload a local image, video or audio file." },
      { icon: Trash2, title: "delete_generation", text: "Permanently delete one of your generations by id." },
    ],
  },
];

const TOOL_COUNT = TOOL_GROUPS.reduce((total, group) => total + group.tools.length, 0);

// "Try in …" deep links only exist where a prompt can be pre-filled in a web chat.
function getTryLink(tab: ClientTabId, prompt: string): { href: string; label: string } | null {
  if (tab === "claude") return { href: claudeTryUrl(prompt), label: "Try in Claude" };
  if (tab === "chatgpt") return { href: chatgptTryUrl(prompt), label: "Try in ChatGPT" };
  return null;
}

const EXAMPLE_SLUGS =["cinematic-image", "concept-to-video", "image-to-video", "reuse-a-frame"];
const EXAMPLES = EXAMPLE_SLUGS.map((slug) => getPreset(slug)).filter((preset): preset is NonNullable<typeof preset> => Boolean(preset));

function StepBody({ step }: { step: GuideStep }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="font-bold text-white">{step.title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-400">{step.text}</p>
      {step.copy && step.block && (
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/45 p-3 pr-20 font-mono text-xs leading-5 text-slate-200">{step.copy}</pre>
          <CopyButton
            value={step.copy}
            copiedLabel="Copied"
            className="absolute right-2 top-2 h-7 rounded-md border border-white/10 bg-white/[0.08] px-2.5 text-xs font-semibold text-white hover:bg-white/15"
          >
            Copy
          </CopyButton>
        </div>
      )}
      {step.copy && !step.block && (
        <CopyButton
          value={step.copy}
          copiedLabel="Copied"
          className="mt-3 h-10 w-full justify-between rounded-md border border-white/10 bg-black/45 px-3 text-left font-mono text-xs text-slate-200 hover:border-cyan-300/60"
        >
          <span className="truncate">{step.copy}</span>
        </CopyButton>
      )}
      {step.link && (
        <a
          href={step.link.href}
          target={step.link.href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
        >
          {step.link.label}
          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
        </a>
      )}
    </div>
  );
}

function HowToConnectDialog({ group, onClose }: { group: GuideGroup | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [otherId, setOtherId] = useState<(typeof OTHER_GUIDE_IDS)[number]>(OTHER_GUIDE_IDS[0]);
  const open = group !== null;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!group) return null;

  const guide = group === "other" ? CONNECT_GUIDES[otherId] : CONNECT_GUIDES[group];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-cli-howto-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0c111b] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          {group === "other" ? (
            <div role="tablist" aria-label="Client" className="flex flex-wrap gap-2">
              {OTHER_GUIDE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={otherId === id}
                  onClick={() => setOtherId(id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
                    otherId === id ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10",
                  )}
                >
                  {CONNECT_GUIDES[id].label}
                </button>
              ))}
            </div>
          ) : (
            <h2 id="smart-cli-howto-title" className="text-xl font-black text-white">
              {guide.title}
            </h2>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {group === "other" && (
          <h2 id="smart-cli-howto-title" className="mt-5 text-xl font-black text-white">
            {guide.title}
          </h2>
        )}

        <ol className="mt-6 space-y-6">
          {guide.steps.map((step, index) => (
            <li key={`${guide.id}-${index}`} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">
                {index + 1}
              </span>
              <StepBody step={step} />
            </li>
          ))}
        </ol>

        {guide.note && <p className="mt-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">{guide.note}</p>}
      </div>
    </div>
  );
}

function ExamplesPanel({ tab }: { tab: ClientTabId }) {
  const [activeSlug, setActiveSlug] = useState(EXAMPLES[0]?.slug ?? "");
  const [expanded, setExpanded] = useState(false);
  const preset = EXAMPLES.find((example) => example.slug === activeSlug) ?? EXAMPLES[0];
  if (!preset) return null;

  const tryLink = getTryLink(tab, preset.prompt);

  return (
    <div className="mx-auto mt-6 max-w-5xl rounded-xl border border-white/10 bg-[#101318] p-5 shadow-2xl shadow-black/30">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Example prompts">
        {EXAMPLES.map((example) => (
          <button
            key={example.slug}
            type="button"
            role="tab"
            aria-selected={example.slug === preset.slug}
            onClick={() => {
              setActiveSlug(example.slug);
              setExpanded(false);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
              example.slug === preset.slug
                ? "border-white bg-white text-black"
                : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10",
            )}
          >
            {example.title}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/40 p-4">
        <p className={cn("whitespace-pre-line text-sm leading-7 text-slate-200", !expanded && "line-clamp-3")}>{preset.prompt}</p>
        {preset.prompt.length > 160 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {preset.tools.map((tool) => (
            <span key={tool} className="rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] text-slate-300">
              {tool}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tryLink && (
          <a
            href={tryLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-sm font-bold text-white transition hover:brightness-110"
          >
            {tryLink.label}
            <ArrowUpRight className="h-4 w-4" />
          </a>
        )}
        <CopyButton
          value={preset.prompt}
          copiedLabel="Prompt copied"
          className="h-11 rounded-lg border border-white/10 bg-white/[0.05] px-5 text-sm font-semibold text-white hover:bg-white/10"
        >
          Copy prompt
        </CopyButton>
      </div>
    </div>
  );
}

function PresetCatalog({ tab }: { tab: ClientTabId }) {
  const [category, setCategory] = useState<"Popular" | PresetCategory>("Popular");
  const visible = category === "Popular" ? SMART_CLI_PRESETS : SMART_CLI_PRESETS.filter((preset) => preset.category === category);

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <div className="mb-5">
        <h2 className="text-2xl font-black">Discover what you can create</h2>
        <p className="mt-1 text-sm text-slate-400">Ready-made workflows built on the Smart CLI tools. Open one to see the steps and the exact prompt.</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Preset categories">
        {(["Popular", ...PRESET_CATEGORIES] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            onClick={() => setCategory(item)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
              category === item ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((preset) => {
          const tryLink = getTryLink(tab, preset.prompt);
          return (
          <div key={preset.slug} className="flex flex-col rounded-lg border border-white/10 bg-[#0c111b] p-5 transition hover:border-cyan-300/40">
            <Link href={`/smart-cli/${preset.slug}?tab=${tab}`} className="block flex-1">
              <h3 className="text-base font-bold text-white">{preset.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{preset.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-md bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-200">{preset.category}</span>
                {preset.tools.map((tool) => (
                  <span key={tool} className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                    {tool}
                  </span>
                ))}
              </div>
            </Link>
            <div className="mt-4 flex items-center gap-3">
              {tryLink && (
                <a
                  href={tryLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  {tryLink.label}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
              <Link href={`/smart-cli/${preset.slug}?tab=${tab}`} className="text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                Learn more
              </Link>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

export default function SmartCliHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [guideGroup, setGuideGroup] = useState<GuideGroup | null>(null);

  const tabParam = searchParams.get("tab");
  const requested = CLIENT_TABS.find((tab) => tab.id === tabParam);
  const activeTab = requested && !requested.disabled && isClientTabId(tabParam) ? requested : CLIENT_TABS[0];

  const selectTab = useCallback(
    (id: ClientTabId) => {
      router.replace(`${pathname}?tab=${id}`, { scroll: false });
    },
    [router, pathname],
  );

  const closeGuide = useCallback(() => setGuideGroup(null), []);

  return (
    <>
      <TopNavbar />
      <main className="min-h-screen bg-[#05070b] pt-14 text-white">
        <section className="border-b border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#07111f,#05070b)]">
          <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
            <div className="flex items-center justify-between gap-4">
              <Link href="/apps" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
                Back to Apps
              </Link>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Hosted MCP endpoint
              </div>
            </div>

            <div className="mx-auto mt-8 flex max-w-5xl justify-center">
              <div role="tablist" aria-label="Client" className="inline-flex flex-wrap justify-center rounded-full border border-white/10 bg-white/[0.06] p-1">
                {CLIENT_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = tab.id === activeTab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => !tab.disabled && selectTab(tab.id)}
                      disabled={tab.disabled}
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition",
                        isActive ? "bg-white text-black" : tab.disabled ? "cursor-not-allowed text-slate-500" : "text-slate-200 hover:bg-white/10",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                      {tab.badge && (
                        <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mx-auto max-w-4xl py-12 text-center">
              <h1 className="text-balance text-4xl font-black uppercase leading-tight tracking-normal md:text-6xl">
                Generate images &amp; videos
                <br />
                in <span className="text-cyan-300">{HERO_TARGET[activeTab.id]}</span> with Saad Studio
              </h1>

              {(activeTab.id === "claude" || activeTab.id === "chatgpt") && (
                <>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    {activeTab.id === "claude" ? (
                      <a
                        href={SMART_CLI_CONNECT_LINK}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
                      >
                        <Command className="h-4 w-4" />
                        Connect Saad Studio
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setGuideGroup("chatgpt")}
                        className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
                      >
                        <Command className="h-4 w-4" />
                        Add Saad Studio in ChatGPT
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setGuideGroup(activeTab.id === "claude" ? "claude" : "chatgpt")}
                      className="inline-flex h-12 items-center rounded-xl border border-white/10 bg-white/[0.06] px-6 text-sm font-bold text-white transition hover:bg-white/10"
                    >
                      How to connect?
                    </button>
                  </div>
                  <CopyButton
                    value={activeTab.id === "chatgpt" ? SMART_CLI_CHATGPT_MCP_URL : SMART_CLI_MCP_URL}
                    copiedLabel="URL copied"
                    aria-label="Copy connector URL"
                    className="mx-auto mt-4 rounded-md px-2 py-1 font-mono text-xs text-slate-500 hover:text-slate-200"
                  >
                    {activeTab.id === "chatgpt" ? SMART_CLI_CHATGPT_MCP_URL : SMART_CLI_MCP_URL}
                  </CopyButton>
                </>
              )}

              {activeTab.id === "claude-code" && (
                <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-white/10 bg-[#101318] p-5 text-left shadow-2xl shadow-black/30">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-white">Copy and send this to Claude Code</h2>
                    <CopyButton
                      value={CLAUDE_CODE_AGENT_PROMPT}
                      copiedLabel="Copied"
                      className="h-8 rounded-md border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      Copy
                    </CopyButton>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/45 p-4 font-mono text-xs leading-6 text-slate-300">
                    {CLAUDE_CODE_AGENT_PROMPT}
                  </pre>
                  <p className="mt-4 text-xs text-slate-500">Or run it yourself in your terminal, then sign in from /mcp:</p>
                  <CopyButton
                    value={CLAUDE_CODE_COMMAND}
                    copiedLabel="Command copied"
                    className="mt-2 h-10 w-full justify-between rounded-md border border-white/10 bg-black/45 px-3 text-left font-mono text-xs text-slate-200 hover:border-cyan-300/60"
                  >
                    <span className="truncate">{CLAUDE_CODE_COMMAND}</span>
                  </CopyButton>
                </div>
              )}

              {activeTab.id === "cli" && (
                <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-white/10 bg-[#101318] p-5 text-left shadow-2xl shadow-black/30">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-white">Copy and send this to your agent</h2>
                    <CopyButton
                      value={SMART_CLI_AGENT_SETUP_PROMPT}
                      copiedLabel="Copied"
                      className="h-8 rounded-md border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      Copy
                    </CopyButton>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/45 p-4 font-mono text-xs leading-6 text-slate-300">
                    {SMART_CLI_AGENT_SETUP_PROMPT}
                  </pre>
                </div>
              )}

              {activeTab.id === "other" && (
                <>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setGuideGroup("other")}
                      className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
                    >
                      <Command className="h-4 w-4" />
                      Choose your client
                    </button>
                  </div>
                  <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-400">
                    Gemini CLI, Cursor and Codex CLI have step-by-step guides. Any other client that supports remote MCP (Streamable HTTP + OAuth) can use the URL below — no token to copy.
                  </p>
                  <CopyButton
                    value={SMART_CLI_MCP_URL}
                    copiedLabel="URL copied"
                    aria-label="Copy connector URL"
                    className="mx-auto mt-3 rounded-md px-2 py-1 font-mono text-xs text-slate-500 hover:text-slate-200"
                  >
                    {SMART_CLI_MCP_URL}
                  </CopyButton>
                </>
              )}
            </div>

            <ExamplesPanel key={activeTab.id} tab={activeTab.id} />
          </div>
        </section>

        <PresetCatalog tab={activeTab.id} />

        <section className="mx-auto max-w-7xl px-4 pb-14 md:px-8">
          <div className="mb-5 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-cyan-300" />
            <h2 className="text-2xl font-black">Connector tools</h2>
          </div>
          <p className="mb-5 text-sm text-slate-400">
            Tool calls debit credits from your account the same way the website does. Only these {TOOL_COUNT} tools are exposed — nothing else. Revoke access from Claude any time.
          </p>
          <div className="space-y-8">
            {TOOL_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-lg font-black text-white">{group.title}</h3>
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-300">{group.tools.length}</span>
                  <span className="text-sm text-slate-500">{group.note}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.tools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <div key={tool.title} className="rounded-lg border border-white/10 bg-[#0c111b] p-5">
                        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-cyan-300/10 text-cyan-200">
                          <Icon className="h-5 w-5" />
                        </div>
                        <h4 className="font-mono text-sm font-bold text-white">{tool.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{tool.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <HowToConnectDialog group={guideGroup} onClose={closeGuide} />
    </>
  );
}
