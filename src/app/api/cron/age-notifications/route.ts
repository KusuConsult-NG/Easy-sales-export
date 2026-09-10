export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { ageingDecision, archivedFields, NOTIFICATION_ARCHIVE_AFTER_DAYS } from "@/lib/notification-ageing";

/**
 * Take notifications off the list once they have stopped being news.
 *
 *   #615 NOTHING AGED A NOTIFICATION OUT.
 *
 *        #534 recorded it: "two months of 'New WAVE Application' in a single
 *        column, back to the first submission — notifyAdmins writes one row per
 *        admin per application, nothing ages a notification out". #534 put a
 *        window on the SCREEN and said the store still grows without bound.
 *        This is that half, and it was offered there and not built until now.
 *
 *   WHAT IT DOES
 *
 *        Marks `archived: true` and `archivedAt` on rows past the window in
 *        lib/notification-ageing — thirty days once read, six months if never
 *        read. The reader that feeds the list and the bell skips archived rows.
 *
 *   WHAT IT WILL NOT DO
 *
 *        NOTHING IS DELETED. Every field the row had, it keeps; clearing the
 *        flag puts it back on the list. A notification is the only record that
 *        somebody was told something, and destroying that to shorten a list
 *        would trade a real fact for a cosmetic one.
 *
 *        AND NOTHING WITHOUT A DATE IS TOUCHED. A row whose createdAt cannot be
 *        read is reported as `undated` and left alone — "we cannot tell how old
 *        this is" must not become "old enough to hide".
 *
 *   IDEMPOTENT AND CATCH-UP, like its siblings: a row already archived is
 *   skipped, and anything not reached this run is reached next run. A late or
 *   missed run costs latency, not correctness.
 *
 * Authorization: Bearer CRON_SECRET, as with the other cron routes.
 */

/** Rows examined per run. Anything not reached is reached next run. */
const MAX_PER_RUN = 1000;

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
    let archived = 0;
    let undated = 0;
    let current = 0;
    let alreadyArchived = 0;
    const failures: string[] = [];

    try {
        //   Oldest first: the rows most likely to be past the window are the ones
        //   worth spending this run's budget on. A newest-first sweep would spend
        //   every run re-reading rows that are plainly current.
        const snap = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .orderBy("createdAt", "asc")
            .limit(MAX_PER_RUN)
            .get();

        for (const doc of snap.docs) {
            const data = doc.data() ?? {};
            const decision = ageingDecision(data, now);

            if (!decision.archive) {
                if (decision.reason === "no_timestamp") undated++;
                else if (decision.reason === "already_archived") alreadyArchived++;
                else current++;
                continue;
            }

            try {
                //   updateExisting, not update: #612 — a row deleted between the
                //   read above and this write is a no-op that would otherwise be
                //   counted as archived.
                const wrote = await db
                    .collection(COLLECTIONS.NOTIFICATIONS)
                    .doc(doc.id)
                    .updateExisting(archivedFields(now));
                if (wrote) archived++;
                else failures.push(`${doc.id}: no longer exists`);
            } catch (err) {
                //   One row that will not write must not end the sweep — the rest
                //   are still worth ageing, and this run is idempotent so the
                //   failure is retried next time.
                failures.push(`${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        if (snap.truncated) {
            logger.warn("[age-notifications] read was truncated; the remainder is next run's work");
        }

        logger.info("[age-notifications] swept", {
            examined: snap.docs.length, archived, current, alreadyArchived, undated,
            failures: failures.length,
        });

        return NextResponse.json({
            success: true,
            examined: snap.docs.length,
            archived,
            current,
            alreadyArchived,
            //   Reported rather than hidden: a growing `undated` count means rows
            //   are arriving without a usable createdAt, which is a defect in a
            //   writer and not something this job should paper over.
            undated,
            failures,
            windows: NOTIFICATION_ARCHIVE_AFTER_DAYS,
        });
    } catch (error) {
        logger.error("[age-notifications] sweep failed", { error });
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Sweep failed" },
            { status: 500 },
        );
    }
}
