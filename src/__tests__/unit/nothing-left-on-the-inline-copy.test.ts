/**
 * @jest-environment node
 */

/**
 *   THE LAST MODULE ON THE INLINE COPY.
 *
 *   email-claim-is-narrowed-everywhere has carried a table of the three doors
 *   that grew the same "let a returning applicant claim her own application"
 *   rule by hand. #273 moved Export onto the shared one, #287 moved WAVE, and
 *   both left the same line behind: "Farm Nation is still on the inline copy,
 *   and when it follows this table is how it is noticed." This is Farm Nation
 *   following. The table now reads `shared` three times.
 *
 * ── A FARMER PAST HER FIFTH MATCH WAS TOLD SHE HAD NOT APPLIED ──────────────
 *
 *   The by-address claim bounded its query at `.limit(5)`. The gate above it —
 *   module-access-check Layer 2.10 — scans APPLICATION_SCAN_LIMIT (25) and
 *   rules with claimableByEmail.
 *
 *   A BOUNDED QUERY WITH NO orderBy RETURNS THE LOWEST IDS. SupabaseQuery
 *   appends `query.order('id')` when nothing else orders, so `.limit(5)` is not
 *   "five arbitrary rows", it is the five whose document ids sort first — and
 *   an application filed later has no reason to sort early. So for a farmer
 *   whose five lowest-id matches at her address all belonged to other accounts:
 *
 *       the GATE found her unclaimed application and let her into the module
 *       this ACTION did not, and answered `status: null`
 *
 *   Reproduced against the fake database before the change — six claimed
 *   matches sorting ahead of hers, and one of hers:
 *
 *       before   status = null      her application: still unowned
 *       after    status = "pending" her application: claimed by her
 *
 *   THE IDS IN THE FIXTURE ARE THE FIXTURE. The first draft of the WAVE suite
 *   next door named her row `hers` and the others `theirs-0..5` — and `hers`
 *   sorts first, so she was inside the first five however many preceded her.
 *   Every test passed with the old bound restored. That fixture has been
 *   corrected too, and this one was written knowing it.
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
 *   decides, in the same place, on the same rows — which is defect 2 in the
 *   action's own header, and the reason it is asserted below rather than
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

const UID = 'farmer-1';
const EMAIL = 'farmer@example.test';
const APPS = COLLECTIONS.FARM_NATION_APPLICATIONS;

/**
 * Her application's document id, chosen to sort LAST among the fixture's rows.
 * An unordered query returns lowest-id first — see this file's header.
 */
const HERS = 'app-zz-hers';

/** Today's cost of the Farm Nation check an applicant actually waits on. */
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

const farmNation = () => import('@/app/actions/farm-nation/_fn_onboarding');

describe('a farmer past her fifth match at the same address', () => {
    /**
     * `claimedBefore` applications at her address, all owned by other accounts
     * and all sorting AHEAD of hers, and then one of hers.
     */
    function seedClaimedMatchesThenHers(claimedBefore: number): void {
        for (let i = 0; i < claimedBefore; i++) {
            store.seed(APPS, `app-${i}-theirs`, {
                userId: `somebody-else-${i}`,
                userEmail: EMAIL,
                status: 'approved',
                createdAt: new Date(2020, 0, i + 1).toISOString(),
            });
        }
        store.seed(APPS, HERS, {
            userEmail: EMAIL,
            status: 'pending',
            createdAt: new Date(2021, 0, 1).toISOString(),
        });
    }

    it('IS FOUND — six claimed matches ahead of hers, which `.limit(5)` could not see', async () => {
        /*
         *   The defect stated as the experience it produced: she had applied,
         *   the gate let her into the module, and this action told her she had
         *   not. Before the change this returned null and left her application
         *   unowned.
         */
        seedClaimedMatchesThenHers(6);
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
        expect((store.get(APPS, HERS) as any)?.userId).toBe(UID);
    });

    it('and is found at four too, which the old bound also managed', async () => {
        //   The case that always worked, kept so the fix is shown to be a
        //   widening rather than a change of behaviour.
        seedClaimedMatchesThenHers(4);
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
        expect((store.get(APPS, HERS) as any)?.userId).toBe(UID);
    });

    it('BUT STILL REFUSES an application that already belongs to somebody else', async () => {
        /*
         *   Defect 2 from the action's own header. The block below the claim
         *   promotes an `approved` application's status onto the caller AND
         *   writes it to their user record, which module-access-check reads —
         *   so adopting a stranger's row would hand over their membership,
         *   and the roles that come with it.
         *
         *   Widening the bound must not widen WHAT MAY BE CLAIMED.
         */
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else',
            userEmail: EMAIL,
            status: 'approved',
            createdAt: new Date().toISOString(),
        });
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).not.toBe('approved');
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
        const { checkFarmNationStatusAction } = await farmNation();

        await checkFarmNationStatusAction();

        const said = warn.mock.calls.map((c: any[]) => String(c[0])).join(' | ');
        expect(said).toContain('already belongs to another account');
        warn.mockRestore();
    });

    it('CLAIMS THE NEWEST unclaimed row, not the lowest-id one', async () => {
        /*
         *   The shared rule ranks with latestApplication; the inline
         *   `docs.find(...)` took whichever unclaimed row the query happened to
         *   return first, which after `order('id')` is the lowest id. A farmer
         *   who resubmitted has two unclaimed rows, and the one worth reading
         *   is the resubmission.
         */
        store.seed(APPS, 'app-a-first', {
            userEmail: EMAIL, status: 'rejected',
            createdAt: new Date(2020, 0, 1).toISOString(),
            submittedAt: new Date(2020, 0, 1).toISOString(),
        });
        store.seed(APPS, 'app-b-resubmitted', {
            userEmail: EMAIL, status: 'pending',
            createdAt: new Date(2024, 0, 1).toISOString(),
            submittedAt: new Date(2024, 0, 1).toISOString(),
        });
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
        expect((store.get(APPS, 'app-b-resubmitted') as any)?.userId).toBe(UID);
    });
});

describe('what the Farm Nation check actually waits for', () => {
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

    it('A FARMER WITH NOTHING FILED WAITS THREE TIMES, not four', async () => {
        const { checkFarmNationStatusAction } = await farmNation();
        const seen = measureReadDepth();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBeNull();
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('THE APPROVED MEMBER STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user', 'farmer'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { farmNation: { status: 'approved' } },
        });
        const { checkFarmNationStatusAction } = await farmNation();
        const seen = measureReadDepth();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('approved');
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('AND A FARMER WHO HAS FILED PAYS NOTHING EXTRA', async () => {
        //   Submitting writes both the status and the applicationId, so this
        //   account trips neither prefetch guard.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { farmNation: { status: 'pending', applicationId: 'a1' } },
        });
        store.seed(APPS, 'a1', { userId: UID, status: 'pending', createdAt: new Date().toISOString() });
        const { checkFarmNationStatusAction } = await farmNation();
        const seen = measureReadDepth();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
        expect(seen.reads).toBeLessThanOrEqual(4);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('and no by-address sweep is issued when the registration names an application', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { farmNation: { applicationId: 'named' } },
        });
        store.seed(APPS, 'named', {
            userEmail: EMAIL, status: 'under_review', createdAt: new Date().toISOString(),
        });
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('under_review');
        //   One query against the collection — the owner-scoped one. A
        //   prefetched sweep would make it two.
        const queries = store.reads.filter((r: any) => r.collection === APPS && !r.id);
        expect(queries).toHaveLength(1);
    });

    it('BUT AN applicationId THAT NAMES NOTHING STILL SWEEPS', async () => {
        /*
         *   Farm Nation's branch is shaped differently from WAVE's: the named
         *   read and the sweep are not mutually exclusive, the sweep runs
         *   whenever the named document turned out not to exist. So the
         *   prefetch guard (`no applicationId`) is narrower than the branch,
         *   and the fallback inside it is what keeps this row reachable.
         *
         *   A registration pointing at a deleted application is exactly the
         *   stranded state the claiming branch exists to repair, so losing it
         *   would be losing the repair.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { farmNation: { applicationId: 'gone' } },
        });
        store.seed(APPS, HERS, {
            userEmail: EMAIL, status: 'pending', createdAt: new Date().toISOString(),
        });
        const { checkFarmNationStatusAction } = await farmNation();

        const result: any = await checkFarmNationStatusAction();

        expect(result.data).toBe('pending');
        expect((store.get(APPS, HERS) as any)?.userId).toBe(UID);
    });
});
