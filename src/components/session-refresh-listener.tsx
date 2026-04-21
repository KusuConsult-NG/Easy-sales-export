"use client";

import { useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

export function SessionRefreshListener() {
    const { update, status } = useSession();
    const pathname = usePathname();

    const handleRefresh = useCallback(() => {
        // Only run update if the user is actively authenticated
        if (status === "authenticated") {
            try {
                update();
            } catch (error) {
                console.error("Silent session refresh failed:", error);
            }
        }
    }, [status, update]);

    // Track path changes (soft navigation events)
    useEffect(() => {
        handleRefresh();
    }, [pathname, handleRefresh]);

    // Track window focus events (tab switches back)
    useEffect(() => {
        const onFocus = () => handleRefresh();
        
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [handleRefresh]);

    return null; // Silent background component
}
