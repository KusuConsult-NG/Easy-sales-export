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

        // Missing Cloudinary configuration is a hard failure in production and a
        // local disk write in development — the same rule /api/upload applies,
        // and for the same reason.
        //
        // This is a SECOND copy of that credential gate. /api/upload was fixed;
        // this action was not, so the loan wizard's document step still could
        // not upload anything locally and the whole application flow was
        // untestable without a real Cloudinary account. Two upload paths with
        // one rule between them is the duplication pattern this audit keeps
        // finding; they now behave identically.
        //
        // GUARDED ON NODE_ENV, NOT A FLAG. Production must keep failing loudly:
        // writing customer documents onto an ephemeral container filesystem
        // would look like it worked and lose them at the next deploy.
        const useLocalDisk = (!cloudName || !apiKey || !apiSecret) && process.env.NODE_ENV !== "production";

        if (!useLocalDisk && (!cloudName || !apiKey || !apiSecret)) { logger.error("[uploadDocumentAction] Cloudinary environment variables not configured");
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

        // Local disk backend, mirroring /api/upload. publicId is already
        // sanitised to [a-zA-Z0-9-] per segment, so it cannot escape the
        // directory below.
        if (useLocalDisk) {
            const { writeFile, mkdir } = await import("fs/promises");
            const path = await import("path");

            const relative = path.posix.join("uploads", "local", publicId);
            const absolute = path.join(process.cwd(), "public", relative);

            await mkdir(path.dirname(absolute), { recursive: true });
            await writeFile(absolute, Buffer.from(await file.arrayBuffer()));

            // ABSOLUTE, like Cloudinary's secure_url.
            //
            // A relative "/uploads/..." satisfies an <img src> but fails
            // z.string().url(), which loanApplicationSchema applies to every
            // document. The file uploaded, the form field was set, and step 4
            // still refused to advance — the local backend has to honour the
            // same contract as the remote one, not merely produce something
            // that renders.
            const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
            const localUrl = `${base}/${relative}`;
            logger.info(`[uploadDocumentAction] Wrote to local disk (no Cloudinary configured): ${localUrl}`);
            return { error: null, success: true as const, url: localUrl, data: null };
        }

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
