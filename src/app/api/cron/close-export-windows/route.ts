export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import {
    EXPORT_WINDOW_INVESTABLE_STATUSES,
    EXPORT_WINDOW_CLOSED_STATUS,
    exportWindowHasExpired,
} from "@/lib/export-window-status";

/**
 * Close export windows whose investment period has ended.
 *
 *   #196 NOTHING EVER CLOSED AN EXPIRED EXPORT WINDOW.
 *
 *        #275 established the premise by sweep, and it still holds: a scan for
 *        a writer of "closed" onto export_windows finds none. The string
 *        appears in type unions and status lists and in no assignment anywhere.
 *        No scheduled job, no admin action, no code path moved a window off
 *        "open" when its endDate passed.
 *
 *        #275 fixed the money half — all three investment doors now refuse an
 *        expired window — and recorded the rest as an owner decision. This is
 *        that decision, taken: the windows are CLOSED, and the lists stop
 *        offering them.
 *
 *   WHY BOTH HALVES, AND NOT EITHER ALONE
 *
 *        Filtering the lists alone would leave every stored row saying "open"
 *        for ever, so every future reader of export_windows would have to
 *        remember the deadline rule for itself. That is exactly how the three
 *        investment doors came to disagree — #275's finding — and it is the
 *        defect class this codebase keeps producing.
 *
 *        Closing alone would leave a window that ended between runs listed and
 *        clickable until the next one. So getActiveExportWindowsAction and
 *        getExportOpportunities filter on the same shared predicate, and this
 *        job makes the stored status tell the truth.
 *
 *   WHAT IT WILL NOT DO
 *
 *        NOTHING IS DELETED. A closed window keeps every field it had, and an
 *        admin can move it back to "open" — an aggregation's vocabulary is
 *        open / closed / completed, and refuseExportStatusChange accepts the
 *        transition in both directions.
 *
 *        It only ever moves a window OUT OF an investable status, through a CAS
 *        claim from ["open", "active"]. A shipment window is created "pending"
 *        and never holds either, so this job cannot touch one; an aggregation
 *        an admin has already moved to "completed" is likewise out of reach.
 *        Two concurrent runs cannot both close the same window.
 *
 *        A WINDOW WITH NO endDate IS LEFT ALONE. exportWindowHasExpired treats
 *        an absent or unreadable date as "no deadline", which is the rule the
 *        money guard has always applied — #272's reasoning, not #245's: a
 *        deadline nobody set is not a control that failed.
 *
 *        NO MONEY MOVES HERE. Aggregations are not paid by cron/release-escrow,
 *        which acts on shipment windows at `status == "delivered"`. Closing one
 *        ends its investment period and nothing else; investors keep their
 *        slots and their expected returns untouched.
 *
 * Authorization: Bearer CRON_SECRET, as with the other cron routes.
 */

/**
 * Windows examined per run.
 *
 * A query with no `.limit()` returns at most SUPABASE_DEFAULT_QUERY_LIMIT rows
 * anyway, so the cap is stated rather than inherited. Anything not reached this
 * run is reached on the next; the lists filter in the meantime, so a backlog
 * costs nothing a member can see.
 */
const MAX_PER_RUN = 500;

export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: "Unauthorized. Provide Authorization: Bearer <CRON_SECRET>" },
            { status: 401 },
        );
    }

    const now = new Date();

    try {
        const snapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("status", "in", [...EXPORT_WINDOW_INVESTABLE_STATUSES])
            .limit(MAX_PER_RUN)
            .get();

        // The deadline is applied in JavaScript rather than in the query on
        // purpose: endDate is a JSONB value stored as both a Firestore
        // Timestamp and an ISO string, and a `where` comparison on it is the
        // one #220 found returning nothing at all. The shared predicate reads
        // both shapes.
        const expired = snapshot.docs.filter(
            (doc) => exportWindowHasExpired(doc.data() as { endDate?: unknown }, now),
        );

        const closed: string[] = [];
        const skipped: Array<{ id: string; status: string | null }> = [];
        const failed: Array<{ id: string; reason: string }> = [];

        for (const doc of expired) {
            try {
                const claim = await claimStatusTransitionFromAny({
                    collection: COLLECTIONS.EXPORT_WINDOWS,
                    id: doc.id,
                    fromAny: [...EXPORT_WINDOW_INVESTABLE_STATUSES],
                    to: EXPORT_WINDOW_CLOSED_STATUS,
                    patch: {
                        closedAt: now.toISOString(),
                        closedBy: "cron:close-export-windows",
                    },
                    // So a reopening admin can see what it was, and so a window
                    // that was "active" is not silently reported as "open".
                    recordPreviousAs: "statusBeforeClose",
                });

                if (claim.claimed) {
                    closed.push(doc.id);
                } else {
                    // Not a failure: another run, or an admin, moved it first.
                    skipped.push({ id: doc.id, status: claim.status ?? null });
                }
            } catch (error: any) {
                // One unclosable window must not stop the rest. Reported rather
                // than swallowed — #298/#299's rule: a job that counts a failed
                // write as done is worse than one that does nothing.
                logger.error(`[cron/close-export-windows] ${doc.id} failed:`, error);
                failed.push({ id: doc.id, reason: error?.message ?? "unknown" });
            }
        }

        return NextResponse.json({
            success: failed.length === 0,
            checkedAt: now.toISOString(),
            examined: snapshot.docs.length,
            expired: expired.length,
            closed: closed.length,
            skipped: skipped.length,
            failed: failed.length,
            // Named, not just counted: a window that could not be closed is one
            // an operator has to look at.
            failures: failed,
            // True when the page was full, so a backlog is visible rather than
            // silently truncated.
            mayHaveMore: snapshot.docs.length >= MAX_PER_RUN,
        });
    } catch (error: any) {
        logger.error("[cron/close-export-windows] run failed:", error);
        return NextResponse.json(
            { success: false, error: "Failed to close expired export windows" },
            { status: 500 },
        );
    }
}
