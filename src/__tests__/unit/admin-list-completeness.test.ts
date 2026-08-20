/**
 * @jest-environment node
 */

/**
 * THE ADMIN MARKETPLACE USER LIST WAS A CAPPED QUERY WITH A DEAD LIMIT BESIDE IT.
 *
 * `_getMarketplaceUsersAction` computed
 *
 *     const fetchLimit = options.search ? 5000 : (options.limit || 50);
 *
 * one line above its query and never applied it to anything. That reads as a
 * harmless leftover, and it is not, because of what the line below it did:
 *
 *     const snapshot = await q.get();
 *
 * `.get()` on a query carrying no `.limit()` does not return everything. The
 * adapter stops at DEFAULT_QUERY_LIMIT — 5,000 rows — and hands back a snapshot
 * that looks exactly like a complete one. Everything the action does afterwards
 * runs over that snapshot in memory: the name/email/phone search, `stats.total`
 * and the buyer/seller/both counts beside it, the role filter, and the paging.
 *
 * So past 5,000 marketplace users the admin's search silently stops finding
 * people who exist, and the totals silently understate — with the list looking
 * complete in both cases. An admin searching for a seller to suspend would be
 * told there is no such account.
 *
 * This is the defect `getCooperativeStatsAction` already carries a long comment
 * about, diagnosed and fixed there (see cooperative-reporting-completeness) and
 * left standing here in a list of people rather than a total of naira.
 *
 * `.all()` is the adapter's answer for a caller that genuinely needs every row —
 * in-memory search over the whole collection is exactly that — and it reports at
 * error level if it reaches its own far higher ceiling. `truncated` rides out in
 * the payload so a partial list can be told from a complete one by the caller
 * and not only in a log.
 *
 * HOW THIS IS MEASURED
 * --------------------
 * By lowering the cap rather than seeding five thousand users:
 * SUPABASE_DEFAULT_QUERY_LIMIT is read per query by both the adapter and the
 * fake, so a cap of 3 reproduces the same truncation against 5 users.
 *
 * AND THE COOPERATIVE DASHBOARD RAN A QUERY IT THREW AWAY
 * ------------------------------------------------------
 * `_getCooperativeStatsAction` opened with
 *
 *     const [metrics, paymentsSnapR] = await Promise.allSettled([...])
 *
 * and no line below it ever mentioned `paymentsSnapR`. It was an unpaginated
 * scan of processed_payments, awaited on every uncached admin dashboard load
 * and discarded.
 *
 * It was also a DUPLICATE. userMetricsService.getCooperativeMemberMetrics —
 * the other half of that same Promise.allSettled — runs the identical query:
 * same collection, same `type == "cooperative_membership_registration"`, same
 * `status == "completed"`, same `.select("userId")`. So the dashboard scanned
 * processed_payments twice in one request and read one of the two results.
 * `paidMembersCount`, the figure the dead half looks like it was for, comes
 * from the live one and always did.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;
const originalCap = process.env.SUPABASE_DEFAULT_QUERY_LIMIT;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

afterEach(() => {
    if (originalCap === undefined) delete process.env.SUPABASE_DEFAULT_QUERY_LIMIT;
    else process.env.SUPABASE_DEFAULT_QUERY_LIMIT = originalCap;
});

/** `count` marketplace users, the last one named distinctively. */
function seedMarketplaceUsers(count: number): void {
    for (let i = 0; i < count; i++) {
        const last = i === count - 1;
        store.seed(COLLECTIONS.USERS, `mp-${i}`, {
            name: last ? 'Chidinma Okonkwo' : `Buyer ${i}`,
            email: last ? 'chidinma@example.com' : `buyer${i}@example.com`,
            roles: ['marketplace_buyer'],
            createdAt: new Date(2026, 0, i + 1).toISOString(),
        });
    }
}

describe('the admin marketplace user list', () => {
    it('finds a user who sits past the default row cap', async () => {
        // THE test. With `.get()` this search returned nothing at all: the two
        // rows beyond the cap never reached the in-memory filter.
        process.env.SUPABASE_DEFAULT_QUERY_LIMIT = '3';
        seedMarketplaceUsers(5);

        const { getMarketplaceUsersAction } = await import('@/app/actions/admin/_marketplace');
        const result: any = await getMarketplaceUsersAction({ search: 'Chidinma' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].email).toBe('chidinma@example.com');
    });

    it('and counts every one of them in the totals beside the list', async () => {
        process.env.SUPABASE_DEFAULT_QUERY_LIMIT = '3';
        seedMarketplaceUsers(5);

        const { getMarketplaceUsersAction } = await import('@/app/actions/admin/_marketplace');
        const result: any = await getMarketplaceUsersAction({});

        expect(result.meta.stats.total).toBe(5);
        expect(result.meta.stats.buyerOnly).toBe(5);
    });

    it('pages over the whole set rather than over the first capped page', async () => {
        process.env.SUPABASE_DEFAULT_QUERY_LIMIT = '3';
        seedMarketplaceUsers(5);

        const { getMarketplaceUsersAction } = await import('@/app/actions/admin/_marketplace');
        const page1: any = await getMarketplaceUsersAction({ limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.hasMore).toBe(true);

        const page3: any = await getMarketplaceUsersAction({ limit: 2, lastDocId: '2' });
        expect(page3.data).toHaveLength(1);
        expect(page3.hasMore).toBe(false);
    });

    it('reports whether the list it returned was complete', async () => {
        seedMarketplaceUsers(2);

        const { getMarketplaceUsersAction } = await import('@/app/actions/admin/_marketplace');
        const result: any = await getMarketplaceUsersAction({});

        // A caller must be able to tell a partial list from a whole one without
        // reading the server log.
        expect(result.meta.stats).toHaveProperty('truncated');
        expect(result.meta.stats.truncated).toBe(false);
    });

    it('still refuses a caller who is not an admin', async () => {
        // Vacuity guard: widening the query must not have widened who may run it.
        actAs('nobody', ['user']);
        seedMarketplaceUsers(2);

        const { getMarketplaceUsersAction } = await import('@/app/actions/admin/_marketplace');
        const result: any = await getMarketplaceUsersAction({});

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unauthorized');
    });
});

describe('the cooperative statistics', () => {
    it('scan processed_payments once, not twice', async () => {
        // The remaining read is the metrics service's, which is the one whose
        // result is used. The removed half asked the database the same question
        // in the same request and dropped the answer.
        store.seed(COLLECTIONS.COOPERATIVE_TRANSACTIONS, 't1', {
            type: 'contribution', status: 'completed', amount: 5000, date: new Date().toISOString(),
        });

        const { getCooperativeStatsAction } = await import('@/app/actions/cooperative/_coop_admin_reports');
        const result: any = await getCooperativeStatsAction();

        expect(result.success).toBe(true);
        const addressed = (globalThis as any).mockFirestoreCollection.mock.calls
            .map((c: any[]) => c[0])
            .filter((name: string) => name === COLLECTIONS.PROCESSED_PAYMENTS);
        expect(addressed).toHaveLength(1);
    });

    it('and still report the contributions they always did', async () => {
        // Vacuity guard: the removal must not have taken a live figure with it.
        store.seed(COLLECTIONS.COOPERATIVE_TRANSACTIONS, 't1', {
            type: 'contribution', status: 'completed', amount: 5000, date: new Date().toISOString(),
        });

        const { getCooperativeStatsAction } = await import('@/app/actions/cooperative/_coop_admin_reports');
        const result: any = await getCooperativeStatsAction();

        expect(result.data.stats.totalContributions).toBe(5000);
    });
});
