/**
 * @jest-environment node
 */

/**
 *   THE PLATFORM COULD DETECT STRANDED MONEY, REFUSE TO MAKE MORE OF IT, AND
 *   DO NOTHING ABOUT WHAT WAS ALREADY THERE.
 *
 *   The wallet-keying work put three things in place. Two of them hold a line:
 *
 *     _duplicate_profiles   REFUSES to supersede a record still holding a
 *                           balance — the only way one is ever created
 *     actions/user.ts       the deletion guard counts every owned wallet, so
 *                           an account holding stranded money cannot be erased
 *
 *   Neither moves a naira. A balance already filed under a superseded profile
 *   stayed exactly where it was, unreachable by the member, by checkout and by
 *   withdrawal, with `_getOrCreateWallet` logging "needs moving by hand" at a
 *   platform that had no hand to move it with. That is a diagnosis, not a fix.
 *
 * ── THE MOVE ITSELF IS NOT IN THIS FILE, AND THAT IS THE DESIGN ─────────────
 *
 *   Migration 046 does it in ONE transaction, because a credit and a debit as
 *   two RPC calls are each idempotent and NOT atomic as a pair — a credit that
 *   lands without its debit does not lose money, it mints it. And it re-reads
 *   the `_migratedTo` / `supabaseAuthId` pointer inside that same transaction,
 *   so it refuses any pair the platform does not already say is one person.
 *
 *   Those properties are tested where they live, against a real cluster:
 *   __tests__/pg/money-that-moves-between-two-wallets.test.ts.
 *
 *   What is tested HERE is everything the database cannot know: that only an
 *   admin can ask, that the reason is required, that the audit row is written
 *   BEFORE the effect, and that the database's refusals reach a person as
 *   something they can act on rather than as a reason code.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const consolidateWalletToLiveProfile = jest.fn<any>();
jest.mock('@/lib/wallet-ledger', () => ({
    consolidateWalletToLiveProfile: (...a: any[]) => consolidateWalletToLiveProfile(...a),
}));

const createAdminAuditLog = jest.fn<(entry: any) => Promise<void>>(async () => undefined);
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (entry: any) => createAdminAuditLog(entry),
    recordAdminAction: jest.fn(async () => undefined),
}));

const requireAdmin = jest.fn<any>();
jest.mock('@/lib/require-admin', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

let store: FakeDbHandle;

const ADMIN = 'an-admin';
const LIVE = 'live-profile';
const OLD = 'superseded-profile';
const OTHER = 'somebody-else';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    requireAdmin.mockResolvedValue({ userId: ADMIN, roles: ['super_admin'] });
    consolidateWalletToLiveProfile.mockResolvedValue({
        moved: true, amount: 5000, fromBalance: 0, toBalance: 5000, reason: null,
    });

    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com', fullName: 'A Member' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, OTHER, { email: 'other@example.com' });
});

async function actions() {
    return await import('@/app/actions/admin/_wallet_consolidation');
}

const consolidate = async (over: Record<string, unknown> = {}) => {
    const { consolidateWalletAction } = await actions();
    return await consolidateWalletAction({
        fromId: OLD, toId: LIVE, reason: 'Same person, settled last week.', ...over,
    }) as any;
};

// ─── finding it ──────────────────────────────────────────────────────────────

describe('finding the money nobody can reach', () => {
    it('lists a superseded profile that still holds a balance', async () => {
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5000 });

        const { findStrandedWalletsAction } = await actions();
        const r = await findStrandedWalletsAction() as any;

        expect(r.success).toBe(true);
        expect(r.data.stranded).toHaveLength(1);
        expect(r.data.stranded[0]).toMatchObject({ fromId: OLD, toId: LIVE, balance: 5000 });
    });

    it('and does NOT list one at zero — 272 wallets are in that state', async () => {
        //   The vacuity control. A finder that reported every superseded wallet
        //   would name 272 profiles and mean nothing by it.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 0 });

        const { findStrandedWalletsAction } = await actions();
        const r = await findStrandedWalletsAction() as any;

        expect(r.data.stranded).toEqual([]);
        //   But it was looked at, which is the difference between "none" and
        //   "did not check".
        expect(r.data.scanned).toBe(1);
    });

    it('and never lists a live profile, however much it holds', async () => {
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 80_000 });
        store.seed(COLLECTIONS.WALLETS, OTHER, { balance: 999_999 });

        const { findStrandedWalletsAction } = await actions();
        const r = await findStrandedWalletsAction() as any;

        expect(r.data.stranded).toEqual([]);
    });

    it('and refuses a caller who is not an admin', async () => {
        requireAdmin.mockResolvedValue({ error: 'Forbidden' });
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5000 });

        const { findStrandedWalletsAction } = await actions();
        const r = await findStrandedWalletsAction() as any;

        expect(r.success).toBe(false);
        //   The LIST is a map of where unreachable money is. Gated as tightly
        //   as the write beside it.
        expect(r.data).toBeNull();
    });
});

// ─── moving it ───────────────────────────────────────────────────────────────

describe('moving it', () => {
    it('moves the balance and reports what moved', async () => {
        const r = await consolidate();

        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ moved: true, amount: 5000, toBalance: 5000 });
        expect(consolidateWalletToLiveProfile).toHaveBeenCalledWith(
            { fromId: OLD, toId: LIVE, actorId: ADMIN },
        );
    });

    it('REFUSES A CALLER WHO IS NOT AN ADMIN, AND MOVES NOTHING', async () => {
        requireAdmin.mockResolvedValue({ error: 'Forbidden' });

        const r = await consolidate();

        expect(r.success).toBe(false);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
    });

    it('and requires a reason, because the rows will not explain themselves', async () => {
        //   The same bar the duplicate tool sets. Six months on, nothing on
        //   either wallet says why a balance moved; the audit row is the only
        //   place that can.
        const r = await consolidate({ reason: 'ok' });

        expect(r.success).toBe(false);
        expect(consolidateWalletToLiveProfile).not.toHaveBeenCalled();
    });

    it('AND THE AUDIT ROW IS WRITTEN BEFORE THE MONEY MOVES', async () => {
        //   #530's rule. createAdminAuditLog never throws, so writing it first
        //   cannot fail the operation — and it cannot be skipped by a failure
        //   in the move either, which is the case that matters: a transfer
        //   that errored halfway must still have a record that it was asked for.
        const order: string[] = [];
        createAdminAuditLog.mockImplementation(async () => { order.push('audit'); });
        consolidateWalletToLiveProfile.mockImplementation(async () => {
            order.push('move');
            return { moved: true, amount: 5000, fromBalance: 0, toBalance: 5000, reason: null };
        });

        await consolidate();

        expect(order).toEqual(['audit', 'move']);
    });

    it('and the audit row carries both ids and the operator\'s own words', async () => {
        await consolidate({ reason: 'Confirmed by phone with the member.' });

        const call = createAdminAuditLog.mock.calls[0]?.[0] as any;
        expect(call.metadata).toMatchObject({ fromId: OLD, toId: LIVE });
        expect(String(call.details)).toContain('Confirmed by phone with the member.');
    });
});

// ─── and what the database refuses ───────────────────────────────────────────

describe('the database refuses, and a person is told why', () => {
    it('turns not_the_same_person into something actionable', async () => {
        //   A reason code is not an answer. The admin needs to know the next
        //   step, which is to settle the duplicate first.
        consolidateWalletToLiveProfile.mockResolvedValue({
            moved: false, amount: 0, fromBalance: 0, toBalance: 0, reason: 'not_the_same_person',
        });

        const r = await consolidate({ fromId: OTHER });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not linked/i);
        expect(String(r.error)).toMatch(/settle the duplicate/i);
    });

    it('and warns that a superseded destination would strand it again', async () => {
        consolidateWalletToLiveProfile.mockResolvedValue({
            moved: false, amount: 0, fromBalance: 0, toBalance: 0, reason: 'target_is_not_live',
        });

        const r = await consolidate();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/stranded again/i);
    });

    it('but reports nothing_to_move as SUCCESS, because the state asked for holds', async () => {
        //   The ordinary answer — the balance is already where it belongs, or
        //   somebody moved it a moment ago. Reporting that as a failure would
        //   send an admin looking for a fault that is not there.
        consolidateWalletToLiveProfile.mockResolvedValue({
            moved: false, amount: 0, fromBalance: 0, toBalance: 250, reason: 'nothing_to_move',
        });

        const r = await consolidate();

        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ moved: false, amount: 0 });
    });

    it('and never claims a move the database did not make', async () => {
        //   THE control on all four above. If the action reported success
        //   regardless, every refusal here would be decoration.
        for (const reason of ['not_the_same_person', 'target_is_not_live', 'no_source_wallet', 'same_profile']) {
            consolidateWalletToLiveProfile.mockResolvedValue({
                moved: false, amount: 0, fromBalance: 0, toBalance: 0, reason,
            });

            const r = await consolidate();

            expect(r.success).toBe(false);
            expect(r.data).toBeNull();
        }
    });
});
