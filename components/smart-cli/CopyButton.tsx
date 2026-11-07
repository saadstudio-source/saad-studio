"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Clipboard } from "lucide-react";

import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  children?: ReactNode;
  copiedLabel?: ReactNode;
  className?: string;
  "aria-label"?: string;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API can be blocked (insecure context / permissions): fall back.
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function CopyButton({ value, children, copiedLabel, className, ...rest }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={rest["aria-label"]}
      onClick={async () => {
        const ok = await copyText(value);
        if (!ok) return;
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition",
        className,
      )}
    >
      {copied ? <Check className="h-4 w-4 shrink-0 text-emerald-300" /> : <Clipboard className="h-4 w-4 shrink-0" />}
      {copied ? (copiedLabel ?? "Copied") : children}
    </button>
  );
}
