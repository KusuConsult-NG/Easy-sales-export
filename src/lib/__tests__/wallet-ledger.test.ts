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

import {
    creditWalletOnce,
    debitWalletOnce,
    debitWalletLocked,
    claimPaymentOnce,
} from "@/lib/wallet-ledger";

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

describe("revenue accounting", () => {
    /**
     * processed_payments is summed as revenue in global-aggregation.ts, filtered
     * on status == "completed". Anything that is not money coming in must record
     * a different status, or it inflates reported revenue.
     */

    it("defaults a credit to completed", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: true, balance: 100 }], error: null });

        await creditWalletOnce({ reference: "r", userId: "u", amount: 100 });

        expect(mockRpc).toHaveBeenCalledWith(
            "credit_wallet_once",
            expect.objectContaining({ p_status: "completed" })
        );
    });

    it("records a refund as refund, so it is not counted as revenue", async () => {
        mockRpc.mockResolvedValue({ data: [{ claimed: true, balance: 100 }], error: null });

        await creditWalletOnce({
            reference: "withdrawal-refund:txn-1",
            userId: "u",
            amount: 100,
            status: "refund",
        });

        expect(mockRpc).toHaveBeenCalledWith(
            "credit_wallet_once",
            expect.objectContaining({ p_status: "refund" })
        );
    });
});

describe("claimPaymentOnce", () => {
    /**
     * Used for fulfilment that must happen exactly once per payment but moves
     * no balance — marking an order paid, creating escrow, writing a ledger
     * entry. Paystack retries webhooks, so a duplicate delivery is expected
     * behaviour rather than a rare race.
     */

    it("claims a reference and reports the status recorded", async () => {
        mockRpc.mockResolvedValue({
            data: [{ claimed: true, status: "completed" }],
            error: null,
        });

        const result = await claimPaymentOnce({
            reference: "psk_order_1",
            userId: "buyer-1",
            amount: 25_000,
            type: "marketplace_order",
            source: "webhook",
        });

        expect(result).toEqual({ claimed: true, status: "completed" });
        expect(mockRpc).toHaveBeenCalledWith(
            "claim_payment_once",
            expect.objectContaining({
                p_reference: "psk_order_1",
                p_type: "marketplace_order",
                p_status: "completed",
            })
        );
    });

    it("refuses a duplicate webhook delivery", async () => {
        mockRpc.mockResolvedValue({
            data: [{ claimed: false, status: "completed" }],
            error: null,
        });

        const result = await claimPaymentOnce({
            reference: "psk_order_1",
            userId: "buyer-1",
            amount: 25_000,
        });

        // The caller must return without fulfilling. Doing the work anyway is
        // duplicate escrow rows and duplicate seller credits.
        expect(result.claimed).toBe(false);
        expect(result.status).toBe("completed");
    });

    it("requires a reference", async () => {
        await expect(
            claimPaymentOnce({ reference: "", userId: "u", amount: 1 })
        ).rejects.toThrow(/reference is required/);

        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("throws when the database call fails rather than reporting a claim", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "timeout" } });

        // Returning claimed:false here would look like "already handled" and
        // silently skip fulfilment nobody performed.
        await expect(
            claimPaymentOnce({ reference: "r", userId: "u", amount: 1 })
        ).rejects.toThrow(/Payment claim failed/);
    });
});

describe("debitWalletLocked", () => {
    it("debits without claiming a reference", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ok: true, balance: 4000, reason: null }],
            error: null,
        });

        const result = await debitWalletLocked({ userId: "user-1", amount: 5000 });

        expect(result).toEqual({ ok: true, balance: 4000, reason: null });
        // No reference is sent: a withdrawal request has no stable key, and two
        // genuine requests should both succeed if the funds cover both.
        expect(mockRpc).toHaveBeenCalledWith("debit_wallet_locked", {
            p_user_id: "user-1",
            p_amount: 5000,
        });
    });

    it("refuses when funds are short", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ok: false, balance: 100, reason: "insufficient_funds" }],
            error: null,
        });

        const result = await debitWalletLocked({ userId: "u", amount: 5000 });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("insufficient_funds");
    });

    it("rejects a non-positive amount before calling the database", async () => {
        await expect(debitWalletLocked({ userId: "u", amount: 0 })).rejects.toThrow(
            /must be positive/
        );
        expect(mockRpc).not.toHaveBeenCalled();
    });
});
