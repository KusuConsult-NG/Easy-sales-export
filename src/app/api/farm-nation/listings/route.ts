export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { PUBLIC_LAND_STATUSES, stripInternalLandFields } from "@/lib/land-visibility";

/**
 * API Route: Get All Land Listings
 * Returns verified listings for public viewing
 */
export async function GET(request: NextRequest) {
    try {
        // Publicly visible statuses, per the shared definition.
        //
        // This queried "verified" alone while land-actions.ts treated
        // "verified" and "approved" as public, so a listing an admin marked
        // approved was public to one half of the platform and invisible to the
        // other.
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "in", [...PUBLIC_LAND_STATUSES])
            .orderBy("createdAt", "desc")
            .get();

        const listings = snapshot.docs.map((doc: any) => {
            // The review fields do not go to a stranger.
            //
            // This spread the stored document. land-actions.ts has stripped
            // these since it was written — the admin's user id in verifiedBy,
            // the internal rejectionReason and verificationNotes, the owner's
            // email — and this endpoint, which has no authentication and feeds
            // /land and /farm-nation/map, did not.
            const data = stripInternalLandFields(doc.data() ?? {});
            return {
                id: doc.id,
                ...data,
                totalPrice: data.totalPrice ?? data.price ?? 0,
                price: data.price ?? data.totalPrice ?? 0,
                verificationStatus: data.status || "pending",
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
