export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isRetired } from "@/lib/record-retirement";

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

        // #303 A removed certificate is refused here rather than by absence.
        //
        // The row used to be destroyed, so a request for a removed certificate
        // 404'd on the existence check above. Keeping the row removes that, and
        // without this the download would start working again for anything
        // somebody had already deleted — a regression introduced by the fix.

        if (isRetired(certData)) {
            return NextResponse.json(
                { success: false, error: "Certificate not found" },
                { status: 404 }
            );
        }

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
