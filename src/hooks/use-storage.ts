"use client";

import { useState } from "react";
import { uploadDocumentAction } from "@/app/actions/upload";

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
            // Step 1: Read file as base64 data URL (required by uploadDocumentAction)
            setUploadState(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress: 20 },
            }));

            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error("Failed to read file"));
                reader.readAsDataURL(file);
            });

            setUploadState(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress: 50 },
            }));

            // Step 2: Upload via server action (Cloudinary, authenticated)
            // Derive documentType from the path segment after the last slash grouping
            const documentType = path.split("/").pop()?.replace(/^\d+_/, "") || file.name;

            const result = await uploadDocumentAction(base64, file.name, file.type, documentType);

            if (!result.success || !result.url) {
                throw new Error(result.error || "Upload failed");
            }

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
