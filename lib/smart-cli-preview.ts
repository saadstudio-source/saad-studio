// Signed, stateless preview links for Smart CLI / MCP results.
//
// Problem: agents (ChatGPT, Gemini, Claude Code…) show a raw media URL as an
// "unverified image" card or a bare link. Instead every generation tool now
// returns a link to a branded Saad Studio page (/preview/<token>) that renders
// the media in the site's own design and works in any agent that can show a link.
//
// The token carries everything the page needs (media URLs, model, aspect, a short
// prompt, expiry) and is HMAC-signed, so there is no database table, no migration
// and nothing to enumerate: without a valid signature the page shows nothing.
// Anyone holding the link can view the media (like the public CDN links the tools
// already return), and it expires after PREVIEW_TTL_SECONDS.

import { createHmac, timingSafeEqual } from "crypto";

export type PreviewKind = "image" | "video" | "audio";

export const PREVIEW_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const MAX_PREVIEW_MEDIA = 8;

const SIGNING_CONTEXT = "smart-cli-preview.v1.";
const MAX_URL_LENGTH = 800;
const MAX_LABEL_LENGTH = 80;
export const MAX_PROMPT_LENGTH = 160;

/** Compact on the wire to keep links short. */
interface WirePayload {
  k: PreviewKind;
  u: string[];
  m?: string;
  a?: string;
  d?: number;
  p?: string;
  e: number;
}

export interface PreviewData {
  kind: PreviewKind;
  urls: string[];
  model?: string;
  aspectRatio?: string;
  durationSec?: number;
  prompt?: string;
  expiresAt: number;
}

export interface PreviewInput {
  kind: PreviewKind;
  urls: string[];
  model?: string;
  aspectRatio?: string;
  durationSec?: number;
  prompt?: string;
}

function getSecret(): string | null {
  const secret = process.env.PANEL_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") return null;
  return "saad-studio-panel-secret-please-set-PANEL_TOKEN_SECRET";
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${SIGNING_CONTEXT}${body}`).digest("base64url");
}

function clip(value: string | undefined, max: number): string | undefined {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Returns a signed token, or null when no secret is configured / nothing to show. */
export function createPreviewToken(input: PreviewInput, now = Date.now()): string | null {
  const secret = getSecret();
  if (!secret) return null;

  const urls = input.urls.filter(isHttpsUrl).slice(0, MAX_PREVIEW_MEDIA);
  if (urls.length === 0) return null;

  const payload: WirePayload = {
    k: input.kind,
    u: urls,
    e: Math.floor(now / 1000) + PREVIEW_TTL_SECONDS,
  };
  const model = clip(input.model, MAX_LABEL_LENGTH);
  const aspect = clip(input.aspectRatio, 16);
  const prompt = clip(input.prompt, MAX_PROMPT_LENGTH);
  if (model) payload.m = model;
  if (aspect) payload.a = aspect;
  if (prompt) payload.p = prompt;
  if (typeof input.durationSec === "number" && Number.isFinite(input.durationSec) && input.durationSec > 0) {
    payload.d = Math.round(input.durationSec * 10) / 10;
  }

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyPreviewToken(token: string, now = Date.now()): PreviewData | null {
  try {
    const secret = getSecret();
    if (!secret || typeof token !== "string" || token.length > 6000) return null;

    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);

    const expected = sign(body, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const wire = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<WirePayload>;
    if (wire.k !== "image" && wire.k !== "video" && wire.k !== "audio") return null;
    if (typeof wire.e !== "number" || wire.e * 1000 <= now) return null;
    if (!Array.isArray(wire.u) || wire.u.length === 0 || wire.u.length > MAX_PREVIEW_MEDIA) return null;
    if (!wire.u.every(isHttpsUrl)) return null;

    return {
      kind: wire.k,
      urls: wire.u,
      model: typeof wire.m === "string" ? clip(wire.m, MAX_LABEL_LENGTH) : undefined,
      aspectRatio: typeof wire.a === "string" ? clip(wire.a, 16) : undefined,
      durationSec: typeof wire.d === "number" && Number.isFinite(wire.d) ? wire.d : undefined,
      prompt: typeof wire.p === "string" ? clip(wire.p, MAX_PROMPT_LENGTH) : undefined,
      expiresAt: wire.e * 1000,
    };
  } catch {
    return null;
  }
}

export function buildPreviewUrl(origin: string, input: PreviewInput): string | null {
  const token = createPreviewToken(input);
  return token ? `${origin.replace(/\/$/, "")}/preview/${token}` : null;
}
