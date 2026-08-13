export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { withRateLimit } from "@/lib/rate-limit";
import { assertAllowedFileType, detectFileType } from "@/lib/storage-admin";

/**
 * What this route accepts, by CONTENT.
 *
 * Deliberately narrower than storage-admin's ALLOWED_MIMES, which also permits
 * Word documents — this list is the one the route advertises in its own error
 * message, and it is now the one actually enforced.
 */
const ALLOWED_UPLOAD_TYPES = [
    "application/pdf",
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm",
];

/**
 * The extension a stored asset gets, chosen by its real type.
 *
 * Cloudinary serves a `raw` asset according to its extension, so this is what
 * decides the Content-Type a browser sees. Taking it from the uploaded
 * filename let the caller choose that.
 */
const EXTENSION_FOR_TYPE: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
};

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
        let detectedType: string | undefined;
        try {
            await assertAllowedFileType(buffer, file.name || "upload");
            detectedType = await detectFileType(buffer, file.name || "upload");
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

        // The narrow list is applied to the DETECTED type, not the declared one.
        //
        // The check near the top tests `file.type` against this route's list;
        // assertAllowedFileType then tests the CONTENT against storage-admin's,
        // which is broader — it also permits Word documents. A .docx declared as
        // application/pdf therefore satisfied both: the first because the claim
        // was allowed, the second because the content was allowed somewhere.
        // Two checks, neither of which compared the two answers.
        if (!detectedType || !ALLOWED_UPLOAD_TYPES.includes(detectedType)) {
            return NextResponse.json(
                { success: false, error: "This file's contents do not match an allowed file type." },
                { status: 400 }
            );
        }

        // The extension comes from the detected type, not from the filename.
        //
        // This is the half of the comment above that was still open.
        // safeDocType and safeFolderName are sanitised; `extension` was
        // `originalName.slice(lastIndexOf("."))` and went into public_id raw.
        //
        // Two things followed. A file whose CONTENT is a valid PDF but whose
        // name ends .html was stored with that extension, and Cloudinary serves
        // a raw asset by its extension — so the business's own account served
        // attacker-supplied HTML from a trusted-looking URL. A PDF only needs
        // "%PDF-" near the start, so one file can satisfy the magic-byte check
        // and still be a working HTML page.
        //
        // And a name like "doc.pdf/../x" yields an "extension" containing
        // slashes, injecting path segments into the public_id that the folder
        // sanitiser exists to prevent.
        const userId = session.user.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const extension = EXTENSION_FOR_TYPE[detectedType] ?? "";

        const safeDocType = documentType.replace(/[^a-zA-Z0-9-]/g, "-");
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
        const blob = new Blob([buffer], { type: detectedType });
        cloudinaryForm.append("file", blob, file.name);
        
        cloudinaryForm.append("api_key", apiKey);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("public_id", publicId);
        cloudinaryForm.append("signature", signature);

        // Determine Cloudinary resource type
        // "raw" for PDFs/documents, "video" for video files, "image" for everything else
        // Also from the detected type. Choosing this from the client's claim
        // meant a PNG declared as application/pdf was stored as a raw asset.
        const resourceType = detectedType === "application/pdf"
            ? "raw"
            : detectedType.startsWith("video/")
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
