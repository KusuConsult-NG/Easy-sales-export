/**
 * @jest-environment node
 */

/**
 * The two primitives migration 020 adds, and the paths that needed them.
 *
 * 1. THE MINIMUM-BALANCE FLOOR WAS ADVISORY
 *
 * platform.ts and api/cooperative/withdraw both enforced a ₦5,000 floor with a
 * plain read above the debit, and the comment on each said what that meant:
 * "two withdrawals that each leave 5,000 behind can together dip under it."
 * debitJsonbBalance could not close it — it checks `balance >= amount` and
 * nothing more, so it guaranteed only that the balance could not go NEGATIVE.
 *
 * debit_jsonb_balance_with_floor applies the floor under the same lock as the
 * deduction. `below_floor` is a distinct reason from `insufficient_funds`: the
 * member HAS the money and is simply not allowed to take all of it.
 *
 * 2. OPTIMISTIC LOCKING DID NOT LOCK
 *
 * versionedUpdate read _version inside runTransaction, compared it and wrote.
 * That wrapper takes no lock, so two callers read the same version, both passed
 * and both wrote — the exact failure the mechanism exists to prevent.
 * loan-actions.ts dropped the helper rather than trust it; five other sites kept
 * it and kept the false guarantee.
 *
 * claim_versioned_update does the compare-and-swap in one conditional UPDATE.
 * Rewriting the helper moves every caller onto it without touching them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaimVersioned = jest.fn() as jest.Mock<any>;
const mockDebitWithFloor = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimVersionedUpdate: (...a: any[]) => mockClaimVersioned(...a),
    debitJsonbBalanceWithFloor: (...a: any[]) => mockDebitWithFloor(...a),
    debitJsonbBalance: jest.fn(),
    claimPaymentOnce: jest.fn(),
    claimIdempotencyKey: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

describe('versionedUpdate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimVersioned.mockResolvedValue({ claimed: true, version: 4 });
    });

    /** A DocumentReference is identified by `${collection}/${id}`. */
    const ref = (collection: string, id: string) => ({ id, path: `${collection}/${id}` }) as any;

    it('goes through the compare-and-swap, not a read-then-write', async () => {
        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await versionedUpdate({} as any, ref('cooperative_members', 'm1'), 3, { note: 'x' });

        expect(mockClaimVersioned).toHaveBeenCalledWith(expect.objectContaining({
            table: 'cooperative_members',
            id: 'm1',
            expectedVersion: 3,
            patch: { note: 'x' },
        }));
    });

    it('passes the collection name for a generic-table document', async () => {
        // A document in document_collections is identified by (id,
        // collection_name), not by id alone. Omitting the collection would let
        // the CAS match a same-id row from a different collection.
        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await versionedUpdate({} as any, ref('vendor_settings', 'v1'), 1, { a: 1 });

        const [args] = mockClaimVersioned.mock.calls[0] as [any];
        expect(args.table).toBe('document_collections');
        expect(args.collection).toBe('vendor_settings');
    });

    it('omits the collection for a dedicated table', async () => {
        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await versionedUpdate({} as any, ref('users', 'u1'), 0, { a: 1 });

        const [args] = mockClaimVersioned.mock.calls[0] as [any];
        expect(args.table).toBe('users');
        expect(args.collection).toBeUndefined();
    });

    it('raises STALE_DATA when the version moved', async () => {
        mockClaimVersioned.mockResolvedValue({ claimed: false, version: 9 });

        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await expect(
            versionedUpdate({} as any, ref('users', 'u1'), 3, { a: 1 })
        ).rejects.toThrow(/STALE_DATA/);
    });

    it('distinguishes a missing record from a lost claim', async () => {
        // version === null means no such record. Reporting it as a conflict
        // would tell the user to refresh and retry something that is not there.
        mockClaimVersioned.mockResolvedValue({ claimed: false, version: null });

        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await expect(
            versionedUpdate({} as any, ref('users', 'gone'), 3, { a: 1 })
        ).rejects.toThrow(/does not exist/);
    });

    it('never queues the write into the unlocked transaction', async () => {
        // Passing the write to the adapter's transaction would put it back on
        // the replay path this rewrite exists to leave.
        const tx = { get: jest.fn(), set: jest.fn(), update: jest.fn() };

        const { versionedUpdate } = await import('@/lib/optimistic-locking');
        await versionedUpdate(tx as any, ref('users', 'u1'), 0, { a: 1 });

        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.get).not.toHaveBeenCalled();
    });
});
