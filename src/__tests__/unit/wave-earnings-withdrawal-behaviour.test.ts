/**
 * @jest-environment node
 */

/**
 * WAVE earnings withdrawal and its admin queue, EXECUTED.
 * _wv_earnings.ts was at 18.8% and _wv_admin_withdrawals.ts at 39.4%.
 *
 *   #149 The admin withdrawal list hydrates every member's account number,
 *        account name and bank code, gated on isAdmin() — true for all TEN
 *        admin roles — while processWaveWithdrawalAction, the only thing that
 *        screen does, requires "finance:process_withdrawals". Sixth copy of
 *        reader-wider-than-writer on the same rows.
 *
 *   #150 withdrawEarningsAction opened with an unconditional `return` — "WAVE
 *        earnings withdrawals are currently disabled for maintenance" — and
 *        ~140 lines of unreachable code behind it. The earnings page could not
 *        know: it enables Withdraw whenever the balance is above zero, opens a
 *        modal, takes an amount, and only then shows the failure. A member with
 *        money showing was invited to withdraw it and refused every time.
 *        Re-enabling also needed a deploy.
 *
 *        Now a `wave_withdrawals` toggle, DEFAULTING TO FALSE so behaviour is
 *        unchanged, read by the action and by the page.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { DEFAULT_TOGGLES } from '@/lib/feature-toggles';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

const mockToggle = jest.fn(async () => false) as jest.Mock<any>;
jest.mock('@/app/actions/feature-toggles', () => ({
    getFeatureToggle: (...a: any[]) => mockToggle(...a),
}));

const mockDebit = jest.fn(async () => ({ ok: true })) as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    debitJsonbBalance: (...a: any[]) => mockDebit(...a),
    compensateJsonbDebit: jest.fn(async () => undefined),
    creditWalletOnce: jest.fn(), claimPaymentOnce: jest.fn(),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

let store: FakeDbHandle;
const MEMBER = 'member-1';
const USERS = COLLECTIONS.USERS;
const WAVE_WD = COLLECTIONS.WAVE_WITHDRAWALS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
    // clearAllMocks() clears CALLS, not implementations, so a mockResolvedValue
    // set inside one test leaks into the next. Both are re-armed here.
    mockToggle.mockResolvedValue(false);
    mockDebit.mockResolvedValue({ ok: true });
    store.seed(USERS, MEMBER, {
        name: 'Ada Obi', email: 'ada@example.com',
        bankDetails: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', bankCode: '058' },
        serviceRegistrations: { wave: { status: 'approved', waveEarningsBalance: 50_000 } },
    });
});

const withdraw = async (amount = 10_000) =>
    (await (await import('@/app/actions/wave/_wv_earnings'))
        .withdrawEarningsAction(amount as never)) as any;

const adminList = async (options: Record<string, unknown> = {}) =>
    (await (await import('@/app/actions/wave/_wv_admin_withdrawals'))
        .getStandardWaveWithdrawalsAction(options as never)) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#150 — withdrawals are disabled by a toggle, not a dead return', () => {
    it('is OFF by default, so behaviour is exactly what it was', () => {
        expect(DEFAULT_TOGGLES.wave_withdrawals).toBe(false);
    });

    it('refuses while the toggle is off, and says so without taking money', async () => {
        const res = await withdraw();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/disabled/i);
        expect(mockDebit).not.toHaveBeenCalled();
        expect(store.size(WAVE_WD)).toBe(0);
    });

    it('READS THE TOGGLE rather than refusing unconditionally', async () => {
        // The whole point: with it on, the code behind the old `return` runs.
        mockToggle.mockResolvedValue(true);

        const res = await withdraw(10_000);

        expect(mockToggle).toHaveBeenCalledWith('wave_withdrawals');
        expect(res.success).toBe(true);
        expect(store.size(WAVE_WD)).toBe(1);
    });

    it('debits the balance under a lock BEFORE recording anything', async () => {
        mockToggle.mockResolvedValue(true);

        await withdraw(10_000);

        expect(mockDebit).toHaveBeenCalledWith(expect.objectContaining({
            field: 'serviceRegistrations.wave.waveEarningsBalance',
            amount: 10_000,
            id: MEMBER,
        }));
    });

    it('refuses an amount below the floor without touching the balance', async () => {
        mockToggle.mockResolvedValue(true);

        expect(await withdraw(1_000)).toMatchObject({ success: false });
        expect(mockDebit).not.toHaveBeenCalled();
    });

    it('reports insufficient funds when the locked debit refuses', async () => {
        mockToggle.mockResolvedValue(true);
        mockDebit.mockResolvedValue({ ok: false, reason: 'insufficient_funds' });

        const res = await withdraw(10_000);
        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/insufficient/i);
        expect(store.size(WAVE_WD)).toBe(0);
    });

    it('refuses a caller with no session', async () => {
        mockToggle.mockResolvedValue(true);
        actAs(null);

        expect(await withdraw()).toMatchObject({ success: false });
        expect(mockDebit).not.toHaveBeenCalled();
    });

    it('records the request pending, with a ledger row against it', async () => {
        mockToggle.mockResolvedValue(true);

        await withdraw(10_000);

        const [, row] = store.all(WAVE_WD)[0];
        expect(row).toMatchObject({ userId: MEMBER, amount: 10_000, status: 'pending' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#149 — who may read a member\'s bank details', () => {
    beforeEach(() => {
        store.seed(WAVE_WD, 'wd-1', {
            withdrawalId: 'wd-1', userId: MEMBER, userEmail: 'ada@example.com',
            amount: 10_000, status: 'pending', createdAt: '2026-05-01T00:00:00.000Z',
        });
    });

    it('refuses a caller with no session, and an ordinary user', async () => {
        actAs(null);
        expect(await adminList()).toMatchObject({ success: false });

        actAs(MEMBER);
        expect(await adminList()).toMatchObject({ success: false });
    });

    it.each(['wave_admin', 'marketplace_admin', 'academy_admin', 'support', 'moderator', 'farm_nation_admin'])(
        'GIVES %s THE LIST BUT NOT THE BANK DETAILS', async (role) => {
            actAs('other-admin', [role]);

            const res = await adminList();
            expect(res.success).toBe(true);

            const row = (res.data?.withdrawals ?? res.data)[0];
            expect(row.userEmail ?? row.userId).toBeTruthy();
            expect(row.bankDetails).toBeUndefined();
        });

    it.each(['admin', 'super_admin'])(
        'gives %s the bank details — the roles that can process a payout', async (role) => {
            actAs('finance-admin', [role]);

            const res = await adminList();
            const row = (res.data?.withdrawals ?? res.data)[0];
            expect(row.bankDetails).toMatchObject({ accountNumber: '0123456789' });
        });
});
