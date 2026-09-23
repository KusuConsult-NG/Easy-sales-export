/**
 *   WHAT ONE WAVE PAGE COSTS THE DATABASE, AFTER THE THIRD ANSWER TO "IT IS
 *   STILL SLOW" — AND WHY THE ANSWER IS NOT `Promise.all`.
 *
 *   #261 built a read meter because the user side had never been measured, and
 *   one-page-four-reads-of-the-same-row.test.ts recorded what it found. This is
 *   the repair, measured the same way and pinned to a number.
 *
 *   THE HARNESS IS THE POINT, SO IT IS STATED FIRST. React's `cache()` is a
 *   PASS-THROUGH outside a request scope, and jest is outside a request scope.
 *   A suite that ran the gates as-is would therefore measure a platform with no
 *   request memoisation at all — neither this repair's, nor `ownedProfileIds`'s,
 *   which has been there since #904 — and report a number production never
 *   pays. So `cache` is replaced below with a real per-request memoiser. Every
 *   count in this file is the count a deployed request makes.
 *
 * ── WHAT THE MEASUREMENT ACTUALLY SAID ──────────────────────────────────────
 *
 *   Drawing /wave/application for an applicant who has not been approved — the
 *   commonest visitor to that screen, and the one the owner's [slow-action] log
 *   shows at 1.7-3.6s:
 *
 *       before   14 reads, 12 sequential round trips
 *       after     9 reads,  8 sequential round trips
 *
 *   THE PLAN THAT MEASUREMENT KILLED was "parallelise the independent gate
 *   reads". Almost none of them are independent: identity resolves before owned
 *   ids, owned ids before the owner-scoped query, and that query before the
 *   email fallback. Each genuinely needs the one before it, and `Promise.all`
 *   over a chain like that either changes nothing or buys latency by issuing
 *   queries the answer may not need.
 *
 *   What the meter showed instead was reads that were not independent but
 *   REDUNDANT, which is strictly better news:
 *
 *     1. checkModuleAccess read the caller's user row, and then resolved that
 *        caller's identity with `ownedProfileIdsFor` — whose first hop reads
 *        the same row again. It now answers that hop from the document it is
 *        already holding, and only walks for a row that is genuinely
 *        superseded.
 *
 *     2. The same call then used a DIFFERENT memoised entry point from the one
 *        the status action uses, so the two-query identity search ran twice per
 *        page. Both now go through `ownedProfileIds`, so the request pays once.
 *
 *     3. checkWaveStatusAction's legacy fallback re-asked `userId == <live id>`
 *        after the function had already asked `userId IN <every id this person
 *        owns>` — a strict superset. When the superset was empty and nothing
 *        was claimed since, the subset cannot hold anything.
 *
 *     4. The user row itself, fetched by four callers that do not know each
 *        other exists, now comes from a request-scoped memo.
 *
 * ── AND THE SAFETY PROPERTY, WHICH MATTERS MORE THAN THE NUMBER ─────────────
 *
 *   A memo of a row that gets WRITTEN mid-request is #258 again: a gate
 *   answering from a document that was true a moment ago. The invariant that
 *   makes it safe is not "these callers happen to run in this order" — it is
 *   that every writer of the row already clears the 300-second profile cache,
 *   and that clear now drops the request memo too. That is asserted here
 *   directly, not inferred.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

//   A REAL PER-REQUEST MEMOISER. See the header: without this the suite
//   measures a platform that has none, which is not the one that is deployed.
jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'applicant-1';
const EMAIL = 'applicant@example.test';
const ROLES = ['general_user'];

/**
 * Today's cost of drawing /wave/application for an unapproved applicant.
 *
 * It was 14. Raising it is a decision, not a detail: it is one more HTTP call
 * to PostgREST on every view of the slowest screen on the platform.
 */
const READS_ALLOWED_PER_WAVE_PAGE = 9;

let store: FakeDbHandle;

/** A fresh module registry is a fresh REQUEST — the memoisers above reset with it. */
function startARequest(): void {
    jest.resetModules();
}

function seedApplicant(extra: Record<string, any> = {}): void {
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID,
        email: EMAIL,
        roles: ROLES,
        isVerified: true,
        profileComplete: true,
        serviceRegistrations: {},
        ...extra,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedApplicant();
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: EMAIL, roles: ROLES } },
        error: null,
    }));
    startARequest();
});

/** The three gates one WAVE page render runs, in the order it runs them. */
async function drawOneWavePage(): Promise<void> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    const { checkWaveStatusAction } = await import('@/app/actions/wave/_wv_membership');
    const { getMyLiveRoles } = await import('@/app/actions/my-data');

    store.reads.length = 0;

    await checkModuleAccess(UID, ROLES as never, 'wave');
    await checkWaveStatusAction();
    await getMyLiveRoles();
}

describe('the database cost of drawing one WAVE page', () => {
    it('DOES NOT GROW — nine reads is the ceiling, down from fourteen', async () => {
        await drawOneWavePage();

        expect(store.reads.length).toBeLessThanOrEqual(READS_ALLOWED_PER_WAVE_PAGE);
    });

    it('fetches the caller\'s user row TWICE, not four times', async () => {
        await drawOneWavePage();

        const ownRow = store.reads.filter(
            (r) => r.collection === COLLECTIONS.USERS && r.id === UID,
        );

        //   TWO, AND NOT ONE, ON PURPOSE. checkModuleAccess keeps its own read:
        //   it goes through getAdminDb() and it writes the row it reads, and a
        //   memo shared between a privileged client and an ordinary one is a
        //   question nobody should have to answer at a gate. It is the layout's
        //   first call anyway, so it would be the entry's author rather than
        //   its beneficiary. The other three callers now share one read.
        expect(ownRow.length).toBe(2);
    });

    it('asks the applications collection only what it has not already asked', async () => {
        //   The owner query and the userEmail fallback. The third — `userId ==`
        //   after `userId IN`, a subset of a set already known to be empty — is
        //   the one this stopped asking.
        const { checkWaveStatusAction } = await import('@/app/actions/wave/_wv_membership');
        store.reads.length = 0;

        const result = await checkWaveStatusAction();

        const appReads = store.reads.filter((r) => r.collection === COLLECTIONS.WAVE_APPLICATIONS);
        expect(appReads.length).toBeLessThanOrEqual(2);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toEqual({ error: null, success: true, data: { status: null } });
    });

    it('STILL RUNS the legacy fallback when there is an application it could explain', async () => {
        //   An application with no `status` at all is the shape that fallback
        //   exists for, and it must not be skipped: the skip is only ever taken
        //   when the superset query came back empty AND nothing was claimed.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-no-status', {
            userId: UID, userEmail: EMAIL, createdAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkWaveStatusAction } = await import('@/app/actions/wave/_wv_membership');

        const result = await checkWaveStatusAction();

        expect(result).toEqual({ error: null, success: true, data: { status: 'pending' } });
    });
});

describe('the identity walk a gate does not have to take', () => {
    it('answers the forward hop from the row it already read', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        store.reads.length = 0;

        await checkModuleAccess(UID, ROLES as never, 'wave');

        const ownRow = store.reads.filter(
            (r) => r.collection === COLLECTIONS.USERS && r.id === UID,
        );
        //   One, not two. The second was `ownedProfileIdsFor`'s first hop
        //   re-reading the document this function had just read.
        expect(ownRow.length).toBe(1);
    });

    it('STILL WALKS for a session whose profile has since been superseded', async () => {
        //   The reason the shortcut is a branch and not a deletion. Every
        //   caller passes session.user.id, which #490 makes live at sign-in —
        //   but a session minted BEFORE an admin settles a duplicate carries an
        //   id that has been superseded since, and this is a GATE.
        //   A DIFFERENT ADDRESS ON THE SUPERSEDED ROW, deliberately: otherwise
        //   the `userEmail` fallback below finds the application anyway and the
        //   test passes without the walk ever running. Measured — a first draft
        //   seeded the same address and survived the mutant that removes the
        //   walk entirely.
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id',
            email: 'old-address@example.test',
            roles: ROLES,
            _migratedTo: UID,
            serviceRegistrations: {},
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-live', {
            userId: UID, userEmail: EMAIL, status: 'approved',
            createdAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:00:00.000Z',
        });

        const { checkModuleAccess } = await import('@/lib/module-access-check');

        //   The application is filed under the id that WON. Signing in as the
        //   one that lost must still reach it.
        await expect(checkModuleAccess('old-id', ROLES as never, 'wave')).resolves.toBe(true);
    });
});

describe('the memo and the write that has to survive it', () => {
    it('serves one read to two callers, and two reads to two ids', async () => {
        const { readUserDocOnce } = await import('@/lib/current-user-doc');
        store.seed(COLLECTIONS.USERS, 'other-1', { uid: 'other-1', email: 'o@example.test' });
        store.reads.length = 0;

        await readUserDocOnce(UID);
        await readUserDocOnce(UID);
        await readUserDocOnce('other-1');

        expect(store.reads).toEqual([
            { collection: COLLECTIONS.USERS, id: UID },
            { collection: COLLECTIONS.USERS, id: 'other-1' },
        ]);
    });

    it('shares ONE round trip between two callers racing for the same row', async () => {
        const { readUserDocOnce } = await import('@/lib/current-user-doc');
        store.reads.length = 0;

        //   Not awaited in turn — started together, which is the shape a layout
        //   and a sidebar rendering in parallel actually have.
        const [a, b] = await Promise.all([readUserDocOnce(UID), readUserDocOnce(UID)]);

        expect(store.reads.length).toBe(1);
        expect(a).toBe(b);
    });

    it('DOES NOT REMEMBER A FAILURE — one bad read is not the rest of the request', async () => {
        const { readUserDocOnce } = await import('@/lib/current-user-doc');

        const g = global as any;
        const working = g.mockFirestoreGet.getMockImplementation();
        g.mockFirestoreGet.mockImplementationOnce(() => Promise.reject(new Error('transient')));

        await expect(readUserDocOnce(UID)).rejects.toThrow('transient');

        g.mockFirestoreGet.mockImplementation(working);
        //   A cached rejection would make "could not read" the answer for every
        //   gate that ran afterwards, which on these callers reads as "no access".
        await expect(readUserDocOnce(UID)).resolves.toMatchObject({ exists: true });
    });

    it('IS DROPPED when the writer says the row has changed', async () => {
        const { readUserDocOnce, forgetUserDoc } = await import('@/lib/current-user-doc');

        await readUserDocOnce(UID);
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: [...ROLES, 'wave_participant'], serviceRegistrations: {},
        });

        //   Without the drop this still reads the copy taken before the write.
        forgetUserDoc(UID);

        await expect(readUserDocOnce(UID)).resolves.toMatchObject({
            data: { roles: [...ROLES, 'wave_participant'] },
        });
    });

    it('IS DROPPED BY EVERY FUNCTION THAT CLEARS THE PROFILE CACHE', () => {
        /*
         *   THE SAFETY INVARIANT, PINNED AT ITS SOURCE.
         *
         *   Read rather than called: lib/cache-invalidation imports
         *   @upstash/redis, which this jest configuration cannot parse, which
         *   is why the module is stubbed suite-wide in jest.setup.js. Calling
         *   the stub and asserting the result would be asserting the harness.
         *
         *   So the rule is checked where it lives. A FIFTH function that clears
         *   `CacheKeys.userProfile` and forgets this memo is caught here on the
         *   day it is written, which is the only moment anybody would notice.
         */
        const source = readFileSync(
            join(process.cwd(), 'src/lib/cache-invalidation.ts'), 'utf8');

        const bodies = source.split(/^export (?:async )?function /m).slice(1);
        const clearsProfile = bodies.filter((b) => b.includes('CacheKeys.userProfile('));

        expect(clearsProfile.length).toBeGreaterThanOrEqual(4);
        for (const body of clearsProfile) {
            expect(`${body.slice(0, body.indexOf('('))}: ${body.includes('forgetUserDoc(')}`)
                .toMatch(/: true$/);
        }
    });

    it('AND THE SUITE-WIDE STUB HONOURS THE SAME RULE', () => {
        //   900-odd suites reach these functions through a caller, and they all
        //   get the stub. A stub that stopped dropping the memo would make
        //   every one of them agree that a stale read is fine.
        const setup = readFileSync(join(process.cwd(), 'jest.setup.js'), 'utf8');
        const mockBlock = setup.slice(
            setup.indexOf("jest.mock('@/lib/cache-invalidation'"),
            setup.indexOf("// Mock Audit Log"));

        expect(mockBlock).toContain('forgetUserDoc');
    });

    it('SHOWS THE SIDEBAR A ROLE THE GATE GRANTED MID-RENDER', async () => {
        //   End to end, in the order that is actually dangerous: the sidebar
        //   reads first and memoises, the layout's gate then grants a role and
        //   writes it, and the sidebar re-reads. Nothing in Next guarantees the
        //   other order, so the memo must not be able to hide the grant.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-approved', {
            userId: UID, userEmail: EMAIL, status: 'approved',
            createdAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:00:00.000Z',
        });

        const { getMyLiveRoles } = await import('@/app/actions/my-data');
        const { checkModuleAccess } = await import('@/lib/module-access-check');

        expect(await getMyLiveRoles()).not.toContain('wave_participant');

        await expect(checkModuleAccess(UID, ROLES as never, 'wave')).resolves.toBe(true);

        expect(await getMyLiveRoles()).toContain('wave_participant');
    });
});
