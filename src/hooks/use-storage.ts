import { useState } from "react";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
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
                reject("No file provided");
                return;
            }

            const storageRef = ref(storage, path);
            const uploadTask = uploadBytesResumable(storageRef, file);

            // Initialize state for this file
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
                    setUploadState((prev) => ({
                        ...prev,
                        [file.name]: {
                            ...prev[file.name],
                            progress,
                        },
                    }));
                },
                (error) => {
                    setUploadState((prev) => ({
                        ...prev,
                        [file.name]: {
                            ...prev[file.name],
                            error: error.message,
                            isUploading: false,
                        },
                    }));
                    reject(error);
                },
                async () => {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    setUploadState((prev) => ({
                        ...prev,
                        [file.name]: {
                            ...prev[file.name],
                            progress: 100,
                            downloadURL,
                            isUploading: false,
                        },
                    }));
                    resolve(downloadURL);
                }
            );
        });
    };

    return { uploadFile, uploadState };
}
