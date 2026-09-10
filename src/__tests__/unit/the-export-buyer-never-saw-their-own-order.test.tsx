/**
 * @jest-environment jsdom
 */

/**
 *   #585 AN EXPORT BUYER PAID, AND NEVER HEARD ANOTHER WORD.
 *
 *   export_orders is written by the checkout, updated by the payment
 *   verification, and read by exactly three things: that verification, the
 *   ADMIN list, and the reconciliation cron. Nothing anywhere showed an order to
 *   the person who paid for it. Measured by sweep, not assumed.
 *
 *   What the buyer got instead:
 *
 *     A CONFIRMATION SCREEN SAYING "View My Dashboard". /dashboard's Active
 *     Orders tile counts MARKETPLACE_ORDERS by buyerId and nothing else — so the
 *     order they had just paid for, in a collection keyed by the same field,
 *     was not among them. The link went somewhere that could not show it.
 *
 *     NO NOTIFICATION. verifyExportOrderPaymentAction calls notifyAdmins and
 *     stops. Every other module's payment path notifies the person whose money
 *     moved.
 *
 *     AND NO SCREEN AT ALL. Not under /export/buyer; not in /export/(app),
 *     which is gated on export-module onboarding a buyer has no reason to hold;
 *     and not in the marketplace order list, which reads another collection.
 *
 *   updateAdminExportOrderStatusAction even carries the comment "Buyers'
 *   dashboards filter on these strings" — written while no buyer-facing screen
 *   read this collection at all. An admin marking an order shipped, or
 *   attaching the bill of lading, changed a value nobody could see and told
 *   nobody it had changed.
 *
 *   On a purchase that runs to tens of thousands of dollars, the entire record
 *   lived on screens the buyer cannot open.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   The order data was never lost — it has always been written correctly and
 *   the admin could always see it. This is about who can see it, and about a
 *   link that pointed at a screen which could not.
 *
 *   The new screen is READ-ONLY. Cancelling, disputing or re-ordering an export
 *   consignment are decisions with a shipping contract behind them, and
 *   inventing buttons for them here would be worse than the silence.
 *
 *   Nor is a notification a receipt. There is no e-mail on this path and this
 *   change does not add one; what it adds is a record inside the platform, on a
 *   screen that exists.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the admin status-change notification removed      KILLED (2 tests)
 *     export orders dropped from the active count       KILLED (2)
 *     the buyer notification removed                    KILLED (1)
 *     a failed read shown as an empty list              KILLED (1)
 *     the order allow-list back to a spread             KILLED (1)
 *     the item allow-list back to a spread              KILLED (1)
 *     the callback link back to /dashboard              KILLED (1)
 *     a terminal status counted as active               KILLED (1)
 *     reword the finding comment                        SURVIVED, as intended
 *
 *   No mutant survived. One INSTRUMENT fault, recorded where it happened: the
 *   callback-link assertion read the file raw, and the fix's own comment quotes
 *   the old label — so a not.toContain failed on the comment explaining the
 *   change. It strips comments now, with the shared helper.
 */

import React from 'react';
import { render } from '@testing-library/react';

const mockCreateNotification = jest.fn() as jest.Mock<any>;

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...a: any[]) => mockCreateNotification(...a),
}));
jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: jest.fn(),
    verifyPaystackPayment: jest.fn(async () => ({
        status: true,
        data: { status: 'success', amount: 100_000, metadata: { userId: 'buyer-1' } },
    })),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true, status: null })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
    markFulfilmentFailed: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getExchangeRates: jest.fn(async () => ({ usdToNgn: 1_650 })),
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 0 })),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));
jest.mock('@/lib/admin-notifications', () => ({ notifyAdmins: jest.fn() }));

/** The order document, as the checkout writes it. */
const ORDER = {
    orderId: 'EXP-ORD-1',
    buyerId: 'buyer-1',
    paymentReference: 'PSK-1',
    status: 'processing',
    totalUSD: 25_000,
    totalNGN: 41_250_000,
    items: [{ productId: 'cocoa', name: 'Cocoa Beans', grade: 'A', quantityMT: 10, pricePerMT: 2_500, totalUSD: 25_000, sellerId: 'exporter-9' }],
    buyerDetails: { companyName: 'A Co', email: 'b@e.com', phone: '0800', shippingTerm: 'CIF', portOfDestination: 'Hamburg' },
    createdAt: '2026-01-01T00:00:00.000Z',
};

function setOrder(overrides: Record<string, unknown> = {}) {
    const order = { ...ORDER, ...overrides };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false,
        docs: [{ id: 'order-doc', data: () => order }],
        data: () => order,
    }));
    return order;
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'buyer-1', email: 'b@e.com', name: 'B', roles: ['admin'] } },
        error: null,
    }));
    setOrder();
    mockCreateNotification.mockResolvedValue({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#585 — the buyer is told', () => {
    it('A PAID ORDER NOTIFIES THE PERSON WHO PAID', async () => {
        //   THE defect: notifyAdmins was called, and nothing else.
        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const result: any = await verifyExportOrderPaymentAction('PSK-1');

        expect(result.success).toBe(true);
        expect(mockCreateNotification).toHaveBeenCalledTimes(1);
        const sent = mockCreateNotification.mock.calls[0][0];
        expect(sent.userId).toBe('buyer-1');
        expect(sent.message).toContain('EXP-ORD-1');
        //   And it points at a screen that exists — see the callback test below.
        expect(sent.link).toBe('/export/buyer/orders');
    });

    it('AND A NOTIFICATION THAT FAILS DOES NOT UNDO THE FULFILMENT', async () => {
        //   By the time this runs the payment is claimed and the stock is
        //   decremented. A notification that cannot be written is a log line.
        mockCreateNotification.mockRejectedValue(new Error('notifications down'));

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const result: any = await verifyExportOrderPaymentAction('PSK-1');

        expect(result.success).toBe(true);
    });

    it('AND AN ADMIN MOVING THE ORDER ON TELLS THEM TOO', async () => {
        //   "Buyers' dashboards filter on these strings" — written while no
        //   buyer-facing screen read this collection at all.
        const { updateAdminExportOrderStatusAction } = await import('@/app/actions/export-admin');
        const result: any = await updateAdminExportOrderStatusAction('order-doc', 'shipped');

        expect(result.success).toBe(true);
        expect(mockCreateNotification).toHaveBeenCalledTimes(1);
        const sent = mockCreateNotification.mock.calls[0][0];
        expect(sent.userId).toBe('buyer-1');
        expect(sent.message).toMatch(/shipped/i);
    });

    it('AND SAYS SO WHEN A DOCUMENT IS ATTACHED', async () => {
        const { updateAdminExportOrderStatusAction } = await import('@/app/actions/export-admin');
        await updateAdminExportOrderStatusAction('order-doc', 'shipped', {
            name: 'Bill of Lading', url: 'https://docs.test/bl.pdf', type: 'pdf',
        });

        expect(mockCreateNotification.mock.calls[0][0].message).toContain('Bill of Lading');
    });

    it('AND AN UNKNOWN STATUS IS STILL REFUSED, WITH NOBODY TOLD', async () => {
        //   Vacuity guard on the notification: it must not fire for a change
        //   that did not happen.
        const { updateAdminExportOrderStatusAction } = await import('@/app/actions/export-admin');
        const result: any = await updateAdminExportOrderStatusAction('order-doc', 'shiped');

        expect(result.success).toBe(false);
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#585 — and can open the order', () => {
    it('THE READER RETURNS THE BUYER THEIR ORDER, NOT THE PLATFORM ITS IDS', async () => {
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false, docs: [{ id: 'order-doc', data: () => ORDER }],
        }));

        const { readMyExportOrders } = await import('@/lib/export-orders-reader');
        const [order] = await readMyExportOrders('buyer-1');

        //   What they need to recognise it.
        expect(order).toMatchObject({
            orderId: 'EXP-ORD-1', status: 'processing', totalNGN: 41_250_000,
            paymentReference: 'PSK-1', shippingTerm: 'CIF', portOfDestination: 'Hamburg',
        });
        expect(order.items[0]).toMatchObject({ name: 'Cocoa Beans', quantityMT: 10 });

        //   And what stays on the server.
        expect('buyerId' in order).toBe(false);
        expect('buyerDetails' in order).toBe(false);
        expect('sellerId' in order.items[0]).toBe(false);
        expect('productId' in order.items[0]).toBe(false);
    });

    it('AND THE SCREEN DRAWS IT', async () => {
        const { readMyExportOrders } = await import('@/lib/export-orders-reader');
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false, docs: [{ id: 'order-doc', data: () => ORDER }],
        }));
        const orders = await readMyExportOrders('buyer-1');

        const { default: MyExportOrdersClient } =
            await import('@/app/export/buyer/orders/MyExportOrdersClient');
        const { container } = render(<MyExportOrdersClient orders={orders} />);

        expect(container.textContent).toContain('EXP-ORD-1');
        expect(container.textContent).toContain('Cocoa Beans');
        expect(container.textContent).toContain('₦41,250,000');
        expect(container.textContent).toMatch(/processing/i);
    });

    it('AND A FAILED READ IS NOT AN EMPTY LIST', async () => {
        //   #579's distinction, and it matters more here: telling somebody who
        //   has just paid that they have no orders is the worse of the two lies.
        const { default: MyExportOrdersClient } =
            await import('@/app/export/buyer/orders/MyExportOrdersClient');

        const { container: failed } = render(<MyExportOrdersClient orders={null} />);
        expect(failed.textContent).toMatch(/could not load your orders/i);
        expect(failed.textContent).not.toMatch(/no orders yet/i);

        const { container: empty } = render(<MyExportOrdersClient orders={[]} />);
        expect(empty.textContent).toMatch(/no orders yet/i);
        expect(empty.textContent).not.toMatch(/could not load/i);
    });

    it('AND A REFUND-DUE ORDER SAYS THE BUYER WAS CHARGED', async () => {
        //   #582's state. Dressing it up as "cancelled" would hide the fact
        //   that money left the buyer and has not come back.
        const { default: MyExportOrdersClient } =
            await import('@/app/export/buyer/orders/MyExportOrdersClient');

        const { container } = render(<MyExportOrdersClient orders={[{
            id: 'o1', orderId: 'EXP-ORD-2', status: 'cancelled_out_of_stock',
            totalUSD: 1, totalNGN: 1_650, items: [],
        } as any]} />);

        expect(container.textContent).toMatch(/refund due/i);
        expect(container.textContent).toMatch(/you were charged/i);
    });

    it('AND THE CONFIRMATION SCREEN POINTS AT IT', async () => {
        //   The link used to go to /dashboard, whose Active Orders tile could
        //   not see this order at all.
        const { readFileSync } = await import('fs');
        const { stripComments } = await import('@/lib/testing/strip-comments');
        //   STRIPPED, because the fix's own comment quotes the old label — the
        //   trap this codebase's suites keep walking into, and this assertion
        //   walked into it on its first run.
        const callback = stripComments(
            readFileSync('src/app/export/buyer/cart/payment-callback/page.tsx', 'utf-8'),
            { label: 'payment-callback' },
        );

        expect(callback).toContain('href="/export/buyer/orders"');
        expect(callback).not.toContain('View My Dashboard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#585 — and the dashboard counts it', () => {
    function setOrdersByCollection(marketplace: any[], exportOrders: any[]) {
        (global as any).mockFirestoreGet.mockImplementation(function (this: any) {
            //   The adapter mock is shared, so the two queries are told apart by
            //   what they asked for rather than by call order.
            return Promise.resolve({ empty: false, docs: [] });
        });
        //   One query per collection: resolve them in the order my-data issues.
        let call = 0;
        (global as any).mockFirestoreGet.mockImplementation(() => {
            call += 1;
            const docs = (call === 1 ? marketplace : exportOrders)
                .map((d, i) => ({ id: `d${i}`, data: () => d }));
            return Promise.resolve({ empty: docs.length === 0, docs });
        });
    }

    it('AN EXPORT ORDER IS AN ACTIVE ORDER', async () => {
        //   THE defect: the tile the payment callback sent the buyer to counted
        //   one of the two collections keyed by their own id.
        setOrdersByCollection([], [{ status: 'processing' }, { status: 'shipped' }]);

        const { getMyActiveOrderCount } = await import('@/app/actions/my-data');

        expect(await getMyActiveOrderCount()).toBe(2);
    });

    it('AND MARKETPLACE ORDERS STILL COUNT', async () => {
        //   Vacuity guard: a change that swapped one collection for the other
        //   would look identical on the tile.
        setOrdersByCollection([{ status: 'processing' }], [{ status: 'processing' }]);

        const { getMyActiveOrderCount } = await import('@/app/actions/my-data');

        expect(await getMyActiveOrderCount()).toBe(2);
    });

    it('AND A TERMINAL EXPORT STATUS IS NOT ACTIVE', async () => {
        //   cancelled_out_of_stock and refunded are export-only and both
        //   terminal. An order awaiting a refund is not in flight.
        setOrdersByCollection([], [
            { status: 'cancelled_out_of_stock' }, { status: 'refunded' },
            { status: 'completed' }, { status: 'delivered' },
        ]);

        const { getMyActiveOrderCount } = await import('@/app/actions/my-data');

        expect(await getMyActiveOrderCount()).toBe(0);
    });
});
