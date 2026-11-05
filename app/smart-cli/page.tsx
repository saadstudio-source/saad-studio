"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  Check,
  Clock3,
  Clipboard,
  Code2,
  Command,
  Globe2,
  Image as ImageIcon,
  Images,
  KeyRound,
  Layers,
  Layers3,
  Link2,
  MessageCircle,
  PlaySquare,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

import TopNavbar from "@/components/TopNavbar";
import { cn } from "@/lib/utils";

const MCP_URL = "https://www.saadstudio.app/api/smart-cli/mcp";
const SKILLS_INSTALL = "curl -fsSL https://raw.githubusercontent.com/saadstudio-source/saad-studio/main/packages/skills/install.sh | bash";

type Step = { title: string; text: string; value: string };

type ClientTabId = "claude" | "claude-code" | "chatgpt";

interface ClientTab {
  id: ClientTabId;
  label: string;
  icon: typeof MessageCircle;
  disabled?: boolean;
  badge?: string;
  steps: Step[];
}

const CLIENT_TABS: ClientTab[] = [
  {
    id: "claude",
    label: "Claude",
    icon: MessageCircle,
    steps: [
      {
        title: "Open connector settings",
        text: "In Claude (desktop or web), go to Settings → Connectors → Add custom connector.",
        value: "Settings -> Connectors -> Add custom connector",
      },
      {
        title: "Add Saad Studio",
        text: "Name the connector Saad Studio and paste this HTTPS URL into the URL field.",
        value: MCP_URL,
      },
      {
        title: "Ask from chat",
        text: "After approval, Claude can call the 5 tools listed below using your Saad Studio credits.",
        value: "Generate a cinematic image of a desert sunset.",
      },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    icon: Terminal,
    steps: [
      {
        title: "Install the CLI",
        text: "One-time install. Works on macOS, Linux, and Windows. Requires Node 18+.",
        value: "npm i -g @saadstudio/cli",
      },
      {
        title: "Sign in",
        text: "Opens your browser once, saves a token to ~/.saadstudio/token.json.",
        value: "saadstudio login",
      },
      {
        title: "Add the skill pack",
        text: "Teaches Claude Code the UGC pipeline, storyboard flow, and image/video shortcuts.",
        value: SKILLS_INSTALL,
      },
    ],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    icon: Sparkles,
    disabled: true,
    badge: "soon",
    steps: [],
  },
];

// Mirrors the tools actually wired in app/api/smart-cli/mcp/route.ts.
// If you add a tool there, add it here.
const TOOL_GROUPS = [
  {
    title: "Generation",
    tools: [
      { icon: ImageIcon, title: "generate_image", text: "Generate an image (Nano Banana Pro by default; other models routed through KIE / Google / OpenAI per project rules)." },
      { icon: Layers, title: "generate_storyboard", text: "Return multiple concept variations from one idea so the user can pick before rendering." },
      { icon: PlaySquare, title: "generate_video", text: "Render a video from a prompt, optionally using a chosen concept as the first frame." },
    ],
  },
  {
    title: "Reference",
    tools: [
      { icon: Images, title: "show_generations", text: "List the most recent images and videos so Claude can reuse a previous frame or show the history." },
      { icon: Layers3, title: "list_models", text: "Return the available image and video models with their capabilities so Claude picks the right one on request." },
    ],
  },
];

const TOOLS = TOOL_GROUPS.flatMap((group) => group.tools);

const PERMISSION_OPTIONS = [
  { label: "Always allow", icon: Check, color: "text-emerald-300" },
  { label: "Needs approval", icon: Clock3, color: "text-cyan-300" },
  { label: "Block", icon: Ban, color: "text-rose-300" },
];

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="mt-4 flex h-12 w-full min-w-0 items-center justify-between rounded-md border border-white/10 bg-black/45 px-4 text-left font-mono text-xs text-white transition hover:border-cyan-300/60"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="ml-3 h-4 w-4 shrink-0 text-emerald-300" /> : <Clipboard className="ml-3 h-4 w-4 shrink-0 text-slate-500" />}
    </button>
  );
}

function StepCard({ step, index }: { step: Step; index: number }) {
  return (
    <div className="border-b border-white/10 p-5 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">
        {index + 1}
      </div>
      <h3 className="text-base font-bold text-white">{step.title}</h3>
      <p className="mt-2 min-h-[60px] text-sm leading-6 text-slate-400">{step.text}</p>
      <CopyBox value={step.value} />
    </div>
  );
}

export default function SmartCliPage() {
  const [activeTab, setActiveTab] = useState<ClientTabId>("claude");
  const active = CLIENT_TABS.find((tab) => tab.id === activeTab) ?? CLIENT_TABS[0];

  return (
    <>
      <TopNavbar />
      <main className="min-h-screen bg-[#05070b] pt-14 text-white">
        <section className="border-b border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#07111f,#05070b)]">
          <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
            <div className="flex items-center justify-between gap-4">
              <Link href="/apps" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
                <ArrowLeft className="h-4 w-4" />
                Back to Apps
              </Link>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Hosted MCP endpoint
              </div>
            </div>

            <div className="mx-auto max-w-4xl py-12 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-300">
                <Command className="h-3.5 w-3.5 text-cyan-300" />
                Smart CLI
              </div>
              <h1 className="text-balance text-4xl font-black leading-tight tracking-normal md:text-6xl">
                Connect Saad Studio to your AI
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-400">
                Same account, same credits, same models. Pick your client below — Claude uses the hosted MCP URL, Claude Code uses the CLI + skill pack.
              </p>
            </div>

            <div className="mx-auto max-w-5xl">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="inline-flex flex-wrap rounded-full border border-white/10 bg-white/[0.06] p-1">
                  {CLIENT_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = tab.id === activeTab;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => !tab.disabled && setActiveTab(tab.id)}
                        disabled={tab.disabled}
                        aria-pressed={isActive}
                        className={cn(
                          "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition",
                          isActive
                            ? "bg-white text-black"
                            : tab.disabled
                              ? "cursor-not-allowed text-slate-500"
                              : "text-slate-200 hover:bg-white/10",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                        {tab.badge && (
                          <span className={cn(
                            "ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            isActive ? "bg-black/10 text-black" : "bg-white/10 text-slate-400",
                          )}>
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {active.steps.length > 0 ? (
                <div className="grid overflow-hidden rounded-xl border border-white/10 bg-[#101318] shadow-2xl shadow-black/30 md:grid-cols-3">
                  {active.steps.map((step, index) => (
                    <StepCard key={step.title} step={step} index={index} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#101318] p-8 text-center shadow-2xl shadow-black/30">
                  <p className="text-sm text-slate-300">
                    ChatGPT support is on the way — the same MCP endpoint will plug into the OpenAI Apps SDK once our submission is approved.
                  </p>
                </div>
              )}

              <div className="mx-auto mt-4 flex max-w-max items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100">
                <Link2 className="h-4 w-4" />
                Same URL works in any MCP-compatible client.
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 md:px-8">
          <div className="mb-5">
            <h2 className="text-2xl font-black">Connector Tools</h2>
            <p className="mt-1 text-sm text-slate-400">These are the actions exposed by the Smart CLI connector.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <div key={tool.title} className="rounded-lg border border-white/10 bg-[#0c111b] p-5">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-cyan-300/10 text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-mono text-sm font-bold text-white">{tool.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{tool.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-10 md:px-8">
          <div className="rounded-lg border border-white/10 bg-[#0c111b]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="text-xl font-black">Tool Permissions</h2>
                <p className="mt-1 text-sm text-slate-400">Choose when Claude is allowed to use each Smart CLI tool.</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">
                <Clock3 className="h-4 w-4" />
                Needs approval
              </div>
            </div>

            <div className="divide-y divide-white/10">
              {TOOL_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span>{group.title}</span>
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-300">{group.tools.length}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-slate-200">
                      <Clock3 className="h-4 w-4" />
                      Needs approval
                    </div>
                  </div>

                  <div className="divide-y divide-white/10">
                    {group.tools.map((tool) => (
                      <div key={tool.title} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-cyan-200">
                            <tool.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-white">{tool.title}</div>
                            <div className="truncate text-sm text-slate-500">{tool.text}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {PERMISSION_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const active = option.label === "Needs approval";
                            return (
                              <button
                                key={option.label}
                                type="button"
                                aria-label={`${tool.title}: ${option.label}`}
                                className={cn(
                                  "flex h-9 w-9 items-center justify-center rounded-md border transition",
                                  active ? "border-cyan-300/50 bg-cyan-300/15" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]",
                                )}
                                title={option.label}
                              >
                                <Icon className={cn("h-4 w-4", active ? "text-cyan-200" : option.color)} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-14 md:px-8">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-white/10 bg-[#0c111b] p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <Globe2 className="h-4 w-4 text-cyan-300" />
                Hosted endpoint
              </div>
              <p className="text-sm leading-6 text-slate-400">
                Paste this URL into Claude's custom connector form. Claude handles OAuth — no token to copy.
              </p>
              <CopyBox value={MCP_URL} />
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0c111b] p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="h-4 w-4 text-emerald-300" />
                What spending looks like
              </div>
              <p className="text-sm leading-6 text-slate-400">
                Tool calls debit credits from your account the same way the website does. The 5 tools, and only those 5 tools, are exposed — nothing else.
              </p>
              <div className="mt-4 grid gap-2 text-sm text-slate-300">
                <span className="inline-flex items-center gap-2"><Code2 className="h-4 w-4 text-emerald-300" /> structured tool calls only</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /> account-controlled spending</span>
                <span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4 text-emerald-300" /> revoke from Claude any time</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
