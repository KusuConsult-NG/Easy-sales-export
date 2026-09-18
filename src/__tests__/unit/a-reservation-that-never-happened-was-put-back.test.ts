/**
 * @jest-environment node
 */

/**
 *   #755 A STOCK RESERVATION THAT NEVER HAPPENED WAS PUT BACK, INFLATING THE
 *        SHELF ON EVERY FAILED DECREMENT.
 *
 *   Found by answering the owner's question — "can users or admin add products
 *   and can other users buy them or add them to cart?" — by running the journey
 *   rather than reading it. Seller creates, buyer lists, buyer opens, buyer
 *   orders. The order failed, which was expected in a harness with no stock
 *   RPC. What was not expected:
 *
 *       stock before: 100     ordered: 2     STOCK AFTER: 102
 *
 *   A FAILED ORDER ADDED TWO UNITS TO THE SELLER'S INVENTORY.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 *
 *   `_createPaymentOnDeliveryOrderAction` assigned the restorable list BEFORE
 *   attempting the decrement:
 *
 *       reserved = validatedItems.map(...)          // ← what we want to take
 *       const stock = await decrementManyOrFail(reserved);
 *
 *   and `decrementManyOrFail` THROWS rather than returning when the RPC itself
 *   fails — a network error, a transient database outage, the function missing:
 *
 *       if (error) { throw new Error(`Stock decrement failed: ${error.message}`) }
 *
 *   That throw lands in the function's catch, which finds `reserved.length > 0`
 *   and calls `restoreReservedStock` — crediting units that were never debited.
 *
 *   The consequence is phantom inventory, and it compounds: every transient
 *   failure raises availableQuantity again, so the shop goes on selling stock
 *   that does not exist and buyers pay for goods that cannot be shipped. It is
 *   silent, because an order that failed and a shelf that grew look unrelated.
 *
 * ── THE REASONING WAS ALREADY IN THE FILE, ONE BRANCH DOWN ──────────────────
 *
 *       if (!stock.ok) {
 *           //   Nothing to restore: 015 is all-or-nothing, so a refusal
 *           //   decremented nothing.
 *           reserved = [];
 *
 *   True of the `ok: false` RETURN, equally true of the THROW, and applied only
 *   to the return. The recurring shape of this audit.
 *
 *   AND ORDERS.TS ALREADY DOES IT CORRECTLY — decrement, check `reservation.ok`,
 *   and only then assign `reserved`. One copy of a path right and its sibling
 *   wrong, which is what this file's own comment three lines above the defect
 *   complains about: "one copy of a path fixed and its sibling left, which is
 *   the shape this codebase keeps producing."
 *
 * ── AND THE THIRD WRITER HAD NO COMPENSATION AT ALL ─────────────────────────
 *
 *   `_createBankTransferOrderAction` — same file, same reservation — never
 *   called `restoreReservedStock`. #613 wired it into the POD order and into
 *   orders.ts and did not reach this one, so any failure AFTER a SUCCESSFUL
 *   decrement left the units missing from the shelf with no order to show for
 *   them. That is #613's own defect, in the opposite direction to the one
 *   above, on the path it did not reach.
 *
 *   `pending` is what we are asking to take; `reserved` is what we know we have
 *   taken and therefore owe back. Two different facts that were sharing one
 *   variable.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const ORDERS = 'src/app/actions/marketplace/_payment_orders.ts';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';

const decrementManyOrFail = jest.fn<(...a: any[]) => Promise<any>>();
const restoreReservedStock = jest.fn<(...a: any[]) => Promise<any>>(async () => undefined);
const runTransaction = jest.fn<(...a: any[]) => Promise<any>>(async (fn: any) => fn({
    get: async () => ({ data: () => ({ availableQuantity: 98, sellerId: SELLER, title: 'Yellow Maize' }) }),
    update: () => undefined,
    set: () => undefined,
}));

jest.mock('@/lib/wallet-ledger', () => ({
    decrementManyOrFail: (...a: unknown[]) => decrementManyOrFail(...a),
    restoreReservedStock: (...a: unknown[]) => restoreReservedStock(...a),
}));

/*
 *   The cart is mocked at its module boundary, deliberately. This suite is
 *   about ONE contract — which units the order owes back, and when — and
 *   validating a cart against a seeded store would put three hundred lines of
 *   unrelated setup between the reader and that contract.
 */
jest.mock('@/lib/marketplace-cart', () => ({
    validateCartItems: async () => ({
        subtotal: 10000,
        validatedItems: [{
            productId: 'prod-1', productTitle: 'Yellow Maize', quantity: 2,
            price: 5000, sellerId: SELLER, isFlashSale: false, unit: 'bag',
        }],
    }),
    calculateDeliveryFee: () => 500,
    estimateCartWeight: () => 10,
    nairaToKobo: (n: number) => n * 100,
    //   #873 — the order paths call this once the order is written.
    markQuotesSpent: async () => undefined,
}));
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: async () => ({ minOrderAmount: 0, maxOrderAmount: 10_000_000, commissionRate: 5 }),
}));
jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: () => ({
                get: async () => ({ data: () => ({ allowsPaymentOnDelivery: true }) }),
                set: async () => undefined,
            }),
        }),
        runTransaction: (...a: unknown[]) => runTransaction(...a),
    },
}));
jest.mock('@/lib/marketplace-notifications', () => ({ notifyOrderPlaced: async () => undefined }));
jest.mock('@/infrastructure/notifications/service', () => ({ createNotification: async () => undefined }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('@/lib/paystack-server', () => ({ initializePaystackPayment: async () => ({ authorizationUrl: 'u', reference: 'r' }) }));

const ADDRESS = {
    recipientName: 'Bola Buyer', recipientPhone: '08011111111',
    street: '12 Broad St', city: 'Ikeja', state: 'Lagos', lga: 'Ikeja',
};

const CART = [{
    id: 'prod-1', productId: 'prod-1', title: 'Yellow Maize', price: 5000,
    quantity: 2, sellerId: SELLER, unit: 'bag',
}];

const pod = async () => {
    const m = await import('@/app/actions/marketplace/_payment_orders');
    return m.createPaymentOnDeliveryOrderAction(CART as any, '08011111111', ADDRESS as any) as any;
};
const bank = async () => {
    const m = await import('@/app/actions/marketplace/_payment_orders');
    return m.createBankTransferOrderAction(CART as any, 'b@e.com', '08011111111', 500) as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    process.env.MARKETPLACE_OFFLINE_CHECKOUT = 'enabled';
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: BUYER, roles: ['buyer'], email: 'b@e.com', name: 'Bola' } },
        error: null,
    }));
    restoreReservedStock.mockResolvedValue(undefined);
    runTransaction.mockImplementation(async (fn: any) => fn({
        get: async () => ({ data: () => ({ availableQuantity: 98, sellerId: SELLER, title: 'Yellow Maize' }) }),
        update: () => undefined,
        set: () => undefined,
    }));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#755 — a decrement that THREW put nothing back', () => {
    it('PAYMENT ON DELIVERY RESTORES NOTHING WHEN THE RPC ITSELF FAILS', async () => {
        /*
         *   THE finding. `decrementManyOrFail` throws on an RPC error, so
         *   nothing was taken — and the old code credited the units anyway,
         *   raising the shelf by the ordered quantity.
         */
        decrementManyOrFail.mockRejectedValue(new Error('Stock decrement failed: fetch failed'));

        const r = await pod();

        expect(r.success).toBe(false);
        expect(restoreReservedStock).not.toHaveBeenCalled();
    });

    it('AND SO DOES THE BANK TRANSFER PATH', async () => {
        decrementManyOrFail.mockRejectedValue(new Error('Stock decrement failed: fetch failed'));

        const r = await bank();

        expect(r.success).toBe(false);
        expect(restoreReservedStock).not.toHaveBeenCalled();
    });

    it('AND A REFUSAL — ok:false — RESTORES NOTHING EITHER, AS BEFORE', async () => {
        //   The branch that was already right. Asserted so the fix cannot be
        //   read as having introduced it, and so it cannot regress.
        decrementManyOrFail.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'insufficient' });

        const r = await pod();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/insufficient stock/i);
        expect(restoreReservedStock).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#755 — and a reservation that DID happen is still put back', () => {
    /**
     * The vacuity guard, and it is the whole of #613. A fix that simply stopped
     * restoring would pass every assertion above and reintroduce the defect
     * #613 exists for: units missing from the shelf with no order behind them.
     */
    it('PAYMENT ON DELIVERY RESTORES WHEN THE WORK AFTER THE RESERVATION FAILS', async () => {
        decrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
        runTransaction.mockRejectedValue(new Error('write failed'));

        const r = await pod();

        expect(r.success).toBe(false);
        expect(restoreReservedStock).toHaveBeenCalledTimes(1);
    });

    it('AND THE BANK TRANSFER PATH NOW DOES TOO — #613 ON THE PATH IT MISSED', async () => {
        /*
         *   This one restored NOTHING before: the catch logged and returned.
         *   #613 wired the compensation into the POD order and into orders.ts
         *   and did not reach this third writer in the same file.
         */
        decrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
        runTransaction.mockRejectedValue(new Error('write failed'));

        const r = await bank();

        expect(r.success).toBe(false);
        expect(restoreReservedStock).toHaveBeenCalledTimes(1);
    });

    it('AND IT PUTS BACK EXACTLY WHAT WAS TAKEN, NOT A GUESS', async () => {
        /*
         *   The quantity and the collection both matter: restoring 1 where 2
         *   were taken, or crediting PRODUCTS for a flash-sale row, is a
         *   quieter version of the same defect.
         */
        decrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
        runTransaction.mockRejectedValue(new Error('write failed'));

        await pod();

        const [items] = restoreReservedStock.mock.calls[0] as any[];
        expect(items).toEqual([{
            collection: 'products', id: 'prod-1',
            field: 'availableQuantity', amount: 2,
        }]);
    });

    it('and the units restored are the ones the decrement was ASKED for', async () => {
        //   Ties the two lists together: `pending` is what went to the
        //   decrement and `reserved` is what comes back, and they must be the
        //   same set or one of them is wrong.
        decrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
        runTransaction.mockRejectedValue(new Error('write failed'));

        await pod();

        const [asked] = decrementManyOrFail.mock.calls[0] as any[];
        const [restored] = restoreReservedStock.mock.calls[0] as any[];
        expect(restored).toEqual(asked);
    });

    it('and a successful order restores nothing at all', async () => {
        //   The ordinary case. A restore on the happy path would double the
        //   shelf on every sale.
        decrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });

        const r = await pod();

        expect(r.success).toBe(true);
        expect(restoreReservedStock).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#755 — and the shape is the same in all three writers', () => {
    it('NO PATH ASSIGNS ITS RESTORABLE LIST BEFORE THE DECREMENT RETURNS', () => {
        /*
         *   Stated as a property over the file rather than per site. The defect
         *   is an ORDERING, and the two paths here plus orders.ts are three
         *   copies of it — a per-site assertion would pass with one left.
         *
         *   `reserved = <anything but pending or []>` is the shape that was
         *   wrong: a list built inline at the assignment, before any call.
         */
        const src = code(ORDERS);
        const assignments = [...src.matchAll(/reserved = ([^;]+);/g)].map((m) => m[1].trim());

        expect(assignments.sort()).toEqual(['[]', 'pending', 'pending']);
    });

    it('AND EACH DECREMENT IS HANDED `pending`, WHICH IS NOT THE RESTORABLE LIST', () => {
        const src = code(ORDERS);

        expect([...src.matchAll(/decrementManyOrFail\(pending\)/g)]).toHaveLength(2);
        //   The old spelling, asserted absent: handing the restorable list
        //   straight to the decrement is what conflated the two facts.
        expect(src).not.toContain('decrementManyOrFail(reserved)');
    });

    it('AND BOTH PATHS COMPENSATE, WHERE ONE OF THEM DID NOT', () => {
        const src = code(ORDERS);
        const restores = [...src.matchAll(/await restoreReservedStock\(reserved,/g)];

        expect(restores).toHaveLength(2);
        expect(src).toContain('createBankTransferOrderAction failed after reserving stock');
        expect(src).toContain('createPaymentOnDeliveryOrderAction failed after reserving stock');
    });

    it('and orders.ts — which was already right — still is', () => {
        /*
         *   The evidence that this was drift between copies rather than a
         *   design choice, and a ratchet on the copy that was correct. Its
         *   decrement takes an inline list and `reserved` is assigned after the
         *   ok check.
         */
        const src = code('src/app/actions/orders.ts');
        const decAt = src.indexOf('decrementManyOrFail(');
        const assignAt = src.indexOf('reserved = items.map');

        expect({ found: decAt > -1 && assignAt > -1 }).toEqual({ found: true });
        expect(assignAt).toBeGreaterThan(decAt);
    });

    it('and decrementManyOrFail really does throw rather than return, which is the premise', () => {
        //   Without this the whole finding is hypothetical. It is the one fact
        //   the ordering depends on.
        expect(code('src/lib/wallet-ledger.ts'))
            .toContain('throw new Error(`Stock decrement failed: ${error.message}`)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     POD assigns `reserved` before the decrement again              KILLED
 *     POD assigns reserved up front (the original defect, restored)  KILLED
 *     bank transfer's restore is removed again                       KILLED
 *     bank transfer stops marking its reservation restorable         KILLED
 *     the restored amount is halved                                  KILLED
 *     the ok:false branch stops clearing `reserved`                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The second row is the defect itself, re-introduced verbatim, which is the
 *   mutant worth having: it is the only one that proves this suite would have
 *   caught what shipped.
 */
