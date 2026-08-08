/**
 * Schema-level guarantees, against a real Postgres.
 *
 * Triggers, row-level security and SQL aggregates are invisible to the mocked
 * adapter — it does not run Postgres, so it cannot enforce a constraint or
 * refuse a read. These are exactly the places where "it looked right" and "it
 * works" came apart today.
 *
 * Requires migrations 004, 008 and 012.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";

async function cleanup() {
    await supabaseAdmin.from("cooperative_members").delete().like("id", `${TEST_PREFIX}%`);
    await supabaseAdmin.from("processed_payments").delete().like("id", `${TEST_PREFIX}%`);
}

maybeDescribe("member status trigger (008), against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    const memberId = `${TEST_PREFIX}member-1`;
    const userId = `${TEST_PREFIX}user-1`;

    async function addPayment(id: string, type: string) {
        await supabaseAdmin.from("processed_payments").insert({
            id, user_id: userId, amount: 100, reference: id,
            raw_data: { type, status: type === "contribution" ? "completed" : "wallet_debit" },
        });
    }

    it("lets someone with an unrelated payment apply to the cooperative", async () => {
        await addPayment(`${TEST_PREFIX}pay-marketplace`, "wallet_debit");

        // Applications start at 'pending'. The old trigger fired on INSERT for
        // ANY payment, so anyone who had ever paid for anything could not join
        // the cooperative at all.
        const { error } = await supabaseAdmin
            .from("cooperative_members")
            .insert({ id: memberId, user_id: userId, status: "pending" });

        expect(error).toBeNull();
    });

    it("does not treat a marketplace payment as cooperative dues", async () => {
        await addPayment(`${TEST_PREFIX}pay-marketplace`, "wallet_debit");
        await supabaseAdmin.from("cooperative_members")
            .insert({ id: memberId, user_id: userId, status: "active" });

        const { error } = await supabaseAdmin
            .from("cooperative_members")
            .update({ status: "pending" })
            .eq("id", memberId);

        expect(error).toBeNull();
    });

    it("still protects a member who has actually contributed", async () => {
        await addPayment(`${TEST_PREFIX}pay-contribution`, "contribution");
        await supabaseAdmin.from("cooperative_members")
            .insert({ id: memberId, user_id: userId, status: "active" });

        const { error } = await supabaseAdmin
            .from("cooperative_members")
            .update({ status: "pending" })
            .eq("id", memberId);

        // The protection the trigger exists for. Narrowing it must not remove it.
        expect(error).not.toBeNull();
    });

    it("allows a refund when a reason is recorded", async () => {
        await addPayment(`${TEST_PREFIX}pay-contribution`, "contribution");
        await supabaseAdmin.from("cooperative_members")
            .insert({ id: memberId, user_id: userId, status: "active", raw_data: {} });

        const { error } = await supabaseAdmin
            .from("cooperative_members")
            .update({
                status: "pending",
                raw_data: { statusChangeReason: "Contribution refunded" },
            })
            .eq("id", memberId);

        // Support could not do this at all before — the rule is now "say why",
        // not "you may not".
        expect(error).toBeNull();
    });
});

maybeDescribe("row-level security (004), against real Postgres", () => {
    it("refuses to read users with the public anon key", async () => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!anonKey) {
            // Not fatal: the service-role key alone is enough for every other
            // test here. Say so rather than passing silently.
            console.warn("[db-integration] NEXT_PUBLIC_SUPABASE_ANON_KEY not set — skipping the RLS check");
            return;
        }

        const anon = createClient(url, anonKey);
        const { data, error } = await anon.from("users").select("*").limit(5);

        // The whole point of 004: the key that ships in the JavaScript bundle
        // must not be able to read the users table. Either an empty result or
        // an explicit refusal is correct; rows coming back is not.
        if (error) {
            expect(error).toBeTruthy();
        } else {
            expect(data).toEqual([]);
        }
    });
});

maybeDescribe("platform_revenue_totals (012), against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("sums completed payments and excludes wallet debits", async () => {
        const before = await supabaseAdmin.rpc("platform_revenue_totals");
        const baseline = Number(
            (Array.isArray(before.data) ? before.data[0] : before.data)?.total_revenue ?? 0
        );

        await supabaseAdmin.from("processed_payments").insert([
            {
                id: `${TEST_PREFIX}rev-1`, user_id: "u1", amount: 1000, reference: `${TEST_PREFIX}rev-1`,
                raw_data: { amount: 1000, status: "completed" },
            },
            {
                id: `${TEST_PREFIX}rev-2`, user_id: "u1", amount: 500, reference: `${TEST_PREFIX}rev-2`,
                raw_data: { amount: 500, status: "completed" },
            },
            {
                // A wallet debit. Counting this would bank the same money twice:
                // once when the wallet was funded, again when it was spent.
                id: `${TEST_PREFIX}rev-3`, user_id: "u1", amount: 9999, reference: `${TEST_PREFIX}rev-3`,
                raw_data: { amount: 9999, status: "wallet_debit" },
            },
        ]);

        const after = await supabaseAdmin.rpc("platform_revenue_totals");
        const total = Number(
            (Array.isArray(after.data) ? after.data[0] : after.data)?.total_revenue ?? 0
        );

        expect(total - baseline).toBe(1500);
    });

    it("reads the amount the application reads", async () => {
        const before = await supabaseAdmin.rpc("platform_revenue_totals");
        const baseline = Number(
            (Array.isArray(before.data) ? before.data[0] : before.data)?.total_revenue ?? 0
        );

        // Column and raw_data deliberately disagree. raw_data is what the
        // adapter returns, so raw_data is what must be summed — the same
        // distinction that made migrations 005/006 update a value nobody read.
        await supabaseAdmin.from("processed_payments").insert({
            id: `${TEST_PREFIX}rev-drift`, user_id: "u1", amount: 111, reference: `${TEST_PREFIX}rev-drift`,
            raw_data: { amount: 222, status: "completed" },
        });

        const after = await supabaseAdmin.rpc("platform_revenue_totals");
        const total = Number(
            (Array.isArray(after.data) ? after.data[0] : after.data)?.total_revenue ?? 0
        );

        expect(total - baseline).toBe(222);
    });
});
