/**
 * @jest-environment node
 */

/**
 * #88 — the export investment that no webhook could fulfil.
 *
 * THE DEFECT
 * ----------
 * Three server-side entry points fulfil `type: "export_investment"`:
 *
 *   api/webhooks/paystack               the live webhook
 *   api/cron/reconcile-paystack         the nightly heal
 *   api/admin/finance/paystack-sync     the admin heal
 *
 * All three read `metadata.exportId`, and processExportInvestment's first line
 * is `if (!exportId) throw new Error("Missing exportId in metadata")`.
 *
 * There are two initiators and they disagree about the key:
 *
 *   initializeInvestmentPaymentAction   writes `windowId`. Called from
 *   (actions/export-payment.ts)         /export/windows/[id] — the only
 *                                       investment button in the app.
 *
 *   investInExportAction                writes `exportId`. No caller at all.
 *   (actions/export/_ex_investments.ts)
 *
 * So for every investment anybody has actually made, the webhook threw on its
 * first line, and BOTH reconciliation jobs failed the same way on the same
 * key — which is why nothing surfaced it: the job whose purpose is to report
 * unfulfilled payments could not fulfil these either.
 *
 * The investor was left depending on getting back to the callback page so
 * verifyInvestmentPaymentAction could run. Close the tab, lose signal, or let
 * the redirect fail, and the money was taken with nothing recorded anywhere.
 *
 * THE SECOND HALF
 * ---------------
 * This path writes an EXPORT_SLOTS row. The four export pages an investor
 * looks at — dashboard, portfolio, transactions, investments/[id] — read
 * EXPORT_INVESTMENTS by `investorId` and INVESTOR_PORTFOLIOS. Fixing the id
 * alone would have traded "nothing happens" for "the window is funded, the
 * slot exists, and the investor still sees a pending investment and a
 * portfolio of zero", so the settlement lands with it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
const incrementWithinCeiling = jest.fn(
    async (_p: unknown) => ({ ok: true } as { ok: boolean; reason?: string }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    incrementWithinCeiling: (p: unknown) => incrementWithinCeiling(p),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/whatsapp-invites', () => ({
    generateAndSendWhatsAppInvite: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const ROOT = process.cwd();
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const DISPATCH_SITES = [
    'src/app/api/webhooks/paystack/route.ts',
    'src/app/api/cron/reconcile-paystack/route.ts',
    'src/app/api/admin/finance/paystack-sync/route.ts',
];

const REF = 'EXP-REF-88';
const INVESTOR = 'investor-88';
const WINDOW = 'window-88';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    incrementWithinCeiling.mockImplementation(async () => ({ ok: true }));
    store = installFakeDb();
});

const service = () => import('@/infrastructure/payments/service');

// ─────────────────────────────────────────────────────────────────────────────
describe('exportWindowIdFromMetadata', () => {
    it('reads BOTH names, because the two initiators use different ones', async () => {
        const { exportWindowIdFromMetadata } = await service();

        expect(exportWindowIdFromMetadata({ exportId: 'w1' })).toBe('w1');
        expect(exportWindowIdFromMetadata({ windowId: 'w2' })).toBe('w2');
    });

    it('prefers exportId, so nothing that works today changes', async () => {
        const { exportWindowIdFromMetadata } = await service();
        expect(exportWindowIdFromMetadata({ exportId: 'w1', windowId: 'w2' })).toBe('w1');
    });

    it('returns undefined for metadata that names neither, rather than a falsy id', async () => {
        const { exportWindowIdFromMetadata } = await service();

        for (const meta of [null, undefined, {}, { exportId: '' }, { windowId: '   ' }, { exportId: 42 }]) {
            expect(exportWindowIdFromMetadata(meta as Record<string, unknown>)).toBeUndefined();
        }
    });
});

describe('the metadata the live initiator actually writes', () => {
    it('is windowId — the key the fulfilment paths were NOT reading', async () => {
        // The premise of the whole finding, read off the source rather than
        // assumed. If a future change makes this initiator write exportId, this
        // test says so instead of quietly making the fix look unnecessary.
        const src = read('src/app/actions/export-payment.ts');
        const call = src.slice(src.indexOf('initializePaystackPayment('), src.indexOf('Create pending investment record'));

        expect(call).toContain('windowId');
        expect(call).toContain('type: "export_investment"');
    });

    it('and /export/windows/[id] is what calls it — this is not a dead path', async () => {
        const page = read('src/app/export/windows/[id]/page.tsx');
        expect(page).toContain('initializeInvestmentPaymentAction');
    });
});

describe('every dispatch site resolves the window id through the shared helper', () => {
    it.each(DISPATCH_SITES)('%s', (rel) => {
        const src = read(rel);
        expect(src).toContain('exportWindowIdFromMetadata');
    });

    it.each(DISPATCH_SITES)('%s no longer reads metadata.exportId bare', (rel) => {
        // The exact shape of the defect: three copies of one lookup, each
        // written independently, all reading the key the live initiator does
        // not set.
        expect(read(rel)).not.toMatch(/metadata\.exportId/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('processExportInvestment settles the record the investor can see', () => {
    const seedWindow = (extra: Record<string, unknown> = {}) =>
        store.seed(COLLECTIONS.EXPORT_WINDOWS, WINDOW, {
            title: 'Sesame Q4', status: 'open',
            roiPercentage: '20%', returnMultiplier: 1.2,
            fundingGoal: 10_000_000, fundedAmount: 0,
            ...extra,
        });

    const seedPendingInvestment = (extra: Record<string, unknown> = {}) =>
        store.seed(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-1', {
            investmentId: 'inv-1',
            windowId: WINDOW,
            investorId: INVESTOR,
            investorEmail: 'ada@example.com',
            amount: 100_000,
            expectedReturn: 120_000,
            paymentReference: REF,
            status: 'pending_payment',
            ...extra,
        });

    const run = async (amount = 100_000) =>
        (await service()).processExportInvestment(REF, amount, INVESTOR, WINDOW);

    const investment = () => store.get(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-1') as Record<string, any>;
    const portfolio = () => store.get(COLLECTIONS.INVESTOR_PORTFOLIOS, INVESTOR) as Record<string, any>;

    beforeEach(() => { seedWindow(); });

    it('still refuses a payment with no window id at all', async () => {
        await expect((await service()).processExportInvestment(REF, 1, INVESTOR, '' as string))
            .rejects.toThrow('Missing exportId');
    });

    it('writes the slot, as it always did', async () => {
        seedPendingInvestment();
        await run();

        const slots = store.all(COLLECTIONS.EXPORT_SLOTS);
        expect(slots).toHaveLength(1);
        expect(slots[0][1]).toMatchObject({
            userId: INVESTOR, exportId: WINDOW, amount: 100_000,
            status: 'active', paymentReference: REF, source: 'webhook',
        });
    });

    it('AND marks the investor\'s own record active, which it never used to', async () => {
        seedPendingInvestment();
        await run();

        expect(investment()).toMatchObject({
            status: 'active', paymentStatus: 'completed',
        });
    });

    it('AND credits the portfolio the dashboard reads', async () => {
        seedPendingInvestment();
        await run();

        expect(portfolio()).toMatchObject({
            investorId: INVESTOR,
            totalInvested: 100_000,
            totalExpectedReturns: 120_000,
            activeInvestments: 1,
            totalReturned: 0,
        });
    });

    it('adds to an existing portfolio rather than replacing it', async () => {
        store.seed(COLLECTIONS.INVESTOR_PORTFOLIOS, INVESTOR, {
            investorId: INVESTOR, totalInvested: 400_000,
            totalExpectedReturns: 480_000, activeInvestments: 2, totalReturned: 50_000,
        });
        seedPendingInvestment();
        await run();

        expect(portfolio()).toMatchObject({
            totalInvested: 500_000,
            totalExpectedReturns: 600_000,
            activeInvestments: 3,
            // Untouched: a return already recorded is not erased by a new
            // investment.
            totalReturned: 50_000,
        });
    });

    it('matches the pending record by REFERENCE, not by investor', async () => {
        // The same investor can hold several investments in the same window;
        // only the one this payment paid for may be settled.
        seedPendingInvestment();
        store.seed(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-2', {
            investorId: INVESTOR, windowId: WINDOW, amount: 100_000,
            paymentReference: 'SOME-OTHER-REF', status: 'pending_payment',
        });

        await run();

        expect(investment().status).toBe('active');
        expect(store.get(COLLECTIONS.EXPORT_INVESTMENTS, 'inv-2')?.status).toBe('pending_payment');
    });

    it('falls back to the computed return when the record carries none', async () => {
        seedPendingInvestment({ expectedReturn: undefined });
        await run();

        // amount * returnMultiplier, the figure the slot is written with.
        expect(portfolio().totalExpectedReturns).toBe(120_000);
    });

    it('fulfils normally when there is no pending record — the other initiator', async () => {
        // investInExportAction creates nothing up front. Its payments must still
        // fund the window and write the slot.
        await run();

        expect(store.all(COLLECTIONS.EXPORT_SLOTS)).toHaveLength(1);
        expect(store.size(COLLECTIONS.INVESTOR_PORTFOLIOS)).toBe(0);
        expect(store.get(COLLECTIONS.TRANSACTIONS, REF)).toMatchObject({ status: 'completed' });
    });

    it('does not settle anything when the payment is a duplicate delivery', async () => {
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));
        seedPendingInvestment();

        await run();

        expect(investment().status).toBe('pending_payment');
        expect(store.size(COLLECTIONS.EXPORT_SLOTS)).toBe(0);
        expect(store.size(COLLECTIONS.INVESTOR_PORTFOLIOS)).toBe(0);
    });

    it('does not settle anything when the investment is routed to overfunded review', async () => {
        incrementWithinCeiling.mockImplementation(async () => ({ ok: false, reason: 'ceiling' }));
        seedPendingInvestment();

        await run();

        expect(investment().status).toBe('pending_payment');
        expect(store.size(COLLECTIONS.INVESTOR_PORTFOLIOS)).toBe(0);
        expect(store.get(COLLECTIONS.FAILED_PAYMENTS, REF)).toMatchObject({
            status: 'overfunded_review',
        });
    });

    it('writes the unified ledger row last, so the slot is never the thing missing', async () => {
        seedPendingInvestment();
        await run();

        expect(store.get(COLLECTIONS.TRANSACTIONS, REF)).toMatchObject({
            id: REF, userId: INVESTOR, type: 'export_investment',
            module: 'export', amount: 100_000, status: 'completed',
        });
    });
});
