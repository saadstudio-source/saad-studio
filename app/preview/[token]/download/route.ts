import { NextResponse } from "next/server";

import { verifyPreviewToken } from "@/lib/smart-cli-preview";
import {
  MAX_PROXY_DOWNLOAD_BYTES,
  downloadFileName,
  isPublicDownloadHost,
  pickExtension,
  safeContentType,
} from "@/lib/smart-cli-preview-download";

// GET /preview/<token>/download?i=0 — forces a file download for one media item
// of a signed preview. The bytes are streamed (never buffered); the token already
// authorises the URLs, so nothing outside the signed list can be fetched.

export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 20_000;

function notFound() {
  return new NextResponse("This download link is invalid or has expired.", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  const data = verifyPreviewToken(params.token);
  if (!data) return notFound();

  const rawIndex = new URL(request.url).searchParams.get("i") ?? "0";
  const index = /^\d{1,2}$/.test(rawIndex) ? Number(rawIndex) : -1;
  const target = data.urls[index];
  if (!target) return notFound();

  // Anything we cannot or should not proxy: let the browser open the CDN file.
  const fallback = () => NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
  if (!isPublicDownloadHost(target)) return fallback();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, { redirect: "manual", signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) return fallback();
    const length = Number(upstream.headers.get("content-length") ?? 0);
    if (length > MAX_PROXY_DOWNLOAD_BYTES) {
      void upstream.body.cancel();
      return fallback();
    }

    const upstreamType = upstream.headers.get("content-type");
    const extension = pickExtension(upstreamType, target, data.kind);
    const headers = new Headers({
      "Content-Type": safeContentType(upstreamType, data.kind),
      "Content-Disposition": `attachment; filename="${downloadFileName(data.kind, index, extension)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    });
    // fetch() decodes gzip/br, so the upstream length is only valid when untouched.
    if (length > 0 && !upstream.headers.get("content-encoding")) headers.set("Content-Length", String(length));

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    clearTimeout(timer);
    return fallback();
  }
}
