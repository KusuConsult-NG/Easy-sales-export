import { NextRequest, NextResponse } from "next/server";
import { PRODUCT_VISIBLE_STATUSES } from "@/lib/product-status";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { publicSellerSummary } from "@/lib/public-seller-summary";
import { latestApplication } from "@/lib/latest-application";

export const dynamic = "force-dynamic";

/**
 * A bound on the review scan, stated here rather than inherited.
 *
 * The read had no limit at all, so it ran under supabase-db's global default —
 * an average silently computed over a truncated set, with nothing saying so.
 * 500 approved reviews for one seller is far beyond anything this platform has,
 * and naming the number makes the truncation a decision instead of a side
 * effect of a constant in another file.
 */
const REVIEW_SCAN_LIMIT = 500;

/**
 * GET /api/marketplace/sellers/[sellerId]
 * Returns public seller profile: verification doc + active products + review score.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ sellerId: string }> }
) {
    const { sellerId } = await params;

    if (!sellerId) {
        return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
    }

    try {
        // Seller verification doc (contains businessName, bio, badge, etc.)
        const verSnap = await db
            .collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        if (verSnap.empty) {
            return NextResponse.json(
                { error: "Seller not found or not yet approved" },
                { status: 404 }
            );
        }

        // WHICH APPROVED VERIFICATION IS CURRENT — the shared rule, not a
        // ninth hand-written copy of it.
        //
        // #514. This sorted on `createdAt` alone. A seller who resubmits leaves
        // two approved rows behind (_mp_seller_verification.ts writes
        // `submittedAt` on each and `resubmittedAt` on the profile), and
        // latestApplication ranks by submittedAt FIRST, then decided time, then
        // document id. So the two rules disagree exactly where it matters — on a
        // resubmission — and the storefront could publish the superseded
        // business name, logo and badge while the admin screens showed the new
        // one. #504 through #507 swept eight copies of this out of five modules;
        // this is the ninth, and it is the copy facing the public.
        const verDoc = latestApplication(verSnap.docs)!;
        const verData = verDoc.data();

        // Active product listings.
        //
        // `null` MEANS "WE COULD NOT READ THIS", AND [] MEANS "THERE ARE NONE".
        // They were the same value. A failed query became `products = []` with
        // no log line, and the storefront renders that as "No products listed
        // yet." with a "0" in the stat block — a confident wrong answer about a
        // business, on the page a buyer uses to decide whether to trust it.
        let products: any[] | null = null;
        try {
            const prodSnap = await db
                .collection(COLLECTIONS.PRODUCTS)
                .where("sellerId", "==", sellerId)
                .where("status", "in", [...PRODUCT_VISIBLE_STATUSES])
                .orderBy("createdAt", "desc")
                .limit(20)
                .get();

            products = prodSnap.docs.map((d) => ({
                id: d.id,
                title: d.data().title ?? d.data().name ?? "Unnamed",
                price: d.data().price ?? 0,
                unit: d.data().unit ?? "",
                category: d.data().category ?? "",
                images: d.data().images ?? [],
                stock: d.data().stock ?? d.data().quantity ?? null,
            }));
        } catch (err) {
            // #308's class: the catch was empty, so a failing product query was
            // invisible AND indistinguishable from an empty shop.
            logger.error("[GET /api/marketplace/sellers/:id] product read failed", {
                sellerId,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // Seller reviews aggregate. Same rule: null is "unknown", not "zero".
        let reviews: { avgRating: number; reviewCount: number } | null = null;
        try {
            // APPROVED ONLY, like every other reader of this figure.
            //
            // This counted every seller review regardless of status, so the
            // public rating included reviews still waiting on a moderator AND
            // reviews a moderator had explicitly REJECTED. getSellerReviewSummaryAction
            // computes the same average from the same collection with
            // `status == "approved"`, so the platform showed two different
            // ratings for one seller and the permissive one was the public route.
            //
            // Rejecting a fake one-star changed nothing a buyer could see here,
            // which is the one thing the moderation queue exists for.
            const reviewSnap = await db
                .collection(COLLECTIONS.SELLER_REVIEWS)
                .where("sellerId", "==", sellerId)
                .where("status", "==", "approved")
                .limit(REVIEW_SCAN_LIMIT)
                .get();

            const reviewCount = reviewSnap.size;
            const totalRating = reviewSnap.docs.reduce(
                (sum, d) => sum + (Number(d.data().rating) || 0),
                0
            );
            reviews = {
                reviewCount,
                avgRating: reviewCount > 0
                    ? Math.round((totalRating / reviewCount) * 10) / 10
                    : 0,
            };
        } catch (err) {
            // The catch was empty and carried the comment "reviews collection
            // may not exist yet". It does exist; and even if it had not, turning
            // a failed read into a 0.0 rating removes the seller's entire star
            // display without anyone knowing why.
            logger.error("[GET /api/marketplace/sellers/:id] review read failed", {
                sellerId,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return NextResponse.json({
            // #105. This was the object literal itself, and the buyer's
            // saved-sellers list needed the same nine fields. Two copies of a
            // projection over a document that also holds the seller's bank
            // details and identity-document URLs is how a field ends up
            // published on the door nobody was looking at, so there is one.
            seller: publicSellerSummary(verDoc.id, sellerId, verData as Record<string, unknown>),
            products,
            reviews,
            // What could not be read, named. The page renders "we couldn't load
            // this" for these rather than presenting an absence as a fact.
            unavailable: [
                ...(products === null ? ["products"] : []),
                ...(reviews === null ? ["reviews"] : []),
            ],
        });
    } catch (err: unknown) {
        logger.error("[GET /api/marketplace/sellers/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
