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
import {
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
} from "@/lib/land-listing-status";

declare const maybeDescribe: jest.Describe;

const PREFIX = "jest-land-guard-";

/**
 * The shared sets, no longer copied.
 *
 * These were copied from the routes with a note saying they must be revisited if
 * the routes changed — and the routes did change, because each of the five admin
 * decision paths turned out to be carrying its own different copy of this list.
 * approve-land's omitted `available`, the status farm-nation's creation path
 * writes, so a farm-nation listing could not be approved from the admin queue at
 * all.
 *
 * Importing them means this file cannot drift from what the routes do. What it
 * gives up is pinning the CONTENTS of the sets — if `pending_escrow` were ever
 * added to the approvable set, the escrow tests below would start passing
 * vacuously. That is asserted separately and directly, in
 * __tests__/unit/land-decision-vocabulary.ts: the approvable and rejectable sets
 * must not intersect DECISION_LOCKED_STATUSES, and that set must name the escrow
 * statuses explicitly.
 */
const APPROVABLE_FROM = [...APPROVABLE_FROM_STATUSES];
const REJECTABLE_FROM = [...REJECTABLE_FROM_STATUSES];
const DISPATCHABLE_FROM = [...APPROVABLE_FROM_STATUSES];

/**
 * The statuses that must be refused by ALL THREE admin actions.
 *
 * Every one of these means money is committed against the parcel, or it is gone.
 * The three routes each used to overwrite them.
 */
const MONEY_STATES = [
    "pending_escrow",
    "pending_payment",
    "payment_confirmed",
    "pending_transfer",
];

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

    it("REFUSES to dispatch an inspector to a listing in escrow", async () => {
        // inspection_scheduled is not a public status, so this write DELISTS the
        // parcel — while a buyer's money is held against it.
        const id = `${PREFIX}escrow-dispatch`;
        await seedListing(id, "pending_escrow");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: DISPATCHABLE_FROM,
            to: "inspection_scheduled",
        });

        expect(result.claimed).toBe(false);
        expect(await statusOf(id)).toBe("pending_escrow");
    });

    it("allows an inspection to be rescheduled", async () => {
        // The one same-status write in this module, and this test is what found
        // that the shared vocabulary had broken it.
        //
        // claimStatusTransitionFromAny now filters the target out of the starting
        // set, because leaving it in lets two concurrent callers both claim — see
        // the concurrency test above, which caught exactly that after
        // APPROVABLE_FROM_STATUSES came to include `verified`. Rescheduling is a
        // patch guarded by a status rather than a transition, so it opts in
        // explicitly, as dispatch-inspector does.
        const id = `${PREFIX}reschedule`;
        await seedListing(id, "inspection_scheduled");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: DISPATCHABLE_FROM,
            to: "inspection_scheduled",
            allowSameStatus: true,
        });

        expect(result.claimed).toBe(true);
    });

    it("refuses a same-status write without the explicit opt-in", async () => {
        // The other side of it. Without this, the opt-in could be removed from
        // dispatch-inspector and the test above would be the only thing that
        // noticed — by starting to fail, but with no statement of what the default
        // is supposed to be.
        const id = `${PREFIX}reschedule-no-optin`;
        await seedListing(id, "inspection_scheduled");

        const result = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: DISPATCHABLE_FROM,
            to: "inspection_scheduled",
        });

        expect(result.claimed).toBe(false);
        // Reported as the status it is already in, which is the useful answer.
        expect(result.status).toBe("inspection_scheduled");
    });

    it("throws rather than silently doing nothing when every start equals the target", async () => {
        // A caller error, and the filter must not turn it into a quiet no-claim
        // that reads like a lost race.
        const id = `${PREFIX}all-same`;
        await seedListing(id, "verified");

        await expect(claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id,
            fromAny: ["verified"],
            to: "verified",
        })).rejects.toThrow(/no transition to claim/);
    });

    describe.each(MONEY_STATES)("a listing in '%s'", (money) => {
        // The table that matters. All three admin actions must refuse every state
        // where money is committed — not just pending_escrow, which is the one
        // that happened to be noticed first.
        it.each([
            ["approved", APPROVABLE_FROM, "verified"],
            ["rejected", REJECTABLE_FROM, "rejected"],
            ["dispatched to", DISPATCHABLE_FROM, "inspection_scheduled"],
        ])("cannot be %s", async (_label, fromAny, to) => {
            const id = `${PREFIX}${money}-${to}`;
            await seedListing(id, money);

            const result = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id,
                fromAny: fromAny as string[],
                to: to as string,
            });

            expect(result.claimed).toBe(false);
            expect(await statusOf(id)).toBe(money);
        });
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
    describe("a row with no status recorded", () => {
        /**
         * WHY THIS CASE EXISTS AT ALL
         * ---------------------------
         * land_listings lives in `document_collections`, so `status` is a plain
         * JSONB key with no NOT NULL behind it. A row can simply lack one.
         *
         * The compare-and-swap matches `raw_data->>'status' = p_from`. For such a
         * row that expression is NULL, `NULL = anything` is never true, so no
         * transition can ever be claimed on it — and the function then reports its
         * status as NULL, which is exactly what it reports for a row that is not
         * there.
         *
         * Every caller read that one null as "not found". The blind writes these
         * guards replaced DID work on such rows, so converting to the CAS turned a
         * working admin action into the message "Listing not found" for a listing
         * the admin was looking at. `exists` on the result is what lets the two be
         * told apart, and only the real function can demonstrate it.
         */
        it("cannot be claimed, and is reported as existing rather than missing", async () => {
            const id = `${PREFIX}no-status`;
            await supabaseAdmin.from("document_collections").insert({
                id,
                collection_name: COLLECTIONS.LAND_LISTINGS,
                // No `status` key at all.
                raw_data: { id, title: "Parcel with no status", ownerId: `${PREFIX}owner` },
            });

            const result = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id,
                fromAny: APPROVABLE_FROM,
                to: "verified",
            });

            expect(result.claimed).toBe(false);
            expect(result.status).toBeNull();
            // The discriminator. Without it this is indistinguishable from the
            // absent-row case below, and the caller reports the wrong thing.
            expect(result.exists).toBe(true);
            // And nothing was written — the guard did not fall back to a write.
            expect(await statusOf(id)).toBeNull();
        });

        it("a genuinely absent row reports exists false", async () => {
            // The other half. If both cases returned the same thing, the test
            // above would be pinning a constant rather than a distinction.
            const result = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id: `${PREFIX}definitely-not-there`,
                fromAny: APPROVABLE_FROM,
                to: "verified",
            });

            expect(result.claimed).toBe(false);
            expect(result.status).toBeNull();
            expect(result.exists).toBe(false);
        });

        it("does not pay for the probe when a claim succeeds", async () => {
            // The probe is an extra round trip, and it must only happen on the
            // ambiguous refusal path. `exists` being absent is how a caller — and
            // this test — can tell it was not run.
            const id = `${PREFIX}no-probe`;
            await seedListing(id, "pending_verification");

            const result = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id,
                fromAny: APPROVABLE_FROM,
                to: "verified",
            });

            expect(result.claimed).toBe(true);
            expect(result.exists).toBeUndefined();
        });

        it("does not pay for the probe when a refusal already names the status", async () => {
            const id = `${PREFIX}no-probe-escrow`;
            await seedListing(id, "pending_escrow");

            const result = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id,
                fromAny: APPROVABLE_FROM,
                to: "verified",
            });

            expect(result.claimed).toBe(false);
            expect(result.status).toBe("pending_escrow");
            expect(result.exists).toBeUndefined();
        });
    });
});
