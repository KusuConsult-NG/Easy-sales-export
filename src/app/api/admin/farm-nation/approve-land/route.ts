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
 * API Route: Approve Land Listing (Admin)
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

        const { verificationId } = await request.json();

        if (!verificationId) {
            return NextResponse.json(
                { success: false, message: "Verification ID is required" },
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
            status: "verified",
            verificationStatus: {
                // The prior decision is carried forward rather than replaced.
                //
                // This assigned a fresh object, so approving a listing that had
                // been rejected erased the rejection reason and who gave it —
                // the record of the earlier decision disappeared at the moment
                // it was reversed, which is exactly when it matters.
                ...(previous.verificationStatus ?? {}),
                verified: true,
                rejectionReason: null,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Recorded, which it was not.
        //
        // `land_verified` exists in the AuditAction union and is emitted by
        // land-listings.ts — an action the admin screen does not call. The
        // screen posts here, so every land verification made through the UI
        // went unrecorded while the vocabulary for recording it sat unused.
        await createAdminAuditLog({
            action: "land_verified",
            userId: session.user.id,
            targetType: "land_listing",
            targetId: verificationId,
            details: `Approved land listing ${verificationId}`,
            metadata: { previousStatus: previous.status ?? null },
        }).catch((e) => logger.error("[approve-land] audit log failed", e));

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", "page");
        } catch (cacheError) {
            logger.error('[Approve Land Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: "Land listing approved successfully"
        });
    } catch (error) {
        logger.error("Failed to approve listing:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
