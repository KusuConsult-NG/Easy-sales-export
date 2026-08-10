/**
 * @jest-environment node
 */

/**
 * Client-supplied idempotency keys.
 *
 * WHAT WAS WRONG
 * --------------
 * Two actions took an `idempotencyKey` from a form and "checked" it like this:
 *
 *     const doc = await idempotencyRef.get();
 *     if (doc.exists) throw new Error("Duplicate transaction detected.");
 *     ... do the work ...
 *     idempotencyRef.set({ ... });          // the key is written LAST
 *
 * The read takes no lock and the key is written after the work, so two
 * submissions carrying the SAME key both read "absent" and both proceeded. The
 * key made the duplicate look impossible without preventing it.
 *
 * platform.ts is the one that matters: it LOCKS A MEMBER'S SAVINGS, so a double
 * submission locked the funds twice. It carried a second defect too — the
 * balance was read, compared, and then decremented, the overdraft shape already
 * fixed on _submitWithdrawalAction and WAVE earnings.
 *
 * export.ts creates an export window and moves no money, so a duplicate costs a
 * stray record.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaimIdempotencyKey = jest.fn() as jest.Mock<any>;
const mockDebitJsonbBalance = jest.fn() as jest.Mock<any>;
const mockDebitWithFloor = jest.fn() as jest.Mock<any>;
const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...args: any[]) => mockClaimIdempotencyKey(...args),
    debitJsonbBalance: (...args: any[]) => mockDebitJsonbBalance(...args),
    debitJsonbBalanceWithFloor: (...args: any[]) => mockDebitWithFloor(...args),
    claimPaymentOnce: (...args: any[]) => mockClaimPaymentOnce(...args),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'], isVerified: true } },
        error: null,
    }));
}

function setDocs(data: Record<string, any>) {
    const snap = { exists: true, data: () => data, docs: [{ id: 'doc-1', data: () => data }], empty: false, id: 'doc-1' };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function withdrawalForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set('idempotencyKey', 'idem-1');
    fd.set('cooperativeId', 'coop-1');
    fd.set('amount', '20000');
    fd.set('accountNumber', '0123456789');
    fd.set('accountName', 'A Member');
    fd.set('bankName', 'Test Bank');
    fd.set('reason', 'personal');
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
}

describe('submitWithdrawalAction — the key that locked funds twice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('member-1');
        mockClaimIdempotencyKey.mockResolvedValue({ claimed: true, heldAt: null });
        mockDebitJsonbBalance.mockResolvedValue({ ok: true, balance: 80_000, reason: null });
        mockDebitWithFloor.mockResolvedValue({ ok: true, balance: 80_000, reason: null });
        setDocs({ cooperativeId: 'coop-1', savingsBalance: 100_000 });
    });

    it('locks no funds when the key was already claimed', async () => {
        // THE test. Two submissions of one form both read "absent" and both
        // locked the member's savings.
        mockClaimIdempotencyKey.mockResolvedValue({ claimed: false, heldAt: '2026-08-09T00:00:00Z' });

        const { submitWithdrawalAction } = await import('@/app/actions/platform');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm());

        expect(result.success).toBe(false);
        expect(mockDebitJsonbBalance).not.toHaveBeenCalled();
        expect(mockDebitWithFloor).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('claims the key before touching the balance', async () => {
        const { submitWithdrawalAction } = await import('@/app/actions/platform');
        await submitWithdrawalAction({} as any, withdrawalForm());

        expect(mockClaimIdempotencyKey).toHaveBeenCalledTimes(1);
        const call = mockClaimIdempotencyKey.mock.calls[0][0] as any;
        expect(call.key).toBe('idem-1');
        expect(call.action).toBe('submit_withdrawal');
    });

    it('debits under a row lock rather than reading and writing back', async () => {
        const { submitWithdrawalAction } = await import('@/app/actions/platform');
        await submitWithdrawalAction({} as any, withdrawalForm());

        // The floor moved INTO the debit (migration 020). It used to be a
        // plain read above this call, which took no lock — two withdrawals that
        // each left the minimum behind could together dip under it.
        expect(mockDebitWithFloor).toHaveBeenCalledWith({
            table: 'cooperative_members',
            id: 'member-1',
            field: 'savingsBalance',
            amount: 20_000,
            floor: 5000,
        });
    });

    it('creates no withdrawal request when the debit is refused', async () => {
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 100, reason: 'insufficient_funds' });

        const { submitWithdrawalAction } = await import('@/app/actions/platform');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm());

        expect(result.success).toBe(false);
        // Both spies: the pre-fix code wrote through transaction.update/set, so
        // asserting only on the direct-write spy would pass against the very
        // code this test exists to catch.
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxSet).not.toHaveBeenCalled();
    });

    it('still enforces the minimum balance, now inside the locked debit', async () => {
        // 100,000 balance, 96,000 requested leaves 4,000 — under the 5,000 floor.
        //
        // This used to assert the debit was never REACHED, because an advisory
        // read refused first. That read took no lock, so two withdrawals each
        // leaving 5,000 behind could together dip under the floor. The floor is
        // now a parameter of the debit (migration 020), so the correct
        // assertion is that it is passed and honoured — not that the debit is
        // skipped. The rule is enforced in a strictly stronger place.
        mockDebitWithFloor.mockResolvedValue({ ok: false, balance: 100_000, reason: 'below_floor' });

        const { submitWithdrawalAction } = await import('@/app/actions/platform');
        const result: any = await submitWithdrawalAction({} as any, withdrawalForm({ amount: '96000' }));

        expect(result.success).toBe(false);
        expect(mockDebitWithFloor).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 96_000, floor: 5000 })
        );
        // below_floor must not be reported as insufficient funds: the member
        // has the money and is simply not allowed to take all of it.
        expect(result.error).toContain('minimum balance');
        // The unfloored primitive must not be used on this path at all.
        expect(mockDebitJsonbBalance).not.toHaveBeenCalled();
    });
});

describe('_createExportWindowAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('exporter-1');
        mockClaimIdempotencyKey.mockResolvedValue({ claimed: true, heldAt: null });
        setDocs({ isVerified: true, cacNumber: 'RC123456' });
    });

    function exportForm() {
        const fd = new FormData();
        fd.set('idempotencyKey', 'idem-2');
        // commodity is a z.enum — 'Cocoa' is not a member of it.
        fd.set('commodity', 'yam');
        fd.set('quantity', '20');
        fd.set('amount', '5000000');
        fd.set('destination', 'other');
        return fd;
    }

    it('creates no window when the key was already claimed', async () => {
        mockClaimIdempotencyKey.mockResolvedValue({ claimed: false, heldAt: '2026-08-09T00:00:00Z' });

        const { createExportWindowAction } = await import('@/app/actions/export');
        const result: any = await createExportWindowAction({} as any, exportForm());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/duplicate/i);
    });

    it('claims the key with the action recorded on it', async () => {
        const { createExportWindowAction } = await import('@/app/actions/export');
        await createExportWindowAction({} as any, exportForm());

        const call = mockClaimIdempotencyKey.mock.calls[0][0] as any;
        expect(call.key).toBe('idem-2');
        expect(call.action).toBe('create_export_window');
    });
});
