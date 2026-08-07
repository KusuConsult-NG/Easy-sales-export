/**
 * Tests for the compare-and-swap in src/lib/status-transition.ts.
 *
 * The mutual exclusion itself is enforced by a conditional UPDATE in Postgres
 * and cannot be proven here — it needs two concurrent sessions. What these
 * cover is the contract callers depend on, and the distinction that matters
 * most: `claimed: false` with a status means somebody else advanced the record,
 * while `claimed: false` with a null status means the record does not exist.
 *
 * Confusing those two in the withdrawal flow is how you either pay a user
 * twice or refuse a legitimate payout.
 */

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: { rpc: (...args: any[]) => mockRpc(...args) },
    supabase: {},
}));

import { claimStatusTransition } from "@/lib/status-transition";

beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe("claimStatusTransition", () => {
    it("reports a won claim with the new status", async () => {
        mockRpc.mockResolvedValue({
            data: [{ claimed: true, status: "payout_initiated" }],
            error: null,
        });

        const result = await claimStatusTransition({
            collection: "wallet_transactions",
            id: "txn-1",
            from: "pending",
            to: "payout_initiated",
            patch: { processedBy: "admin-1" },
        });

        expect(result).toEqual({ claimed: true, status: "payout_initiated" });
        expect(mockRpc).toHaveBeenCalledWith("claim_status_transition", {
            p_collection: "wallet_transactions",
            p_id: "txn-1",
            p_from: "pending",
            p_to: "payout_initiated",
            p_patch: { processedBy: "admin-1" },
        });
    });

    it("reports a lost claim with the status the winner set", async () => {
        mockRpc.mockResolvedValue({
            data: [{ claimed: false, status: "payout_initiated" }],
            error: null,
        });

        const result = await claimStatusTransition({
            collection: "wallet_transactions",
            id: "txn-1",
            from: "pending",
            to: "payout_initiated",
        });

        // Another admin got there first. The caller must NOT proceed to the
        // Paystack transfer — this is the double-payout that used to get through.
        expect(result.claimed).toBe(false);
        expect(result.status).toBe("payout_initiated");
    });

    it("distinguishes a missing record from a lost claim", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: false, status: null }], error: null });

        const result = await claimStatusTransition({
            collection: "wallet_transactions",
            id: "does-not-exist",
            from: "pending",
            to: "payout_initiated",
        });

        expect(result.claimed).toBe(false);
        // null status = no such record, which is a different failure from
        // "somebody else is handling it" and reported differently to the admin.
        expect(result.status).toBeNull();
    });

    it("defaults patch to an empty object", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: true, status: "completed" }], error: null });

        await claimStatusTransition({
            collection: "c",
            id: "i",
            from: "a",
            to: "b",
        });

        expect(mockRpc).toHaveBeenCalledWith(
            "claim_status_transition",
            expect.objectContaining({ p_patch: {} })
        );
    });

    it("requires collection, id, from and to", async () => {
        await expect(
            claimStatusTransition({ collection: "", id: "i", from: "a", to: "b" })
        ).rejects.toThrow(/collection is required/);

        await expect(
            claimStatusTransition({ collection: "c", id: "", from: "a", to: "b" })
        ).rejects.toThrow(/id is required/);

        await expect(
            claimStatusTransition({ collection: "c", id: "i", from: "", to: "b" })
        ).rejects.toThrow(/from and to are required/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("throws when the database call fails, rather than reporting a claim", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });

        // Must throw: silently returning claimed:false would look like "someone
        // else has it" and quietly skip a payout that nobody is making.
        await expect(
            claimStatusTransition({ collection: "c", id: "i", from: "a", to: "b" })
        ).rejects.toThrow(/Status transition failed/);
    });

    it("throws when the database returns no row", async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });

        await expect(
            claimStatusTransition({ collection: "c", id: "i", from: "a", to: "b" })
        ).rejects.toThrow(/no result/);
    });
});
