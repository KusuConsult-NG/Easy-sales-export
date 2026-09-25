"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

interface BackButtonProps {
    /**
     *   WHERE BACK MEANS, WHEN THE BROWSER CANNOT SAY. REQUIRED.
     *
     *   #921 This was optional, and four of the fourteen screens that render this
     *   button left it out — admin/marketplace/products, farm-nation offers, and
     *   the seller and buyer quote lists. On those four the handler ran
     *
     *       if (history.length > 1) router.back();
     *       else if (fallbackPath) router.push(fallbackPath);
     *
     *   with nothing after the `else if`. So on a tab whose history has one entry
     *   — a bookmark, a link out of an email, anything opened with target=_blank —
     *   the button rendered, looked enabled, and clicking it did NOTHING. Measured
     *   under jsdom, where `history.length` is 1: neither `back` nor `push` was
     *   called.
     *
     *   Required rather than defaulted. A default would have to be one path, and
     *   the four screens want four different ones (an admin tool does not belong
     *   at a member dashboard). Making it required puts the answer where the only
     *   person who knows it is — the caller — and makes a fifteenth no-op a
     *   compile error rather than a dead button somebody has to notice.
     */
    fallbackPath: string;
    label?: string;
    className?: string;
}

/**
 * Reusable back button component for in-app navigation
 * Falls back to the provided path when the browser has no history to pop.
 */
export default function BackButton({
    fallbackPath,
    label = "Back",
    className = ""
}: BackButtonProps) {
    const router = useRouter();

    function handleBack() {
        /*
         *   `history.length` COUNTS THE WHOLE TAB SESSION, not this app's share of
         *   it — recorded rather than fixed, because nothing in the platform can
         *   tell the two apart. A visitor who arrived from an external page and
         *   then navigated once inside the app has length 3, so `back()` walks
         *   them one step in, not out; but a visitor whose FIRST in-app page is
         *   this one, arriving from outside, has length 2 and `back()` takes them
         *   off the platform. There is no API for "is the previous entry ours":
         *   `document.referrer` describes the entry we came from, not the one we
         *   would return to, and the History API exposes no per-entry origin.
         *
         *   So the fallback is a last resort, not a preference. What #921 changed
         *   is that the last resort now always exists.
         */
        if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
            return;
        }

        router.push(fallbackPath);
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
