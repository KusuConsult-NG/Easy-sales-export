export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { readUploadedCertificates } from "@/lib/certificates-reader";

/**
 * GET - List user's certificates
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        //   #562 The body moved to lib/certificates-reader so
        //   /dashboard/certificates can read it on the SERVER instead of
        //   fetching this route from the browser after the page had already
        //   been rendered. #303's rule — a certificate the member removed
        //   leaves this list, while the row and the file both survive — moved
        //   with it, unaltered.
        const certificates = await readUploadedCertificates(session.user.id);

        return NextResponse.json({
            success: true,
            certificates,
        });
    } catch (error: any) {
        logger.error("Cert fetch error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch certificates" },
            { status: 500 }
        );
    }
}
