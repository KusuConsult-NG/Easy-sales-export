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
    // The users count still goes through the mocked adapter.
    global.mockFirestoreGet.mockResolvedValue({ data: () => ({ count: 41_000 }) });
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
