import { logger } from "@/lib/logger";

export interface ImageKitUploadResult {
    url: string;
    fileId: string;
    name: string;
    filePath: string;
    thumbnailUrl?: string;
    fileType: string;
    size: number;
}

export interface ImageKitUploadOptions {
    buffer?: Buffer | Uint8Array;
    file?: Buffer | Uint8Array;
    fileName: string;
    folder?: string;
    mimeType?: string;
    useUniqueFileName?: boolean;
    tags?: string[];
}

/**
 * Checks whether ImageKit is properly configured in the current environment.
 * Requires private key.
 */
export function isImageKitConfigured(): boolean {
    return Boolean(process.env.IMAGEKIT_PRIVATE_KEY);
}

/**
 * Resolves the ImageKit base URL endpoint (e.g. "https://ik.imagekit.io/Easysales")
 * without a trailing slash.
 */
export function getImageKitEndpoint(): string {
    const raw = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/Easysales";
    return raw.replace(/\/+$/, "");
}

/**
 * Returns the ImageKit account ID/directory prefix (e.g. "Easysales").
 */
export function getImageKitId(): string {
    if (process.env.IMAGEKIT_ID) {
        return process.env.IMAGEKIT_ID.trim();
    }
    const endpoint = getImageKitEndpoint();
    try {
        const parsed = new URL(endpoint);
        const segment = parsed.pathname.split("/").filter(Boolean)[0];
        if (segment) return segment;
    } catch {
        // fallback
    }
    return "Easysales";
}

/**
 * Uploads a file buffer to ImageKit via their official REST API.
 */
export async function uploadToImageKit(options: ImageKitUploadOptions): Promise<ImageKitUploadResult> {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("[imagekit] IMAGEKIT_PRIVATE_KEY is not configured.");
    }

    const rawBuffer = options.buffer || options.file;
    if (!rawBuffer) {
        throw new Error("[imagekit] No file buffer provided for upload.");
    }
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    const { fileName, folder, mimeType, useUniqueFileName = true, tags } = options;
    const authHeader = "Basic " + Buffer.from(privateKey + ":").toString("base64");

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || "application/octet-stream" });
    formData.append("file", blob, fileName);
    formData.append("fileName", fileName);

    if (folder) {
        const cleanFolder = folder.replace(/^\/+/, "");
        formData.append("folder", `/${cleanFolder}`);
    }

    formData.append("useUniqueFileName", String(useUniqueFileName));

    if (tags && tags.length > 0) {
        formData.append("tags", tags.join(","));
    }

    logger.info(`[imagekit] Uploading ${fileName} (${buffer.length} bytes) to folder: ${folder || "/"}`);

    const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST",
        headers: {
            Authorization: authHeader,
        },
        body: formData,
        cache: "no-store",
    });

    if (!response.ok) {
        const errText = await response.text();
        logger.error(`[imagekit] Upload failed (HTTP ${response.status}):`, {
            fileName,
            status: response.status,
            body: errText,
        });

        let cleanMessage = "File upload to ImageKit failed.";
        try {
            const parsed = JSON.parse(errText);
            if (parsed.message) cleanMessage = parsed.message;
        } catch {
            cleanMessage = errText || cleanMessage;
        }

        throw new Error(`ImageKit upload failed (${response.status}): ${cleanMessage}`);
    }

    const data = await response.json();

    logger.info(`[imagekit] Upload succeeded: ${data.url}`);

    return {
        url: data.url,
        fileId: data.fileId,
        name: data.name,
        filePath: data.filePath,
        thumbnailUrl: data.thumbnailUrl,
        fileType: data.fileType,
        size: data.size,
    };
}

/**
 * Deletes a file from ImageKit by fileId.
 */
export async function deleteFromImageKit(fileId: string): Promise<boolean> {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
        logger.warn("[imagekit] Cannot delete: IMAGEKIT_PRIVATE_KEY is not configured.");
        return false;
    }

    const authHeader = "Basic " + Buffer.from(privateKey + ":").toString("base64");

    try {
        const res = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
            method: "DELETE",
            headers: { Authorization: authHeader },
        });
        return res.status === 204 || res.status === 200;
    } catch (err: any) {
        logger.error("[imagekit] Delete file error", { fileId, error: err?.message });
        return false;
    }
}
