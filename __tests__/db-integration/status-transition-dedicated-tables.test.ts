/**
 * Can a status transition be claimed on a DEDICATED TABLE?
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * claim_status_transition (migration 007) takes a COLLECTION and updates
 *
 *     document_collections
 *     WHERE id = p_id AND collection_name = p_collection
 *
 * It has no table parameter. Eight collections do not live in
 * document_collections at all — DEDICATED_TABLE_MAP in supabase-db.ts routes
 * them to their own tables — and two of those are passed to this function:
 *
 *   COLLECTIONS.COOPERATIVE_LOANS   = "cooperative_loans"  → dedicated
 *   COLLECTIONS.MARKETPLACE_ORDERS  = "marketplaceOrders"  → dedicated
 *
 * The loan case is confirmed by hand: /api/admin/cooperative/approve-loan
 * answers 409 on a member-filed application whose row plainly reads status
 * "pending", because the claim looks in document_collections, finds nothing,
 * and returns claimed:false — which the route reports as "already X".
 *
 * MARKETPLACE_ORDERS is the one that matters more. It has four
 * claimStatusTransition call sites on the order state machine, and if it
 * behaves the same way then order transitions through the claimed path never
 * succeed. That is money-adjacent and would be a live defect far beyond the
 * loan queue.
 *
 * This measures it directly rather than inferring it. No browser, no route —
 * write a row to the real table, ask the real RPC to advance it, and look at
 * what comes back and at what the row actually holds afterwards.
 *
 * THE CONTROL CASE IS THE POINT. A document_collections row is transitioned
 * first. If that also failed, the finding would be "the RPC is broken", not
 * "the RPC cannot see dedicated tables" — and the two need different fixes.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { claimStatusTransition } from "@/lib/status-transition";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

const ID_GENERIC = "jest-cas-generic";
const ID_ORDER = "jest-cas-order";
const ID_LOAN = "jest-cas-loan";
const GENERIC_COLLECTION = "jest_cas_docs";

async function cleanup() {
    await supabaseAdmin.from("document_collections").delete().eq("collection_name", GENERIC_COLLECTION);
    await supabaseAdmin.from("marketplace_orders").delete().eq("id", ID_ORDER);
    await supabaseAdmin.from("cooperative_loans").delete().eq("id", ID_LOAN);
}

maybeDescribe("claim_status_transition across storage layouts", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("advances a document_collections row — the control case", async () => {
        // If this fails, the RPC itself is broken and nothing below means what
        // it appears to mean.
        await supabaseAdmin.from("document_collections").insert({
            id: ID_GENERIC,
            collection_name: GENERIC_COLLECTION,
            raw_data: { id: ID_GENERIC, status: "pending" },
        });

        const result = await claimStatusTransition({
            collection: GENERIC_COLLECTION,
            id: ID_GENERIC,
            from: "pending",
            to: "approved",
        });

        expect(result.claimed).toBe(true);

        const { data } = await supabaseAdmin
            .from("document_collections")
            .select("raw_data")
            .eq("id", ID_GENERIC)
            .single();
        expect((data?.raw_data as any)?.status).toBe("approved");
    });

    it("advances a MARKETPLACE ORDER, which lives in its own table", async () => {
        // THE ASSERTION THIS FILE WAS WRITTEN FOR.
        //
        // COLLECTIONS.MARKETPLACE_ORDERS is "marketplaceOrders", which
        // DEDICATED_TABLE_MAP routes to the marketplace_orders table. Four call
        // sites drive the order state machine through this function.
        await supabaseAdmin.from("marketplace_orders").insert({
            id: ID_ORDER,
            user_id: "jest-cas-buyer",
            status: "pending",
            total_amount: 25000,
            raw_data: { id: ID_ORDER, status: "pending", buyerId: "jest-cas-buyer", totalAmount: 25000 },
        });

        const result = await claimStatusTransition({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: ID_ORDER,
            from: "pending",
            to: "paid",
        });

        expect(result.claimed).toBe(true);

        // And the row must actually say so. A claim that reports success
        // without moving the row would be the worse outcome of the two.
        const { data } = await supabaseAdmin
            .from("marketplace_orders")
            .select("status, raw_data")
            .eq("id", ID_ORDER)
            .single();
        expect((data?.raw_data as any)?.status).toBe("paid");
    });

    it("advances a COOPERATIVE LOAN, which lives in its own table", async () => {
        // The case confirmed by hand through the admin approval route's 409.
        await supabaseAdmin.from("cooperative_loans").insert({
            id: ID_LOAN,
            user_id: "jest-cas-member",
            amount: 20000,
            status: "pending",
            raw_data: { id: ID_LOAN, status: "pending", memberId: "jest-cas-member", amount: 20000 },
        });

        const result = await claimStatusTransition({
            collection: COLLECTIONS.COOPERATIVE_LOANS,
            id: ID_LOAN,
            from: "pending",
            to: "approved",
        });

        expect(result.claimed).toBe(true);

        const { data } = await supabaseAdmin
            .from("cooperative_loans")
            .select("status, raw_data")
            .eq("id", ID_LOAN)
            .single();
        expect((data?.raw_data as any)?.status).toBe("approved");
    });

    it("refuses a second claim on a dedicated-table row — the guarantee that matters", async () => {
        // The whole purpose of a compare-and-swap: exactly one caller may make
        // a given transition. Once the transition works on a dedicated table at
        // all, this is what stops an order being paid twice or a loan approved
        // twice. Asserting it here so a future fix cannot satisfy the tests
        // above by making the claim unconditional.
        await supabaseAdmin.from("marketplace_orders").insert({
            id: ID_ORDER,
            user_id: "jest-cas-buyer",
            status: "pending",
            total_amount: 25000,
            raw_data: { id: ID_ORDER, status: "pending" },
        });

        const first = await claimStatusTransition({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: ID_ORDER,
            from: "pending",
            to: "paid",
        });
        const second = await claimStatusTransition({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: ID_ORDER,
            from: "pending",
            to: "paid",
        });

        expect(first.claimed).toBe(true);
        expect(second.claimed).toBe(false);
        expect(second.status).toBe("paid");
    });
});
