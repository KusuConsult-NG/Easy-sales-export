/**
 * Payment claiming and status transitions, against a real Postgres.
 *
 * These cover the primitives behind the fulfilment paths: claim_payment_once
 * (migration 009) and claim_status_transition (007). Both decide which of two
 * concurrent callers proceeds, and neither can be demonstrated against a mock —
 * the mocked adapter has no notion of two callers at all.
 *
 * What they protect:
 *
 *   claim_payment_once      a retried Paystack webhook fulfilling an order
 *                           twice — duplicate escrow, duplicate seller credits
 *   claim_status_transition two admins approving one withdrawal and both
 *                           reaching the Paystack transfer
 *
 * Requires migrations 007 and 009.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { claimPaymentOnce } from "@/lib/wallet-ledger";
import { claimStatusTransition } from "@/lib/status-transition";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const COLLECTION = "jest_db_transitions";

async function cleanup() {
    await supabaseAdmin.from("processed_payments").delete().like("id", `${TEST_PREFIX}%`);
    await supabaseAdmin
        .from("document_collections")
        .delete()
        .eq("collection_name", COLLECTION)
        .like("id", `${TEST_PREFIX}%`);
}

maybeDescribe("claimPaymentOnce, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("lets exactly one caller claim a reference", async () => {
        const reference = `${TEST_PREFIX}claim-1`;

        const first = await claimPaymentOnce({ reference, userId: "u1", amount: 5000, type: "marketplace_order" });
        const second = await claimPaymentOnce({ reference, userId: "u1", amount: 5000, type: "marketplace_order" });

        expect(first.claimed).toBe(true);
        // The retry Paystack sends. Before 009 both callers fulfilled the order.
        expect(second.claimed).toBe(false);
        expect(second.status).toBe("completed");
    });

    it("lets exactly one of several simultaneous deliveries through", async () => {
        const reference = `${TEST_PREFIX}claim-race`;

        // Webhook retries can overlap. Exactly one of these may proceed.
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                claimPaymentOnce({ reference, userId: "u1", amount: 5000, type: "marketplace_order" })
            )
        );

        expect(results.filter(r => r.claimed)).toHaveLength(1);
        expect(results.filter(r => !r.claimed)).toHaveLength(4);
    });

    it("records a status the revenue query will count", async () => {
        const reference = `${TEST_PREFIX}claim-revenue`;
        await claimPaymentOnce({ reference, userId: "u1", amount: 5000, type: "marketplace_order" });

        const { data } = await supabaseAdmin
            .from("processed_payments")
            .select("raw_data")
            .eq("id", reference)
            .single();

        // Money in should count as revenue; the distinction only matters
        // because debits deliberately record something else.
        expect(data?.raw_data?.status).toBe("completed");
    });
});

maybeDescribe("claimStatusTransition, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    async function seedPending(id: string) {
        await supabaseAdmin.from("document_collections").upsert({
            id,
            collection_name: COLLECTION,
            raw_data: { status: "pending" },
        });
    }

    it("lets one caller advance the status and refuses the other", async () => {
        const id = `${TEST_PREFIX}txn-1`;
        await seedPending(id);

        const first = await claimStatusTransition({
            collection: COLLECTION, id, from: "pending", to: "payout_initiated",
            patch: { processedBy: "admin-1" },
        });
        const second = await claimStatusTransition({
            collection: COLLECTION, id, from: "pending", to: "payout_initiated",
            patch: { processedBy: "admin-2" },
        });

        expect(first.claimed).toBe(true);
        // This is the second Paystack transfer that used to go out.
        expect(second.claimed).toBe(false);
        expect(second.status).toBe("payout_initiated");
    });

    it("applies only the winner's patch", async () => {
        const id = `${TEST_PREFIX}txn-2`;
        await seedPending(id);

        await claimStatusTransition({
            collection: COLLECTION, id, from: "pending", to: "payout_initiated",
            patch: { processedBy: "admin-1" },
        });
        await claimStatusTransition({
            collection: COLLECTION, id, from: "pending", to: "payout_initiated",
            patch: { processedBy: "admin-2" },
        });

        const { data } = await supabaseAdmin
            .from("document_collections")
            .select("raw_data")
            .eq("id", id)
            .eq("collection_name", COLLECTION)
            .single();

        // The loser must leave no trace — a half-applied patch would attribute
        // the payout to the wrong admin.
        expect(data?.raw_data?.processedBy).toBe("admin-1");
    });

    it("admits exactly one winner under real concurrency", async () => {
        const id = `${TEST_PREFIX}txn-3`;
        await seedPending(id);

        const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                claimStatusTransition({
                    collection: COLLECTION, id, from: "pending", to: "payout_initiated",
                    patch: { processedBy: `admin-${i}` },
                })
            )
        );

        expect(results.filter(r => r.claimed)).toHaveLength(1);
    });

    it("distinguishes a missing record from a lost claim", async () => {
        const result = await claimStatusTransition({
            collection: COLLECTION,
            id: `${TEST_PREFIX}does-not-exist`,
            from: "pending",
            to: "payout_initiated",
        });

        expect(result.claimed).toBe(false);
        // null means no such record, which a caller must report differently
        // from "somebody else is handling it".
        expect(result.status).toBeNull();
    });
});
