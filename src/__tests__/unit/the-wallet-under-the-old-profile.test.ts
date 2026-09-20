/**
 * @jest-environment node
 */

/**
 *   THE WALLET KEYING — AND THE OBVIOUS FIX THAT WOULD HAVE BEEN WORSE.
 *
 *   The wallet id is the user id. All six accesses on this platform were
 *   written `db.collection(WALLETS).doc(userId)`, so the sweep that widened
 *   `userId` everywhere else arrives here expecting to widen six more reads.
 *
 *   IT MUST NOT, AND THIS SUITE IS WHY. The balance is not written by this
 *   codebase — migration 005 writes it, and both functions key on `p_user_id`:
 *
 *       credit_wallet_once   INSERT INTO wallets (id, balance) VALUES (p_user_id, …)
 *       debit_wallet_once    UPDATE wallets … WHERE wallets.id = p_user_id
 *
 *   `p_user_id` is the session's id, which is live by construction (#490 ranks
 *   a superseded row last at login). So a superseded wallet cannot receive and
 *   cannot be spent from. Resolving it onto the dashboard would put ₦5,000 in
 *   front of somebody and then refuse their ₦1,000 checkout — a balance the
 *   platform displays and will not honour, which is worse than the ₦0 it
 *   shows today.
 *
 *   THE SPLIT THIS SUITE PINS:
 *
 *       what you are SHOWN      the live row — what you can actually spend
 *       what the GUARDS count   every row — deleting an account and marking a
 *                               wallet are irreversible
 *       what is REFUSED         superseding a profile that still holds money,
 *                               because that is the only way a balance ever
 *                               becomes unreachable in the first place
 *
 *   MEASURED FIRST: 765 superseded profiles, 272 carrying a wallet row, every
 *   one of them at ₦0. Nothing is stranded today. This is a trap being
 *   disarmed, not a fire being put out — which is exactly why the tests below
 *   have to state the intended shape rather than chase a live symptom.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth-revocation', () => ({
    revokeAuthAccess: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    syncAuthEmail: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    resolveSupabaseAuthId: jest.fn(async (id: string) => id),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));

let store: FakeDbHandle;

const LIVE = 'live-profile';
const OLD = 'superseded-profile';
const STRANGER = 'somebody-else';

function seedTwoProfiles(): void {
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com', fullName: 'A Member' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    //   A control on every test in this file: an unrelated person, with money,
    //   whose id is never reachable from LIVE by any pointer.
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    store.seed(COLLECTIONS.WALLETS, STRANGER, { balance: 999_999 });
}

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({ session: { user: { id, email: `${id}@e.com`, roles: [] } }, error: null })
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedTwoProfiles();
    setSession(LIVE);
});

// ─── the lookup itself ───────────────────────────────────────────────────────

describe('wallet-lookup', () => {
    async function lookup() {
        return await import('@/lib/wallet-lookup');
    }
    const wallets = () => {
        const { supabaseDb } = require('@/lib/supabase-db');
        return supabaseDb.collection(COLLECTIONS.WALLETS);
    };

    it('finds the row under the superseded profile, and marks the live one', async () => {
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 250 });

        const { walletRowsFor } = await lookup();
        const rows = await walletRowsFor(wallets(), LIVE);

        expect(rows.map((r) => r.id).sort()).toEqual([LIVE, OLD].sort());
        expect(rows.find((r) => r.id === LIVE)!.live).toBe(true);
        expect(rows.find((r) => r.id === OLD)!.live).toBe(false);
    });

    it('never reaches a wallet belonging to somebody else', async () => {
        //   The control that makes every other assertion here mean something:
        //   widening a lookup is only safe if it widens to THIS person.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });

        const { walletRowsFor } = await lookup();
        const rows = await walletRowsFor(wallets(), LIVE);

        expect(rows.map((r) => r.id)).not.toContain(STRANGER);
    });

    it('counts only the superseded rows as stranded, never the live one', async () => {
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 250 });

        const { strandedWalletRows, totalWalletBalance, spendableWalletBalance, walletRowsFor } = await lookup();
        const stranded = await strandedWalletRows(wallets(), LIVE);

        expect(stranded.map((r) => r.id)).toEqual([OLD]);
        expect(totalWalletBalance(await walletRowsFor(wallets(), LIVE))).toBe(5_250);
        expect(spendableWalletBalance(await walletRowsFor(wallets(), LIVE))).toBe(250);
    });

    it('reports nothing stranded for an ordinary account', async () => {
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 12_500 });

        const { strandedWalletRows } = await lookup();
        expect(await strandedWalletRows(wallets(), LIVE)).toEqual([]);
    });

    it('a superseded row at zero is not stranded — 272 accounts are in this state', async () => {
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 0 });

        const { strandedWalletRows } = await lookup();
        expect(await strandedWalletRows(wallets(), LIVE)).toEqual([]);
    });

    it('given a SUPERSEDED id, still resolves the live row as the live one', async () => {
        //   An admin-side caller holds whatever id they were handed. The
        //   forward walk runs first precisely so `live` does not depend on the
        //   caller having the good id.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 250 });

        const { walletRowsFor } = await lookup();
        const rows = await walletRowsFor(wallets(), OLD);

        expect(rows.find((r) => r.live)!.id).toBe(LIVE);
        expect(rows.find((r) => r.id === OLD)!.live).toBe(false);
    });
});

// ─── the irreversible path ───────────────────────────────────────────────────

describe('account deletion counts every wallet the person owns', () => {
    async function deleteAccount() {
        const { deleteUserAccountAction } = await import('@/app/actions/user');
        return await deleteUserAccountAction() as any;
    }

    it('refuses while money sits under a superseded profile', async () => {
        //   THE test. Before this, the guard read doc(LIVE), found nothing,
        //   raised no blocker, and let the account be erased with the ₦5,000
        //   still in a row nothing would look at again. The guard's own comment
        //   names that outcome as what it exists to prevent.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });

        const r = await deleteAccount();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/5,000/);
    });

    it('tells them the money is not theirs to withdraw', async () => {
        //   Otherwise "withdraw your funds and try again" sends somebody round
        //   a loop for ever: there is no screen on which this balance exists.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });

        const r = await deleteAccount();
        expect(String(r.error)).toMatch(/earlier profile/i);
        expect(String(r.error)).toMatch(/support/i);
    });

    it('adds the reachable and the stranded into one figure', async () => {
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 250 });
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });

        const r = await deleteAccount();
        expect(String(r.error)).toMatch(/5,250/);
    });

    it('still proceeds when every owned wallet is empty', async () => {
        //   The vacuity control. If the widening refused everybody, the three
        //   tests above would pass for the wrong reason.
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 0 });
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 0 });

        const r = await deleteAccount();
        expect(r.success).toBe(true);
    });

    it('is not blocked by a stranger who happens to be rich', async () => {
        //   STRANGER holds ₦999,999 and is seeded in every test here. If the
        //   widening ever reached sideways instead of along the pointer, this
        //   account could never be deleted at all.
        const r = await deleteAccount();
        expect(r.success).toBe(true);
    });

    it('counts cooperative savings under a superseded profile too', async () => {
        //   The same keying, the same guard, one line apart.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, OLD, { savingsBalance: 3_400 });

        const r = await deleteAccount();
        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/3,400/);
        expect(String(r.error)).toMatch(/cooperative savings/i);
    });

    it('marks the superseded wallet too, so no row is left unexplained', async () => {
        //   #300 retires wallets rather than destroying them. Marking only the
        //   live row would leave a wallet with no owner, no marker and nothing
        //   to say why it is inert.
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 0 });
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 0 });

        const r = await deleteAccount();
        expect(r.success).toBe(true);

        expect(store.get(COLLECTIONS.WALLETS, OLD)).toMatchObject({ ownerErased: true, ownerErasedUserId: LIVE });
        expect(store.get(COLLECTIONS.WALLETS, LIVE)).toMatchObject({ ownerErased: true, ownerErasedUserId: LIVE });
        //   And not sideways.
        expect(store.get(COLLECTIONS.WALLETS, STRANGER)).not.toHaveProperty('ownerErased');
    });

    it('still creates and marks the live wallet for somebody who never had one', async () => {
        //   `set` with merge, unconditionally — which is what the single line
        //   this replaced did, and what makes the marker cover every account.
        const r = await deleteAccount();
        expect(r.success).toBe(true);
        expect(store.get(COLLECTIONS.WALLETS, LIVE)).toMatchObject({ ownerErased: true, ownerErasedUserId: LIVE });
    });
});

// ─── what the person is shown ────────────────────────────────────────────────

describe('the balance on screen is the balance you can spend', () => {
    it('getMyWalletBalance reports the live row and not the superseded one', async () => {
        //   A RATCHET AGAINST THE OBVIOUS FIX. Widening this read would show
        //   ₦5,000 and then refuse a ₦1,000 checkout, because the debit runs
        //   against doc(LIVE) in the database. If a later sweep "corrects" this
        //   read, this test is the thing that says no.
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });
        store.seed(COLLECTIONS.WALLETS, LIVE, { balance: 250 });

        const { getMyWalletBalance } = await import('@/app/actions/my-data');
        expect(await getMyWalletBalance()).toBe(250);
    });

    it('and reports zero, not the stranded amount, when the live row is missing', async () => {
        store.seed(COLLECTIONS.WALLETS, OLD, { balance: 5_000 });

        const { getMyWalletBalance } = await import('@/app/actions/my-data');
        expect(await getMyWalletBalance()).toBe(0);
    });
});

// ─── and the only thing that can strand a balance ────────────────────────────

/**
 *   THE #724 SUPERSEDE TOOL IS THE PRODUCER, and it is the whole reason the
 *   guards above can stay guards rather than repairs.
 *
 *   No naira can ever ARRIVE under a superseded profile — the balance
 *   functions key on the session id, and a session id is live. A balance can
 *   only be LEFT there, by pointing a funded row at another one. Which is this
 *   action, and nothing else on the platform.
 *
 *   It also breaks the promise the tool's own header makes: "if the owner picks
 *   wrong, clearing the pointer puts the group back exactly as it was."
 *   Clearing a pointer does not put back a balance nobody can find.
 */
describe('#724 will not supersede a profile that still holds money', () => {
    const A = 'profile-a';
    const B = 'profile-b';
    const ADMIN = 'an-admin';

    beforeEach(() => {
        store.clear();
        //   A fresh group: two rival records, neither pointing anywhere, which
        //   is the "needs-a-decision" state the tool is built for.
        store.seed(COLLECTIONS.USERS, A, { email: 'rival@example.com', fullName: 'A Person' });
        store.seed(COLLECTIONS.USERS, B, { email: 'rival@example.com', fullName: 'A Person' });
        jest.doMock('@/lib/require-admin', () => ({
            requireAdmin: jest.fn(async () => ({ userId: ADMIN, roles: ['super_admin'] })),
        }));
    });

    async function settle(keepId: string, supersedeIds: string[]) {
        const { resolveDuplicateProfileGroupAction } = await import('@/app/actions/admin/_duplicate_profiles');
        return await resolveDuplicateProfileGroupAction({
            email: 'rival@example.com', keepId, supersedeIds,
            reason: 'Same person, confirmed by phone.',
        }) as any;
    }

    it('refuses, and says where the money has to go first', async () => {
        store.seed(COLLECTIONS.WALLETS, B, { balance: 5_000 });

        const r = await settle(A, [B]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/wallet balance/i);
        //   And it did not half-apply: the pointer is the effect, and there
        //   must not be one.
        expect(store.get(COLLECTIONS.USERS, B)).not.toHaveProperty('_migratedTo');
    });

    it('but settles the group when the record being superseded is empty', async () => {
        //   The vacuity control. 272 superseded profiles carry a wallet row and
        //   every one is at ₦0 — if this refused them too, the tool would have
        //   stopped working for the population it was built for.
        store.seed(COLLECTIONS.WALLETS, B, { balance: 0 });

        const r = await settle(A, [B]);

        expect(r.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, B)).toMatchObject({ _migratedTo: A });
    });

    it('and does not care what the record being KEPT holds', async () => {
        //   Money on the survivor is not stranded by anything — it is where
        //   every later credit and debit will land. Refusing here would block
        //   the settlement that FIXES the duplicate.
        store.seed(COLLECTIONS.WALLETS, A, { balance: 80_000 });

        const r = await settle(A, [B]);
        expect(r.success).toBe(true);
    });
});
