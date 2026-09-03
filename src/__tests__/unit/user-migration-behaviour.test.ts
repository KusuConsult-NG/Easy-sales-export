/**
 * @jest-environment node
 */

/**
 * migrateLegacyUserData, EXECUTED. lib/user-migration.ts was at 0%.
 *
 * It moves a member's whole account — profile, cooperative membership, loans,
 * transactions, fixed savings, withdrawals, payments and four modules' worth of
 * applications — from a legacy Firebase UID onto a Supabase Auth UUID. It is
 * called from the LOGIN path: auth.ts runs it for any user whose email matches a
 * legacy record. So everything below happens automatically, unattended, on
 * somebody signing in.
 *
 *   #173 THE LEGACY DOCUMENT WON ON EVERY FIELD, INCLUDING roles.
 *        `{ ...activeData, ...legacyData }` spreads legacy last. A legacy record
 *        carrying roles: ['admin'] merged those roles onto the live account at
 *        login. This is #87's defect in a second place — admin/_legacy.ts was
 *        closed on exactly this rule ("any resulting role set containing a
 *        privileged role needs a super_admin to write it") and this path had no
 *        guard at all.
 *
 *   #174 AND IT WON ON BALANCES.
 *        The same spread let a stale legacy figure overwrite a live wallet,
 *        savings or loan balance. #84's defect in a second place: legacy
 *        onboarding was zeroing existing members' savings and was fixed; this
 *        path was not.
 *
 *   #175 THE COMPLETION MARKER WAS WRITTEN FIRST.
 *        `_migratedAt` and `_legacyFirebaseUid` went onto the user document in
 *        step 1, before the ten collections had moved — and the caller decides
 *        whether to migrate by testing exactly those two fields. Any throw in
 *        between left the marker set and the rest behind, and the next login saw
 *        a migrated user and never retried. Permanently, and silently.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LEGACY = 'firebase-uid-legacy';
const ACTIVE = 'supabase-uuid-active';
const USERS = COLLECTIONS.USERS;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const LOANS = COLLECTIONS.COOPERATIVE_LOANS;
const COOP_TX = COLLECTIONS.COOPERATIVE_TRANSACTIONS;

const migrate = async (from = LEGACY, to = ACTIVE, email = 'ada@example.com') =>
    (await (await import('@/lib/user-migration')).migrateLegacyUserData(from, to, email));

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#173 — roles do not travel through a login', () => {
    it('carries an ordinary member across, keeping their profile', async () => {
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi',
            phone: '08030000000', roles: ['general_user', 'marketplace_buyer'],
        });

        expect(await migrate()).toMatchObject({ success: true });

        const active = store.get(USERS, ACTIVE) as any;
        expect(active.firstName).toBe('Ada');
        expect(active.phone).toBe('08030000000');
        expect(active.roles).toEqual(expect.arrayContaining(['general_user', 'marketplace_buyer']));
        expect(active.supabaseAuthId).toBe(ACTIVE);
    });

    it.each(['admin', 'super_admin'])(
        'REFUSES TO GRANT %s FROM A LEGACY RECORD', async (role) => {
            store.seed(USERS, LEGACY, {
                email: 'ada@example.com', firstName: 'Ada',
                roles: ['general_user', role],
            });
            store.seed(USERS, ACTIVE, { email: 'ada@example.com', roles: ['general_user'] });

            await migrate();

            const active = store.get(USERS, ACTIVE) as any;
            expect(active.roles).not.toContain(role);
            // The ordinary role still carries across — a migration is supposed
            // to move the account.
            expect(active.roles).toContain('general_user');
        });

    it('refuses even when the active account has no roles at all', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com', roles: ['super_admin'] });

        await migrate();

        expect((store.get(USERS, ACTIVE) as any).roles ?? []).not.toContain('super_admin');
    });

    it('KEEPS a privileged role the active account already holds', async () => {
        // Not an escalation: this admin already is one. Migration must not
        // demote them either.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', roles: ['general_user'] });
        store.seed(USERS, ACTIVE, { email: 'ada@example.com', roles: ['admin'] });

        await migrate();

        expect((store.get(USERS, ACTIVE) as any).roles).toEqual(
            expect.arrayContaining(['admin', 'general_user']));
    });

    it('carries non-privileged module roles across', async () => {
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com', roles: ['general_user', 'seller', 'marketplace_buyer'],
        });

        await migrate();

        expect((store.get(USERS, ACTIVE) as any).roles).toEqual(
            expect.arrayContaining(['seller', 'marketplace_buyer']));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#174 — a stale legacy balance does not overwrite a live one', () => {
    it('KEEPS THE LIVE WALLET AND SAVINGS BALANCES', async () => {
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com',
            walletBalance: 0, savingsBalance: 0, loanBalance: 250_000,
        });
        store.seed(USERS, ACTIVE, {
            email: 'ada@example.com',
            walletBalance: 45_000, savingsBalance: 300_000, loanBalance: 0,
        });

        await migrate();

        const active = store.get(USERS, ACTIVE) as any;
        expect(active.walletBalance).toBe(45_000);
        expect(active.savingsBalance).toBe(300_000);
        expect(active.loanBalance).toBe(0);
    });

    it('takes the legacy balance when the active account has none', async () => {
        // The ordinary case: the Supabase account was just created at login and
        // holds nothing, so the legacy figures are the member's real ones.
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com', walletBalance: 12_000, savingsBalance: 80_000,
        });

        await migrate();

        const active = store.get(USERS, ACTIVE) as any;
        expect(active.walletBalance).toBe(12_000);
        expect(active.savingsBalance).toBe(80_000);
    });

    it('treats a live balance of zero as a real value, not a missing one', async () => {
        // A member who has spent their balance down to zero has a balance of
        // zero. `activeData[field] || legacy` would have quietly restored the
        // legacy figure and given them money back.
        store.seed(USERS, LEGACY, { email: 'ada@example.com', walletBalance: 99_000 });
        store.seed(USERS, ACTIVE, { email: 'ada@example.com', walletBalance: 0 });

        await migrate();

        expect((store.get(USERS, ACTIVE) as any).walletBalance).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#175 — the completion marker means the migration completed', () => {
    it('sets it once every collection has moved', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });

        await migrate();

        const active = store.get(USERS, ACTIVE) as any;
        expect(active._migratedAt).toBeTruthy();
        expect(active._legacyFirebaseUid).toBe(LEGACY);
    });

    it('DOES NOT SET IT WHEN A LATER STEP THROWS', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });
        store.seed(LOANS, 'loan-1', { memberId: LEGACY, amount: 100_000 });

        // Fail the loans update, which is step 3 of ten.
        const { supabaseDb } = await import('@/lib/supabase-db');
        const realCollection = supabaseDb.collection.bind(supabaseDb);
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation(((name: string) => {
            const col: any = realCollection(name);
            if (name === LOANS) {
                const realWhere = col.where.bind(col);
                col.where = (...a: any[]) => {
                    const q = realWhere(...a);
                    const realGet = q.get.bind(q);
                    q.get = async () => {
                        const snap = await realGet();
                        snap.docs.forEach((d: any) => {
                            d.ref.update = async () => { throw new Error('loans update exploded'); };
                        });
                        return snap;
                    };
                    return q;
                };
            }
            return col;
        }) as never);

        const res = await migrate();
        spy.mockRestore();

        expect(res.success).toBe(false);

        // The marker is absent, so the caller's `!_migratedAt && !_legacyFirebaseUid`
        // test still says "migrate me" and the next login retries.
        const active = store.get(USERS, ACTIVE) as any;
        expect(active?._migratedAt).toBeUndefined();
        expect(active?._legacyFirebaseUid).toBeUndefined();
    });

    it('is safe to run twice — the second pass finds nothing left to move', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com', firstName: 'Ada' });
        store.seed(LOANS, 'loan-1', { memberId: LEGACY, amount: 100_000 });
        store.seed(COOP_TX, 'tx-1', { userId: LEGACY, amount: 5_000 });

        expect(await migrate()).toMatchObject({ success: true });
        expect(await migrate()).toMatchObject({ success: true });

        expect(store.get(LOANS, 'loan-1')).toMatchObject({ memberId: ACTIVE });
        expect(store.get(COOP_TX, 'tx-1')).toMatchObject({ userId: ACTIVE });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what the migration actually moves', () => {
    /**
     * This ended `expect(store.get(MEMBERS, LEGACY)).toBeUndefined()` — the
     * source row destroyed once the copy was written.
     *
     * #303 keeps it. The copy is a set(..., { merge: true }) whose success this
     * code does not verify, the delete was fire-and-forget behind a .catch()
     * that only logged, and the whole thing runs unattended on LOGIN. A copy
     * that went wrong left nothing to go back to.
     *
     * The test below it — the generated-id branch — already asserted the source
     * being REPOINTED rather than deleted. The two branches simply disagreed;
     * they agree now.
     */
    it('re-keys the cooperative membership and MARKS the old row migrated', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });
        store.seed(MEMBERS, LEGACY, { userId: LEGACY, savingsBalance: 50_000, status: 'active' });

        await migrate();

        expect(store.get(MEMBERS, ACTIVE)).toMatchObject({
            userId: ACTIVE, id: ACTIVE, savingsBalance: 50_000,
        });

        const legacyRow = store.get(MEMBERS, LEGACY);
        expect(legacyRow).toBeDefined();
        // Still holds what it held, and now says where it went.
        expect(legacyRow?.savingsBalance).toBe(50_000);
        expect(legacyRow?._migratedTo).toBe(ACTIVE);
        expect(legacyRow?.retired).toBe(true);
    });

    it('finds a membership keyed by a generated id, and repoints it', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });
        store.seed(MEMBERS, 'generated-id', { userId: LEGACY, savingsBalance: 20_000 });

        await migrate();

        expect(store.get(MEMBERS, ACTIVE)).toMatchObject({ userId: ACTIVE });
        // The source row is repointed rather than deleted — its id is not the
        // legacy uid, so something else may reference it.
        expect(store.get(MEMBERS, 'generated-id')).toMatchObject({ userId: ACTIVE });
    });

    it('moves loans, transactions and the module applications', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });
        store.seed(LOANS, 'l1', { memberId: LEGACY });
        store.seed(COOP_TX, 't1', { userId: LEGACY });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', { userId: LEGACY });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1', { userId: LEGACY });
        store.seed('wave_applications', 'w1', { userId: LEGACY });
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'p1', { userId: LEGACY });
        store.seed('cooperative_fixed_savings', 's1', { memberId: LEGACY });
        store.seed('cooperative_withdrawals', 'wd1', { memberId: LEGACY });

        await migrate();

        expect(store.get(LOANS, 'l1')).toMatchObject({ memberId: ACTIVE, _legacyMemberId: LEGACY });
        expect(store.get(COOP_TX, 't1')).toMatchObject({ userId: ACTIVE });
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1')).toMatchObject({ userId: ACTIVE });
        expect(store.get(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1')).toMatchObject({ userId: ACTIVE });
        expect(store.get('wave_applications', 'w1')).toMatchObject({ userId: ACTIVE });
        expect(store.get(COLLECTIONS.PROCESSED_PAYMENTS, 'p1')).toMatchObject({ userId: ACTIVE });
        expect(store.get('cooperative_fixed_savings', 's1')).toMatchObject({ memberId: ACTIVE });
        expect(store.get('cooperative_withdrawals', 'wd1')).toMatchObject({ memberId: ACTIVE });
    });

    it('does not touch another member\'s rows', async () => {
        store.seed(USERS, LEGACY, { email: 'ada@example.com' });
        store.seed(LOANS, 'mine', { memberId: LEGACY });
        store.seed(LOANS, 'theirs', { memberId: 'somebody-else' });

        await migrate();

        expect(store.get(LOANS, 'theirs')).toMatchObject({ memberId: 'somebody-else' });
    });

    it('keeps the further-along module registration of the two', async () => {
        store.seed(USERS, LEGACY, {
            email: 'ada@example.com',
            serviceRegistrations: { academy: { status: 'approved', plan: 'elite' } },
        });
        store.seed(USERS, ACTIVE, {
            email: 'ada@example.com',
            serviceRegistrations: { academy: { status: 'pending' } },
        });

        await migrate();

        expect((store.get(USERS, ACTIVE) as any).serviceRegistrations.academy)
            .toMatchObject({ status: 'approved', plan: 'elite' });
    });

    it('refuses a no-op migration onto the same id', async () => {
        expect(await migrate(LEGACY, LEGACY)).toMatchObject({ success: true });
        expect(store.size(USERS)).toBe(0);
    });

    it('refuses when either id is missing', async () => {
        expect(await migrate('', ACTIVE)).toMatchObject({ success: true });
        expect(await migrate(LEGACY, '')).toMatchObject({ success: true });
        expect(store.size(USERS)).toBe(0);
    });

    it('completes for a legacy id with no user document, moving what it finds', async () => {
        store.seed(LOANS, 'l1', { memberId: LEGACY });

        expect(await migrate()).toMatchObject({ success: true });
        expect(store.get(LOANS, 'l1')).toMatchObject({ memberId: ACTIVE });
    });
});
