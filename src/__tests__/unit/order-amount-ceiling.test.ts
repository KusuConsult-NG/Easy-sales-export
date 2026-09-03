/**
 * @jest-environment node
 */

/**
 *   #272 THE ORDER CEILING WAS REMOVED ON A RATIONALE THAT ONLY HELD FOR THE
 *        FLOOR.
 *
 *        PlatformFees declares both bounds and defaults them to
 *
 *            minOrderAmount:    500
 *            maxOrderAmount: 10,000,000
 *
 *        `minOrderAmount` is enforced at all three order-creation paths.
 *        `maxOrderAmount` was read by nothing at all — a scan of every
 *        non-comment line in src finds zero live readers.
 *
 *        IT USED TO BE ENFORCED, AND THE REMOVAL WAS ARGUED CORRECTLY ABOUT
 *        THE WRONG HALF. _payment_verify.ts explains why the pair was dropped
 *        from the payment path:
 *
 *            "1. `amountInNaira < fees.minOrderAmount || > fees.maxOrderAmount`
 *             Placement-time bounds, re-applied after the money was taken.
 *             minOrderAmount is already enforced in three places in
 *             _payment_orders.ts when the order is created, so re-checking here
 *             prevents nothing — and an admin changing the fee configuration
 *             between placement and payment turned a charged buyer's valid
 *             order into 'Invalid payment amount'."
 *
 *        Every word of that is right, and it is an argument about
 *        minOrderAmount. The sentence names one bound and the deletion took
 *        two. The floor kept its three placement-time checks; the ceiling had
 *        none to fall back on, so removing the re-check removed the only
 *        enforcement there was.
 *
 *        THE FIX IS THE ONE THAT COMMENT PRESCRIBES: bounds belong at
 *        PLACEMENT, not after the money has been taken. So the ceiling goes
 *        beside the floor, at the same three sites, and NOT back into the
 *        payment path — putting it there would reintroduce exactly the
 *        "charged buyer, valid order, Invalid payment amount" failure the
 *        removal was right to eliminate.
 *
 *        This is not a new policy. The ceiling was configured, was enforced,
 *        and was lost to a migration that reasoned about its sibling.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not the negative-quantity hole — that one is closed. validateCartItems
 * refuses a non-integer or non-positive quantity and forces the price from the
 * database, with the reasoning written out in marketplace-cart.ts. Checked
 * before writing this.
 *
 * AND ONE THING LEFT FOR THE OWNER
 * --------------------------------
 * `additionalItemFee` (default 500) has zero live readers too. Unlike the
 * ceiling it was never enforced anywhere, so there is no removal to undo and no
 * previous behaviour to restore — charging it would be a pricing change, which
 * is not this audit's call. Recorded rather than acted on.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkOrderAmountBounds } from '@/lib/order-payment-amount';

const FEES = { minOrderAmount: 500, maxOrderAmount: 10_000_000 };

const CREATION = 'src/app/actions/marketplace/_payment_orders.ts';
const VERIFY = 'src/app/actions/marketplace/_payment_verify.ts';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#272 — the ceiling is a real bound again', () => {
    it('REFUSES AN ORDER ABOVE maxOrderAmount', () => {
        const verdict = checkOrderAmountBounds(10_000_001, FEES);

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.message).toMatch(/maximum/i);
    });

    it('and still refuses one below minOrderAmount', () => {
        const verdict = checkOrderAmountBounds(499, FEES);

        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.message).toMatch(/minimum/i);
    });

    it('accepts everything in between, including both edges', () => {
        // Vacuity guard, and the boundary: a bound that excluded its own limit
        // would refuse an order priced at exactly the configured maximum.
        for (const total of [500, 501, 25_000, 9_999_999, 10_000_000]) {
            expect({ total, ok: checkOrderAmountBounds(total, FEES).ok })
                .toEqual({ total, ok: true });
        }
    });

    it('refuses an unreadable total rather than passing it through', () => {
        // #112's lesson: the escrow amount check failed OPEN when the amount
        // could not be read. A bound that cannot evaluate is not a bound.
        for (const bad of [NaN, Infinity, -1, null, undefined, 'a lot']) {
            expect({ bad, ok: checkOrderAmountBounds(bad as any, FEES).ok })
                .toEqual({ bad, ok: false });
        }
    });

    it('treats an unconfigured ceiling as no ceiling, not as zero', () => {
        // A missing maxOrderAmount must not refuse every order. Failing closed
        // is right for a permission and wrong for a limit nobody set.
        expect(checkOrderAmountBounds(50_000, { minOrderAmount: 500 } as any).ok).toBe(true);
        expect(checkOrderAmountBounds(50_000, {} as any).ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#272 — enforced where the comment says bounds belong', () => {
    it('AT ALL THREE ORDER-CREATION PATHS', () => {
        const src = codeOnly(CREATION);
        const calls = src.split('\n').filter((l) => l.includes('checkOrderAmountBounds(')).length;

        // _initializeOrderPaymentAction, _createBankTransferOrderAction and
        // _createPaymentOnDeliveryOrderAction — the same three that already
        // carried the floor.
        expect(calls).toBe(3);
    });

    it('and each of them still has exactly one bounds check, not two', () => {
        // The floor was a hand-written comparison at each site. Leaving it
        // beside the shared call would be two rules again — #270 and #271 both
        // came from precisely that.
        const src = codeOnly(CREATION);
        const handWritten = src.split('\n')
            .map((line, i) => ({ at: `${CREATION}:${i + 1}`, line }))
            .filter(({ line }) => /minOrderAmount|maxOrderAmount/.test(line))
            .filter(({ line }) => /[<>]/.test(line))
            .map((o) => o.at);

        expect(handWritten).toEqual([]);
    });

    it('AND NOT BACK IN THE PAYMENT PATH, WHICH WAS RIGHT TO DROP IT', () => {
        // Re-applying bounds after the money is taken is what turned a charged
        // buyer's valid order into "Invalid payment amount" when an admin
        // changed the configuration mid-flight. That removal stands.
        const src = codeOnly(VERIFY);

        expect(src).not.toContain('checkOrderAmountBounds');
        expect(src).not.toMatch(/maxOrderAmount/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#272 — no configured bound is left unread', () => {
    /**
     * A ratchet on the config surface. maxOrderAmount sat in PlatformFees,
     * typed and defaulted, with nothing consulting it — and it read as a
     * control that existed.
     */
    function liveReaders(field: string): number {
        const files = [
            'src/app/actions/marketplace/_payment_orders.ts',
            'src/app/actions/marketplace/_payment_verify.ts',
            'src/lib/order-payment-amount.ts',
            'src/app/actions/orders.ts',
        ];
        return files
            .flatMap((f) => codeOnly(f).split('\n'))
            .filter((l) => l.includes(field))
            .length;
    }

    it('minOrderAmount and maxOrderAmount are both consulted', () => {
        expect(liveReaders('maxOrderAmount')).toBeGreaterThan(0);
        expect(liveReaders('minOrderAmount')).toBeGreaterThan(0);
    });

    it('additionalItemFee is STILL unread — recorded, not fixed', () => {
        // Deliberate. Unlike the ceiling this was never enforced anywhere, so
        // there is no previous behaviour to restore; charging it would be a
        // pricing change and that is the owner's call, not this audit's.
        //
        // Pinned so the decision stays visible: when somebody wires it up, this
        // test fails and they delete it.
        expect(liveReaders('additionalItemFee')).toBe(0);
    });
});
