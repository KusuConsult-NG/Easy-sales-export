/**
 * Server-only logger utilities that import firebase-admin.
 * Keeps the standard logger.ts client-safe.
 */

export async function logObservabilityTrace(trace: {
    rootCause: string;
    affectedModule: string;
    userState: string;
    queryOrAction: string;
    stackTrace: string;
    sessionContext: any;
    route?: string;
}): Promise<void> {
    if (typeof window !== 'undefined') return;

    try {
        const { getAdminDb } = await import("@/lib/firebase-admin");
        const db = getAdminDb();
        const traceRef = db.collection("error_observability_traces").doc();
        
        let route = trace.route || "unknown";
        if (route === "unknown") {
            try {
                const { headers } = await import("next/headers");
                const headerList = await headers();
                route = headerList.get("x-url") || headerList.get("referer") || "unknown";
            } catch (e) {
                // quiet fail if outside request context
            }
        }

        await traceRef.set({
            ...trace,
            route,
            timestamp: new Date().toISOString(),
            createdAt: new Date()
        });
    } catch (e) {
        console.error("[LoggerServer] Failed to write observability trace:", e);
    }
}
