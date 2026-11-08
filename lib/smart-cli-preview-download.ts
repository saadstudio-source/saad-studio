// Helpers for the preview page's download route.
//
// A plain <a download> is ignored by browsers for cross-origin URLs (our media
// lives on a CDN), so the page links to /preview/<token>/download?i=N, which
// verifies the signed token and streams the file back with
// `Content-Disposition: attachment`.

import type { PreviewKind } from "@/lib/smart-cli-preview";

/** Larger files are not proxied; the browser is sent to the CDN URL instead. */
export const MAX_PROXY_DOWNLOAD_BYTES = 300 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

const DEFAULT_EXTENSION: Record<PreviewKind, string> = { image: "png", video: "mp4", audio: "mp3" };

/** Only media types are passed through; everything else is served as opaque bytes. */
export function safeContentType(raw: string | null | undefined, kind: PreviewKind): string {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml") return "application/octet-stream"; // can carry script
  if (new RegExp(`^${kind}/[a-z0-9.+-]+$`).test(type)) return type;
  return "application/octet-stream";
}

export function pickExtension(contentType: string | null | undefined, url: string, kind: PreviewKind): string {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const fromType = EXTENSION_BY_TYPE[type];
  if (fromType) return fromType;

  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    if (match) return match[1].toLowerCase();
  } catch {
    // fall through to the default
  }
  return DEFAULT_EXTENSION[kind];
}

export function downloadFileName(kind: PreviewKind, index: number, extension: string): string {
  return `saad-studio-${kind}-${index + 1}.${extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || DEFAULT_EXTENSION[kind]}`;
}

/**
 * Refuses hosts that are clearly not a public CDN. URLs in a token are signed by
 * this server, so this is defence in depth rather than the primary control.
 */
export function isPublicDownloadHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".")) return false; // localhost, bare internal names
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literals
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literals
  if (/\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  return true;
}
