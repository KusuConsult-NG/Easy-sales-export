export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { readMyLoanApplications } from "@/lib/cooperative-readers";

/**
 * API Route: Get User's Loan Applications
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

        //   #570 The body moved to lib/cooperative-readers so /cooperatives/loans
        //   can read it on the SERVER rather than fetching this route from the
        //   browser. The finding it carries — a member's own application did not
        //   appear in their own list, because the page files into
        //   cooperative_loans by memberId and this read loan_applications by
        //   userId — moved with it, both collections and all.
        const applications = await readMyLoanApplications(userId);

        return NextResponse.json({
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
