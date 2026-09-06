/**
 * @jest-environment node
 */

/**
 *   #433 A LOAN DISBURSED ON THE 31st WAS BILLED TWICE IN ONE MONTH AND NOT AT
 *   ALL IN THE NEXT.
 *
 *   Found by a date-arithmetic sweep — every setDate/setMonth/setFullYear call
 *   in the repository, 28 of them. Almost all are "N days ago" cutoffs, where
 *   setDate's overflow is exactly the behaviour wanted. Two were not:
 *
 *       actions/cooperative/_loans_repayments.ts   dueDate.setMonth(+i)
 *       lib/cooperative-tiers.ts                   dueDate.setMonth(+i)
 *
 *   setMonth does not clamp. 31 January + 1 month is asked for as 31 February
 *   and comes back as 3 March. A six-month loan disbursed 31 January 2026:
 *
 *       1   2026-03-03      February gets no payment
 *       2   2026-03-31      two in March, 28 days apart
 *       3   2026-05-01      April gets none
 *       4   2026-05-31      two in May
 *       5   2026-07-01      June gets none
 *       6   2026-07-31      two in July
 *
 *   The borrower is told the loan repays monthly. The rows are written to
 *   LOAN_REPAYMENTS once and read back for the life of the loan, so this is
 *   permanent for every affected loan already issued.
 *
 *   WHAT IT IS NOT. It is not a money defect, and the sweep checked rather than
 *   assumed: the annuity works in whole months and never reads a date, and I
 *   ran both schedule builders side by side over four realistic loans — the
 *   quoted total repayment and the billed total agree to within two kobo, which
 *   is the float-vs-kobo rounding and nothing else. The penalty rule's
 *   seven-day grace absorbs the one-to-three day shift, so no penalty was
 *   charged for it either. What was wrong is what the borrower is told to pay
 *   and when.
 *
 *   TWO COPIES, ONE LIVE, BOTH FIXED. _loans_repayments writes the rows the
 *   borrower's my-loans page and the admin's RecordRepaymentModal both read.
 *   cooperative-tiers' copy is reached only through calculateLoanCost, behind
 *   the loan application wizard, which keeps the interest and discards the
 *   dates — latent, not live. It is fixed by CALLING the rule rather than
 *   restating it, because a second statement is precisely how the fix reaches
 *   one site and not the other (#425, #426, #429, #430, #431, #432).
 *
 *   THE ANCHOR IS THE START DATE, NOT THE PREVIOUS INSTALMENT. 31 January + 2
 *   months must be 31 March, not 28 March. Clamping off the previous clamped
 *   value would let one short February drag the whole remaining schedule
 *   backwards.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     clamp removed (plain setMonth) in the lib          KILLED
 *     clamp anchored on the previous instalment          KILLED
 *     the live builder restates the rule inline          KILLED
 *     cooperative-tiers restates the rule inline         KILLED
 *     addMonthsClamped accepts a non-integer month       KILLED
 *     an invalid start date returns a plausible date     KILLED
 *     reword the header prose                            SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    addMonthsClamped,
    installmentDueDate,
    lastDayOfMonth,
} from '@/lib/loan-schedule-dates';
import { calculateRepaymentSchedule } from '@/lib/cooperative-tiers';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const LIVE = 'src/app/actions/cooperative/_loans_repayments.ts';
const QUOTE = 'src/lib/cooperative-tiers.ts';

/** Local-calendar YYYY-MM-DD, because the rule is deliberately local. */
function ymd(d: Date): string {
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

/** A local-midday date, so no timezone can push the day across a boundary. */
function localDate(y: number, m: number, day: number): Date {
    return new Date(y, m - 1, day, 12, 0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#433 — the defect itself: a month-end start no longer rolls forward', () => {
    it('A SIX-MONTH LOAN DISBURSED ON 31 JANUARY FALLS DUE ON SIX DIFFERENT MONTHS', () => {
        const start = localDate(2026, 1, 31);
        const due = [1, 2, 3, 4, 5, 6].map((i) => ymd(installmentDueDate(start, i)));

        expect(due).toEqual([
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
            '2026-05-31',
            '2026-06-30',
            '2026-07-31',
        ]);

        // The property the borrower actually cares about, stated on its own so
        // it survives any change to the expected list above: one payment per
        // calendar month, never two and never none.
        const months = due.map((d) => d.slice(0, 7));
        expect(new Set(months).size).toBe(months.length);
    });

    it('and the old output is what this replaced — the rollover, demonstrated', () => {
        // Not a test of production code. It pins the arithmetic the finding is
        // about, so the claim in the header is checkable rather than asserted.
        const rolled = [1, 2, 3, 4, 5, 6].map((i) => {
            const d = localDate(2026, 1, 31);
            d.setMonth(d.getMonth() + i);
            return ymd(d);
        });
        expect(rolled).toEqual([
            '2026-03-03', '2026-03-31', '2026-05-01',
            '2026-05-31', '2026-07-01', '2026-07-31',
        ]);
        // Three of the six months carried two payments.
        expect(new Set(rolled.map((d) => d.slice(0, 7))).size).toBe(3);
    });

    it('and the maturity date is the term, not the term plus a few days', () => {
        // Disbursed 31 August, the old sixth instalment landed on 3 March —
        // six months and three days, because the rollover compounds.
        expect(ymd(installmentDueDate(localDate(2026, 8, 31), 6))).toBe('2027-02-28');
    });

    it('THE ANCHOR IS THE START DATE, NOT THE PREVIOUS INSTALMENT', () => {
        // 31 Jan -> 28 Feb -> and then back to 31 March. Anchoring on the
        // clamped February would give 28 March and drag every later instalment
        // backwards for the rest of the term.
        const start = localDate(2026, 1, 31);
        expect(ymd(installmentDueDate(start, 1))).toBe('2026-02-28');
        expect(ymd(installmentDueDate(start, 2))).toBe('2026-03-31');
        expect(ymd(installmentDueDate(start, 3))).toBe('2026-04-30');
        expect(ymd(installmentDueDate(start, 4))).toBe('2026-05-31');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#433 — addMonthsClamped', () => {
    it('leaves an ordinary day-of-month alone', () => {
        expect(ymd(addMonthsClamped(localDate(2026, 1, 15), 1))).toBe('2026-02-15');
        expect(ymd(addMonthsClamped(localDate(2026, 1, 15), 6))).toBe('2026-07-15');
    });

    it('clamps 31 into every short month', () => {
        const s = localDate(2026, 3, 31);
        expect(ymd(addMonthsClamped(s, 1))).toBe('2026-04-30');
        expect(ymd(addMonthsClamped(s, 3))).toBe('2026-06-30');
        expect(ymd(addMonthsClamped(s, 6))).toBe('2026-09-30');
        expect(ymd(addMonthsClamped(s, 8))).toBe('2026-11-30');
    });

    it('handles February in both a common and a leap year', () => {
        expect(ymd(addMonthsClamped(localDate(2026, 1, 29), 1))).toBe('2026-02-28');
        expect(ymd(addMonthsClamped(localDate(2026, 1, 30), 1))).toBe('2026-02-28');
        expect(ymd(addMonthsClamped(localDate(2028, 1, 29), 1))).toBe('2028-02-29');
        expect(ymd(addMonthsClamped(localDate(2028, 1, 31), 1))).toBe('2028-02-29');
        // 1900 is not a leap year and 2000 is; the platform Date gets this
        // right and lastDayOfMonth inherits it rather than restating the rule.
        expect(lastDayOfMonth(1900, 1)).toBe(28);
        expect(lastDayOfMonth(2000, 1)).toBe(29);
    });

    it('crosses the year boundary', () => {
        expect(ymd(addMonthsClamped(localDate(2026, 12, 31), 1))).toBe('2027-01-31');
        expect(ymd(addMonthsClamped(localDate(2026, 10, 31), 4))).toBe('2027-02-28');
        expect(ymd(addMonthsClamped(localDate(2026, 1, 31), 24))).toBe('2028-01-31');
    });

    it('preserves the time of day and does not mutate its argument', () => {
        const start = new Date(2026, 0, 31, 9, 30, 15, 250);
        const out = addMonthsClamped(start, 1);
        expect([out.getHours(), out.getMinutes(), out.getSeconds(), out.getMilliseconds()])
            .toEqual([9, 30, 15, 250]);
        expect(ymd(start)).toBe('2026-01-31');
    });

    it('accepts zero and negative months', () => {
        expect(ymd(addMonthsClamped(localDate(2026, 1, 31), 0))).toBe('2026-01-31');
        expect(ymd(addMonthsClamped(localDate(2026, 3, 31), -1))).toBe('2026-02-28');
    });

    it('REFUSES nonsense rather than returning a plausible wrong date', () => {
        // setDate(NaN) quietly produces an Invalid Date that no comparison ever
        // catches — the shape #275 recorded on the escrow extension. An
        // Invalid Date here fails where the schedule is written.
        expect(Number.isNaN(addMonthsClamped(new Date(NaN), 1).getTime())).toBe(true);
        expect(Number.isNaN(addMonthsClamped(localDate(2026, 1, 31), NaN).getTime())).toBe(true);
        expect(Number.isNaN(addMonthsClamped(localDate(2026, 1, 31), 1.5).getTime())).toBe(true);
        expect(Number.isNaN(addMonthsClamped(localDate(2026, 1, 31), Infinity).getTime())).toBe(true);
        expect(Number.isNaN(addMonthsClamped('2026-01-31' as any, 1).getTime())).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#433 — both schedule builders use the one rule', () => {
    it('THE LIVE BUILDER CALLS IT AND DOES NOT RESTATE IT', () => {
        const src = code(LIVE);
        expect(src).toMatch(/installmentDueDate\(startDate, i\)/);
        expect(src).toMatch(/from "@\/lib\/loan-schedule-dates"/);
        // The defect, in the exact form it had.
        expect(src).not.toMatch(/setMonth\(/);
    });

    it('and so does the quote builder, whose copy was latent', () => {
        const src = code(QUOTE);
        expect(src).toMatch(/installmentDueDate\(startDate, i\)/);
        expect(src).toMatch(/from "@\/lib\/loan-schedule-dates"/);
        expect(src).not.toMatch(/setMonth\(/);
    });

    it('and the quote builder really produces the clamped dates at runtime', () => {
        // Source text says it imports the rule; this says the schedule it
        // returns actually carries the rule's output. The source assertion
        // above cannot tell the difference.
        const schedule = calculateRepaymentSchedule(120_000, 2, 6, localDate(2026, 1, 31));
        expect(schedule.map((inst) => ymd(inst.dueDate))).toEqual([
            '2026-02-28', '2026-03-31', '2026-04-30',
            '2026-05-31', '2026-06-30', '2026-07-31',
        ]);
    });

    it('and the rule lives in one module, not two', () => {
        const rule = code('src/lib/loan-schedule-dates.ts');
        expect(rule).toMatch(/export function addMonthsClamped/);
        expect(rule).toMatch(/export function installmentDueDate/);
        // The one deliberate use of Date's overflow: day 0 of the next month.
        expect(rule).toMatch(/new Date\(year, monthIndex \+ 1, 0\)\.getDate\(\)/);
    });
});
