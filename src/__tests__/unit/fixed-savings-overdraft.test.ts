/**
 * @jest-environment node
 */

/**
 * Fixed savings: the fix had gone to the door nobody calls.
 *
 * WHAT WAS WRONG
 * --------------
 * cooperative/_actions.ts `_createFixedSavingsAction` was converted to
 * debitJsonbBalance during the atomic-money migration and is correct. It has no
 * caller. The page at cooperatives/(member)/fixed-savings posts to
 * api/cooperative/create-fixed-savings, and THAT route kept the original:
 *
 *     const currentBalance = userData.savingsBalance || 0;
 *     if (currentBalance < amount) throw ...
 *     transaction.update(memberRef, { savingsBalance: currentBalance - amount });
 *
 * Two defects, and the second is the worse one:
 *
 *   1. Read-check-write inside runTransaction, which takes no lock. Two plans
 *      created together both passed against the same balance and both deducted,
 *      so a member could lock away more than they had.
 *
 *   2. The write is ABSOLUTE, not FieldValue.increment. Migration 010 therefore
 *      cannot save it — 010 only makes the sentinel atomic, and no sentinel is
 *      used. An absolute write computed from a stale read does not merely
 *      double-deduct: it ERASES any concurrent write to savingsBalance,
 *      including a contribution's credit landing at the same moment. Same shape
 *      as the restock in marketplace/_buyer.ts.
 *
 * See docs/audit/integrity-sweep-2026-08-10.md (F1).
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

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function setMember(data: Record<string, any> = {}) {
    const snap = {
        exists: true,
        docs: [],
        empty: false,
        data: () => ({
            userId: 'member-1',
            membershipStatus: 'active',
            savingsBalance: 200_000,
            ...data,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** Did anything write savingsBalance directly, on either spy? */
function savingsWrites() {
    const direct = ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'savingsBalance' in f);
    const inTx = ((global as any).mockFirestoreTxUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'savingsBalance' in f);
    return [...direct, ...inTx];
}

function touchedCollection(name: string) {
    return ((global as any).mockFirestoreCollection.mock.calls as any[])
        .some(([n]) => n === name);
}

async function post(body: Record<string, any>) {
    const { POST } = await import('@/app/api/cooperative/create-fixed-savings/route');
    return POST({ json: async () => body } as any);
}

const validBody = { amount: 100_000, durationMonths: 6 };

describe('api/cooperative/create-fixed-savings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember();
        mockDebit.mockResolvedValue({ ok: true, balance: 100_000, reason: null });
    });

    it('takes the debit through the locked primitive', async () => {
        await post(validBody);

        expect(mockDebit).toHaveBeenCalledTimes(1);
        expect(mockDebit).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            id: 'member-1',
            field: 'savingsBalance',
            amount: 100_000,
        }));
    });

    it('never writes savingsBalance itself', async () => {
        // THE test for defect 2. Any surviving write of this field — absolute or
        // increment — means the balance reaches the database twice and the
        // primitive is not the only thing moving it.
        await post(validBody);

        expect(savingsWrites()).toHaveLength(0);
    });

    it('creates no plan when the debit is refused', async () => {
        mockDebit.mockResolvedValue({ ok: false, balance: 400, reason: 'insufficient_funds' });

        const res: any = await post(validBody);

        expect(res.status).toBe(400);
        expect(touchedCollection('fixed_savings_plans')).toBe(false);
    });

    it('reports the balance the debit actually saw, not a stale read', async () => {
        // The refusal message used the pre-read balance, which under
        // concurrency is not the number that caused the refusal.
        mockDebit.mockResolvedValue({ ok: false, balance: 1_250, reason: 'insufficient_funds' });

        const res: any = await post(validBody);
        const body = await res.json();

        expect(body.message).toContain('1,250');
    });

    it('creates the plan once the funds are locked', async () => {
        const res: any = await post(validBody);
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(touchedCollection('fixed_savings_plans')).toBe(true);
    });
});
