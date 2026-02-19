import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";

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
        const certificateDoc = await db.collection("certificates").doc(certificateId).get();

        if (!certificateDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Certificate not found or invalid" },
                { status: 404 }
            );
        }

        const certData = certificateDoc.data()!;

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
