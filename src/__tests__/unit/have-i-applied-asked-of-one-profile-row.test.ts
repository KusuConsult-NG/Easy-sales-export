/**
 * @jest-environment node
 */

/**
 *   THE userId SWEEP, TRANCHE 3 — "HAVE I APPLIED?"
 *
 *   Tranche 1 resolved a member's own RECORDS; tranche 2 resolved the GATE.
 *   This is the question the member asks themselves: does the platform know
 *   I applied, paid, or enrolled?
 *
 *   Nine sites across six files each asked it of ONE profile row:
 *
 *       db.collection(X).where("userId", "==", session.user.id)
 *
 *   A member whose profile was superseded — 765 such rows in production —
 *   has the answer filed under the id they no longer sign in as. So the
 *   cooperative dashboard showed no membership, the ID card could not be
 *   issued, farm nation said they had never applied, the marketplace
 *   offered to start a verification they had already passed, and the
 *   academy forgot which lessons they had finished.
 *
 *   Each is now asked of the member's own profile ids, through the same
 *   filterByOwner tranches 1 and 2 established.
 *
 * ── WHAT THE CONTROLS ARE FOR ───────────────────────────────────────────────
 *
 *   Widening a lookup from one id to a SET is how an ownership check stops
 *   being one, so every surface below is paired with a stranger's record
 *   that must STILL be invisible — and with a superseded row pointing at
 *   somebody else's live profile, which is the case that separates
 *   "follows the pointer" from "matches anything superseded".
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

/** The row they sign in as today, and the one their record is filed under. */
const LIVE = 'live-profile';
const OLD = 'superseded-profile';

function actAs(id: string): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: 'member@example.com', name: 'Ada Obi', roles: ['user'] } },
        error: null,
    }));
}

/** One person, two rows — the old one points at the live one. */
function seedBothProfiles(): void {
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedBothProfiles();
    actAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the cooperative dashboard', () => {
    const dashboard = async () => {
        const { getDashboardDataAction } = await import('@/app/actions/cooperative/_dashboard');
        return await (getDashboardDataAction as any)();
    };

    it('THE REPORTED SHAPE: finds the membership filed under the other profile', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1', {
            userId: OLD, membershipStatus: 'active', paymentStatus: 'completed',
            savingsBalance: 5000, createdAt: '2025-03-04T00:00:00.000Z',
        });

        const res = await dashboard();

        expect(res.success).toBe(true);
        expect(res.data.membership).toMatchObject({ membershipStatus: 'active' });
    });

    it('AND A STRANGER’S MEMBERSHIP IS STILL NOT THEIRS', async () => {
        store.seed(COLLECTIONS.USERS, 'stranger', { email: 'other@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-2', {
            userId: 'stranger', membershipStatus: 'active', paymentStatus: 'completed',
        });

        const res = await dashboard();

        expect(res.data?.membership ?? null).toBeNull();
    });
});

describe('the cooperative ID card', () => {
    const card = async () => {
        const { getCooperativeMemberIdCardAction } =
            await import('@/app/actions/cooperative/_coop_identity');
        return await (getCooperativeMemberIdCardAction as any)();
    };

    it('is issued on the membership filed under the other profile', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1', {
            userId: OLD, email: 'member@example.com',
            firstName: 'Ada', lastName: 'Obi', gender: 'female', stateOfOrigin: 'Plateau',
            membershipStatus: 'active', paymentStatus: 'completed',
            createdAt: '2025-03-04T00:00:00.000Z',
        });

        expect((await card()).success).toBe(true);
    });

    it('AND A SUPERSEDED ROW POINTING AT SOMEBODY ELSE IS NOT CONSULTED', async () => {
        //   The sharp control: the row IS superseded, but at a different live
        //   profile. Following the pointer answers correctly; matching on
        //   "is superseded" would hand this member somebody else's card.
        store.seed(COLLECTIONS.USERS, 'other-old', {
            email: 'other@example.com', _migratedTo: 'someone-else',
        });
        store.seed(COLLECTIONS.USERS, 'someone-else', { email: 'other@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-2', {
            userId: 'other-old', email: 'other@example.com',
            firstName: 'Ngozi', lastName: 'Eledumare',
            membershipStatus: 'active', paymentStatus: 'completed',
        });

        expect((await card()).success).toBe(false);
    });
});

describe('farm nation — have I applied', () => {
    const status = async () => {
        const mod: any = await import('@/app/actions/farm-nation/_fn_onboarding');
        const fn = mod.checkFarmNationStatusAction ?? mod.checkFarmNationStatus;
        return await fn();
    };

    it('sees the application filed under the other profile', async () => {
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'app-1', {
            userId: OLD, status: 'approved', createdAt: '2025-03-04T00:00:00.000Z',
        });

        const res = await status();

        expect(JSON.stringify(res)).toContain('approved');
    });

    it('AND NOT A STRANGER’S', async () => {
        store.seed(COLLECTIONS.USERS, 'stranger', { email: 'other@example.com' });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'app-2', {
            userId: 'stranger', status: 'approved',
        });

        const res = await status();

        expect(JSON.stringify(res)).not.toContain('"status":"approved"');
    });
});

describe('the academy — which lessons did I finish', () => {
    /**
     * Exercised through the resolution + filter pair the call site uses,
     * because completedLessonIds is a module-private helper. The assertion
     * that matters is the one the defect was about: the OLD id is in the set
     * the query is built from, so progress recorded there is counted.
     */
    const readProgress = async () => {
        const { ownedProfileIdsFor, filterByOwner } = await import('@/lib/owned-profile-ids');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const ids = await ownedProfileIdsFor(LIVE);
        const snap = await filterByOwner(
            supabaseDb.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS) as any, 'userId', ids,
        ).where('courseId', '==', 'c-1').get();
        return { ids, rows: snap.docs.length };
    };

    it('counts progress recorded under the other profile', async () => {
        store.seed(COLLECTIONS.LESSON_VIDEO_PROGRESS, 'p-1', {
            userId: OLD, courseId: 'c-1', lessonId: 'l-1', completed: true,
        });

        const { ids, rows } = await readProgress();

        expect(ids).toContain(OLD);
        expect(rows).toBe(1);
    });

    it('AND NOT A STRANGER\u2019S PROGRESS', async () => {
        store.seed(COLLECTIONS.USERS, 'stranger', { email: 'other@example.com' });
        store.seed(COLLECTIONS.LESSON_VIDEO_PROGRESS, 'p-2', {
            userId: 'stranger', courseId: 'c-1', lessonId: 'l-1', completed: true,
        });

        const { ids, rows } = await readProgress();

        expect(ids).not.toContain('stranger');
        expect(rows).toBe(0);
    });
});
