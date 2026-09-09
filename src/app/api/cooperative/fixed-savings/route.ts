export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { readFixedSavingsPlans } from "@/lib/cooperative-readers";

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

        //   #564 The body moved to lib/cooperative-readers so the member
        //   screens can read it on the SERVER rather than fetching this route
        //   from the browser. #419's derived status — nothing ever wrote
        //   "matured", so a finished plan still showed a countdown — moved with
        //   it, spread order and all.
        const plans = await readFixedSavingsPlans(userId);

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
