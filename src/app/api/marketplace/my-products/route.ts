export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";

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

        const products = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...serializeValue(data),
                // Ensure timestamps are ISO strings (serializeValue handles Firestore Timestamps,
                // but also guard against already-converted values)
                createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
                updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? new Date().toISOString(),
            };
        });

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
