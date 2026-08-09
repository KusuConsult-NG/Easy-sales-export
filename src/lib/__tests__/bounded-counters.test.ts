/**
 * Tests for the conditional-decrement primitives in src/lib/wallet-ledger.ts.
 *
 * These wrap migration 015. As with the wallet helpers, the atomicity itself
 * lives in Postgres and cannot be proven here — it needs concurrent sessions.
 * What is covered is the contract the callers depend on, and it is the failure
 * shape that matters most:
 *
 *   - a shortfall must be reported as a RESULT, not thrown, because the caller
 *     has already taken the buyer's money and has to refund rather than crash;
 *   - "sold out" must be distinguishable from "product deleted", because they
 *     are different messages to the buyer and different refund reasons;
 *   - a real database failure must still throw, so it is never mistaken for a
 *     clean "insufficient stock" and silently swallowed.
 *
 * The last one is the trap. If `ok: false` were returned for a connection
 * error, an order would be cancelled as out-of-stock when the stock was fine.
 */

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: { rpc: (...args: any[]) => mockRpc(...args) },
    supabase: {},
}));

import { decrementManyOrFail, incrementWithinCeiling } from "@/lib/wallet-ledger";

beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
});

const ITEMS = [
    { collection: "products", id: "p-a", field: "availableQuantity", amount: 2 },
    { collection: "products", id: "p-b", field: "availableQuantity", amount: 1 },
];

describe("decrementManyOrFail", () => {
    it("reports success when every item was decremented", async () => {
        mockRpc.mockResolvedValue({ data: [{ ok: true, failed_id: null, reason: null }], error: null });

        const result = await decrementManyOrFail(ITEMS);

        expect(result).toEqual({ ok: true, failedId: null, reason: null });
    });

    it("sends every item in one call, so the database can make it all-or-nothing", async () => {
        // The whole point of this function. Looping per item in JS would leave
        // p-a decremented when p-b turns out to be short.
        mockRpc.mockResolvedValue({ data: [{ ok: true, failed_id: null, reason: null }], error: null });

        await decrementManyOrFail(ITEMS);

        expect(mockRpc).toHaveBeenCalledTimes(1);
        expect(mockRpc).toHaveBeenCalledWith("decrement_many_or_fail", { p_items: ITEMS });
    });

    it("returns the short item rather than throwing", async () => {
        // The caller has already claimed the payment by this point. A throw
        // would land in a generic catch and lose the refund context.
        mockRpc.mockResolvedValue({ data: [{ ok: false, failed_id: "p-b", reason: "insufficient" }], error: null });

        const result = await decrementManyOrFail(ITEMS);

        expect(result).toEqual({ ok: false, failedId: "p-b", reason: "insufficient" });
    });

    it("distinguishes a deleted product from a sold-out one", async () => {
        mockRpc.mockResolvedValue({ data: [{ ok: false, failed_id: "p-a", reason: "not_found" }], error: null });

        const result = await decrementManyOrFail(ITEMS);

        expect(result.reason).toBe("not_found");
    });

    it("throws on a database error instead of reporting a shortfall", async () => {
        // If this returned ok:false, a healthy order would be cancelled as
        // out-of-stock and the buyer refunded for nothing.
        mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });

        await expect(decrementManyOrFail(ITEMS)).rejects.toThrow("connection reset");
    });

    it("rejects a non-positive amount before reaching the database", async () => {
        // A zero or negative amount would be an increment in disguise.
        await expect(
            decrementManyOrFail([{ collection: "products", id: "p-a", field: "availableQuantity", amount: 0 }])
        ).rejects.toThrow(/positive/);

        await expect(
            decrementManyOrFail([{ collection: "products", id: "p-a", field: "availableQuantity", amount: -3 }])
        ).rejects.toThrow(/positive/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects the whole batch when any one item is invalid", async () => {
        // Validation happens before the call, so a bad third item must not let
        // the first two through.
        await expect(
            decrementManyOrFail([...ITEMS, { collection: "products", id: "p-c", field: "availableQuantity", amount: NaN }])
        ).rejects.toThrow(/positive/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("treats an empty order as a no-op without calling the database", async () => {
        const result = await decrementManyOrFail([]);

        expect(result.ok).toBe(true);
        expect(mockRpc).not.toHaveBeenCalled();
    });
});

describe("incrementWithinCeiling", () => {
    const SEAT = {
        collection: "wave_training_events",
        id: "evt-1",
        field: "currentParticipants",
        amount: 1,
        ceilingField: "maxParticipants",
    };

    it("takes the seat and reports the new count", async () => {
        mockRpc.mockResolvedValue({ data: [{ ok: true, value: 10, reason: null }], error: null });

        const result = await incrementWithinCeiling(SEAT);

        expect(result).toEqual({ ok: true, value: 10, reason: null });
    });

    it("refuses the seat past the ceiling rather than throwing", async () => {
        // This is the registration that used to succeed: two people took the
        // last seat because the check held no lock.
        mockRpc.mockResolvedValue({ data: [{ ok: false, value: 10, reason: "at_capacity" }], error: null });

        const result = await incrementWithinCeiling(SEAT);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("at_capacity");
    });

    it("distinguishes a missing event from a full one", async () => {
        // The caller shows different messages, and "Event is full" for a
        // deleted event would send someone looking for a session that is gone.
        mockRpc.mockResolvedValue({ data: [{ ok: false, value: 0, reason: "not_found" }], error: null });

        const result = await incrementWithinCeiling(SEAT);

        expect(result.reason).toBe("not_found");
    });

    it("throws on a database error instead of reporting a full event", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "timeout" } });

        await expect(incrementWithinCeiling(SEAT)).rejects.toThrow("timeout");
    });

    it("rejects a non-positive amount before reaching the database", async () => {
        await expect(incrementWithinCeiling({ ...SEAT, amount: 0 })).rejects.toThrow(/positive/);
        expect(mockRpc).not.toHaveBeenCalled();
    });
});
