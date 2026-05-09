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
                { success: false, error: sessionResult.error?.error ?? "Authentication required" },
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

        // Convert file to buffer for Cloudinary
        const buffer = Buffer.from(await file.arrayBuffer());
        
        // Build public_id
        const userId = session.user.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const safeName = folder.replace(/[^a-zA-Z0-9-]/g, "-");
        const publicId = `${safeName}/${userId}/${documentType}-${timestamp}`;

        // Sign the upload request
        // Cloudinary signature: parameters must be in alphabetical order
        // Parameters we are signing: public_id, timestamp
        const crypto = await import("crypto");
        const signatureStr = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash("sha256").update(signatureStr).digest("hex");

        logger.info(`Cloudinary Upload Attempt: publicId=${publicId}, type=${file.type}, size=${file.size}`);
        logger.info(`Signature String: public_id=${publicId}&timestamp=${timestamp}REDACTED`);

        // Build form data for Cloudinary upload API
        const cloudinaryForm = new FormData();
        
        // Use a Blob for the file field - Cloudinary accepts this
        const blob = new Blob([buffer], { type: file.type });
        cloudinaryForm.append("file", blob, file.name);
        
        cloudinaryForm.append("api_key", apiKey);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("public_id", publicId);
        cloudinaryForm.append("signature", signature);

        const resourceType = file.type === "application/pdf" ? "raw" : "image";
        
        const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
        
        logger.info(`Fetching Cloudinary: ${uploadUrl}`);
        const response = await fetch(uploadUrl, { 
            method: "POST", 
            body: cloudinaryForm,
            cache: 'no-store'
        });

        if (!response.ok) {
            const errBody = await response.text();
            logger.error(`Cloudinary upload failed (HTTP ${response.status}):`, {
                body: errBody,
                publicId,
                timestamp,
                resourceType,
                fileType: file.type,
                fileSize: file.size
            });
            
            let cleanError = "File upload failed";
            try {
                const parsed = JSON.parse(errBody);
                if (parsed.error?.message) cleanError = parsed.error.message;
            } catch {
                cleanError = errBody;
            }

            return NextResponse.json(
                { success: false, error: cleanError },
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
