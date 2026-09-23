/**
 *   WHAT ONE ACADEMY PAGE COSTS THE DATABASE, COUNTED.
 *
 *   The user side of this platform has never been measured. "The entire app is
 *   still very slow" has been answered three times by reading code, and the
 *   thing reading code cannot see is the one that matters most here: latency on
 *   this platform is ROUND TRIPS, and the adapter has no request-scoped
 *   identity map, so the same row asked for twice is fetched twice.
 *
 *   Drawing /academy/courses runs four gates, in this order:
 *
 *       academy/(learner)/layout.tsx   checkModuleAccess
 *                                      checkAcademyPaymentStatusAction
 *       (learner)/courses/page.tsx     getMyAcademyStandingAction
 *       ModuleSidebar                  getMyLiveRoles
 *
 *   Each one opens by fetching the caller's user document. None of them knows
 *   the others exist — they are in four different modules, which is exactly why
 *   this survived review — and between them they need `roles`,
 *   `serviceRegistrations` and `legacyOnboardedBy`. The whole document comes
 *   back each time, KYC record included, over `select('*')`.
 *
 *   FOUR ROUND TRIPS FOR ONE ROW, before the page fetches a single course. And
 *   that is the BEST case: the learner here has paid and carries the flag, so
 *   the payment gate returns at its first source instead of walking the other
 *   four.
 *
 *   WHY THIS IS A CEILING AND NOT AN EQUALITY. Four is today's number, not a
 *   target. A change that makes it three should pass; a fifth reader must
 *   argue for itself here. The number is allowed to fall and not to rise.
 *
 *   THE REPAIR EXISTS NOW, AND THIS FILE STILL MEASURES FOUR. That is not a
 *   contradiction, it is what this file is for.
 *
 *   lib/current-user-doc is the request-scoped memo the Next.js docs for this
 *   version prescribe (a DAL memoised with React's `cache`), and it is wired
 *   into three of the four callers below. But React's `cache()` is a
 *   PASS-THROUGH outside a request scope, and jest is outside a request scope —
 *   so what this suite measures is the platform WITHOUT any request
 *   memoisation, which is exactly the baseline worth keeping. It is the number
 *   these gates cost when the memo cannot help them, and it must not grow.
 *
 *   the-same-row-fetched-once-a-request.test.ts measures the other number: it
 *   installs a real per-request memoiser and counts what a deployed request
 *   actually pays. Read the two together — this one is the floor under the
 *   repair, that one is the repair.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'learner-1';
const ROLES = ['general_user', 'academy_participant'];

/**
 * Today's cost of the four gates behind one academy page.
 *
 * Raising this is a decision, not a detail: it is one more HTTP call to
 * PostgREST on every page view of the module, for every learner.
 */
const READS_ALLOWED_PER_PAGE = 4;

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID,
        email: 'learner@example.test',
        roles: ROLES,
        isVerified: true,
        profileComplete: true,
        _migratedAt: '2026-01-01T00:00:00.000Z',
        serviceRegistrations: {
            academy: { status: 'active', paymentStatus: 'completed', plan: 'premium' },
        },
    });
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: 'learner@example.test', roles: ROLES } },
        error: null,
    }));
});

/** Run the four gates an academy page render runs, in the order it runs them. */
async function drawOneAcademyPage(): Promise<void> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    const { checkAcademyPaymentStatusAction } = await import('@/app/actions/academy/_payment');
    const { getMyAcademyStandingAction } = await import('@/app/actions/academy/_ac_catalog');
    const { getMyLiveRoles } = await import('@/app/actions/my-data');

    store.reads.length = 0;

    await checkModuleAccess(UID, ROLES as never, 'academy');
    await checkAcademyPaymentStatusAction();
    await getMyAcademyStandingAction();
    await getMyLiveRoles();
}

describe('the database cost of drawing one academy page', () => {
    it('DOES NOT GROW — four round trips is the ceiling, not the goal', async () => {
        await drawOneAcademyPage();

        expect(store.reads.length).toBeLessThanOrEqual(READS_ALLOWED_PER_PAGE);
    });

    it('IS THE SAME ROW EVERY TIME, which is the whole finding', async () => {
        await drawOneAcademyPage();

        const userRowReads = store.reads.filter(
            (r) => r.collection === COLLECTIONS.USERS && r.id === UID,
        );

        //   Not "some reads were of the user" — EVERY read this page made was
        //   the same single document, fetched again from scratch each time.
        expect(userRowReads.length).toBe(store.reads.length);
        expect(userRowReads.length).toBeGreaterThan(1);
    });

    it('counts a query as the round trip it is, not as free', async () => {
        //   Guards the meter itself. A `reads` log that only recorded keyed
        //   reads would report the cheapest half of the platform's work and
        //   call it the total — the vacuity this codebase keeps finding.
        const { supabaseDb } = await import('@/lib/supabase-db');
        store.reads.length = 0;

        await supabaseDb.collection(COLLECTIONS.USERS).where('roles', 'array-contains', 'x').get();

        expect(store.reads).toEqual([{ collection: COLLECTIONS.USERS, id: null }]);
    });
});
