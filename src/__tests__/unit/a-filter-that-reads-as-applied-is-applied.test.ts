/**
 * @jest-environment node
 */

/**
 *   #498 THE ROLE FILTER WAS DROPPED THE MOMENT ANYBODY SEARCHED.
 *
 *   getUsersAction applies role in the query, on one branch only:
 *
 *       if (!options.search) {
 *           if (options.role && options.role !== "all") {
 *               query = query.where("roles", "array-contains", options.role);
 *           }
 *
 *   and nothing downstream re-applied it. State, LGA, module, gender, status and
 *   both dates are every one of them filtered in memory after the mapping. Role
 *   was the single filter left off that list.
 *
 *   SO THE CONTROL STAYED LIT AND DID NOTHING. The dropdown at
 *   admin/users/page.tsx:528 still reads "Seller", line 199 still counts role
 *   among the active filters and still offers "Clear filters" — and the results
 *   contain every role there is. An admin narrowing 42,160 users to sellers and
 *   then typing a name gets an unfiltered answer that looks filtered.
 *
 *   A control that reads as applied and is not is worse than a missing one: the
 *   missing one gets reported. This audit has now found that shape in the admin
 *   nav (#484), in Farm Nation approval (#486), in twenty-one dead buttons
 *   (#491) and here.
 *
 *   WHY THE QUERY CANNOT SIMPLY DO IT. The search branch already constrains on
 *   document id, and combining that with array-contains is the composite this
 *   file avoids everywhere else — the same reason six other filters are applied
 *   in memory. So role joins them, unconditionally, exactly as the dates already
 *   are: "ALWAYS apply date filters in memory as a definitive backstop."
 *
 * ── AND THE COUNT ANSWERED A DIFFERENT QUESTION FROM THE LIST ───────────────
 *
 *   `meta.totalCount` switched to the filtered length for STATE and LGA and for
 *   nothing else. Filter by gender, module, date or verification status and the
 *   list showed a handful of rows while the total reported the whole collection.
 *   With #495 adding "unevidenced" that would have read 3,605 rows under a
 *   heading of 42,160.
 *
 *   Every one of those filters runs in memory, so the rule is: if anything
 *   narrowed the set after the query, the count comes from the narrowed set.
 *
 *   IT IS BOUNDED AND SAYS SO. In-memory filtering only ever sees FETCH_LIMIT
 *   rows, so a filtered count is "of those scanned". `countIsBounded` lets a
 *   caller render 2000+ rather than present a capped number as exact.
 *
 *   NOTHING RENDERS totalCount TODAY — admin/users/page.tsx does not destructure
 *   `meta`, and that is stated rather than glossed. It is corrected anyway,
 *   because a returned field that is quietly wrong is what the next person
 *   builds a header on. That is precisely how lib/validations/marketplace.ts
 *   came to record that estimatedDeliveryDate had no writer (#493).
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the in-memory role filter removed              KILLED
 *     the filter narrowed to the non-search path     KILLED
 *     the count reverted to state/lga only           KILLED
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

const USERS = COLLECTIONS.USERS;

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Not authenticated' } }
            : { session: { user: { id, roles, email: `${id}@example.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1');
});

async function actions() {
    return import('@/app/actions/admin/_users');
}

const listUsers = async (options?: any) =>
    (await (await actions()).getUsersAction(options)) as any;

const rows = (res: any) => (res.data as any[]).map((u) => u.id).sort();

function seedUser(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(USERS, id, {
        email: `${id}@example.com`,
        firstName: 'Ada',
        lastName: 'Obi',
        phone: '08012345678',
        roles: ['general_user'],
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#498 — the role filter survives a search', () => {
    it('A SEARCH WITH A ROLE FILTER RETURNS ONLY THAT ROLE', async () => {
        //   THE test. Both users match the search term "Ada"; only one is a
        //   seller. Before this, both came back while the dropdown read
        //   "Seller".
        seedUser('seller-1', { roles: ['general_user', 'seller'] });
        seedUser('buyer-1', { roles: ['general_user'] });

        const res = await listUsers({ search: 'Ada', role: 'seller' });

        expect(rows(res)).toEqual(['seller-1']);
    });

    it('AND WITHOUT A SEARCH IT STILL DOES — the path that always worked', async () => {
        //   The control for the other branch. A fix that moved the filter into
        //   memory and out of the query must not lose the query's own case.
        seedUser('seller-1', { roles: ['seller'] });
        seedUser('buyer-1', { roles: ['general_user'] });

        expect(rows(await listUsers({ role: 'seller' }))).toEqual(['seller-1']);
    });

    it('AND "all" STILL MEANS EVERYBODY', async () => {
        //   The vacuity guard. A filter that excluded everyone would satisfy the
        //   first assertion.
        seedUser('seller-1', { roles: ['seller'] });
        seedUser('buyer-1', { roles: ['general_user'] });

        expect(rows(await listUsers({ search: 'Ada', role: 'all' })))
            .toEqual(['buyer-1', 'seller-1']);
        expect(rows(await listUsers({ search: 'Ada' })))
            .toEqual(['buyer-1', 'seller-1']);
    });

    it('and a user holding the role among several still matches', async () => {
        //   `array-contains`, not equality — the query's semantics, which the
        //   in-memory backstop has to reproduce rather than approximate.
        seedUser('multi', { roles: ['general_user', 'seller', 'cooperative_member'] });

        expect(rows(await listUsers({ search: 'Ada', role: 'cooperative_member' })))
            .toEqual(['multi']);
    });

    it('and a row with no roles array is excluded rather than crashing', async () => {
        seedUser('no-roles', { roles: undefined });

        expect(rows(await listUsers({ search: 'Ada', role: 'seller' }))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#498 — the count is about the same set as the list', () => {
    it('A FILTERED LIST REPORTS A FILTERED TOTAL', async () => {
        //   Gender narrows in memory and used to leave totalCount reporting the
        //   whole collection.
        seedUser('f1', { gender: 'female' });
        seedUser('m1', { gender: 'male' });
        seedUser('m2', { gender: 'male' });

        const res = await listUsers({ gender: 'female' });

        expect(res.data.length).toBe(1);
        expect(res.meta.totalCount).toBe(1);
    });

    it('AND A VERIFICATION FILTER DOES TOO — the #495 states', async () => {
        //   The case that made this visible: "unevidenced" would have shown
        //   3,605 rows under a heading of 42,160.
        seedUser('real', { isVerified: true });
        seedUser('ghost', { isVerified: true, _system_skeleton_backfill: true });

        const verified = await listUsers({ status: 'verified' });
        expect(verified.data.length).toBe(1);
        expect(verified.meta.totalCount).toBe(1);

        const unevidenced = await listUsers({ status: 'unevidenced' });
        expect(unevidenced.data.length).toBe(1);
        expect(unevidenced.meta.totalCount).toBe(1);
    });

    it('AND AN UNFILTERED LIST STILL REPORTS THE DATABASE COUNT', async () => {
        //   The reason the switch exists at all: in-memory filtering only sees
        //   FETCH_LIMIT rows, so an unfiltered total must come from the count
        //   query or it would under-report a large collection.
        seedUser('u1');
        seedUser('u2');
        seedUser('u3');

        const res = await listUsers({});

        expect(res.meta.totalCount).toBe(3);
        expect(res.meta.countIsBounded).toBe(false);
    });

    it('and a bounded count says that it is bounded', () => {
        //   Asserted on the rule rather than by seeding two thousand rows: the
        //   flag is only ever true when in-memory narrowing happened AND the
        //   scan filled its limit.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/actions/admin/_users.ts'), 'utf8');

        expect(src).toContain('countIsBounded: narrowedInMemory && deduplicatedUsers.length >= FETCH_LIMIT');
    });
});
