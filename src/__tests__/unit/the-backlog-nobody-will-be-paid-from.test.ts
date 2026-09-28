/**
 * @jest-environment node
 */

/**
 *   #968 THE ROWS THE FIVE-DAY RULE WILL NEVER REACH, AND WHY THAT IS A DECISION
 *        RATHER THAN AN OVERSIGHT.
 *
 *   Re-pointing the unconfirmed auto-release at dispatch made every escrow whose
 *   order had already shipped instantly payable. Asked what the first run should
 *   do about the rows already sitting there, the owner chose: report them, do not
 *   pay them.
 *
 *   NOTHING ENFORCES THAT BUT AN ABSENT FIELD. There is no activation date to
 *   keep in step with a deploy and no flag to leave switched the wrong way — the
 *   dispatch stamp is written at the dispatch EVENT, rows that predate the rule
 *   never saw one, and `where("shippedAt", "<=", …)` does not match a document
 *   that lacks the field. auto-release-pays-the-net.test.ts executes the cron and
 *   proves the money stays put.
 *
 *   THIS SUITE IS ABOUT THE CONSEQUENCE. Those rows are not merely unpaid today;
 *   they can never be paid by that path, because the moment that would have
 *   stamped them has passed. A seller who shipped six days before this deployed
 *   is waiting on a person, and nothing in the running system will ever tell
 *   anybody so. scripts/escrow-unconfirmed-backlog.ts is what tells them, and
 *   the decision it makes per row is what is measured here.
 *
 *   WHY THE CLASSIFIER IS A SEPARATE PURE MODULE. The same reason
 *   export-funding-goal-kind.ts is: the script needs a production database and a
 *   service-role key, neither of which exists in this container, so a rule left
 *   inside it is a rule nobody can test. #967 recorded what it cost to find out
 *   such a rule by guessing — three wrong fixtures before reading the code.
 *
 *   AND THE TWO DUPLICATED CONSTANTS ARE PINNED HERE. scripts/ is outside the
 *   `@/` path alias, and reaching through it has broken the docker build context
 *   check before (#427, #967), so the classifier restates the five-day window and
 *   the awaiting-statuses set. A copy is only acceptable while something fails
 *   when it drifts, which is the last describe block.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     treat an unstamped row as payable                        KILLED
 *     stop distinguishing not-dispatched from pre-rule         KILLED
 *     use > instead of >= at exactly the window                KILLED
 *     round the day count instead of flooring it               KILLED
 *     widen the awaiting set to include "delivered"            KILLED
 *     drift the script's window constant from the module's     KILLED
 *     reword this header                                       SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    classifyBacklogRow,
    DISPATCH_AWAITING_STATUSES,
    type BacklogInput,
} from '../../../scripts/escrow-backlog-classify';
import { ESCROW_DISPATCH_RELEASABLE_FROM } from '@/lib/escrow-status';
import { ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS } from '@/lib/escrow-release-copy';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const WINDOW = ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS;

function row(over: Partial<BacklogInput> = {}): BacklogInput {
    return {
        escrowId: 'esc-1',
        escrowStatus: 'funded',
        escrowShippedAt: null,
        orderShippedAt: null,
        ...over,
    };
}

const verdict = (over: Partial<BacklogInput>) =>
    classifyBacklogRow(row(over), WINDOW, NOW);

// ─────────────────────────────────────────────────────────────────────────────
describe('#968 — which unstamped escrows are stranded', () => {
    it('THE test: shipped before the rule and past the window is OVERDUE AND UNREACHABLE', () => {
        //   The finding an operator is looking for. The order went out eight days
        //   ago, the buyer never confirmed, the escrow has no stamp because the
        //   stamp did not exist then — so no automatic path will ever pay it.
        const v = verdict({ orderShippedAt: daysBefore(8) });

        expect(v.outcome).toBe('overdue-unreachable');
        expect((v as any).daysSinceDispatch).toBe(8);
    });

    it('and shipped before the rule but INSIDE the window is pending, not overdue', () => {
        //   Distinguished because it reads differently to a human: this one is not
        //   yet late by the policy. It will still never be paid automatically,
        //   which is why the script says so under its own heading rather than
        //   filing it with the healthy rows.
        expect(verdict({ orderShippedAt: daysBefore(2) }).outcome).toBe('pending-unreachable');
    });

    it('AND A ROW THAT CARRIES THE STAMP IS THE CRON\'S, NOT THIS REPORT\'S', () => {
        //   Stamped means the cron's query reaches it. Reporting it as stranded
        //   would put healthy rows in front of an operator being asked to move
        //   money by hand, which is the way this report becomes noise and then
        //   gets ignored.
        expect(verdict({
            escrowShippedAt: daysBefore(9),
            orderShippedAt: daysBefore(9),
        }).outcome).toBe('cron-will-pay');
    });

    it('AND AN UNDISPATCHED ORDER IS NOT BACKLOG — there is correctly no clock', () => {
        /*
         *   The distinction the cron's own count cannot make, and the whole
         *   reason this script reads the orders. `unstamped` in the cron response
         *   mixes these two together: an order awaiting dispatch SHOULD have no
         *   deadline, and treating it as a stranded payout would have an operator
         *   paying sellers for goods that never left.
         */
        expect(verdict({ orderShippedAt: null }).outcome).toBe('not-dispatched');
    });

    it('AND A CONFIRMED, DISPUTED OR SETTLED ROW BELONGS TO ANOTHER PATH', () => {
        for (const status of ['delivered', 'disputed', 'released', 'refunded', 'cancelled', 'pending']) {
            const v = verdict({ escrowStatus: status, orderShippedAt: daysBefore(9) });
            expect(v.outcome).toBe('not-awaiting');
        }
    });

    it('AND AN UNREADABLE STATUS IS NOT TREATED AS AWAITING', () => {
        //   #744's direction, applied here: what the row HAS falls back to the
        //   refusing answer. A null status must not be classified as a payout
        //   somebody should make.
        expect(verdict({ escrowStatus: null, orderShippedAt: daysBefore(9) }).outcome)
            .toBe('not-awaiting');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the window boundary', () => {
    it('is inclusive: exactly the window is already overdue', () => {
        //   `>=`, not `>`. Five days after dispatch the cron would have paid a
        //   stamped row, so an unstamped one is overdue at the same instant, not a
        //   day later.
        expect(verdict({ orderShippedAt: daysBefore(WINDOW) }).outcome)
            .toBe('overdue-unreachable');
    });

    it('and a hair inside it is not', () => {
        const justInside = new Date(NOW.getTime() - (WINDOW * 86_400_000) + 60_000);
        expect(classifyBacklogRow(row({ orderShippedAt: justInside }), WINDOW, NOW).outcome)
            .toBe('pending-unreachable');
    });

    it('and the day count is FLOORED, so nothing is reported a day early', () => {
        //   4.9 days has not completed five. Rounding would print "5d" beside a
        //   row the policy does not yet consider late — and this column is what an
        //   operator sorts by when deciding who has waited longest.
        const v = classifyBacklogRow(
            row({ orderShippedAt: new Date(NOW.getTime() - 4.9 * 86_400_000) }),
            WINDOW, NOW,
        );
        expect((v as any).daysSinceDispatch).toBe(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the constants the script had to duplicate', () => {
    /*
     *   scripts/ cannot import through the `@/` alias — a test that reaches into
     *   scripts/ and back has broken the docker build context check twice — so the
     *   classifier and the runner restate two values that belong to src/.
     *
     *   A duplicated constant is only acceptable while something fails when the
     *   copies drift. That is these three assertions, and they are the reason the
     *   duplication is a note in the classifier rather than a defect waiting.
     */
    it('THE AWAITING SET MATCHES lib/escrow-status', () => {
        expect([...DISPATCH_AWAITING_STATUSES].sort())
            .toEqual([...ESCROW_DISPATCH_RELEASABLE_FROM].sort());
    });

    it('AND THE SCRIPT\'S WINDOW MATCHES lib/escrow-release-copy', () => {
        const script = readFileSync(
            join(process.cwd(), 'scripts/escrow-unconfirmed-backlog.ts'), 'utf-8',
        );
        const match = script.match(/const WINDOW_DAYS = (\d+);/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBe(ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS);
    });

    it('AND THE SCRIPT STILL HAS NO WRITE MODE', () => {
        /*
         *   Every row this reports is a payout to a seller on an order nobody
         *   confirmed. The moment it grows an --apply, "report the backlog, do not
         *   pay it" becomes a flag somebody can pass, and the owner's decision
         *   stops being structural.
         *
         *   Asserted on the source because the property IS the absence of a code
         *   path — there is nothing to execute that would demonstrate it.
         */
        const script = readFileSync(
            join(process.cwd(), 'scripts/escrow-unconfirmed-backlog.ts'), 'utf-8',
        );
        expect(script).not.toContain('isApply');
        expect(script).not.toContain("'--apply'");
        expect(script).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
    });
});
