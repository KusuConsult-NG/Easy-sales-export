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
import { shouldUseLocalDiskStorage, writeToLocalDisk } from "@/lib/storage-backend";

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
        // The rule now lives in ONE place: src/lib/storage-backend.ts.
        //
        // It was written out here, in /api/upload and (as a hard throw) in
        // storage-admin.ts. The copies drifted twice: once when /api/upload was
        // fixed and this action was not, and again when the e2e suite moved to a
        // production build — `NODE_ENV !== "production"` stopped being true, the
        // route was widened to recognise a local stack, and this copy was
        // missed, so the loan wizard's document step still 503'd.
        const useLocalDisk = shouldUseLocalDiskStorage();

        if (!useLocalDisk && (!cloudName || !apiKey || !apiSecret)) { logger.error("[uploadDocumentAction] Cloudinary environment variables not configured");
            return { success: false as const, error: "Upload service is temporarily unavailable. Please try again later or contact support."};
        }

        // ── Build signed Cloudinary upload ───────────────────────────────────
        const timestamp = Math.floor(Date.now() / 1000);

        // THE EXTENSION COMES FROM THE VALIDATED TYPE, NOT THE FILENAME.
        //
        // This used to be `originalName.slice(lastIndexOf("."))` — everything
        // after the last dot of the caller's fileName, appended to publicId
        // raw. The mime-type gate above does not constrain it, so a fileName
        // like "doc.x/../../../evil" produced an "extension" of
        // ".x/../../../evil" carrying path separators and `..`. On the
        // local-disk branch that reaches path.join, which collapses the `..`
        // and writes OUTSIDE public/uploads/local; on Cloudinary it forges the
        // stored public_id. The comment two blocks down claimed publicId was
        // "already sanitised per segment, so it cannot escape" — true of
        // safeName, never true of this appended extension.
        //
        // /api/upload was fixed for exactly this (its own comment names the
        // "doc.pdf/../x" case) by taking the extension from the detected type.
        // This action is the copy that was missed — the same two-upload-paths
        // drift this audit keeps finding. ALLOWED_TYPES already maps the mime
        // to its extension, and mimeType has been validated against it above.
        const extension = `.${ext}`;

        const safeName = documentType.replace(/[^a-zA-Z0-9-]/g, "-");
        const publicId = `documents/${userId}/${safeName}-${timestamp}${extension}`;

        // Local disk backend — the shared implementation, not a copy of it.
        // publicId is already sanitised to [a-zA-Z0-9-] per segment, so it
        // cannot escape the uploads directory.
        if (useLocalDisk) {
            const localUrl = await writeToLocalDisk(publicId, Buffer.from(await file.arrayBuffer()));
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
        // The guard above returns unless all three credentials are present,
        // and the local-disk branch returns before reaching here — so this is
        // reached only when apiKey is set. The compiler cannot follow that
        // two-step reasoning; without the narrowing, `undefined` would be
        // appended as the string "undefined" and Cloudinary would reject the
        // upload with an unhelpful message.
        cloudinaryForm.append("api_key", apiKey as string);
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
