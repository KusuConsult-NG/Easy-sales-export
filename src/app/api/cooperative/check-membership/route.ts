export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { readCooperativeMembership } from "@/lib/cooperative-readers";

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

        //   #564 The body moved to lib/cooperative-readers so the member
        //   screens can read it on the SERVER rather than fetching this route
        //   from the browser after the page had already been rendered. #488's
        //   finding — a doc-id lookup misses a member whose row carries userId
        //   as a field, and a miss looks exactly like not being a member —
        //   moved with it, unaltered.
        const membership = await readCooperativeMembership(userId);

        if (!membership.isMember) {
            return NextResponse.json({
                success: true,
                isMember: false,
                status: "not_member"
            });
        }

        return NextResponse.json({
            success: true,
            isMember: true,
            status: membership.status,
            data: membership.data
        });
    } catch (error) {
        logger.error("Failed to check membership:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
