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
