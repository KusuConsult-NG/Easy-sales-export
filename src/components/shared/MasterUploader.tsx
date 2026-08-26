"use client";

import { useState, useRef } from "react";
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

interface MasterUploaderProps {
    label: string;
    folder: string;
    moduleId: string;
    accept?: string;
    maxSize?: number; // in MB
    onComplete: (data: { url: string; path: string; id: string }) => void;
    onError?: (error: string) => void;
    required?: boolean;
    description?: string;
}

/**
 * MasterUploader Component
 *
 * Uploads files to Cloudinary via the authenticated /api/upload API route.
 *
 * NOTE: Firebase Storage bucket is NOT provisioned on this project.
 * All uploads are routed through Cloudinary (same pattern as useStorage hook).
 *
 *   #291 IT RETRIED REFUSALS, INCLUDING THE RATE LIMITER'S.
 *
 *        The retry wrapper caught EVERY failure and tried twice more:
 *
 *            if (!res.ok || !resData.success || !resData.url) throw ...
 *            catch { if (attempt < 3) { backoff; retry } }
 *
 *        /api/upload refuses with a 400 for a disallowed type and for a file
 *        over 50MB, a 401 when the session is gone, and — through
 *        withRateLimit — a 429. None of those change if you ask again. So a
 *        rejected 50MB video was uploaded three times, 150MB, before the person
 *        was told the type was wrong; and a 429 was answered by hitting the
 *        limiter twice more, which is the one response guaranteed to keep them
 *        limited. #76 is about a shared rate-limit namespace; this is the
 *        client spending that budget on answers it already had.
 *
 *        Retries now cover what a retry can fix: a network fault, and a 5xx.
 *
 *   #292 IT MANUFACTURED THE STORAGE PATH AND THREW AWAY THE REAL ONE.
 *
 *        /api/upload returns `path: publicId` — the Cloudinary public_id, the
 *        handle needed to transform, restrict or DELETE the asset. This
 *        component ignored it and built its own:
 *
 *            const uploadId = crypto.randomUUID();
 *            const storagePath = `${uploadFolder}/${uploadId}_${file.name}`;
 *            onComplete({ url: result.url, path: storagePath, id: uploadId });
 *
 *        That string names nothing. It is a random UUID and the name of a file
 *        on the uploader's own machine, and it was handed to every caller
 *        labelled `path` — #284's shape, a manufactured value in the position
 *        of a real one.
 *
 *        No caller stores it today (all five read `url` only), so nothing in
 *        the database is wrong. What it cost is the ability to add one: see the
 *        note on erasure in upload-identifiers.test.ts.
 */
export default function MasterUploader({
    label,
    folder,
    moduleId,
    accept = "image/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxSize = 50, // Default 50MB for Academy content
    onComplete,
    onError,
    required = false,
    description
}: MasterUploaderProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [completed, setCompleted] = useState(false);
    const { showToast } = useToast();

    // AbortController for cancelling in-flight fetch
    const abortRef = useRef<AbortController | null>(null);

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        // Validation
        if (selectedFile.size > maxSize * 1024 * 1024) {
            const err = `File size must be less than ${maxSize}MB`;
            showToast(err, "error");
            setError(err);
            return;
        }

        setFile(selectedFile);
        setError(null);
        setCompleted(false);
        setProgress(0);

        startUpload(selectedFile);
    }

    async function startUpload(selectedFile: File) {
        setUploading(true);
        setProgress(10);

        // Build the upload path: folder + moduleId context
        const documentType = `${moduleId}_document`;
        const uploadFolder = folder || `uploads/${moduleId}`;

        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("folder", uploadFolder);
        formData.append("documentType", documentType);

        abortRef.current = new AbortController();

        try {
            setProgress(30);

            const uploadWithRetry = async (attempt = 1): Promise<any> => {
                try {
                    const res = await fetch("/api/upload", {
                        method: "POST",
                        body: formData,
                        signal: abortRef.current?.signal,
                    });

                    // #291. A body that is not JSON is a fault, not a refusal —
                    // it goes down the retryable path with the network errors.
                    const resData = await res.json().catch(() => ({}));

                    if (!res.ok || !resData.success || !resData.url) {
                        const failure: any = new Error(resData.error || "Upload failed");
                        // The server ANSWERED. 400 wrong type, 400 too large,
                        // 401 signed out, 429 rate limited — asking again
                        // cannot change any of them, and for the 429 it is
                        // actively harmful.
                        failure.finalRefusal = res.status >= 400 && res.status < 500;
                        throw failure;
                    }
                    return resData;
                } catch (err: any) {
                    // The trailing comment on the next line deliberately
                    // contains no apostrophe. With one, a double quote earlier
                    // in the line and the apostrophe later bracket the comment
                    // marker, which is the pattern the naive comment stripper
                    // in several suites mistakes for a block comment — see
                    // strip-comments.test.ts. The line had that shape already;
                    // adding the header above pushed the damage past the 10%
                    // threshold and put this APPLICATION file onto a list meant
                    // to hold two. Writing the explanation with the pattern in
                    // it put it straight back, which is how this note ended up
                    // phrased around the thing instead of quoting it.
                    if (err.name === "AbortError") throw err; // cancel is not a fault
                    if (err?.finalRefusal) throw err;         // #291: the answer will not change
                    if (attempt < 3) {
                        setProgress(30 + attempt * 10);
                        await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
                        return uploadWithRetry(attempt + 1);
                    }
                    throw err;
                }
            };

            setProgress(50);
            const result = await uploadWithRetry();
            setProgress(100);

            /**
             * #292. The route's own answer, not a reconstruction of it.
             *
             * `path` is the Cloudinary public_id the asset was actually stored
             * under, and `id` is the same handle — there is one identifier
             * here, and inventing a second one that looked like a path is what
             * made a fabricated string indistinguishable from a real one at
             * every call site.
             *
             * Falls back to the URL rather than to a random UUID: an identifier
             * that at least locates the asset beats one that locates nothing.
             */
            const storagePath: string = typeof result.path === "string" && result.path
                ? result.path
                : result.url;

            setUploading(false);
            setCompleted(true);
            showToast("Upload completed successfully", "success");
            onComplete({ url: result.url, path: storagePath, id: storagePath });
        } catch (err: any) {
            if (err.name === "AbortError") {
                // User cancelled — reset silently
                setFile(null);
                setUploading(false);
                setProgress(0);
                setError(null);
                return;
            }
            const message = err instanceof Error ? err.message : "Upload failed";
            console.error("[MasterUploader] Upload error:", message);
            setUploading(false);
            setError(message);
            showToast(message, "error");
            onError?.(message);
        }
    }

    function handleCancel() {
        abortRef.current?.abort();
        setFile(null);
        setUploading(false);
        setProgress(0);
        setError(null);
    }

    return (
        <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-900">
                {label} {required && <span className="text-rose-500">*</span>}
            </label>
            {description && <p className="text-xs text-slate-500 mb-2">{description}</p>}

            {!file && !completed && (
                <label className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/30"
                }`}>
                    <input type="file" accept={accept} onChange={handleFileChange} className="hidden" />
                    <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center mx-auto mb-3 border border-slate-100">
                        <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-400 mt-1">Up to {maxSize}MB supported</p>
                </label>
            )}

            {(file || completed) && (
                <div className={`border rounded-2xl p-4 bg-white shadow-sm transition-all ${
                    completed ? "border-emerald-200 bg-emerald-50/10" : "border-slate-200"
                }`}>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                            completed ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
                        }`}>
                            {completed ? <CheckCircle className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{file?.name || "File Uploaded"}</p>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                                {uploading ? `Uploading... ${Math.round(progress)}%` : completed ? "Upload Ready" : "Waiting"}
                            </p>
                            
                            {uploading && (
                                <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div 
                                        className="bg-emerald-500 h-full transition-all duration-300 ease-out"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            )}
                        </div>

                        {!completed && !uploading && (
                            <button onClick={() => { setFile(null); setError(null); }} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                                <X className="w-5 h-5" />
                            </button>
                        )}
                        
                        {uploading && (
                            <button onClick={handleCancel} className="text-xs font-bold text-rose-600 hover:text-rose-700 px-3 py-1 bg-rose-50 rounded-lg">
                                Cancel
                            </button>
                        )}
                        
                        {completed && (
                            <button onClick={() => { setFile(null); setCompleted(false); }} className="text-xs font-bold text-slate-500 hover:text-slate-900 px-3 py-1 bg-slate-50 rounded-lg">
                                Change
                            </button>
                        )}
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-rose-600 text-xs font-semibold bg-rose-50 p-2 rounded-lg border border-rose-100">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}
        </div>
    );
}
