import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

// Rate limiter for admin actions (moderate - legitimate admin workload)
const adminLimiter = rateLimit(rateLimitConfig.admin);

/**
 * API Route: Approve Seller Verification (Admin Only)
 */
export async function POST(request: NextRequest) {
    // RATE LIMITING - Prevent admin endpoint abuse
    const clientIp = getClientIp(request);
    const rateLimitResult = await adminLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!session.user.roles?.includes("admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId } = await request.json();

        if (!verificationId) {
            return NextResponse.json(
                { success: false, message: "Verification ID is required" },
                { status: 400 }
            );
        }

        // Get verification
        const verificationRef = doc(db, "seller_verifications", verificationId);
        const verificationDoc = await getDoc(verificationRef);

        if (!verificationDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Verification not found" },
                { status: 404 }
            );
        }

        const verificationData = verificationDoc.data();

        // Update verification status
        await updateDoc(verificationRef, {
            status: "approved",
            reviewedAt: new Date(),
            reviewedBy: session.user.id,
            updatedAt: new Date(),
        });

        // Update marketplace_sellers record
        const sellerRef = doc(db, "marketplace_sellers", verificationData.userId);
        await updateDoc(sellerRef, {
            verificationStatus: "approved",
            businessName: verificationData.businessName,
            rating: 0,
            totalSales: 0,
            approvedAt: new Date(),
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Seller approved successfully"
        });
    } catch (error) {
        logger.error("Failed to approve seller:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
