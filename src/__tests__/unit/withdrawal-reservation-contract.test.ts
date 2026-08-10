/**
 * @jest-environment node
 */

/**
 * The withdrawal reservation contract.
 *
 * WHAT WAS WRONG
 * --------------
 * Four doors create a cooperative withdrawal request, and they disagreed about
 * what "reserving" the funds means. The admin side assumes one contract:
 *
 *   at request time:  savingsBalance -= amount,  lockedBalance += amount
 *   on reject:        savingsBalance += amount,  lockedBalance -= amount
 *   on approve:                                  lockedBalance -= amount
 *
 * (cooperative/_admin.ts — both branches decrement lockedBalance.)
 *
 * Against that contract:
 *
 *   platform.ts submitWithdrawalAction    debits + locks         correct
 *   cooperative/_withdrawal.ts            read-check-write       overdraft
 *   cooperative/_actions.ts               debits, never locks    lockedBalance
 *                                                                goes negative
 *   api/cooperative/withdraw/route.ts     neither                MONEY CREATED
 *
 * The last one is the reason this is a money defect. That route reserved
 * nothing, so a request submitted through it and then rejected credited
 * savingsBalance by an amount that had never been debited. The member's savings
 * grew by the full withdrawal amount, out of nothing, and nothing errored.
 *
 * It also gated eligibility on `totalContributions` — a cumulative lifetime
 * total that nothing in src/ ever decrements — rather than the spendable
 * `savingsBalance`. That half is not a race at all: it was wrong on every call,
 * letting a member withdraw against money they had already taken out.
 *
 * See docs/audit/integrity-sweep-2026-08-10.md.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockDebit = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    debitJsonbBalance: (...args: any[]) => mockDebit(...args),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(),
    incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: () => Promise.resolve({ success: true }) }),
    getClientIp: () => '127.0.0.1',
    createRateLimitResponse: () => ({ status: 429 }),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

/**
 * A member who has contributed ₦100,000 over their lifetime but has already
 * withdrawn most of it. This is the shape that exposes the totalContributions
 * bug: the lifetime figure is untouched by the earlier withdrawal.
 */
function drainedMember(overrides: Record<string, any> = {}) {
    return {
        userId: 'member-1',
        firstName: 'Ada',
        lastName: 'Obi',
        membershipStatus: 'active',
        totalContributions: 100_000,   // never decremented, anywhere
        savingsBalance: 6_000,         // what is actually left
        ...overrides,
    };
}

function setMember(data: Record<string, any>) {
    const snap = { exists: true, data: () => data, docs: [], empty: true };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** _submitWithdrawalAction is a form action: (prevState, formData). */
function withdrawalForm(amount: number) {
    const fd = new FormData();
    fd.set('amount', String(amount));
    fd.set('reason', 'School fees');
    fd.set('bankAccount', JSON.stringify({
        accountNumber: '0123456789', bankName: 'GTBank', accountName: 'Ada Obi',
    }));
    return fd;
}

/** Find a direct .update() call whose patch touches the named field. */
function updateFor(field: string) {
    return ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .find(([, fields]) => fields && Object.keys(fields).includes(field));
}

describe('api/cooperative/withdraw — eligibility is the spendable balance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember(drainedMember());
        mockDebit.mockResolvedValue({ ok: true, balance: 1_000, reason: null });
    });

    async function post(body: Record<string, any>) {
        const { POST } = await import('@/app/api/cooperative/withdraw/route');
        return POST({ json: async () => body } as any);
    }

    const validBody = {
        amount: 50_000,
        accountNumber: '0123456789',
        bankName: 'GTBank',
        accountName: 'Ada Obi',
    };

    it('refuses a withdrawal the lifetime total would have allowed', async () => {
        // THE test for the non-race half. totalContributions is 100,000, so the
        // old check (100,000 - 50,000 >= 5,000) passed happily. savingsBalance
        // is 6,000, so this must be refused: the other 94,000 is already gone.
        const res: any = await post(validBody);

        expect(res.status).toBe(400);
        // Nothing may be reserved for a request that should not exist.
        expect(mockDebit).not.toHaveBeenCalled();
        expect(updateFor('lockedBalance')).toBeUndefined();
    });

    it('reserves against savingsBalance, not totalContributions', async () => {
        await post({ ...validBody, amount: 1_000 });

        expect(mockDebit).toHaveBeenCalledTimes(1);
        expect(mockDebit).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            id: 'member-1',
            field: 'savingsBalance',
            amount: 1_000,
        }));
    });

    it('locks the reserved funds, so a later reject nets to zero', async () => {
        // The money-creation test. Without this increment, cooperative/_admin.ts
        // rejecting the request credits savingsBalance by an amount that was
        // never debited and drives lockedBalance negative.
        await post({ ...validBody, amount: 1_000 });

        const locked = updateFor('lockedBalance');
        expect(locked).toBeDefined();
        expect(locked![1].lockedBalance).toEqual(
            expect.objectContaining({ _operand: 1_000 })
        );
    });

    it('locks nothing when the reservation is refused', async () => {
        mockDebit.mockResolvedValue({ ok: false, balance: 200, reason: 'insufficient_funds' });

        const res: any = await post({ ...validBody, amount: 1_000 });

        expect(res.status).toBe(400);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });

    it('debits before it locks, never the other way round', async () => {
        // Ordering is the guard against a crash between the two. Locking first
        // would reserve funds that were never taken.
        const order: string[] = [];
        mockDebit.mockImplementation(() => {
            order.push('debit');
            return Promise.resolve({ ok: true, balance: 1_000, reason: null });
        });
        (global as any).mockFirestoreUpdate.mockImplementation((_id: string, fields: any) => {
            if (fields && 'lockedBalance' in fields) order.push('lock');
            return Promise.resolve();
        });

        await post({ ...validBody, amount: 1_000 });

        expect(order).toEqual(['debit', 'lock']);
    });
});

describe('cooperative/_actions — _submitWithdrawalAction locks what it debits', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember(drainedMember({ savingsBalance: 80_000 }));
        mockDebit.mockResolvedValue({ ok: true, balance: 55_000, reason: null });
    });

    it('increments lockedBalance after the debit', async () => {
        // This action was already converted to debitJsonbBalance, and that half
        // was right. It never incremented lockedBalance, so every request
        // through it left the field one withdrawal further negative once an
        // admin approved or rejected.
        const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_actions');
        await submitWithdrawalAction({} as any, withdrawalForm(25_000));

        expect(mockDebit).toHaveBeenCalledWith(expect.objectContaining({
            field: 'savingsBalance',
            amount: 25_000,
        }));

        const locked = updateFor('lockedBalance');
        expect(locked).toBeDefined();
        expect(locked![1].lockedBalance).toEqual(
            expect.objectContaining({ _operand: 25_000 })
        );
    });

    it('locks nothing when the debit is refused', async () => {
        mockDebit.mockResolvedValue({ ok: false, balance: 100, reason: 'insufficient_funds' });

        const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_actions');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm(25_000));

        expect(result.success).toBe(false);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });
});

describe('cooperative/_withdrawal — the third door onto savingsBalance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember(drainedMember({ savingsBalance: 80_000, cooperativeId: 'coop-1' }));
        mockDebit.mockResolvedValue({ ok: true, balance: 55_000, reason: null });
    });

    it('takes the debit through the locked primitive, not a read-check-write', async () => {
        // Was: read savingsBalance, compare, then FieldValue.increment(-amount)
        // inside runTransaction, which takes no lock. Two withdrawals submitted
        // together both passed against the same balance.
        const { submitWithdrawalRequestAction } = await import('@/app/actions/cooperative/_withdrawal');
        await submitWithdrawalRequestAction({
            amount: 25_000,
            bankName: 'GTBank',
            accountNumber: '0123456789',
            accountName: 'Ada Obi',
            reason: 'School fees',
        });

        expect(mockDebit).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            field: 'savingsBalance',
            amount: 25_000,
        }));
        // The old in-transaction decrement must be gone, not left alongside —
        // keeping both would take the money twice.
        const txCalls = ((global as any).mockFirestoreTxUpdate.mock.calls as any[]);
        expect(txCalls.some(([, f]) => f && 'savingsBalance' in f)).toBe(false);
    });

    it('refuses on insufficient funds without locking anything', async () => {
        mockDebit.mockResolvedValue({ ok: false, balance: 200, reason: 'insufficient_funds' });

        const { submitWithdrawalRequestAction } = await import('@/app/actions/cooperative/_withdrawal');
        const result: any = await submitWithdrawalRequestAction({
            amount: 25_000,
            bankName: 'GTBank',
            accountNumber: '0123456789',
            accountName: 'Ada Obi',
        });

        expect(result.success).toBe(false);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });
});
