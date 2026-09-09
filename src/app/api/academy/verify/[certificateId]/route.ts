export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { readCertificateVerification } from "@/lib/certificate-verification-reader";

/**
 * API Route: Verify a certificate by id or by the number its holder was given.
 *
 *   #564 The body moved to lib/certificate-verification-reader so that
 *   /academy/verify/[certificateId] — the page a third party lands on from a
 *   printed credential — can resolve it on the SERVER and arrive already
 *   showing a verdict, rather than fetching this route from the browser after
 *   the page had been rendered.
 *
 *   Three findings live in that function and are described there: WAVE
 *   certificates are verifiable too, #430's resolve-by-certificate-number, and
 *   the rule that only credentials the platform ISSUED are verifiable. The
 *   route's own answers are unchanged: the same 404 for anything not found or
 *   not issued, the same 500 on failure.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    try {
        const { certificateId } = await params;
        const result = await readCertificateVerification(certificateId);

        if (!result.found) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            certificate: result.certificate,
        });
    } catch (error) {
        logger.error("Failed to verify certificate:", error);
        return NextResponse.json(
            { success: false, message: "Verification failed" },
            { status: 500 }
        );
    }
}
