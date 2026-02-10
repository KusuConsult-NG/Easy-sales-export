/**
 * Firebase Storage Upload Utilities
 * 
 * Handles file uploads to Firebase Storage for cooperative documents
 */

import { storage } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL, UploadTask } from "firebase/storage";

export interface UploadProgress {
    progress: number; // 0-100
    status: 'uploading' | 'completed' | 'error';
    url?: string;
    error?: string;
}

/**
 * Upload a file to Firebase Storage
 * @param file - File to upload
 * @param path - Storage path (e.g., 'cooperative/documents/user123/valid-id.jpg')
 * @param onProgress - Callback for upload progress updates
 * @returns Promise with download URL
 */
export async function uploadFile(
    file: File,
    path: string,
    onProgress?: (progress: UploadProgress) => void
): Promise<string> {
    return new Promise((resolve, reject) => {
        // Create storage reference
        const storageRef = ref(storage, path);

        // Create upload task
        const uploadTask: UploadTask = uploadBytesResumable(storageRef, file);

        // Monitor upload progress
        uploadTask.on(
            'state_changed',
            (snapshot) => {
                // Calculate progress percentage
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

                onProgress?.({
                    progress,
                    status: 'uploading'
                });
            },
            (error) => {
                // Handle upload error
                const errorMessage = error.message || 'Upload failed';
                onProgress?.({
                    progress: 0,
                    status: 'error',
                    error: errorMessage
                });
                reject(new Error(errorMessage));
            },
            async () => {
                // Upload completed successfully, get download URL
                try {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    onProgress?.({
                        progress: 100,
                        status: 'completed',
                        url: downloadURL
                    });
                    resolve(downloadURL);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Failed to get download URL';
                    onProgress?.({
                        progress: 100,
                        status: 'error',
                        error: errorMessage
                    });
                    reject(new Error(errorMessage));
                }
            }
        );
    });
}

/**
 * Validate file before upload
 * @param file - File to validate
 * @param maxSizeMB - Maximum file size in MB (default: 5MB)
 * @param allowedTypes - Allowed MIME types
 * @returns Validation result
 */
export function validateFile(
    file: File,
    maxSizeMB: number = 5,
    allowedTypes: string[] = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
): { valid: boolean; error?: string } {
    // Check file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        return {
            valid: false,
            error: `File size must be less than ${maxSizeMB}MB`
        };
    }

    // Check file type
    if (!allowedTypes.includes(file.type)) {
        return {
            valid: false,
            error: `File type must be one of: ${allowedTypes.map(t => t.split('/')[1]).join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * Generate a unique file path for cooperative documents
 * @param userId - User ID
 * @param documentType - Type of document (e.g., 'valid-id', 'passport-photo')
 * @param fileName - Original file name
 * @returns Storage path
 */
export function generateDocumentPath(
    userId: string,
    documentType: string,
    fileName: string
): string {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `cooperative/documents/${userId}/${documentType}-${timestamp}-${sanitizedFileName}`;
}
