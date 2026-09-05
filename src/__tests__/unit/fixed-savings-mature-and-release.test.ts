/**
 * @jest-environment node
 */

/**
 *   #419 A FIXED SAVINGS PLAN MATURES AND NOTHING NOTICES — AND THE MONEY HAD
 *   NO WAY BACK.
 *
 *   Found by a screen-layer sweep for status values a reader tests and no writer
 *   produces. Most hits were artefacts of the scan; this one was not.
 *
 *   THE VOCABULARY WAS "active" | "matured" | "withdrawn", AND TWO OF THE THREE
 *   WERE UNREACHABLE. Five files touch FIXED_SAVINGS_PLANS: two creators, one
 *   reader, one integrity check, one type. Not one of them ever UPDATED a plan.
 *   "matured" and "withdrawn" appeared only in type unions and in the member
 *   screen's filter.
 *
 *   WHAT THE MEMBER SAW. The savings screen renders a "Matured Plans" section
 *   keyed on `status === "matured"`, so it could never appear: a plan whose term
 *   had ended went on displaying as active, with a countdown that had run out.
 *
 *   WHAT MATTERED MORE. Creating a plan DEBITS savingsBalance — that is the
 *   lock, and both ledgers record it. With no maturity and no release, the money
 *   left the member's spendable savings and had nothing to bring it back: no
 *   action, no route, no admin screen, no job. #319's shape (an export return
 *   released to nobody) and #141's (a payout queue nothing reads), on a member's
 *   own savings.
 *
 *   FIXED IN THREE PARTS.
 *
 *     1. MATURITY IS DERIVED. fixedSavingsPlanStatus reads the row and the
 *        clock. No job to add, no backfill to run — and every plan already in
 *        the database becomes correct at the next read, which a backfill would
 *        not manage for rows written while it ran. #275's approach.
 *
 *     2. THE RELEASE EXISTS. withdrawMaturedFixedSavingsAction claims
 *        `active -> withdrawn` through claimStatusTransition BEFORE a naira
 *        moves, credits principal plus the promised interest, and writes the
 *        pair of ledger rows that mirror the funding pair. Claim-then-pay is the
 *        order #249-#251 established for every automated payout here.
 *
 *     3. THE SCREEN OFFERS IT. A matured plan gets a button that says what it
 *        will pay.
 *
 *   IT PAYS THE PROMISED FIGURE, from projectedProfit — written at creation and
 *   shown to the member ever since. Recomputing here would risk paying a
 *   different number from the one they were told, which is #113's and #324's
 *   shape.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     maturity ignores the date                     KILLED
 *     a stored "withdrawn" stops being terminal     KILLED
 *     an unreadable maturity reads as matured       KILLED
 *     the payout drops the interest                 KILLED
 *     the release pays before it claims             KILLED
 *     the reader stops deriving the status          KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    fixedSavingsPlanStatus,
    fixedSavingsPayout,
    fixedSavingsMaturityDate,
    projectedFixedSavingsProfit,
} from '@/lib/cooperative-savings';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const READER = 'src/app/api/cooperative/fixed-savings/route.ts';
const SCREEN = 'src/app/cooperatives/(member)/fixed-savings/page.tsx';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const PAST = new Date('2026-05-01T00:00:00.000Z');
const FUTURE = new Date('2026-07-01T00:00:00.000Z');

/** The body of one function, bounded by the start of the next. */
function body(src: string, fn: string, endMarker: string): string {
    const start = src.indexOf(fn);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#419 — maturity is derived from the row and the clock', () => {
    it('A PLAN PAST ITS MATURITY DATE IS MATURED', () => {
        expect(fixedSavingsPlanStatus({ status: 'active', maturityDate: PAST }, NOW)).toBe('matured');
    });

    it('and one still in its term is active', () => {
        expect(fixedSavingsPlanStatus({ status: 'active', maturityDate: FUTURE }, NOW)).toBe('active');
    });

    it('and a stored "withdrawn" is TERMINAL — the record that money moved', () => {
        // The release claims this transition, so no date arithmetic may
        // override it and offer a second payout.
        expect(fixedSavingsPlanStatus({ status: 'withdrawn', maturityDate: PAST }, NOW)).toBe('withdrawn');
        expect(fixedSavingsPlanStatus({ status: 'withdrawn', maturityDate: FUTURE }, NOW)).toBe('withdrawn');
    });

    it('and an UNREADABLE maturity date is active, not matured', () => {
        /**
         * The direction matters: "matured" is what makes a plan releasable, and
         * releasing moves money. A row whose term cannot be read must not be
         * presented as payable. Fail closed, as #245 put it.
         */
        for (const bad of [undefined, null, '', 'not-a-date', {}, { seconds: 'x' }]) {
            expect({ bad, status: fixedSavingsPlanStatus({ status: 'active', maturityDate: bad }, NOW) })
                .toEqual({ bad, status: 'active' });
        }
    });

    it('and it reads every date shape the adapter hands back', () => {
        const shapes: unknown[] = [
            PAST,
            PAST.getTime(),
            PAST.toISOString(),
            { toDate: () => PAST },
            { seconds: Math.floor(PAST.getTime() / 1000) },
            { _seconds: Math.floor(PAST.getTime() / 1000) },
        ];
        for (const maturityDate of shapes) {
            expect(fixedSavingsPlanStatus({ status: 'active', maturityDate }, NOW)).toBe('matured');
        }
    });

    it('and the boundary is inclusive — on the day, it is matured', () => {
        expect(fixedSavingsPlanStatus({ status: 'active', maturityDate: NOW }, NOW)).toBe('matured');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#419 — the payout is the figure the member was promised', () => {
    it('PRINCIPAL PLUS THE STORED PROJECTED PROFIT', () => {
        expect(fixedSavingsPayout({ amount: 100_000, projectedProfit: 7_000 })).toBe(107_000);
    });

    it('and that figure is the one creation stored, not one recomputed here', () => {
        // If these two ever diverge, a member is paid something other than what
        // the plan page has been showing them. #113/#324's shape.
        const amount = 200_000;
        const months = 6;
        const stored = projectedFixedSavingsProfit(amount, months);
        expect(fixedSavingsPayout({ amount, projectedProfit: stored })).toBe(amount + stored);
        expect(stored).toBeGreaterThan(0);
    });

    it('and a missing or unreadable profit pays the principal, never less', () => {
        expect(fixedSavingsPayout({ amount: 50_000 })).toBe(50_000);
        expect(fixedSavingsPayout({ amount: 50_000, projectedProfit: 'x' })).toBe(50_000);
        expect(fixedSavingsPayout({ amount: 50_000, projectedProfit: -10 })).toBe(50_000);
    });

    it('and an unreadable PRINCIPAL is NaN, so the caller refuses rather than paying', () => {
        for (const amount of [undefined, null, 'x', 0, -5]) {
            expect({ amount, payout: fixedSavingsPayout({ amount }) })
                .toEqual({ amount, payout: NaN });
        }
    });

    it('and maturityDate still uses the 30-day arithmetic existing plans were written with', () => {
        const from = new Date('2026-01-01T00:00:00.000Z');
        expect(fixedSavingsMaturityDate(3, from).getTime())
            .toBe(from.getTime() + 3 * 30 * 24 * 60 * 60 * 1000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#419 — the release claims before it pays', () => {
    const money = () => code(MONEY);
    const release = () =>
        body(money(), 'async function _withdrawMaturedFixedSavingsAction',
             'export const withdrawMaturedFixedSavingsAction');

    it('THE CAS CLAIM COMES BEFORE THE CREDIT', () => {
        const src = release();
        const claim = src.indexOf('claimStatusTransition');
        const credit = src.indexOf('savingsBalance: FieldValue.increment');
        expect(claim).toBeGreaterThan(-1);
        expect(credit).toBeGreaterThan(-1);
        expect(claim).toBeLessThan(credit);
        expect(src).toMatch(/from: "active",\s*\n\s*to: "withdrawn"/);
    });

    it('and it refuses a plan that has not matured', () => {
        const src = release();
        expect(src).toMatch(/fixedSavingsPlanStatus\(plan\)/);
        expect(src).toMatch(/derived !== "matured"/);
        expect(src).toMatch(/has not matured yet/);
    });

    it('and it refuses one already paid out', () => {
        expect(release()).toMatch(/derived === "withdrawn"[\s\S]{0,200}?already been paid out/);
    });

    it('and it refuses an unreadable payout rather than moving it', () => {
        const src = release();
        expect(src).toMatch(/!Number\.isFinite\(payout\) \|\| payout <= 0/);
        expect(src).toMatch(/could not be calculated/);
    });

    it('and it checks OWNERSHIP, answering the same way as a missing plan', () => {
        const src = release();
        expect(src).toMatch(/plan\.memberId !== userId/);
        // Not an existence oracle — the same message either way.
        const notFound = [...src.matchAll(/Fixed savings plan not found/g)];
        expect(notFound.length).toBe(2);
    });

    it('and a failed credit hands the plan back instead of leaving it withdrawn and unpaid', () => {
        const src = release();
        expect(src).toMatch(/from: "withdrawn",\s*\n\s*to: "active"/);
        expect(src).toMatch(/Your plan is unchanged/);
    });

    it('and it writes BOTH ledgers, like the funding path it reverses', () => {
        const src = release();
        expect(src).toMatch(/COLLECTIONS\.TRANSACTIONS/);
        expect(src).toMatch(/COLLECTIONS\.COOPERATIVE_TRANSACTIONS/);
        expect(src).toMatch(/type: "fixed_savings_release"/);
        // A deterministic reference, so a replay overwrites rather than doubling.
        expect(src).toMatch(/const reference = `fixsav_release_\$\{planId\}`/);
    });

    it('and the funding path it reverses really does debit — the premise', () => {
        const funding = body(money(), 'async function _createFixedSavingsAction',
                             'export const createFixedSavingsAction');
        expect(funding).toMatch(/debitJsonbBalance\(/);
        expect(funding).toMatch(/field: "savingsBalance"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#419 — and the member can see it and take it', () => {
    it('THE READER DERIVES THE STATUS, SO EXISTING PLANS ARE CORRECT WITH NO BACKFILL', () => {
        const src = code(READER);
        expect(src).toMatch(/status: fixedSavingsPlanStatus\(data\)/);
        // After the spread, or the stored value would win again.
        expect(src.indexOf('...data')).toBeLessThan(src.indexOf('fixedSavingsPlanStatus(data)'));
    });

    it('and the screen offers the withdrawal on a matured plan', () => {
        const src = code(SCREEN);
        expect(src).toMatch(/withdrawMaturedFixedSavingsAction\(planId\)/);
        expect(src).toMatch(/Withdraw \$\{formatCurrency/);
        expect(src).toMatch(/fixedSavingsPlanStatus\(p\) === "matured"/);
    });

    it('and it reads the refusal rather than assuming success', () => {
        // #406/#337: a server action RESOLVES with { success: false }.
        const src = code(SCREEN);
        expect(src).toMatch(/if \(result\?\.success\)/);
        expect(src).toMatch(/result\?\.error \|\|/);
        expect(src).toMatch(/finally \{\s*setReleasingId\(null\)/);
    });
});
