/**
 *   #606 ELEVEN MINIMUM-AMOUNT GUARDS ON THE MONEY PATHS, AND NaN WALKS PAST
 *        EVERY ONE.
 *
 *   `the-last-seeded-screen.test.tsx` closed #589 by naming what the bare-row
 *   probe does NOT answer: "It does not find a field of the wrong TYPE, a
 *   negative amount, or a date from 1970. Those are separate questions and this
 *   instrument does not answer them." This is the first of those three, taken on
 *   the paths where being wrong costs money.
 *
 *   Every money entry point says some version of:
 *
 *       if (amount < 5000)  return { error: "Minimum withdrawal is ₦5,000" };
 *       if (amount < 1000)  return { error: "Minimum contribution is ₦1,000" };
 *       if (amountInNaira < 50000 || amountInNaira > 10000000) return …
 *
 *   EVERY COMPARISON WITH NaN IS FALSE, so none of these fire and the value goes
 *   through. The two-sided bound is the one worth staring at: `< 50000 ||
 *   > 10000000` constrains from both directions and NaN fails both halves, so
 *   the single value that is not a number is the single value it cannot stop.
 *
 * ── THE TYPE ANNOTATION IS NOT THE CHECK ────────────────────────────────────
 *
 *   `async function withdrawEarningsAction(amount: number)` is a SERVER ACTION.
 *   The annotation is erased at compile time and what arrives is whatever the
 *   caller serialised — and the caller is a browser. This is #597's
 *   `formatDate(date: Date)` and #605's `as Timestamp`, on withdrawals.
 *
 *   AND THE BROWSER ALREADY DOES IT RIGHT, WHICH IS THE UNCOMFORTABLE PART:
 *
 *       // WaveEarningsClient.tsx
 *       const amount = parseCurrencyStringToFloat(withdrawalAmount);
 *       if (isNaN(amount) || amount < 5000) { …refuse… }
 *
 *   The exact check the server needs was written and shipped on the one side of
 *   the boundary where it protects nobody.
 *
 * ── WHAT IT WOULD HAVE COST, STATED HONESTLY ────────────────────────────────
 *
 *   On /wave earnings the amount reaches `debitJsonbBalance({ amount })` and a
 *   `wallet_transactions` row of `-amount`. The SUFFICIENCY check on the way had
 *   the same shape — `(paidAmount || 0) < amount` — so it passed too: two guards
 *   on one path, both defeated by one value.
 *
 *   THAT PATH IS DISABLED TODAY. `wave_withdrawals` defaults to false and the
 *   action refuses before reaching any of this, so nothing states that money has
 *   moved this way. It is fixed because the toggle is a switch somebody will
 *   turn on, and because the other ten guards are not behind a toggle at all.
 *
 * ── THE IDIOM EXISTED, ONCE ─────────────────────────────────────────────────
 *
 *   `loan-actions.ts` disburses on `if (!(amount > 0))` — negated, so NaN takes
 *   the refusing branch. That spelling appears EXACTLY ONCE in the repository.
 *   Eleven sites used the form NaN survives. #439's lesson again: a rule stated
 *   by hand at every call site is a rule applied at most of them.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { execSync } from 'child_process';
import { isAmountAtLeast, isPositiveAmount } from '@/lib/amount';

/** Everything a browser can serialise that is not a sum of money. */
const NOT_AN_AMOUNT: [string, unknown][] = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a numeric string', '5000'],
    ['a non-numeric string', 'abc'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['an object', { amount: 5000 }],
    ['an array', [5000]],
];

describe('#606 — a minimum that a non-number cannot walk past', () => {
    it.each(NOT_AN_AMOUNT)('REFUSES %s', (_name, value) => {
        expect(isAmountAtLeast(value, 5000)).toBe(false);
    });

    it('AND THE OLD SPELLING REALLY DID LET THEM THROUGH — THE CONTROL', () => {
        //   Without this the suite would pass just as well against a guard that
        //   was never broken. This is the shipped code, run as it ran.
        const passedTheOldGuard = NOT_AN_AMOUNT
            .filter(([, v]) => !((v as number) < 5000))
            .map(([name]) => name);

        //   MEASURED, NOT PREDICTED. I wrote this list by hand first and got it
        //   wrong in both directions: `true` and `null` coerce to 1 and 0, so the
        //   old guard DID stop them, while `undefined` and `[5000]` sail through
        //   — the array because `[5000] < 5000` stringifies to "5000" and 5000 is
        //   not less than 5000.
        //
        //   `undefined` is the entry that matters. An argument simply left off a
        //   server-action call cleared a minimum-amount check.
        expect(passedTheOldGuard).toEqual([
            'NaN', 'Infinity', 'a numeric string', 'a non-numeric string',
            'undefined', 'an object', 'an array',
        ]);
    });

    it('AND THE TWO-SIDED BOUND WAS NO BETTER, WHICH IS THE COUNTER-INTUITIVE PART', () => {
        //   `< 50000 || > 10000000` reads as airtight. NaN fails both halves.
        const oldTwoSided = (v: unknown) => !((v as number) < 50000 || (v as number) > 10000000);
        expect(oldTwoSided(NaN)).toBe(true);
        expect(isAmountAtLeast(NaN, 50000, 10000000)).toBe(false);

        //   And it still refuses what it was written to refuse.
        expect(isAmountAtLeast(49999, 50000, 10000000)).toBe(false);
        expect(isAmountAtLeast(10000001, 50000, 10000000)).toBe(false);
        expect(isAmountAtLeast(50000, 50000, 10000000)).toBe(true);
        expect(isAmountAtLeast(10000000, 50000, 10000000)).toBe(true);
    });

    it('A REAL AMOUNT IS STILL ACCEPTED, INCLUDING EXACTLY THE MINIMUM', () => {
        //   Or this would be a guard that refuses everything, which passes every
        //   test above and breaks every payment.
        expect(isAmountAtLeast(5000, 5000)).toBe(true);
        expect(isAmountAtLeast(5000.5, 5000)).toBe(true);
        expect(isAmountAtLeast(1_000_000, 5000)).toBe(true);
        expect(isAmountAtLeast(4999.99, 5000)).toBe(false);
        expect(isAmountAtLeast(-5000, 5000)).toBe(false);
    });

    it('AND A MINIMUM OF ZERO STILL REFUSES NaN, WHERE `>= 0` WOULD NOT', () => {
        //   The case a caller is most likely to write by hand and get wrong.
        expect(isAmountAtLeast(NaN, 0)).toBe(false);
        expect(isAmountAtLeast(0, 0)).toBe(true);
        expect(isPositiveAmount(0)).toBe(false);
        expect(isPositiveAmount(NaN)).toBe(false);
        expect(isPositiveAmount(0.01)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE CAP. A money guard is not written as a bare `<` against a minimum.
 *
 * A search rather than a list, because the defect is the SPELLING: the next one
 * will be in a file that does not exist yet.
 */
function bareAmountComparisons(pattern: string): string[] {
    let out = '';
    try {
        out = execSync(
            `grep -rnE ${JSON.stringify(pattern)} src/app/actions src/lib --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        );
    } catch {
        out = '';
    }
    return out.split('\n').map(l => l.trim()).filter(Boolean)
        //   Where the rule lives, and where it is described.
        .filter(l => !l.startsWith('src/lib/amount.ts:'));
}

const BARE_MINIMUM_GUARD = String.raw`if \((amount|amountInNaira|parsedAmount|investmentAmount) < `;

describe('#606 — the spelling does not come back', () => {
    it('NO MONEY GUARD COMPARES AN AMOUNT TO ITS MINIMUM WITH A BARE `<`', () => {
        expect(bareAmountComparisons(BARE_MINIMUM_GUARD)).toEqual([]);
    });

    it('VACUITY GUARD: THE SAME SEARCH, AGAINST A SPELLING THAT IS STILL THERE', () => {
        //   Through the SAME function, or the cap and its guard are two checks
        //   that cannot fail rather than one. #605 shipped that mistake and a
        //   mutant found it; this is the shape that survives the mutant.
        expect(bareAmountComparisons(String.raw`isAmountAtLeast\(`).length).toBeGreaterThan(0);
    });

    it('AND THE ELEVENTH SITE — THE ONE THAT WAS ALWAYS RIGHT — IS STILL THERE', () => {
        //   `!(amount > 0)` in loan-actions is the idiom the other ten were
        //   missing. If it ever disappears, the argument in this file's header
        //   stops being true and somebody should notice.
        const negated = bareAmountComparisons(String.raw`if \(!\(amount > 0\)\)`);
        expect(negated.some(l => l.startsWith('src/app/actions/loan-actions.ts:'))).toBe(true);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     isAmountAtLeast: drop the Number.isFinite check                KILLED
 *     isAmountAtLeast: drop the typeof check (accept strings)        KILLED
 *     isAmountAtLeast: `>= minimum` → `> minimum`                    KILLED
 *     isAmountAtLeast: `<= maximum` → `< maximum`                    KILLED
 *     isAmountAtLeast: ignore `maximum` entirely                     KILLED
 *     isAmountAtLeast: return true always                            KILLED
 *     isPositiveAmount: minimum 0 instead of MIN_VALUE               KILLED
 *     one swept site put back to `if (amount < 5000)`                KILLED (the
 *                   cap, which is why it is a search and not a list)
 *     bareAmountComparisons: return [] unconditionally               KILLED (the
 *                   vacuity guard, built the way #605's had to be rebuilt)
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
