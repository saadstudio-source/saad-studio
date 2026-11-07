"use client";

import { Suspense, useMemo, useState } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Check, LockKeyhole, X } from "lucide-react";

import { parseAllowedRedirectUri } from "@/lib/smart-cli-redirect";

function AuthorizeContent() {
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const clientName = params.client_name || "Claude";
  const redirectUri = params.redirect_uri || "";
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "your Saad Studio account";

  async function deny() {
    const url = parseAllowedRedirectUri(redirectUri);
    if (!url) {
      setError("Missing or unsupported redirect URI.");
      return;
    }
    url.searchParams.set("error", "access_denied");
    if (params.state) url.searchParams.set("state", params.state);
    window.location.href = url.toString();
  }

  async function allow() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/smart-cli/oauth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json() as { redirectTo?: string; error?: string };
      if (!res.ok || !data.redirectTo) throw new Error(data.error ?? "Could not authorize this connector.");
      window.location.href = data.redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not authorize this connector.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#1f1f24] px-5 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center">
        <div className="w-full rounded-2xl border border-white/10 bg-[#24242a] p-8 shadow-2xl shadow-black/30">
          <div className="mb-8 flex items-center justify-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-violet-300">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div className="h-px w-9 border-t border-dashed border-white/40" />
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">
              <Image
                src="/logo-saad-transparent.png?v=3"
                alt="Saad Studio"
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
              />
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold">{clientName}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              wants to access Saad Studio on behalf of
              <br />
              {email}
            </p>
          </div>

          <div className="mt-8 overflow-hidden rounded-lg border border-white/10 bg-black/15">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-bold">
              This will allow {clientName} access to:
            </div>
            <div className="space-y-0 text-sm">
              <div className="border-b border-white/10 px-4 py-3">• Verify your identity</div>
              <div className="border-b border-white/10 px-4 py-3">• Your email address</div>
              <div className="px-4 py-3">• Generate approved Saad Studio media using your credits</div>
            </div>
          </div>

          <div className="mt-8 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-4 text-center text-sm font-semibold leading-6 text-orange-300">
            Make sure you trust {clientName}. You may be sharing sensitive data with this site or app.
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {!isLoaded ? (
            <div className="mt-8 text-center text-sm text-slate-400">Loading...</div>
          ) : !isSignedIn ? (
            <div className="mt-8">
              <SignInButton mode="modal">
                <button className="h-12 w-full rounded-lg bg-violet-600 font-bold text-white transition hover:bg-violet-500">
                  Sign in to continue
                </button>
              </SignInButton>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={deny}
                disabled={loading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] font-bold text-slate-200 transition hover:bg-white/[0.07]"
              >
                <X className="h-4 w-4" />
                Deny
              </button>
              <button
                type="button"
                onClick={allow}
                disabled={loading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-600 font-bold text-white transition hover:bg-violet-500 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {loading ? "Allowing..." : "Allow"}
              </button>
            </div>
          )}

          <p className="mt-5 text-center text-xs leading-5 text-slate-400">
            If you allow access, this app will redirect you back to {clientName}. You can revoke access by disconnecting the connector.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SmartCliAuthorizePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#1f1f24] text-white" />}>
      <AuthorizeContent />
    </Suspense>
  );
}
