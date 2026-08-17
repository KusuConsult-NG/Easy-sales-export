/**
 * WAVE commission is 5% of what the member actually sold and was actually paid.
 *
 * FOUR DEFECTS IN THE OLD BASIS
 * -----------------------------
 * _calculateEarningsAction queried MARKETPLACE_ORDERS on `sellerId` and took 5%
 * of `order.totalAmount`. Every part of that was wrong:
 *
 *   1. An order has SEVERAL sellers. _payment_orders.ts writes `sellerIds` as an
 *      array and `sellerId: sellerIds[0]` as a convenience field, so whoever was
 *      listed first earned 5% of every other seller's items.
 *   2. And the others earned nothing — the query filtered that scalar field, so a
 *      member who was the second seller on an order got no commission from a sale
 *      she made.
 *   3. Cancellation did not remove it. cancelOrder claims the order to
 *      "cancelled" and never touches `paymentStatus`, and `isPaid` tested
 *      `paymentStatus === "paid"`.
 *   4. Nor did a refund. refundEscrowToBuyer updates the ESCROW row only; the
 *      order keeps `paymentStatus: "paid"` permanently.
 *
 * Plus commission on the delivery fee, because `totalAmount` includes it.
 *
 * The escrow rows answer all of it: one row per seller, carrying that seller's
 * own gross and a status that tracks whether the money reached her or went back.
 *
 * WHY THESE ARE SOURCE ASSERTIONS
 * -------------------------------
 * The figures feed `waveEarningsBalance`, a persisted balance a member can
 * withdraw against. What has to hold is a property of WHICH RECORDS the sum is
 * taken over, and that is visible in the query. A mock returning three fake rows
 * would prove the arithmetic, which was never the broken part.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const EARNINGS = 'src/app/actions/wave/_wv_earnings.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Comments stripped — the prose here quotes every defect it describes. */
function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the commission is summed over escrow rows, not orders', () => {
    it('no longer queries orders by the convenience sellerId field', () => {
        const src = code(EARNINGS);

        expect(src).not.toContain('MARKETPLACE_ORDERS');
        expect(src).not.toContain('order.totalAmount');
    });

    it('queries the escrow rows for this seller', () => {
        const src = code(EARNINGS);

        expect(src).toContain('COLLECTIONS.ESCROW_TRANSACTIONS');
        expect(src).toContain('.where("sellerId", "==", userId)');
    });

    it('takes the seller\'s own gross, not the order total', () => {
        // `amount` on an escrow row is that seller's goods plus her share of
        // delivery — computed by _payment_orders.ts's sellerTotals, the split that
        // already existed and was not used.
        const src = code(EARNINGS);
        expect(src).toMatch(/escrow\.amount \?\? escrow\.grossAmount/);
    });
});

describe('only money that reached her counts as paid', () => {
    it('paid means released, and nothing else', () => {
        const src = code(EARNINGS);
        expect(src).toContain('const ESCROW_PAID_STATUSES = ["released"]');
    });

    it('refunded is in neither the paid nor the pending set', () => {
        // The refund case, asserted where it can be checked: `refunded` must not
        // appear in either list, so it falls through to the earns-nothing branch.
        const { ESCROW_PAID_STATUSES, ESCROW_PENDING_STATUSES } = extractStatusSets();

        expect(ESCROW_PAID_STATUSES).not.toContain('refunded');
        expect(ESCROW_PENDING_STATUSES).not.toContain('refunded');
    });

    it('cancelled is in neither either', () => {
        const { ESCROW_PAID_STATUSES, ESCROW_PENDING_STATUSES } = extractStatusSets();

        expect(ESCROW_PAID_STATUSES).not.toContain('cancelled');
        expect(ESCROW_PENDING_STATUSES).not.toContain('cancelled');
    });

    it('the pending set is not empty, so the exclusions are not vacuous', () => {
        // Without this, emptying both sets would satisfy every assertion above
        // while reporting zero earnings to everybody.
        const { ESCROW_PENDING_STATUSES } = extractStatusSets();

        expect(ESCROW_PENDING_STATUSES).toContain('funded');
        expect(ESCROW_PENDING_STATUSES.length).toBeGreaterThanOrEqual(3);
    });

    it('an unrecognised status earns nothing rather than defaulting to owed', () => {
        // The safe direction for a balance somebody can withdraw against. A new
        // escrow status must not become payable by being unknown.
        const src = code(EARNINGS);
        expect(src).toContain('if (!isPaid && !isPending) return;');
    });
});

/**
 * Reads the two status lists out of the source.
 *
 * The module is "use server" and imports the database adapter, so requiring it
 * here would drag in the whole server surface for two array literals.
 */
function extractStatusSets(): { ESCROW_PAID_STATUSES: string[]; ESCROW_PENDING_STATUSES: string[] } {
    const src = source(EARNINGS);
    const read = (name: string): string[] => {
        const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src);
        if (!m) throw new Error(`${name} not found — this test cannot check what it claims to`);
        return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    };
    return {
        ESCROW_PAID_STATUSES: read('ESCROW_PAID_STATUSES'),
        ESCROW_PENDING_STATUSES: read('ESCROW_PENDING_STATUSES'),
    };
}

describe('the scan is bounded and says when it truncates', () => {
    it('has a limit, which the old query did not', () => {
        const src = code(EARNINGS);
        expect(src).toContain('ESCROW_SCAN_LIMIT');
        expect(src).toMatch(/\.limit\(ESCROW_SCAN_LIMIT \+ 1\)/);
    });

    it('reports the truncation rather than presenting a partial sum as a total', () => {
        const src = code(EARNINGS);
        expect(src).toMatch(/logger\.warn\(/);
        expect(source(EARNINGS)).toContain('UNDERSTATED');
    });

    it('does not persist a balance computed from a truncated scan', () => {
        // The field is initialised once. Writing an understated figure into it
        // would turn a display problem into a stored one.
        const src = code(EARNINGS);
        expect(src).toContain('if (availableBalance === undefined && !truncated)');
    });
});

describe('an overstated stored balance is reported, not silently rewritten', () => {
    it('logs the discrepancy', () => {
        // Balances backfilled under the old basis are too high. Correcting one
        // downward is an adjustment to somebody's money and is not a read
        // action's decision to take.
        const src = source(EARNINGS);

        expect(src).toContain('storedBalance > entitlement + 1');
        expect(src).toContain('Left unchanged');
    });

    it('does not write the recomputed figure over an existing balance', () => {
        // The vacuity guard for the test above: exactly one write of the balance
        // field, inside the initialise-once branch.
        const src = code(EARNINGS);
        const writes = src.match(/'serviceRegistrations\.wave\.waveEarningsBalance':/g) || [];

        expect(writes).toHaveLength(1);
    });
});
