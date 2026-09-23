/**
 *   THE OWNER: "fix the export one next."
 *
 * ── MEASURED, NOT GUESSED ───────────────────────────────────────────────────
 *
 *   #261's read meter with a real per-request memoiser — React's cache() is a
 *   PASS-THROUGH under jest, so a suite that skips that step measures a
 *   platform with no request memoisation at all. An applicant with nothing
 *   filed, which is the commonest visitor this screen has:
 *
 *       checkExportStatusAction    6 reads → 5
 *       an /export page draw       9 reads → 6
 *
 *   THREE THINGS, AND ONLY THE FIRST IS ABOUT EXPORT ALONE.
 *
 *   1. THE LEGACY FALLBACK ASKED A SUBSET OF A SET IT ALREADY HAD. It queries
 *      `userId == <live id>` on a collection this action has already queried
 *      on `userId IN <every id this person owns>` — a strict superset, since
 *      ownedProfileIds always carries the live id first. An empty superset
 *      means an empty subset. Skipped only when the owner query came back
 *      empty AND nothing was claimed since, because the applicationId and
 *      email branches WRITE `userId` and can legitimately make the subset
 *      non-empty. Same two flags, same names, as WAVE's copy.
 *
 *   2. The caller's own row was read outside the request memo, so the gate
 *      above and this action each paid for it.
 *
 *   3. THE EMAIL QUERY DISAGREED WITH THE GATE'S, AND THAT WAS A DEFECT
 *      BEFORE IT WAS A COST. This action bounded it at `.limit(5)`; the gate
 *      bounds it at APPLICATION_SCAN_LIMIT. Both then take the first row
 *      nobody owns. So an applicant whose first five matches were all claimed
 *      was found by the gate — which let them in — and NOT by this action,
 *      which told them they had not applied. One question, two answers, from
 *      two copies of one rule. Same bound and the same shared helper now,
 *      which also makes the two queries identical, so the request pays once.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

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

/** Today's cost of the Export screens an applicant actually waits on. */
const CEILING = { action: 5, page: 6 };

let store: FakeDbHandle;

const sessionAs = (id: string, email: string) => {
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id, email, roles: ['general_user'] } },
        error: null,
    }));
};

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    sessionAs(UID, EMAIL);
});

const exportActions = () => import('@/app/actions/export/_ex_onboarding');

describe('what an Export page draw costs an applicant with nothing filed', () => {
    it('DOES NOT GROW — five reads is the action\'s ceiling, down from six', async () => {
        const { checkExportStatusAction } = await exportActions();
        store.reads.length = 0;

        const result = await checkExportStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.action);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toBeNull();
    });

    it('ASKS export_applications ONCE for the owner-scoped set, not twice', async () => {
        //   The legacy fallback re-asked `userId == <live id>` after
        //   `userId IN <owned>` came back empty.
        const { checkExportStatusAction } = await exportActions();
        store.reads.length = 0;

        await checkExportStatusAction();

        const appReads = store.reads.filter((r: any) => r.collection === APPS);
        //   The owner-scoped query and the email claim. Not the subset.
        expect(appReads.length).toBe(2);
    });

    it('DOES NOT GROW — six reads is the page\'s ceiling, down from nine', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkExportStatusAction } = await exportActions();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'export');
        await checkExportStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.page);
    });

    it('and reads the caller\'s own row ONCE across the gate and the action', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkExportStatusAction } = await exportActions();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'export');
        await checkExportStatusAction();

        const ownRow = store.reads.filter((r: any) => r.collection === COLLECTIONS.USERS && r.id === UID);
        expect(ownRow.length).toBe(1);
    });
});

describe('the skip is only taken when the answer is already known', () => {
    it('STILL RUNS the legacy sync when a claim made the subset non-empty', async () => {
        /*
         *   The email branch WRITES `userId` onto a row the owner-scoped query
         *   could not see. After that the subset query is not provably empty,
         *   and the legacy sync is what backfills the register from it.
         */
        //   NO `status` ON THE ROW, ON PURPOSE. A claimed row that carries one
        //   returns from the branch above and never reaches the skip, so a
        //   fixture with a status cannot tell `ownerQueryWasEmpty` from
        //   `ownerQueryWasEmpty && !foundAnApplication` — a mutant that
        //   dropped the second half survived exactly that.
        store.seed(APPS, 'legacy-1', {
            userEmail: EMAIL,
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        //   The legacy sync ran and put the applicant on the register.
        expect(result).toBe('pending_approval');
        const claimed: any = store.get(APPS, 'legacy-1');
        expect(claimed?.userId).toBe(UID);
    });

    it('AND THE CLAIMED ROW IS VISIBLE to the shared reader afterwards', async () => {
        /*
         *   The claim writes `userId` onto a row the owner-scoped query could
         *   not previously see. Anything later in the same request — the gate
         *   re-checking, another action on the same page — must be given the
         *   set as it is now, not the one taken before the write.
         */
        store.seed(APPS, 'legacy-1', {
            userEmail: EMAIL,
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { applicationsOwnedBy } = await import('@/lib/application-request-reads');
        const { checkExportStatusAction } = await exportActions();

        const before = await applicationsOwnedBy(APPS, UID);
        expect(before.empty).toBe(true);

        await checkExportStatusAction();

        const after = await applicationsOwnedBy(APPS, UID);
        expect(after.empty).toBe(false);
    });

    it('STILL FINDS an application filed under a superseded profile', async () => {
        /*
         *   The direction this action resolves, and the one #904 is about: the
         *   application is filed under the id that LOST a duplicate, and #490
         *   signs the applicant in as the id that won. `ownedProfileIds`
         *   searches backwards for rows pointing at the live id, and the skip
         *   must never stand between an applicant and a row that is theirs.
         */
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(APPS, 'app-1', {
            userId: 'old-id', status: 'approved',
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).toBe('approved');
    });
});

describe('the email claim agrees with the gate that runs above it', () => {
    it('REACHES A CLAIMABLE ROW PAST THE FIRST FIVE, which `.limit(5)` could not', async () => {
        /*
         *   Six applications carry this address. The first five belong to
         *   other accounts; the sixth belongs to nobody. The gate, bounded at
         *   APPLICATION_SCAN_LIMIT, has always found it — so it let this
         *   applicant in while this action told them they had not applied.
         */
        for (let i = 0; i < 5; i++) {
            store.seed(APPS, `theirs-${i}`, {
                userId: `somebody-${i}`, userEmail: EMAIL, status: 'approved',
                submittedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
            });
        }
        store.seed(APPS, 'unclaimed', {
            userEmail: EMAIL, status: 'approved',
            submittedAt: '2026-02-01T00:00:00.000Z',
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).toBe('approved');
        expect((store.get(APPS, 'unclaimed') as any)?.userId).toBe(UID);
    });

    it('AND STILL REFUSES a row that belongs to somebody else', async () => {
        //   #888 defect 2. Widening the scan must not widen what may be read.
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else', userEmail: EMAIL, status: 'approved',
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkExportStatusAction } = await exportActions();

        const result = await checkExportStatusAction();

        expect(result).toBeNull();
        expect((store.get(APPS, 'theirs') as any)?.userId).toBe('somebody-else');
    });
});
