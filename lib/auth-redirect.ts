// Sign-in redirect target for unauthenticated requests to protected pages.
//
// Why this exists: calling Clerk's `auth().protect()` without options answers
// NON-browser requests (crawlers, curl, fetch with Accept: */*) with a rewrite to
// `${publicOrigin}/clerk_<timestamp>` (to fake a 404). Behind the Caddy reverse
// proxy Next only knows its internal origin (https://0.0.0.0:3000), so a rewrite
// to a different origin is treated as an EXTERNAL proxy request: Next calls the
// public URL, which hits the same middleware again, and the request loops until
// the proxy gives up (HTTP 500 after ~30 s). Passing an explicit
// `unauthenticatedUrl` makes Clerk redirect instead — the same redirect browsers
// already receive — so no rewrite ever happens.

export function buildSignInRedirectUrl(origin: string, pathname: string, search = ""): string {
  const base = origin.replace(/\/$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = new URL("/sign-in", base);
  url.searchParams.set("redirect_url", `${base}${path}${search.startsWith("?") || search === "" ? search : `?${search}`}`);
  return url.toString();
}
