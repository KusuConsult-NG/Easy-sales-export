/**
 * @jest-environment node
 */

/**
 *   #807 THE SECOND WITHDRAWAL DOOR VALIDATED LESS THAN THE FIRST.
 *
 *   THREE doors take a cooperative withdrawal request, and I first wrote this
 *   up as two — #606 had already catalogued all three in
 *   withdrawal-reservation-contract, whose own note says "three doors, three
 *   different levels of protection, one of them none ... exactly what this
 *   table was built to make visible". Reading that table is what corrected me.
 *
 *       _withdrawal.ts     parses `withdrawalSchema`            strongest
 *       _coop_money.ts     isAmountAtLeast(amount, MINIMUM)     safe
 *       THIS ROUTE         truthiness                           weakest
 *
 *   The one the app uses is requestWithdrawalAction. This route checked:
 *
 *       if (!amount || amount < COOPERATIVE_MINIMUM_WITHDRAWAL)
 *       if (!accountNumber || !bankName || !accountName)
 *
 *   MEASURED against the schema, what the second door accepted and the first
 *   refuses:
 *
 *     amount: "5000"      a STRING. Truthy, and "5000" < 1000 is false, so it
 *                         passed — then reached debitJsonbBalanceWithFloor,
 *                         whose guard is Number.isFinite, which a string
 *                         fails. It THROWS, the route catches, and the member
 *                         is told "Internal server error".
 *     amount: Infinity    both checks false. The same road.
 *     amount: 5e9         no upper bound here; the schema caps at 100,000,000.
 *     accountNumber: "1"  truthy. The schema requires EXACTLY TEN DIGITS, and
 *                         an admin marking that request completed would be
 *                         paying out to a number that cannot be an account.
 *
 * ── STATED AS LATENT, BECAUSE IT IS ─────────────────────────────────────────
 *
 *   NOTHING CALLS THIS ROUTE. _withdrawal.ts says so outright: "It guarded only
 *   /api/cooperative/withdraw, which nothing calls." And no money could move
 *   through the bad amounts — the ledger's own finiteness guard fails closed,
 *   and the atomic floor debit refuses anything the balance will not cover.
 *
 *   So this is not a live money defect and is not written up as one. It is an
 *   uncalled door that answers, and #432 already set the policy for those:
 *   "an API route is reachable by URL whether or not a screen calls it: unlike
 *   a dead module, this one answers."
 *
 *   The account-number gap is the one that would have cost something real, and
 *   it needs no exotic caller — just a request with a three-digit account.
 *
 * ── ONE SCHEMA ──────────────────────────────────────────────────────────────
 *
 *   The route parses the same `withdrawalSchema` the action does, rather than
 *   carrying a second spelling of the same rule. Two doors with their own copy
 *   is the defect this audit has now found in marketplace (#794, #802), farm
 *   nation (#803) and here.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the route parses but ignores the result (the #741 shape)         KILLED
 *     the route takes its values from the RAW body again               KILLED
 *     the schema's account-number regex relaxed                        KILLED
 *     the schema's upper bound removed                                 KILLED
 *     the schema's .positive() removed                                 KILLED
 *     reword a comment / unmutated baseline               SURVIVED, both intended
 *
 *     the cooperative minimum dropped from the route                SURVIVED
 *                                          → then, one assertion:   KILLED
 *
 *   The survivor is the one worth reading. Neutering the route's minimum check
 *   to `if (false)` left the suite GREEN, because the assertion asked whether
 *   the file MENTIONS COOPERATIVE_MINIMUM_WITHDRAWAL — and the import and the
 *   error message still did.
 *
 *   "The file mentions the rule" is the weakest assertion in this codebase's
 *   vocabulary, and it is the one that let #795 and #799 both look complete.
 *   It is the live comparison now.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { withdrawalSchema } from '@/lib/schemas';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

const ROUTE = 'src/app/api/cooperative/withdraw/route.ts';
const ACTION = 'src/app/actions/cooperative/_withdrawal.ts';

/** A request the live door accepts, as a baseline to mutate one field at a time. */
const GOOD = {
    amount: 25_000,
    accountNumber: '0123456789',
    accountName: 'Amina Ibrahim',
    bankName: 'Zenith Bank',
    reason: 'School fees',
};

const submission = withdrawalSchema.omit({ cooperativeId: true });

// ─────────────────────────────────────────────────────────────────────────────
describe('#807 — the schema, executed', () => {
    it('CONTROL: a real withdrawal request is accepted', () => {
        //   Or every assertion below would pass against a schema that refuses
        //   everything, which is not a fix.
        expect(submission.safeParse(GOOD).success).toBe(true);
    });

    it.each([
        ['a string amount', { amount: '5000' as unknown as number }],
        ['Infinity', { amount: Infinity }],
        ['NaN', { amount: NaN }],
        ['zero', { amount: 0 }],
        ['a negative amount', { amount: -25_000 }],
        ['an amount above the cap', { amount: 5_000_000_000 }],
        ['a three-digit account number', { accountNumber: '1' }],
        ['an account number with letters', { accountNumber: '01234S678X' }],
        ['an empty bank name', { bankName: '' }],
    ])('REFUSES %s', (_label, override) => {
        /*
         *   Each of these passed the old route's truthiness pair. Executed
         *   against the schema rather than asserted about the source, because
         *   "the file mentions withdrawalSchema" would be true of a parse whose
         *   result is thrown away.
         */
        expect(submission.safeParse({ ...GOOD, ...override }).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#807 — and both doors ask it', () => {
    it.each([
        ['the live action', ACTION],
        ['the API route', ROUTE],
    ])('%s PARSES THROUGH withdrawalSchema', (_name, file) => {
        expect(read(file)).toContain('withdrawalSchema');
    });

    it('THE ROUTE ACTS ON THE PARSE RESULT rather than ignoring it', () => {
        /*
         *   A parse whose `success` is never read is the #741 trap in code: the
         *   right call, no effect. The route must refuse on failure and take
         *   its values from `parsed.data`, not from the raw body.
         */
        const src = read(ROUTE);

        expect(src).toMatch(/if \(!parsed\.success\)/);
        expect(src).toMatch(/parsed\.data/);
        //   And the raw body is no longer destructured straight into the write.
        expect(src).not.toMatch(/=\s*await request\.json\(\);\s*\n\s*\n?\s*if \(!amount/);
    });

    it('AND BOTH STILL APPLY THE COOPERATIVE MINIMUM, which the schema does not', () => {
        /*
         *   withdrawalSchema asks only for a positive amount. The cooperative's
         *   own floor is higher and lives in COOPERATIVE_MINIMUM_WITHDRAWAL, so
         *   a fix that replaced the hand-rolled checks with the schema alone
         *   would have QUIETLY LOWERED the minimum to a naira.
         */
        /*
         *   THE COMPARISON, not the mention. The first draft asserted that each
         *   file `includes('COOPERATIVE_MINIMUM_WITHDRAWAL')` — and neutering
         *   the route's `if` to `if (false)` SURVIVED the sweep, because the
         *   import and the message still named the constant.
         *
         *   "The file mentions the rule" is the weakest assertion in this
         *   codebase's vocabulary and it is the one that let #795 and #799 look
         *   complete. It has to be the live comparison.
         */
        for (const file of [ACTION, ROUTE]) {
            const compares = /amount\s*<\s*COOPERATIVE_MINIMUM_WITHDRAWAL/.test(read(file));
            expect({ file, compares }).toEqual({ file, compares: true });
        }
        //   And the schema genuinely does not carry it, which is why both must.
        expect(submission.safeParse({ ...GOOD, amount: 1 }).success).toBe(true);
    });

    it('CONTROL: the live door still has the guards the route never had', () => {
        //   This finding is about raising the second door to the first, not
        //   about levelling them by taking anything off the first.
        const src = read(ACTION);
        for (const guard of ['canTransactAsMember', 'debitJsonbBalanceWithFloor']) {
            expect({ guard, present: src.includes(guard) }).toEqual({ guard, present: true });
        }
    });
});
