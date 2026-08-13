export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limiter';
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

    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Keyed on the ACCOUNT, not the IP address.
        //
        // This endpoint is authenticated, and rate-limits.config.ts already
        // spells out why an IP key is the wrong unit here: "Nigerian mobile
        // networks share IPs heavily, so a limit tuned as though an IP were a
        // person locks out real users." That note was written for the public
        // contact form and applies with more force to a signed-in one — behind a
        // carrier NAT, a handful of members exhausting this limit blocked
        // everyone else sharing that address.
        //
        // The four payment ACTIONS already key on session.user.id. The API
        // routes doing the same work did not, so one convention was correct and
        // the other was not, for the same operation.
        //
        // The check moves below the session because that is where the user id
        // exists. The trade is that an unauthenticated flood now reaches
        // requireSession() first — which reads a token and returns 401 without
        // touching the database, so it is the cheap path either way, and
        // volumetric protection belongs at the edge rather than here.
        const rateLimitResult = await adminLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return createRateLimitResponse(rateLimitResult);
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

        // The verification is marked approved LAST. See below.

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
            // NOT non-fatal.
            //
            // This was `// Non-fatal — continue`, and it sat AFTER the
            // verification had already been marked approved. So a failure here
            // produced an approved seller with no seller role — someone the
            // admin screen shows as approved and who cannot sell — and the
            // route returned success. The only trace was this log line.
            //
            // The order is inverted now: the seller record and the role are
            // written first and the verification is marked approved last, so a
            // failure leaves it pending and the admin retries. Both writes are
            // idempotent — a merge and an arrayUnion — so a retry is safe.
            logger.error("Failed to grant seller role:", roleErr);
            return NextResponse.json(
                {
                    success: false,
                    message: "Could not grant the seller role. The verification is unchanged — please retry.",
                },
                { status: 500 }
            );
        }

        // Marked approved only once the seller can actually sell.
        await verificationRef.update({
            status: "approved",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Recorded, which it was not.
        //
        // "seller_approved" is declared in the AuditAction union and had ZERO
        // emitters anywhere in the codebase, as did seller_rejected and
        // seller_suspended. The admin screen posts here rather than to the
        // audited server action, so no seller approval in the platform's
        // history was ever written to the audit log.
        await createAdminAuditLog({
            action: "seller_approved",
            userId: session.user.id,
            targetType: "seller_verification",
            targetId: verificationId,
            details: `Approved seller ${verificationData.userId}`,
            metadata: { sellerUserId: verificationData.userId ?? null },
        }).catch((e) => logger.error("[approve-seller] audit log failed", e));

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
