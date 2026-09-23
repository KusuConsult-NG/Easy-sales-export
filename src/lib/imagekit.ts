import { logger } from "@/lib/logger";
import { measure } from "@/lib/round-trip-meter";

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
 * The ImageKit account this deployment is CONFIGURED for — or null when
 * nothing configures one.
 *
 *   NULL RATHER THAN A GUESS, AND THE GUESS WAS THE DEFECT.
 *
 *   This returned the literal "Easysales" when neither IMAGEKIT_ID nor an
 *   endpoint was set, and three security gates used it to decide whether an
 *   ImageKit URL belongs to this platform — proxy-image, certificates/upload
 *   and id-card/pdf. So an unconfigured deployment trusted URLs under
 *   ik.imagekit.io/Easysales on the strength of a string in this file.
 *
 *   The CLOUDINARY branch beside each of those three has always failed closed:
 *   "Fails closed rather than treating an unset variable as a match for
 *   whatever the first path segment happens to be." The two halves of one
 *   decision disagreed, and only the newer half guessed.
 *
 *   FAILING CLOSED COSTS NOTHING THAT WAS WORKING. If the account is not
 *   literally Easysales and nothing is configured, those gates ALREADY reject
 *   every real URL — the guess does not rescue that case, it just makes it
 *   silent. With the endpoint set, which the Dockerfile passes as a build arg,
 *   the answer is derived and nothing changes.
 *
 *   THE ENDPOINT IS READ FROM THE ENVIRONMENT HERE, not through
 *   `getImageKitEndpoint()`, because that helper defaults to an Easysales URL
 *   — deriving from it would reintroduce the same guess one step removed.
 */
export function getImageKitId(): string | null {
    const explicit = process.env.IMAGEKIT_ID?.trim();
    if (explicit) return explicit;

    const endpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
        || process.env.IMAGEKIT_URL_ENDPOINT;
    if (!endpoint) return null;

    try {
        const segment = new URL(endpoint).pathname.split("/").filter(Boolean)[0];
        return segment || null;
    } catch {
        return null;
    }
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

    //   MEASURED. `submitMultiStepWaveApplicationAction took 8145ms — 0
    //   reads` is the slowest line in the owner's log and none of it was the
    //   database. An upload is not a round trip in the sense a `.get()` is —
    //   it is bytes, and it scales with the file — so it is counted as http
    //   rather than folded in with the reads.
    const response = await measure("http", () => fetch("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST",
        headers: {
            Authorization: authHeader,
        },
        body: formData,
        cache: "no-store",
    }));

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

/*
 *   #675 THERE IS NO DELETE HERE, AND THAT IS THE POINT.
 *
 *   A `deleteFromImageKit(fileId)` stood here — a DELETE to
 *   api.imagekit.io/v1/files/<id> — added with the migration and called by
 *   nothing but its own test.
 *
 *   The owner's standing instruction for this codebase, verbatim:
 *
 *       "you can't delete or destroy anything on cloudinary or anything that
 *        was wrongly programmed rather fix the errors and ensure all data are
 *        safe."
 *
 *   #292 settled the same question again when erasure needed an answer:
 *   "nothing is to be deleted, on Cloudinary or anywhere else" — which is why
 *   lib/user-erasure copies the asset references into a retention record
 *   instead of purging the files, and why lib/module-application-erasure does
 *   the same for the module rows.
 *
 *   nothing-destroys-an-uploaded-asset.test.ts exists to keep that true, and
 *   it did not catch this one: every pattern in it named CLOUDINARY, so an
 *   ImageKit delete walked straight past a guard written for exactly this.
 *   Its own header warned about the shape — "the rule held because nobody had
 *   written such a call yet, which is a different thing from the rule being
 *   enforced". That sweep is vendor-agnostic now.
 *
 *   IT IS NOT A BAN ON THE FEATURE, and that test says how to lift it: the
 *   allowed call goes in its list with a reason, and the retention rule is
 *   extended to cover it. What is refused is the capability arriving without
 *   anybody deciding.
 */
