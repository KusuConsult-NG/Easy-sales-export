/**
 * @jest-environment node
 */

/**
 *   THE userId SWEEP, TRANCHE 2 — THE GATE.
 *
 *   Tranche 1 resolved a member's own RECORDS across their profile rows: the
 *   listings, orders and applications filed under a profile they no longer
 *   sign in as. This is the same defect one layer up, where it decides
 *   whether they get in at all.
 *
 *   checkModuleAccess asked, six times over:
 *
 *       db.collection(X).where("userId", "==", userId)
 *
 *   with the id of the row the caller signed in as. A member whose profile
 *   was superseded — the `_migratedTo` population, 765 rows in production —
 *   has their application filed under the OLD id. The query returned
 *   nothing, and the function answered "no access".
 *
 * ── WHY IT IS WORSE HERE THAN ON A LISTING ──────────────────────────────────
 *
 *   A listing that misses shows an empty table and the member can tell
 *   something is wrong. This is the gate. It tells somebody who applied,
 *   paid and was approved that they have not applied — on every one of the
 *   six modules — and the only visible symptom is a door that will not open.
 *
 *   The SPLIT ACCOUNT log line says the same thing from the other side:
 *   "the other row(s) are not consulted, so any roles or registrations held
 *   only there are absent from this session."
 *
 * ── AND THE FAST PATH STILL COSTS NOTHING ───────────────────────────────────
 *
 *   Layer 1 returns on the JWT role before any of this runs — its own
 *   comment says that covers 99% of requests — so the resolution is lazy and
 *   computed at most once per call, past that point.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { UserRole } from '@/lib/types/roles';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function access(userId: string, roles: string[], app: string): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(userId, roles as UserRole[], app as never);
}

/** The row they sign in as today. */
const LIVE = 'live-profile';
/** The row their application was filed under, before the migration. */
const OLD = 'superseded-profile';

/**
 * One person, two rows: the old one points at the live one, which is exactly
 * what resolveOwnedIdentities walks backwards.
 */
function seedTheSameePersonTwice(): void {
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('a member whose application is filed under the profile they stopped using', () => {
    it('THE REPORTED DEFECT: the cooperative door opens for them', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1', {
            userId: OLD,
            membershipStatus: 'active',
            paymentStatus: 'completed',
            onboardingCompleted: true,
        });

        expect(await access(LIVE, [], 'cooperatives')).toBe(true);
    });

    it('and so does academy', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'academy')).toBe(true);
    });

    it('and WAVE', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'wave')).toBe(true);
    });

    it('and export', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'app-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'export')).toBe(true);
    });

    it('and farm nation', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'app-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'farm-nation')).toBe(true);
    });

    it('and the marketplace', async () => {
        seedTheSameePersonTwice();
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'ver-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'marketplace')).toBe(true);
    });
});

describe('and it did not become a skeleton key', () => {
    it('SOMEBODY ELSE’S APPLICATION STILL DOES NOT OPEN IT', async () => {
        //   THE control. Widening a lookup from one id to a SET is exactly how
        //   an ownership check becomes no check, so the stranger's row must
        //   still be refused — the resolution follows the pointer, it does not
        //   match on anything looser.
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.USERS, 'a-stranger', { email: 'someone-else@example.com' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: 'a-stranger', status: 'approved',
        });

        expect(await access(LIVE, [], 'academy')).toBe(false);
    });

    it('AND A ROW POINTING AT SOMEBODY ELSE IS NOT THEIRS EITHER', async () => {
        //   The sharper half: the old row exists and is superseded, but it
        //   points at a DIFFERENT live profile. Following the pointer answers
        //   correctly; matching on "is superseded" would not.
        store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
        store.seed(COLLECTIONS.USERS, OLD, { email: 'other@example.com', _migratedTo: 'someone-else' });
        store.seed(COLLECTIONS.USERS, 'someone-else', { email: 'other@example.com' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', { userId: OLD, status: 'approved' });

        expect(await access(LIVE, [], 'academy')).toBe(false);
    });

    it('AND A MEMBER WITH NO APPLICATION ANYWHERE IS STILL REFUSED', async () => {
        //   Vacuity guard: if the widening admitted everybody, every test
        //   above would pass on a function that always returns true.
        seedTheSameePersonTwice();

        expect(await access(LIVE, [], 'academy')).toBe(false);
    });
});

describe('the fast path is untouched', () => {
    it('a JWT role still grants access without reading anything', async () => {
        //   Layer 1 returns before the resolution is ever reached, which is
        //   what keeps this change off the 99% path.
        expect(await access(LIVE, ['wave_participant'], 'wave')).toBe(true);
        expect(store.size(COLLECTIONS.USERS)).toBe(0);
    });
});
