/**
 * @jest-environment node
 */

/**
 * Two dashboards counting unpaid orders as money.
 *
 * THE DEFECT
 * ----------
 *   _mp_buyer_dashboard.ts    totalSpent = every order, summed, with NO status
 *                             filter. So "Total Spent" included baskets still at
 *                             `pending_payment` and orders the buyer had
 *                             CANCELLED.
 *
 *   _mp_seller_dashboard.ts   totalSales / monthlyRevenue / prevMonthRevenue,
 *                             excluding only `cancelled` and `disputed` — so
 *                             `pending_payment` counted as revenue, including in
 *                             the monthly figure a seller judges the business by.
 *
 * `pending_payment` is the status an order is CREATED in, before the buyer has
 * been charged anything. An abandoned checkout sat there forever and was
 * reported as revenue on one screen and as spending on the other.
 *
 * THE SILENT ZERO
 * ---------------
 * The buyer sum was `sum + o.totalAmount` with no coercion, and the docs were
 * not run through OrderSchema, so `totalAmount` could be undefined. One such
 * order makes the whole reduce NaN — and formatCurrency(NaN) returns "₦0",
 * verified, not assumed. The figure did not look broken. It looked like nothing
 * had ever been spent.
 *
 * WHY TWO SETS AND NOT ONE
 * ------------------------
 * "Has the buyer paid?" and "is this the seller's revenue?" differ on exactly
 * one status. A DISPUTED order has been paid — the buyer's money left — but it
 * is not the seller's; it is in escrow pending a decision. The seller dashboard
 * already excluded it, correctly. Both sets are named so that difference is
 * visible rather than looking like an oversight.
 *
 * AND A STATUS ORDERS NEVER HOLD
 * ------------------------------
 * _confirmOrderReceiptAction allowed `["in_transit", "processing", "shipped"]`.
 * "in_transit" is an ESCROW status; no order is ever written with it, so the
 * list read as though a fourth state were supported.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ORDER_STATUSES,
    ORDER_PAID_BY_BUYER,
    ORDER_COUNTS_AS_SELLER_REVENUE,
    ORDER_UNPAID_STATUSES,
    ORDER_ACTIVE_STATUSES,
    ORDER_CONFIRMABLE_FROM,
    isPaidByBuyer,
    countsAsSellerRevenue,
    isActiveOrderStatus,
    orderAmount,
    sumOrders,
} from '@/lib/order-status';
import { OrderSchema } from '@/lib/validations/marketplace';

const BUYER_DASH = 'src/app/actions/marketplace/_mp_buyer_dashboard.ts';
const SELLER_DASH = 'src/app/actions/marketplace/_mp_seller_dashboard.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the vocabulary matches the schema', () => {
    /**
     * Asked behaviourally, not by reaching into Zod's internals.
     *
     * The first version read `OrderSchema.shape.status._def.innerType._def.values`,
     * which is a private path that differs between Zod versions — it came back
     * undefined here. Parsing is the public contract and cannot go stale.
     */
    const statusParses = (status: string): boolean =>
        OrderSchema.safeParse({
            // `sellerId` AND `sellerIds` are both required — the schema carries a
            // single-seller field beside the multi-seller array, which is the
            // "single-seller cart assumption" reviews.ts already works around.
            // Not chased here; noted because omitting it made this fixture fail
            // and look like a status problem.
            id: 'o1', buyerId: 'b1', sellerId: 's1', sellerIds: ['s1'], items: [],
            totalAmount: 100, status,
            deliveryAddress: { recipientName: 'A', recipientPhone: '', street: '', city: '', state: '', lga: '' },
            createdAt: new Date(), updatedAt: new Date(),
        }).success;

    it('every status in the list is one OrderSchema accepts', () => {
        // If the two drift, one of them describes orders that cannot exist.
        for (const s of ORDER_STATUSES) {
            expect(statusParses(s)).toBe(true);
        }
    });

    it('and the schema rejects one that is not in the list', () => {
        // Vacuity guard: if the schema accepted anything, the assertion above
        // would pass for a list of nonsense.
        expect(statusParses('in_transit')).toBe(false);
        expect(statusParses('refunded')).toBe(false);
        expect(statusParses('nonsense')).toBe(false);
    });
});

describe('what counts as the buyer having paid', () => {
    it('excludes an order nobody has been charged for', () => {
        // THE test. This is the status an order is created in.
        expect(isPaidByBuyer('pending_payment')).toBe(false);
        expect(ORDER_UNPAID_STATUSES).toContain('pending_payment');
    });

    it('excludes a cancelled order', () => {
        expect(isPaidByBuyer('cancelled')).toBe(false);
    });

    it('includes a disputed order — they did pay it', () => {
        expect(isPaidByBuyer('disputed')).toBe(true);
    });

    it('and includes everything from payment onwards', () => {
        for (const s of ['payment_received', 'processing', 'shipped', 'delivered', 'completed']) {
            expect(isPaidByBuyer(s)).toBe(true);
        }
    });

    it('and nothing unrecognised', () => {
        for (const s of ['', undefined, null, 'in_transit', 'refunded']) {
            expect(isPaidByBuyer(s)).toBe(false);
        }
    });
});

describe('what counts as the seller\'s revenue', () => {
    it('excludes an unpaid order, which is what was wrong', () => {
        expect(countsAsSellerRevenue('pending_payment')).toBe(false);
    });

    it('still excludes cancelled and disputed, which was already right', () => {
        // Vacuity guard on the fix: the previous behaviour was correct about
        // these two, and a sloppy widening would have swept them in.
        expect(countsAsSellerRevenue('cancelled')).toBe(false);
        expect(countsAsSellerRevenue('disputed')).toBe(false);
    });

    it('differs from the buyer set on exactly one status', () => {
        // The property that justifies two sets rather than one.
        const onlyBuyer = ORDER_PAID_BY_BUYER.filter((s) => !ORDER_COUNTS_AS_SELLER_REVENUE.includes(s));
        const onlySeller = ORDER_COUNTS_AS_SELLER_REVENUE.filter((s) => !ORDER_PAID_BY_BUYER.includes(s));

        expect(onlyBuyer).toEqual(['disputed']);
        expect(onlySeller).toEqual([]);
    });

    it('and neither set contains an unpaid or cancelled order', () => {
        for (const set of [ORDER_PAID_BY_BUYER, ORDER_COUNTS_AS_SELLER_REVENUE]) {
            expect(set).not.toContain('pending_payment');
            expect(set).not.toContain('cancelled');
        }
    });
});

describe('the amount coercion', () => {
    it('reads a normal amount', () => {
        expect(orderAmount({ totalAmount: 5000 })).toBe(5000);
    });

    it('and yields 0 rather than NaN for anything unreadable', () => {
        // The NaN is what propagated through the whole reduce and rendered as ₦0.
        for (const bad of [undefined, null, 'abc', NaN, -5, 0, {}]) {
            expect(orderAmount({ totalAmount: bad } as any)).toBe(0);
        }
        expect(orderAmount(null)).toBe(0);
    });

    it('so one bad order cannot zero a whole total', () => {
        // THE test for the silent zero. Under the old expression this sum was NaN.
        const orders = [
            { status: 'completed', totalAmount: 5000 },
            { status: 'completed', totalAmount: undefined },
            { status: 'delivered', totalAmount: 2500 },
        ];

        expect(sumOrders(orders, isPaidByBuyer)).toBe(7500);
        // And the old form, for contrast.
        expect(orders.reduce((s, o) => s + (o.totalAmount as any), 0)).toBeNaN();
    });

    it('and an unpaid order contributes nothing', () => {
        const orders = [
            { status: 'pending_payment', totalAmount: 999999 },
            { status: 'cancelled', totalAmount: 888888 },
            { status: 'completed', totalAmount: 1000 },
        ];

        expect(sumOrders(orders, isPaidByBuyer)).toBe(1000);
        expect(sumOrders(orders, countsAsSellerRevenue)).toBe(1000);
    });
});

describe('active orders', () => {
    it('excludes the finished ones', () => {
        for (const s of ['delivered', 'completed', 'cancelled']) {
            expect(isActiveOrderStatus(s)).toBe(false);
        }
    });

    it('and includes the ones still in flight', () => {
        for (const s of ['pending_payment', 'payment_received', 'processing', 'shipped', 'disputed']) {
            expect(isActiveOrderStatus(s)).toBe(true);
        }
    });

    it('every status is either active or terminal', () => {
        // A status in neither set is invisible to both counts.
        for (const s of ORDER_STATUSES) {
            const active = ORDER_ACTIVE_STATUSES.includes(s);
            const terminal = ['delivered', 'completed', 'cancelled'].includes(s);
            expect(active || terminal).toBe(true);
        }
    });
});

describe('confirming receipt', () => {
    it('does not list a status orders never hold', () => {
        expect(ORDER_CONFIRMABLE_FROM).not.toContain('in_transit');
        for (const s of ORDER_CONFIRMABLE_FROM) {
            expect(ORDER_STATUSES).toContain(s);
        }
    });

    it('and the action reads the shared set', () => {
        const src = code('src/app/actions/marketplace/_buyer.ts');

        expect(src).toContain('fromAny: [...ORDER_CONFIRMABLE_FROM]');
        expect(src).not.toContain('["in_transit", "processing", "shipped"]');
    });
});

describe('both dashboards use it', () => {
    it('the buyer dashboard filters the total by paid status', () => {
        const src = code(BUYER_DASH);

        expect(src).toContain('sumOrders(orders, isPaidByBuyer)');
        expect(src).not.toMatch(/reduce\(\(sum, o\) => sum \+ o\.totalAmount, 0\)/);
    });

    it('and counts active orders from the shared set', () => {
        const src = code(BUYER_DASH);

        expect(src).toContain('isActiveOrderStatus(o.status)');
    });

    it('the seller dashboard counts revenue from the shared set', () => {
        const src = code(SELLER_DASH);

        expect(src).toContain('countsAsSellerRevenue(status)');
        expect(src).not.toContain('status !== "cancelled" && status !== "disputed"');
    });

    it('and coerces each amount — and takes only THIS seller\'s share of it', () => {
        const src = code(SELLER_DASH);

        // This asserted `orderAmount(data)`, whose point was the coercion:
        // Number.isFinite rather than `|| 0`. That point stands and
        // sellerOrderAmount keeps it — its single-seller branch IS
        // orderAmount's arithmetic.
        //
        // What changed is #342. orderAmount(data) is data.totalAmount, the
        // WHOLE basket, and one order row holds every seller's items. Summed
        // over `sellerIds array-contains me`, a seller's Total Sales counted
        // another merchant's goods and the full delivery fee. See
        // lib/order-scope.ts, which reproduces the per-seller split
        // _payment_orders.ts already uses to size each escrow row.
        expect(src).toContain('sellerOrderAmount(data, userId)');
        expect(src).not.toContain('data.totalAmount || 0');
    });

    it('neither stats query is unbounded any more', () => {
        // Four numbers do not justify loading an entire order history.
        expect(code(BUYER_DASH)).toContain('.limit(BUYER_STATS_ORDER_CAP)');
        expect(code(SELLER_DASH)).toContain('.limit(SELLER_ANALYTICS_CAP)');
    });

    it('and the seller date coercion is the shared one', () => {
        // A fifth hand-rolled copy lived here. Correct, like the one in
        // _ex_investments.ts, and duplicated all the same.
        const src = code(SELLER_DASH);

        expect(src).toContain('toMillis(createdAt)');
        expect(src).not.toContain('typeof createdAt.toDate === "function"');
    });
});
