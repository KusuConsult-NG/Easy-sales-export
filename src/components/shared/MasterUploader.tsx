"use client";

import { useState, useRef } from "react";
import { storage, db } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { COLLECTIONS } from "@/lib/types/firestore";

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
 * Implements the "Metadata First" strategy and "Resumable Uploads".
 * 1. Creates a placeholder doc in Firestore (status: uploading).
 * 2. Uses uploadBytesResumable for connection resilience.
 * 3. Updates Firestore doc upon completion (status: ready).
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
    
    const uploadTaskRef = useRef<any>(null);

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

        // Start Upload Immediately
        startUpload(selectedFile);
    }

    async function startUpload(selectedFile: File) {
        setUploading(true);
        setProgress(0);

        try {
            // Stage 1: The Placeholder (Metadata First)
            const uploadId = crypto.randomUUID();
            const storagePath = `${folder}/${moduleId}/${uploadId}_${selectedFile.name.replace(/\s+/g, '_')}`;
            
            const uploadMetaRef = doc(db, "system_uploads", uploadId);
            await setDoc(uploadMetaRef, {
                id: uploadId,
                fileName: selectedFile.name,
                fileSize: selectedFile.size,
                contentType: selectedFile.type,
                moduleId: moduleId,
                storagePath: storagePath,
                status: "uploading",
                createdAt: serverTimestamp(),
            });

            // Stage 2: Resumable Upload
            const storageRef = ref(storage, storagePath);
            const uploadTask = uploadBytesResumable(storageRef, selectedFile);
            uploadTaskRef.current = uploadTask;

            uploadTask.on(
                "state_changed",
                (snapshot) => {
                    const p = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    setProgress(p);
                },
                (err) => {
                    console.error("Upload Error:", err);
                    setUploading(false);
                    setError(err.message);
                    showToast(err.message, "error");
                    onError?.(err.message);
                },
                async () => {
                    // Stage 3: The Handshake (Success)
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    
                    // Stage 4: Validation (Update Placeholder)
                    await setDoc(uploadMetaRef, {
                        status: "ready",
                        url: downloadURL,
                        completedAt: serverTimestamp(),
                    }, { merge: true });

                    setUploading(false);
                    setCompleted(true);
                    showToast("Upload completed successfully", "success");
                    onComplete({ url: downloadURL, path: storagePath, id: uploadId });
                }
            );
        } catch (err: any) {
            console.error("Initiation Error:", err);
            setUploading(false);
            setError(err.message);
            showToast(err.message, "error");
        }
    }

    function handleCancel() {
        if (uploadTaskRef.current) {
            uploadTaskRef.current.cancel();
        }
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
