export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Check Marketplace Seller Status
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Check seller verification status (Admin SDK)
        const sellerDoc = await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(userId).get();

        if (!sellerDoc.exists) {
            return NextResponse.json({
                success: true,
                status: "not_verified",
                message: "Not yet verified as a seller"
            });
        }

        const sellerData = sellerDoc.data()!;

        return NextResponse.json({
            success: true,
            status: sellerData.verificationStatus || "pending",
            data: sellerData
        });
    } catch (error) {
        logger.error("Failed to check seller status:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
