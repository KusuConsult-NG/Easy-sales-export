/**
 * A land listing with a purchase in flight cannot be approved or rejected.
 *
 * THE DEFECT
 * ----------
 * /api/admin/farm-nation/approve-land checked only that the listing EXISTED,
 * then wrote `status: "verified"` unconditionally. reject-land did the same with
 * `"rejected"`.
 *
 * "verified" is in PUBLIC_LAND_STATUSES, so it puts the parcel back on the
 * public market. Farm Nation sets `pending_escrow` while a purchase is in flight
 * — verifyPropertyPaymentAction leaves it there with the buyer's money held — so
 * approving a listing that had since gone into escrow made it purchasable again
 * WHILE an escrow was held for the first buyer:
 *
 *   two buyers, two escrows, one parcel, and the first buyer's purchase
 *   silently invalidated because the listing reads as available
 *
 * Rejection was the mirror: it took the parcel off the market while the escrow
 * stayed open, leaving a buyer who had paid for land now marked rejected, with
 * nothing in the flow to release or refund them.
 *
 * WHY THIS IS A DATABASE TEST
 * ---------------------------
 * The fix is claimStatusTransitionFromAny — a compare-and-swap in Postgres
 * (migration 007). A mock cannot demonstrate that two concurrent callers get one
 * winner, which is half of what the guard is for; the other half is refusing a
 * status that is not in the allowed set. Both need the real RPC.
 *
 * These exercise the primitive against the real land_listings collection with
 * the exact status sets the two routes use, rather than going through HTTP.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

const PREFIX = "jest-land-guard-";

/** Copied from the routes deliberately: if either changes, these must be revisited. */
const APPROVABLE_FROM = ["pending", "pending_verification", "inspection_scheduled", "rejected"];
const REJECTABLE_FROM = ["pending", "pending_verification", "inspection_scheduled", "verified"];

async function cleanup() {
    await supabaseAdmin.from("document_collections").delete().like("id", `${PREFIX}%`);
}

async function seedListing(id: string, status: string) {
    await supabaseAdmin.from("document_collections").insert({
        id,
        collection_name: COLLECTIONS.LAND_LISTINGS,
        raw_data: { id, status, title: "Test parcel", price: 5_000_000, ownerId: `${PREFIX}owner` },
    });
}

async function statusOf(id: string): Promise<string | null> {
    const { data } = await supabaseAdmin
        .from("document_collections")
        .select("raw_data")
        .eq("id", id)
        .maybeSingle();
    return (data?.raw_data as Record<string, string>)?.status ?? null;
}

maybeDescribe("land listing status guard, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("approves a listing awaiting verification", async () => {
        const id = `${PREFIX}pending`;
        await seedListing(id, "pending_verification");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: APPROVABLE_FROM,
            to: "verified",
        });

        expect(result.claimed).toBe(true);
        expect(await statusOf(id)).toBe("verified");
    });

    it("REFUSES to approve a listing with a purchase in escrow", async () => {
        // THE test. This is what silently double-sold a parcel.
        const id = `${PREFIX}escrow`;
        await seedListing(id, "pending_escrow");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: APPROVABLE_FROM,
            to: "verified",
        });

        expect(result.claimed).toBe(false);
        // And it says WHY, so the route can return a useful 409.
        expect(result.status).toBe("pending_escrow");
        // Untouched: still in escrow, not back on the market.
        expect(await statusOf(id)).toBe("pending_escrow");
    });

    it("REFUSES to reject a listing with a purchase in escrow", async () => {
        // The mirror case: a buyer who has paid, for land marked rejected.
        const id = `${PREFIX}escrow-reject`;
        await seedListing(id, "pending_escrow");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: REJECTABLE_FROM,
            to: "rejected",
        });

        expect(result.claimed).toBe(false);
        expect(await statusOf(id)).toBe("pending_escrow");
    });

    it("allows a rejection to be reversed, because that is a real admin action", async () => {
        const id = `${PREFIX}rejected`;
        await seedListing(id, "rejected");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: APPROVABLE_FROM,
            to: "verified",
        });

        expect(result.claimed).toBe(true);
        expect(await statusOf(id)).toBe("verified");
    });

    it("allows a verification to be revoked", async () => {
        const id = `${PREFIX}revoke`;
        await seedListing(id, "verified");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: REJECTABLE_FROM,
            to: "rejected",
        });

        expect(result.claimed).toBe(true);
        expect(await statusOf(id)).toBe("rejected");
    });

    it("lets exactly ONE of two simultaneous approvals win", async () => {
        // Two admins working the verification queue at once. The blind
        // update() this replaces let both through, so both fired the audit log
        // and both invalidated caches for a decision made once.
        const id = `${PREFIX}race`;
        await seedListing(id, "pending_verification");

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                claimStatusTransitionFromAny({
                    collection: COLLECTIONS.LAND_LISTINGS,
                    id,
                    fromAny: APPROVABLE_FROM,
                    to: "verified",
                })
            )
        );

        expect(results.filter(r => r.claimed)).toHaveLength(1);
        expect(await statusOf(id)).toBe("verified");
    });

    it("reports a missing listing as absent rather than as a blocked status", async () => {
        // The route turns this into a 404 rather than a 409, so the distinction
        // has to survive the primitive.
        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: `${PREFIX}does-not-exist`,
            fromAny: APPROVABLE_FROM,
            to: "verified",
        });

        expect(result.claimed).toBe(false);
        expect(result.status).toBeNull();
    });

    it("records which status the approval came from", async () => {
        // recordPreviousAs. With several possible starting states the caller
        // cannot otherwise tell, and a reversal that guesses would send a
        // listing back to the wrong place.
        const id = `${PREFIX}record-prev`;
        await seedListing(id, "inspection_scheduled");

        await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: APPROVABLE_FROM,
            to: "verified",
            recordPreviousAs: "statusBeforeVerification",
        });

        const { data } = await supabaseAdmin
            .from("document_collections")
            .select("raw_data")
            .eq("id", id)
            .maybeSingle();
        expect((data!.raw_data as Record<string, string>).statusBeforeVerification)
            .toBe("inspection_scheduled");
    });
});
