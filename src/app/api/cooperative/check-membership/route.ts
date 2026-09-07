export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";

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

        /**
         *   #488 THE ROUTE WHOSE ENTIRE JOB IS THIS QUESTION ASKED THE NARROW
         *        VERSION OF IT.
         *
         *        A doc-id read that misses is indistinguishable from having no
         *        membership — lib/cooperative-member-lookup.ts says so in its
         *        header — and this answered `isMember: false, status:
         *        "not_member"` to a paid-up member whose row carries `userId` as
         *        a field. Of the eight doors that had this, it is the one whose
         *        answer other screens are most likely to trust.
         */
        const memberRow = await findCooperativeMemberRow(
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), userId,
        );

        if (!memberRow) {
            return NextResponse.json({
                success: true,
                isMember: false,
                status: "not_member"
            });
        }

        const membershipData = memberRow.data;

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
