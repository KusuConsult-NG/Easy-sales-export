
import Link from "next/link";
import { Home } from "lucide-react";

interface BackToHubProps {
    className?: string; // Allow custom positioning classes
    variant?: "light" | "dark"; // For different backgrounds
}

export default function BackToHub({ className = "", variant = "light" }: BackToHubProps) {
    const baseStyles = "absolute z-50 inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-sm transition-all hover:scale-105 font-medium text-sm";

    // Variants for different hero backgrounds
    const variants = {
        light: "bg-white/90 hover:bg-white text-slate-900 border border-slate-200/50",
        dark: "bg-slate-900/90 hover:bg-slate-900 text-white border border-slate-700/50"
    };

    return (
        <Link
            href="/"
            className={`${baseStyles} ${variants[variant]} ${className}`}
        >
            <Home className="w-4 h-4" />
            <span>Back to Hub</span>
        </Link>
    );
}
