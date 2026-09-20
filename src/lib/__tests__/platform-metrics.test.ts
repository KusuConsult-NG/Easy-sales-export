/**
 * Tests for getPlatformMetricsAction in src/app/actions/global-aggregation.ts.
 *
 * The admin dashboard's revenue figure was wrong three ways at once: it summed
 * at most 5,000 fetched rows, it discarded a .count() query in favour of that
 * truncated array's length, and a failed query returned success with the totals
 * left at zero — so a broken dashboard looked like a quiet day.
 *
 * The sum now happens in Postgres. What these cover is the contract around it,
 * and especially the last point: a failure must NOT present as ₦0.
 */

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: { rpc: (...args: any[]) => mockRpc(...args) },
    supabase: {},
}));

jest.mock("@/lib/require-admin", () => ({
    requireAdmin: jest.fn(() => Promise.resolve({ session: { user: { id: "admin-1" } } })),
}));

import { getPlatformMetricsAction } from "@/app/actions/global-aggregation";

beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
    /*
     *   #747 — the user figure is four aggregates now, not one: every row, then
     *   the erased, the superseded, and the overlap, so a tombstoned account is
     *   subtracted exactly once. The adapter mock answers them in that order.
     *
     *   41,000 rows of which none is a tombstone, so the reported figure is
     *   41,000 — the same number this asserted before, now arrived at through
     *   the subtraction rather than around it.
     */
    global.mockFirestoreGet
        .mockResolvedValueOnce({ data: () => ({ count: 41_000 }) })   // all rows
        .mockResolvedValueOnce({ data: () => ({ count: 0 }) })        // erased
        .mockResolvedValueOnce({ data: () => ({ count: 0 }) })        // superseded
        .mockResolvedValueOnce({ data: () => ({ count: 0 }) })        // both
        .mockResolvedValue({ data: () => ({ count: 0 }) });
});

describe("getPlatformMetricsAction", () => {
    it("reports the totals the database computed", async () => {
        mockRpc.mockResolvedValue({
            data: [{ total_revenue: 128_450_000, transaction_count: 92_310 }],
            error: null,
        });

        const result = await getPlatformMetricsAction();

        expect(result.success).toBe(true);
        // Both figures exceed the old 5,000-row cap — the point of the fix.
        expect(result.data?.totalRevenue).toBe(128_450_000);
        expect(result.data?.totalTransactions).toBe(92_310);
        expect(result.data?.totalUsers).toBe(41_000);
    });

    it("does not count erased accounts or superseded duplicates as users", async () => {
        /*
         *   #747 — the defect. `totalUsers` was every ROW, so an account erased
         *   at the person's request and a duplicate profile #724's resolver had
         *   already superseded were both counted as users.
         *
         *   41,000 rows: 900 erased, 400 superseded, 100 of them both. The
         *   overlap is added back, so 41,000 - 900 - 400 + 100 = 39,800.
         *
         *   #804 — THREE AGGREGATES NOW, NOT FOUR. The superseded side is a
         *   READ, because a `.count()` cannot ask whether a pointer names
         *   another row. This mock queues results positionally, so the third
         *   one had to become a page of rows; left as a count it silently
         *   supplied no `docs`, nothing was subtracted for supersession, and
         *   the figure came back 40,100.
         *
         *   THE FIVE SELF-POINTING ROWS ARE THE POINT OF THE CHANGE. They
         *   carry `_migratedTo`, so the query returns them, and they are
         *   people — resolveActiveUser stops there and signs them in. The
         *   expected total is unchanged BECAUSE they are not subtracted.
         */
        //   mockReset, not clearAllMocks: the latter keeps queued `once`
        //   implementations, so the ones this block sets would have queued
        //   BEHIND those from beforeEach and never been read.
        global.mockFirestoreGet.mockReset();
        mockRpc.mockResolvedValue({
            data: [{ total_revenue: 1, transaction_count: 1 }],
            error: null,
        });

        const pointing = [
            ...Array.from({ length: 100 }, (_, i) => ({
                id: `both${i}`, data: () => ({ _migratedTo: "live", deleted: true }),
            })),
            ...Array.from({ length: 300 }, (_, i) => ({
                id: `gone${i}`, data: () => ({ _migratedTo: "live" }),
            })),
            ...Array.from({ length: 5 }, (_, i) => ({
                id: `self${i}`, data: () => ({ _migratedTo: `self${i}` }),
            })),
        ];

        global.mockFirestoreGet
            .mockResolvedValueOnce({ data: () => ({ count: 41_000 }) })
            .mockResolvedValueOnce({ data: () => ({ count: 900 }) })
            .mockResolvedValueOnce({ docs: pointing })
            .mockResolvedValue({ data: () => ({ count: 0 }) });

        const result = await getPlatformMetricsAction();

        expect(result.data?.totalUsers).toBe(39_800);
    });

    it("takes the transaction count from the database, not a row count", async () => {
        mockRpc.mockResolvedValue({
            data: [{ total_revenue: 500, transaction_count: 92_310 }],
            error: null,
        });

        const result = await getPlatformMetricsAction();

        // The old code reported docs.length, which was capped at 5,000 no
        // matter how many payments existed.
        expect(result.data?.totalTransactions).toBe(92_310);
        expect(result.data?.totalTransactions).toBeGreaterThan(5_000);
    });

    it("fails loudly instead of reporting zero revenue", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });

        const result = await getPlatformMetricsAction();

        // This is the important one. The old code returned
        // success: true, error: null with totalRevenue = 0, so an outage was
        // indistinguishable from a day with no sales.
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toMatch(/revenue/i);
    });

    it("reports a genuine zero as a zero", async () => {
        mockRpc.mockResolvedValue({
            data: [{ total_revenue: 0, transaction_count: 0 }],
            error: null,
        });

        const result = await getPlatformMetricsAction();

        // A real zero is still success — the distinction that matters is
        // between "no revenue" and "could not tell".
        expect(result.success).toBe(true);
        expect(result.data?.totalRevenue).toBe(0);
    });

    it("coerces the numeric strings Postgres returns", async () => {
        // node-postgres returns NUMERIC as a string to preserve precision.
        mockRpc.mockResolvedValue({
            data: [{ total_revenue: "128450000.50", transaction_count: "92310" }],
            error: null,
        });

        const result = await getPlatformMetricsAction();

        expect(result.data?.totalRevenue).toBe(128_450_000.5);
        expect(result.data?.totalTransactions).toBe(92_310);
    });
});
