"use client";

import Link from "next/link";
import Image from "next/image";
import {usePathname} from "next/navigation";

import { cn } from "@/lib/utils";
import {LayoutDashboard, MessageSquare, ImageIcon, VideoIcon, Music, Code, Settings, FileText, Sparkles} from "lucide-react";
import {FreeCounter} from "@/components/free-counter";

const montserrat = { className: "font-sans" };

const routes = [
    {
        label: "Explore",
        icon: LayoutDashboard,
        href: '/explore',
        color: "text-sky-500"
    },
    {
        label: 'Assist',
        icon: MessageSquare,
        href: '/assist',
        color: "text-violet-500",
    },
    {
        label: 'Image Generation',
        icon: ImageIcon,
        color: "text-pink-700",
        href: '/image',
    },
    {
        label: 'Video Generation',
        icon: VideoIcon,
        color: "text-orange-700",
        href: '/video',
    },
    {
        label: 'Hook Studio',
        icon: Sparkles,
        color: "text-indigo-400",
        href: '/hook-studio',
    },
    {
        label: 'ClipCraft Studio',
        icon: FileText,
        color: "text-cyan-400",
        href: '/clipcraft-studio',
    },
    {
        label: 'Cinema Flow',
        icon: Sparkles,
        color: "text-emerald-500",
        href: '/cinema-flow',
    },
    {
        label: 'Storyboard',
        icon: FileText,
        color: "text-amber-500",
        href: '/storyboard',
    },
    {
        label: 'Settings',
        icon: Settings,
        href: '/settings',
    },
]

export interface SideBarProps {
    apiLimit: number
    isPro: boolean
}

const SideBar = ({apiLimit = 0, isPro=false}: SideBarProps) => {
    const pathname = usePathname();
    return (
        <div className="space-y-4 py-4 flex flex-col h-full bg-[#111827] text-white" >
            <div className="px-3 py-2 flex-1">
                <Link href="/explore" className="flex items-center pl-3 mb-14">
                    <div className="relative h-8 w-8 mr-4">
                        <Image fill alt="Saad Studio Logo" src="/logo-saad-transparent.png" className="object-contain" />
                    </div>
                    <h1 className={cn("text-2xl font-bold", montserrat.className)}>
                        Saad Studio
                    </h1>
                </Link>
                <div className="space-y-1">
                    {routes.map((route) => (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={cn(
                                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition",
                                pathname === route.href ? "text-white bg-white/10" : "text-zinc-400",
                            )}
                        >
                            <div className="flex items-center flex-1">
                                <route.icon className={cn("h-5 w-5 mr-3", route.color)}/>
                                {route.label}
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
            <FreeCounter apiLimit={apiLimit} isPro={isPro} />
        </div>
    )
}

export default SideBar;
