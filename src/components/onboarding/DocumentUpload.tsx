/**
 * Document Upload Component
 * 
 * Reusable component for uploading documents (ID, photos, etc.)
 */

"use client";

import { useState, useRef, ChangeEvent } from "react";
import { Upload, File, X, CheckCircle, AlertCircle } from "lucide-react";
import Image from "next/image";

interface DocumentUploadProps {
    label: string;
    description?: string;
    accept?: string;
    maxSize?: number; // in MB
    required?: boolean;
    value?: string;
    onChange: (file: File | null, url?: string) => void;
    preview?: boolean; // Show image preview
}

export function DocumentUpload({
    label,
    description,
    accept = "image/*,.pdf",
    maxSize = 5,
    required = false,
    value,
    onChange,
    preview = true,
}: DocumentUploadProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(value || null);
    const [error, setError] = useState<string>("");
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isImage = (fileName: string) => {
        return /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
    };

    const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        // Validate file size
        const fileSizeMB = selectedFile.size / (1024 * 1024);
        if (fileSizeMB > maxSize) {
            setError(`File size must be less than ${maxSize}MB`);
            return;
        }

        setError("");
        setFile(selectedFile);

        // Create preview URL for images
        if (isImage(selectedFile.name) && preview) {
            const url = URL.createObjectURL(selectedFile);
            setPreviewUrl(url);
        }

        // Call onChange with the file
        onChange(selectedFile);
    };

    const handleRemove = () => {
        setFile(null);
        setPreviewUrl(null);
        setError("");
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        onChange(null);
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="w-full">
            {/* Label */}
            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {/* Description */}
            {description && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                    {description}
                </p>
            )}

            {/* Upload Area */}
            {!file && !previewUrl ? (
                <div
                    onClick={handleClick}
                    className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/10 transition-colors"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={accept}
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                    <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                        Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">
                        {accept.includes("image") ? "Images" : "Documents"} up to {maxSize}MB
                    </p>
                </div>
            ) : (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                    {/* Preview or File Info */}
                    {previewUrl && isImage(file?.name || value || "") ? (
                        <div className="relative w-full h-48 mb-3 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                            <Image
                                src={previewUrl}
                                alt="Preview"
                                fill
                                className="object-contain"
                            />
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 mb-3">
                            <File className="w-10 h-10 text-orange-500" />
                            <div className="flex-1">
                                <p className="text-sm font-medium text-slate-900 dark:text-white">
                                    {file?.name || "Uploaded file"}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {file ? `${(file.size / 1024).toFixed(1)} KB` : ""}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-sm font-medium">Uploaded</span>
                        </div>
                        <button
                            onClick={handleRemove}
                            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                        >
                            <X className="w-4 h-4" />
                            Remove
                        </button>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mt-2 flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{error}</span>
                </div>
            )}
        </div>
    );
}
