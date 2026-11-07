// Data + link builders for the /smart-cli connector hub.
// Behaviour mirrors a "connect any agent" page: per-client tabs, one-click
// connector deep link, copyable agent setup prompt, example prompts with a
// "Try in Claude" link, and preset workflows with their own detail pages.
//
// Presets only describe workflows built from the tools that are really wired in
// app/api/smart-cli/mcp/route.ts. If you add or remove a tool there, update the
// tool lists and the presets below.

export const SMART_CLI_MCP_URL = "https://saadstudio.app/api/smart-cli/mcp";
export const SMART_CLI_CONNECTOR_NAME = "Saad Studio";
export const SMART_CLI_SKILLS_INSTALL =
  "curl -fsSL https://raw.githubusercontent.com/saadstudio-source/saad-studio/main/packages/skills/install.sh | bash";

// Opens Claude's "add custom connector" dialog with name + URL pre-filled.
export const SMART_CLI_CONNECT_LINK = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(
  SMART_CLI_CONNECTOR_NAME,
)}&connectorUrl=${encodeURIComponent(SMART_CLI_MCP_URL)}`;

export const SMART_CLI_AGENT_SETUP_PROMPT = [
  "Set up Saad Studio for me so I can generate images and videos from here.",
  "1. Install the CLI: run `npm i -g @saadstudio/cli`.",
  "2. Authenticate: run `saadstudio login` and complete the sign-in in the browser it opens.",
  `3. Install the companion skills: run \`${SMART_CLI_SKILLS_INSTALL}\`.`,
  "Once that's done, let me know when it's ready.",
].join("\n");

// ---------------------------------------------------------------------------
// Per-client connection guides. Every command / config below targets the real
// hosted endpoint and the OAuth flow implemented under app/api/smart-cli/oauth.
// Only clients whose official remote-MCP flow is documented are listed.
// ---------------------------------------------------------------------------

export const SERVER_ID = "saad-studio";

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http ${SERVER_ID} ${SMART_CLI_MCP_URL}`;
export const CODEX_ADD_COMMAND = `codex mcp add ${SERVER_ID} --url ${SMART_CLI_MCP_URL}`;
export const CODEX_LOGIN_COMMAND = `codex mcp login ${SERVER_ID}`;
export const GEMINI_SETTINGS_SNIPPET = JSON.stringify(
  { mcpServers: { [SERVER_ID]: { httpUrl: SMART_CLI_MCP_URL } } },
  null,
  2,
);

export const CLAUDE_CODE_AGENT_PROMPT = [
  "Set up Saad Studio for me so I can generate images and videos from here.",
  `1. Add the MCP server: run \`${CLAUDE_CODE_COMMAND}\`.`,
  `2. Then tell me to open /mcp, select ${SERVER_ID} and choose Authenticate — sign-in happens in my browser.`,
  `3. Once I'm signed in, list the ${SERVER_ID} tools to confirm it works.`,
].join("\n");

// Cursor one-click install: base64-encoded mcp.json entry for a remote server.
export const CURSOR_INSTALL_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
  SERVER_ID,
)}&config=${encodeURIComponent(btoa(JSON.stringify({ url: SMART_CLI_MCP_URL })))}`;

export interface GuideStep {
  title: string;
  text: string;
  /** Text shown in a click-to-copy box. */
  copy?: string;
  link?: { href: string; label: string };
  /** Render `copy` as a multi-line code block instead of a one-line box. */
  block?: boolean;
}

export interface ConnectGuide {
  id: string;
  label: string;
  title: string;
  steps: GuideStep[];
  note?: string;
}

export const CONNECT_GUIDES: Record<string, ConnectGuide> = {
  claude: {
    id: "claude",
    label: "Claude",
    title: "Connect Saad Studio to Claude in under a minute",
    steps: [
      {
        title: "Log in to Claude in your browser",
        text: "Go to claude.ai and log in to your account.",
        link: { href: "https://claude.ai/", label: "Open claude.ai" },
      },
      {
        title: "Add Saad Studio and sign in",
        text: "Go to Customize → Connectors. Add a custom connector named Saad Studio and paste this URL — or click the button.",
        copy: SMART_CLI_MCP_URL,
        link: { href: SMART_CLI_CONNECT_LINK, label: "Add Saad Studio MCP" },
      },
      {
        title: "Create with Saad Studio in Claude",
        text: "Start a new chat and describe the image or video you want. Claude uses Saad Studio and your credits.",
        link: { href: "https://claude.ai/new", label: "Start creating" },
      },
    ],
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    title: "Connect Saad Studio to ChatGPT",
    steps: [
      {
        title: "Turn on Developer mode",
        text: "In ChatGPT open Settings → Connectors → Advanced and enable Developer mode.",
        link: { href: "https://chatgpt.com/", label: "Open ChatGPT" },
      },
      {
        title: "Create a custom connector",
        text: "Add a new connector named Saad Studio, paste this MCP server URL and choose OAuth as the authentication.",
        copy: SMART_CLI_MCP_URL,
      },
      {
        title: "Sign in and use it in a chat",
        text: "Approve the Saad Studio sign-in, then enable the connector in a new chat and ask for an image or video.",
      },
    ],
    note: "Custom connectors need a ChatGPT plan with Developer mode, and Business / Enterprise workspaces may need an admin to allow them. Menu names can vary slightly by plan.",
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    title: "Connect Saad Studio to Gemini CLI",
    steps: [
      {
        title: "Add the server to settings.json",
        text: "Add this to ~/.gemini/settings.json (or .gemini/settings.json in a project).",
        copy: GEMINI_SETTINGS_SNIPPET,
        block: true,
      },
      {
        title: "Sign in",
        text: "Start Gemini CLI and run this command — your browser opens for the Saad Studio sign-in.",
        copy: `/mcp auth ${SERVER_ID}`,
      },
      {
        title: "Connect and start creating",
        text: "Run /mcp to confirm saad-studio is connected, then ask Gemini to create an image or video.",
      },
    ],
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    title: "Connect Saad Studio to Cursor",
    steps: [
      {
        title: "Install the MCP server",
        text: "Click the button to open Cursor with the Saad Studio server ready to install.",
        link: { href: CURSOR_INSTALL_LINK, label: "Add to Cursor" },
      },
      {
        title: "Or add it manually",
        text: `Add this to ~/.cursor/mcp.json under "mcpServers":`,
        copy: JSON.stringify({ [SERVER_ID]: { url: SMART_CLI_MCP_URL } }, null, 2),
        block: true,
      },
      {
        title: "Sign in and start creating",
        text: "In Cursor Settings → MCP, click Connect next to saad-studio and sign in, then ask the agent to create an image or video.",
      },
    ],
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    title: "Connect Saad Studio to Codex CLI",
    steps: [
      {
        title: "Add the server",
        text: "Run this in your terminal.",
        copy: CODEX_ADD_COMMAND,
      },
      {
        title: "Sign in",
        text: "Run this to sign in with your Saad Studio account in the browser.",
        copy: CODEX_LOGIN_COMMAND,
      },
      {
        title: "Start creating",
        text: "Start Codex and ask it to create an image or video with Saad Studio.",
      },
    ],
  },
};

export const OTHER_GUIDE_IDS = ["gemini", "cursor", "codex"] as const;

export type ClientTabId = "claude" | "claude-code" | "chatgpt" | "cli" | "other";

export const CLIENT_TAB_IDS: ClientTabId[] = ["claude", "claude-code", "chatgpt", "cli", "other"];

export type PresetCategory = "Image" | "Video" | "Marketing" | "Reference";

export const PRESET_CATEGORIES: PresetCategory[] = ["Image", "Video", "Marketing", "Reference"];

export interface SmartCliPreset {
  slug: string;
  title: string;
  description: string;
  category: PresetCategory;
  /** MCP tools this workflow calls (must exist in the MCP route). */
  tools: string[];
  /** Prompt sent to the agent. */
  prompt: string;
  related: string[];
}

// Core tools live in app/api/smart-cli/mcp/route.ts; the rest in
// lib/smart-cli-extra-tools.ts. test/smart-cli-extra-tools.test.ts checks that
// every preset only references names from this list.
export const CORE_TOOL_NAMES = [
  "generate_image",
  "generate_storyboard",
  "generate_video",
  "show_generations",
  "list_models",
] as const;

export const SMART_CLI_PRESETS: SmartCliPreset[] = [
  {
    slug: "cinematic-image",
    title: "Cinematic image",
    description:
      "Generate a single high-quality image from a short idea. Saad Studio picks a strong default model and shows the result as a card in chat.",
    category: "Image",
    tools: ["generate_image"],
    prompt:
      "Use Saad Studio to generate a cinematic wide shot of the Mesopotamian Ahwar marshes at golden hour: a reed boat gliding through still water, mist over the reeds, warm backlight, 16:9.",
    related: ["storyboard-concepts", "ad-campaign", "pick-the-right-model"],
  },
  {
    slug: "storyboard-concepts",
    title: "Storyboard concepts",
    description:
      "Turn one idea into several concept variations first, so you choose the direction before spending credits on a full render.",
    category: "Image",
    tools: ["generate_storyboard"],
    prompt:
      "Use Saad Studio to create a storyboard of 4 concept variations for a short film opening on the Baghdad Tigris riverfront at dawn. Let me choose one before rendering anything else.",
    related: ["concept-to-video", "cinematic-image", "ad-campaign"],
  },
  {
    slug: "image-to-video",
    title: "Animate an image",
    description:
      "Take a previous generation and animate it with Saad Studio, using the chosen frame as the first frame of the video.",
    category: "Video",
    tools: ["show_generations", "generate_video"],
    prompt:
      "Use Saad Studio to list my most recent images, then animate the best one into a 5-second video with a slow push-in camera move and natural ambient motion.",
    related: ["concept-to-video", "reuse-a-frame", "pick-the-right-model"],
  },
  {
    slug: "concept-to-video",
    title: "Concept to video",
    description:
      "A full flow: explore concepts, pick one, then render it as a video with the selected concept as the first frame.",
    category: "Video",
    tools: ["generate_storyboard", "generate_video"],
    prompt:
      "Use Saad Studio to explore 3 concepts for a 10-second video of a Basra corniche sunset with fishermen's boats, let me pick one, then render it as a video from that concept.",
    related: ["storyboard-concepts", "image-to-video", "ad-campaign"],
  },
  {
    slug: "ad-campaign",
    title: "Product ad concepts",
    description:
      "Create ad-ready visuals for a product brief: several angles to choose from, then a short video for the winning one.",
    category: "Marketing",
    tools: ["generate_storyboard", "generate_image", "generate_video"],
    prompt:
      "Use Saad Studio to create a product ad for a premium date-syrup bottle: first 4 concept angles in a storyboard, then a final hero image, then a 6-second video of the chosen concept. Square and vertical versions if possible.",
    related: ["cinematic-image", "concept-to-video", "reuse-a-frame"],
  },
  {
    slug: "reuse-a-frame",
    title: "Reuse a previous frame",
    description:
      "Pull recent generations from your history and reuse one as the reference or first frame for a new image or video.",
    category: "Reference",
    tools: ["show_generations", "generate_image", "generate_video"],
    prompt:
      "Use Saad Studio to show my last 5 generations, then take the one I choose and make a new variation of it in a different time of day.",
    related: ["image-to-video", "cinematic-image", "pick-the-right-model"],
  },
  {
    slug: "pick-the-right-model",
    title: "Pick the right model",
    description:
      "Ask what is available. Saad Studio returns the image and video models with their capabilities so the agent chooses correctly.",
    category: "Reference",
    tools: ["list_models"],
    prompt:
      "Use Saad Studio to list the available image and video models and tell me which one is best for a photorealistic portrait and which for a 10-second cinematic video.",
    related: ["cinematic-image", "image-to-video", "reuse-a-frame"],
  },
];

export function getPreset(slug: string): SmartCliPreset | undefined {
  return SMART_CLI_PRESETS.find((preset) => preset.slug === slug);
}

const CONNECT_FALLBACK = `\n\nIf Saad Studio is not connected, ask me to [connect Saad Studio](${SMART_CLI_CONNECT_LINK}) using ${SMART_CLI_MCP_URL} before continuing.`;

/** Prompt with the "connect first if needed" fallback appended. */
export function withConnectFallback(prompt: string): string {
  return `${prompt}${CONNECT_FALLBACK}`;
}

export function claudeTryUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(withConnectFallback(prompt))}`;
}

export function chatgptTryUrl(prompt: string): string {
  const text = `${prompt}\n\nIf Saad Studio is not connected, tell me to add it as a custom connector in ChatGPT using ${SMART_CLI_MCP_URL} before continuing.`;
  return `https://chatgpt.com/?q=${encodeURIComponent(text)}`;
}

export function isClientTabId(value: string | null | undefined): value is ClientTabId {
  return CLIENT_TAB_IDS.includes(value as ClientTabId);
}
