"use client";

import Image from "next/image"
import Link from "next/link"
import { useAuth } from "@clerk/nextjs";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const font = { className: "font-sans" };

const LandingNavbar = () => {
    const { isSignedIn } = useAuth();

    return (
        <nav className="p-4 bg-transparent flex items-center justify-between">
            <Link href="/" className="flex items-center">
                <div className="relative h-8 w-8 mr-4">
                    <Image fill alt="Saad Studio Logo" src="/logo-saad-transparent.png" className="object-contain" />
                </div>
                <h1 className={cn("text-2xl font-bold text-white", font.className)}>
                    Saad Studio
                </h1>
            </Link>
            <div className="flex items-center gap-x-2">
                {isSignedIn ?
                    <Link href="/explore">
                        <div className="text-slate-500 font-bold mr-2">Explore</div>
                    </Link>
                    :
                    <Link href="/?auth=login">
                        <div className="text-slate-500 font-bold mr-2">Sign In</div>
                    </Link>
                }
                <Link href={isSignedIn ? "/explore" : "/?auth=signup"}>
                    <Button variant="outline" className="rounded-full">
                        Get Started
                    </Button>
                </Link>
            </div>
        </nav>
    )
}

export default LandingNavbar;
