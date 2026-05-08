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

        if (status === "authenticated" && session) {
            const SESSION_KEY = "ese_session_active";
            const isTabSessionActive = sessionStorage.getItem(SESSION_KEY);
            
            // SECURITY CHECK: Referrer Validation
            // If returning from an external site, or if the tab session flag is missing,
            // we force a logout to ensure the user must sign in again as requested.
            const referrer = typeof document !== 'undefined' ? document.referrer : '';
            const trustedDomains = ['easysalesexport.com', 'easysalesmarket.com', 'easysalescooperative.com'];
            const isExternalReferrer = referrer && !trustedDomains.some(domain => referrer.includes(domain));
            const isFreshEntry = !isTabSessionActive;
            const isFromLoginPage = referrer && referrer.includes("/auth/login");

            if ((isFreshEntry || isExternalReferrer) && !isFromLoginPage) {
                signOut({ 
                    callbackUrl: `/auth/login?reason=security_refresh&returnTo=${pathname}`,
                    redirect: true 
                });
                return;
            }
        }

        // If we are authenticated and the guard is already set, or if we just successfully 
        // logged in, ensure the flag is set for this tab's lifecycle.
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
