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
import { COOPERATIVE_MINIMUM_BALANCE, formatMinimumBalance } from '@/lib/cooperative-limits';

const mockDebit = jest.fn() as jest.Mock<any>;
const mockDebitWithFloor = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    debitJsonbBalance: (...args: any[]) => mockDebit(...args),
    debitJsonbBalanceWithFloor: (...args: any[]) => mockDebitWithFloor(...args),
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
        mockDebitWithFloor.mockResolvedValue({ ok: true, balance: 1_000, reason: null });
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
        //
        // The refusal now comes from the primitive rather than a pre-read — the
        // advisory check was removed when the floor moved into the debit
        // (migration 020). So the assertion is that the request is refused and
        // nothing is reserved, NOT that the debit was skipped: the route no
        // longer decides eligibility for itself, which is the point.
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 6_000, reason: 'insufficient_funds' });

        const res: any = await post(validBody);

        expect(res.status).toBe(400);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });

    it('reserves against savingsBalance, with the floor applied under the lock', async () => {
        await post({ ...validBody, amount: 1_000 });

        expect(mockDebitWithFloor).toHaveBeenCalledTimes(1);
        expect(mockDebitWithFloor).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            id: 'member-1',
            field: 'savingsBalance',
            amount: 1_000,
            // The floor used to be a plain read above this call. Two
            // withdrawals each leaving ₦5,000 behind could together dip under
            // it, because a read takes no lock.
            floor: 5000,
        }));
        // The unfloored primitive must not be used on a path that has a floor.
        expect(mockDebit).not.toHaveBeenCalled();
    });

    it('reports a floor refusal as a floor, not as insufficient funds', async () => {
        // The member HAS the money and is simply not allowed to take all of it.
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 6_000, reason: 'below_floor' });

        const res: any = await post({ ...validBody, amount: 2_000 });
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.message).toContain('minimum balance');
        expect(body.message).not.toContain('Insufficient balance');
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
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 200, reason: 'insufficient_funds' });

        const res: any = await post({ ...validBody, amount: 1_000 });

        expect(res.status).toBe(400);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });

    it('debits before it locks, never the other way round', async () => {
        // Ordering is the guard against a crash between the two. Locking first
        // would reserve funds that were never taken.
        const order: string[] = [];
        mockDebitWithFloor.mockImplementation(() => {
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

/**
 * AND THE MINIMUM BALANCE APPLIED TO TWO OF THE FOUR.
 *
 * These two doors used debitJsonbBalance, which enforces "not negative" and
 * nothing else, while /api/cooperative/withdraw above and
 * repayLoanFromSavingsAction — the other two paths that reduce this same
 * balance — both refuse below COOPERATIVE_MINIMUM_BALANCE through
 * debitJsonbBalanceWithFloor.
 *
 * So a member could empty their savings to zero through one screen and be
 * refused at ₦4,999 through another, for the same request. Both go through the
 * floor primitive now, which is why these assertions moved from mockDebit to
 * mockDebitWithFloor.
 */
describe('cooperative/_actions — _submitWithdrawalAction locks what it debits', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember(drainedMember({ savingsBalance: 80_000 }));
        mockDebitWithFloor.mockResolvedValue({ ok: true, balance: 55_000, reason: null });
    });

    it('increments lockedBalance after the debit', async () => {
        // This action was already converted to a locked debit, and that half
        // was right. It never incremented lockedBalance, so every request
        // through it left the field one withdrawal further negative once an
        // admin approved or rejected.
        const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_coop_money');
        await submitWithdrawalAction({} as any, withdrawalForm(25_000));

        expect(mockDebitWithFloor).toHaveBeenCalledWith(expect.objectContaining({
            field: 'savingsBalance',
            amount: 25_000,
            floor: COOPERATIVE_MINIMUM_BALANCE,
        }));

        const locked = updateFor('lockedBalance');
        expect(locked).toBeDefined();
        expect(locked![1].lockedBalance).toEqual(
            expect.objectContaining({ _operand: 25_000 })
        );
    });

    it('locks nothing when the debit is refused', async () => {
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 100, reason: 'insufficient_funds' });

        const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_coop_money');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm(25_000));

        expect(result.success).toBe(false);
        expect(updateFor('lockedBalance')).toBeUndefined();
    });

    it('and refusing at the floor says so, rather than "insufficient funds"', async () => {
        // The member HAS the money and may not take all of it. Telling somebody
        // with ₦6,000 that their funds are insufficient is simply false.
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 6_000, reason: 'below_floor' });

        const { submitWithdrawalAction } = await import('@/app/actions/cooperative/_coop_money');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm(25_000));

        expect(result.success).toBe(false);
        expect(result.error).toContain(formatMinimumBalance());
        expect(result.error).not.toContain('Insufficient');
    });
});

describe('cooperative/_withdrawal — the third door onto savingsBalance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        setMember(drainedMember({ savingsBalance: 80_000, cooperativeId: 'coop-1' }));
        mockDebitWithFloor.mockResolvedValue({ ok: true, balance: 55_000, reason: null });
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

        expect(mockDebitWithFloor).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            field: 'savingsBalance',
            amount: 25_000,
            floor: COOPERATIVE_MINIMUM_BALANCE,
        }));
        // The old in-transaction decrement must be gone, not left alongside —
        // keeping both would take the money twice.
        const txCalls = ((global as any).mockFirestoreTxUpdate.mock.calls as any[]);
        expect(txCalls.some(([, f]) => f && 'savingsBalance' in f)).toBe(false);
    });

    it('refuses on insufficient funds without locking anything', async () => {
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 200, reason: 'insufficient_funds' });

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

    it('and refusing at the floor says so, rather than "insufficient funds"', async () => {
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 6_000, reason: 'below_floor' });

        const { submitWithdrawalRequestAction } = await import('@/app/actions/cooperative/_withdrawal');
        const result: any = await submitWithdrawalRequestAction({
            amount: 25_000,
            bankName: 'GTBank',
            accountNumber: '0123456789',
            accountName: 'Ada Obi',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain(formatMinimumBalance());
        expect(result.error).not.toContain('Insufficient');
    });
});

describe('every path that reduces a member\'s savings applies the floor', () => {
    // A structural sweep, so a fifth door added later cannot skip it. Fixed
    // savings is deliberately excluded and says why.
    const { readFileSync } = require('fs');
    const { join } = require('path');

    const REDUCERS = [
        'src/app/api/cooperative/withdraw/route.ts',
        'src/app/actions/platform.ts',
        'src/app/actions/cooperative/_withdrawal.ts',
        'src/app/actions/cooperative/_coop_money.ts',
        'src/app/actions/cooperative/_loans_repayments.ts',
    ];

    it.each(REDUCERS)('%s imports the shared floor', (rel: string) => {
        const src = readFileSync(join(process.cwd(), rel), 'utf-8');

        expect(src).toContain('COOPERATIVE_MINIMUM_BALANCE');
        expect(src).toContain('debitJsonbBalanceWithFloor');
    });

    it('and the floor is one number, defined once', () => {
        // Vacuity guard: five files agreeing on a locally-declared 5000 is the
        // defect, not the fix.
        for (const rel of REDUCERS) {
            const src = readFileSync(join(process.cwd(), rel), 'utf-8');
            expect(src).toMatch(/from ["']@\/lib\/cooperative-limits["']/);
        }
        expect(COOPERATIVE_MINIMUM_BALANCE).toBe(5000);
    });

    it('while a fixed-savings plan does not, because the money stays in', () => {
        // Locking savings into a fixed plan does not take them out of the
        // cooperative, so the "leave ₦5,000 behind" rule does not apply. Both
        // fixed-savings doors agree on that, which is the point.
        const action = readFileSync(join(process.cwd(), 'src/app/actions/cooperative/_coop_money.ts'), 'utf-8');
        const route = readFileSync(join(process.cwd(), 'src/app/api/cooperative/create-fixed-savings/route.ts'), 'utf-8');

        expect(action).toContain('Insufficient savings balance to create this fixed savings plan');
        expect(route).toContain('debitJsonbBalance(');
        expect(route).not.toContain('debitJsonbBalanceWithFloor');
    });
});
