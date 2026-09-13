export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { refuseUnauthorisedCron } from "@/lib/cron-auth";
import { backfillMissingEmails } from "@/lib/missing-email-backfill";

/**
 * Copy the address Supabase Auth already holds onto the profile row.
 *
 *   #702 A REPAIR THAT ONLY RAN WHEN SOMEBODY REMEMBERED TO PRESS IT.
 *
 *   The forensic scan has reported the same 48 profiles with no email address
 *   for weeks. #671 built the repair and it is a good one — it reads the
 *   VERIFIED address Supabase Auth holds against the same account id, fills
 *   only rows that are still blank, never overwrites, and can be run twice.
 *
 *   It was reachable at exactly one door: POST /api/admin/backfill-missing-emails,
 *   behind an admin session. So a repair that is safe, idempotent and complete
 *   sat unrun, while the scan that reports the damage runs on a schedule. The
 *   platform was measuring a problem on a timer and fixing it by hand.
 *
 *   THIS PLATFORM ALREADY HAS THE MACHINERY. Eight jobs run from
 *   .github/workflows/scheduled-jobs.yml through api/cron, behind the shared
 *   CRON_SECRET gate (#659), with failure reporting that distinguishes a bad
 *   secret from a missing route from a job that ran and found a problem. Adding
 *   a ninth is a schedule entry and a route; the repair itself is unchanged and
 *   is not copied — this calls the same function the admin door calls.
 *
 * ── WHY THIS ONE IS SAFE TO RUN UNATTENDED AND ITS SIBLINGS ARE NOT ─────────
 *
 *   The same forensic report carries four other findings, and this is the only
 *   one that can be healed without a person. The difference is not effort, it is
 *   whether the true answer is already known:
 *
 *     THE ADDRESS IS NOT LOST. Supabase Auth holds it, verified, against the
 *     same id. The repair copies a fact from one place to another; it decides
 *     nothing.
 *
 *     45 FARM NATION APPROVALS WITH NO APPLICATION cannot be healed this way.
 *     The two available moves are to fabricate an application so the checker
 *     stops reporting it, or to revoke 45 people's approvals. The first makes
 *     the record lie; the second takes something away from members who may well
 *     be entitled to it.
 *
 *     2 COOPERATIVE MEMBERS WITH NO MEMBERSHIP ROW would need a tier and
 *     balances invented to satisfy the check.
 *
 *     33 DUPLICATE PROFILES — the scan says it itself: "which of somebody's
 *     records is the person is not a decision code should make unattended."
 *
 *   Healing those would turn the report green while making the data worse,
 *   which is the defect this audit exists to find, not to commit.
 */

/** Matches the admin door's page size, so both do the same amount of work. */
const LIMIT = 500;

export async function GET(request: NextRequest) {
    const refusal = refuseUnauthorisedCron(request, "backfill-missing-emails");
    if (refusal) return refusal;

    try {
        const report = await backfillMissingEmails(LIMIT);

        //   A run that repaired nothing is the STEADY STATE, not a failure:
        //   once the backlog is cleared every later run finds nothing, and #479
        //   means a login repairs its own row anyway. Logged at info so a quiet
        //   run is quiet.
        if (report.filled > 0) {
            logger.info(`[cron/backfill-missing-emails] filled ${report.filled} profile(s) from Supabase Auth`);
        }

        /*
         *   A profile whose address Auth does NOT hold either is reported and
         *   not treated as an error. Nothing here can invent one, and answering
         *   500 would make the scheduler shout about a condition no run can
         *   change — which is how a job stops being read.
         *
         *   Counted from the outcomes rather than assumed: `filled` and
         *   `scanned` do not name WHY a row was left, and "scanned - filled"
         *   would fold in `already-had-one`, which is not a problem at all.
         */
        const needsAPerson = report.outcomes.filter(
            (o) => o.result === "no-auth-account" || o.result === "auth-has-no-email" || o.result === "write-failed",
        );
        if (needsAPerson.length > 0) {
            logger.warn(
                `[cron/backfill-missing-emails] ${needsAPerson.length} profile(s) could not be filled from Auth; `
                + `these need a person.`,
                { results: needsAPerson.map((o) => `${o.profileId}:${o.result}`) },
            );
        }

        return NextResponse.json({ ok: true, ...report, needsAPerson: needsAPerson.length });
    } catch (error) {
        logger.error("[cron/backfill-missing-emails] run failed", { error });
        //   500 so the workflow's failure reporting fires: this IS a broken run,
        //   as distinct from a run that found nothing to do.
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
