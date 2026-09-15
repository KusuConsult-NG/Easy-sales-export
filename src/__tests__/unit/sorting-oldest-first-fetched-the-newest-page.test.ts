/**
 * @jest-environment node
 */

/**
 *   #776 "OLDEST FIRST" FETCHED THE NEWEST PAGE AND SORTED THAT.
 *
 *   Reported by the owner: "sorting users is not completely functional (using
 *   the filter button)."
 *
 *   getUsersAction orders in the database and then re-sorts in memory. The
 *   database half was a literal:
 *
 *       query = query.orderBy("createdAt", "desc");     // options.sortOrder
 *                                                       // never consulted
 *
 *   while the in-memory half, two hundred lines below, honours
 *   `options.sortOrder`. So asking for the OLDEST accounts fetched the NEWEST
 *   (page + 1) * pageSize + 100 rows and ordered that window ascending.
 *
 *   MEASURED on 301 accounts, "Sort by Date Joined / Oldest First", page one
 *   of ten:
 *
 *       returned   u190 u191 u192 … u199
 *       correct    the 2019 account, then u0, u1, u2 …
 *
 *   THE OLDEST ACCOUNTS WERE ON NO PAGE AT ALL. Every page re-fetches from the
 *   newest end, so paging forward never reaches them — the earliest members on
 *   the platform were simply unreachable through this control.
 *
 *   And it LOOKED like it worked, which is why the report says "not completely
 *   functional" rather than "broken": the rows do reorder when the control is
 *   changed, they are just the wrong rows. An admin had no way to tell.
 *
 * ── WHAT IS FIXED, AND WHAT IS ONLY BOUNDED ─────────────────────────────────
 *
 *   FIXED: the direction now comes from the request, so the database returns
 *   the correct END of the collection and the in-memory sort agrees with it
 *   rather than fighting it.
 *
 *   NOT FIXED, AND STATED RATHER THAN HIDDEN: sorting by GENDER still sorts a
 *   window. Gender is not a database order here; the action fetches 2,000 rows
 *   and sorts those, so on a platform with far more accounts than that, "sort
 *   by gender" ranks the newest 2,000 and not everybody. Ordering by gender in
 *   the database would fix it and would also DROP every account with no gender
 *   recorded — an admin list that silently omits members is a worse failure
 *   than a bounded sort, and #772 is this codebase's record of what happens
 *   when a sample is presented as the whole. It is left bounded, deliberately,
 *   and written down here.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     sortOrder reverted to the "desc" literal                        KILLED
 *     the direction inverted (asc → desc)                             KILLED
 *     the in-memory comparator's direction dropped                    KILLED
 *     reword this header                                    SURVIVED, intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());

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
const ADMIN = 'admin-1';
const POPULATION = 300;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'a@b.c' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'], createdAt: '2020-01-01T00:00:00.000Z' });

    /*
     *   Seeded OLDEST FIRST and with ascending ids, so that document-id order
     *   — which is what an unordered query returns — agrees with age. That is
     *   deliberate: it makes the defect HARDER to show, not easier. The window
     *   the old code fetched was the newest rows by explicit desc order, so if
     *   the oldest come back it is because the order was honoured and not
     *   because the seeding happened to line up.
     */
    for (let i = 0; i < POPULATION; i++) {
        const day = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString();
        store.seed(COLLECTIONS.USERS, `u-${String(i).padStart(3, '0')}`, {
            email: `u${i}@example.com`,
            fullName: `User ${i}`,
            createdAt: day,
            roles: ['member'],
            gender: i % 2 === 0 ? 'female' : 'male',
        });
    }
});

const list = async (options: Record<string, unknown>) => {
    const { getUsersAction } = await import('@/app/actions/admin/_users');
    return (await getUsersAction(options as any)) as any;
};

const emailsOf = (res: any) => ((res.data ?? []) as any[]).map(u => u.email);

// ─────────────────────────────────────────────────────────────────────────────
describe('#776 — the sort control returns the rows it names', () => {
    it('OLDEST FIRST RETURNS THE OLDEST ACCOUNTS', async () => {
        //   THE test. Before the fix this returned u190…u199 — the oldest of
        //   the newest window — and u0 appeared on no page at all.
        const res = await list({ page: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'asc' });

        expect(res.success).toBe(true);
        expect(emailsOf(res).slice(0, 3)).toEqual([
            'u0@example.com', 'u1@example.com', 'u2@example.com',
        ]);
    });

    it('and newest first still returns the newest', async () => {
        //   The vacuity guard: a fix that simply inverted the literal would
        //   break this, and "desc" was the one direction that used to work.
        const res = await list({ page: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });

        expect(emailsOf(res).slice(0, 3)).toEqual([
            'u299@example.com', 'u298@example.com', 'u297@example.com',
        ]);
    });

    it('THE TWO DIRECTIONS DISAGREE, which is the whole point of the control', async () => {
        //   Asserted as DATA FLOW rather than as two independent snapshots: if
        //   the direction were ignored again in any way, these would converge.
        const asc = await list({ page: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'asc' });
        const desc = await list({ page: 0, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });

        expect(emailsOf(asc)).not.toEqual(emailsOf(desc));
        //   and no row is in both ends of a 300-row population
        const overlap = emailsOf(asc).filter(e => emailsOf(desc).includes(e));
        expect(overlap).toEqual([]);
    });

    it('the oldest account is reachable on PAGE ONE, not merely somewhere', async () => {
        //   The defect was not a wrong ordering of the right rows — it was the
        //   wrong rows. Paging forward never reached u0 because every page
        //   re-fetched from the newest end.
        const res = await list({ page: 0, limit: 5, sortBy: 'createdAt', sortOrder: 'asc' });

        expect(emailsOf(res)).toContain('u0@example.com');
    });

    it('and ascending order is monotonic across the returned page', async () => {
        const res = await list({ page: 0, limit: 25, sortBy: 'createdAt', sortOrder: 'asc' });
        const times = ((res.data ?? []) as any[]).map(u => new Date(u.createdAt).getTime());

        expect(times).toEqual([...times].sort((a, b) => a - b));
    });
});
