export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { adminStorage } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * POST - Upload certificate
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const contentType = request.headers.get("content-type") || "";
        let fileUrl = "";
        let fileName = "";
        let fileType = "";
        let storagePath = "";

        if (contentType.includes("application/json")) {
            const body = await request.json();
            fileUrl = body.fileUrl;
            fileName = body.fileName;
            fileType = body.fileType;

            if (!fileUrl || !fileName || !fileType) {
                return NextResponse.json(
                    { success: false, error: "Missing required JSON fields (fileUrl, fileName, fileType)" },
                    { status: 400 }
                );
            }

            // Strictly validate that the URL matches an authorized storage domain
            try {
                const parsedUrl = new URL(fileUrl);
                const allowedHostnames = [
                    "res.cloudinary.com"
                ];
                const hostname = parsedUrl.hostname;
                const isAllowed = allowedHostnames.some(allowed => 
                    hostname === allowed || hostname.endsWith("." + allowed)
                );
                
                if (!isAllowed) {
                    return NextResponse.json(
                        { success: false, error: "Unauthorized file hosting domain" },
                        { status: 400 }
                    );
                }
            } catch (e) {
                return NextResponse.json(
                    { success: false, error: "Invalid URL format for fileUrl" },
                    { status: 400 }
                );
            }
        } else {
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
            fileName = file.name;
            fileType = file.type;
            const uniqueFileName = `${Date.now()}_${file.name}`;
            storagePath = `certificates/${session.user.id}/${uniqueFileName}`;
            const bucket = adminStorage.bucket();
            const fileRef = bucket.file(storagePath);

            const buffer = Buffer.from(await file.arrayBuffer());
            await fileRef.save(buffer, {
                metadata: { contentType: file.type },
            });

            // Make file public or generate signed URL
            await fileRef.makePublic();
            fileUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        }

        // Save metadata to Firestore (Admin SDK)
        await db.collection(COLLECTIONS.USER_CERTIFICATES).add({
            userId: session.user.id,
            fileName,
            fileUrl,
            storagePath,
            fileType,
            uploadedBy: session.user.id,
            uploadedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
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
