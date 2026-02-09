"use client";

import { useState } from "react";
import { Upload, X, FileText } from "lucide-react";

interface DocumentUploadProps {
    label: string;
    accept?: string;
    maxSize?: number; // in MB
    onUpload: (file: File) => void;
    required?: boolean;
    error?: string;
}

export default function DocumentUpload({
    label,
    accept = "image/*,application/pdf",
    maxSize = 5,
    onUpload,
    required = false,
    error
}: DocumentUploadProps) {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        // Check file size
        if (selectedFile.size > maxSize * 1024 * 1024) {
            alert(`File size must be less than ${maxSize}MB`);
            return;
        }

        setFile(selectedFile);
        onUpload(selectedFile);

        // Create preview for images
        if (selectedFile.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result as string);
            };
            reader.readAsDataURL(selectedFile);
        } else {
            setPreview(null);
        }
    };

    const handleRemove = () => {
        setFile(null);
        setPreview(null);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                {label} {required && <span className="text-red-500">*</span>}
            </label>

            {!file ? (
                <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${error
                        ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                        : "border-slate-300 dark:border-slate-600 hover:border-green-500 dark:hover:border-green-500"
                    }`}>
                    <input
                        type="file"
                        accept={accept}
                        onChange={handleFileChange}
                        className="hidden"
                    />
                    <Upload className="w-12 h-12 mx-auto mb-2 text-slate-400" />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                        Max file size: {maxSize}MB
                    </p>
                </label>
            ) : (
                <div className="border-2 border-slate-300 dark:border-slate-600 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {preview ? (
                                <img src={preview} alt="Preview" className="w-16 h-16 object-cover rounded" />
                            ) : (
                                <FileText className="w-12 h-12 text-slate-400" />
                            )}
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">{file.name}</p>
                                <p className="text-sm text-slate-500">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleRemove}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
        </div>
    );
}
