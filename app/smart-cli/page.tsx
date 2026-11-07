import { Suspense } from "react";
import type { Metadata } from "next";

import SmartCliHub from "@/components/smart-cli/SmartCliHub";

export const metadata: Metadata = {
  title: "Smart CLI | Connect Saad Studio to your AI",
  description:
    "Generate images and videos from Claude, Claude Code or any MCP-compatible agent with your Saad Studio account, credits and models.",
};

export default function SmartCliPage() {
  // SmartCliHub reads ?tab= via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#05070b]" />}>
      <SmartCliHub />
    </Suspense>
  );
}
