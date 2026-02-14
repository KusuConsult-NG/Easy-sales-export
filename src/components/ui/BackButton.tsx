"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

interface BackButtonProps {
    fallbackPath?: string;
    label?: string;
    className?: string;
}

/**
 * Reusable back button component for in-app navigation
 * Falls back to provided path if no browser history available
 */
export default function BackButton({
    fallbackPath,
    label = "Back",
    className = ""
}: BackButtonProps) {
    const router = useRouter();

    const handleBack = () => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
        } else if (fallbackPath) {
            router.push(fallbackPath);
        }
    };

    return (
        <button
            onClick={handleBack}
            className={`flex items-center gap-2 text-sm font-medium hover:opacity-80 transition-opacity ${className}`}
            type="button"
        >
            <ChevronLeft className="w-4 h-4" />
            {label}
        </button>
    );
}
