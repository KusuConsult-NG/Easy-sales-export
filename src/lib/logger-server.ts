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
}): Promise<void> {
    if (typeof window !== 'undefined') return;

    try {
        const { getAdminDb } = await import("@/lib/firebase-admin");
        const db = getAdminDb();
        const traceRef = db.collection("error_observability_traces").doc();
        await traceRef.set({
            ...trace,
            timestamp: new Date().toISOString(),
            createdAt: new Date()
        });
    } catch (e) {
        console.error("[LoggerServer] Failed to write observability trace:", e);
    }
}
