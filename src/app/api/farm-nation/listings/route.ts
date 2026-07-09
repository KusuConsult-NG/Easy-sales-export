export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Get All Land Listings
 * Returns verified listings for public viewing
 */
export async function GET(request: NextRequest) {
    try {
        // Get all verified land listings (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "verified")
            .orderBy("createdAt", "desc")
            .get();

        const listings = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                totalPrice: data.totalPrice ?? data.price ?? 0,
                price: data.price ?? data.totalPrice ?? 0,
                verificationStatus: data.status || data.verificationStatus || "pending",
                createdAt: data.createdAt?.toDate?.() || new Date(),
                updatedAt: data.updatedAt?.toDate?.() || new Date(),
            };
        });

        return NextResponse.json({
            success: true,
            data: { listings },
            meta: null
        });
    } catch (error) {
        logger.error("Failed to fetch listings:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Internal server error", meta: null },
            { status: 500 }
        );
    }
}
