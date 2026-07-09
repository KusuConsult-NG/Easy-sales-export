export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * API Route: Suspend Seller (Admin Only)
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
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId, reason } = await request.json();

        if (!verificationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Verification ID and suspension reason are required" },
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
            status: "suspended",
            suspensionReason: reason,
            suspendedAt: FieldValue.serverTimestamp(),
            suspendedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update marketplace_sellers record
        await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(verificationData.userId).set({
            verificationStatus: "suspended",
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Invalidate cache
        if (verificationData.userId) {
            try {
                const { invalidateSellerCache, invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
                await invalidateSellerCache(verificationData.userId);
                await invalidateAdminGlobalStats();
            } catch (cacheError) {
                logger.error('[Suspend Seller Route Cache] Cache clear error:', cacheError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "Seller suspended successfully"
        });
    } catch (error) {
        logger.error("Failed to suspend seller:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
