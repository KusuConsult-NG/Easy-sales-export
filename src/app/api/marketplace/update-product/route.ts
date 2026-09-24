export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isOwnedBySession } from "@/lib/owned-profile-ids";
import { FieldValue } from "@/lib/firestore-compat";

//   #794 One rule for what a product may be priced at, shared with the other
//   three product doors — see lib/product-pricing-guard.
import { checkProductPricing, type PricingCheck } from "@/lib/product-pricing-guard";
//   #867 The same reduction rule the server action runs, so the two update
//   doors cannot disagree about whether a price cut is a hot deal.
import { priceReductionPatch, retailPriceOf } from "@/lib/price-reduction";
/**
 * Fields a seller may change on their own product.
 *
 * WHY A WHITELIST
 * ---------------
 * This route destructured the body as `const { productId, ...updateData } = body`
 * and spread updateData straight into `productRef.update()`. The only guard was
 * ownership, so a seller could write ANY field on their own product:
 *
 *   status          -> "active", releasing it without moderation. This is the
 *                      escape hatch that made createProductAction's "pending"
 *                      state meaningless for anyone who found this endpoint.
 *   rating          -> a five-star score, and
 *   reviewCount     -> a review count to make it look earned. Fabricated social
 *                      proof, on the two fields buyers sort and filter by.
 *   sellerId        -> reassign the product to another account, or orphan it.
 *   sellerVerified  -> grant themselves the verified shield. (Every read path
 *                      now resolves that badge live from the seller's user
 *                      document, so this one is already defanged — see
 *                      lib/seller-trust.ts — but the write was there.)
 *   _version        -> break the optimistic-concurrency counter.
 *   isFlashSale,
 *   originalPrice,
 *   flashPrice      -> present an invented discount against an invented
 *                      original price.
 *
 * No UI calls this route, so nothing above was necessarily exploited. It is a
 * reachable endpoint either way, and a whitelist is smaller than the argument
 * for deleting it.
 *
 * These are the fields the edit form actually sends (see
 * marketplace/seller/products/[id]/edit) plus the ones _updateProductAction
 * writes. Anything not listed is dropped, not rejected: a client sending an
 * extra field should not have its legitimate edit fail.
 */
const SELLER_EDITABLE_FIELDS = [
    "title",
    "name",
    "description",
    "specifications",
    "category",
    "images",
    "videoUrl",
    "pricingTiers",
    "availableQuantity",
    "stockQuantity",
    "minimumOrderQuantity",
    "minOrder",
    "unit",
    "location",
    "deliveryMethod",
    "estimatedDeliveryDays",
    "certifications",
    "bulkAvailable",
    "exportReady",
    "escrowAvailable",
] as const;

/**
 * API Route: Update Product
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const body = await request.json();
        const { productId, ...updateData } = body;

        if (!productId) {
            return NextResponse.json(
                { success: false, message: "Product ID is required" },
                { status: 400 }
            );
        }

        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Product not found" },
                { status: 404 }
            );
        }

        //   #904 (SELLER SIDE, THE REST) — same gate, same rule as delete.
        if (!await isOwnedBySession(productDoc.data()?.sellerId, userId)) {
            return NextResponse.json(
                { success: false, message: "You can only update your own products" },
                { status: 403 }
            );
        }

        const patch: Record<string, any> = {};
        for (const field of SELLER_EDITABLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(updateData, field)) {
                patch[field] = updateData[field];
            }
        }

        if (Object.keys(patch).length === 0) {
            return NextResponse.json(
                { success: false, message: "No editable fields were supplied" },
                { status: 400 }
            );
        }

        /*
         *   #794 THE NUMBERS IN THE PATCH ARE NUMBERS SOMETHING CAN BE SOLD AT.
         *
         *   This route had no range check of any kind, and `pricingTiers`,
         *   `availableQuantity` and `minimumOrderQuantity` are all on the
         *   editable list — so a seller could take a working listing and PATCH
         *   it to a negative price. Checkout then refuses every cart containing
         *   it with "Invalid price", and nothing tells the seller their product
         *   has stopped being buyable.
         *
         *   ONLY WHAT IS PRESENT is checked. This is a partial update: a patch
         *   that does not mention the price must not be failed for the price the
         *   product already has, which may predate this rule.
         */
        const checks: PricingCheck[] = [];
        for (const tier of Array.isArray(patch.pricingTiers) ? patch.pricingTiers : []) {
            checks.push({
                label: `${tier?.type ?? "retail"} price`,
                value: Number(tier?.price),
                //   Bulk and export tiers are only pushed when offered, so a 0
                //   here is a price, not an absence — unlike the create doors,
                //   where 0 is how "not offered" arrives.
            });
        }
        for (const [field, label] of [
            ["availableQuantity", "stock quantity"],
            ["stockQuantity", "stock quantity"],
            ["minimumOrderQuantity", "minimum order quantity"],
            ["minOrder", "minimum order quantity"],
        ] as const) {
            if (Object.prototype.hasOwnProperty.call(patch, field)) {
                checks.push({
                    label,
                    value: Number(patch[field]),
                    zeroMeansAbsent: field === "availableQuantity" || field === "stockQuantity",
                });
            }
        }

        const pricing = checkProductPricing(checks);
        if (!pricing.ok) {
            return NextResponse.json(
                { success: false, message: pricing.message },
                { status: 400 }
            );
        }

        /*
         *   #867 A CUT MADE THROUGH THIS DOOR IS A HOT DEAL TOO.
         *
         *   THE OWNER: "when users edit product it never appears on hot deal
         *   why?"
         *
         *   `pricingTiers` is on the editable list above, so this route can
         *   lower a price — and it recorded nothing when it did, while
         *   _updateProductAction one file over recorded the reduction. Two
         *   writers disagreeing about a product field is the shape this
         *   codebase has repaired repeatedly (the status defect, the
         *   certifications defect); the difference here is that the disagreement
         *   is invisible, because the loser writes NOTHING rather than something
         *   wrong.
         *
         *   COMPARED AGAINST THE STORED ROW. The deny-list above blocks
         *   `originalPrice` and `flashPrice` precisely so a client cannot
         *   "present an invented discount against an invented original price" —
         *   so the previous price is read from the document, never from the
         *   request. That refusal stands; this is what makes it affordable.
         *
         *   Only when the patch carries a price. A partial update that does not
         *   mention `pricingTiers` leaves any existing offer exactly as it is,
         *   rather than clearing it against a price it never set.
         */
        const reduction = Array.isArray(patch.pricingTiers)
            ? priceReductionPatch(
                retailPriceOf(productDoc.data()?.pricingTiers),
                retailPriceOf(patch.pricingTiers),
            )
            : null;

        await productRef.update({
            ...patch,
            ...(reduction ?? {}),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Product updated successfully"
        });
    } catch (error) {
        logger.error("Failed to update product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
