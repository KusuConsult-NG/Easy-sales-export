export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Get All Loan Products
 * Public endpoint - no auth required to view products
 */
/**
 * The fields a prospective borrower is shown.
 *
 * The route returned `{ id, ...doc.data() }`, which included `createdBy` — the
 * user id of the admin who created the product — on an endpoint with no
 * authentication. Same shape as the export catalogue and the land listings.
 */
const PUBLIC_PRODUCT_FIELDS = [
    "name",
    "description",
    "minAmount",
    "maxAmount",
    "interestRate",
    "durationMonths",
] as const;

export async function GET(request: NextRequest) {
    try {
        // Inactive products are not offered.
        //
        // create-loan-product and update-loan-product both write
        // `isActive: Boolean(isActive)` and NOTHING read it — not this route,
        // not the admin list, not the application path. So an admin
        // deactivating a product removed it from nowhere: it stayed on the
        // public list at its old rate and could still be applied for.
        //
        // A toggle that is collected, stored and never consulted is the third
        // of its kind in this audit, after MFA enforcement and the notification
        // settings. This one had a price on it.
        const snapshot = await db.collection(COLLECTIONS.LOAN_PRODUCTS)
            .where("isActive", "==", true)
            .orderBy("minAmount", "asc")
            .get();

        const products = snapshot.docs.map((doc: any) => {
            const data = doc.data() ?? {};
            const product: Record<string, unknown> = { id: doc.id };
            for (const field of PUBLIC_PRODUCT_FIELDS) {
                if (data[field] !== undefined) product[field] = data[field];
            }
            return product;
        });

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        logger.error("Failed to fetch loan products:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
