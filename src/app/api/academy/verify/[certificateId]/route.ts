export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isIssuedCertificate } from "@/lib/certificate-kind";

/**
 * API Route: Verify Certificate (Public)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    try {
        const { certificateId } = await params;

        // Get certificate (Admin SDK)
        const certificateDoc = await db.collection(COLLECTIONS.CERTIFICATES).doc(certificateId).get();

        if (!certificateDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        const certData = certificateDoc.data()!;

        // This endpoint answered `isValid: true` for ANY document id in the
        // certificates collection, and uploadCertificateAction returns the id of
        // the row it creates to whoever uploaded the file. So anyone could
        // attach a PDF to their profile and have the platform publicly vouch for
        // its id as a certificate.
        //
        // Only credentials the platform issued are verifiable. Answering with
        // the same 404 an unknown id gets, because "this id exists but is not a
        // certificate" is not something a verifier needs to be told.
        if (!isIssuedCertificate(certData)) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        const certificate = {
            id: certificateDoc.id,
            userName: certData.userName,
            courseTitle: certData.courseTitle,
            completionDate: certData.completionDate?.toDate?.() || new Date(),
            grade: certData.grade,
            isValid: true,
        };

        return NextResponse.json({
            success: true,
            certificate
        });
    } catch (error) {
        logger.error("Failed to verify certificate:", error);
        return NextResponse.json(
            { success: false, message: "Verification failed" },
            { status: 500 }
        );
    }
}
