export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Reject Land Listing (Admin)
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

        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { verificationId, reason } = await request.json();

        if (!verificationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Verification ID and reason are required" },
                { status: 400 }
            );
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(verificationId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Listing not found" },
                { status: 404 }
            );
        }

        const previous = listingDoc.data() ?? {};

        await listingRef.update({
            status: "rejected",
            verificationStatus: {
                // See approve-land: the prior decision is kept, not overwritten.
                ...(previous.verificationStatus ?? {}),
                verified: false,
                rejectionReason: reason,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "land_rejected",
            userId: session.user.id,
            targetType: "land_listing",
            targetId: verificationId,
            details: `Rejected land listing ${verificationId}: ${reason}`,
            metadata: { previousStatus: previous.status ?? null, reason },
        }).catch((e) => logger.error("[reject-land] audit log failed", e));

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", "page");
        } catch (cacheError) {
            logger.error('[Reject Land Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: "Land listing rejected"
        });
    } catch (error) {
        logger.error("Failed to reject listing:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
