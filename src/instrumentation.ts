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
