
"use client";

import Link from "next/link";
import { Home, LayoutDashboard } from "lucide-react";
import { useSession } from "next-auth/react";

interface BackToHubProps {
    className?: string; // Allow custom positioning classes
    variant?: "light" | "dark"; // For different backgrounds
}

export default function BackToHub({ className = "", variant = "light" }: BackToHubProps) {
    const { data: session } = useSession();
    const isLoggedIn = !!session?.user;

    const baseStyles = "absolute z-50 inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-sm transition-all hover:scale-105 font-medium text-sm";

    // Variants for different hero backgrounds
    const variants = {
        light: "bg-white/90 hover:bg-white text-slate-900 border border-slate-200/50",
        dark: "bg-slate-900/90 hover:bg-slate-900 text-white border border-slate-700/50"
    };

    return (
        <Link
            href={isLoggedIn ? "/dashboard" : "/"}
            className={`${baseStyles} ${variants[variant]} ${className}`}
        >
            {isLoggedIn ? <LayoutDashboard className="w-4 h-4" /> : <Home className="w-4 h-4" />}
            <span>{isLoggedIn ? "Return to Dashboard" : "Back to Hub"}</span>
        </Link>
    );
}
