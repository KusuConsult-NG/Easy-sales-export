/**
 * Wallet money movement, against a real Postgres.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Migrations 005/006 moved money by updating `wallets.balance`, the native SQL
 * column. That passed the unit suite, code review, and a staging check — and
 * was still broken, because the application reads `raw_data->>'balance'` and
 * never consults the column. A credit changed a value nobody could see.
 *
 * Every check that passed was querying the same column the bug was writing to.
 * These tests assert on what the ADAPTER returns — the path the application
 * actually uses — so the two cannot agree with each other while both being
 * wrong.
 *
 * Requires migrations 005, 006, 010 and 011.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";
import { creditWalletOnce, debitWalletOnce, debitJsonbBalance } from "@/lib/wallet-ledger";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

/** Prefix so anything left behind is obvious and easy to sweep. */
const TEST_PREFIX = "jest-db-";
const userId = `${TEST_PREFIX}user-1`;

async function cleanup() {
    await supabaseAdmin.from("processed_payments").delete().like("id", `${TEST_PREFIX}%`);
    await supabaseAdmin.from("wallets").delete().like("id", `${TEST_PREFIX}%`);
}

/**
 * Creates a wallet the way the adapter does — balance in BOTH raw_data and the
 * native column. A wallet created with only the column would hide the very bug
 * this file exists to catch.
 */
async function seedWallet(balance: number) {
    await supabaseAdmin.from("wallets").upsert({
        id: userId,
        balance,
        raw_data: { id: userId, userId, balance, currency: "NGN" },
    });
}

/** Reads the balance the way the APPLICATION does, through the adapter. */
async function readBalanceAsApp(): Promise<number> {
    const snap = await db.collection(COLLECTIONS.WALLETS).doc(userId).get();
    return Number(snap.data()?.balance ?? 0);
}

/** Reads the native column directly — what the earlier checks looked at. */
async function readNativeColumn(): Promise<number> {
    const { data } = await supabaseAdmin.from("wallets").select("balance").eq("id", userId).single();
    return Number(data?.balance ?? 0);
}

maybeDescribe("wallet balance, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("a credit is visible to the application, not just to the column", async () => {
        await seedWallet(100);

        const result = await creditWalletOnce({
            reference: `${TEST_PREFIX}ref-1`,
            userId,
            amount: 50,
            paymentType: "wallet_funding",
        });

        expect(result.claimed).toBe(true);

        // THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG.
        // Before migration 011 this read 100 while the column read 150.
        await expect(readBalanceAsApp()).resolves.toBe(150);
        await expect(readNativeColumn()).resolves.toBe(150);
    });

    it("keeps both copies in step across several movements", async () => {
        await seedWallet(1000);

        await creditWalletOnce({ reference: `${TEST_PREFIX}ref-2`, userId, amount: 500 });
        await debitWalletOnce({ reference: `${TEST_PREFIX}ref-3`, userId, amount: 200 });
        await creditWalletOnce({ reference: `${TEST_PREFIX}ref-4`, userId, amount: 50 });

        const asApp = await readBalanceAsApp();
        const asColumn = await readNativeColumn();

        expect(asApp).toBe(1350);
        // Drift between these two is the failure mode; the values matching is
        // the property, not either number on its own.
        expect(asColumn).toBe(asApp);
    });

    it("credits the same reference exactly once", async () => {
        await seedWallet(0);

        const first = await creditWalletOnce({ reference: `${TEST_PREFIX}dupe`, userId, amount: 750 });
        const second = await creditWalletOnce({ reference: `${TEST_PREFIX}dupe`, userId, amount: 750 });

        expect(first.claimed).toBe(true);
        expect(second.claimed).toBe(false);
        // A duplicated Paystack webhook must not pay twice.
        await expect(readBalanceAsApp()).resolves.toBe(750);
    });

    it("does not overdraw", async () => {
        await seedWallet(100);

        const result = await debitWalletOnce({
            reference: `${TEST_PREFIX}over`,
            userId,
            amount: 500,
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("insufficient_funds");
        await expect(readBalanceAsApp()).resolves.toBe(100);
    });

    it("sums concurrent credits instead of losing one", async () => {
        await seedWallet(0);

        // The property no single-threaded test can show: two credits in flight
        // at once must both land. Under a read-modify-write both would read 0
        // and the second would overwrite the first.
        await Promise.all([
            creditWalletOnce({ reference: `${TEST_PREFIX}c1`, userId, amount: 100 }),
            creditWalletOnce({ reference: `${TEST_PREFIX}c2`, userId, amount: 200 }),
            creditWalletOnce({ reference: `${TEST_PREFIX}c3`, userId, amount: 300 }),
        ]);

        await expect(readBalanceAsApp()).resolves.toBe(600);
    });

    it("does not count a debit as revenue", async () => {
        await seedWallet(1000);

        await debitWalletOnce({
            reference: `${TEST_PREFIX}debit-status`,
            userId,
            amount: 100,
            purpose: "marketplace_checkout",
        });

        const { data } = await supabaseAdmin
            .from("processed_payments")
            .select("raw_data")
            .eq("id", `${TEST_PREFIX}debit-status`)
            .single();

        // global-aggregation sums rows with status "completed" as revenue.
        // Wallet spending is not income; recording it as completed would bank
        // the same money twice.
        expect(data?.raw_data?.status).toBe("wallet_debit");
        expect(data?.raw_data?.status).not.toBe("completed");
    });
});

maybeDescribe("debitJsonbBalance, against real Postgres", () => {
    /**
     * Cooperative savings live in raw_data, not a native column, so the wallet
     * functions do not reach them. Two paths debited them with a read-check-
     * write: two withdrawals at once both passed the sufficiency check and both
     * deducted, taking a member's savings negative.
     *
     * Requires migration 013.
     */

    const memberId = `${TEST_PREFIX}member-1`;

    async function seedMember(savingsBalance: number) {
        await supabaseAdmin.from("cooperative_members").upsert({
            id: memberId,
            user_id: memberId,
            status: "active",
            raw_data: { id: memberId, userId: memberId, savingsBalance, membershipStatus: "active" },
        });
    }

    async function readSavings(): Promise<number> {
        const { data } = await supabaseAdmin
            .from("cooperative_members")
            .select("raw_data")
            .eq("id", memberId)
            .single();
        return Number(data?.raw_data?.savingsBalance ?? 0);
    }

    afterAll(async () => {
        await supabaseAdmin.from("cooperative_members").delete().like("id", `${TEST_PREFIX}%`);
    });

    it("debits a raw_data balance", async () => {
        await seedMember(1000);

        const result = await debitJsonbBalance({
            table: "cooperative_members", id: memberId, field: "savingsBalance", amount: 400,
        });

        expect(result.ok).toBe(true);
        await expect(readSavings()).resolves.toBe(600);
    });

    it("refuses to overdraw", async () => {
        await seedMember(500);

        const result = await debitJsonbBalance({
            table: "cooperative_members", id: memberId, field: "savingsBalance", amount: 900,
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("insufficient_funds");
        await expect(readSavings()).resolves.toBe(500);
    });

    it("does not let concurrent debits take savings negative", async () => {
        await seedMember(1000);

        // Three withdrawals of 400 against 1000. Exactly two can succeed.
        // Under the old read-check-write all three passed the check and the
        // balance ended at -200.
        const results = await Promise.all([
            debitJsonbBalance({ table: "cooperative_members", id: memberId, field: "savingsBalance", amount: 400 }),
            debitJsonbBalance({ table: "cooperative_members", id: memberId, field: "savingsBalance", amount: 400 }),
            debitJsonbBalance({ table: "cooperative_members", id: memberId, field: "savingsBalance", amount: 400 }),
        ]);

        expect(results.filter(r => r.ok)).toHaveLength(2);
        const remaining = await readSavings();
        expect(remaining).toBe(200);
        expect(remaining).toBeGreaterThanOrEqual(0);
    });
});
