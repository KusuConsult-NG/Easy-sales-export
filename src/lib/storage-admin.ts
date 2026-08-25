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
 * The extension a stored asset gets, chosen by its REAL type.
 *
 * Cloudinary serves a `raw` asset according to its extension, so this is what
 * decides the Content-Type a browser sees. Taking it from the uploaded filename
 * let the caller choose that — see #263 in uploadFileToStorage below.
 *
 * ONE TABLE. api/upload/route.ts had a second copy of this and imports this one
 * now. Two tables drift, and this audit has watched exactly that happen with
 * the loan multiplier, the WAVE commission rate and the module eligibility
 * rule. upload-stored-type-is-detected.test.ts fails if a copy reappears.
 *
 * Every entry of ALLOWED_MIMES is here. A type with no entry gets no extension
 * rather than a guessed one.
 */
const EXTENSION_FOR_TYPE: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export function extensionForType(detectedMime: string | undefined): string {
    return (detectedMime && EXTENSION_FOR_TYPE[detectedMime]) || '';
}

/**
 * Which Cloudinary endpoint stores this — and it must be asked about the
 * DETECTED type, never the declared one.
 *
 * `raw` is the branch that makes the extension decide the Content-Type, so
 * choosing it from the client's claim is what turns a filename into a
 * served-as-HTML asset.
 */
export function cloudinaryResourceType(detectedMime: string | undefined): 'raw' | 'video' | 'image' {
    if (detectedMime === 'application/pdf') return 'raw';
    if (detectedMime?.startsWith('video/')) return 'video';
    if (detectedMime?.startsWith('application/')) return 'raw';
    return 'image';
}

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

/**
 * Returns the DETECTED type rather than void.
 *
 * It always knew it; it just threw it away, and every caller then had to decide
 * the same question again from something less trustworthy. That is precisely
 * how #263 happened inside this very file.
 */
export async function assertAllowedFileType(buffer: Buffer, fileName: string): Promise<string> {
    const detectedMime = await detectFileType(buffer, fileName);

    if (!detectedMime || !ALLOWED_MIMES.includes(detectedMime)) {
        logger.warn(`[storage-admin] Blocked upload of type ${detectedMime || 'unknown'} for file ${fileName}`);
        throw new Error(`Security Error: File type ${detectedMime || 'unknown'} is not allowed.`);
    }

    return detectedMime;
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
    const detectedMime = await assertAllowedFileType(buffer, file.name);

    // THE EXTENSION COMES FROM THE BYTES, NOT FROM THE FILENAME.
    //
    //   #263 This was `originalName.slice(originalName.lastIndexOf('.'))` —
    //        every character after the last dot of the caller's filename,
    //        appended raw between two segments that ARE sanitised.
    //
    //        Cloudinary serves a `raw` asset according to its extension, so
    //        that handed the caller the Content-Type. api/upload/route.ts had
    //        already been fixed for exactly this and its comment spells out the
    //        consequence: a file whose content is a valid PDF but whose name
    //        ends .html was stored with that extension, and the business's own
    //        Cloudinary account then served attacker-supplied HTML from a
    //        trusted-looking URL. "%PDF-" near the start is all the magic-byte
    //        check requires, so one file satisfies both.
    //
    //        actions/upload.ts was fixed for it too (#244). This was the third
    //        copy — and the busiest one: marketplace product images and videos,
    //        certificates, export onboarding documents, the WAVE resource
    //        library.
    //
    //        The file's own comment below used to claim publicId "cannot
    //        traverse out of the uploads directory" because safeFolder and
    //        safeName are stripped. True of both of those; the extension
    //        between them was the one piece the caller controlled.
    const extension = extensionForType(detectedMime);

    const segments = destinationPath.split('/').filter(Boolean);
    const rawName = segments.pop() || file.name || 'document';
    // Drop whatever suffix the destination carried; the real one is appended
    // below. Matching on the OLD extension left "photo.jpg" intact whenever the
    // detected type disagreed with the name.
    const baseName = rawName.replace(/\.[^./]*$/, '') || rawName;

    const safeFolder = segments.map(part => part.replace(/[^a-zA-Z0-9-_]/g, '-')).join('/') || 'uploads';
    const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${safeFolder}/${safeName}-${timestamp}${extension}`;

    // Local disk backend. Deliberately placed AFTER assertAllowedFileType above
    // so a local upload is validated exactly as a remote one is — a permissive
    // local path would hide a validation bug rather than surface it. All three
    // parts of publicId are now constrained: safeFolder and safeName are
    // stripped to [a-zA-Z0-9-_], and the extension comes from a fixed table
    // rather than from the caller.
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
    // Labelled with the detected type as well. Sending the caller's label
    // alongside a corrected resource_type would only move the disagreement.
    form.append('file', new Blob([buffer], { type: detectedMime }), file.name);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('signature', signature);

    // Also from the detected type — the other half of #263. `raw` is the branch
    // that lets the extension decide the Content-Type, so choosing it from
    // `file.type` was what made the filename attack reachable.
    //
    // And the quieter half: `file.type` is empty for a File picked by several
    // clients, and for one reconstructed server-side. That fell to the `else`,
    // so a PDF was posted to Cloudinary's IMAGE endpoint, which refuses it —
    // "File upload failed" on a perfectly valid document.
    const resourceType = cloudinaryResourceType(detectedMime);

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
