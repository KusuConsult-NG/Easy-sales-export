/**
 * File Upload Utilities — Cloudinary via /api/upload
 *
 * NOTE: Firebase Storage bucket is NOT provisioned on this project.
 * All file uploads are routed through Cloudinary via the authenticated
 * /api/upload route. This module is a drop-in replacement for the
 * previous firebase/storage implementation, maintaining identical
 * function signatures so all existing callers work unchanged.
 *
 * Callers:
 *   - src/app/admin/academy/[courseId]/page.tsx (course content uploads)
 *   - src/app/dashboard/disputes/new/page.tsx   (dispute evidence uploads)
 */

export interface UploadProgress {
    progress: number; // 0–100
    status: "uploading" | "completed" | "error";
    url?: string;
    error?: string;
}

/**
 * Upload a file to Cloudinary via the authenticated /api/upload route.
 *
 * @param file       - File to upload
 * @param path       - Logical storage path (used to derive folder + documentType)
 * @param onProgress - Optional callback for upload progress updates
 * @returns          Promise with the Cloudinary secure_url download URL
 */
export async function uploadFile(
    file: File,
    path: string,
    onProgress?: (progress: UploadProgress) => void
): Promise<string> {
    onProgress?.({ progress: 10, status: "uploading" });

    // Derive folder and documentType from the logical path
    const segments = path.split("/");
    const folder = segments.slice(0, -1).join("/") || "uploads";
    const documentType = segments[segments.length - 1]?.replace(/^\d+_/, "") || file.name;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);
    formData.append("documentType", documentType);

    // Simple retry wrapper with progress updates
    const uploadWithRetry = async (attempt = 1): Promise<any> => {
        try {
            onProgress?.({ progress: 20 + attempt * 15, status: "uploading" });

            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (!res.ok || !data.success || !data.url) {
                throw new Error(data.error || "Upload failed");
            }

            return data;
        } catch (err: any) {
            if (attempt < 3) {
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
                return uploadWithRetry(attempt + 1);
            }
            throw err;
        }
    };

    try {
        const result = await uploadWithRetry();

        onProgress?.({ progress: 100, status: "completed", url: result.url });
        return result.url as string;
    } catch (error: any) {
        const message = error instanceof Error ? error.message : "Upload failed";
        onProgress?.({ progress: 0, status: "error", error: message });
        throw new Error(message);
    }
}

/**
 * Validate a file before upload.
 *
 * @param file         - File to validate
 * @param maxSizeMB    - Maximum file size in MB (default: 50MB)
 * @param allowedTypes - Allowed MIME types
 * @returns Validation result
 */
export function validateFile(
    file: File,
    maxSizeMB: number = 50,
    allowedTypes: string[] = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
        "application/pdf",
        "video/mp4",
        "video/quicktime",
        "video/webm",
    ]
): { valid: boolean; error?: string } {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        return {
            valid: false,
            error: `File size must be less than ${maxSizeMB}MB`,
        };
    }

    if (!allowedTypes.includes(file.type)) {
        return {
            valid: false,
            error: `File type must be one of: ${allowedTypes.map((t) => t.split("/")[1]).join(", ")}`,
        };
    }

    return { valid: true };
}

/**
 * Generate a unique logical file path.
 *
 * @param userId       - User ID
 * @param documentType - Type of document (e.g., 'valid-id', 'passport-photo')
 * @param fileName     - Original file name
 * @returns Logical storage path used by uploadFile
 */
export function generateDocumentPath(
    userId: string,
    documentType: string,
    fileName: string
): string {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `cooperative/documents/${userId}/${documentType}-${timestamp}-${sanitizedFileName}`;
}
