export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { retirementPatch } from "@/lib/record-retirement";

/**
 * API Route: Delete Loan Product (Admin Only)
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

        // Check if user is admin
        if (!hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { productId } = await request.json();

        if (!productId) {
            return NextResponse.json(
                { success: false, message: "Product ID is required" },
                { status: 400 }
            );
        }

        // Get product (Admin SDK)
        const productRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Product not found" },
                { status: 404 }
            );
        }

        /**
         *   #302 THE SECOND DOOR ONTO THE SAME DESTRUCTION.
         *
         *        deleteAdminLoanProductAction in actions/loan-products.ts is the
         *        other. Both called .delete() on a row that holds the interest
         *        rate and duration every loan written against it was granted on.
         *
         *        The comment that used to sit here said it plainly —
         *        "Irreversible, and the deleted product's terms are gone with it
         *        — so the record keeps them" — and copied the product into the
         *        audit entry to soften the loss. That copy is kept, because a
         *        record of who retired what is worth having; it is no longer the
         *        only surviving copy of the terms.
         */
        await productRef.update({
            isActive: false,
            ...retirementPatch(session.user.id, productDoc.data()?.status),
            updatedAt: new Date().toISOString(),
        });

        await recordAdminAction({
            action: "loan_product_deleted",
            userId: session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: { deleted: productDoc.data() ?? null },
        });

        return NextResponse.json({
            success: true,
            message: "Loan product deleted successfully"
        });
    } catch (error) {
        logger.error("Failed to delete loan product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
