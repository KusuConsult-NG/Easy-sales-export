import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { adminStorage } from "@/lib/firebase-admin";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * POST - Generic File Upload
 *
 * Uploads a file to Firebase Storage (Admin SDK).
 * Requires Authentication.
 *
 * Form Data:
 * - file: File (Required) - Max 5MB, Images or PDF
 * - folder: string (Optional) - Default 'uploads'
 */
async function uploadHandler(request: NextRequest) {
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
        const folder = (formData.get("folder") as string) || "uploads";

        if (!file) {
            return NextResponse.json(
                { success: false, error: "No file provided" },
                { status: 400 }
            );
        }

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp", "image/gif"];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: "Invalid file type. Only images and PDFs are allowed." },
                { status: 400 }
            );
        }

        // Validate file size (5MB)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            return NextResponse.json(
                { success: false, error: "File size exceeds 5MB limit" },
                { status: 400 }
            );
        }

        // Sanitize filename and folder
        const sanitizedFolder = folder.replace(/[^a-zA-Z0-9]/g, "");
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const fileName = `${Date.now()}_${safeName}`;

        // Path: uploads/{userId}/{folder}/{timestamp}_{filename}
        const storagePath = `uploads/${session.user.id}/${sanitizedFolder}/${fileName}`;
        const bucket = adminStorage.bucket();
        const fileRef = bucket.file(storagePath);

        const buffer = Buffer.from(await file.arrayBuffer());
        await fileRef.save(buffer, {
            metadata: { contentType: file.type },
        });

        // Generate signed URL (valid for 7 days)
        const [signedUrl] = await fileRef.getSignedUrl({
            action: "read",
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        return NextResponse.json({
            success: true,
            url: signedUrl,
            filename: fileName,
            path: storagePath
        });

    } catch (error: any) {
        logger.error("Generic upload error:", error);
        return NextResponse.json(
            { success: false, error: "Upload failed: " + (error.message || "Unknown error") },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(uploadHandler);
