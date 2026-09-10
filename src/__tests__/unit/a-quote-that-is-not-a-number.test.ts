/**
 *   #607 THE SAME NaN-PERMEABLE COMPARISON AS #606, ON VALUES READ FROM STORAGE
 *        — AND ONE OF THEM DEFEATS A PRICE PROTECTION.
 *
 *   #606 fixed eleven minimum-amount guards written as `if (amount < MIN)`. This
 *   is the other half of the same shape, written as a floor instead of a
 *   minimum:
 *
 *       if (escrowAmount <= 0) return { error: "Invalid transaction amount" };
 *       if (deliveryFee < 0)   return { error: "Invalid delivery fee" };
 *       if (data.amount <= 0)  return { error: "Invalid repayment amount" };
 *
 *   `NaN <= 0` is false and `NaN < 0` is false, so each of these refuses a zero
 *   and waves NaN through. Two of them read a value out of STORAGE rather than
 *   off a parameter, which is why #606's sweep did not reach them.
 *
 * ── THE ONE THAT IS NOT MERELY A MISSING GUARD ─────────────────────────────
 *
 *   #572 turned the checkout's quoted delivery fee into a CHECK. The buyer is
 *   shown a figure; the server computes its own; if the server's charge would
 *   EXCEED what the screen said, the order is refused and the buyer is asked to
 *   refresh. Being charged more than the screen showed is the thing it prevents.
 *
 *   Both halves of that check compare against the quote:
 *
 *       if (calculatedDeliveryFee > deliveryFee + 1) …refuse…
 *       if (calculatedDeliveryFee < deliveryFee)     …log…
 *
 *   Every comparison with NaN is false. A quote of NaN passes BOTH, and the
 *   buyer is charged whatever the server computes with nothing checking it. The
 *   `< 0` guard at the top of the action is what should have stopped it, and NaN
 *   is not less than zero.
 *
 *   So this is not a guard that merely fails to fire. It is a protection that
 *   can be switched off by the party it protects against being wrong about.
 *
 * ── WHAT I LOOKED AT AND DID NOT CHANGE ─────────────────────────────────────
 *
 *   THE NEGATIVE-AMOUNT QUESTION IS LARGELY ALREADY ANSWERED HERE, and saying so
 *   is the honest result of looking. `platformFeeFor` and `waveCommission` both
 *   refuse `gross <= 0` on the line after their finiteness check; the atomic
 *   increment path in supabase-db deliberately permits negative operands,
 *   because a debit IS `increment(-amount)`. A sign check there would be a bug,
 *   not a fix.
 *
 *   `orders.ts` keeps `if (product.availableQuantity < 0)` unchanged. Its own
 *   comment says it is "kept for the message, not as the guard" — the
 *   reservation upstream already decided — so a NaN passing it costs a clearer
 *   error message and nothing else. Converting it would be churn dressed as a
 *   finding.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { execSync } from 'child_process';
import { isAmountAtLeast, isPositiveAmount } from '@/lib/amount';

describe('#607 — a floor that a non-number cannot cross', () => {
    it('THE OLD FLOOR LET NaN PAST, WHICH IS THE WHOLE FINDING', () => {
        //   Shipped code, run as it ran. Without this the suite would pass just
        //   as well against a guard that was never broken.
        const oldFloor = (v: unknown) => !((v as number) <= 0);
        expect(oldFloor(NaN)).toBe(true);
        expect(oldFloor('abc')).toBe(true);
        expect(oldFloor(undefined)).toBe(true);
        //   And it did stop what it was written to stop, which is why nobody
        //   looked at it again.
        expect(oldFloor(0)).toBe(false);
        expect(oldFloor(-500)).toBe(false);
    });

    it('AND THE REPLACEMENT STOPS ALL OF THEM WHILE STILL ACCEPTING MONEY', () => {
        for (const bad of [NaN, Infinity, 'abc', '500', undefined, null, {}, [], 0, -500]) {
            expect(isPositiveAmount(bad)).toBe(false);
        }
        expect(isPositiveAmount(0.01)).toBe(true);
        expect(isPositiveAmount(250_000)).toBe(true);
    });

    it('A DELIVERY FEE OF EXACTLY ZERO IS STILL A DELIVERY FEE', () => {
        //   Free delivery is a real offer, so this floor is 0 and not MIN_VALUE.
        //   Getting it wrong in the other direction would refuse every free
        //   delivery at checkout — a fix that breaks the thing it guards.
        expect(isAmountAtLeast(0, 0)).toBe(true);
        expect(isAmountAtLeast(1500, 0)).toBe(true);
        expect(isAmountAtLeast(-1, 0)).toBe(false);
        expect(isAmountAtLeast(NaN, 0)).toBe(false);
    });

    it('A QUOTE OF NaN DEFEATS BOTH HALVES OF #572\'s PRICE PROTECTION', () => {
        //   The check as it is written in _payment_orders, with the quote the
        //   buyer was shown on the right-hand side of both comparisons.
        const wouldRefuse = (calculated: number, quoted: unknown) =>
            calculated > (quoted as number) + 1;
        const wouldLogUndercharge = (calculated: number, quoted: unknown) =>
            calculated < (quoted as number);

        //   A real quote that is too low refuses, which is #572 working.
        expect(wouldRefuse(5000, 1000)).toBe(true);

        //   A quote of NaN passes both, so the buyer is charged the server's
        //   figure with nothing comparing it to what they were shown.
        expect(wouldRefuse(5000, NaN)).toBe(false);
        expect(wouldLogUndercharge(5000, NaN)).toBe(false);

        //   Which is exactly what the floor now refuses before either runs.
        expect(isAmountAtLeast(NaN, 0)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

function moneyGuards(pattern: string): string[] {
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
        .filter(l => !l.startsWith('src/lib/amount.ts:'))
        //   Its own comment says it is kept for the message, not as the guard.
        .filter(l => !l.startsWith('src/app/actions/orders.ts:'))
        //   A doc comment quoting the old spelling, not a guard.
        .filter(l => !l.startsWith('src/lib/loan-repayment-amount.ts:'));
}

/**
 * POSIX classes, not `\s` and `\w`.
 *
 * `grep -E` is POSIX ERE, where `\s` matches a literal "s" and `\w` a literal
 * "w" — they are GNU/PCRE shorthands, not ERE ones. The first version of this
 * pattern used both, matched NOTHING, and the cap passed against code that still
 * had the defect. Two mutants that reverted a fixed site SURVIVED, which is how
 * it was found.
 *
 * THE VACUITY GUARD DID NOT CATCH IT, and that is the part worth keeping.
 * Sharing one search FUNCTION — #605's lesson — is not enough when the two
 * patterns differ in which regex features they use: the guard's pattern
 * (`isPositiveAmount\(`) is plain ERE and matched fine, while the cap's silently
 * did not. A guard proves the search reaches the tree; only a mutant proves the
 * pattern finds the thing.
 */
const BARE_FLOOR =
    'if \\([[:space:]]*[A-Za-z0-9_.?]*([Aa]mount|[Pp]rice|[Bb]alance|[Ff]ee)[A-Za-z0-9_.?]*[[:space:]]*<=?[[:space:]]*0[[:space:]]*\\)';

describe('#607 — the spelling does not come back', () => {
    it('NO MONEY GUARD USES A BARE `<= 0` FLOOR', () => {
        expect(moneyGuards(BARE_FLOOR)).toEqual([]);
    });

    it('VACUITY GUARD: THE SAME SEARCH, AGAINST A SPELLING THAT IS STILL THERE', () => {
        //   Through the SAME function. #605 shipped a cap whose guard ran a
        //   different search, so a stubbed-out search passed both; a mutant found
        //   it. This is the shape that survives that mutant.
        expect(moneyGuards(String.raw`isPositiveAmount\(`).length).toBeGreaterThan(0);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     escrow release: `!isPositiveAmount(x)` → `x <= 0`              KILLED (cap)
 *     escrow refund:  the same                                       KILLED (cap)
 *     loan repayment: the same                                       KILLED (cap)
 *     fixed savings:  the same                                       KILLED (cap)
 *     delivery fee (both doors): → `deliveryFee < 0`                 KILLED (cap)
 *     isPositiveAmount: accept 0                                     KILLED
 *     isAmountAtLeast(x, 0): refuse 0                                KILLED
 *     moneyGuards: return [] unconditionally                         KILLED
 *     moneyGuards: ignore the pattern it was given                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE FIRST FIVE ALL SURVIVED THE FIRST ROUND, AND THE REASON IS THE ENTRY
 *   WORTH KEEPING. The cap's pattern used `\s` and `\w` inside `grep -E`, which
 *   is POSIX ERE — there `\s` matches a literal "s". The pattern matched
 *   NOTHING, so the cap passed against every reverted site at once.
 *
 *   ITS VACUITY GUARD DID NOT CATCH THAT. #605's lesson was to run the guard
 *   through the same FUNCTION, and this file did — but the guard's own pattern
 *   (`isPositiveAmount\(`) is plain ERE and matched fine, while the cap's
 *   silently did not. Sharing the function proves the search reaches the tree;
 *   it does not prove the pattern finds the thing. Only reverting a real fix
 *   proves that, which is what these five mutants are for.
 */
