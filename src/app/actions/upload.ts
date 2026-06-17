"use server";

/**
 * Server-side file upload — Cloudinary (sole upload provider)
 *
 * STRATEGY:
 *  1. Validate auth, mime type, and file size
 *  2. Send file to Cloudinary via signed upload API
 *  3. Return { error: null, success: true as const, url } or { success: false as const, error }
 *
 * IMPORTANT: Firebase Storage is NOT used. All uploads go to Cloudinary.
 * The old Firebase Storage + Firestore fallback path was removed because:
 *  a) The Firebase Storage bucket does not exist in the Railway environment
 *  b) The bucket.exists() check was throwing and escaping try/catch,
 *     causing Server Component renderer crashes visible to end users
 *  c) The /api/upload route already uses Cloudinary successfully
 */

import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES: Record<string, string> = { "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf" };

const MAX_SIZE_MB = 5;

// ── Main export ──────────────────────────────────────────────────────────────
export async function uploadDocumentAction(
    formData: FormData
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const file = formData.get("file") as File | null;
        const fileName = formData.get("fileName") as string;
        const mimeType = formData.get("mimeType") as string;
        const documentType = formData.get("documentType") as string;

        if (!file || !fileName || !mimeType || !documentType) {
            return { success: false as const, error: "Missing required upload parameters.", data: null };
        }

        // ── Auth check ───────────────────────────────────────────────────────
        const sessionResult = await requireSession();
        if (!sessionResult.session) { return { success: false as const, error: "Your session has expired. Please log in again.", data: null };
        }
        const { session } = sessionResult;
        const userId = session.user.id;

        // ── Validate mime type ───────────────────────────────────────────────
        const ext = ALLOWED_TYPES[mimeType];
        if (!ext) { return { success: false as const, error: "Invalid file type. Only JPG, PNG, PDF allowed.", data: null };
        }

        // ── Size-check ───────────────────────────────────────────────────────
        // size property on File is in bytes natively. 
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > MAX_SIZE_MB) { return { success: false as const, error: `File too large. Max ${MAX_SIZE_MB}MB.` };
        }
        logger.info(`[Upload:Start] User:${userId} | Stream Size: ${sizeMB.toFixed(2)}MB`);

        // ── Cloudinary credentials check ─────────────────────────────────────
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) { logger.error("[uploadDocumentAction] Cloudinary environment variables not configured");
            return { success: false as const, error: "Upload service is temporarily unavailable. Please try again later or contact support."};
        }

        // ── Build signed Cloudinary upload ───────────────────────────────────
        const timestamp = Math.floor(Date.now() / 1000);
        const originalName = fileName || file.name || "document";
        const extensionIdx = originalName.lastIndexOf(".");
        const extension = extensionIdx !== -1 ? originalName.slice(extensionIdx) : "";
        
        let baseDocType = documentType;
        if (extension && baseDocType.endsWith(extension)) {
            baseDocType = baseDocType.slice(0, -extension.length);
        }
        
        const safeName = baseDocType.replace(/[^a-zA-Z0-9-]/g, "-");
        const publicId = `documents/${userId}/${safeName}-${timestamp}${extension}`;

        const crypto = await import("crypto");
        const signatureStr = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash("sha256").update(signatureStr).digest("hex");

        const resourceType = mimeType === "application/pdf" ? "raw" : "image";

        const cloudinaryForm = new FormData();
        // Zero-copy stream mapping directly from incoming request stream to Cloudinary
        cloudinaryForm.append("file", file);
        cloudinaryForm.append("api_key", apiKey);
        cloudinaryForm.append("timestamp", String(timestamp));
        cloudinaryForm.append("public_id", publicId);
        cloudinaryForm.append("signature", signature);
        cloudinaryForm.append("resource_type", resourceType);

        const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
        const response = await fetch(uploadUrl, { method: "POST", body: cloudinaryForm });

        if (!response.ok) { const errBody = await response.text();
            logger.error("[uploadDocumentAction] Cloudinary upload failed:", errBody);
            return { success: false as const, error: "File upload failed. Please check your file and try again."};
        }

        const result = await response.json();
        const url: string = result.secure_url;

        logger.info(`[uploadDocumentAction] Uploaded to Cloudinary: ${documentType} for user ${userId}`);
        return { error: null, success: true as const, url , data: null };

    } catch (error) { logger.error("[uploadDocumentAction] Unexpected error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Upload failed. Please try again.", data: null };
    }
}
