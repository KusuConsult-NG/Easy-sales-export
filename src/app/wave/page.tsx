"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// NOTE: Do NOT use server-side redirect() here.
// When Railway/Next.js rewrites waveprogramme.com/ → /wave internally,
// the server-side redirect() resolves against the REWRITTEN origin
// (easysalesexport.com), sending users there instead of staying on waveprogramme.com.
// Client-side router.replace() uses the browser's actual URL as the base.
export default function WAVEPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/wave/landing");
    }, [router]);

    return null;
}
