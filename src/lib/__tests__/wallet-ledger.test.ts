/**
 * Tests for the atomic wallet money movement in src/lib/wallet-ledger.ts.
 *
 * The database functions these wrap are what actually provide atomicity, and
 * that cannot be proven here — it needs a real Postgres with concurrent
 * sessions. What these tests do cover is the contract the callers depend on:
 * that a duplicate payment is reported as a no-op rather than an error, that a
 * refused debit is distinguishable from a failed one, and that a bad amount is
 * rejected before it ever reaches the database.
 *
 * The subtle one is `claimed: false` / `already_processed`. Both mean "this
 * money already moved". A caller that treats either as a failure will retry a
 * payment that already succeeded.
 */

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: { rpc: (...args: any[]) => mockRpc(...args) },
    supabase: {},
}));

import { creditWalletOnce, debitWalletOnce } from "@/lib/wallet-ledger";

beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe("creditWalletOnce", () => {
    it("reports a claimed credit with the new balance", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: true, balance: 1500 }], error: null });

        const result = await creditWalletOnce({
            reference: "psk_ref_1",
            userId: "user-1",
            amount: 500,
            paymentType: "wallet_funding",
        });

        expect(result).toEqual({ claimed: true, balance: 1500 });
        expect(mockRpc).toHaveBeenCalledWith(
            "credit_wallet_once",
            expect.objectContaining({
                p_reference: "psk_ref_1",
                p_user_id: "user-1",
                p_amount: 500,
            })
        );
    });

    it("reports a duplicate payment as unclaimed rather than throwing", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: false, balance: 1500 }], error: null });

        const result = await creditWalletOnce({
            reference: "psk_ref_1",
            userId: "user-1",
            amount: 500,
        });

        // The money already moved. This must not read as an error, or a caller
        // will retry a payment that already succeeded.
        expect(result.claimed).toBe(false);
        expect(result.balance).toBe(1500);
    });

    it("rejects a non-positive amount before calling the database", async () => {
        await expect(
            creditWalletOnce({ reference: "r", userId: "u", amount: 0 })
        ).rejects.toThrow(/must be positive/);

        await expect(
            creditWalletOnce({ reference: "r", userId: "u", amount: -100 })
        ).rejects.toThrow(/must be positive/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects a non-finite amount before calling the database", async () => {
        await expect(
            creditWalletOnce({ reference: "r", userId: "u", amount: NaN })
        ).rejects.toThrow(/must be positive/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("requires a reference, so a payment cannot be credited unkeyed", async () => {
        await expect(
            creditWalletOnce({ reference: "", userId: "u", amount: 100 })
        ).rejects.toThrow(/reference is required/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("throws when the database call fails, rather than reporting success", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });

        await expect(
            creditWalletOnce({ reference: "r", userId: "u", amount: 100 })
        ).rejects.toThrow(/Wallet credit failed/);
    });

    it("throws when the database returns no row", async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });

        await expect(
            creditWalletOnce({ reference: "r", userId: "u", amount: 100 })
        ).rejects.toThrow(/no result/);
    });
});

describe("debitWalletOnce", () => {
    it("reports a successful debit with the new balance", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ok: true, balance: 500, reason: null }],
            error: null,
        });

        const result = await debitWalletOnce({
            reference: "order:abc",
            userId: "user-1",
            amount: 500,
            purpose: "marketplace_checkout",
        });

        expect(result).toEqual({ ok: true, balance: 500, reason: null });
    });

    it("distinguishes insufficient funds from an already-charged order", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ok: false, balance: 100, reason: "insufficient_funds" }],
            error: null,
        });
        const short = await debitWalletOnce({ reference: "o1", userId: "u", amount: 500 });
        expect(short).toEqual({ ok: false, balance: 100, reason: "insufficient_funds" });

        mockRpc.mockResolvedValue({
            data: [{ ok: false, balance: 100, reason: "already_processed" }],
            error: null,
        });
        const dupe = await debitWalletOnce({ reference: "o1", userId: "u", amount: 500 });
        expect(dupe.reason).toBe("already_processed");

        // Callers branch on these differently: one is a refusal to show the
        // user, the other is a duplicate submission to treat as success.
        expect(short.reason).not.toBe(dupe.reason);
    });

    it("reports a missing wallet distinctly", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ok: false, balance: 0, reason: "no_wallet" }],
            error: null,
        });

        const result = await debitWalletOnce({ reference: "o", userId: "u", amount: 10 });
        expect(result.reason).toBe("no_wallet");
        expect(result.ok).toBe(false);
    });

    it("rejects a non-positive amount before calling the database", async () => {
        await expect(
            debitWalletOnce({ reference: "o", userId: "u", amount: 0 })
        ).rejects.toThrow(/must be positive/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("throws when the database call fails", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });

        await expect(
            debitWalletOnce({ reference: "o", userId: "u", amount: 10 })
        ).rejects.toThrow(/Wallet debit failed/);
    });
});
