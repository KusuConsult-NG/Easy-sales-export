"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { checkMarketplaceStatusAction } from "@/app/actions/marketplace";

/**
 * Invisible client component that redirects authenticated users away from the
 * public Marketplace landing page to their actual dashboard / onboarding.
 * 
 * Drop this inside the server-rendered page.tsx as its very first element.
 * Public (unauthenticated) visitors see nothing different — no redirect fires.
 */
export default function MarketplaceRouteGuard() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (sessionStatus === "loading") return;
        if (sessionStatus !== "authenticated") return;

        (async () => {
            try {
                const appStatus = await checkMarketplaceStatusAction();
                if (appStatus?.status === "approved") {
                    // Route based on account type
                    if (appStatus.accountType === "seller") {
                        router.replace("/marketplace/seller/dashboard");
                    } else {
                        router.replace("/marketplace/buyer/dashboard");
                    }
                } else {
                    router.replace("/marketplace/onboarding");
                }
            } catch {
                router.replace("/marketplace/onboarding");
            }
        })();
    }, [sessionStatus, router]);

    return null; // renders nothing
}
