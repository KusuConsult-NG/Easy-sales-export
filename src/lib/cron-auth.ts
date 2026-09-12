import "server-only";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { bearerToken, secretsMatch } from "@/lib/secret-compare";

/**
 * The one gate in front of every cron route.
 *
 *   #659 EIGHT HAND-WRITTEN COPIES OF ONE CONTRACT, AND THEY HAD ALREADY
 *   DRIFTED.
 *
 *   Every route under api/cron carried its own four lines:
 *
 *       const cronSecret = process.env.CRON_SECRET;
 *       if (!cronSecret) return 500;
 *       if (authHeader !== `Bearer ${cronSecret}`) return 401;
 *
 *   All eight compared with `!==` — see lib/secret-compare for that half. What
 *   is here is the other half: eight statements of one rule, already differing
 *   in four ways.
 *
 *     THE REFUSAL IS LOGGED         by gdpr-purge and release-escrow. The other
 *                                   six refuse silently, so an unauthorised
 *                                   attempt on the escrow-reconciliation
 *                                   trigger left no trace at all.
 *     THE BODY                      `{error: "Unauthorized. Provide
 *                                   Authorization: Bearer <CRON_SECRET>"}` in
 *                                   five, `{error: "Unauthorized"}` in two, and
 *                                   process-email-queue answered with PLAIN
 *                                   TEXT, so a caller parsing JSON got a parse
 *                                   error instead of a reason.
 *     THE HEADER NAME               "authorization" in six, "Authorization" in
 *                                   two. Harmless — Headers.get is
 *                                   case-insensitive — and exactly the kind of
 *                                   thing that shows nobody was comparing these
 *                                   files.
 *     A REDUNDANT NULL CHECK        reconcile-paystack alone wrote
 *                                   `!authHeader || authHeader !== ...`.
 *
 *   None of those four was a defect on its own. Together they are the reason
 *   this codebase keeps producing the one that is: a rule restated eight times
 *   is a rule that will be corrected in some of them.
 *
 * ── WHAT IT KEEPS ───────────────────────────────────────────────────────────
 *
 *   The two behaviours that were already right everywhere, because
 *   cron-secret-fail-closed pins them and they are what make this gate worth
 *   having:
 *
 *     · an UNSET secret is a 500 and the job does not run. The bug that test
 *       was written for is that `` `Bearer ${undefined}` `` is the perfectly
 *       matchable string "Bearer undefined", so an unset secret became a
 *       PUBLISHED credential for payouts and for account deletion.
 *     · a wrong or missing header is a 401 and the job does not run.
 */

export interface CronAuthResult {
    /** Non-null when the caller must be refused: return it unchanged. */
    refusal: NextResponse | null;
}

/**
 * May this request run `job`?
 *
 * Returns the response to send when it may not, and null when it may.
 *
 *     const refusal = refuseUnauthorisedCron(request, "release-escrow");
 *     if (refusal) return refusal;
 */
export function refuseUnauthorisedCron(
    request: { headers: { get(name: string): string | null } },
    job: string,
): NextResponse | null {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        //   Logged for every job now, not for two of them.
        logger.error(`[${job}] CRON_SECRET is not configured; refusing to run`);
        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }

    const provided = bearerToken(request.headers.get("authorization"));

    if (!secretsMatch(provided, cronSecret)) {
        logger.warn(`[${job}] unauthorised cron trigger refused`);
        return NextResponse.json(
            { error: "Unauthorized. Provide Authorization: Bearer <CRON_SECRET>" },
            { status: 401 },
        );
    }

    return null;
}
