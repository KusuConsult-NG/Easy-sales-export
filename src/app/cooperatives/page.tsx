"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// NOTE: Do NOT use server-side redirect() here.
// When Railway/Next.js rewrites easysalescooperative.com/ → /cooperatives internally,
// the server-side redirect() resolves against the REWRITTEN origin
// (easysalesexport.com), sending users there instead of staying on the cooperative domain.
// Client-side router.replace() uses the browser's actual URL as the base.
export default function CooperativesPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/cooperatives/landing");
    }, [router]);

    return null;
}
