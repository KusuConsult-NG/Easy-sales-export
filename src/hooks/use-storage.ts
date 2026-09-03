"use client";

import { useState } from "react";
import { postUploadWithRetry } from "@/lib/upload-request";

interface UploadState {
    progress: number;
    isUploading: boolean;
    error: string | null;
}

/**
 * useStorage
 *
 * Client-side hook for uploading files to Cloudinary via the
 * `uploadDocumentAction` server action (which handles auth + signing).
 *
 * NOTE: Firebase Storage bucket is not provisioned on this project.
 * All document uploads go through Cloudinary.
 */
export function useStorage() {
    const [uploadState, setUploadState] = useState<Record<string, UploadState>>({});

    const uploadFile = async (file: File, path: string): Promise<string> => {
        // Track per-file state keyed by file name
        setUploadState(prev => ({
            ...prev,
            [file.name]: { progress: 0, isUploading: true, error: null },
        }));

        try {
            // Step 1: Create FormData (Zero-Memory Payload Pipeline)
            setUploadState(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress: 20 },
            }));

            const documentType = path.split("/").pop()?.replace(/^\d+_/, "") || file.name;
            const folder = path.split("/").slice(0, -1).join("/") || "uploads";

            const formData = new FormData();
            formData.append("file", file);
            formData.append("folder", folder);
            formData.append("documentType", documentType);

            setUploadState(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress: 50 },
            }));

            // Step 2: Upload via API route (Cloudinary, authenticated)
            //
            // #297. This copy of the retry loop was NOT fixed by #291, which
            // corrected only MasterUploader's. It retried a 400 for a bad type,
            // a 400 for an oversized file, a 401 and a 429 — three uploads of a
            // file the route had already refused. One implementation now, in
            // lib/upload-request.ts.
            const result = await postUploadWithRetry(formData, {
                onRetry: (attempt) => setUploadState(prev => ({
                    ...prev,
                    [file.name]: { ...prev[file.name], progress: 50 + attempt * 10 },
                })),
            });

            setUploadState(prev => ({
                ...prev,
                [file.name]: { progress: 100, isUploading: false, error: null },
            }));

            return result.url;
        } catch (error: any) {
            const message = error instanceof Error ? error.message : "Upload failed";
            setUploadState(prev => ({
                ...prev,
                [file.name]: { progress: 0, isUploading: false, error: message },
            }));
            throw error;
        }
    };

    return {
        uploadFile,
        uploadState,
    };
}
