/**
 * @jest-environment node
 */

/**
 *   #882 ONE FEE, THREE ANSWERS, AND ONE OF THEM IN A CONTRACT.
 *
 *   THE OWNER: "The commission is 3% and the escrow fee is 2%" — and, to be
 *   unambiguous about it: "commission should be changed to 3%".
 *
 *   MEASURED, and the platform held three different figures for one question:
 *
 *       code                      platformFeePercentage: 0.05, and no escrow
 *                                 fee concept at all
 *       Farm Nation terms         "Sellers: 2.5% commission" and
 *                                 "Escrow Service: 1% (recommended)"
 *       Marketplace terms         "Platform fee: 5% per transaction"
 *
 *   The Farm Nation figures are the ones that matter most, because a seller
 *   TICKS A BOX directly beneath them to accept them. The contract said 2.5%
 *   and the ledger took 5%, in the platform's favour, on every transaction.
 *
 * ── THE TOTAL DOES NOT MOVE ─────────────────────────────────────────────────
 *
 *   3 + 2 is the 5 that was already being withheld, so no seller is paid a
 *   different amount by this change. What changes is that the platform can say
 *   which part is which — on the screen, in the terms, and on the escrow row a
 *   dispute is settled from.
 *
 * ── AND THE SPLIT CANNOT FAIL TO ADD UP ─────────────────────────────────────
 *
 *   Rounding two shares independently does not reliably reproduce the rounded
 *   total, and #271 is this codebase's record of what that costs: one figure,
 *   two expressions, a comment asserting they matched, and 45% of values off by
 *   a naira in the seller's disfavour.
 *
 *   So the total is computed by the function every payout already uses, the
 *   commission is rounded, and the escrow fee is THE REMAINDER.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { platformFeeFor, sellerNetFor, feeSplitFor } from '@/lib/platform-fee';
import { DEFAULT_FEES } from '@/lib/system-settings-schema';
import { MARKETPLACE_CONFIG } from '@/lib/constants';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#882 — the rates are what the owner said', () => {
    it('THE REPORTED CHANGE: commission is 3% and the escrow fee is 2%', () => {
        expect(DEFAULT_FEES.commissionPercentage).toBe(0.03);
        expect(DEFAULT_FEES.escrowFeePercentage).toBe(0.02);
    });

    it('AND THE TOTAL IS THEIR SUM, unchanged at 5%', () => {
        /*
         *   The safety property of the whole change: nobody is paid a different
         *   amount. If this ever fails, money moved.
         */
        expect(DEFAULT_FEES.platformFeePercentage).toBe(0.05);
        expect(DEFAULT_FEES.commissionPercentage + DEFAULT_FEES.escrowFeePercentage)
            .toBeCloseTo(DEFAULT_FEES.platformFeePercentage, 10);
    });

    it('AND THE TOTAL IS NOT SEPARATELY SETTABLE', () => {
        /*
         *   A third editable number that ought to equal the sum of two others is
         *   a drift waiting to happen. The admin screen renders from this spec,
         *   so removing the key removes the field.
         */
        const src = code('src/lib/system-settings-schema.ts');
        const spec = src.slice(src.indexOf('SYSTEM_SETTINGS_FIELDS'));

        expect(spec).toContain('key: "commissionPercentage"');
        expect(spec).toContain('key: "escrowFeePercentage"');
        expect(spec).not.toContain('key: "platformFeePercentage"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#882 — and the two parts always reconcile to the whole', () => {
    it('THE INVARIANT: commission + escrow === the fee actually withheld', () => {
        /*
         *   Swept rather than sampled, across every whole naira in a range wide
         *   enough to contain the fractional cases — which is how #271 was
         *   measured, and it found 8,775 disagreements.
         */
        const mismatches: string[] = [];

        for (let gross = 1; gross <= 20_000; gross += 1) {
            const split = feeSplitFor(gross, DEFAULT_FEES);
            const withheld = platformFeeFor(gross, DEFAULT_FEES.platformFeePercentage);

            if (split.commission + split.escrow !== withheld) {
                mismatches.push(`${gross}: ${split.commission}+${split.escrow} != ${withheld}`);
            }
        }

        expect(mismatches.slice(0, 5)).toEqual([]);
    });

    it('AND THE SELLER’S NET IS UNTOUCHED BY THE SPLIT EXISTING', () => {
        //   The other half of "no money moves": net + total === gross, exactly,
        //   which is the identity #271 restored.
        for (const gross of [500, 1_002, 1_050, 7_777, 1_000_000]) {
            const split = feeSplitFor(gross, DEFAULT_FEES);
            const net = sellerNetFor(gross, DEFAULT_FEES.platformFeePercentage);

            expect({ gross, ok: net + split.total === gross }).toEqual({ gross, ok: true });
        }
    });

    it('AND THE COMMISSION IS THE LARGER SHARE, which 3 vs 2 requires', () => {
        //   A split that reconciles is also satisfied by commission 0 and escrow
        //   everything, so the proportions are asserted too.
        const split = feeSplitFor(100_000, DEFAULT_FEES);

        expect(split.commission).toBe(3_000);
        expect(split.escrow).toBe(2_000);
        expect(split.total).toBe(5_000);
    });

    it('AND AN UNUSABLE GROSS SPLITS INTO NOTHING, rather than NaN', () => {
        /*
         *   platformFeeFor's own rule, and the reason it has one: a NaN fee
         *   makes a NaN net, and a NaN reaching a payout is unrecoverable.
         */
        for (const bad of [0, -1, NaN, undefined, null, 'abc']) {
            expect({ bad, out: feeSplitFor(bad, DEFAULT_FEES) })
                .toEqual({ bad, out: { total: 0, commission: 0, escrow: 0 } });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#882 — and a platform already charging something else keeps charging it', () => {
    it('A STORED TOTAL WITH NO COMPONENTS IS HONOURED, not overwritten', async () => {
        /*
         *   THE CASE THAT WOULD HAVE MOVED MONEY. Every settings document
         *   written before today carries `platformFeePercentage` and neither
         *   component. An admin who had set 7% must keep charging 7% — replacing
         *   it with 3+2 would cut the platform's revenue silently, which is the
         *   opposite failure to the one being fixed but the same kind.
         */
        const { reconcileFeeSplit } = await import('@/lib/system-settings');

        const out = reconcileFeeSplit(
            { ...DEFAULT_FEES, platformFeePercentage: 0.07 },
            { platformFeePercentage: 0.07 },
        );

        expect(out.platformFeePercentage).toBe(0.07);
        //   Split in the 3:2 ratio, and still summing to the stored total.
        expect(out.commissionPercentage + out.escrowFeePercentage).toBeCloseTo(0.07, 10);
        expect(out.commissionPercentage).toBeCloseTo(0.042, 10);
    });

    it('AND ONCE A COMPONENT IS SET, THE COMPONENTS ARE THE TRUTH', async () => {
        const { reconcileFeeSplit } = await import('@/lib/system-settings');

        const out = reconcileFeeSplit(
            { ...DEFAULT_FEES, commissionPercentage: 0.04, escrowFeePercentage: 0.01 },
            { commissionPercentage: 0.04, escrowFeePercentage: 0.01 },
        );

        expect(out.platformFeePercentage).toBeCloseTo(0.05, 10);
    });

    it('AND A DOCUMENT WITH NOTHING IN IT LEAVES THE DEFAULTS ALONE', async () => {
        const { reconcileFeeSplit } = await import('@/lib/system-settings');

        expect(reconcileFeeSplit(DEFAULT_FEES, {}).platformFeePercentage).toBe(0.05);
        expect(reconcileFeeSplit(DEFAULT_FEES, null).commissionPercentage).toBe(0.03);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#882 — and what a seller is told matches what is taken', () => {
    it('THE FARM NATION TERMS SAY 3% AND 2%', () => {
        /*
         *   THE DEFECT THAT WAS IN A CONTRACT. A seller ticks
         *   `feeDisclosureAccepted` directly beneath this list, and it said 2.5%
         *   commission and a 1% escrow service while 5% was withheld.
         */
        const src = code('src/app/farm-nation/onboarding/steps/TermsStep.tsx');

        expect(src).toContain('3% commission on successful transactions');
        expect(src).toContain('2% of transaction value');
        expect(src).not.toContain('2.5% commission');
        expect(src).not.toContain('1% of transaction value');
    });

    it('AND THE MARKETPLACE SCREENS ITEMISE IT TOO', () => {
        for (const rel of [
            'src/app/marketplace/onboarding/steps/BankAccountStep.tsx',
            'src/app/marketplace/onboarding/steps/TermsStep.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, commission: src.includes('MARKETPLACE_CONFIG.commission') })
                .toEqual({ rel, commission: true });
            expect({ rel, escrow: src.includes('MARKETPLACE_CONFIG.escrowFee') })
                .toEqual({ rel, escrow: true });
        }
    });

    it('AND THE DISPLAYED NUMBERS ARE THE CHARGED ONES', () => {
        /*
         *   The constants are percentages for rendering and the settings are
         *   fractions for charging — two representations of one fact, which is
         *   exactly how they drift. Pinned to each other here so a change to one
         *   fails until the other follows.
         */
        expect(MARKETPLACE_CONFIG.commission / 100).toBeCloseTo(DEFAULT_FEES.commissionPercentage, 10);
        expect(MARKETPLACE_CONFIG.escrowFee / 100).toBeCloseTo(DEFAULT_FEES.escrowFeePercentage, 10);
        expect(MARKETPLACE_CONFIG.platformFee / 100).toBeCloseTo(DEFAULT_FEES.platformFeePercentage, 10);

        //   And the displayed total is its own displayed parts.
        expect(MARKETPLACE_CONFIG.commission + MARKETPLACE_CONFIG.escrowFee)
            .toBe(MARKETPLACE_CONFIG.platformFee);
    });

    it('AND THE ESCROW ROW RECORDS THE BREAKDOWN', () => {
        //   The record a dispute or a reconciliation is settled from. Both
        //   escrow creators, because one of two is how this codebase's defects
        //   usually look.
        for (const rel of [
            'src/app/actions/marketplace/_payment_orders.ts',
            'src/app/actions/marketplace/_payment_verify.ts',
        ]) {
            const src = code(rel);
            expect({ rel, c: src.includes('commissionFee: feeSplitFor(grossAmount, fees).commission') })
                .toEqual({ rel, c: true });
            expect({ rel, e: src.includes('escrowFee: feeSplitFor(grossAmount, fees).escrow') })
                .toEqual({ rel, e: true });
        }
    });
});
