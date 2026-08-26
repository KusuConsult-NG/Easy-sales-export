export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { retirementPatch } from "@/lib/record-retirement";

/**
 * API Route: Delete Product
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
        const { productId } = await request.json();

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
                { success: false, message: "You can only delete your own products" },
                { status: 403 }
            );
        }

        /**
         *   #301 THE SECOND DOOR, DESTROYING THE SAME ROW.
         *
         *        deleteProductAction in actions/marketplace/_mp_products.ts is
         *        the other one. Both called .delete(); fixing one and leaving
         *        the other is this codebase's most repeated mistake, so both
         *        change together and one test covers the pair.
         *
         *        Retired rather than destroyed: orders point at productIds, and
         *        order-management.ts returns stock with an update() that this
         *        adapter treats as a silent no-op when the row is gone.
         */
        await productRef.update({
            status: "archived",
            ...retirementPatch(userId, productDoc.data()?.status),
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json({
            success: true,
            message: "Product deleted successfully"
        });
    } catch (error) {
        logger.error("Failed to delete product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
