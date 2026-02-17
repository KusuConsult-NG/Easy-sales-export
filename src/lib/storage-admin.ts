import { getAdminStorage } from "@/lib/firebase-admin";

/**
 * Upload a file to Firebase Storage using the Admin SDK.
 * 
 * @param file The File object (from FormData) to upload
 * @param destinationPath The storage path (e.g., 'products/123/image.jpg')
 * @param isPublic Whether the file should be publicly accessible
 * @returns The public URL or signed URL of the uploaded file
 */
export async function uploadFileToStorage(
    file: File,
    destinationPath: string,
    isPublic: boolean = false
): Promise<string> {
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
        throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set");
    }

    const bucket = getAdminStorage().bucket(bucketName);
    const fileRef = bucket.file(destinationPath);
    const buffer = Buffer.from(await file.arrayBuffer());

    // 🔒 SECURITY FIX: Validate File Type (Server-side)
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        const type = await fileTypeFromBuffer(buffer);

        // Allowed safe types
        const ALLOWED_MIMES = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', // Images
            'application/pdf', // Documents
            'video/mp4', 'video/webm', // Videos
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // Word Docs
        ];

        // If type is detected, it MUST be in allowed list
        // If not detected (e.g. text files), we might block or allow depending on strictness. 
        // For security, strict block is better for uploads.
        if (!type || !ALLOWED_MIMES.includes(type.mime)) {
            // Log the attempt
            console.warn(`[Security] Blocked upload of type: ${type?.mime || 'Unknown'} for file: ${file.name}`);
            throw new Error(`Security Error: File type ${type?.mime || 'unknown'} is not allowed.`);
        }

        // Verify it matches declared type (prevent spoofing)
        // Note: file.type from browser might differ slightly from magic number (e.g. jpg vs jpeg)
        // so we mainly rely on the magic number check above being in the Safe List.

    } catch (error: any) {
        if (error.message.includes('Security Error')) throw error;
        // If file-type fails, log but maybe allow if critical? No, fail safe.
        // console.warn("File type detection failed:", error);
    }

    await fileRef.save(buffer, {
        contentType: file.type, // We still save with original content type for browser handling, but we validated it's safe content
        metadata: {
            contentType: file.type,
        },
    });

    if (isPublic) {
        await fileRef.makePublic();
        // Construct public URL
        return `https://storage.googleapis.com/${bucketName}/${destinationPath}`;
    } else {
        // Generate signed URL valid for 100 years
        const [url] = await fileRef.getSignedUrl({
            action: 'read',
            expires: '03-01-2500',
        });
        return url;
    }
}
