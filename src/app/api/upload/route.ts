export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * POST - Generic File Upload via Cloudinary
 *
 * Firebase Storage bucket doesn't exist on this project.
 * Using Cloudinary instead — configured via CLOUDINARY_* env vars.
 *
 * Form Data:
 * - file: File (Required) - Max 5MB, Images or PDF
 * - folder: string (Optional) - Default 'uploads'
 * - documentType: string (Optional) - Default 'document'
 */
async function uploadHandler(request: NextRequest) {
    try {
        const sessionResult = await requireSession();

        if (!sessionResult.session) {
            return NextResponse.json(
                { success: false, error: sessionResult.error.error },
                { status: 401 }
            );
        }
        
        const { session } = sessionResult;

        const formData = await request.formData();
        const file = formData.get("file") as File;
        const folder = (formData.get("folder") as string) || "uploads";
        const documentType = (formData.get("documentType") as string) || "document";

        if (!file || file.size === 0) {
            return NextResponse.json(
                { success: false, error: "No file provided. Please select a file to upload." },
                { status: 400 }
            );
        }

        // Validate file type
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: "Invalid file type. Please upload a JPG, PNG, WebP, or PDF file." },
                { status: 400 }
            );
        }

        // Validate file size (5MB)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            return NextResponse.json(
                { success: false, error: "File is too large. Maximum allowed size is 5MB." },
                { status: 400 }
            );
        }

        // Check Cloudinary credentials
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
            logger.error("Upload failed: Cloudinary environment variables not configured");
            return NextResponse.json(
                { success: false, error: "Upload service is temporarily unavailable. Please try again later or contact support." },
                { status: 503 }
            );
        }

        // Convert file to base64
        const buffer = Buffer.from(await file.arrayBuffer());
        const base64 = buffer.toString("base64");
        const dataUri = `data:${file.type};base64,${base64}`;

        // Build public_id
        const userId = session.user.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const safeName = folder.replace(/[^a-zA-Z0-9-]/g, "-");
        const publicId = `${safeName}/${userId}/${documentType}-${timestamp}`;

        // Sign the upload request
        const crypto = await import("crypto");
        const signatureStr = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash("sha256").update(signatureStr).digest("hex");

        // Build form data for Cloudinary upload API
        const cloudinaryForm = new FormData();
        cloudinaryForm.append("file", dataUri);
        cloudinaryForm.append("api_key", apiKey);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("public_id", publicId);
        cloudinaryForm.append("signature", signature);

        const resourceType = file.type === "application/pdf" ? "raw" : "image";
        cloudinaryForm.append("resource_type", resourceType);

        const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
        const response = await fetch(uploadUrl, { method: "POST", body: cloudinaryForm });

        if (!response.ok) {
            const errBody = await response.text();
            logger.error("Cloudinary upload failed:", errBody);
            return NextResponse.json(
                { success: false, error: "File upload failed. Please check your file and try again." },
                { status: 502 }
            );
        }

        const result = await response.json();
        const url = result.secure_url;

        logger.info(`File uploaded to Cloudinary: ${url}`);
        return NextResponse.json({
            success: true,
            url,
            filename: file.name,
            path: publicId,
        });

    } catch (error: any) {
        logger.error("Upload route error:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred during upload. Please try again." },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(uploadHandler);
