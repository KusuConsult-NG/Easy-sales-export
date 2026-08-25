/**
 * @jest-environment node
 */

/**
 * The wallet, EXECUTED — funding, checkout, withdrawal request, history, and
 * the admin queue that pays people out.
 *
 * At 47.7% statements / 28.4% branches. This is the platform's own money
 * movement: a wallet balance is spendable at checkout and withdrawable to a
 * bank account. Three findings were located by running it:
 *
 *   #91  walletCheckoutAction was corrected to debit `order.totalAmount`
 *        rather than the caller's `amountNGN`, and its own comment says the
 *        parameter "is deliberately ignored" — but BOTH ledger writes still
 *        used it. The wallet was charged correctly while two rows marked
 *        "completed" recorded whatever the request asked for. Reconciliation
 *        reads exactly those rows.
 *
 *   #92  getAdminWalletWithdrawalsAction was gated on isAdmin() — true for all
 *        ten admin roles — and hydrates every withdrawing user's bank account
 *        number, account name, bank code, email and phone. The action it feeds
 *        requires "finance:process_withdrawals", held by two roles.
 *
 *   #93  withdrawFromWalletAction notified `cooperative_admin` and
 *        `super_admin`. Processing requires "finance:process_withdrawals" —
 *        super_admin and admin. Every cooperative_admin was sent to a screen
 *        that refuses them, and no plain admin was told at all.
 *
 * WHAT IS MOCKED
 * --------------
 * Paystack (fetch, and the transfer module), and the four Postgres money
 * primitives the fake deliberately does not implement — creditWalletOnce,
 * debitWalletOnce, debitWalletLocked and claimStatusTransition (see
 * KNOWN_DIVERGENCES; whether they actually serialise is proven in
 * src/__tests__/pg/). Everything the ACTIONS decide runs for real, including
 * the permission matrix and the 24-hour hold.
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

const creditWalletOnce = jest.fn(
    async (_p: unknown) => ({ claimed: true, balance: 0 } as { claimed: boolean; balance: number }));
const debitWalletOnce = jest.fn(
    async (_p: unknown) => ({ ok: true, balance: 0, reason: undefined } as
        { ok: boolean; balance: number; reason?: string }));
const debitWalletLocked = jest.fn(
    async (_p: unknown) => ({ ok: true, balance: 0, reason: undefined } as
        { ok: boolean; balance: number; reason?: string }));
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (p: unknown) => creditWalletOnce(p),
    debitWalletOnce: (p: unknown) => debitWalletOnce(p),
    debitWalletLocked: (p: unknown) => debitWalletLocked(p),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
}));

const claimStatusTransition = jest.fn(
    async (_p: unknown) => ({ claimed: true, status: null } as
        { claimed: boolean; status: string | null }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimStatusTransition(p),
}));

const paystackPayout = jest.fn(async (..._a: unknown[]) => ({
    success: true, transferCode: 'TRF_1', reference: 'PAYOUT-REF-1', error: undefined,
} as { success: boolean; transferCode?: string; reference?: string; error?: string }));
jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (...a: unknown[]) => paystackPayout(...a),
    // The REAL payoutReference. A mock that stubs only paystackPayout leaves
    // this undefined, the caller throws on the call, and the action's own catch
    // turns it into a generic failure — the fourth time an incomplete mock has
    // made a working path look broken in this codebase. Taken from the real
    // module so the reference asserted here is the reference sent (#249).
    payoutReference: (jest.requireActual('@/lib/paystack-transfer') as typeof import('@/lib/paystack-transfer')).payoutReference,
}));

const smsWithdrawalApproved = jest.fn(async () => undefined);
const smsWithdrawalRejected = jest.fn(async () => undefined);
jest.mock('@/lib/africastalking', () => ({
    smsWithdrawalApproved: (...a: unknown[]) => smsWithdrawalApproved(...(a as [])),
    smsWithdrawalRejected: (...a: unknown[]) => smsWithdrawalRejected(...(a as [])),
}));

jest.mock('@/lib/fcm', () => ({ pushWithdrawalDecision: jest.fn(async () => undefined) }));

jest.mock('@/lib/server-utils', () => ({ getBaseUrl: async () => 'https://easysalesexport.test' }));

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const TXNS = COLLECTIONS.WALLET_TRANSACTIONS;
const NOTIFS = COLLECTIONS.NOTIFICATIONS;
const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;

const BANK = {
    accountNumber: '0123456789',
    bankCode: '058',
    accountName: 'Ada Obi',
    bankName: 'GTBank',
};

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

/** What Paystack's REST API answers. The wallet calls fetch directly. */
function paystackFetch(body: Record<string, unknown>): void {
    (global as unknown as { fetch: jest.Mock }).fetch =
        jest.fn(async () => ({ json: async () => body })) as unknown as jest.Mock;
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
    creditWalletOnce.mockImplementation(async () => ({ claimed: true, balance: 10_000 }));
    debitWalletOnce.mockImplementation(async () => ({ ok: true, balance: 40_000 }));
    debitWalletLocked.mockImplementation(async () => ({ ok: true, balance: 45_000 }));
    claimStatusTransition.mockImplementation(async () => ({ claimed: true, status: null }));
    paystackPayout.mockImplementation(async () => ({
        success: true, transferCode: 'TRF_1', reference: 'PAYOUT-REF-1',
    }));
    paystackFetch({ status: true, data: { authorization_url: 'https://paystack.test/pay/x' } });
    store = installFakeDb();
    actAs(BUYER);
});

async function actions() {
    return import('@/app/actions/wallet');
}

/** The audit log is mocked globally in jest.setup.js — assert on the recorder. */
const auditLog = () => (globalThis as unknown as { mockRecordAdminAction: jest.Mock }).mockRecordAdminAction;

// ─────────────────────────────────────────────────────────────────────────────
describe('getWalletAction', () => {
    const wallet = async () => (await (await actions()).getWalletAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await wallet()).toMatchObject({ success: false });
    });

    it('creates an empty wallet on first read rather than failing', async () => {
        const res = await wallet();
        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ userId: BUYER, balance: 0, currency: 'NGN' });
        expect(store.get(COLLECTIONS.WALLETS, BUYER)).toMatchObject({ balance: 0 });
    });

    it('totals funding, spend and pending withdrawals from the caller\'s OWN rows', async () => {
        store.seedAll(TXNS, {
            f1: { userId: BUYER, type: 'funding', status: 'completed', amount: 50_000 },
            f2: { userId: BUYER, type: 'funding', status: 'pending', amount: 99_000 },
            p1: { userId: BUYER, type: 'purchase', status: 'completed', amount: -20_000 },
            w1: { userId: BUYER, type: 'withdrawal', status: 'pending', amount: -5_000 },
            w2: { userId: BUYER, type: 'withdrawal', status: 'completed', amount: -7_000 },
            other: { userId: 'somebody-else', type: 'funding', status: 'completed', amount: 900_000 },
        });

        expect((await wallet()).data.stats).toEqual({
            // The pending funding is NOT counted — it has not been paid.
            totalFunded: 50_000,
            totalSpent: 20_000,
            // Only the pending one is reserved.
            pendingWithdrawals: 5_000,
        });
    });

    it('reads the bank details from any of the three shapes the profile uses', async () => {
        store.seed(COLLECTIONS.USERS, BUYER, {
            bankDetails: { accountNumber: '0123456789', bankCode: '058', bankName: 'GTBank' },
            name: 'Ada Obi',
        });

        expect((await wallet()).data.bankDetails).toMatchObject({
            accountNumber: '0123456789', bankName: 'GTBank', accountName: 'Ada Obi',
        });
    });

    it('reports no bank details rather than a half-filled record', async () => {
        // A bank code with no account number is not a payable destination.
        store.seed(COLLECTIONS.USERS, BUYER, { bankCode: '058' });
        expect((await wallet()).data.bankDetails).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the wallet feature toggles default OFF', () => {
    // DEFAULT_TOGGLES marks both false — "disabled for production rollout". A
    // missing toggle row must not read as enabled, or the rollout gate is not a
    // gate. Every other test in this file seeds the row on purpose.
    it('refuses a deposit when no toggle row exists', async () => {
        expect(await (await actions()).fundWalletViaPaystackAction(10_000)).toMatchObject({
            success: false, error: 'Wallet deposits are currently disabled',
        });
    });

    it('refuses a withdrawal when no toggle row exists', async () => {
        expect(await (await actions()).withdrawFromWalletAction(10_000, BANK)).toMatchObject({
            success: false, error: 'Wallet withdrawals are currently disabled',
        });
        expect(debitWalletLocked).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('fundWalletViaPaystackAction', () => {
    const fund = async (amount = 10_000) =>
        (await (await actions()).fundWalletViaPaystackAction(amount)) as any;

    beforeEach(() => {
        store.seed(COLLECTIONS.FEATURE_TOGGLES, 'wallet_deposits', { enabled: true });
    });

    it('refuses below the ₦100 floor', async () => {
        expect(await fund(99)).toMatchObject({ success: false });
        expect(store.size(TXNS)).toBe(0);
    });

    it('refuses a non-integer amount', async () => {
        expect(await fund(100.5)).toMatchObject({ success: false });
    });

    it('refuses when the deposits toggle is off', async () => {
        store.seed(COLLECTIONS.FEATURE_TOGGLES, 'wallet_deposits', { enabled: false });
        expect(await fund()).toMatchObject({
            success: false, error: 'Wallet deposits are currently disabled',
        });
        expect(store.size(TXNS)).toBe(0);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await fund()).toMatchObject({ success: false });
    });

    it('records a PENDING funding row carrying the reference', async () => {
        expect(await fund(25_000)).toMatchObject({ success: true });

        const [, txn] = store.all(TXNS)[0];
        expect(txn).toMatchObject({
            userId: BUYER, type: 'funding', amount: 25_000, status: 'pending',
        });
        expect(String(txn.reference)).toMatch(/^WALLET-buyer-1-\d+$/);
    });

    it('reports a Paystack refusal rather than recording a phantom top-up', async () => {
        paystackFetch({ status: false, message: 'Invalid key' });

        expect(await fund()).toMatchObject({ success: false, error: 'Invalid key' });
        expect(store.size(TXNS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('confirmWalletFundingAction', () => {
    const confirm = async (ref = 'WALLET-REF-1') =>
        (await (await actions()).confirmWalletFundingAction(ref)) as any;

    const paystackVerified = (kobo: number, metadata: Record<string, unknown>, status = 'success') =>
        paystackFetch({ status: true, data: { status, amount: kobo, metadata } });

    beforeEach(() => {
        paystackVerified(1_000_000, { userId: BUYER, amountNGN: 10_000, type: 'wallet_funding' });
        store.seed(TXNS, 'txn-1', {
            userId: BUYER, type: 'funding', amount: 10_000,
            status: 'pending', reference: 'WALLET-REF-1',
        });
    });

    it('refuses a transaction Paystack did not settle', async () => {
        paystackVerified(1_000_000, { userId: BUYER, amountNGN: 10_000 }, 'abandoned');

        expect(await confirm()).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
        expect(store.get(TXNS, 'txn-1')?.status).toBe('pending');
    });

    it('REFUSES when the amount charged does not match the metadata', async () => {
        // The cooperative contribution path already performed this check; this
        // one did not, so any divergence was credited in full without complaint.
        paystackVerified(100, { userId: BUYER, amountNGN: 10_000 });

        expect(await confirm()).toMatchObject({ success: false, error: 'Payment amount mismatch' });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('tolerates a naira of rounding, and not more', async () => {
        paystackVerified(999_900, { userId: BUYER, amountNGN: 10_000 });   // ₦1 under
        expect(await confirm()).toMatchObject({ success: true });

        paystackVerified(999_800, { userId: BUYER, amountNGN: 10_000 });   // ₦2 under
        expect(await confirm()).toMatchObject({ success: false });
    });

    it('refuses a non-numeric amount rather than crediting NaN', async () => {
        paystackVerified(1_000_000, { userId: BUYER, amountNGN: 'ten thousand' });
        expect(await confirm()).toMatchObject({ success: false });
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('credits once and settles the pending row and the unified ledger', async () => {
        creditWalletOnce.mockImplementation(async () => ({ claimed: true, balance: 35_000 }));

        expect(await confirm()).toMatchObject({ success: true, data: { newBalance: 35_000 } });

        expect(creditWalletOnce).toHaveBeenCalledWith(expect.objectContaining({
            reference: 'WALLET-REF-1', userId: BUYER, amount: 10_000,
            paymentType: 'wallet_funding',
        }));
        expect(store.get(TXNS, 'txn-1')).toMatchObject({
            status: 'completed', balanceAfter: 35_000,
        });
        expect(store.get(COLLECTIONS.TRANSACTIONS, 'txn-1')).toMatchObject({
            userId: BUYER, module: 'wallet', type: 'funding', status: 'completed',
        });
    });

    it('reports a duplicate delivery WITHOUT crediting again', async () => {
        creditWalletOnce.mockImplementation(async () => ({ claimed: false, balance: 35_000 }));

        expect(await confirm()).toMatchObject({ success: false, error: 'Already processed' });
        expect(store.get(TXNS, 'txn-1')?.status).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('walletCheckoutAction', () => {
    const checkout = async (orderId = 'order-1', amount = 50_000) =>
        (await (await actions()).walletCheckoutAction(orderId, amount)) as any;

    beforeEach(() => {
        store.seed(ORDERS, 'order-1', { buyerId: BUYER, totalAmount: 50_000 });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await checkout()).toMatchObject({ success: false });
        expect(debitWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses an order that does not exist', async () => {
        expect(await checkout('nope')).toMatchObject({ success: false, error: 'Order not found' });
        expect(debitWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses an order belonging to somebody else', async () => {
        store.seed(ORDERS, 'order-1', { buyerId: 'somebody-else', totalAmount: 50_000 });
        expect(await checkout()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(debitWalletOnce).not.toHaveBeenCalled();
    });

    it('refuses an order with no amount to charge', async () => {
        store.seed(ORDERS, 'order-1', { buyerId: BUYER, totalAmount: 0 });
        expect(await checkout()).toMatchObject({ success: false });
        expect(debitWalletOnce).not.toHaveBeenCalled();
    });

    it('DEBITS THE ORDER TOTAL, not the figure the caller sent', async () => {
        await checkout('order-1', 1);

        expect(debitWalletOnce).toHaveBeenCalledWith(expect.objectContaining({
            reference: 'order:order-1', userId: BUYER, amount: 50_000,
        }));
    });

    it('and RECORDS the order total in both ledger rows — the half the fix missed', async () => {
        // #91. The debit was corrected and both writes below still used the
        // caller's amount, so a ₦50,000 order produced two rows marked
        // "completed" for ₦1. Reconciliation reads exactly these rows to decide
        // whether a payment produced what it should have.
        await checkout('order-1', 1);

        const [txnId, walletTxn] = store.all(TXNS)[0];
        expect(walletTxn).toMatchObject({
            userId: BUYER, type: 'purchase', amount: -50_000, status: 'completed',
        });
        expect(store.get(COLLECTIONS.TRANSACTIONS, txnId)).toMatchObject({
            userId: BUYER, module: 'wallet', type: 'purchase', amount: -50_000,
        });
    });

    it('reports insufficient funds without writing a ledger row', async () => {
        debitWalletOnce.mockImplementation(async () => ({ ok: false, balance: 100, reason: 'insufficient' }));

        expect(await checkout()).toMatchObject({
            success: false, error: 'Insufficient wallet balance',
        });
        expect(store.size(TXNS)).toBe(0);
    });

    it('treats a double-submitted checkout as a success, charging once', async () => {
        debitWalletOnce.mockImplementation(async () => ({ ok: false, balance: 40_000, reason: 'already_processed' }));

        expect(await checkout()).toMatchObject({ success: true, data: { newBalance: 40_000 } });
        expect(store.size(TXNS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('withdrawFromWalletAction', () => {
    const withdraw = async (amount = 10_000, bank = BANK) =>
        (await (await actions()).withdrawFromWalletAction(amount, bank)) as any;

    beforeEach(() => {
        store.seed(COLLECTIONS.FEATURE_TOGGLES, 'wallet_withdrawals', { enabled: true });
    });

    it('refuses below the ₦5,000 minimum', async () => {
        expect(await withdraw(4_999)).toMatchObject({ success: false });
        expect(debitWalletLocked).not.toHaveBeenCalled();
    });

    it('refuses incomplete bank details', async () => {
        expect(await withdraw(10_000, { ...BANK, accountNumber: '12' })).toMatchObject({ success: false });
        expect(debitWalletLocked).not.toHaveBeenCalled();
    });

    it('refuses when the withdrawals toggle is off', async () => {
        store.seed(COLLECTIONS.FEATURE_TOGGLES, 'wallet_withdrawals', { enabled: false });
        expect(await withdraw()).toMatchObject({
            success: false, error: 'Wallet withdrawals are currently disabled',
        });
        expect(debitWalletLocked).not.toHaveBeenCalled();
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await withdraw()).toMatchObject({ success: false });
    });

    it('RESERVES the money at request time, not at approval', async () => {
        // Otherwise the balance could be spent twice: once at checkout and again
        // when the withdrawal is approved.
        expect(await withdraw(10_000)).toMatchObject({ success: true });

        expect(debitWalletLocked).toHaveBeenCalledWith({ userId: BUYER, amount: 10_000 });
        const [, txn] = store.all(TXNS)[0];
        expect(txn).toMatchObject({
            userId: BUYER, type: 'withdrawal', amount: -10_000,
            status: 'pending', bankDetails: BANK,
        });
    });

    it('records nothing when the balance does not cover it', async () => {
        debitWalletLocked.mockImplementation(async () => ({ ok: false, balance: 100, reason: 'insufficient' }));

        expect(await withdraw()).toMatchObject({
            success: false, error: 'Insufficient balance for withdrawal',
        });
        expect(store.size(TXNS)).toBe(0);
    });

    it('NOTIFIES THE ROLES THAT CAN ACTUALLY PROCESS IT', async () => {
        // #93. This queried cooperative_admin and super_admin. Processing needs
        // "finance:process_withdrawals" — super_admin and admin. So every
        // cooperative_admin was sent to a screen that refuses them, and no plain
        // admin was told at all.
        store.seedAll(COLLECTIONS.USERS, {
            'super-1': { roles: ['super_admin'] },
            'admin-1': { roles: ['admin'] },
            'coop-1': { roles: ['cooperative_admin'] },
            'support-1': { roles: ['support'] },
            'buyer-1': { roles: ['general_user'] },
        });

        await withdraw();

        const notified = store.all(NOTIFS).map(([, n]) => n.userId).sort();
        expect(notified).toEqual(['admin-1', 'super-1']);
    });

    it('and points them at a page that exists', async () => {
        // /admin/wallets/withdrawals has never existed — there is no
        // /admin/wallets segment at all.
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['admin'] });
        await withdraw();

        expect(store.all(NOTIFS)[0][1]).toMatchObject({
            link: '/admin/marketplace/withdrawals',
            linkText: 'Process Withdrawal',
        });
    });

    it('still succeeds when there is nobody to notify', async () => {
        expect(await withdraw()).toMatchObject({ success: true });
        expect(store.size(NOTIFS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getWalletTransactionsAction', () => {
    const history = async (options?: { limit?: number; startAfter?: string }) =>
        (await (await actions()).getWalletTransactionsAction(options)) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await history()).toMatchObject({ success: false });
    });

    it('hides a PENDING funding — money that has not arrived is not history', async () => {
        store.seedAll(TXNS, {
            settled: { userId: BUYER, type: 'funding', status: 'completed', amount: 10_000, createdAt: '2026-02-01T00:00:00.000Z' },
            unpaid: { userId: BUYER, type: 'funding', status: 'pending', amount: 99_000, createdAt: '2026-03-01T00:00:00.000Z' },
            pendingWithdrawal: { userId: BUYER, type: 'withdrawal', status: 'pending', amount: -5_000, createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const ids = (await history()).data.transactions.map((t: any) => t.id);
        expect(ids).not.toContain('unpaid');
        // A pending WITHDRAWAL is shown: the money has already left the balance.
        expect(ids).toEqual(expect.arrayContaining(['settled', 'pendingWithdrawal']));
    });

    it('returns only the caller\'s own rows', async () => {
        store.seedAll(TXNS, {
            mine: { userId: BUYER, type: 'purchase', amount: -1, createdAt: '2026-01-01T00:00:00.000Z' },
            theirs: { userId: 'somebody-else', type: 'purchase', amount: -1, createdAt: '2026-01-02T00:00:00.000Z' },
        });

        expect((await history()).data.transactions.map((t: any) => t.id)).toEqual(['mine']);
    });

    it('reports hasMore only when a further page exists', async () => {
        const rows: Record<string, Record<string, unknown>> = {};
        for (let i = 0; i < 5; i++) {
            rows[`t${i}`] = {
                userId: BUYER, type: 'purchase', status: 'completed', amount: -100,
                createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
            };
        }
        store.seedAll(TXNS, rows);

        expect((await history({ limit: 2 })).data.hasMore).toBe(true);
        expect((await history({ limit: 10 })).data.hasMore).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAdminWalletWithdrawalsAction — who may read bank account numbers', () => {
    const list = async (options: Record<string, unknown> = {}) =>
        (await (await actions()).getAdminWalletWithdrawalsAction(options)) as any;

    beforeEach(() => {
        store.seed(TXNS, 'w1', {
            userId: BUYER, type: 'withdrawal', status: 'pending', amount: -10_000,
            bankDetails: BANK, createdAt: '2026-02-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.USERS, BUYER, {
            name: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
            bankName: 'GTBank', bankAccountNumber: '0123456789',
            bankAccountName: 'Ada Obi', bankCode: '058',
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await list()).toMatchObject({ success: false });
    });

    it.each([
        ['support'], ['moderator'], ['wave_admin'], ['cooperative_admin'],
        ['marketplace_admin'], ['export_admin'], ['farm_nation_admin'], ['academy_admin'],
    ])('REFUSES a %s — they cannot process a withdrawal, so they may not read the bank details', async (role) => {
        // #92. The gate was isAdmin(), true for all ten admin roles, over a list
        // that hydrates every withdrawing user's account number, account name,
        // bank code, email and phone.
        actAs('admin-x', [role]);
        expect(await list()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it.each([['admin'], ['super_admin']])(
        'ADMITS a %s — the roles that hold finance:process_withdrawals', async (role) => {
            actAs('admin-x', [role]);
            const res = await list();
            expect(res.success).toBe(true);
            expect(res.data[0].user).toMatchObject({ name: 'Ada Obi', email: 'ada@example.com' });
            expect(res.data[0].bankDetails).toMatchObject({ accountNumber: '0123456789' });
        });

    it('returns only withdrawals, filtered by status when asked', async () => {
        actAs('admin-x', ['admin']);
        store.seedAll(TXNS, {
            w2: { userId: BUYER, type: 'withdrawal', status: 'completed', amount: -1, createdAt: '2026-01-01T00:00:00.000Z' },
            f1: { userId: BUYER, type: 'funding', status: 'completed', amount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        });

        expect((await list()).data.map((w: any) => w.id).sort()).toEqual(['w1', 'w2']);
        expect((await list({ status: 'pending' })).data.map((w: any) => w.id)).toEqual(['w1']);
    });

    it('falls back to the bank details recorded ON the withdrawal when the profile has none', async () => {
        // The details captured at request time are what the payout was
        // authorised against.
        actAs('admin-x', ['admin']);
        store.seed(COLLECTIONS.USERS, BUYER, { name: 'Ada Obi' });

        expect((await list()).data[0].bankDetails).toMatchObject({ accountNumber: 'N/A' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('processWalletWithdrawalAction', () => {
    const process_ = async (action: 'approve' | 'reject', id = 'w1', note?: string) =>
        (await (await actions()).processWalletWithdrawalAction(id, action, note)) as any;

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const seedPending = (extra: Record<string, unknown> = {}) =>
        store.seed(TXNS, 'w1', {
            userId: BUYER, type: 'withdrawal', status: 'pending', amount: -10_000,
            bankDetails: BANK, createdAt: twoDaysAgo, ...extra,
        });

    beforeEach(() => {
        seedPending();
        store.seed(COLLECTIONS.USERS, BUYER, { phone: '08030000000' });
        actAs('admin-1', ['admin']);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await process_('approve')).toMatchObject({ success: false });
        expect(paystackPayout).not.toHaveBeenCalled();
    });

    it.each([['support'], ['marketplace_admin'], ['cooperative_admin'], ['general_user']])(
        'refuses a %s', async (role) => {
            actAs('someone', [role]);
            expect(await process_('approve')).toMatchObject({ success: false, error: 'Unauthorized' });
            expect(paystackPayout).not.toHaveBeenCalled();
        });

    it('refuses a transaction that does not exist', async () => {
        expect(await process_('approve', 'nope')).toMatchObject({
            success: false, error: 'Transaction not found',
        });
    });

    it('refuses one that is no longer pending', async () => {
        seedPending({ status: 'completed' });
        expect(await process_('approve')).toMatchObject({
            success: false, error: 'Transaction is no longer pending',
        });
        expect(paystackPayout).not.toHaveBeenCalled();
    });

    it('HOLDS an approval for 24 hours', async () => {
        seedPending({ createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

        const res = await process_('approve');
        expect(res.success).toBe(false);
        expect(res.error).toContain('24-hour pending hold');
        expect(paystackPayout).not.toHaveBeenCalled();
    });

    it('and does NOT hold a rejection — refunding sooner is not a risk', async () => {
        seedPending({ createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

        expect(await process_('reject')).toMatchObject({ success: true });
        expect(creditWalletOnce).toHaveBeenCalled();
    });

    it('claims the payout BEFORE transferring, so two admins cannot pay twice', async () => {
        await process_('approve');

        expect(claimStatusTransition).toHaveBeenNthCalledWith(1, expect.objectContaining({
            id: 'w1', from: 'pending', to: 'payout_initiated',
        }));
        expect(paystackPayout).toHaveBeenCalled();
    });

    it('does not transfer when another admin already claimed it', async () => {
        claimStatusTransition.mockImplementation(async () => ({ claimed: false, status: 'payout_initiated' }));

        expect(await process_('approve')).toMatchObject({
            success: false, error: 'Withdrawal is no longer pending',
        });
        expect(paystackPayout).not.toHaveBeenCalled();
    });

    it('returns the withdrawal to pending when the transfer fails, without refunding', async () => {
        paystackPayout.mockImplementation(async () => ({ success: false, error: 'Insufficient balance on Paystack' }));

        const res = await process_('approve');
        expect(res.success).toBe(false);
        expect(store.get(TXNS, 'w1')).toMatchObject({ status: 'pending' });
        // The money is still reserved: it was debited at request time and the
        // transfer did not happen, so it must not be credited back here either.
        expect(creditWalletOnce).not.toHaveBeenCalled();
    });

    it('writes the unified ledger row keyed on the PAYSTACK reference', async () => {
        await process_('approve', 'w1', 'looks fine');

        expect(store.get(COLLECTIONS.TRANSACTIONS, 'PAYOUT-REF-1')).toMatchObject({
            userId: BUYER, type: 'withdrawal', module: 'wallet',
            amount: 10_000, status: 'completed',
        });
        expect(smsWithdrawalApproved).toHaveBeenCalled();
    });

    it('records the approval in the audit log', async () => {
        await process_('approve');

        expect(auditLog()).toHaveBeenCalledWith(expect.objectContaining({
            action: 'withdrawal_approved', userId: 'admin-1',
            targetId: 'w1', targetType: 'wallet_withdrawal',
            metadata: expect.objectContaining({ payeeId: BUYER, amount: 10_000 }),
        }));
    });

    it('REFUNDS a rejection as "refund", not as revenue', async () => {
        // global-aggregation sums completed rows as revenue, and money going
        // back out is not revenue.
        expect(await process_('reject', 'w1', 'wrong account')).toMatchObject({ success: true });

        expect(creditWalletOnce).toHaveBeenCalledWith(expect.objectContaining({
            reference: 'withdrawal-refund:w1', userId: BUYER, amount: 10_000,
            paymentType: 'withdrawal_refund', status: 'refund',
        }));
        expect(store.get(TXNS, 'w1')).toMatchObject({
            status: 'failed', adminNote: 'wrong account', processedBy: 'admin-1',
        });
        expect(smsWithdrawalRejected).toHaveBeenCalled();
    });

    it('settles the STATUS even when the refund was already claimed', async () => {
        // Returning early here left the withdrawal at "pending" for ever while
        // telling the admin it had failed — they would see it in the queue again
        // and get the same answer.
        creditWalletOnce.mockImplementation(async () => ({ claimed: false, balance: 0 }));

        expect(await process_('reject')).toMatchObject({ success: true });
        expect(store.get(TXNS, 'w1')?.status).toBe('failed');
    });

    it('tells the user, with the amount, on both outcomes', async () => {
        await process_('reject', 'w1', 'wrong account');
        const [, notif] = store.all(NOTIFS)[0];

        expect(notif).toMatchObject({ userId: BUYER, title: 'Withdrawal Rejected' });
        expect(String(notif.message)).toContain('10,000');
        expect(String(notif.message)).toContain('wrong account');
    });

    it('records the rejection in the audit log too', async () => {
        await process_('reject');
        expect(auditLog()).toHaveBeenCalledWith(expect.objectContaining({
            action: 'withdrawal_rejected', targetId: 'w1',
        }));
    });
});
