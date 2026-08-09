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
        expect([...PURCHASABLE_STATUSES].sort()).toEqual(["available", "verified"]);
    });
});
