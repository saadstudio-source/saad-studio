"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function VideoToolPage() {
  const params = useParams<{ tool: string }>();
  const router = useRouter();

  useEffect(() => {
    const tool = params.tool;
    if (tool === "motion-transfer") {
      router.replace("/video?tab=motion");
    } else if (tool === "object-swap") {
      router.replace("/video?tab=edit&tool=object-swap");
    } else if (tool === "video-upscaler" || tool === "upscale") {
      router.replace("/video?tab=edit&tool=upscale");
    } else {
      router.replace("/video?tab=edit");
    }
  }, [params.tool, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-[#050a14] text-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
        <span className="text-xs text-zinc-400 font-mono">Redirecting to Unified Video Workbench...</span>
      </div>
    </div>
  );
}
