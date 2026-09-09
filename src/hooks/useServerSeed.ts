"use client";

import { useRef, useCallback } from "react";

/**
 * Data the SERVER already fetched, consumed once instead of asked for again.
 *
 *   #541 EIGHT SCREENS MADE THE USER WAIT FOR SOMETHING THE SERVER COULD HAVE
 *        SENT WITH THE PAGE.
 *
 *   /profile and the seven module dashboards were all "use client" pages that
 *   fetched on mount. The sequence a user actually experienced was:
 *
 *       HTML arrives (empty)  ->  download the JS bundle  ->  hydrate
 *         ->  NOW make the round trip  ->  repaint with the data
 *
 *   Four steps before anything appeared, three of them after the page already
 *   looked loaded. #540 removed this on /dashboard and /messages by fetching in
 *   the server LAYOUT; these eight have no layout to hang it on, so each page
 *   becomes a small server component that fetches and hands the result to the
 *   client component that always did the rendering.
 *
 * ── WHY A SEED IS TAKEN ONCE AND THEN DROPPED ───────────────────────────────
 *
 *   The seed is only true for the first render. Every one of these effects also
 *   re-runs on a real dependency change — a new session, a switched tab, a
 *   completed save — and on those runs it MUST fetch, or the screen would
 *   render server data from page load for the rest of the session.
 *
 *   So this returns a take-once function rather than a value: the first call
 *   hands back the seed, and every call after it returns null and the caller
 *   falls through to its own fetch. That is the whole contract, and it is a
 *   hook so the ref survives re-renders without the seed being re-armed.
 *
 * ── WHY NOT JUST SEED useState ──────────────────────────────────────────────
 *
 *   Several of these effects do substantial derived work with the result —
 *   /profile alone parses a phone number against a country-code list, splits a
 *   name, computes which fields are missing and sets seven other pieces of
 *   state. Seeding useState would mean duplicating that derivation on the
 *   server, which is two copies of one contract: the defect class this audit
 *   keeps finding.
 *
 *   Handing the seed INTO the existing effect leaves every line of that
 *   derivation exactly where it was, with one thing changed — where the input
 *   came from.
 *
 * Usage:
 *
 *     const takeSeed = useServerSeed(initialProfile);
 *     ...
 *     const result = takeSeed() ?? await getUserProfileAction();
 */
export function useServerSeed<T>(initial: T | null | undefined): () => T | null {
    const ref = useRef<T | null>(initial ?? null);

    return useCallback(() => {
        const value = ref.current;
        ref.current = null;
        return value;
    }, []);
}
