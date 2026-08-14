export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Get All Loan Applications (Admin Only)
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

        // Check if user is admin
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all loan applications (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .orderBy("appliedAt", "desc")
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
            logger.warn("[admin/cooperative/loan-applications] result truncated by the adapter's query limit");
        }

        const applications = await Promise.all(
            snapshot.docs.map(async (appDoc) => {
                const data = appDoc.data();

                // Get user details
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
                const userData = userDoc.exists ? userDoc.data() : {};

                return {
                    id: appDoc.id,
                    ...data,
                    // Defensive name chain: structured fields → legacy fullName → name → email
                    userName: (userData?.firstName || userData?.lastName)
                        ? [userData?.firstName, userData?.otherName, userData?.lastName].filter(Boolean).join(" ")
                        : (userData?.fullName || userData?.name || userData?.email || "Unknown User"),
                    userEmail: userData?.email || "",
                    appliedAt: data.appliedAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            truncated,
            success: true,
            applications
        });
    } catch (error) {
        logger.error("Failed to fetch loan applications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
