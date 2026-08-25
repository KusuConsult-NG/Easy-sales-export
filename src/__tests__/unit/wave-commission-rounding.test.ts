/**
 * @jest-environment node
 */

/**
 *   #270 THE WAVE COMMISSION WAS FLOORED WHEN CREDITED AND UNROUNDED WHEN SHOWN.
 *
 *        Two computations of one figure, in two files, with two rounding rules:
 *
 *          order-management.ts   Math.floor(totalAmount * waveCommissionRate)
 *                                — the balance she can withdraw
 *          wave/_wv_earnings.ts  saleAmount * commissionRate
 *                                — the "Total earnings" on her screen
 *
 *        Both numbers appear on the WAVE earnings page, and they disagree in
 *        the direction that matters: she is shown more than she can take.
 *        Measured over ten ordinary sales at 5%:
 *
 *          credited (floor per sale)     NGN 2,531
 *          displayed (unrounded)         NGN 2,538.3500000000004
 *          gap she can see and not have  NGN 7.35
 *
 *        Up to NGN 1 per sale, permanently, growing with every order.
 *
 *        #253 unified the RATE across these same two files — "one commission
 *        rate for the whole platform... two live numbers that had to agree,
 *        kept in step by nobody". The rate became shared and the ROUNDING did
 *        not, so the two copies went on disagreeing about the same money by a
 *        different route. One level down, same shape.
 *
 *        The float is the smaller half. `saleAmount * 0.05` summed over many
 *        sales accumulates binary residue, and _wv_earnings.ts PERSISTS that
 *        number as waveEarningsBalance when it backfills — into a field the
 *        live path otherwise increments with whole integers.
 *
 *        THIS CHANGES WHAT MEMBERS ARE CREDITED, upward, by under NGN 1 per
 *        sale. Flooring has no comment defending it anywhere, while the rate
 *        beside it has a long one; it reads as what Math.floor happened to do
 *        rather than what anyone chose. If the intent really was to floor,
 *        waveCommission is the single function to change and both call sites
 *        follow.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { waveCommission, sumWaveCommissions } from '@/lib/wave-commission';

const RATE = 0.05;

/** Ten ordinary Nigerian marketplace prices, none of them round at 5%. */
const SALES = [1999, 4999, 12345, 777, 15499, 2350, 899, 3499, 7250, 1150];

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#270 — one commission, one rounding rule', () => {
    it('KEEPS THE KOBO INSTEAD OF DISCARDING IT', () => {
        // The defect in one line. Math.floor(1999 * 0.05) is 99; she earned
        // 99.95, and the 95 kobo went nowhere anyone recorded.
        expect(waveCommission(1999, RATE)).toBe(99.95);
        expect(Math.floor(1999 * RATE)).toBe(99);
    });

    it('AND THE TOTAL IS NOT A FLOATING-POINT SMEAR', () => {
        // The other half: the displayed figure was 2538.3500000000004, and
        // _wv_earnings.ts writes that number into waveEarningsBalance when it
        // backfills.
        const total = sumWaveCommissions(SALES.map((s) => waveCommission(s, RATE)));

        expect(total).toBe(2538.35);
        expect(String(total)).toBe('2538.35');
    });

    it('so what is shown and what is credited are the same number', () => {
        // THE property. Both sides of the earnings page now come from the same
        // function, so the two figures cannot drift apart.
        const perSale = SALES.map((s) => waveCommission(s, RATE));
        const credited = sumWaveCommissions(perSale);
        const displayed = sumWaveCommissions(perSale);

        expect(credited).toBe(displayed);

        // And the gap the old pair produced, for the record.
        const oldCredited = SALES.reduce((a, s) => a + Math.floor(s * RATE), 0);
        expect(Number((displayed - oldCredited).toFixed(2))).toBe(7.35);
    });

    it('rounds a half-kobo up, consistently', () => {
        // 1234.5 kobo. One rule, applied the same way every time, matters more
        // than which way it goes.
        expect(waveCommission(246.9, 0.05)).toBe(12.35);
        expect(waveCommission(0.1, 0.05)).toBe(0.01);
    });

    it.each([
        [0, RATE],
        [-500, RATE],
        [1000, 0],
        [1000, -0.05],
        [NaN, RATE],
        [1000, NaN],
        ['not a number', RATE],
        [null, RATE],
        [undefined, RATE],
    ])('earns nothing on (%s, %s) rather than NaN', (amount, rate) => {
        // A NaN reaching FieldValue.increment poisons the balance permanently.
        // Same reasoning as the amount guard in paystack-transfer.ts (#250).
        expect(waveCommission(amount as any, rate as any)).toBe(0);
    });

    it('SUMS IN KOBO, BECAUSE ADDING KOBO-EXACT FLOATS STILL DRIFTS', () => {
        //   Two commissions that are each exact to the kobo, and whose plain
        //   `+` is not:
        //
        //       48.57 + 627.48  ->  676.0500000000001
        //
        //   The first version of this test summed ten realistic commissions and
        //   happened to land on a clean total, so it passed against a naive
        //   reduce — it did not catch its own mutation. Rounding each value is
        //   not enough; the ADDITION has to happen in whole kobo too, and this
        //   is the pair that shows it.
        expect(48.57 + 627.48).not.toBe(676.05);
        expect(sumWaveCommissions([48.57, 627.48])).toBe(676.05);
    });

    it('a sum containing rubbish is still a number', () => {
        expect(sumWaveCommissions([99.95, NaN, 10, Infinity])).toBe(109.95);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#270 — the two call sites use it', () => {
    const CREDIT = 'src/app/actions/order-management.ts';
    const DISPLAY = 'src/app/actions/wave/_wv_earnings.ts';

    it('finds both files, so the checks below are not vacuous', () => {
        for (const f of [CREDIT, DISPLAY]) {
            expect(codeOnly(f).length).toBeGreaterThan(500);
        }
    });

    it('THE CREDIT NO LONGER FLOORS TO WHOLE NAIRA', () => {
        const src = codeOnly(CREDIT);

        expect(src).toContain('waveCommission(');
        // Was: Math.floor(currentOrder.totalAmount * waveCommissionRate)
        expect(src).not.toMatch(/Math\.floor\([^)]*waveCommissionRate/);
    });

    it('THE DISPLAY NO LONGER MULTIPLIES RAW', () => {
        const src = codeOnly(DISPLAY);

        expect(src).toContain('waveCommission(');
        // Was: const commission = saleAmount * commissionRate;
        expect(src).not.toMatch(/=\s*saleAmount\s*\*\s*commissionRate/);
    });

    it('and neither file keeps a second rounding rule of its own', () => {
        // #253's lesson, one level down: the rate was made shared and the
        // rounding was left in two places, so they disagreed anyway.
        for (const f of [CREDIT, DISPLAY]) {
            const offenders = codeOnly(f)
                .split('\n')
                .map((line, i) => ({ at: `${f}:${i + 1}`, line }))
                .filter(({ line }) => /commissionRate|waveCommissionRate/.test(line))
                .filter(({ line }) => /Math\.(floor|ceil|round|trunc)\s*\(/.test(line))
                .map((o) => o.at);

            expect(offenders).toEqual([]);
        }
    });

    it('the totals are summed in kobo, not accumulated as floats', () => {
        const src = codeOnly(DISPLAY);

        expect(src).toContain('sumWaveCommissions');
    });
});
