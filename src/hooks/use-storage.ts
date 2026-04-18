"use client";

import { useState } from "react";

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

            // Step 2: Upload via API route (Cloudinary, authenticated, streaming)
            // Retry wrapper for robust uploads
            const uploadWithRetry = async (attempt = 1): Promise<any> => {
                try {
                    const res = await fetch("/api/upload", { method: "POST", body: formData });
                    const resData = await res.json();
                    if (!res.ok || !resData.success || !resData.url) throw new Error(resData.error || "Upload failed");
                    return resData;
                } catch (err) {
                    if (attempt < 3) {
                        // Exponential backoff: 1s, 2s, 4s...
                        await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
                        // Update progress to indicate retry
                        setUploadState(prev => ({
                            ...prev,
                            [file.name]: { ...prev[file.name], progress: 50 + (attempt * 10) }, // Slight visual bump per retry
                        }));
                        return uploadWithRetry(attempt + 1);
                    }
                    throw err;
                }
            };

            const result = await uploadWithRetry();

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
