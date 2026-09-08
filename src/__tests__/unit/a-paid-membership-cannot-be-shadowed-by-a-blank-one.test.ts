/**
 * @jest-environment node
 */

/**
 *   #502 THE "ALREADY A MEMBER" CHECK COULD NOT SEE A PAID MEMBERSHIP.
 *
 *   joinCooperativeAction asked:
 *
 *       .where("userId", "==", userId).where("cooperativeId", "==", cooperativeId)
 *
 *   and `cooperativeId` is written by THAT FUNCTION AND NOTHING ELSE.
 *   registerCooperativeMemberAction — the paid path, the one members actually
 *   use — writes its row at `doc(userId)` and never sets the field at all.
 *
 *   So for a fully paid-up member the query matched nothing, and this endpoint
 *   created them a SECOND membership: auto-id, `membershipStatus: "pending"`,
 *   `paymentStatus: "pending"`, `savingsBalance: 0`.
 *
 * ── AND THE BLANK ROW WINS ──────────────────────────────────────────────────
 *
 *   latestApplication sorts newest-first, and it is what Layer 2.6 of
 *   module-access-check, the ID card, the dashboard and the money paths all use
 *   to choose between a member's rows. The new row is newer. So a member with a
 *   paid membership and a savings balance would open the dashboard and find
 *   themselves pending, at zero — their real record still in the database,
 *   shadowed by a blank one.
 *
 *   NO UI CALLS joinCooperativeAction. That is not protection, and this audit
 *   has now said so twice: every exported server action is a public endpoint
 *   addressable by its own id (#500, the account unlock). The function's own
 *   header already made that argument about the contribution amount; the
 *   membership check beneath it was written as though it had not.
 *
 * ── ASK THE QUESTION THE DOMAIN ACTUALLY HAS ────────────────────────────────
 *
 *   There is one cooperative here. The paid path keys its row by user id and
 *   records no cooperativeId, so "is this person already a member" is a question
 *   about the PERSON, not about a pairing. findCooperativeMemberRow is #488's
 *   shared reader — document id, then the userId field — and it does not depend
 *   on a field only one writer sets.
 *
 *   RECORDED, NOT CHANGED: `cooperatives.memberCount` is incremented by this
 *   function and nothing else, never decremented, and read by nothing. The
 *   admin screen's memberCount is a different number computed from the
 *   transaction ledger that happens to share a name. Left writing, and written
 *   down, because a stored number with no reader is what somebody eventually
 *   builds a dashboard on.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the membership check removed                   KILLED
 *     it reverted to the cooperativeId query         KILLED
 *     the refusal made a warning that falls through  KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const COOP = 'coop-main';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Not authenticated' } }
            : { session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
    store.seed(COLLECTIONS.COOPERATIVES, COOP, { name: 'Main Cooperative', memberCount: 4 });
});

const join = async (coopId = COOP, contribution = 0) =>
    (await (await import('@/app/actions/cooperative/_coop_registration'))
        .joinCooperativeAction(coopId, contribution)) as any;

const memberRows = () => store.all(MEMBERS).map(([id, doc]) => ({ id, ...(doc as any) }));

// ─────────────────────────────────────────────────────────────────────────────
describe('#502 — a paid membership cannot be shadowed by a blank one', () => {
    it('REFUSES WHEN THE PAID PATH ALREADY WROTE A MEMBERSHIP', async () => {
        //   THE test. The paid row is keyed by user id and carries NO
        //   cooperativeId, so the old two-field query saw nothing and created a
        //   second, blank membership on top of it.
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER,
            membershipStatus: 'active',
            paymentStatus: 'completed',
            savingsBalance: 250_000,
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await join()).toMatchObject({
            success: false,
            error: 'You are already a member of this cooperative',
        });
        expect(memberRows()).toHaveLength(1);
    });

    it('AND THE SAVINGS BALANCE IS UNTOUCHED', async () => {
        //   What the shadow actually cost: the newest row wins wherever
        //   latestApplication chooses, and the new one carries zero.
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER,
            membershipStatus: 'active',
            paymentStatus: 'completed',
            savingsBalance: 250_000,
        });

        await join();

        expect(store.get(MEMBERS, MEMBER)!.savingsBalance).toBe(250_000);
    });

    it('AND A ROW FOUND ONLY BY ITS userId FIELD ALSO COUNTS', async () => {
        //   The second strategy of #488's reader. A membership under an
        //   auto-generated id — which is what THIS function creates — has to be
        //   seen too, or calling it twice duplicates.
        store.seed(MEMBERS, 'auto-generated-id', {
            userId: MEMBER,
            membershipStatus: 'pending',
            paymentStatus: 'pending',
        });

        expect((await join()).success).toBe(false);
        expect(memberRows()).toHaveLength(1);
    });

    it('AND CALLING IT TWICE CREATES ONE MEMBERSHIP, NOT TWO', async () => {
        //   The duplicate this endpoint could produce on its own, without any
        //   paid row in the picture.
        expect((await join()).success).toBe(true);
        expect((await join()).success).toBe(false);

        expect(memberRows().filter(r => r.userId === MEMBER)).toHaveLength(1);
    });

    it('A GENUINELY NEW MEMBER STILL JOINS — the refusal is a check, not a wall', async () => {
        //   The vacuity guard. A change that refused everybody would satisfy
        //   every assertion above.
        const res = await join();

        expect(res.success).toBe(true);
        const rows = memberRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            userId: MEMBER,
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            savingsBalance: 0,
        });
    });

    it('and the membership it creates is still pending, never active', async () => {
        //   An earlier finding wrote this row as `status: "active"` with no fee,
        //   no onboarding and no admin. Pinned so the fix above cannot be
        //   reintroduced alongside it.
        await join();

        expect(memberRows()[0]).toMatchObject({ status: 'pending', onboardingCompleted: false });
    });

    it('and an initial contribution is still refused', async () => {
        //   The other guard already on this function: joining moves no money.
        expect(await join(COOP, 50_000)).toMatchObject({ success: false });
        expect(memberRows()).toHaveLength(0);
    });

    it('and an unknown cooperative is still refused', async () => {
        expect(await join('no-such-coop')).toMatchObject({
            success: false, error: 'Cooperative not found',
        });
    });
});
