/**
 * @jest-environment node
 */

/**
 *   #271 THE PAYOUT FALLBACK USED A DIFFERENT FORMULA FROM THE ESCROW ROW,
 *        UNDER A COMMENT SAYING THEY AGREED.
 *
 *        Three escrow creators — infrastructure/payments/service.ts,
 *        marketplace/_payment_verify.ts and marketplace/_payment_orders.ts —
 *        all write:
 *
 *            platformFee = Math.round(gross * platformFeePercentage)
 *            netAmount   = gross - platformFee
 *
 *        order-management.ts's payout fallback, used when an escrow row
 *        predates netAmount, wrote:
 *
 *            sellerAmount = Math.floor(gross * (1 - platformFeePercentage))
 *
 *        under the note "It uses the CONFIGURED percentage rather than a
 *        literal, so the two paths still agree." Sharing the percentage was the
 *        fix that note describes, and it was not enough: the two EXPRESSIONS
 *        are not the same function.
 *
 *        Across every whole-naira gross from 500 to 20,000 at 5% they disagree
 *        on 8,775 of 19,501 values — 45% — always by exactly NGN 1, always
 *        against the seller:
 *
 *            gross 1,002  ->  escrow row says 952, the fallback paid 951
 *
 *        Not a coincidence: with f = frac(gross x rate) and 0 < f < 0.5,
 *        Math.round rounds the fee down while Math.floor on the complement
 *        rounds the net down too, so the same naira is deducted twice.
 *
 *        #113's family ("the admin release tells the seller the gross and pays
 *        the net") and #270's, where the WAVE commission was floored on one
 *        side and unrounded on the other. Three times now: one figure, two
 *        expressions, a comment asserting they match.
 *
 *        AND THE PRIMARY PATH FLOORED THE ESCROW'S OWN FIGURE.
 *        `sellerAmount = Math.floor(recordedNet)` discards any kobo the escrow
 *        row records the seller is owed. Harmless while every gross is a whole
 *        naira and wrong the moment one is not — and initiateTransfer already
 *        converts to integer kobo, so nothing downstream needed the floor.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { platformFeeFor, sellerNetFor } from '@/lib/platform-fee';

const RATE = 0.05;

const ESCROW_CREATORS = [
    'src/infrastructure/payments/service.ts',
    'src/app/actions/marketplace/_payment_verify.ts',
    'src/app/actions/marketplace/_payment_orders.ts',
];
const PAYOUT = 'src/app/actions/order-management.ts';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#271 — one split, computed once', () => {
    it('THE FEE AND THE NET ALWAYS ADD BACK UP TO THE GROSS', () => {
        // The property the old fallback broke, and the reason net is defined as
        // the complement of the fee rather than computed on its own.
        for (let gross = 500; gross <= 20_000; gross += 7) {
            const fee = platformFeeFor(gross, RATE);
            const net = sellerNetFor(gross, RATE);
            if (fee + net !== gross) {
                throw new Error(`gross ${gross}: fee ${fee} + net ${net} = ${fee + net}`);
            }
        }
        expect(true).toBe(true);
    });

    it('MATCHES THE ESCROW ROW, NOT THE OLD FALLBACK', () => {
        // The exact case, and the count behind it.
        expect(sellerNetFor(1002, RATE)).toBe(952);
        expect(Math.floor(1002 * (1 - RATE))).toBe(951);

        let disagreements = 0;
        for (let gross = 500; gross <= 20_000; gross++) {
            if (sellerNetFor(gross, RATE) !== Math.floor(gross * (1 - RATE))) disagreements++;
        }
        expect(disagreements).toBe(8775);
    });

    it('and the old fallback was never generous, only short', () => {
        // Every disagreement went the same way. A rounding difference that
        // sometimes favoured the seller would be noise; this was a leak.
        for (let gross = 500; gross <= 20_000; gross++) {
            const shared = sellerNetFor(gross, RATE);
            const old = Math.floor(gross * (1 - RATE));
            if (old > shared) throw new Error(`gross ${gross}: old ${old} > shared ${shared}`);
        }
        expect(true).toBe(true);
    });

    it('keeps the kobo when a gross carries one', () => {
        // Math.floor(recordedNet) in the payout path threw this away.
        expect(sellerNetFor(1999.5, RATE)).toBe(1899.5);
        expect(platformFeeFor(1999.5, RATE) + sellerNetFor(1999.5, RATE)).toBe(1999.5);
    });

    it.each([
        [0, RATE], [-100, RATE], [1000, 0], [1000, -0.05],
        [NaN, RATE], [1000, NaN], ['x', RATE], [null, RATE], [undefined, RATE],
    ])('charges no fee on (%s, %s) rather than NaN', (gross, rate) => {
        expect(platformFeeFor(gross as any, rate as any)).toBe(0);
        expect(Number.isNaN(sellerNetFor(gross as any, rate as any))).toBe(false);
    });

    it('never takes more than the order, whatever the rate says', () => {
        // #255 leaves platformFeePercentage unwritable, so a bad value can only
        // arrive by a code change — but a fee above the gross would make the
        // net negative and a negative transfer is not a thing.
        expect(platformFeeFor(1000, 2)).toBe(1000);
        expect(sellerNetFor(1000, 2)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#271 — every site uses it', () => {
    it('finds every file, so the checks below are not vacuous', () => {
        for (const f of [...ESCROW_CREATORS, PAYOUT]) {
            expect(codeOnly(f).length).toBeGreaterThan(500);
        }
    });

    it('NO FILE COMPUTES THE SPLIT WITH ITS OWN ARITHMETIC', () => {
        const offenders = [...ESCROW_CREATORS, PAYOUT]
            .flatMap((f) => codeOnly(f).split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => /platformFeePercentage/.test(line))
            .filter(({ line }) => /[*]|Math\.(round|floor|ceil|trunc)/.test(line))
            .map((o) => o.at);

        // Was: three `Math.round(gross * pct)` and one
        // `Math.floor(gross * (1 - pct))`.
        expect(offenders).toEqual([]);
    });

    it('and the payout no longer floors the escrow row it is paying', () => {
        const src = codeOnly(PAYOUT);

        // Was: sellerAmount = Math.floor(recordedNet)
        expect(src).not.toMatch(/Math\.floor\(\s*recordedNet\s*\)/);
        expect(src).toContain('sellerNetFor(');
    });

    it('all three escrow creators call the shared function', () => {
        for (const f of ESCROW_CREATORS) {
            expect({ f, uses: codeOnly(f).includes('platformFeeFor(') })
                .toEqual({ f, uses: true });
        }
    });
});
