export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { withRateLimit } from "@/lib/rate-limit";
import { assertAllowedFileType } from "@/lib/storage-admin";

/**
 * POST - Generic File Upload via Cloudinary
 *
 * Firebase Storage bucket doesn't exist on this project.
 * Using Cloudinary instead — configured via CLOUDINARY_* env vars.
 *
 * Form Data:
 * - file: File (Required) - Max 50MB: images (JPG/PNG/WebP), PDFs, videos (MP4/MOV/WebM)
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
        const allowedTypes = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/jpg",
            "image/webp",
            "image/gif",
            // Video — used for marketplace product demos
            "video/mp4",
            "video/quicktime",
            "video/webm",
        ];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: "Invalid file type. Allowed: JPG, PNG, WebP, PDF, MP4, MOV, WebM." },
                { status: 400 }
            );
        }

        // Validate file size
        // MasterUploader defaults to 50MB for Academy/admin content; other flows use 5MB.
        // The API accepts up to 50MB so components can control limits client-side.
        const maxSize = 50 * 1024 * 1024; // 50 MB
        if (file.size > maxSize) {
            return NextResponse.json(
                { success: false, error: "File is too large. Maximum allowed size is 50MB." },
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

        // The check above tests `file.type`, which is the Content-Type the
        // CLIENT wrote into the multipart body. It is a claim, not a fact —
        // arbitrary bytes can be posted as "image/png".
        //
        // src/lib/storage-admin.ts has always read the magic bytes and failed
        // closed, and the marketplace product path goes through it. This route —
        // the generic one behind MasterUploader, and so the one most uploads
        // actually use — did not. The stricter check was on the less-travelled
        // path: the same shape as the vendor writers and the escrow confirm.
        //
        // It matters here specifically because a PDF is uploaded to Cloudinary
        // as `raw`, and the stored public_id keeps the caller's extension. A
        // file declared application/pdf and named .html is then served as HTML
        // from the business's own Cloudinary account.
        //
        // Caught here rather than left to the outer handler, which reports every
        // failure as an unexpected 500. A rejected file is a client error.
        try {
            await assertAllowedFileType(buffer, file.name || "upload");
        } catch (validationError: any) {
            logger.warn("[upload] content validation rejected a file", {
                userId: session.user.id,
                declaredType: file.type,
                fileName: file.name,
                reason: validationError?.message,
            });
            return NextResponse.json(
                { success: false, error: "This file's contents do not match an allowed file type." },
                { status: 400 }
            );
        }

        // Build public_id with correct file extension at the end (required by Cloudinary raw uploads like PDFs)
        const userId = session.user.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const originalName = file.name || "document";
        const extensionIdx = originalName.lastIndexOf(".");
        const extension = extensionIdx !== -1 ? originalName.slice(extensionIdx) : "";
        
        let baseDocType = documentType;
        if (extension && baseDocType.endsWith(extension)) {
            baseDocType = baseDocType.slice(0, -extension.length);
        }
        
        const safeDocType = baseDocType.replace(/[^a-zA-Z0-9-]/g, "-");
        const safeFolderName = folder.split("/").map(part => part.replace(/[^a-zA-Z0-9-]/g, "-")).join("/");
        const publicId = `${safeFolderName}/${userId}/${safeDocType}-${timestamp}${extension}`;

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

        // Determine Cloudinary resource type
        // "raw" for PDFs/documents, "video" for video files, "image" for everything else
        const resourceType = file.type === "application/pdf"
            ? "raw"
            : file.type.startsWith("video/")
            ? "video"
            : "image";
        
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
