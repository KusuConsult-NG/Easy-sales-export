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

    await fileRef.save(buffer, {
        contentType: file.type,
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
