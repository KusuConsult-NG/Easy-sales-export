/**
 * Posting a file to /api/upload, once, with retries only for what a retry can
 * fix.
 *
 *   #297 THE #291 FIX LANDED ON ONE OF THREE COPIES.
 *
 *        #291 found that MasterUploader retried every failure three times —
 *        including a 400 for a disallowed type, a 400 for a file over 50MB, a
 *        401, and withRateLimit's 429 — and fixed it there.
 *
 *        There are THREE copies of that loop, all named uploadWithRetry, all
 *        byte-for-byte the same shape:
 *
 *            components/shared/MasterUploader.tsx   fixed by #291
 *            hooks/use-storage.ts                   NOT fixed
 *            lib/storage-upload.ts                  NOT fixed
 *
 *        So after #291, a 50MB video rejected for its type was still uploaded
 *        three times through the land-listing form and through every caller of
 *        the useStorage hook, and a 429 was still answered by hitting the
 *        limiter twice more.
 *
 *        This is #83's shape ("the #36 email-claim fix landed on WAVE only")
 *        committed by me, and the SECOND time in this audit — #293 was the
 *        same mistake on the cooperative payment page. Patching the two
 *        stragglers would leave the class alive; there would be three copies
 *        again the next time somebody needs an uploader.
 *
 * WHAT IS RETRYABLE
 * -----------------
 * A network fault, a body that is not JSON, and a 5xx. Nothing else. The route
 * answers a bad type, an oversized file, a missing session and a rate limit
 * with a 4xx, and none of those change on a second ask — for the 429 it is
 * actively harmful, because Retry-After is 60 seconds and the loop came back
 * within three.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not report progress, because the three callers report it three
 * different ways — a percentage, a per-file map, and an onProgress callback.
 * `onRetry` is the hook they share: it fires with the attempt number just
 * before each retry sleeps.
 */

/** What /api/upload returns on success. `path` is the Cloudinary public_id. */
export interface UploadResponse {
    url: string;
    path?: string;
    filename?: string;
    [key: string]: unknown;
}

export interface UploadRequestOptions {
    /** Cancels the in-flight request; an abort is never retried. */
    signal?: AbortSignal;
    /** Called with the attempt just completed, before the backoff sleep. */
    onRetry?: (attempt: number) => void;
    /** Total attempts including the first. Default 3. */
    attempts?: number;
}

/** An error the server ANSWERED with. Asking again cannot change it. */
export class UploadRefused extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "UploadRefused";
        this.status = status;
    }
}

/**
 * POST a prepared FormData to /api/upload.
 *
 * Resolves with the parsed body on success. Throws UploadRefused for a 4xx
 * (immediately, no retry), the original AbortError if cancelled, and the last
 * error after the retries are spent for anything else.
 */
export async function postUploadWithRetry(
    formData: FormData,
    options: UploadRequestOptions = {},
): Promise<UploadResponse> {
    const attempts = options.attempts ?? 3;

    const run = async (attempt: number): Promise<UploadResponse> => {
        try {
            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
                signal: options.signal,
            });

            // A body that is not JSON is a fault, not a refusal — it goes down
            // the retryable path with the network errors.
            const data = await res.json().catch(() => ({} as any));

            if (!res.ok || !data?.success || !data?.url) {
                const message = String(data?.error || "Upload failed");
                if (res.status >= 400 && res.status < 500) {
                    throw new UploadRefused(message, res.status);
                }
                throw new Error(message);
            }

            return data as UploadResponse;
        } catch (err: any) {
            if (err?.name === "AbortError") throw err;   // cancel is not a fault
            if (err instanceof UploadRefused) throw err;  // the answer will not change

            if (attempt < attempts) {
                options.onRetry?.(attempt);
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
                return run(attempt + 1);
            }
            throw err;
        }
    };

    return run(1);
}
