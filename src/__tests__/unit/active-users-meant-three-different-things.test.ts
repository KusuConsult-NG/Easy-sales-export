/**
 * @jest-environment node
 */

/**
 *   #518 "ACTIVE USERS" MEANT SOMETHING DIFFERENT IN EVERY PLACE IT WAS ASKED,
 *        AND ONE OF THEM WAS COMPUTED FROM A FIELD NOBODY WRITES.
 *
 *   getPlatformHealthMetrics computed
 *
 *       activeUsers = totalUsers − (users where status == "suspended")
 *
 *   NOTHING WRITES THAT FIELD. The only `status: "suspended"` write anywhere in
 *   the codebase is on a seller VERIFICATION record
 *   (api/admin/marketplace/suspend-seller/route.ts); account suspension is
 *   auth-revocation.ts setting `disabled` on the auth account. Every other
 *   "suspended" in the tree is a module-scoped membership or registration
 *   status. So the subtrahend was always zero and `activeUsers` was
 *   `totalUsers` — all 42,160 accounts, reported as active.
 *
 * ── THE SAME DEFECT IS DOCUMENTED ONE LINE BELOW IT ─────────────────────────
 *
 *   The third query in that same Promise.all carries this comment:
 *
 *       "'locked' is not an escrow status and never was. The string appears
 *        exactly once in this codebase — here, in this query — so
 *        `activeEscrows` has always read 0, whatever was actually held."
 *
 *   Whoever found that fixed the escrow line and left the line directly above
 *   it, which had the identical shape for the identical reason. This audit's
 *   most repeated finding is a fix reaching one of N doors; here the two doors
 *   were adjacent elements of one array.
 *
 * ── AND IT WAS A THIRD SPELLING OF THE QUESTION ─────────────────────────────
 *
 *   lib/recent-activity.ts exists to settle "was this account active?", and its
 *   header argues the key deliberately — updatedAt is a native column, every
 *   write touches it, nothing writes lastLoginAt. getDashboardStats applies that
 *   rule (spelling out the 30 by hand). getPlatformHealthMetrics answered a
 *   different question under the same label, so two admin surfaces could report
 *   "Active Users" an order of magnitude apart and both look authoritative.
 *
 *   One rule now, read from RECENT_ACTIVITY_DAYS in both places.
 *
 * ── SAID AT ITS SIZE: NOTHING CALLS THIS METHOD ─────────────────────────────
 *
 *   No page, no action, no component. It is on the exported
 *   AnalyticsServiceContract, so it is one call from being live, and #513's
 *   reasoning applies — code that is one step from serving must not be left in
 *   the state it was found in. But this is a latent wrong number, not one an
 *   admin is reading today, and saying otherwise would be a bigger claim than
 *   the evidence supports.
 *
 * ── THE CATCH FABRICATED, AND STAMPED THE FABRICATION AS FRESH ──────────────
 *
 *   It returned three zeros AND `lastCalculatedAt: new Date().toISOString()`.
 *   That is the worst version of the shape #514, #516 and #517 each found: not
 *   merely a failed read rendered as an answer, but one carrying a timestamp
 *   asserting it had just been measured.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     activeUsers back to totalUsers − suspended      KILLED
 *     the activity window widened to 90 days          KILLED
 *     the escrow filter back to "locked"              KILLED
 *     the catch fabricating silently again            KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { RECENT_ACTIVITY_DAYS } from '@/lib/recent-activity';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const health = async () => {
    const { AnalyticsService } = await import('@/services/analytics.service');
    return (await AnalyticsService.getPlatformHealthMetrics()) as any;
};

const code = () => stripComments(
    readFileSync('src/services/analytics.service.ts', 'utf-8'),
    { label: 'analytics.service.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#518 — active means active', () => {
    it('A DORMANT ACCOUNT IS NOT COUNTED AS ACTIVE', async () => {
        //   THE test. `totalUsers − suspended` counted every account ever
        //   created, because nothing writes that status.
        store.seed(COLLECTIONS.USERS, 'fresh', { updatedAt: daysAgo(2) });
        store.seed(COLLECTIONS.USERS, 'dormant', { updatedAt: daysAgo(400) });

        const res = await health();

        expect(res.totalUsers).toBe(2);
        expect(res.activeUsers).toBe(1);
    });

    it('AND A ROW MARKED status: "suspended" NO LONGER CHANGES THE ANSWER', async () => {
        //   The field the old arithmetic depended on. A row carrying it is
        //   active or not on the same evidence as any other row.
        store.seed(COLLECTIONS.USERS, 'a', { updatedAt: daysAgo(1), status: 'suspended' });
        store.seed(COLLECTIONS.USERS, 'b', { updatedAt: daysAgo(1) });

        expect((await health()).activeUsers).toBe(2);
    });

    it('AND THE WINDOW IS THE PLATFORM\'S, NOT A NUMBER TYPED HERE', async () => {
        //   Straddling the boundary: one inside RECENT_ACTIVITY_DAYS, one out.
        store.seed(COLLECTIONS.USERS, 'in', { updatedAt: daysAgo(RECENT_ACTIVITY_DAYS - 1) });
        store.seed(COLLECTIONS.USERS, 'out', { updatedAt: daysAgo(RECENT_ACTIVITY_DAYS + 5) });

        expect((await health()).activeUsers).toBe(1);
    });

    it('and both methods read the same constant', () => {
        //   The third spelling. getDashboardStats wrote the 30 out by hand.
        const body = code();

        expect(body).toContain('RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000');
        expect(body).toContain('activeSince.getDate() - RECENT_ACTIVITY_DAYS');
        expect(body).not.toMatch(/where\("status", "==", "suspended"\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#518 — the escrow figure its sibling comment already fixed', () => {
    it('A FUNDED ESCROW IS COUNTED', async () => {
        //   The control for the block: the sibling query was already correct and
        //   must stay correct through this change.
        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'e1', { status: 'funded', amount: 1000 });
        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'e2', { status: 'released', amount: 1000 });

        expect((await health()).activeEscrows).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#518 — a failed read is not an empty platform', () => {
    it('IT SAYS WHAT IT COULD NOT READ RATHER THAN REPORTING ZEROS', async () => {
        //   The catch returned three zeros AND a fresh lastCalculatedAt — a
        //   fabrication stamped as just measured.
        const g = globalThis as any;
        const real = g.mockFirestoreGet.getMockImplementation();
        g.mockFirestoreGet.mockImplementation(() =>
            Promise.reject(new Error('canceling statement due to statement timeout')));

        const res = await health();

        expect(res.unavailable).toEqual(['totalUsers', 'activeUsers', 'activeEscrows']);
        g.mockFirestoreGet.mockImplementation(real);
    });

    it('AND A HEALTHY READ NAMES NOTHING', async () => {
        //   The vacuity guard: always reporting everything unavailable would
        //   satisfy the assertion above and be useless.
        store.seed(COLLECTIONS.USERS, 'a', { updatedAt: daysAgo(1) });

        expect((await health()).unavailable).toBeUndefined();
    });

    it('and an empty platform is still reported as zeros without the marker', async () => {
        //   Zero users is a real answer, and it must stay distinguishable from
        //   "we could not count them" — which is the whole point.
        const res = await health();

        expect(res.totalUsers).toBe(0);
        expect(res.unavailable).toBeUndefined();
    });
});
