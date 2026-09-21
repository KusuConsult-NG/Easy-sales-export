"use client";

import { useState, useRef } from "react";
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { postUploadWithRetry } from "@/lib/upload-request";
import { DEFAULT_MAX_UPLOAD_MB, DEFAULT_MAX_VIDEO_UPLOAD_MB, defaultLimitMbFor } from "@/lib/upload-limits";

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
    /**
     *   #784 A DOCUMENT THAT IS ALREADY ATTACHED.
     *
     *   This component had no way to be told about one, so a member reopening a
     *   saved or rejected application saw every document box EMPTY while the
     *   record held her files. She could not see what she had sent, could not
     *   check it was the right one, and the only way forward was to upload
     *   again — #775's "opens blank" defect, in the document dimension.
     */
    existing?: { name?: string; url: string } | null;
    /**
     *   Detach the attached document from the record.
     *
     *   DETACH, NOT DELETE. The owner's standing instruction is that nothing on
     *   Cloudinary is destroyed; the asset stays exactly where it is and the
     *   record stops pointing at it. That also means a mistaken removal is
     *   recoverable from the audit trail rather than gone.
     *
     *   Omit it and no Remove control is offered — a screen that cannot handle
     *   a removal should not appear to.
     */
    onRemove?: () => void;
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
    maxSize, // Omitted: 50MB, or 200MB for video — see the note in handleFileChange
    onComplete,
    onError,
    required = false,
    description,
    existing = null,
    onRemove
}: MasterUploaderProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [completed, setCompleted] = useState(false);
    const { showToast } = useToast();

    // AbortController for cancelling in-flight fetch
    const abortRef = useRef<AbortController | null>(null);

    /**
     *   What this box will accept, said before a file is chosen.
     *
     *   It used to read `Up to {maxSize}MB supported` against a prop that
     *   always had a value. Now that the ceiling depends on the FILE, there are
     *   two numbers and no file yet — so where video is on offer, both are
     *   named. Saying only the smaller one is how a person with a 120MB lesson
     *   recording decides not to try.
     */
    const offersVideo = accept.includes("video/") || accept.includes("*/*");
    const limitLabel = maxSize !== undefined
        ? `Up to ${maxSize}MB supported`
        : offersVideo
            ? `Up to ${DEFAULT_MAX_UPLOAD_MB}MB, or ${DEFAULT_MAX_VIDEO_UPLOAD_MB}MB for video`
            : `Up to ${DEFAULT_MAX_UPLOAD_MB}MB supported`;

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        /**
         *   THE CEILING DEPENDS ON WHAT WAS CHOSEN, NOT ON THIS COMPONENT.
         *
         *   `maxSize` defaulted to 50 here, and Academy lesson videos are the
         *   thing this uploader is most used for — so a course recording over
         *   50MB was refused IN THE BROWSER, before a request was made, with
         *   "File size must be less than 50MB". The server had meanwhile been
         *   taught that video gets 200MB, which the person never got to find
         *   out.
         *
         *   A caller that passes maxSize still wins: several pass 5, and a
         *   screen that knows its own rule keeps it. Omitted, the limit is the
         *   platform's, and the platform's depends on the file.
         *
         *   Advisory only. lib/upload-limits says why: the env overrides are
         *   server-side, so this can be wrong in a deployment that lowers them,
         *   and the server refusing is the control.
         */
        const limitMb = maxSize ?? defaultLimitMbFor(selectedFile.type);
        if (selectedFile.size > limitMb * 1024 * 1024) {
            const err = `File size must be less than ${limitMb}MB`;
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

            // #297. One implementation, three callers — this loop existed
            // three times and #291 fixed only this copy. See
            // lib/upload-request.ts.
            const result = await postUploadWithRetry(formData, {
                signal: abortRef.current?.signal,
                onRetry: (attempt) => setProgress(30 + attempt * 10),
            });

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

            {/*
              *   #784 WHAT IS ALREADY ATTACHED, and the two things a member can
              *   do about it. Shown only while nothing new is in flight, so a
              *   replacement in progress does not sit under the old file.
              */}
            {existing?.url && !file && !completed && (
                <div className="border border-emerald-200 rounded-2xl p-4 bg-emerald-50/20">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                            <CheckCircle className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                                {existing.name || "Document on file"}
                            </p>
                            <a
                                href={existing.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline"
                            >
                                View the document you sent
                            </a>
                        </div>
                        <label className="text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
                            <input type="file" accept={accept} onChange={handleFileChange} className="hidden" />
                            Replace
                        </label>
                        {/*
                          *   #784 REMOVE IS OFFERED ONLY FOR AN OPTIONAL
                          *   DOCUMENT, and that is not a nicety.
                          *
                          *   A REQUIRED document cannot be absent — the step
                          *   refuses to advance without it — so a Remove button
                          *   beside one would promise something the form will
                          *   not accept. And on the server side the resubmit
                          *   path writes a document field only when a new URL
                          *   arrives (`|| existingMemberData?.documents…`), so a
                          *   removal would not propagate anyway: the stored file
                          *   survives, deliberately, because nothing here is
                          *   destroyed.
                          *
                          *   REPLACE is the control that does the job a member
                          *   actually has — "I sent the wrong photograph" — and
                          *   it is offered on both.
                          */}
                        {onRemove && !required && (
                            <button
                                type="button"
                                onClick={onRemove}
                                className="text-xs font-bold text-rose-600 hover:text-rose-700 px-3 py-1.5 bg-rose-50 rounded-lg"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>
            )}

            {!existing?.url && !file && !completed && (
                <label className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    error ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/30"
                }`}>
                    <input type="file" accept={accept} onChange={handleFileChange} className="hidden" />
                    <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center mx-auto mb-3 border border-slate-100">
                        <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-400 mt-1">{limitLabel}</p>
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
