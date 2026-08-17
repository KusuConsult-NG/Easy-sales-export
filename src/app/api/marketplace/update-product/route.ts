export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

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

        if (productDoc.data()?.sellerId !== userId) {
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

        await productRef.update({
            ...patch,
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
