import { logger } from "@/lib/logger";
import { shouldUseLocalDiskStorage, writeToLocalDisk } from "@/lib/storage-backend";

/**
 * Server-side file upload.
 *
 * This module used to call the Firebase Storage Admin SDK. Firebase Storage is
 * not provisioned for this project — `firebase-admin/storage` resolves to the
 * local shim in src/lib/shims, whose bucket handle only implements save/delete/
 * exists as no-ops. `save()` therefore stored nothing, and the very next line
 * called `makePublic()` / `getSignedUrl()`, which the shim does not define at
 * all. Every server-side upload — marketplace product images and videos,
 * certificates, export documents — threw
 * "fileRef.makePublic is not a function" before returning a URL.
 *
 * Uploads now go to Cloudinary, which is where the rest of the application
 * already stores files (see src/app/api/upload/route.ts and
 * src/lib/storage-upload.ts). The exported signature is unchanged so existing
 * callers keep working.
 */

const ALLOWED_MIMES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',       // Images
    'application/pdf',                                          // Documents
    'video/mp4', 'video/webm', 'video/quicktime',               // Videos
    'application/msword',                                       // Word Docs
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * Reject anything whose magic bytes are not on the allow list.
 *
 * The previous implementation wrapped the whole check in a try/catch that
 * swallowed every error except its own, so a `file-type` import failure
 * silently disabled content validation. Detection failures now fail closed.
 */
/**
 * The MIME type of a buffer's actual CONTENT, by magic bytes.
 *
 * Split out of assertAllowedFileType so a caller with a narrower policy than
 * ALLOWED_MIMES can enforce it against what the file really is. certificates.ts
 * accepts only PDFs and images, and was checking `file.type` — a string the
 * client sends — while this list also permits video and Word documents. So an
 * MP4 declared as `application/pdf` passed both checks and was recorded as a
 * PDF.
 *
 * Detection failure throws rather than returning undefined: a caller cannot tell
 * "not a recognised type" from "the detector broke" otherwise, and the second
 * must never be treated as permission.
 */
export async function detectFileType(buffer: Buffer, fileName: string): Promise<string | undefined> {
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        const type = await fileTypeFromBuffer(buffer);
        return type?.mime;
    } catch (error: any) {
        logger.error('[storage-admin] File type detection failed', { fileName, error: error?.message });
        throw new Error('Security Error: unable to verify file contents.');
    }
}

export async function assertAllowedFileType(buffer: Buffer, fileName: string): Promise<void> {
    const detectedMime = await detectFileType(buffer, fileName);

    if (!detectedMime || !ALLOWED_MIMES.includes(detectedMime)) {
        logger.warn(`[storage-admin] Blocked upload of type ${detectedMime || 'unknown'} for file ${fileName}`);
        throw new Error(`Security Error: File type ${detectedMime || 'unknown'} is not allowed.`);
    }
}

/**
 * Upload a file to Cloudinary and return its delivery URL.
 *
 * @param file            The File object (from FormData) to upload
 * @param destinationPath Logical storage path, e.g. 'products/123/image.jpg'.
 *                        Used to derive the Cloudinary public_id.
 * @param _isPublic       Retained for call-site compatibility. Cloudinary
 *                        delivery URLs are used for both cases; the parameter
 *                        no longer changes the returned URL.
 * @returns               The secure delivery URL of the uploaded file
 */
export async function uploadFileToStorage(
    file: File,
    destinationPath: string,
    _isPublic: boolean = false
): Promise<string> {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // THIS WAS THE THIRD COPY OF THE RULE, AND THE ONE WITH NO LOCAL BRANCH.
    //
    // /api/upload and actions/upload.ts both fall back to a local disk write
    // when Cloudinary is absent. This function just threw, and it is the
    // uploader behind certificates, marketplace product images, seller
    // verification and marketplace onboarding — so all of those were
    // impossible to exercise without a real Cloudinary account, which is a
    // large hole in what can be tested locally.
    //
    // The rule is now shared: see src/lib/storage-backend.ts.
    const useLocalDisk = shouldUseLocalDiskStorage();

    if (!useLocalDisk && (!cloudName || !apiKey || !apiSecret)) {
        logger.error('[storage-admin] Cloudinary credentials are not configured');
        throw new Error('Upload service is not configured. Please contact support.');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await assertAllowedFileType(buffer, file.name);

    // Preserve the extension on the public_id — Cloudinary needs it for raw
    // (non-image) assets such as PDFs to be served with the right content type.
    const originalName = file.name || 'document';
    const extensionIdx = originalName.lastIndexOf('.');
    const extension = extensionIdx !== -1 ? originalName.slice(extensionIdx) : '';

    const segments = destinationPath.split('/').filter(Boolean);
    const rawName = segments.pop() || originalName;
    const baseName = extension && rawName.endsWith(extension)
        ? rawName.slice(0, -extension.length)
        : rawName;

    const safeFolder = segments.map(part => part.replace(/[^a-zA-Z0-9-_]/g, '-')).join('/') || 'uploads';
    const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${safeFolder}/${safeName}-${timestamp}${extension}`;

    // Local disk backend. Deliberately placed AFTER assertAllowedFileType above
    // so a local upload is validated exactly as a remote one is — a permissive
    // local path would hide a validation bug rather than surface it. safeFolder
    // and safeName are stripped to [a-zA-Z0-9-_], so publicId cannot traverse
    // out of the uploads directory.
    if (useLocalDisk) {
        return writeToLocalDisk(publicId, buffer);
    }

    // Signed upload — parameters must be sorted alphabetically before hashing.
    // Past both guards above, Cloudinary IS configured: the first throws when a
    // credential is missing and local disk is not an option, and the second
    // returns when it is. The compiler cannot follow that two-step reasoning, so
    // state it rather than cast — without the narrowing, `undefined` would be
    // appended as the string "undefined" and Cloudinary would reject the upload
    // with an unhelpful message.
    if (!cloudName || !apiKey || !apiSecret) {
        logger.error('[storage-admin] Cloudinary credentials are not configured');
        throw new Error('Upload service is not configured. Please contact support.');
    }

    // Matches the scheme already used by /api/upload.
    const crypto = await import('crypto');
    const signature = crypto
        .createHash('sha256')
        .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
        .digest('hex');

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: file.type }), file.name);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('signature', signature);

    const resourceType = file.type === 'application/pdf'
        ? 'raw'
        : file.type.startsWith('video/')
            ? 'video'
            : 'image';

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
        { method: 'POST', body: form, cache: 'no-store' }
    );

    if (!response.ok) {
        const errBody = await response.text();
        logger.error(`[storage-admin] Cloudinary upload failed (HTTP ${response.status})`, {
            publicId,
            resourceType,
            fileType: file.type,
            fileSize: file.size,
            body: errBody,
        });

        let message = 'File upload failed';
        try {
            const parsed = JSON.parse(errBody);
            if (parsed?.error?.message) message = parsed.error.message;
        } catch {
            /* keep the generic message */
        }
        throw new Error(message);
    }

    const result = await response.json();
    if (!result?.secure_url) {
        throw new Error('Upload succeeded but no delivery URL was returned.');
    }

    logger.info(`[storage-admin] File uploaded to Cloudinary: ${result.secure_url}`);
    return result.secure_url;
}
