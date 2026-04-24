export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET - Download certificate
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

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { success: false, error: "Certificate ID required" },
                { status: 400 }
            );
        }

        // Get certificate (Admin SDK)
        const certDoc = await db.collection(COLLECTIONS.USER_CERTIFICATES).doc(id).get();

        if (!certDoc.exists) {
            return NextResponse.json(
                { success: false, error: "Certificate not found" },
                { status: 404 }
            );
        }

        const certData = certDoc.data()!;

        // Access control
        if (certData.userId !== session.user.id &&
            !session.user.roles?.includes("admin") &&
            !session.user.roles?.includes("super_admin")) {
            return NextResponse.json(
                { success: false, error: "Access denied" },
                { status: 403 }
            );
        }

        // Redirect to Firebase Storage URL for download
        return NextResponse.redirect(certData.fileUrl);
    } catch (error: any) {
        logger.error("Download error:", error);
        return NextResponse.json(
            { success: false, error: "Download failed" },
            { status: 500 }
        );
    }
}
