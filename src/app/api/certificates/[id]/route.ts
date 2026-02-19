import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db, adminStorage } from "@/lib/firebase-admin";

/**
 * DELETE - Delete certificate
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Get certificate (Admin SDK)
        const certDoc = await db.collection("user_certificates").doc(id).get();

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

        // Delete from storage (Admin SDK)
        try {
            const bucket = adminStorage.bucket();
            const file = bucket.file(certData.storagePath || certData.fileUrl);
            await file.delete();
        } catch (storageError: any) {
            logger.warn("Storage delete failed (file may not exist):", storageError);
        }

        // Delete from Firestore (Admin SDK)
        await db.collection("user_certificates").doc(id).delete();

        return NextResponse.json({
            success: true,
            message: "Certificate deleted",
        });
    } catch (error: any) {
        logger.error("Delete error:", error);
        return NextResponse.json(
            { success: false, error: "Delete failed" },
            { status: 500 }
        );
    }
}
