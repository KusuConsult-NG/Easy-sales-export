export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Get All Land Verifications (Admin)
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

        // Check admin role from session
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all land listings (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .orderBy("createdAt", "desc")
            .get();

        // Truncation is reported, not swallowed.
        //
        // The adapter caps an unbounded query at SUPABASE_DEFAULT_QUERY_LIMIT
        // and sets `truncated` for exactly this reason — analytics.service.ts
        // and cron/reconcile-fulfilment both read it. An admin queue that shows
        // the first N as though they were all of them is how a pending item is
        // never actioned.
        const truncated = Boolean((snapshot as any).truncated);
        if (truncated) {
            logger.warn("[admin/farm-nation/land-verifications] result truncated by the adapter's query limit");
        }

        const verifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            truncated,
            success: true,
            verifications
        });
    } catch (error) {
        logger.error("Failed to fetch verifications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
