// Public origin resolution for the Smart CLI / MCP surface.
//
// Behind the Contabo reverse proxy (Caddy -> Next on 0.0.0.0:3000),
// `new URL(request.url).origin` is the *bind address* of the Node server
// ("https://0.0.0.0:3000"), not the public host. OAuth discovery documents,
// the 401 WWW-Authenticate challenge and internal panel fetches built from it
// were therefore unusable by Claude / other MCP clients.
//
// Edge-safe: no Node-only imports (used from middleware.ts as well).

export const SMART_CLI_CANONICAL_ORIGIN = "https://saadstudio.app";

// Only these hostnames may ever be advertised or trusted. Anything else
// (spoofed Host / X-Forwarded-Host, internal bind addresses) falls back to the
// canonical origin, so request headers can never steer OAuth metadata.
const ALLOWED_HOSTS = new Set(["saadstudio.app", "www.saadstudio.app"]);

// Fixed base for server-to-server calls to our own panel APIs. Never derived
// from request headers (the Bearer token is attached to these calls).
export function getInternalBaseUrl(): string {
  return (process.env.INTERNAL_APP_URL || SMART_CLI_CANONICAL_ORIGIN).replace(/\/$/, "");
}

function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0] ?? "";
}

function firstValue(value: string | null): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function isPublicHost(host: string): boolean {
  const name = hostnameOf(host);
  return ALLOWED_HOSTS.has(name);
}

export function getPublicOrigin(request: Request): string {
  const forwardedHost = firstValue(request.headers.get("x-forwarded-host"));
  const hostHeader = firstValue(request.headers.get("host"));
  const host = [forwardedHost, hostHeader].find((candidate) => candidate && isPublicHost(candidate));

  if (host) {
    // Allowed hosts are public production domains: always advertise HTTPS
    // (x-forwarded-proto is "http" on some local/proxy hops and must not win).
    // The apex domain is canonical (www redirects to it), so never advertise www.
    const normalizedHost = host.toLowerCase().replace(/^www\./, "");
    return `https://${normalizedHost}`;
  }

  const envOrigin = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (envOrigin) {
    try {
      const url = new URL(envOrigin);
      if (isPublicHost(url.host)) return url.origin;
    } catch {
      // fall through to canonical origin
    }
  }

  return SMART_CLI_CANONICAL_ORIGIN;
}
