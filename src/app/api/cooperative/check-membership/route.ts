export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Check Cooperative Membership Status
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

        // Check if user is a member (Admin SDK)
        const membershipDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!membershipDoc.exists) {
            return NextResponse.json({
                success: true,
                isMember: false,
                status: "not_member"
            });
        }

        const membershipData = membershipDoc.data();

        return NextResponse.json({
            success: true,
            isMember: true,
            status: membershipData?.membershipStatus || "pending",
            data: membershipData
        });
    } catch (error) {
        logger.error("Failed to check membership:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
