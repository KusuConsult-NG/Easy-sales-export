/**
 * @jest-environment jsdom
 */

/**
 *   #582 EVERY PAID EXPORT ORDER WAS CANCELLED AS OUT OF STOCK.
 *
 *   Three names for one quantity, and no two of them met:
 *
 *     THE SELLER'S FORM COLLECTED NONE AT ALL. /export/products/create asks for
 *     name, icon, category, origin, season, pricePerMT, minOrderMT, grades and
 *     certifications. There is no stock field, and the admin catalogue editor
 *     has none either.
 *
 *     submitExportProductAction VALIDATED `availableQuantityMT` — carefully,
 *     refusing a negative — a field no caller had ever sent.
 *
 *     AND THE FULFILMENT DECREMENTED `availableQuantity`, the MARKETPLACE's
 *     field name, on a collection that has never carried it.
 *
 *   decrement_many_or_fail reads `COALESCE((raw_data ->> field)::numeric, 0)`
 *   (migration 015), so A FIELD THAT IS NOT THERE IS ZERO, and zero is short of
 *   any positive amount. Every export buyer order therefore reached:
 *
 *       logger.error("PAID BUT OUT OF STOCK — refund required")
 *       status: "cancelled_out_of_stock", paymentStatus: "paid_awaiting_refund"
 *
 *   The buyer was charged. The payment reference was already claimed, so a
 *   retry is a no-op. Somebody has to refund by hand. Not on some rows — on
 *   every row, because no row anywhere carries the field.
 *
 *   AN UNRECORDED STOCK IS NOT A STOCK OF ZERO, and that distinction is the fix.
 *   It is the reading this codebase already applies twice: a missing ceiling
 *   means uncapped (migration 015) and a missing minOrderMT means no minimum
 *   (#580). A listing with a real quantity is still counted down and a genuine
 *   shortfall is still refused all-or-nothing — #279's fix, untouched.
 *
 *   The seller's form asks for the quantity now, optionally, and the screen
 *   shows it. Blank means "not counting", which is what every listing submitted
 *   before today means.
 *
 *   #583 AND A REJECTED LISTING TOLD ITS SELLER NOTHING.
 *
 *   rejectContentAction stores the admin's typed reason as `rejectionReason` on
 *   the row, and this screen's own action returned the whole document — so the
 *   reason was already in the browser. The card drew a red cross and the word
 *   "Rejected" and stopped. With no edit on this screen, the seller's only move
 *   was to delete and start again from a blank form, without knowing what to
 *   change.
 *
 *   #584 AND THE SELLER WAS HANDED THE REVIEWER'S IDENTITY.
 *
 *   `{ id, ...doc.data() }` — the same shape the public catalogue had before
 *   #578. An export catalogue row carries `approvedBy` and `rejectedBy`, the
 *   internal ids of the ADMINS who reviewed it, plus createdBy, deletedBy and
 *   whatever else the unvalidated submit stored. The seller owns the listing;
 *   they do not own the reviewer's identity.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   No stock number is invented for any existing listing. Every row in the
 *   database today has no stock field and stays untracked, which means its
 *   orders complete rather than being refused — the direction that stops
 *   charging people for nothing.
 *
 *   FOR THE OWNER: orders already sitting at `paid_awaiting_refund` /
 *   `cancelled_out_of_stock` in export_orders were charged and never fulfilled.
 *   Nothing here touches them; they need looking at.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     an untracked row treated as zero                    KILLED (4 tests)
 *     the fulfilment field back to `availableQuantity`    KILLED (2)
 *     the tracked filter removed                          KILLED (2)
 *     the pre-charge stock check removed                  KILLED (2)
 *     a blank stock stored as 0                           KILLED (1)
 *     the rejection reason unrendered                     KILLED (1)
 *     the stock line dropped from the card                KILLED (1)
 *     the allow-list back to a spread                     KILLED (1)
 *     reword the finding comment                          SURVIVED, as intended
 *
 *   No mutant survived and none was discarded as equivalent.
 *
 * ── AND THE SUITE THAT SHOULD HAVE CAUGHT THIS ──────────────────────────────
 *
 *   export-payment-paths has covered the stock decrement since #279. It built
 *   an order whose items were `{ productId, quantityMT }` and asserted the
 *   action asked for `field: 'availableQuantity'` — both halves written from
 *   the same reading of the same file, so it could only ever confirm that the
 *   code said what the code said. It never asked whether a row carries that
 *   field, and no row does.
 *
 *   A test that pins the shape of a call is not a test that the call can
 *   succeed. That note is now in its header too.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { exportStockOf, exportStockIsTracked, EXPORT_STOCK_FIELD } from '@/lib/export-stock';

const mockInitPaystack = jest.fn() as jest.Mock<any>;
const mockVerifyPaystack = jest.fn() as jest.Mock<any>;
const mockDecrementManyOrFail = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: (...a: any[]) => mockVerifyPaystack(...a),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true, status: null })),
    decrementManyOrFail: (...a: any[]) => mockDecrementManyOrFail(...a),
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
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));

const BUYER_DETAILS = {
    companyName: 'A Co', contactPerson: 'A Person', email: 'b@e.com', phone: '0800',
    country: 'DE', portOfDestination: 'Hamburg', shippingTerm: 'CIF', additionalNotes: '',
};

/** An approved listing at $2,500/MT, with whatever stock is passed. */
function setCatalogue(extra: Record<string, unknown> = {}) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({ name: 'Cocoa Beans', pricePerMT: 2_500, isActive: true, userId: 'x', ...extra }),
    }));
}

async function checkout(quantityMT = 10) {
    const { initializeExportOrderPaymentAction } = await import('@/app/actions/export-payment');
    return initializeExportOrderPaymentAction(
        [{ productId: 'cocoa', quantityMT, grade: 'A' }] as any,
        BUYER_DETAILS as any,
        quantityMT * 2_500 * 1_650,
    ) as any;
}

/** The item list an order records, as this checkout writes it. */
function writtenOrderItems(): any[] {
    const calls = (global as any).mockFirestoreSet.mock.calls;
    const order = calls.map((c: any[]) => c[c.length - 1]).find((d: any) => d?.items);
    return order?.items ?? [];
}

beforeEach(() => {
    jest.clearAllMocks();
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'buyer-1', email: 'b@e.com', name: 'B', roles: [] } },
        error: null,
    }));
    setCatalogue();
    mockInitPaystack.mockResolvedValue({ authorizationUrl: 'https://pay', reference: 'ref-1' });
    mockDecrementManyOrFail.mockResolvedValue({ ok: true, failedId: null, reason: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#582 — what counts as a recorded stock', () => {
    it('A NUMBER IS ONE, AND ZERO IS A REAL ANSWER', () => {
        //   Zero means sold out — a seller who types it means it. That is the
        //   one case where "not tracked" and "none left" must NOT agree.
        expect(exportStockOf({ availableQuantityMT: 40 })).toBe(40);
        expect(exportStockOf({ availableQuantityMT: 0 })).toBe(0);
        expect(exportStockOf({ availableQuantityMT: '25' })).toBe(25);
        expect(exportStockIsTracked({ availableQuantityMT: 0 })).toBe(true);
    });

    it('AND AN ABSENT ONE IS NOT ZERO', () => {
        //   THE claim the whole fix rests on. Every listing in the database
        //   today is this case.
        for (const row of [{}, { availableQuantityMT: undefined }, { availableQuantityMT: null },
            { availableQuantityMT: '' }, { availableQuantityMT: 'plenty' }, { availableQuantityMT: -5 }]) {
            expect({ row, stock: exportStockOf(row as any) }).toEqual({ row, stock: null });
        }
        expect(exportStockIsTracked({})).toBe(false);
        //   And the marketplace's field is not this one.
        expect(exportStockIsTracked({ availableQuantity: 100 } as any)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#582 — an order against an untracked listing completes', () => {
    async function fulfil() {
        mockVerifyPaystack.mockResolvedValue({
            status: true,
            data: { status: 'success', amount: 100_000, metadata: { userId: 'buyer-1' } },
        });
        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        return verifyExportOrderPaymentAction('ref-1') as any;
    }

    function setOrder(items: any[]) {
        const order = { orderId: 'EXP-ORD-1', paymentReference: 'ref-1', items, buyerDetails: BUYER_DETAILS };
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false,
            docs: [{ id: 'order-doc', data: () => order }],
            data: () => order,
        }));
    }

    it('NOTHING IS DECREMENTED, AND THE ORDER IS NOT CANCELLED', async () => {
        //   THE defect. `availableQuantity` is not on any export row, a missing
        //   field is 0 to decrement_many_or_fail, and 0 is short of 3 — so this
        //   returned "PAID BUT OUT OF STOCK — refund required" for every order
        //   ever placed.
        setOrder([{ productId: 'prod-a', quantityMT: 3 }]);

        const result = await fulfil();

        expect(mockDecrementManyOrFail).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('AND A TRACKED ONE IS COUNTED DOWN, UNDER THE RIGHT NAME', async () => {
        //   Vacuity guard: skipping every decrement would make stock a decoration.
        setOrder([{ productId: 'prod-a', quantityMT: 3, stockTracked: true }]);

        const result = await fulfil();

        expect(result.success).toBe(true);
        expect(mockDecrementManyOrFail).toHaveBeenCalledTimes(1);
        expect((mockDecrementManyOrFail.mock.calls[0][0] as any[])[0]).toMatchObject({
            id: 'prod-a', field: EXPORT_STOCK_FIELD, amount: 3,
        });
    });

    it('AND A MIXED ORDER ONLY COUNTS THE TRACKED HALF', async () => {
        setOrder([
            { productId: 'prod-a', quantityMT: 3, stockTracked: true },
            { productId: 'prod-b', quantityMT: 2 },
        ]);

        await fulfil();

        const items = mockDecrementManyOrFail.mock.calls[0][0] as any[];
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('prod-a');
    });

    it('AND A GENUINE SHORTFALL IS STILL REFUSED', async () => {
        //   #279's fix, untouched: the buyer is told, the order is marked for
        //   refund, and nothing is half-decremented.
        setOrder([{ productId: 'prod-a', quantityMT: 3, stockTracked: true }]);
        mockDecrementManyOrFail.mockResolvedValue({ ok: false, failedId: 'prod-a', reason: 'insufficient' });

        const result = await fulfil();

        expect(result.success).toBe(false);
        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.status).toBe('cancelled_out_of_stock');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#582 — the checkout records and respects the stock', () => {
    it('AN ORDER STAMPS EACH LINE WITH WHETHER ANYBODY IS COUNTING', async () => {
        //   Fulfilment cannot ask this itself — from inside Postgres, "no stock
        //   recorded" and "none left" are the same value.
        setCatalogue({ availableQuantityMT: 100 });
        await checkout(10);
        expect(writtenOrderItems()[0]).toMatchObject({ stockTracked: true });

        jest.clearAllMocks();
        setCatalogue();
        mockInitPaystack.mockResolvedValue({ authorizationUrl: 'https://pay', reference: 'ref-1' });
        await checkout(10);
        expect(writtenOrderItems()[0]).toMatchObject({ stockTracked: false });
    });

    it('AND AN ORDER LARGER THAN THE STOCK IS REFUSED BEFORE THE CHARGE', async () => {
        //   The only stock check used to run AFTER the payment was claimed, so
        //   a listing that really was short cost the buyer a charge and a wait
        //   for a manual refund.
        setCatalogue({ availableQuantityMT: 5 });

        const r = await checkout(10);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/only 5 MT available/i);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('AND A SOLD-OUT LISTING SAYS SO', async () => {
        setCatalogue({ availableQuantityMT: 0 });

        const r = await checkout(10);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/out of stock/i);
    });

    it('AND AN UNTRACKED LISTING STILL SELLS ANY QUANTITY', async () => {
        //   Vacuity guard, and the whole point: every listing in the database
        //   today is untracked.
        setCatalogue();

        const r = await checkout(10_000);

        expect(r.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#582 — a blank stock is stored as no stock', () => {
    async function submit(overrides: Record<string, unknown>) {
        const { submitExportProductAction } = await import('@/app/actions/export-products');
        return submitExportProductAction({ name: 'Cocoa', pricePerMT: 2_500, ...overrides }) as any;
    }

    function written(): Record<string, any> {
        const calls = (global as any).mockFirestoreAdd.mock.calls;
        return calls.map((c: any[]) => c[c.length - 1]).filter(Boolean)[0] ?? {};
    }

    it('AN EMPTY BOX LEAVES THE FIELD OFF ENTIRELY', async () => {
        //   Number("") is 0, and a listing at 0 is out of stock — the defect
        //   again, one door along.
        const r = await submit({ availableQuantityMT: '' });

        expect(r.success).toBe(true);
        expect(EXPORT_STOCK_FIELD in written()).toBe(false);
    });

    it('AND A REAL NUMBER IS STORED', async () => {
        const r = await submit({ availableQuantityMT: '250' });

        expect(r.success).toBe(true);
        expect(written()[EXPORT_STOCK_FIELD]).toBe(250);
    });

    it('AND A NEGATIVE ONE IS STILL REFUSED', async () => {
        const r = await submit({ availableQuantityMT: -50 });

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#583 / #584 — the seller sees the reason, not the reviewer', () => {
    async function renderList(products: any[]) {
        const { default: MyExportProductsClient } =
            await import('@/app/export/(app)/products/MyExportProductsClient');
        return render(<MyExportProductsClient initial={products} />);
    }

    const LISTING = {
        id: 'p1', name: 'Cocoa Beans', category: 'nuts', origin: 'Ondo',
        pricePerMT: 2_500, minOrderMT: 10, certifications: ['NAFDAC'],
    };

    it('A REJECTED LISTING SHOWS WHY', async () => {
        //   THE defect. The reason was already in the browser and the card drew
        //   a red cross and the word "Rejected".
        const { container } = await renderList([
            { ...LISTING, status: 'rejected', rejectionReason: 'Phytosanitary certificate has expired.' },
        ]);

        await waitFor(() => expect(container.textContent).toContain('Phytosanitary certificate has expired.'));
    });

    it('AND A LIVE ONE SHOWS NO REJECTION BANNER', async () => {
        //   Vacuity guard: drawing it unconditionally would put a red panel on
        //   every approved listing.
        const { container } = await renderList([
            { ...LISTING, status: 'live', rejectionReason: 'stale reason from a previous round' },
        ]);

        expect(container.textContent).not.toContain('stale reason from a previous round');
        expect(container.textContent).not.toMatch(/why this was rejected/i);
    });

    it('AND THE STOCK IS SHOWN, INCLUDING THAT NOBODY IS COUNTING IT', async () => {
        const { container } = await renderList([
            { ...LISTING, status: 'live', availableQuantityMT: 250 },
        ]);
        expect(container.textContent).toContain('250 MT');

        const { container: untracked } = await renderList([{ ...LISTING, status: 'live' }]);
        expect(untracked.textContent).toMatch(/not tracked/i);
    });

    it('AND THE REVIEWER IS NOT HANDED TO THE SELLER', async () => {
        //   #584. `{ id, ...doc.data() }` published approvedBy and rejectedBy —
        //   internal admin ids — the same shape the public catalogue had before
        //   #578.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false,
            docs: [{
                id: 'p1',
                data: () => ({
                    ...LISTING, status: 'rejected', rejectionReason: 'Not certified',
                    userId: 'seller-1', approvedBy: 'admin-9', rejectedBy: 'admin-9',
                    createdBy: 'admin-9', deletedBy: null, internalNotes: 'chase the exporter',
                }),
            }],
        }));

        const { getUserExportProductsAction } = await import('@/app/actions/export-products');
        const res: any = await getUserExportProductsAction();

        expect(res.success).toBe(true);
        const [listing] = res.data;
        for (const secret of ['approvedBy', 'rejectedBy', 'createdBy', 'deletedBy', 'internalNotes', 'userId']) {
            expect({ secret, sent: secret in listing }).toEqual({ secret, sent: false });
        }
        //   And what the screen needs still arrives.
        expect(listing).toMatchObject({ id: 'p1', name: 'Cocoa Beans', rejectionReason: 'Not certified' });
    });
});
