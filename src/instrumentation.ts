import type { Instrumentation } from "next";
import { isConnectionGoneAway } from "@/lib/request-abort";

export async function register() {
    // Non-blocking initialization to ensure fast boot time on Railway/Docker.
    // This prevents the Load Balancer from marking the container as unhealthy 
    // due to blocked startup during Sentry/Redis connection establishment.
    
    if (process.env.NEXT_RUNTIME === "nodejs") {
        try {
            // Force IPv4-first resolution to prevent transient connection drops (Premature close)
            // on Railway container hosts which lack outbound IPv6 routing.
            const dns = require('dns');
            if (dns && typeof dns.setDefaultResultOrder === 'function') {
                dns.setDefaultResultOrder('ipv4first');
                console.log('[DNS Configuration] Prefer IPv4 resolver order configured in instrumentation.');
            }
            
            /**
             *   #450 THE BOOT REFUSES WHEN THE CONTAINER CANNOT SERVE.
             *
             *        This called logEnvValidation() and carried on. A Railway
             *        container deployed with NO configuration therefore printed
             *        "❌ Environment validation failed!", said "✓ Ready", took
             *        traffic, and died in the middleware on every request with
             *        MissingSecret.
             *
             *        Exiting is the kinder failure: Railway keeps the previous
             *        container when a new one exits, so a misconfigured deploy
             *        leaves the working site up instead of replacing it. The
             *        decision belongs here, at the boot, rather than inside the
             *        validator — see the note there.
             */
            try {
                const { logEnvValidation } = require('./lib/env-validator');
                const result = logEnvValidation();

                if (result?.fatalMissing?.length && process.env.NODE_ENV === 'production') {
                    console.error('[Env Validator] Exiting: cannot serve without', result.fatalMissing.join(', '));
                    process.exit(1);
                }
            } catch (envErr) {
                console.error('[Env Validator] Failed to run environment variable validation:', envErr);
            }
        } catch (e) {
            console.error('[DNS Configuration] Failed to configure DNS result order in instrumentation:', e);
        }

        // Asynchronously initialize Sentry
        import("../sentry.server.config").catch(err => {
            console.error("❌ Sentry Server initialization failed:", err);
        });

        // Asynchronously "warm up" Redis connection (REST based, but helps early module loading)
        import("@/lib/redis").then(({ redis }) => {
            // Optional: Ping Redis to ensure connectivity without blocking
            if (typeof redis.get === 'function') {
                redis.get('health_check_ping').catch(() => {});
            }
        }).catch(err => {
            console.error("❌ Redis initialization failed:", err);
        });

        // Asynchronously warm up Firebase Admin
        import("@/lib/firebase-admin").then(({ getAdminDb }) => {
            getAdminDb();
        }).catch(err => {
            console.error("❌ Firebase Admin warmup failed:", err);
        });
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        import("../sentry.edge.config").catch(err => {
            console.error("❌ Sentry Edge initialization failed:", err);
        });
    }
}

/**
 * Every server error, with the request that caused it.
 *
 *   THE OWNER'S LOG SHOWED TWENTY OF THESE AND NAMED NO ROUTE:
 *
 *       ⨯ Error: The destination stream closed early.
 *           at ignore-listed frames { digest: '2398141500' }
 *
 *   Twenty identical lines, no path, no method, no route — so "a person
 *   navigated away", "one page is too slow and a proxy cut it" and "the
 *   container restarted mid-request" all look exactly the same, and they need
 *   three different answers. Nothing in this codebase recorded which.
 *
 *   `onRequestError` is the hook that has it. It is handed the request path and
 *   method and the route context — which route file, whether the error came
 *   from a render, a route handler, a server action or the proxy — and it fires
 *   for every server error, not just these.
 *
 * ── SO IT DOES TWO THINGS ───────────────────────────────────────────────────
 *
 *   A CLOSED CONNECTION IS LOGGED WITH ITS ROUTE AND NOT SENT TO SENTRY. The
 *   render was fine until nobody was listening, so no stack trace helps — and
 *   at the volume above, reporting them buries the errors somebody could act
 *   on. The log line keeps the volume visible and adds the one fact that makes
 *   it answerable: spread across many routes it is ordinary internet, all on
 *   one route it is that route.
 *
 *   EVERYTHING ELSE GOES TO SENTRY, which is the point of adding the hook at
 *   all. Without an onRequestError export the Sentry SDK receives no server
 *   error from the App Router, so this is not a filter bolted onto reporting —
 *   it is the reporting, with one class of non-fault held back.
 *
 *   `err` is typed `unknown` deliberately: the Next documentation warns that
 *   React may hand back something other than the value that was thrown.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
    try {
        if (isConnectionGoneAway(err)) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
                `[request] the connection closed before the response did — ${request.method} ${request.path} `
                + `(route ${context.routePath ?? "unknown"}, ${context.routeType}`
                + `${context.renderSource ? `/${context.renderSource}` : ""}): ${message}`,
            );
            return;
        }
    } catch {
        //   A classifier that threw must not swallow the error it was
        //   classifying. Fall through and report.
    }

    const { captureRequestError } = await import("@sentry/nextjs");
    captureRequestError(err, request, context);
};
