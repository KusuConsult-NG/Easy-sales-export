import { useState } from 'react';

interface UploadState {
    progress: number;
    isUploading: boolean;
    error: string | null;
}

export function useStorage() {
    const [uploadState, setUploadState] = useState<Record<string, UploadState>>({});

    const uploadFile = async (file: File, path: string): Promise<string> => {
        // Initialize state for this file
        setUploadState(prev => ({
            ...prev,
            [file.name]: { progress: 0, isUploading: true, error: null }
        }));

        try {
            // Mock upload - simulate progress
            const interval = setInterval(() => {
                setUploadState(prev => ({
                    ...prev,
                    [file.name]: {
                        ...prev[file.name],
                        progress: Math.min((prev[file.name]?.progress || 0) + 10, 90)
                    }
                }));
            }, 100);

            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            clearInterval(interval);

            // Mark complete
            setUploadState(prev => ({
                ...prev,
                [file.name]: { progress: 100, isUploading: false, error: null }
            }));

            return `https://firebasestorage.googleapis.com/v0/b/mock-bucket/o/${encodeURIComponent(path)}?alt=media`;
        } catch (error: any) {
            setUploadState(prev => ({
                ...prev,
                [file.name]: { progress: 0, isUploading: false, error: error.message }
            }));
            throw error;
        }
    };

    return {
        uploadFile,
        uploadState
    };
}
