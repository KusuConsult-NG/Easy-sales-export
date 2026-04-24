export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Get Seller's Products
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: null },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Get seller's products (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            data: { products },
            meta: null
        });
    } catch (error) {
        logger.error("Failed to fetch products:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Internal server error", meta: null },
            { status: 500 }
        );
    }
}
