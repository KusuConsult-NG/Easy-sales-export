export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { issueAcademyCertificate } from "@/lib/academy-certificate-issue";

/**
 * API Route: Generate Certificate on Course Completion
 *
 * #430 — THE BODY OF THIS ROUTE MOVED, AND THAT IS THE POINT.
 *
 * Everything this endpoint did correctly — verifying completion from the stored
 * progress record rather than the request, computing the grade from the
 * recorded per-module scores (#321), marking the row as issued rather than
 * attached (certificate-kind), and keying the document on (userId, courseId) so
 * a concurrent second call is idempotent instead of minting a duplicate
 * credential — now lives in lib/academy-certificate-issue.
 *
 * It moved because this route HAD NO CALLER, so none of that correctness ever
 * ran. Course completion issues the certificate now. Had the logic been copied
 * into the completion path instead of shared, this repository's signature
 * failure would have followed: two issuers, and the next fix reaching one.
 *
 * The endpoint is kept and still works. It is the repair door — a learner whose
 * completion predates this change, or whose issue failed at the time, gets
 * their certificate by asking for it, and asking twice returns the same one.
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // `quizScore` was destructured here and written onto the certificate —
        // #321. This endpoint takes nothing from the caller but which course
        // they are claiming; everything else is read from the stored record.
        const { courseId } = await request.json();

        if (!courseId) {
            return NextResponse.json(
                { success: false, message: "Course ID is required" },
                { status: 400 }
            );
        }

        const result = await issueAcademyCertificate(session.user.id, courseId);

        // "Not yet completed" is the caller's mistake (400); a progress record
        // or user that is not there is the record's (404). The split is kept
        // exactly as this route already answered it — a refactor must not
        // quietly renumber an endpoint's responses.
        if (result.status === "missing") {
            return NextResponse.json(
                { success: false, message: result.reason },
                { status: 404 }
            );
        }

        if (result.status === "refused") {
            return NextResponse.json(
                { success: false, message: result.reason },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: result.status === "already"
                ? "Certificate already exists"
                : "Certificate generated successfully",
            certificateId: result.certificateId,
            certificateNumber: result.certificateNumber,
        });
    } catch (error) {
        logger.error("Failed to generate certificate:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
