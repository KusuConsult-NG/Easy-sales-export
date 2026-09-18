/**
 * @jest-environment node
 */

/**
 * THE ADMIN COOPERATIVE MEMBERS LIST WAS EMPTY, AND THE SCREEN SAID
 * "No applications found".
 *
 * Reported as "cooperative members on admin is not populating". It is two
 * defects, and neither is visible without the other.
 *
 * DEFECT 1 — THE ROSTER REFUSED ADMINS WHOSE USER DOCUMENT HAD NOT CAUGHT UP.
 * getStandardCooperativeMembersAction — the action the members page calls —
 * gated on the live document roles and nothing else:
 *
 *     const liveRoles = userDoc.data()?.roles;
 *     if (!isAdmin(liveRoles)) return paginatedErr('Unauthorized');
 *
 * `isAdmin(undefined)` is false, so a document with NO roles field — and a
 * document that does not exist at all — was read as "recorded as not an admin".
 * The caller was refused on the strength of a value nobody ever wrote.
 *
 * THREE other admin gates in the same file take the SESSION roles first and
 * consult the document only as a fallback. One file, four gates on one
 * collection, and the only one that refuses on an absent value is the one the
 * page calls.
 *
 * WHAT THE FIX IS, AND WHAT IT DELIBERATELY IS NOT
 * ------------------------------------------------
 * NOT the session-first union its three siblings use. An existing test —
 * "refuses on the LIVE roles, not the session's" — pins a DEMOTED admin: the
 * document says ["user"], the session still says super_admin. A union would
 * have admitted them, and that concern is real, so the document stays
 * authoritative whenever it carries a roles array. The session is consulted
 * only when the document has no answer to give, which is not a security
 * property — nothing was asserted about that caller either way — and the
 * session is signed by the platform and re-synced from the profile every two
 * minutes (lib/auth.ts SYNC_INTERVAL).
 *
 * That existing test passes unchanged, and so does this one. The first draft of
 * this fix was the union; it failed that test, and the test was right.
 *
 * DEFECT 2 — THE REFUSAL WAS INVISIBLE.
 * The page destructured `error: fetchError` from useAdminData on line 62 and
 * used it nowhere. useAdminData sets it on `success: false` and leaves `data`
 * at its previous value — `[]` on a first load — so every refusal arrived as
 * the empty state. An admin saw a cooperative with no members and no reason.
 *
 * Not unique to that page: twenty-nine admin screens are built on useAdminData
 * and NOT ONE renders its error. Seven destructure it and never use it,
 * twenty-two never bind it. The reported page is fixed here; the rest are the
 * same shape and are named in the finding rather than swept silently.
 *
 * EXECUTED, side by side on one store, before the change: with the session
 * carrying super_admin and the user document carrying no roles,
 * getStandardCooperativeMembersAction returned
 * { success: false, error: 'Unauthorized', data: [] } while getAllMembersAction
 * — same file, same collection, same roster — returned the member.
 *
 * DEFECT 3 — THE ROSTER HANDED A support ADMIN AN ACCOUNT NUMBER AND A BVN.
 * Found while testing the first two and confirmed PRE-EXISTING by reverting:
 * this function has TWO row builders, #338 gated the filtered one, and the
 * DEFAULT unfiltered view — the screen an admin sees on load — was not gated at
 * all. The hydrated `user.bankDetails` block was gated in neither. Its sibling
 * getStandardExportApplicationsAction has both of its branches gated, which is
 * how this one being half-done is visible.
 *
 * STILL OPEN, and deliberately not fixed here: a SCOPED admin (one whose user
 * document carries a cooperativeId) gets `.where("cooperativeId", "==", scope)`
 * on this query, and the bulk legacy member import writes rows without that
 * field — so those members are invisible to them. isWithinAdminScope tolerates
 * a missing cooperativeId in memory; a PostgREST filter cannot. The last test
 * below pins that gap as a known one so it is on the record rather than
 * rediscovered.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isWithinAdminScope, DEFAULT_COOPERATIVE_ID } from '@/lib/cooperative-admin-scope';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    CACHE_TTL: {},
}));
jest.mock('@/lib/audit-log', () => ({
    ...(jest.requireActual('@/lib/audit-log') as object),
    logAuditAction: jest.fn(async () => undefined),
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

let store: FakeDbHandle;

const ADMIN = 'admin-1';

function signedInAs(roles: string[], id: string = ADMIN) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com` } },
        error: null,
    }));
}

function seedMember(id: string, extra: Record<string, unknown> = {}) {
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, id, {
        userId: `u-${id}`,
        fullName: 'Ada Obi',
        email: `${id}@example.com`,
        membershipStatus: 'approved',
        paymentStatus: 'completed',
        cooperativeId: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

async function roster() {
    const { getStandardCooperativeMembersAction } =
        await import('@/app/actions/cooperative/_coop_admin_members');
    return (await getStandardCooperativeMembersAction({ status: 'all', limit: 50 })) as any;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedMember('cm1');
});

describe('an admin whose user document has not caught up with their session', () => {
    it('SEES THE ROSTER — this answered Unauthorized with an empty list', async () => {
        // The document carries no roles at all. The session says super_admin.
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com' });
        signedInAs(['super_admin']);

        const res = await roster();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });

    it('and so does one whose user document does not exist', async () => {
        signedInAs(['super_admin'], 'ghost-admin');

        const res = await roster();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });

    it('and the two members actions in this file now agree on who may read', async () => {
        /**
         * The finding in one measurement. These read the same collection for the
         * same screen and disagreed: the session-first one admitted the caller,
         * the document-only one refused.
         */
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com' });
        signedInAs(['super_admin']);

        const mod = await import('@/app/actions/cooperative/_coop_admin_members');
        const standard: any = await mod.getStandardCooperativeMembersAction({ status: 'all' });
        const all: any = await mod.getAllMembersAction({});

        expect(standard.success).toBe(true);
        expect(all.success).toBe(true);
        expect(standard.data).toHaveLength(1);
        expect(all.data.members).toHaveLength(1);
    });
});

describe('the gate has not become a wall', () => {
    it('a caller who is an admin in neither place is still refused', async () => {
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com', roles: ['general_user'] });
        signedInAs(['general_user']);

        const res = await roster();

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized');
        expect(res.data).toEqual([]);
    });

    it('and an admin by document alone still gets in', async () => {
        // The original direction, which must keep working: the session is stale
        // the other way round.
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com', roles: ['super_admin'] });
        signedInAs(['general_user']);

        const res = await roster();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
    });

    it('and the member PII gate still answers from the resolved roles', async () => {
        // `support` reaches the roster and holds no cooperatives:approve_members,
        // so the row must not carry an account number. Resolving the roles once
        // must not have widened this.
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com' });
        signedInAs(['support']);
        seedMember('cm2', { accountNumber: '0123456789', bvn: '22222222222' });

        const res = await roster();

        expect(res.success).toBe(true);
        expect(JSON.stringify(res.data)).not.toContain('0123456789');
        expect(JSON.stringify(res.data)).not.toContain('22222222222');
    });
});

describe('a failed read no longer reads as an empty cooperative', () => {
    const PAGE = 'src/app/admin/cooperatives/members/page.tsx';

    function page(): string {
        return readFileSync(join(process.cwd(), PAGE), 'utf-8');
    }

    it('the members page renders the error it was already given', () => {
        const code = page();

        // Bound on one line and used nowhere else was the whole defect.
        const uses = (code.match(/\bfetchError\b/g) ?? []).length;
        expect(uses).toBeGreaterThan(1);
        expect(code).toContain('{fetchError}');
    });

    it('and it checks the error BEFORE the empty state', () => {
        // The other order would still show "No applications found" first.
        const code = page().replace(/\/\*[\s\S]*?\*\//g, '');
        const errorBranch = code.indexOf(') : fetchError ? (');
        const emptyBranch = code.indexOf('No applications found');

        expect(errorBranch).toBeGreaterThan(-1);
        expect(emptyBranch).toBeGreaterThan(errorBranch);
    });

    it('and the hook really does leave the rows alone on a refusal', async () => {
        // The premise of the finding: useAdminData sets `error` and does NOT
        // clear `data`, so a refusal is indistinguishable from an empty page
        // unless the error is rendered.
        const hook = readFileSync(join(process.cwd(), 'src/hooks/useAdminData.ts'), 'utf-8');
        const failureBranch = hook.slice(hook.indexOf("const msg = result.error"));

        expect(failureBranch).toContain('setError(msg)');
        expect(failureBranch.slice(0, 200)).not.toContain('setData(');
    });
});

describe('and the roster does not hand a support admin an account number', () => {
    /**
     * A THIRD defect, found while testing the first two and confirmed
     * PRE-EXISTING: reverted to the original code, a `support` admin holding
     * the role on their user document already received
     * accountNumber "0123456789" and bvn "22222222222" from this list.
     *
     * This function has TWO row builders. #338 gated the one taken for a
     * search, a date range, a state, an LGA, a registry or a gender sort — and
     * not the one taken for the DEFAULT, unfiltered view, which is the screen
     * an admin sees on load. The hydrated `user.bankDetails` block was gated in
     * neither. Both are closed here, so the two branches agree.
     */
    const ACCOUNT = '0123456789';
    const BVN = '22222222222';

    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com' });
        seedMember('cm2', { accountNumber: ACCOUNT, bvn: BVN });
    });

    async function rows(roles: string[], options: Record<string, unknown> = {}) {
        signedInAs(roles);
        const { getStandardCooperativeMembersAction } =
            await import('@/app/actions/cooperative/_coop_admin_members');
        const res = (await getStandardCooperativeMembersAction(
            { status: 'all', limit: 50, ...options } as any)) as any;
        expect(res.success).toBe(true);
        return JSON.stringify(res.data);
    }

    it.each([
        ['the DEFAULT unfiltered view — the branch #338 missed', {}],
        ['a filtered view — the branch #338 gated', { sortBy: 'gender' }],
    ])('carries neither for a support admin in %s', async (_label, options) => {
        const out = await rows(['support'], options);

        expect(out).not.toContain(ACCOUNT);
        expect(out).not.toContain(BVN);
    });

    it.each([
        ['the DEFAULT unfiltered view', {}],
        ['a filtered view', { sortBy: 'gender' }],
    ])('and still carries them for an admin who approves members, in %s', async (_label, options) => {
        const out = await rows(['admin'], options);

        expect(out).toContain(ACCOUNT);
    });
});

describe('a scoped admin sees the members the guard says are theirs', () => {
    /**
     * THE SCOPE FILTER HID THE MEMBERS IT WAS WRITTEN TO SHOW.
     *
     * A scoped admin got `.where("cooperativeId", "==", adminScope)`.
     * isWithinAdminScope — the predicate the write guards use for the same
     * question — reads a MISSING cooperativeId as the default cooperative:
     *
     *     const recordId = raw || DEFAULT_COOPERATIVE_ID;
     *     return recordId === adminScope;
     *
     * A PostgREST equality filter cannot do that: an absent key matches
     * nothing. The two therefore disagreed about exactly the rows the legacy
     * import produces — admin/_legacy.ts writes COOPERATIVE_MEMBERS with NO
     * cooperativeId, /api/cooperatives/register writes "default" — so a
     * cooperative whose members came in through the Import Legacy button on
     * this very screen showed its scoped admin a short list or none.
     *
     * Executed before the fix: scope "default", one legacy row and one
     * registered row, roster came back ["registered"].
     */
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, ADMIN, {
            email: 'a@example.com', roles: ['cooperative_admin'],
            cooperativeId: DEFAULT_COOPERATIVE_ID,
        });
        signedInAs(['cooperative_admin']);
        // What admin/_legacy.ts writes: no cooperativeId at all.
        seedMember('legacy', { cooperativeId: undefined });
        // What /api/cooperatives/register writes.
        seedMember('registered', { cooperativeId: 'default' });
    });

    it('INCLUDES THE LEGACY-IMPORTED MEMBERS — these were invisible', async () => {
        const res = await roster();

        expect(res.success).toBe(true);
        // cm1 comes from the outer seed and also carries "default".
        expect((res.data as any[]).map((r) => r.id).sort())
            .toEqual(['cm1', 'legacy', 'registered']);
    });

    it('and getAllMembersAction, the twin with the same filter, agrees', async () => {
        const { getAllMembersAction } =
            await import('@/app/actions/cooperative/_coop_admin_members');
        const res: any = await getAllMembersAction({});

        expect(res.success).toBe(true);
        expect((res.data.members as any[]).map((m) => m.id).sort())
            .toEqual(['cm1', 'legacy', 'registered']);
    });

    it('and the member metrics count them too — they were undercounted', async () => {
        // The same filter feeds the dashboard totals, where the failure is a
        // wrong number rather than a short list.
        const { UserMetricsService } = await import('@/services/userMetrics.service');
        const metrics = await UserMetricsService.getCooperativeMemberMetrics(DEFAULT_COOPERATIVE_ID);

        // cm1 (seeded by the outer beforeEach), legacy and registered.
        expect(metrics.totalApplications).toBe(3);
    });

    it('and a NAMED cooperative still excludes rows that carry no id', async () => {
        /**
         * The other direction, and why every other scope keeps its exact query
         * filter: a row with no cooperativeId belongs to the DEFAULT
         * cooperative, not to a named one. isWithinAdminScope says so, and the
         * list must agree with it rather than widen.
         */
        store.seed(COLLECTIONS.USERS, ADMIN, {
            email: 'a@example.com', roles: ['cooperative_admin'], cooperativeId: 'coop-lagos',
        });
        signedInAs(['cooperative_admin']);
        seedMember('theirs', { cooperativeId: 'coop-lagos' });

        const res = await roster();
        const ids = (res.data as any[]).map((r) => r.id);

        expect(ids).toContain('theirs');
        expect(ids).not.toContain('legacy');
        expect(ids).not.toContain('registered');
    });

    it('and a platform admin is still unscoped', async () => {
        store.seed(COLLECTIONS.USERS, ADMIN, { email: 'a@example.com', roles: ['super_admin'] });
        signedInAs(['super_admin']);

        const res = await roster();

        expect((res.data as any[]).map((r) => r.id).sort())
            .toEqual(['cm1', 'legacy', 'registered']);
    });

    it('and the list answers the same question as the write guard, row by row', () => {
        // The property, stated once: whatever the list returns for a scope must
        // be exactly what isWithinAdminScope would admit.
        for (const scope of [DEFAULT_COOPERATIVE_ID, 'coop-lagos']) {
            expect(isWithinAdminScope(scope, undefined)).toBe(scope === DEFAULT_COOPERATIVE_ID);
            expect(isWithinAdminScope(scope, 'default')).toBe(scope === DEFAULT_COOPERATIVE_ID);
            expect(isWithinAdminScope(scope, 'coop-lagos')).toBe(scope === 'coop-lagos');
        }
    });

    it('and the sites still carrying the raw filter are named, not forgotten', () => {
        /**
         * FIVE MORE QUERIES apply `.where("cooperativeId", "==", adminScope)`
         * and have the same divergence. They are NOT fixed in this pass and
         * that is a decision, not an oversight: they aggregate
         * COOPERATIVE_TRANSACTIONS and COOPERATIVE_LOANS rather than paginate
         * members, so each needs its own read of how much it pulls into memory.
         * The three fixed here are the ones that query COOPERATIVE_MEMBERS,
         * which is the collection with a writer that provably omits the field.
         *
         * Listed so the next pass finds them without re-deriving the sweep.
         */
        const remaining = [
            'src/app/actions/cooperative/_coop_admin_money.ts',
            'src/app/actions/cooperative/_coop_admin_reports.ts',
        ];
        const hits = remaining.flatMap((rel) => {
            const code = readFileSync(join(process.cwd(), rel), 'utf-8');
            return code.match(/where\("cooperativeId", "==", adminScope\)/g) ?? [];
        });

        expect(hits.length).toBe(5);
    });
});
