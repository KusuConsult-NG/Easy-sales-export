/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the export one next."
 *
 *   AND EXPORT IS NOT IN THEIR LOG. Not one `[slow-action]` line across a
 *   whole session, while the other five module checks appear over and over:
 *
 *       checkWaveStatusAction ... checkAcademyStatusAction ...
 *       checkCooperativeStatusAction ... checkMarketplaceStatusAction ...
 *       checkFarmNationStatusAction ...
 *
 *   The reason is not that Export is fast. It is that
 *   `checkExportStatusAction` was a bare exported function while all five of
 *   those go through withFlexibleSafeAction, which is what produces the line.
 *   FIVE OF SIX MODULES COULD BE SEEN AND THE SIXTH COULD NOT — which reads
 *   as "Export is fine" and means "nobody looked".
 *
 *   An audit that has spent a day fixing what the log named would have kept
 *   skipping this one for as long as it stayed invisible.
 *
 * ── AND MEASURED, ONCE IT COULD BE ──────────────────────────────────────────
 *
 *   With lib/testing/read-depth, which counts how DEEP the chain of reads goes
 *   rather than how many there are:
 *
 *       nothing filed         5 reads, depth 4  ->  5 reads, depth 3
 *       approved on the row   1 read,  depth 1  ->  unchanged
 *       a filed application   4 reads, depth 3  ->  unchanged
 *
 *   NO CASE READS MORE THAN IT DID. #273 already took a read off the longest
 *   path; what was left there was a chain — the owner-scoped query, and then
 *   the by-address sweep if it came back empty, a round trip spent learning
 *   whether to spend the next.
 *
 *   The sweep is reachable only with no applicationId on the row and an
 *   address to sweep by, and submitting an application writes BOTH the status
 *   and the applicationId (_ex_onboarding.ts, the batch at the top). So an
 *   applicant pays nothing, the approved account never reaches the block, and
 *   the only record that pays is an application with nothing on the user row —
 *   the state the claiming branch exists to repair.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without this every figure below is measured against a platform
 *   with no request memoisation at all.
 */
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

const UID = 'exporter-1';
const EMAIL = 'exporter@example.test';
const APPS = COLLECTIONS.EXPORT_APPLICATIONS;

/** Today's cost of the Export check an applicant actually waits on. */
const CEILING = { reads: 5, depth: 3 };

let store: FakeDbHandle;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: EMAIL, roles: ['general_user'] } },
        error: null,
    }));
});

const exportActions = () => import('@/app/actions/export/_ex_onboarding');

describe('the sixth module check is timed like the other five', () => {
    it('GOES THROUGH withFlexibleSafeAction, or it never appears in a log again', () => {
        /*
         *   A source ratchet, because the wrapper cannot be observed from
         *   outside: it is transparent on success by design, which is the
         *   whole reason this was easy to leave off for so long.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/export/_ex_onboarding.ts'), 'utf8');

        expect(src).toContain('withFlexibleSafeAction(\n        "checkExportStatusAction", _checkExportStatusAction)()');
        //   The work itself is the INNER function, so nothing can reach it
        //   without passing the timer.
        expect(src).toMatch(/^async function _checkExportStatusAction\(/m);
    });

    it('AND STILL HANDS BACK A BARE STRING OR NULL, not an envelope', async () => {
        /*
         *   The contract three call sites depend on, one of which is a server
         *   component that feeds the value into `PENDING.includes(...)`. The
         *   wrapper's error branch is unreachable — the inner function catches
         *   everything and answers null — so mapping it back costs nothing and
         *   spares them a union they have no use for.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { export: { status: 'approved' } },
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).toBe('approved');
        expect(typeof result).toBe('string');
    });

    it('and answers null rather than an envelope when there is nothing', async () => {
        const { checkExportStatusAction } = await exportActions();

        expect(await checkExportStatusAction()).toBeNull();
    });
});

describe('what the Export check actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        //   THE CONTROL. Without it every ceiling below passes on any
        //   implementation at all.
        const g = global as any;

        const serial = measureReadDepth();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        expect({ reads: serial.reads, depth: serial.depth }).toEqual({ reads: 3, depth: 3 });

        const together = measureReadDepth();
        await Promise.all([g.mockFirestoreGet(), g.mockFirestoreGet(), g.mockFirestoreGet()]);
        expect({ reads: together.reads, depth: together.depth }).toEqual({ reads: 3, depth: 1 });
    });

    it('AN APPLICANT WITH NOTHING FILED WAITS THREE TIMES, not four', async () => {
        const { checkExportStatusAction } = await exportActions();
        const seen = measureReadDepth();

        const result = await checkExportStatusAction();

        expect(result).toBeNull();
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('THE APPROVED ACCOUNT STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { export: { status: 'approved' } },
        });
        const { checkExportStatusAction } = await exportActions();
        const seen = measureReadDepth();

        expect(await checkExportStatusAction()).toBe('approved');
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('AND AN APPLICANT WHO HAS FILED PAYS NOTHING EXTRA', async () => {
        //   Submitting writes both the status and the applicationId onto the
        //   row, so this account trips neither prefetch guard.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { export: { status: 'pending_approval', applicationId: 'app-1' } },
        });
        store.seed(APPS, 'app-1', {
            userId: UID, status: 'pending_review', createdAt: new Date().toISOString(),
        });
        const { checkExportStatusAction } = await exportActions();
        const seen = measureReadDepth();

        expect(await checkExportStatusAction()).toBe('pending_approval');
        expect(seen.reads).toBeLessThanOrEqual(4);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });
});

describe('the answer did not change, only the waiting', () => {
    it('still CLAIMS an unclaimed application at the applicant\'s own address', async () => {
        store.seed(APPS, 'unclaimed', {
            userEmail: EMAIL, status: 'pending_review', createdAt: new Date().toISOString(),
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).toBe('pending_approval');
        expect((store.get(APPS, 'unclaimed') as any)?.userId).toBe(UID);
    });

    it('STILL REFUSES one that already belongs to another account', async () => {
        /*
         *   The two defects this file's own header records — matching a field
         *   nobody authenticated as, and adopting an application that already
         *   had an owner. Issuing the query a round trip earlier must not move
         *   that rule one line: the branch below it writes `approved` onto the
         *   caller's user record, which module-access-check then reads.
         */
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else',
            userEmail: EMAIL,
            status: 'approved',
            createdAt: new Date().toISOString(),
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).not.toBe('approved');
        expect((store.get(APPS, 'theirs') as any)?.userId).toBe('somebody-else');
    });

    it('and does not sweep by address at all when the row names an application', async () => {
        /*
         *   The guard stated directly. The row carries an applicationId and
         *   the application carries no userId, so the owner-scoped query comes
         *   back empty and the NAMED branch is the one that wins — which is
         *   precisely when the by-address sweep must not have been issued.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { export: { applicationId: 'named' } },
        });
        store.seed(APPS, 'named', {
            userEmail: EMAIL, status: 'revision_required', createdAt: new Date().toISOString(),
        });
        const { checkExportStatusAction } = await exportActions();

        expect(await checkExportStatusAction()).toBe('revision_required');

        //   The named application was read by key...
        const keyed = store.reads.filter((r: any) => r.collection === APPS && r.id === 'named');
        expect(keyed).toHaveLength(1);
        //   ...and exactly one query ran against the collection: the
        //   owner-scoped one. A prefetched sweep would make it two.
        const queries = store.reads.filter((r: any) => r.collection === APPS && !r.id);
        expect(queries).toHaveLength(1);
    });
});
