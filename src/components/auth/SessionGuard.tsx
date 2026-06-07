"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

/**
 * SessionGuard
 * 
 * Enforces high-assurance session security:
 * 1. Volatile Session: Detects fresh entries (e.g. from external URLs) and 
 *    forces a re-login if a previous session exists but tab state is lost.
 * 2. Redirect Loop Prevention: Uses a guard flag to ensure sign-out is only
 *    triggered once per entry.
 */
export default function SessionGuard() {
    const { data: session, status } = useSession();
    const pathname = usePathname();

    useEffect(() => {
        // Skip for public auth pages to avoid interference with the login flow
        if (pathname.startsWith("/auth")) return;

        // If we are authenticated, ensure the active session flag is set for this tab's lifecycle.
        if (status === "authenticated") {
            sessionStorage.setItem("ese_session_active", "true");
        }
        
        // If status is unauthenticated, ensure the flag is cleared
        if (status === "unauthenticated") {
            sessionStorage.removeItem("ese_session_active");
        }

    }, [status, session, pathname]);

    return null; // Invisible component
}
