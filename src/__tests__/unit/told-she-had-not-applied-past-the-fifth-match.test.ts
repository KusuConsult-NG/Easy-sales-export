/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the wave one next."
 *
 *       checkWaveStatusAction took 937ms  1179ms  1308ms  1313ms  1322ms
 *                                1335ms  1342ms  1435ms  1492ms  1665ms
 *                                1703ms  1991ms  2155ms  2567ms
 *
 *   Fourteen lines in one session — the most frequent module check in the
 *   owner's log. Measured with lib/testing/read-depth: 5 reads, depth 4. Few
 *   reads, waited for almost one at a time.
 *
 *   AND THE DEPTH WORK FOUND A DEFECT SITTING IN THE SAME FOUR LINES.
 *
 * ── AN APPLICANT PAST HER FIFTH MATCH WAS TOLD SHE HAD NOT APPLIED ──────────
 *
 *   The by-address claim bounded its query at `.limit(5)`. The gate above it —
 *   module-access-check Layer 2.8 — scans APPLICATION_SCAN_LIMIT (25) and
 *   rules with claimableByEmail. So for a woman whose first five WAVE
 *   applications at her address all belonged to other accounts:
 *
 *       the GATE found her unclaimed application and let her into the module
 *       this ACTION did not, and answered `status: null`
 *
 *   Reproduced against the fake database before the change — six claimed
 *   matches and one unclaimed:
 *
 *       before   status = null      her application: still unowned
 *       after    status = "pending" her application: claimed by her
 *
 *   Two answers to one question, from two copies of one rule. #273 fixed
 *   exactly this in Export, and email-claim-is-narrowed-everywhere wrote down
 *   what was left: "WAVE and Farm Nation should follow, and when they do this
 *   table is how it is noticed." This is WAVE following.
 *
 *   FARM NATION IS STILL ON THE INLINE COPY.
 *
 * ── AND THE WAITING ─────────────────────────────────────────────────────────
 *
 *       nothing filed         5 reads, depth 4  ->  5 reads, depth 3
 *       approved on the row   1 read,  depth 1  ->  unchanged
 *       a filed application   4 reads, depth 3  ->  unchanged
 *
 *   No case reads more than it did. The sweep is reachable only with no
 *   applicationId on the registration and an address to sweep by, and
 *   submitting writes both — so an applicant pays nothing extra and the
 *   approved member never reaches the block.
 *
 *   ISSUING THE QUERY IS NOT ADOPTING WHAT IT RETURNS. claimableByEmail still
 *   decides, in the same place, on the same rows — which is defect 2 in this
 *   file's own header, and the reason it is asserted below rather than
 *   assumed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without it every figure below is measured against a platform with
 *   no request memoisation at all.
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

const UID = 'applicant-1';
const EMAIL = 'applicant@example.test';
const APPS = COLLECTIONS.WAVE_APPLICATIONS;

/** Today's cost of the WAVE check an applicant actually waits on. */
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

const wave = () => import('@/app/actions/wave/_wv_membership');

describe('an applicant past her fifth match at the same address', () => {
    /**
     * `claimedBefore` applications at her address, all owned by other
     * accounts, and then one of hers.
     */
    function seedClaimedMatchesThenHers(claimedBefore: number): void {
        for (let i = 0; i < claimedBefore; i++) {
            store.seed(APPS, `theirs-${i}`, {
                userId: `somebody-else-${i}`,
                userEmail: EMAIL,
                status: 'approved',
                createdAt: new Date(2020, 0, i + 1).toISOString(),
            });
        }
        store.seed(APPS, 'hers', {
            userEmail: EMAIL,
            status: 'pending',
            createdAt: new Date(2021, 0, 1).toISOString(),
        });
    }

    it('IS FOUND — six claimed matches ahead of hers, which `.limit(5)` could not see', async () => {
        /*
         *   The defect, stated as the user experience it produced: she had
         *   applied, the gate let her into the module, and this action told
         *   her she had not. Before the change this returned status null and
         *   left her application unowned.
         */
        seedClaimedMatchesThenHers(6);
        const { checkWaveStatusAction } = await wave();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBe('pending');
        expect((store.get(APPS, 'hers') as any)?.userId).toBe(UID);
    });

    it('and is found at four too, which the old bound also managed', async () => {
        //   The case that always worked, kept so the fix is shown to be a
        //   widening rather than a change of behaviour.
        seedClaimedMatchesThenHers(4);
        const { checkWaveStatusAction } = await wave();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBe('pending');
        expect((store.get(APPS, 'hers') as any)?.userId).toBe(UID);
    });

    it('BUT STILL REFUSES an application that already belongs to somebody else', async () => {
        /*
         *   Defect 2 from this file's own header. The block below the claim
         *   promotes an `approved` application's status onto the caller AND
         *   writes it to their user record, which module-access-check reads —
         *   so adopting a stranger's row would hand over her enrolment.
         *
         *   Widening the bound must not widen WHAT MAY BE CLAIMED.
         */
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else',
            userEmail: EMAIL,
            status: 'approved',
            createdAt: new Date().toISOString(),
        });
        const { checkWaveStatusAction } = await wave();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).not.toBe('approved');
        expect((store.get(APPS, 'theirs') as any)?.userId).toBe('somebody-else');
    });

    it('and says so in the log rather than declining in silence', async () => {
        //   A silent decline is how a support ticket becomes unanswerable: she
        //   sees "no application" and the log says nothing happened.
        const { logger } = await import('@/lib/logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else', userEmail: EMAIL, status: 'approved',
            createdAt: new Date().toISOString(),
        });
        const { checkWaveStatusAction } = await wave();

        await checkWaveStatusAction();

        const said = warn.mock.calls.map((c: any[]) => String(c[0])).join(' | ');
        expect(said).toContain('already belongs to another account');
        warn.mockRestore();
    });
});

describe('what the WAVE check actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        //   THE CONTROL. Without it every ceiling below passes on anything.
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
        const { checkWaveStatusAction } = await wave();
        const seen = measureReadDepth();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBeNull();
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('THE APPROVED MEMBER STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { wave: { status: 'approved' } },
        });
        const { checkWaveStatusAction } = await wave();
        const seen = measureReadDepth();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBe('approved');
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('AND AN APPLICANT WHO HAS FILED PAYS NOTHING EXTRA', async () => {
        //   Submitting writes both the status and the applicationId, so this
        //   account trips neither prefetch guard.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { wave: { status: 'pending', applicationId: 'a1' } },
        });
        store.seed(APPS, 'a1', { userId: UID, status: 'pending', createdAt: new Date().toISOString() });
        const { checkWaveStatusAction } = await wave();
        const seen = measureReadDepth();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBe('pending');
        expect(seen.reads).toBeLessThanOrEqual(4);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('and no by-address sweep is issued when the registration names an application', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { wave: { applicationId: 'named' } },
        });
        store.seed(APPS, 'named', {
            userEmail: EMAIL, status: 'under_review', createdAt: new Date().toISOString(),
        });
        const { checkWaveStatusAction } = await wave();

        const result: any = await checkWaveStatusAction();

        expect(result.data.status).toBe('under_review');
        //   One query against the collection — the owner-scoped one. A
        //   prefetched sweep would make it two.
        const queries = store.reads.filter((r: any) => r.collection === APPS && !r.id);
        expect(queries).toHaveLength(1);
    });
});
