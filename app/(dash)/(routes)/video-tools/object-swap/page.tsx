import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "استبدال العناصر السينمائي (Object Swap) | SaadStudio",
  description: "استوديو استبدال وتعديل العناصر والخلفيات في الفيديو بالذكاء الاصطناعي بواسطة OpenJutsu و WaveSpeed AI مع الحفاظ على الإضاءة والصوت.",
};

export default function ObjectSwapPage() {
  redirect("/video?tab=edit&tool=object-swap");
}
