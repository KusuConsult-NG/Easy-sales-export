import "server-only";

import { logger } from "@/lib/logger";

/**
 * Work that happens AFTER the person has their answer.
 *
 *   THE MEASUREMENT THAT ASKED FOR THIS:
 *
 *       [slow-action] submitMultiStepWaveApplicationAction took 8145ms
 *       [slow-action] submitMultiStepWaveApplicationAction took 7417ms
 *
 *   The slowest thing on the platform, and by the time those seconds were
 *   being spent THE APPLICATION WAS ALREADY SAVED. The transaction had
 *   committed; what the applicant was waiting for was a confirmation email to
 *   Resend, a query for every admin, a notification row written for each of
 *   them and a push sent to each — none of which changes a single byte of what
 *   comes back to her, which is an application id she already has.
 *
 *   A woman filling in fifty fields, her NIN and her BVN, then watching a
 *   spinner for eight seconds, has every reason to think it failed and press
 *   the button again.
 *
 * ── WHY next/server's `after` AND NOT A FLOATING PROMISE ────────────────────
 *
 *   The audit-log call in that same action was already deferred, by dropping
 *   the promise on the floor with a `.catch()`. That works until it does not:
 *   nothing tracks it, nothing waits for it, and a container recycled between
 *   the response and the resolve loses the work silently.
 *
 *   `after` is the framework's own mechanism for exactly this, documented for
 *   Server Functions, and it runs even when the response ended in an error or
 *   a redirect. Next's docs, node_modules/next/dist/docs — after.md.
 *
 * ── WHAT MUST NOT BE DEFERRED ───────────────────────────────────────────────
 *
 *   ANYTHING THE NEXT READ DEPENDS ON. invalidateUserCache stays awaited in
 *   the WAVE action, because the client calls checkWaveStatusAction about a
 *   second later and that read goes through the very cache entry being
 *   cleared. #692 is this platform's record of what happens when a correction
 *   is invisible to its own reader; deferring an invalidation would be the
 *   same mistake with a timer attached.
 *
 *   The rule: defer what NOTIFIES, await what the answer is READ FROM.
 *
 * ── OUTSIDE A REQUEST, IT STILL HAPPENS ─────────────────────────────────────
 *
 *   `after` THROWS when there is no request scope — a script, a cron, a test.
 *   Silently dropping the work there would mean a cron that notifies nobody,
 *   so the fallback runs it instead. There is no response to be after, which
 *   makes "now" the only honest interpretation.
 *
 * ── AND IT IS LOADED LAZILY, WHICH IS NOT FUSSINESS ─────────────────────────
 *
 *   A static `import { after } from "next/server"` pulls in NextRequest, which
 *   reads the global `Request` at module scope. jsdom has no such global, and
 *   three suites reach this module the ordinary way — a client component
 *   imports the WAVE server actions, which is how server actions are called —
 *   so importing it at the top turned them all red with `ReferenceError:
 *   Request is not defined` before a line of their own code ran.
 *
 *   Requiring it inside the try generalises the fallback from "no request
 *   scope" to "`after` is unavailable for any reason", which is the behaviour
 *   that was wanted in both cases. lib/security-checks loads env-validator the
 *   same way.
 */

/**
 * Deferred work started outside a request scope, so a test can join it.
 *
 * Empty in production: `after` owns the lifecycle there and this set is never
 * written to.
 */
const pendingOutsideRequest = new Set<Promise<void>>();

export function afterResponse(label: string, work: () => Promise<unknown>): void {
    const guarded = async (): Promise<void> => {
        try {
            await work();
        } catch (error) {
            //   Deferred work CANNOT fail the action — the action already
            //   returned. All it can do is say so.
            logger.error(`[after:${label}] deferred work failed`, error);
        }
    };

    try {
        //   See the header: a static import of next/server needs a global
        //   Request, which jsdom does not have.
        const { after } = require("next/server") as typeof import("next/server");
        after(guarded);
    } catch {
        //   No request scope. See the header: run it rather than lose it.
        const started = guarded();
        pendingOutsideRequest.add(started);
        void started.finally(() => pendingOutsideRequest.delete(started));
    }
}

/**
 * Wait for work started outside a request scope.
 *
 * FOR TESTS. A unit test has no request scope, so the fallback above applies
 * and the work is in flight rather than finished when the action returns —
 * which is the production shape, and would otherwise make every assertion
 * about a notification a race.
 */
export async function flushAfterResponses(): Promise<void> {
    while (pendingOutsideRequest.size > 0) {
        await Promise.all([...pendingOutsideRequest]);
    }
}
