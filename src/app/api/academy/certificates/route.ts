export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { readAcademyCertificates } from "@/lib/certificates-reader";

/**
 * GET /api/academy/certificates
 * Returns all Academy-earned certificates for the logged-in user.
 *
 * Reads from:
 *   - course_progress (completed: true) and course_enrollments
 *   - wave_certificates (if user earned a WAVE cert)
 *
 * Supports cursor-based pagination:
 *   ?cursor=<ISO timestamp of last item's issuedAt>
 *   ?limit=<number, default 20, max 50>
 *
 * Response: { success, data: { certificates }, meta: { cursor, hasMore } }
 *
 *   #562 The body moved to lib/certificates-reader so /dashboard/certificates
 *   can read it on the SERVER instead of fetching this route from the browser
 *   after the page had already been rendered. The findings this endpoint
 *   carries — #425's query on a status nothing writes, and the WAVE branch's
 *   four disagreeing field names — moved with it, unaltered. The route's own
 *   shape is unchanged.
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get("limit") || "20");

        const { certificates, cursor, hasMore } = await readAcademyCertificates(session.user.id, {
            limit: rawLimit,
            cursor: searchParams.get("cursor"),
        });

        return NextResponse.json({
            success: true,
            data: { certificates },
            meta: { cursor, hasMore },
        });
    } catch (error) {
        logger.error("GET /api/academy/certificates error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load certificates", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
