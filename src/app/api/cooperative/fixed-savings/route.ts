export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { fixedSavingsPlanStatus } from "@/lib/cooperative-savings";

/**
 * API Route: Get User's Fixed Savings Plans
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

        // Fetch user's fixed savings plans (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.FIXED_SAVINGS_PLANS)
            .where("memberId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const plans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                //   #419 THE STATUS IS DERIVED HERE, not read off the row.
                //
                //   Nothing in this codebase ever wrote "matured", so the
                //   member screen's "Matured Plans" section could not appear
                //   and a plan whose term had ended still showed a countdown.
                //   Deriving it makes every plan ALREADY in the database
                //   correct at the next read — a status backfill would not,
                //   because it has to guess for rows written while it runs.
                //
                //   Spread order matters: this must come after `...data` or the
                //   stored value would win again.
                status: fixedSavingsPlanStatus(data),
                startDate: data.startDate?.toDate?.() || new Date(),
                maturityDate: data.maturityDate?.toDate?.() || new Date(),
                createdAt: data.createdAt?.toDate?.() || new Date(),
            };
        });

        return NextResponse.json({
            success: true,
            plans,
        });
    } catch (error) {
        logger.error("Failed to fetch fixed savings plans:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
