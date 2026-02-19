import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db, adminStorage } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST - Upload certificate
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { success: false, error: "No file provided" },
                { status: 400 }
            );
        }

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: "Invalid file type" },
                { status: 400 }
            );
        }

        // Upload to Firebase Storage (Admin SDK)
        const fileName = `${Date.now()}_${file.name}`;
        const storagePath = `certificates/${session.user.id}/${fileName}`;
        const bucket = adminStorage.bucket();
        const fileRef = bucket.file(storagePath);

        const buffer = Buffer.from(await file.arrayBuffer());
        await fileRef.save(buffer, {
            metadata: { contentType: file.type },
        });

        // Make file public or generate signed URL
        await fileRef.makePublic();
        const fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // Save metadata to Firestore (Admin SDK)
        await db.collection("user_certificates").add({
            userId: session.user.id,
            fileName: file.name,
            fileUrl,
            storagePath,
            fileType: file.type,
            uploadedBy: session.user.id,
            uploadedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Certificate uploaded successfully",
        });
    } catch (error: any) {
        logger.error("Upload error:", error);
        return NextResponse.json(
            { success: false, error: "Upload failed" },
            { status: 500 }
        );
    }
}
