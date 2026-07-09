export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { sendSellerApprovalEmail } from "@/lib/email-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

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
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!isAdmin(session.user.roles)) {
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

        // Get verification (Admin SDK)
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);
        const verificationDoc = await verificationRef.get();

        if (!verificationDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Verification not found" },
                { status: 404 }
            );
        }

        const verificationData = verificationDoc.data()!;

        // Update verification status
        await verificationRef.update({
            status: "approved",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Upsert marketplace_sellers record (use set+merge so it works whether doc exists or not)
        await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(verificationData.userId).set({
            userId: verificationData.userId,
            verificationStatus: "approved",
            businessName: verificationData.businessName || "",
            businessType: verificationData.businessType || "",
            email: verificationData.userEmail || verificationData.email || "",
            phone: verificationData.phone || "",
            state: verificationData.state || "",
            lga: verificationData.lga || "",
            rating: 0,
            totalSales: 0,
            isActive: true,
            approvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Grant seller role on the user document
        try {
            const userRef = db.collection(COLLECTIONS.USERS).doc(verificationData.userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                await userRef.set({
                    uid: verificationData.userId,
                    email: verificationData.userEmail || verificationData.email || "",
                    fullName: verificationData.userName || "Seller",
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["seller"],
                    isVerified: true,
                    sellerVerificationStatus: "approved",
                    "serviceRegistrations": {
                        "marketplace": {
                            "status": "approved",
                            "activatedAt": FieldValue.serverTimestamp()
                        }
                    },
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                const existingRoles: string[] = userSnap.data()?.roles || [];
                const updateData: any = {
                    updatedAt: FieldValue.serverTimestamp(),
                    sellerVerificationStatus: "approved",
                    "serviceRegistrations.marketplace.status": "approved",
                };

                if (!existingRoles.includes("seller")) {
                    updateData.roles = FieldValue.arrayUnion("seller");
                }
                
                await userRef.update(updateData);
            }
        } catch (roleErr) {
            logger.error("Failed to grant seller role:", roleErr);
            // Non-fatal — continue
        }

        // Fetch user document to get the correct email/name and send email (non-blocking)
        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(verificationData.userId).get();
            const userData = userDoc.data();
            const email = userData?.email || verificationData.email || verificationData.userEmail;
            const name = userData?.fullName || verificationData.userName || "Seller";

            if (email) {
                await sendSellerApprovalEmail(email, name);
            }
        } catch (emailError) {
            logger.error("Failed to send seller approval email:", emailError);
        }

        // Invalidate cache
        if (verificationData.userId) {
            try {
                const { invalidateSellerCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateSellerCache(verificationData.userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Approve Seller Route Cache] Cache clear error:', cacheError);
            }
        }

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
