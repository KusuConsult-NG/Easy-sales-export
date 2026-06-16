export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Dispatch Inspector for Land Verification (Admin)
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

        const { verificationId, inspectorName, scheduledDate, notes } = await request.json();

        if (!verificationId || !inspectorName || !scheduledDate) {
            return NextResponse.json(
                { success: false, message: "Verification ID, inspector name, and scheduled date are required" },
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

        // Update status to inspection_scheduled and record inspector details
        await listingRef.update({
            status: "inspection_scheduled",
            inspectionDetails: {
                inspectorName,
                scheduledDate,
                notes: notes || "",
                dispatchedBy: session.user.id,
                dispatchedAt: FieldValue.serverTimestamp()
            },
            verificationNotes: `Inspector: ${inspectorName}\nScheduled Date: ${scheduledDate}\nNotes: ${notes || "None"}`,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Invalidate cache
        try {
            const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
            await invalidateAdminGlobalStats();
            const { revalidateTag } = await import("next/cache");
            revalidateTag("land-listings", "page");
        } catch (cacheError) {
            logger.error('[Dispatch Inspector Route Cache] Cache clear error:', cacheError);
        }

        return NextResponse.json({
            success: true,
            message: "Inspector dispatched successfully"
        });
    } catch (error) {
        logger.error("Failed to dispatch inspector:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
