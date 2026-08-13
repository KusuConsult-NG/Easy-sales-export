import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { APP_IDENTIFIERS } from "@/lib/role-app-mapping";
import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";

/** How much metadata one telemetry event may carry into the audit log. */
const MAX_METADATA_BYTES = 4096;

const telemetryLimiter = rateLimit(rateLimitConfig.telemetry);

/**
 * Hub Telemetry Bridge
 * 
 * Allows federated modules (Academy, WAVE, etc.) to report critical
 * business events back to the central Hub for unified auditing and 
 * Upstash/Redis tracking.
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Throttled, because every accepted call writes to the AUDIT LOG.
        //
        // There was no limit. Any authenticated user could add rows to the same
        // collection getAuditLogsAction reads, getAuditStatsAction counts by
        // action, and the CSV export in #150 pages through — so one account
        // could bury the record of what everybody else did, in the one place
        // that is supposed to survive that.
        //
        // Keyed on the account, per #163.
        const limit = await telemetryLimiter.check(session.user.id);
        if (!limit.success) {
            return NextResponse.json({ error: "Too many telemetry events" }, { status: 429 });
        }

        const body = await req.json();
        const { moduleId, event, metadata } = body;

        if (!moduleId || !event) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // All three fields went into the audit log exactly as sent.
        //
        // This route was triaged in an earlier pass and cleared — correctly —
        // on the question it was asked, which was whether it is reachable
        // without a session. It is not. Nobody asked the next question: what
        // does an authenticated caller get to write? The answer was arbitrary
        // rows, of arbitrary size, into the audit trail.
        //
        // moduleId is checked against the real identifier list rather than a
        // fourth copy of it; APP_IDENTIFIERS is exported from role-app-mapping
        // for that, where the list already existed as a local.
        if (!APP_IDENTIFIERS.includes(moduleId)) {
            return NextResponse.json({ error: "Unknown module" }, { status: 400 });
        }

        // The event becomes part of `action`, which is a typed union elsewhere
        // and is what getAuditStatsAction groups by. Restricted so a caller
        // cannot invent an action that reads like one of the real ones, or one
        // long enough to make the statistics unreadable.
        if (typeof event !== "string" || !/^[a-z0-9_]{1,48}$/.test(event)) {
            return NextResponse.json({ error: "Invalid event name" }, { status: 400 });
        }

        // Bounded rather than rejected on shape: telemetry metadata is
        // legitimately open-ended, and the problem was never its structure but
        // that a single call could carry megabytes into the audit collection.
        let safeMetadata: Record<string, unknown> = {};
        if (metadata !== undefined && metadata !== null) {
            if (typeof metadata !== "object" || Array.isArray(metadata)) {
                return NextResponse.json({ error: "metadata must be an object" }, { status: 400 });
            }
            if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
                return NextResponse.json({ error: "metadata is too large" }, { status: 413 });
            }
            safeMetadata = metadata as Record<string, unknown>;
        }

        // 1. Log to Central Hub Audit Log
        await db.collection(COLLECTIONS.AUDIT_LOGS).add({
            userId: session.user.id,
            moduleId,
            action: `telemetry_${event}`,
            metadata: safeMetadata,
            timestamp: FieldValue.serverTimestamp(),
            source: "telemetry_bridge"
        });

        // 2. Optional: Trigger Upstash/Redis Hook for real-time monitoring
        // (Implementation details depend on your Upstash client setup)

        logger.info(`[Telemetry] ${moduleId} reported event: ${event}`, { userId: session.user.id });

        return NextResponse.json({ success: true });

    } catch (error) {
        logger.error("[Telemetry] Bridge error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
