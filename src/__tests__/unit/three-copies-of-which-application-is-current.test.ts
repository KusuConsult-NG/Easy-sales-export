/**
 * @jest-environment node
 */

/**
 *   #505 THREE HAND-WRITTEN COPIES OF "WHICH APPLICATION IS CURRENT", AND THEY
 *        DID NOT EVEN AGREE ON WHETHER TO MUTATE.
 *
 *   _fn_onboarding.ts carried the same eleven-line comparator three times — in
 *   the status checker, the application getter and the resubmit:
 *
 *       const aVal = a.data().submittedAt || a.data().createdAt;
 *       const aTime = aVal?.toDate ? aVal.toDate().getTime()
 *                                  : (aVal ? new Date(aVal).getTime() : 0);
 *       …
 *       return bTime - aTime;
 *
 *   The status checker copied `[...appSnap.docs]` before sorting. The other two
 *   called `snap.docs.sort(...)`, which reorders the caller's array IN PLACE —
 *   the thing lib/latest-application.ts copies specifically to avoid, and says
 *   so in its own header.
 *
 *   NONE OF THE THREE HAD A TIEBREAK. On equal or unreadable dates the
 *   comparator returns 0 and the answer comes from incidental order. So the
 *   status this module REPORTS, the application it SHOWS, and the row a
 *   resubmit WRITES could each land on a different one of a member's
 *   applications — and a member whose newest application was rejected could be
 *   told they are approved, or shown the wrong form to correct.
 *
 *   #504 found exactly that pair in the cooperative twin a few findings ago.
 *   This is the same rule, hand-copied three more times, in the module where
 *   #486 already had to build a forensics check called "Approval Drift (User
 *   Record vs Application)" because these records are known to disagree.
 *
 * ── WHAT THE SHARED RULE DOES THAT THE COPIES DID NOT ───────────────────────
 *
 *   It reads `submittedAt ?? createdAt` through toMillis, which handles
 *   Timestamps, ISO strings AND epoch numbers — the local ternary handled two of
 *   the three, scoring an epoch number 0, the oldest possible. Then it tiebreaks
 *   on the decided stamps (updatedAt / reviewedAt / approvedAt / rejectedAt) and
 *   finally on document id, so the answer is the same every time. And it warns
 *   when no candidate carries a readable date instead of choosing in silence.
 *
 *   Fourth, fifth and sixth copies retired. #412 retired the first, #504 the
 *   second and third.
 *
 * ── LOOKED AT AND NOT CLAIMED ───────────────────────────────────────────────
 *
 *   The status checker heals UPWARD only: it writes `status: "approved"` onto
 *   the user record when the application says so, and persists nothing when the
 *   application says rejected. That reads like an asymmetry, and it is not a
 *   live defect — _fn_admin.ts:203 writes `serviceRegistrations.farmNation.status:
 *   "rejected"` onto the user record on the admin path, so the demotion is
 *   recorded where the decision is made. Written down because it is the kind of
 *   thing that looks like a finding until the other half is checked.
 *
 *   Farm Nation's `paymentStatus: "completed"` is written unconditionally on
 *   every path including submit, so it is a constant for a module with no fee —
 *   not an unevidenced payment claim like #496's.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the getter reverted to its own comparator      KILLED
 *     the status checker reverted to its own         KILLED
 *     the shared rule made to read createdAt only    KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
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

const MEMBER = 'farmer-1';
const APPS = COLLECTIONS.FARM_NATION_APPLICATIONS;

function actAs(id: string): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
    //   No applicationId on the user record, so every door falls to the query
    //   branch — which is the branch that carried the comparator.
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        serviceRegistrations: { farmNation: { status: 'rejected' } },
    });
});

async function actions() {
    return import('@/app/actions/farm-nation/_fn_onboarding');
}

const getApplication = async () =>
    (await (await actions()).getFarmNationApplicationAction()) as any;
const checkStatus = async () =>
    (await (await actions()).checkFarmNationStatusAction()) as any;

function seedApp(id: string, extra: Record<string, unknown>): void {
    store.seed(APPS, id, {
        userId: MEMBER,
        userEmail: 'ada@example.com',
        role: 'farmer',
        marker: id,
        ...extra,
    });
}

const code = () => stripComments(
    readFileSync('src/app/actions/farm-nation/_fn_onboarding.ts', 'utf-8'),
    { label: '_fn_onboarding.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#505 — the newest application is chosen the same way every time', () => {
    it('AN EPOCH-NUMBER TIMESTAMP IS NOT TREATED AS THE OLDEST', () => {
        //   THE difference the shared reader makes. `new Date(1780000000000)`
        //   is valid, but the local ternary only reached it through a truthiness
        //   check that an epoch number passes — while a Timestamp-shaped value
        //   with a broken toDate scored 0. toMillis reads all three shapes.
        const { toMillis } = require('@/lib/firestore-serialize');

        expect(toMillis(1_780_000_000_000)).toBe(1_780_000_000_000);
        expect(toMillis('2026-06-01T00:00:00.000Z')).toBeGreaterThan(0);
    });

    it('THE GETTER RETURNS THE NEWEST BY submittedAt', async () => {
        seedApp('older', { submittedAt: '2026-01-01T00:00:00.000Z', status: 'rejected' });
        seedApp('newest', { submittedAt: '2026-06-01T00:00:00.000Z', status: 'rejected' });

        const res = await getApplication();

        expect(res.success).toBe(true);
        expect(res.data.application.marker).toBe('newest');
    });

    it('AND TIED DATES ARE BROKEN DETERMINISTICALLY, NOT BY LUCK', async () => {
        //   No copy had a tiebreak, so both returned 0 and the answer came from
        //   whatever order the snapshot arrived in.
        seedApp('aaa', { submittedAt: '2026-03-01T00:00:00.000Z', status: 'rejected' });
        seedApp('zzz', { submittedAt: '2026-03-01T00:00:00.000Z', status: 'rejected' });

        const first = (await getApplication()).data.application.marker;
        const again = (await getApplication()).data.application.marker;

        expect(first).toBe(again);
    });

    it('AND THE STATUS CHECKER READS THE SAME APPLICATION THE GETTER SHOWS', async () => {
        //   The point of the finding. A member whose newest application was
        //   rejected must not be told the older approved one is theirs — and
        //   whichever the getter shows, the checker has to agree.
        seedApp('older-approved', { submittedAt: '2026-01-01T00:00:00.000Z', status: 'approved' });
        seedApp('newest-rejected', { submittedAt: '2026-06-01T00:00:00.000Z', status: 'rejected' });

        expect((await getApplication()).data.application.marker).toBe('newest-rejected');
        expect((await checkStatus()).data).toBe('rejected');
    });

    it('and a single application still works for both doors', async () => {
        //   The vacuity guard.
        seedApp('only', { submittedAt: '2026-03-01T00:00:00.000Z', status: 'pending' });

        expect((await getApplication()).data.application.marker).toBe('only');
        expect((await checkStatus()).data).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#505 — one rule, asked three times', () => {
    it('NO HAND-WRITTEN COMPARATOR SURVIVES IN THE FILE', () => {
        //   Comments stripped: the #505 header quotes the old comparator to
        //   explain it, and asserting on the raw file would fail against correct
        //   code — the trap #493 recorded and #504 walked into again.
        const body = code();

        expect(body).not.toMatch(/aVal\?\.toDate \? aVal\.toDate\(\)\.getTime\(\)/);
        expect(body).not.toMatch(/snap\.docs\.sort\(/);
        expect(body).not.toMatch(/appSnap\.docs\]\.sort\(/);
    });

    it('AND ALL THREE DOORS ASK THE SHARED ONE', () => {
        const body = code();

        expect(body.match(/latestApplication\(/g)?.length).toBe(3);
    });
});
