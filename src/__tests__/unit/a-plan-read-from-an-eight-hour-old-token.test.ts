/**
 * @jest-environment node
 */

/**
 * A plan read from an eight-hour-old token.
 *
 *   THE OWNER: "why are these course asking users to buy after they are
 *   approved by admin? They are supposed to be accessible to users after they
 *   paid and approved by admin."
 *
 *   The catalogue decided tier access from a JWT claim:
 *
 *       const userPlan = (session?.user as any)
 *           ?.serviceRegistrations?.academy?.plan || "free";
 *
 *   auth.config.ts issues stateless JWTs with an 8-hour maxAge, so that is a
 *   snapshot from login. A learner who pays, or whom an admin approves, keeps
 *   the stale one; `checkCourseAccess` default-denies a plan it does not
 *   recognise, and every tiered course rendered "Buy for NGN x" at somebody who
 *   had already bought it.
 *
 *   #460 FOUND THIS EXACT DEFECT one module over and wrote down that the
 *   pattern was already swept out of fifteen API routes, "Academy was missed by
 *   all of it, in two verbatim copies". It repaired the enrolment path. The
 *   catalogue is the third copy — and the one the learner looks at.
 *
 *   The server page now reads the standing LIVE, joining two reads it was
 *   already making in parallel, so it costs no extra round trip.
 *
 * WHAT THIS ASSERTS, AND WHY IT IS THE ACTION AND NOT THE COMPONENT.
 *
 *   The component is a large client tree whose rendering needs a session, a
 *   router and a toast provider. The thing that was WRONG is where the number
 *   comes from, so the test runs the real action against a real document and
 *   feeds its answer to the real access rule — the two halves that decide what
 *   the learner sees.
 *
 *   Verified by mutation: returning a hardcoded "free" plan from the action
 *   fails the first two tests.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { checkCourseAccess } from '@/lib/academy-plan';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;
const LEARNER = 'learner-1';

function actAs(id: string | null): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles: ['academy_participant'], email: 'ada@example.com' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

async function standing() {
    const { getMyAcademyStandingAction } = await import('@/app/actions/academy/_ac_catalog');
    return getMyAcademyStandingAction();
}

/** What the stale token said at login, for contrast. */
const CLAIM_AT_LOGIN = 'free';

describe('a plan read from an eight-hour-old token', () => {
    it('AN ELITE LEARNER READS AS ELITE, however old their token is', async () => {
        store.seed(COLLECTIONS.USERS, LEARNER, {
            email: 'ada@example.com',
            serviceRegistrations: { academy: { plan: 'elite', status: 'approved' } },
        });

        const res = await standing();
        expect(res.success).toBe(true);
        expect(res.data?.plan).toBe('elite');

        //   The claim would have denied all three tiers. The document opens them.
        expect(checkCourseAccess(CLAIM_AT_LOGIN, 'elite')).toBe(false);
        expect(checkCourseAccess(res.data!.plan, 'elite')).toBe(true);
        expect(checkCourseAccess(res.data!.plan, 'standard')).toBe(true);
        expect(checkCourseAccess(res.data!.plan, 'foundation')).toBe(true);
    });

    it('A FOUNDATION LEARNER OPENS FOUNDATION AND NOT ELITE', async () => {
        store.seed(COLLECTIONS.USERS, LEARNER, {
            email: 'ada@example.com',
            serviceRegistrations: { academy: { plan: 'foundation', status: 'approved' } },
        });

        const { data } = await standing();

        expect(checkCourseAccess(data!.plan, 'foundation')).toBe(true);
        expect(checkCourseAccess(data!.plan, 'elite')).toBe(false);
    });

    it('THE ADMIN DECISION COMES BACK TOO — "paid AND approved by admin"', async () => {
        store.seed(COLLECTIONS.USERS, LEARNER, {
            email: 'ada@example.com',
            serviceRegistrations: { academy: { plan: 'standard', status: 'approved' } },
        });

        const { data } = await standing();
        expect(data).toEqual({ plan: 'standard', status: 'approved' });
    });

    it('A LEARNER WITH NO REGISTRATION READS AS free, not as undefined', async () => {
        store.seed(COLLECTIONS.USERS, LEARNER, { email: 'ada@example.com' });

        const { data } = await standing();
        expect(data).toEqual({ plan: 'free', status: '' });
        expect(checkCourseAccess(data!.plan, 'foundation')).toBe(false);
    });

    it('A SIGNED-OUT VISITOR IS NOT AN ERROR — the catalogue is public', async () => {
        actAs(null);

        const res = await standing();
        expect(res.success).toBe(true);
        expect(res.data).toBeNull();
    });

    it('A FREE COURSE IS OPEN TO EVERYBODY, signed in or not', () => {
        expect(checkCourseAccess('free', 'free')).toBe(true);
        expect(checkCourseAccess(null, '')).toBe(true);
    });
});
