/**
 * Tests for the shared land-listing status vocabulary.
 *
 * LAND_LISTINGS is written by two modules that disagreed about what a status
 * means. land-actions approves a listing as "verified" and its public view
 * queries exactly that; farm-nation created listings as "available" and would
 * only sell those. So a listing was visible in one module or purchasable in the
 * other, never both — half the inventory unreachable from each side.
 *
 * These pin the two rules that keep the modules in step: both spellings of
 * "for sale" are honoured, and a reservation is reversed to the status it came
 * from rather than a hardcoded one.
 */

import {
    PURCHASABLE_STATUSES,
    BROWSABLE_STATUSES,
    isPurchasable,
    isBrowsable,
    statusAfterCancellation,
} from "@/lib/land-listing-status";

describe("purchasable statuses", () => {
    it("treats verified and available as the same thing", () => {
        // land-actions writes "verified"; farm-nation writes "available".
        // Requiring only one made the other module's listings unsellable.
        expect(isPurchasable("verified")).toBe(true);
        expect(isPurchasable("available")).toBe(true);
    });

    it("excludes everything a buyer must not be sold", () => {
        for (const status of [
            "pending_verification", // no admin has checked it
            "rejected",             // an admin refused it
            "deleted",              // soft-deleted
            "sold",
            "leased",
            "pending",              // another buyer is mid-purchase
        ]) {
            expect(isPurchasable(status)).toBe(false);
        }
    });

    it("rejects a missing or non-string status rather than defaulting to sellable", () => {
        expect(isPurchasable(undefined)).toBe(false);
        expect(isPurchasable(null)).toBe(false);
        expect(isPurchasable(42)).toBe(false);
        expect(isPurchasable("")).toBe(false);
    });
});

describe("browsable statuses", () => {
    it("shows only what can actually be bought", () => {
        // farm-nation's browse applied no status filter at all, so buyers saw
        // rejected and deleted listings and could start a purchase that then
        // failed at the end.
        expect(isBrowsable("verified")).toBe(true);
        expect(isBrowsable("available")).toBe(true);
        expect(isBrowsable("rejected")).toBe(false);
        expect(isBrowsable("deleted")).toBe(false);
        expect(isBrowsable("pending_verification")).toBe(false);
    });

    it("hides a listing another buyer is part-way through buying", () => {
        expect(isBrowsable("pending")).toBe(false);
    });
});

describe("statusAfterCancellation", () => {
    it("returns a verified listing to verified", () => {
        // The one that matters. Returning it to "available" instead — which an
        // earlier fix did — drops an admin-approved listing out of the public
        // land view, silently.
        expect(statusAfterCancellation("verified")).toBe("verified");
    });

    it("returns an available listing to available", () => {
        expect(statusAfterCancellation("available")).toBe("available");
    });

    it("falls back to available when nothing was recorded", () => {
        // Listings reserved before previousStatus was recorded. "available"
        // keeps them sellable; the alternative is leaving them stuck.
        expect(statusAfterCancellation(undefined)).toBe("available");
        expect(statusAfterCancellation(null)).toBe("available");
    });

    it("does not restore a status that was never sellable", () => {
        // A corrupt or unexpected previousStatus must not be written back as if
        // it were valid.
        expect(statusAfterCancellation("rejected")).toBe("available");
        expect(statusAfterCancellation("deleted")).toBe("available");
    });
});

describe("PURCHASABLE_STATUSES", () => {
    it("is the set the claim iterates over", () => {
        // farm-nation spreads this into claimStatusTransitionFromAny. If a
        // third spelling is ever added, the reservation must pick it up without
        // a second edit.
        //
        // "approved" IS that third spelling, and this assertion is what caught it
        // being added. It came from land-visibility.ts, which kept its own
        // PUBLIC_LAND_STATUSES = ["verified", "approved"] while this file held
        // ["verified", "available"] — two files each documented as the single
        // definition, disagreeing on two of three values, with the mismatch live
        // in both directions: "available" was purchasable but not public, and
        // "approved" was public but not purchasable.
        expect([...PURCHASABLE_STATUSES].sort()).toEqual(["approved", "available", "verified"]);
    });

    it("IS the public set — one definition, not two", () => {
        // The invariant that stops the split recurring. land-visibility.ts now
        // derives PUBLIC_LAND_STATUSES from PURCHASABLE_STATUSES rather than
        // holding a literal, so a listing can never be visible-but-unbuyable or
        // buyable-but-invisible again.
        //
        // Asserted as identity, not equality of contents: a copy that happens to
        // match today is exactly how the two drifted apart in the first place.
        const { PUBLIC_LAND_STATUSES } = require("@/lib/land-visibility");

        expect(PUBLIC_LAND_STATUSES).toBe(PURCHASABLE_STATUSES);
    });

    it("and browsable is the same set too", () => {
        // Showing a listing that cannot be bought sends buyers down a flow that
        // fails at the end — this file's own reasoning, asserted.
        expect(BROWSABLE_STATUSES).toBe(PURCHASABLE_STATUSES);
    });
});
