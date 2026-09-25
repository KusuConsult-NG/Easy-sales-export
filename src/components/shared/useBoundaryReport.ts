"use client";

import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { logTelemetryAction } from "@/app/actions/telemetry";

/**
 * TELLING SOMEBODY THE PAGE CRASHED.
 *
 *   #904 FOURTEEN ERROR BOUNDARIES, AND THE ONLY ONE THAT REPORTED WAS THE ONE
 *   NEXT REACHES LAST.
 *
 *   Measured while auditing the files no test had named — five of the fourteen
 *   were on that list. Exactly one, app/global-error.tsx, called
 *   `Sentry.captureException` and `logTelemetryAction`. The other thirteen —
 *   the root `app/error.tsx` and one per module segment — did this:
 *
 *       console.error('[Dashboard Error]', error.message);
 *
 *   or nothing at all.
 *
 *   AND global-error IS THE ONE THAT ALMOST NEVER RUNS. Next walks up from the
 *   crash to the NEAREST error boundary and stops there; global-error.tsx only
 *   handles what no `error.tsx` caught, which in this application means errors
 *   in the root layout itself. There is an `error.tsx` at the app root and one
 *   in every module segment, so a render crash inside /dashboard, /marketplace,
 *   /export, /academy, /wave, /cooperatives, /farm-nation, /loans, /escrow or
 *   /admin was caught by a boundary that wrote to a browser console nobody
 *   reads and reported to nothing.
 *
 *   THIS IS NOT HYPOTHETICAL AND THE PROOF IS IN THE COMMIT BEFORE THIS ONE.
 *   #901 found two screens that threw on EVERY ROW they were given — the admin
 *   land verification queue and the public land map — both live, both silent.
 *   The queue is under /land and the map under /land; neither has its own
 *   boundary, so both landed on app/error.tsx, which logged and moved on. Two
 *   screens on the platform could not draw a single row and nothing anywhere
 *   said so.
 *
 * ── WHY A HOOK AND NOT FOURTEEN CALLS ───────────────────────────────────────
 *
 *   The same reason useStaleDeploymentRecovery is a hook, from #717: the
 *   boundaries had nine copies of an unguarded reload and the copies had
 *   drifted. This carries three decisions that must not drift either —
 *
 *     NOTHING IS REPORTED DURING A STALE-DEPLOYMENT RELOAD. A ChunkLoadError
 *     after a deploy is a browser holding an old bundle, not a defect, and
 *     #717's hook is already reloading the page. Reporting it would fill the
 *     error feed with every deploy and bury the real crashes — which is the
 *     failure this whole finding is about.
 *
 *     ONCE PER ERROR. React runs effects twice under StrictMode in development
 *     and a boundary can re-render; a duplicate report is noise in the one
 *     place noise is expensive.
 *
 *     BOTH DESTINATIONS. Sentry for the stack, logTelemetryAction for the
 *     platform's own log — which is what global-error.tsx already did, and
 *     is kept rather than reduced to one.
 */
export function useBoundaryReport(
    error: Error & { digest?: string },
    /** The verdict from useStaleDeploymentRecovery — true while a reload is in flight. */
    updating: boolean,
    /** Which boundary caught it, e.g. "dashboard". Appears in the report. */
    boundary: string,
): void {
    const reported = useRef<unknown>(null);

    useEffect(() => {
        if (updating) return;
        if (reported.current === error) return;
        reported.current = error;

        reportBoundaryError(error, boundary);
    }, [error, updating, boundary]);
}

/**
 * The report itself, for a boundary that cannot use a hook.
 *
 *   #907 THE FOUR CLASS BOUNDARIES ARE NEARER THAN EVERY ROUTE BOUNDARY, AND
 *   #904 DID NOT REACH THEM.
 *
 *   #904 wired the fourteen `error.tsx` files and was right about the defect and
 *   wrong about the reach. React stops at the NEAREST boundary, and
 *   `<ErrorBoundary>` — a class component — wraps the member layout of EVERY
 *   module on this platform:
 *
 *       components/admin/AdminShell          all of /admin
 *       farm-nation/(member)/layout          Farm Nation
 *       marketplace/seller/layout            the seller portal
 *       marketplace/buyer/layout             the buyer portal
 *       export/(app)/layout                  Export
 *       wave/(member)/layout                 WAVE
 *       academy/(learner)/layout             Academy
 *
 *   plus MarketplaceErrorBoundary, GlobalResilienceBoundary and
 *   CooperativeErrorBoundary inside them. So for a signed-in member anywhere in
 *   the application, a class boundary catches the crash and the route boundary
 *   never sees it — and every one of the four ended in `console.error`.
 *
 *   ErrorBoundary's own screen says "Our team has been notified and is working
 *   on a fix." Nothing had been notified. That sentence is now true.
 *
 *   ONE COPY OF THE RULE, which is the arrangement these same files already use
 *   for the reload half: "A class component cannot use the hook the route
 *   boundaries use, so it calls the same budget directly. The RULE is shared;
 *   only the plumbing differs." (#717, in ErrorBoundary.) This is that, for
 *   reporting.
 */
export function reportBoundaryError(
    error: (Error & { digest?: string }) | null | undefined,
    boundary: string,
    /** React's componentDidCatch second argument, where a class has one. */
    errorInfo?: { componentStack?: string | null },
): void {
    /*
     *   EVERYTHING HERE IS GUARDED, BECAUSE THIS RUNS INSIDE THE BOUNDARY.
     *
     *   A throw here replaces the error screen with a blank page — the boundary
     *   that was meant to catch the failure becomes the failure. Caught while
     *   writing the suite beside this: the first version called captureException
     *   bare, and Sentry is not initialised in every environment, so
     *   `Sentry.captureException` can itself throw. A report that cannot be sent
     *   is not worth the page.
     */
    try {
        Sentry.captureException(error, { tags: { boundary } });
    } catch {
        //   Nothing to fall back to: reporting that reporting failed would use
        //   the same channel.
    }

    try {
        //   The action has its own try/catch and returns a verdict rather than
        //   throwing; the `.catch` is for the transport under it — a server
        //   action is a fetch, and an offline browser rejects.
        void logTelemetryAction("error", `UI boundary caught exception: ${boundary}`, {
            boundary,
            digest: error?.digest,
            message: error?.message,
            stack: error?.stack,
            componentStack: errorInfo?.componentStack ?? undefined,
            path: typeof window !== "undefined" ? window.location.pathname : "unknown",
        })?.catch?.(() => { });
    } catch {
        // As above.
    }
}
