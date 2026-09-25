"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { SESSION_SYNC_INTERVAL_MS } from "@/lib/session-staleness";

/**
 *   #922 A BACKGROUND REFRESH THAT RAN ON EVERY NAVIGATION, AND RE-RAN
 *   TWENTY-FOUR EFFECTS EACH TIME.
 *
 *   This component is mounted in Providers, so it is on every page. It called
 *   next-auth's `update()` on EVERY path change and EVERY window focus, with no
 *   interval of any kind.
 *
 * ── WHAT ONE update() COSTS ─────────────────────────────────────────────────
 *
 *   A POST to /api/auth/session, the jwt callback re-run, and — because
 *   `trigger === "update"` is the first term of
 *
 *       if (trigger === "update" || !lastSynced || (now - lastSynced) > SYNC_INTERVAL)
 *
 *   — a FORCED profile resync that skips the two-minute interval entirely. That
 *   interval is not a tuning knob: the callback's own comment calls it the
 *   latency budget for ban and password-reset revocation. So the platform's
 *   stated bound on session staleness was being opted out of on every page
 *   change, at a cost, for no gain.
 *
 *   Then `useSession()` hands every consumer a NEW session object. Swept: 24
 *   effects across 21 client components still list the whole `session` object in
 *   their dependency array, so each of those re-runs — and most of them open with
 *   a server action.
 *
 *   THIS WAS MEASURED IN PRODUCTION ONCE, at one of those consumers. From
 *   WaveApplicationClient, which fixed its own dependency list and named the
 *   cause without changing it:
 *
 *       "checkWaveStatusAction ran about fourteen times in forty seconds for one
 *        member, at 784ms to 2784ms a call. It was keyed on the whole `session`
 *        object. SessionRefreshListener calls next-auth's update() on EVERY path
 *        change and EVERY window focus; update() re-mints the session,
 *        useSession() hands back a new object, and this effect fires again."
 *
 *   One consumer was repaired. The other 24 effects were not, and the cause was
 *   left running.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ──────────────────────────────────────────
 *
 *   The triggers stay: a path change and a window focus are the right moments to
 *   notice that an admin has granted a role. What changed is that they no longer
 *   force a resync more often than SESSION_SYNC_INTERVAL_MS — the number the
 *   platform already decided a session may be stale for. A refresh inside that
 *   window would return the same answer and cost a round trip.
 *
 *   NOT throttled, and deliberately: a DELIBERATE `update()` elsewhere.
 *   LoginForm, ProfileClient, the cooperative onboarding client and the academy
 *   dashboard each call it after changing something the session carries, and
 *   there the interval bypass is exactly what is wanted. This component is the
 *   one caller that knows of no change at all.
 *
 *   The 24 session-keyed effects are NOT touched here. Re-keying two dozen
 *   effects across six modules on a hunch is how a working screen stops loading;
 *   each needs its own reading of what it is watching for. They are counted and
 *   pinned in a-refresh-that-fired-on-every-page-change instead, so the number
 *   cannot grow quietly.
 */
export function SessionRefreshListener() {
    const { update, status } = useSession();
    const pathname = usePathname();

    //   Survives re-renders, and is deliberately NOT state: writing it must not
    //   itself cause a render, or this component becomes the loop it is fixing.
    const lastRefreshedAt = useRef(0);

    const handleRefresh = useCallback(() => {
        // Only run update if the user is actively authenticated
        if (status !== "authenticated") return;

        const now = Date.now();
        if (now - lastRefreshedAt.current < SESSION_SYNC_INTERVAL_MS) return;

        //   Stamped BEFORE the call, not after. update() is async and two
        //   triggers can land in the same tick — a focus event arriving with a
        //   soft navigation — and a stamp written in a `.then` would let both
        //   through.
        lastRefreshedAt.current = now;

        try {
            update();
        } catch (error) {
            console.error("Silent session refresh failed:", error);
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
