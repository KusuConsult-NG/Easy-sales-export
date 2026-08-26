"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

/**
 * SessionGuard
 *
 *   #314 THIS COMPONENT GUARDS NOTHING, AND ANOTHER FILE WRITES A FLAG "TO
 *        SATISFY" IT.
 *
 *        The doc comment here used to claim two behaviours:
 *
 *          1. "Volatile Session: Detects fresh entries (e.g. from external
 *              URLs) and forces a re-login if a previous session exists but
 *              tab state is lost."
 *          2. "Redirect Loop Prevention: Uses a guard flag to ensure sign-out
 *              is only triggered once per entry."
 *
 *        Neither is implemented. The body sets `ese_session_active` when the
 *        session is authenticated and removes it when it is not. It never
 *        READS the flag, never compares anything, and never signs anybody out
 *        — `signOut` was imported and never called, which is what made the
 *        file read as though it did.
 *
 *        `ese_session_active` is written in two files and read in ZERO. And
 *        LoginForm.tsx wrote it under the comment "Register session as active
 *        in this tab to satisfy SessionGuard" — somebody wrote code to satisfy
 *        a check that does not exist. That is the cost of a component named
 *        for a control it does not perform: the belief spreads.
 *
 * WHAT THIS FILE ACTUALLY DOES
 * ----------------------------
 * It maintains one sessionStorage key that nothing reads. That is the whole
 * behaviour. It is kept rather than removed because the key is the only
 * surviving trace of the intended control, and whoever builds that control
 * will want it — but the description now matches the code.
 *
 * WHAT DOES EXIST, SO THIS IS NOT READ AS "SESSIONS ARE UNGUARDED"
 * ---------------------------------------------------------------
 * Two real controls run alongside this one, and both sign the user out:
 *   - SessionActivityTracker — idle timeout, calls signOut with a callbackUrl.
 *   - useSessionExpiry       — JWT expiry, calls signOut and clears storage.
 * What is missing is specifically the VOLATILE-SESSION rule above: because
 * sessionStorage is per-tab, the absent check would have forced a re-login
 * when a signed-in cookie arrived in a tab that had never logged in — the case
 * that matters on this platform's shared cookie domain, where a session cookie
 * set on easysalesexport.com is presented on the module domains too.
 *
 * Building it is an OWNER DECISION, not an audit fix: it signs real members
 * out, and a wrong threshold locks people out of a live platform. Recorded in
 * session-guard-enforces-nothing.test.ts, which also pins that this component
 * does not sign anybody out today.
 */
export default function SessionGuard() {
    const { data: session, status } = useSession();
    const pathname = usePathname();

    useEffect(() => {
        // Skip for public auth pages to avoid interference with the login flow
        if (pathname.startsWith("/auth")) return;

        // Written, and read by nothing. See the note above.
        if (status === "authenticated") {
            sessionStorage.setItem("ese_session_active", "true");
        }

        if (status === "unauthenticated") {
            sessionStorage.removeItem("ese_session_active");
        }

    }, [status, session, pathname]);

    return null; // Invisible component
}
