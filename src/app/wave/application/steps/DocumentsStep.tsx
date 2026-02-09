/**
 * Step 4: Document Upload
 * Required and optional document uploads
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Upload, X, FileText, AlertCircle, CheckCircle } from "lucide-react";
import type { WaveApplicationData } from "../page";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
    onBack: () => void;
}

type DocumentType = keyof WaveApplicationData["documents"];

const REQUIRED_DOCUMENTS: { key: DocumentType; label: string }[] = [
    { key: "governmentId", label: "Government ID (NIN/Voter's Card/License)" },
    { key: "passportPhoto", label: "Passport Photograph" },
    { key: "businessEvidence", label: "Farm/Business Evidence (Photos/Certificate)" },
];

const OPTIONAL_DOCUMENTS: { key: DocumentType; label: string }[] = [
    { key: "bankStatement", label: "Bank Statement (Last 3 months)" },
    { key: "businessRegistration", label: "Business Registration (if registered)" },
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export default function DocumentsStep({ data, updateData, onNext, onBack }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [uploading, setUploading] = useState(false);

    const validateFile = (file: File): string | null => {
        if (file.size > MAX_FILE_SIZE) {
            return "File size must not exceed 5MB";
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
            return "Only JPG, PNG, and PDF files are allowed";
        }
        return null;
    };

    const handleFileChange = (documentType: DocumentType, file: File | null) => {
        if (!file) {
            updateData({
                documents: {
                    ...data.documents,
                    [documentType]: null,
                },
            });
            return;
        }

        const error = validateFile(file);
        if (error) {
            setErrors({ ...errors, [documentType]: error });
            return;
        }

        // Clear error for this document
        const newErrors = { ...errors };
        delete newErrors[documentType];
        setErrors(newErrors);

        // Update data
        updateData({
            documents: {
                ...data.documents,
                [documentType]: file,
            },
        });
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        // Check required documents
        REQUIRED_DOCUMENTS.forEach(({ key, label }) => {
            if (!data.documents[key]) {
                newErrors[key] = `${label} is required`;
            }
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        }
    };

    const renderDocumentUpload = (
        documentType: DocumentType,
        label: string,
        required: boolean
    ) => {
        const file = data.documents[documentType];
        const error = errors[documentType];

        return (
            <div key={documentType} className="border border-slate-300 dark:border-slate-600 rounded-xl p-6">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <h4 className="font-semibold text-slate-900 dark:text-white mb-1">
                            {label}
                            {required && <span className="text-rose-600 ml-1">*</span>}
                        </h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Max 5MB • JPG, PNG, or PDF
                        </p>
                    </div>
                    {file && (
                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    )}
                </div>

                {!file ? (
                    <label className="block cursor-pointer">
                        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all">
                            <div className="flex flex-col items-center text-center">
                                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Click to upload or drag and drop
                                </p>
                                <p className="text-xs text-slate-500">
                                    JPG, PNG or PDF (max. 5MB)
                                </p>
                            </div>
                        </div>
                        <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.pdf"
                            onChange={(e) => handleFileChange(documentType, e.target.files?.[0] || null)}
                            className="hidden"
                        />
                    </label>
                ) : (
                    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                        <FileText className="w-5 h-5 text-rose-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {file.name}
                            </p>
                            <p className="text-xs text-slate-500">
                                {(file.size / 1024).toFixed(1)} KB
                            </p>
                        </div>
                        <button
                            onClick={() => handleFileChange(documentType, null)}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        </button>
                    </div>
                )}

                {error && (
                    <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </p>
                )}
            </div>
        );
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Document Upload
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Upload required documents to verify your identity and business
            </p>

            <div className="space-y-4">
                {/* Required Documents */}
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Required Documents
                    </h3>
                    <div className="space-y-4">
                        {REQUIRED_DOCUMENTS.map(({ key, label }) =>
                            renderDocumentUpload(key, label, true)
                        )}
                    </div>
                </div>

                {/* Optional Documents */}
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4 mt-8">
                        Optional Documents
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        These documents strengthen your application but are not mandatory
                    </p>
                    <div className="space-y-4">
                        {OPTIONAL_DOCUMENTS.map(({ key, label }) =>
                            renderDocumentUpload(key, label, false)
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-slate-700 dark:text-slate-300"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-8 py-3 rounded-xl font-bold transition-all"
                >
                    Continue to Review
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
