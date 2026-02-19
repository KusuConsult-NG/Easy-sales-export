import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get All Land Listings
 * Returns verified listings for public viewing
 */
export async function GET(request: NextRequest) {
    try {
        // Get all verified land listings (Admin SDK)
        const snapshot = await db.collection("land_listings")
            .where("verificationStatus", "==", "verified")
            .orderBy("createdAt", "desc")
            .get();

        const listings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            listings
        });
    } catch (error) {
        logger.error("Failed to fetch listings:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
