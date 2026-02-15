import { useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

interface UploadProgress {
    progress: number;
    downloadURL: string | null;
    error: string | null;
    isUploading: boolean;
}

export function useStorage() {
    const [uploadState, setUploadState] = useState<Record<string, UploadProgress>>({});

    const uploadFile = (file: File, path: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error("No file provided"));
                return;
            }

            const storageRef = ref(storage, path);
            const uploadTask = uploadBytesResumable(storageRef, file);

            // Track upload timeout
            const uploadTimeout = setTimeout(() => {
                if (uploadState[file.name]?.isUploading) {
                    console.error(`Upload timeout for ${file.name}`);
                    uploadTask.cancel();
                    setUploadState((prev) => ({
                        ...prev,
                        [file.name]: {
                            progress: 0,
                            downloadURL: null,
                            error: 'Upload timeout. Please try again.',
                            isUploading: false,
                        },
                    }));
                    reject(new Error('Upload timeout'));
                }
            }, 60000); // 60 second timeout

            // Initialize state for this file - use functional update to ensure React detects change
            setUploadState((prev) => ({
                ...prev,
                [file.name]: {
                    progress: 0,
                    downloadURL: null,
                    error: null,
                    isUploading: true,
                },
            }));

            uploadTask.on(
                "state_changed",
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

                    // Force state update with functional pattern to ensure re-render
                    setUploadState((prev) => {
                        const currentState = prev[file.name] || {};
                        // Only update if progress actually changed to avoid unnecessary re-renders
                        if (Math.abs(currentState.progress - progress) < 0.1 && currentState.isUploading) {
                            return prev;
                        }
                        return {
                            ...prev,
                            [file.name]: {
                                progress,
                                downloadURL: currentState.downloadURL,
                                error: null,
                                isUploading: true,
                            },
                        };
                    });
                },
                (error) => {
                    clearTimeout(uploadTimeout);
                    console.error(`Upload error for ${file.name}:`, error);

                    setUploadState((prev) => ({
                        ...prev,
                        [file.name]: {
                            progress: 0,
                            downloadURL: null,
                            error: error.message || 'Upload failed',
                            isUploading: false,
                        },
                    }));
                    reject(error);
                },
                async () => {
                    clearTimeout(uploadTimeout);
                    try {
                        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                        setUploadState((prev) => ({
                            ...prev,
                            [file.name]: {
                                progress: 100,
                                downloadURL,
                                error: null,
                                isUploading: false,
                            },
                        }));
                        resolve(downloadURL);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Failed to get download URL';
                        setUploadState((prev) => ({
                            ...prev,
                            [file.name]: {
                                progress: 0,
                                downloadURL: null,
                                error: errorMessage,
                                isUploading: false,
                            },
                        }));
                        reject(new Error(errorMessage));
                    }
                }
            );
        });
    };

    return { uploadFile, uploadState };
}
