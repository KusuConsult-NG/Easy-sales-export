/**
 * @jest-environment node
 */

/**
 * The export investment surface, EXECUTED — the investor's own view of what
 * they bought, the invest button, the callback verifier, and the admin escrow
 * control.
 *
 * At 25%. Three findings were located by running it:
 *
 *   #88  Every server-side path that fulfils an export investment read
 *        `metadata.exportId`, and the only initiator with a UI writes
 *        `windowId`. processExportInvestment throws on a missing id, so the
 *        webhook never fulfilled a live investment and NEITHER reconciliation
 *        job could heal one — they fail on the same key. The investor's money
 *        was applied only if they got back to the callback page.
 *
 *        Its second half: the webhook writes an EXPORT_SLOTS row and left the
 *        EXPORT_INVESTMENTS record — the one all four export pages read — at
 *        "pending_payment", with the portfolio untouched.
 *
 *   #89  getUserExportStatsAction read `totalReturns` and `pendingReturns`.
 *        Nothing in the codebase writes either name; the portfolio is written
 *        with `totalReturned` and `totalExpectedReturns`. Both dashboard cards
 *        and the portfolio headline were structurally zero for every investor.
 *
 *   #90  extendEscrowAction validated `days` not at all, so a negative value
 *        moved escrowReleaseDate BACKWARDS — and api/cron/release-escrow
 *        releases every window whose date has passed. It was also gated on a
 *        role-array string test rather than the permission matrix.
 *
 * WHAT IS MOCKED
 * --------------
 * Paystack and the two Postgres primitives the fake deliberately does not
 * implement (claimPaymentOnce's CAS and incrementWithinCeiling's row lock — see
 * KNOWN_DIVERGENCES; whether they actually serialise is proven in
 * src/__tests__/pg/). Everything these actions decide runs for real.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const initializePaystackPayment = jest.fn(
    async (_e: string, _a: number, _m: Record<string, unknown>, _c: string) =>
        ({ authorizationUrl: 'https://paystack.test/pay/abc', reference: 'EXP-REF-1' }));
const verifyPaystackPayment = jest.fn(async (_r: string) => ({
    status: true,
    data: { status: 'success', amount: 0, metadata: {} as Record<string, unknown> },
}));
jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (e: string, a: number, m: Record<string, unknown>, c: string) =>
        initializePaystackPayment(e, a, m, c),
    verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
}));

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
const incrementWithinCeiling = jest.fn(
    async (_p: unknown) => ({ ok: true } as { ok: boolean; reason?: string }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    incrementWithinCeiling: (p: unknown) => incrementWithinCeiling(p),
    creditWalletOnce: jest.fn(async () => ({ claimed: true })),
    debitWalletLocked: jest.fn(async () => ({ ok: true })),
}));

jest.mock('@/lib/server-utils', () => ({
    getBaseUrl: async () => 'https://easysalesexport.test',
}));

let store: FakeDbHandle;

const INVESTOR = 'investor-1';
const WINDOW = 'window-1';
const REF = 'EXP-REF-1';

const WINDOWS = COLLECTIONS.EXPORT_WINDOWS;
const INVESTMENTS = COLLECTIONS.EXPORT_INVESTMENTS;
const SLOTS = COLLECTIONS.EXPORT_SLOTS;
const PORTFOLIOS = COLLECTIONS.INVESTOR_PORTFOLIOS;
const FAILED = COLLECTIONS.FAILED_PAYMENTS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Session expired' } }
            : {
                session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } },
                error: null,
            },
    ));
}

/** What Paystack says came back for a reference. */
function paystackSays(amountNaira: number, metadata: Record<string, unknown>, ok = true): void {
    verifyPaystackPayment.mockImplementation(async () => ({
        status: true,
        data: {
            status: ok ? 'success' : 'abandoned',
            amount: Math.round(amountNaira * 100),
            metadata,
        },
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    incrementWithinCeiling.mockImplementation(async () => ({ ok: true }));
    initializePaystackPayment.mockImplementation(async () =>
        ({ authorizationUrl: 'https://paystack.test/pay/abc', reference: REF }));
    store = installFakeDb();
    actAs(INVESTOR);
});

async function actions() {
    return import('@/app/actions/export/_ex_investments');
}

const seedWindow = (extra: Record<string, unknown> = {}) =>
    store.seed(WINDOWS, WINDOW, {
        title: 'Sesame Q4', status: 'open', amount: 50_000,
        roiPercentage: '18%', returnMultiplier: 1.2,
        ...extra,
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserExportInvestmentsAction', () => {
    const list = async (limit = 10, lastId?: string) =>
        (await (await actions()).getUserExportInvestmentsAction(limit, lastId)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await list()).toMatchObject({ success: false });
    });

    it('returns only the caller\'s own investments', async () => {
        store.seedAll(INVESTMENTS, {
            mine: { investorId: INVESTOR, amount: 100_000, createdAt: '2026-01-02T00:00:00.000Z' },
            theirs: { investorId: 'somebody-else', amount: 500_000, createdAt: '2026-01-03T00:00:00.000Z' },
        });

        const res = await list();
        expect(res.data.map((i: any) => i.id)).toEqual(['mine']);
    });

    it('sorts newest first across BOTH date shapes and both field names', async () => {
        // The comparator is the shared toMillis. A local copy lived here that
        // handled all four shapes, and the copy 340 lines below — written
        // without it — was the one that threw on an ISO string.
        store.seedAll(INVESTMENTS, {
            oldest: { investorId: INVESTOR, createdAt: '2026-01-01T00:00:00.000Z' },
            newest: { investorId: INVESTOR, createdAt: '2026-03-01T00:00:00.000Z' },
            middle: { investorId: INVESTOR, bookedAt: '2026-02-01T00:00:00.000Z' },
        });

        const res = await list();
        expect(res.data.map((i: any) => i.id)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('paginates from the cursor and reports hasMore honestly', async () => {
        store.seedAll(INVESTMENTS, {
            a: { investorId: INVESTOR, createdAt: '2026-03-01T00:00:00.000Z' },
            b: { investorId: INVESTOR, createdAt: '2026-02-01T00:00:00.000Z' },
            c: { investorId: INVESTOR, createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const first = await list(2);
        expect(first.data.map((i: any) => i.id)).toEqual(['a', 'b']);
        expect(first.meta).toMatchObject({ cursor: 'b', hasMore: true });

        const second = await list(2, 'b');
        expect(second.data.map((i: any) => i.id)).toEqual(['c']);
        expect(second.meta).toMatchObject({ cursor: null, hasMore: false });
    });

    it('soft-joins the window title and status, and counts the days left', async () => {
        const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
        seedWindow({ title: 'Sesame Q4', status: 'shipped', endDate: inTenDays });
        store.seed(INVESTMENTS, 'mine', {
            investorId: INVESTOR, windowId: WINDOW, amount: 100_000,
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        const [investment] = (await list()).data;
        expect(investment.commodity).toBe('Sesame Q4');
        // The PARENT window's status is what the investor is shown.
        expect(investment.status).toBe('shipped');
        expect(investment.daysRemaining).toBeGreaterThan(8);
        expect(investment.daysRemaining).toBeLessThanOrEqual(10);
    });

    it('never reports negative days on a window whose delivery date has passed', async () => {
        seedWindow({ endDate: '2020-01-01T00:00:00.000Z' });
        store.seed(INVESTMENTS, 'mine', { investorId: INVESTOR, windowId: WINDOW });

        expect((await list()).data[0].daysRemaining).toBe(0);
    });

    it('falls back to a 20% expected return when none was recorded', async () => {
        store.seed(INVESTMENTS, 'mine', { investorId: INVESTOR, amount: 100_000 });
        expect((await list()).data[0].expectedReturn).toBe(20_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserExportStatsAction — the portfolio figures', () => {
    const stats = async () => (await (await actions()).getUserExportStatsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await stats()).toMatchObject({ success: false });
    });

    it('is all zeroes for an investor with no portfolio yet', async () => {
        expect((await stats()).data).toEqual({
            totalInvested: 0, activeInvestments: 0, totalReturns: 0, pendingReturns: 0,
        });
    });

    it('READS THE NAMES THE PORTFOLIO IS WRITTEN UNDER', async () => {
        // #89. This read `totalReturns` and `pendingReturns`; the only writer of
        // investorPortfolios writes `totalReturned` and `totalExpectedReturns`.
        // Neither read key was written by anything, anywhere, so both fell to
        // `|| 0` — two dashboard cards and the portfolio headline were
        // structurally zero for every investor.
        store.seed(PORTFOLIOS, INVESTOR, {
            investorId: INVESTOR,
            totalInvested: 500_000,
            activeInvestments: 2,
            totalExpectedReturns: 600_000,
            totalReturned: 100_000,
        });

        expect((await stats()).data).toEqual({
            totalInvested: 500_000,
            activeInvestments: 2,
            totalReturns: 100_000,
            // What is still outstanding — and the portfolio page adds the two
            // for its "all expected returns" headline, which is now the 600,000
            // that was actually recorded.
            pendingReturns: 500_000,
        });
    });

    it('and the portfolio page\'s headline sum equals the expected returns recorded', async () => {
        store.seed(PORTFOLIOS, INVESTOR, {
            totalInvested: 1_000_000, activeInvestments: 3,
            totalExpectedReturns: 1_200_000, totalReturned: 0,
        });

        const { totalReturns, pendingReturns } = (await stats()).data;
        expect(totalReturns + pendingReturns).toBe(1_200_000);
    });

    it('never reports a negative pending figure when more was returned than expected', async () => {
        store.seed(PORTFOLIOS, INVESTOR, { totalExpectedReturns: 100, totalReturned: 250 });
        expect((await stats()).data.pendingReturns).toBe(0);
    });

    it('still prefers an explicit totalReturns/pendingReturns if a record carries them', async () => {
        // The fix must not break a record already written the other way.
        store.seed(PORTFOLIOS, INVESTOR, {
            totalReturns: 7, pendingReturns: 9, totalExpectedReturns: 999, totalReturned: 111,
        });

        expect((await stats()).data).toMatchObject({ totalReturns: 7, pendingReturns: 9 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('investInExportAction', () => {
    const invest = async (id = WINDOW, amount = 100_000) =>
        (await (await actions()).investInExportAction(id, amount)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await invest()).toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses a window that does not exist', async () => {
        expect(await invest('nope')).toMatchObject({
            success: false, error: 'Export window not found',
        });
    });

    it.each(['draft', 'closed', 'completed', 'cancelled'])(
        'refuses a %s window', async (status) => {
            seedWindow({ status });
            expect(await invest()).toMatchObject({ success: false });
            expect(initializePaystackPayment).not.toHaveBeenCalled();
        });

    it.each(['open', 'active'])('accepts an %s window', async (status) => {
        seedWindow({ status });
        expect(await invest()).toMatchObject({ success: true });
    });

    it('refuses below the window minimum', async () => {
        seedWindow({ amount: 200_000 });
        const res = await invest(WINDOW, 199_999);
        expect(res.success).toBe(false);
        expect(res.error).toContain('Minimum investment');
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses once the slots are full', async () => {
        seedWindow({ totalSpots: 5, spotsFilled: 5 });
        expect(await invest()).toMatchObject({
            success: false, error: 'Investment slots are full',
        });
    });

    it('sends the investor to a callback that EXISTS, on the shared base URL', async () => {
        // This was `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/export/verify`.
        // There is no /dashboard/export route segment at all, so an investor who
        // paid here was charged and landed on a 404 — and with the variable
        // unset the URL was the literal string "undefined/dashboard/...".
        seedWindow();
        expect(await invest()).toMatchObject({ success: true });

        const [, , metadata, callback] = initializePaystackPayment.mock.calls[0] as
            [string, number, Record<string, unknown>, string];
        // flow=window selects THIS pair's verifier. Without it the callback page
        // runs the other one, which looks for an EXPORT_INVESTMENTS record this
        // action never creates.
        expect(callback).toBe('https://easysalesexport.test/export/payment/callback?flow=window');
        expect(metadata.callback_url).toBe(callback);
        expect(metadata.type).toBe('export_investment');
        expect(metadata.exportId).toBe(WINDOW);
        expect(metadata.userId).toBe(INVESTOR);
    });

    it('charges in kobo', async () => {
        seedWindow();
        await invest(WINDOW, 250_000);
        expect(initializePaystackPayment.mock.calls[0][1]).toBe(25_000_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyExportInvestmentAction', () => {
    const verify = async (ref = REF) =>
        (await (await actions()).verifyExportInvestmentAction(ref)) as any;

    const paidFor = (naira: number, over: Record<string, unknown> = {}) =>
        paystackSays(naira, {
            type: 'export_investment', userId: INVESTOR, exportId: WINDOW,
            amount: naira, ...over,
        });

    beforeEach(() => {
        seedWindow({ fundingGoal: 10_000_000, fundedAmount: 0 });
        paidFor(100_000);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await verify()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a transaction that did not succeed', async () => {
        paystackSays(100_000, { type: 'export_investment', userId: INVESTOR, exportId: WINDOW }, false);
        expect(await verify()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a payment of another type', async () => {
        paidFor(100_000, { type: 'marketplace_order' });
        expect(await verify()).toMatchObject({ success: false, error: 'Invalid payment type' });
    });

    it('refuses a payment whose metadata names a DIFFERENT user', async () => {
        paidFor(100_000, { userId: 'somebody-else' });
        expect(await verify()).toMatchObject({ success: false, error: 'User mismatch' });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('SETTLES ON WHAT WAS COLLECTED, refusing a payment short of what was initiated', async () => {
        // This read `metadata.amount` — the figure the investor ASKED to invest
        // — and used it as the slot amount, the funding increment, the basis for
        // expectedReturn and the ledger amount. What Paystack collected was
        // never looked at. The webhook and the other verifier both use the paid
        // figure; this was the third path and the only permissive one.
        paystackSays(1_000, {
            type: 'export_investment', userId: INVESTOR, exportId: WINDOW, amount: 100_000,
        });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('does not match');
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(store.size(SLOTS)).toBe(0);
    });

    it('and accepts an overpayment, recording the amount COLLECTED', async () => {
        paystackSays(150_000, {
            type: 'export_investment', userId: INVESTOR, exportId: WINDOW, amount: 100_000,
        });

        expect(await verify()).toMatchObject({ success: true });
        expect(store.all(SLOTS)[0][1].amount).toBe(150_000);
        expect(claimPaymentOnce).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 150_000 }));
    });

    it('refuses when the window has vanished', async () => {
        store.clear();
        expect(await verify()).toMatchObject({ success: false, error: 'Export window not found' });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('does not fulfil a duplicate delivery twice — and calls it SUCCESS', async () => {
        // The not-fulfilling half is the point and is unchanged. The reported
        // outcome is not: this asserted { success: false, error: 'Payment
        // already processed' }, which is what an investor saw AFTER being
        // charged for an investment that had already been recorded (#259).
        // Four sibling paths had already been fixed to report success; this was
        // the one that was missed, and this test was pinning it in place.
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        expect(await verify()).toMatchObject({ success: true });
        expect(store.size(SLOTS)).toBe(0);
        expect(incrementWithinCeiling).not.toHaveBeenCalled();
    });

    it('writes the slot, raises the funding and counts the spot on the happy path', async () => {
        expect(await verify()).toMatchObject({ success: true });

        const [, slot] = store.all(SLOTS)[0];
        expect(slot).toMatchObject({
            userId: INVESTOR, exportId: WINDOW, amount: 100_000,
            status: 'active', paymentReference: REF, roi: '18%', source: 'client_verify',
        });
        expect(slot.expectedReturn).toBe(120_000);

        expect(incrementWithinCeiling).toHaveBeenCalledWith(expect.objectContaining({
            collection: WINDOWS, id: WINDOW, field: 'fundedAmount',
            amount: 100_000, ceilingField: 'fundingGoal',
        }));
        expect(store.get(WINDOWS, WINDOW)).toMatchObject({
            spotsFilled: 1, currentFunding: 100_000,
        });
    });

    it('keeps currentFunding in step with fundedAmount', async () => {
        // currentFunding was never touched here, and it is the counter the other
        // initiator's funding gate reads. Money taken through this path was
        // invisible to that gate: the window kept accepting investors after its
        // goal was met, and each was then refused by the ceiling AFTER paying.
        await verify();
        expect(store.get(WINDOWS, WINDOW)?.currentFunding).toBe(100_000);
    });

    it('picks the ceiling field the record actually carries', async () => {
        // A record with no ceiling recorded is treated as UNCAPPED, so naming
        // the wrong field silently uncaps half the windows.
        store.seed(WINDOWS, WINDOW, { status: 'open', goal: 500_000, fundedAmount: 0 });
        await verify();

        expect(incrementWithinCeiling).toHaveBeenCalledWith(
            expect.objectContaining({ ceilingField: 'goal' }));
    });

    it('routes an investment beyond the goal to review, and keeps it OUT of revenue', async () => {
        seedWindow({ fundingGoal: 500_000, fundedAmount: 450_000 });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('sent for review');

        expect(claimPaymentOnce).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'overfunded_review' }));
        expect(store.get(FAILED, REF)).toMatchObject({
            reference: REF, status: 'overfunded_review', amount: 100_000,
        });
        expect(store.size(SLOTS)).toBe(0);
    });

    it('and claims a normal investment as completed', async () => {
        await verify();
        expect(claimPaymentOnce).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' }));
    });

    it('records the investor for review when the window fills between the check and the write', async () => {
        // The overfunding check above is an advisory READ; the ceiling is the
        // write. This is the gap between them, and the investor has been charged.
        incrementWithinCeiling.mockImplementation(async () => ({ ok: false, reason: 'ceiling' }));

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('reached its funding goal');
        expect(store.get(FAILED, REF)).toMatchObject({
            status: 'overfunded_review',
            gatewayResponse: 'Funding goal reached before this investment was applied',
        });
        // Not counted: the spot and the funding must not move when the money did
        // not land.
        expect(store.get(WINDOWS, WINDOW)?.spotsFilled).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyExportInvestmentsAction', () => {
    const mine = async () => (await (await actions()).getMyExportInvestmentsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await mine()).toMatchObject({ success: false });
    });

    it('does not THROW on an ISO createdAt', async () => {
        // The comparator was `a.data().createdAt?.toMillis()`. The optional chain
        // guards createdAt being null and NOT its being a string, which is what
        // the JSONB writer stores for a `new Date()` — and `"2026-..."?.toMillis`
        // is undefined, so CALLING it throws. This did not mis-sort; it threw
        // inside the sort and the whole action fell into its catch, so the page
        // showed "Failed to fetch investments" for every investor.
        store.seedAll(INVESTMENTS, {
            a: { investorId: INVESTOR, createdAt: '2026-01-01T00:00:00.000Z' },
            b: { investorId: INVESTOR, createdAt: '2026-05-01T00:00:00.000Z' },
        });

        const res = await mine();
        expect(res.success).toBe(true);
        expect(res.data.map((i: any) => i.id)).toEqual(['b', 'a']);
    });

    it('returns only the caller\'s own, with the window title joined in', async () => {
        seedWindow({ title: 'Sesame Q4' });
        store.seedAll(INVESTMENTS, {
            mine: { investorId: INVESTOR, windowId: WINDOW, amount: 100_000 },
            theirs: { investorId: 'somebody-else', windowId: WINDOW },
        });

        const res = await mine();
        expect(res.data).toHaveLength(1);
        expect(res.data[0]).toMatchObject({ id: 'mine', windowTitle: 'Sesame Q4' });
    });

    it('keeps the stored title when the window has gone', async () => {
        store.seed(INVESTMENTS, 'mine', {
            investorId: INVESTOR, windowId: 'deleted', windowTitle: 'Sesame Q4',
        });

        expect((await mine()).data[0].windowTitle).toBe('Sesame Q4');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('extendEscrowAction', () => {
    const extend = async (days: number, id = WINDOW, reason = 'shipping delay') =>
        (await (await actions()).extendEscrowAction(id, days, reason)) as any;

    const RELEASE = '2026-09-01T00:00:00.000Z';

    beforeEach(() => {
        seedWindow({ escrowReleaseDate: RELEASE });
        actAs('admin-1', ['admin']);
    });

    const releaseDate = () => new Date(store.get(WINDOWS, WINDOW)!.escrowReleaseDate as string);

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await extend(7)).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        actAs(INVESTOR, ['general_user', 'exporter']);
        expect(await extend(7)).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(releaseDate().toISOString()).toBe(RELEASE);
    });

    it('ADMITS an export_admin, who the raw role test locked out', async () => {
        // The gate was `roles.includes("admin") || roles.includes("super_admin")`
        // — bypassing the permission matrix, and excluding the one role whose
        // job this is.
        actAs('export-admin-1', ['export_admin']);
        expect(await extend(7)).toMatchObject({ success: true });
    });

    it('refuses an admin of another module', async () => {
        actAs('academy-admin-1', ['academy_admin']);
        expect(await extend(7)).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('extends by whole days', async () => {
        expect(await extend(10)).toMatchObject({ success: true });
        expect(releaseDate().toISOString()).toBe('2026-09-11T00:00:00.000Z');
    });

    it.each([-1, -400, 0])('REFUSES %s days — extend cannot mean shorten', async (days) => {
        // escrowReleaseDate is not decorative: api/cron/release-escrow releases
        // every window whose date is <= now. A negative extension moved the date
        // BACKWARDS, and far enough back the next cron run released the escrow
        // on a window that had just been held.
        const res = await extend(days);
        expect(res.success).toBe(false);
        expect(res.error).toContain('1 to 365');
        expect(releaseDate().toISOString()).toBe(RELEASE);
    });

    it.each([NaN, Infinity, 1.5, '30' as unknown as number])(
        'refuses a non-integer value like %s', async (days) => {
            // setDate(NaN) writes an Invalid Date, which no comparison matches —
            // silently removing the window from the release job altogether.
            // Asserting the VALIDATION message, not merely a failure: without
            // the guard some of these fail anyway, by throwing somewhere deeper
            // after the write has been attempted.
            const res = await extend(days as number);
            expect(res.success).toBe(false);
            expect(res.error).toContain('1 to 365');
            expect(releaseDate().toISOString()).toBe(RELEASE);
        });

    it('caps the extension at a year', async () => {
        expect((await extend(366)).success).toBe(false);
        expect((await extend(365)).success).toBe(true);
    });

    it('refuses a window that does not exist', async () => {
        expect(await extend(7, 'nope')).toMatchObject({
            success: false, error: 'Export window not found',
        });
    });

    it('measures from NOW when the window has no release date yet', async () => {
        store.seed(WINDOWS, WINDOW, { status: 'open' });
        const before = Date.now();
        await extend(30);

        const days = (releaseDate().getTime() - before) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThan(30.1);
    });
});
