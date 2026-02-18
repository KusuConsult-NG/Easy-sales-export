"use server";

/**
 * Server-side file upload to Cloudinary
 *
 * Firebase Storage bucket doesn't exist on this project.
 * Using Cloudinary instead — already configured and working.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const MAX_SIZE_MB = 5;

export async function uploadDocumentAction(
    base64Data: string,
    fileName: string,
    mimeType: string,
    documentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
        // Auth check
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Validate mime type
        if (!ALLOWED_TYPES.includes(mimeType)) {
            return { success: false, error: "Invalid file type. Only JPG, PNG, PDF allowed." };
        }

        // Decode base64 to check size
        const base64Content = base64Data.split(",").pop() || base64Data;
        const buffer = Buffer.from(base64Content, "base64");
        const sizeMB = buffer.byteLength / (1024 * 1024);
        if (sizeMB > MAX_SIZE_MB) {
            return { success: false, error: `File too large. Max ${MAX_SIZE_MB}MB.` };
        }

        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
            return { success: false, error: "Upload service not configured." };
        }

        // Build public_id: cooperative-documents/{userId}/{documentType}-{timestamp}
        const userId = session.user.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const publicId = `cooperative-documents/${userId}/${documentType}-${timestamp}`;

        // Sign the upload request
        const crypto = await import("crypto");
        const signatureStr = `folder=cooperative-documents&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash("sha256").update(signatureStr).digest("hex");

        // Build form data for Cloudinary upload API
        const formData = new FormData();
        formData.append("file", base64Data);
        formData.append("api_key", apiKey);
        formData.append("timestamp", String(timestamp));
        formData.append("public_id", publicId);
        formData.append("folder", "cooperative-documents");
        formData.append("signature", signature);
        // Allow PDF uploads
        formData.append("resource_type", mimeType === "application/pdf" ? "raw" : "image");

        const resourceType = mimeType === "application/pdf" ? "raw" : "image";
        const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

        const response = await fetch(uploadUrl, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errBody = await response.text();
            logger.error("Cloudinary upload failed:", errBody);
            return { success: false, error: "Upload failed. Please try again." };
        }

        const result = await response.json();
        const url = result.secure_url;

        logger.info(`Document uploaded to Cloudinary: ${url}`);
        return { success: true, url };

    } catch (error) {
        logger.error("Document upload failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Upload failed",
        };
    }
}
