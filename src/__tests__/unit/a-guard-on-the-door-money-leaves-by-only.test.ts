/**
 * @jest-environment node
 */

/**
 *   #706 THE AMOUNT GUARD WAS PUT ON THE DOOR MONEY LEAVES BY AND NOT ON THE
 *        DOOR IT ARRIVES BY.
 *
 *   #251 found that a payout was built as `Math.round(amountNaira * 100)` with
 *   nothing checking the result, and fixed it where it found it —
 *   paystack-transfer.ts, the outbound door. Its reasoning is worth quoting in
 *   full, because it is the argument for this finding too:
 *
 *       "NaN — which is what Math.abs(undefined) or a missing stored field
 *        produces — serialises to `null` in the JSON body; a negative amount
 *        serialises to negative kobo; Infinity to null again. Every one of
 *        those is a request to move money built from a value nobody looked at,
 *        and the amount arrives here from five different stored documents, so
 *        no single caller can be relied on to have checked."
 *
 *   initializePaystackPayment — the door money COMES IN by — had no check of
 *   any kind, and is reached from TEN call sites across export, marketplace,
 *   cooperative, farm nation and academy. Each builds its kobo figure from an
 *   amount read out of a stored document.
 *
 * ── AND THE CONVERSION IS WRITTEN SEVEN TIMES ───────────────────────────────
 *
 *   `nairaToKobo` is exported from paystack.ts, paystack-server.ts and
 *   marketplace-cart.ts, and defined AGAIN as a private one-liner inside
 *   export-payment.ts, cooperative/_payment.ts, farm-nation-payment.ts and
 *   academy/_payment.ts. All seven agree today — `Math.round(naira * 100)` —
 *   so the duplication is not itself a defect and is deliberately NOT churned
 *   here: rewriting seven money call sites to prove a point is the kind of
 *   change this audit exists to avoid.
 *
 *   What the duplication does mean is that no call site can be trusted to have
 *   rounded, which is the argument for checking at the one place they all
 *   reach rather than at seven places they might not.
 *
 * ── THE NON-INTEGER CASE, WHICH THIS CODEBASE HAD ALREADY WRITTEN DOWN ──────
 *
 *   api/cooperative/contribute carries it in a comment: "`amount * 100` on a
 *   fractional naira figure produces a non-integer kobo value, which Paystack
 *   rejects." In binary floating point `19.99 * 100` is 1998.9999999999998, so
 *   the trigger is an ordinary price with kobo in it, not an exotic input.
 *
 *   TWO SITES STILL SENT AN UNROUNDED PRODUCT, and one of them is in the
 *   directory next door to the file that wrote the rule down — and cites that
 *   same file, two lines later, about a different bug:
 *
 *       api/cooperatives/register   amount: registrationFee * 100
 *       actions/wallet.ts           const amountKobo = amountNGN * 100
 *
 *   BOTH ARE SAFE TODAY AND ARE FIXED ANYWAY, which is stated rather than
 *   glossed: registrationFee is 10_000 in constants.ts, and FundWalletSchema
 *   declares `z.number().int()`. Each is exact because of a constraint written
 *   somewhere else, and a money conversion whose correctness lives in another
 *   file is one edit away from being wrong.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Import fresh so the module's env reads happen under this test's env. */
async function initializer() {
    const mod = await import('@/lib/paystack-server');
    return mod.initializePaystackPayment;
}

describe('#706 — the door money arrives by refuses an amount nobody checked', () => {
    it('REFUSES NaN, WHICH IS WHAT A MISSING STORED FIELD PRODUCES', async () => {
        /*
         *   THE case #251 names. `undefined * 100` is NaN, and NaN serialises
         *   to `null` in a JSON body — so without this the request Paystack
         *   receives has no amount at all, and the failure surfaces as a
         *   confusing gateway error rather than as the missing field it is.
         */
        const init = await initializer();
        await expect(init('a@b.test', NaN)).rejects.toThrow(/invalid amount/i);
    });

    it('AND A NEGATIVE AMOUNT', async () => {
        const init = await initializer();
        await expect(init('a@b.test', -5000)).rejects.toThrow(/invalid amount/i);
    });

    it('AND ZERO, WHICH IS NOT A PAYMENT', async () => {
        const init = await initializer();
        await expect(init('a@b.test', 0)).rejects.toThrow(/invalid amount/i);
    });

    it('AND INFINITY', async () => {
        const init = await initializer();
        await expect(init('a@b.test', Infinity)).rejects.toThrow(/invalid amount/i);
    });

    it('AND THE NON-INTEGER KOBO A FRACTIONAL NAIRA PRICE PRODUCES', async () => {
        /*
         *   NOT a hand-picked number: this is exactly what the platform
         *   computes for a ₦19.99 item without Math.round, and it is the case
         *   api/cooperative/contribute's comment describes. Asserted through
         *   the real arithmetic rather than as a literal, so the test fails if
         *   floating point ever stops behaving this way.
         */
        expect(Number.isInteger(19.99 * 100)).toBe(false);

        const init = await initializer();
        await expect(init('a@b.test', 19.99 * 100)).rejects.toThrow(/invalid amount/i);
    });

    it('BUT A VALID AMOUNT IS NOT REFUSED — the control', async () => {
        /*
         *   THE assertion that makes the five above worth having. A guard that
         *   refused everything would satisfy all of them and would stop every
         *   payment on the platform.
         *
         *   It is allowed to fail for any reason EXCEPT the amount: there is no
         *   PAYSTACK_SECRET_KEY here and no network, so it throws "Payment
         *   service not configured". What matters is that it got past the
         *   guard, so the assertion names the amount error specifically rather
         *   than expecting success.
         */
        const init = await initializer();
        await expect(init('a@b.test', 500_000)).rejects.not.toThrow(/invalid amount/i);
    });

    it('AND THE GUARD RUNS BEFORE THE RETRY LOOP', () => {
        //   Three attempts at an amount that is wrong on all three is a second
        //   and a half of delay that reads as a network problem. Pinned by
        //   position: the check appears before `maxRetries` is declared.
        const src = read('src/lib/paystack-server.ts');
        const fn = src.slice(src.indexOf('export async function initializePaystackPayment'));

        expect(fn.indexOf('Refusing to initialize a payment')).toBeGreaterThan(-1);
        expect(fn.indexOf('Refusing to initialize a payment'))
            .toBeLessThan(fn.indexOf('const maxRetries'));
    });
});

describe('#706 — and every naira-to-kobo conversion rounds', () => {
    /**
     * The two that did not, pinned so they cannot drift back.
     *
     * Asserted on the source rather than by running them, because both are
     * currently exact — registrationFee is a whole number of naira and
     * FundWalletSchema demands an integer — so a behavioural test would pass
     * against the unrounded code too. The defect here is the ABSENCE of the
     * rounding, and the source is where an absence is visible.
     */
    it('THE COOPERATIVE REGISTRATION FEE', () => {
        const src = read('src/app/api/cooperatives/register/route.ts');
        expect(src).toContain('amount: Math.round(registrationFee * 100)');
    });

    it('AND THE WALLET TOP-UP', () => {
        const src = read('src/app/actions/wallet.ts');
        expect(src).toContain('Math.round(amountNGN * 100)');
    });

    it('AND NO PAYSTACK initialize BODY SENDS A BARE `x * 100`', () => {
        /*
         *   The general form, over the four files that build a transaction
         *   initialize body directly. A future fifth is the reason this reads
         *   the files rather than naming the two that were wrong.
         */
        const files = [
            'src/app/actions/wallet.ts',
            'src/app/api/cooperative/contribute/route.ts',
            'src/app/api/cooperatives/register/route.ts',
            'src/lib/paystack-server.ts',
        ];

        const offenders: string[] = [];
        for (const rel of files) {
            read(rel).split('\n').forEach((raw, i) => {
                const line = raw.trim();
                //   Comment lines are skipped: three of these files EXPLAIN the
                //   unrounded form in prose, quoting `amount * 100` verbatim,
                //   and matching those would report the explanation as the
                //   defect. That trap has its own entry in this audit.
                if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) return;
                if (/\*\s*100\b/.test(line) && !/Math\.round/.test(line)) {
                    offenders.push(`${rel}:${i + 1}  ${line.slice(0, 70)}`);
                }
            });
        }

        expect(offenders).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (10/10):
 *
 *   M1  the amount guard removed entirely                             KILLED
 *       (by all five refusal cases at once)
 *   M2  the guard weakened from isInteger to isFinite — so a
 *       fractional kobo amount is accepted again                      KILLED
 *   M3  the wallet conversion drops its Math.round again              KILLED
 *
 *   M2 IS THE ONE WORTH HAVING. `Number.isFinite` catches NaN, Infinity and
 *   the negative cases, so a guard written that way looks right and passes
 *   four of the five refusals. The non-integer case is the whole reason the
 *   check is `isInteger`, and it is the only mutant that distinguishes them.
 *
 *   The control for this suite is the sixth test above — a valid amount must
 *   still get past the guard — which fails if the refusal is ever widened into
 *   refusing everything.
 */
