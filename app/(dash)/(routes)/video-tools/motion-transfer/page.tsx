import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "نقل الحركة السينمائي (Motion Transfer) | SaadStudio",
  description: "استوديو نقل الحركة السينمائية من فيديو مرجعي إلى شخصية ثابتة باستخدام نموذج Kling 2.6 Motion Control ونظام WaveSpeed AI.",
};

export default function MotionTransferPage() {
  redirect("/video?tab=motion");
}
