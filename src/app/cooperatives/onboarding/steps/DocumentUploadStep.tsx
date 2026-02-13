/**
 * Document Upload Step
 * 
 * Upload required verification documents to Firebase Storage
 */

"use client";

import { useState } from "react";
import { Upload, FileText, Image, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { uploadFile, validateFile, generateDocumentPath } from "@/lib/storage-upload";

interface DocumentUploadStepProps {
    data: {
        validId?: { name: string; url: string };
        passportPhoto?: { name: string; url: string };
        proofOfAddress?: { name: string; url: string };
        bvn: string;
    };
    onChange: (data: any) => void;
    onNext: () => void;
    onBack: () => void;
}

interface UploadState {
    uploading: boolean;
    progress: number;
    error?: string;
}

export default function DocumentUploadStep({ data, onChange, onNext, onBack }: DocumentUploadStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [bvnConsent, setBvnConsent] = useState(false);
    const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({
        validId: { uploading: false, progress: 0 },
        passportPhoto: { uploading: false, progress: 0 },
        proofOfAddress: { uploading: false, progress: 0 },
    });

    const handleFileUpload = async (field: string, file: File | null) => {
        if (!file) return;

        // Validate file
        const validation = validateFile(file, 5, ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);
        if (!validation.valid) {
            setErrors({ ...errors, [field]: validation.error || 'Invalid file' });
            return;
        }

        // Clear previous errors
        setErrors({ ...errors, [field]: '' });

        // Set uploading state
        setUploadStates({
            ...uploadStates,
            [field]: { uploading: true, progress: 0 }
        });

        try {
            // Generate unique file path
            // Use a temporary ID for onboarding (will be replaced with actual user ID after auth)
            const tempUserId = `temp-${Date.now()}`;
            const filePath = generateDocumentPath(tempUserId, field, file.name);

            // Upload to Firebase Storage with progress tracking
            const downloadURL = await uploadFile(file, filePath, (progress) => {
                setUploadStates((prev: Record<string, UploadState>) => ({
                    ...prev,
                    [field]: {
                        uploading: progress.status === 'uploading',
                        progress: progress.progress,
                        error: progress.error
                    }
                }));
            });

            // Update form data with permanent URL
            onChange({
                ...data,
                [field]: { name: file.name, url: downloadURL }
            });

            // Reset upload state
            setUploadStates((prev: Record<string, UploadState>) => ({
                ...prev,
                [field]: { uploading: false, progress: 100 }
            }));

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Upload failed';
            setErrors({ ...errors, [field]: errorMessage });
            setUploadStates((prev: Record<string, UploadState>) => ({
                ...prev,
                [field]: { uploading: false, progress: 0, error: errorMessage }
            }));
        }
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!data.validId) {
            newErrors.validId = "Valid ID is required";
        }

        if (!data.passportPhoto) {
            newErrors.passportPhoto = "Passport photo is required";
        }

        if (!data.bvn.trim()) {
            newErrors.bvn = "BVN is required";
        } else if (!/^\d{11}$/.test(data.bvn)) {
            newErrors.bvn = "BVN must be exactly 11 digits";
        }

        // BVN consent validation
        if (data.bvn.trim() && !bvnConsent) {
            newErrors.bvnConsent = "You must consent to BVN collection and processing";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (validate()) {
            onNext();
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Document Upload
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Upload your verification documents
                </p>
            </div>

            {/* Info Banner */}
            <div className="max-w-2xl mx-auto bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-orange-900 dark:text-orange-200 mb-1">
                            Document Requirements
                        </p>
                        <ul className="text-sm text-orange-800 dark:text-orange-300 space-y-1">
                            <li>• All documents must be clear and readable</li>
                            <li>• Accepted formats: JPG, PNG, PDF (Max 5MB each)</li>
                            <li>• Documents will be verified within 24-48 hours</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Valid ID */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Valid ID <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Government-issued ID (NIN, Driver's License, International Passport)
                    </p>
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${errors.validId ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800"
                        }`}>
                        {uploadStates.validId.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 dark:text-white font-medium">
                                    Uploading... {Math.round(uploadStates.validId.progress)}%
                                </p>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div
                                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${uploadStates.validId.progress}%` }}
                                    />
                                </div>
                            </div>
                        ) : data.validId ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 dark:text-white font-medium">
                                        {data.validId.name}
                                    </span>
                                </div>
                                <button
                                    onClick={() => onChange({ ...data, validId: undefined })}
                                    className="text-red-600 hover:text-red-700 text-sm font-semibold"
                                    disabled={uploadStates.validId.uploading}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*,.pdf"
                                    onChange={(e) => handleFileUpload("validId", e.target.files?.[0] || null)}
                                    className="hidden"
                                    disabled={uploadStates.validId.uploading}
                                />
                                <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 dark:text-slate-400 font-medium">
                                    Click to upload ID document
                                </p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG, PDF (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                    {errors.validId && (
                        <p className="text-sm text-red-600 mt-1">{errors.validId}</p>
                    )}
                </div>

                {/* Passport Photo */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Passport Photo <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Recent passport-sized photograph
                    </p>
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${errors.passportPhoto ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800"
                        }`}>
                        {uploadStates.passportPhoto.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 dark:text-white font-medium">
                                    Uploading... {Math.round(uploadStates.passportPhoto.progress)}%
                                </p>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div
                                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${uploadStates.passportPhoto.progress}%` }}
                                    />
                                </div>
                            </div>
                        ) : data.passportPhoto ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 dark:text-white font-medium">
                                        {data.passportPhoto.name}
                                    </span>
                                </div>
                                <button
                                    onClick={() => onChange({ ...data, passportPhoto: undefined })}
                                    className="text-red-600 hover:text-red-700 text-sm font-semibold"
                                    disabled={uploadStates.passportPhoto.uploading}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleFileUpload("passportPhoto", e.target.files?.[0] || null)}
                                    className="hidden"
                                    disabled={uploadStates.passportPhoto.uploading}
                                />
                                <Image className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 dark:text-slate-400 font-medium">
                                    Click to upload passport photo
                                </p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                    {errors.passportPhoto && (
                        <p className="text-sm text-red-600 mt-1">{errors.passportPhoto}</p>
                    )}
                </div>

                {/* Proof of Address (Optional) */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Proof of Address <span className="text-slate-500">(Optional)</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Utility bill, bank statement, or tenancy agreement
                    </p>
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 text-center bg-slate-50 dark:bg-slate-800">
                        {uploadStates.proofOfAddress.uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                                <p className="text-slate-900 dark:text-white font-medium">
                                    Uploading... {Math.round(uploadStates.proofOfAddress.progress)}%
                                </p>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                    <div
                                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${uploadStates.proofOfAddress.progress}%` }}
                                    />
                                </div>
                            </div>
                        ) : data.proofOfAddress ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                    <span className="text-slate-900 dark:text-white font-medium">
                                        {data.proofOfAddress.name}
                                    </span>
                                </div>
                                <button
                                    onClick={() => onChange({ ...data, proofOfAddress: undefined })}
                                    className="text-red-600 hover:text-red-700 text-sm font-semibold"
                                    disabled={uploadStates.proofOfAddress.uploading}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="image/*,.pdf"
                                    onChange={(e) => handleFileUpload("proofOfAddress", e.target.files?.[0] || null)}
                                    className="hidden"
                                    disabled={uploadStates.proofOfAddress.uploading}
                                />
                                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                                <p className="text-slate-600 dark:text-slate-400 font-medium">
                                    Click to upload proof of address
                                </p>
                                <p className="text-sm text-slate-500 mt-1">JPG, PNG, PDF (Max 5MB)</p>
                            </label>
                        )}
                    </div>
                </div>

                {/* BVN */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Bank Verification Number (BVN) <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Your 11-digit BVN for identity verification
                    </p>
                    <input
                        type="text"
                        value={data.bvn}
                        onChange={(e) => onChange({ ...data, bvn: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                        placeholder="12345678901"
                        maxLength={11}
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.bvn ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.bvn && (
                        <p className="text-sm text-red-600 mt-1">{errors.bvn}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                        📞 Dial *565*0# to retrieve your BVN
                    </p>
                </div>

                {/* BVN Consent */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            id="bvnConsent"
                            checked={bvnConsent}
                            onChange={(e) => setBvnConsent(e.target.checked)}
                            className="mt-1 w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                        />
                        <label htmlFor="bvnConsent" className="flex-1 text-sm text-slate-900 dark:text-white">
                            <span className="font-semibold text-slate-900 dark:text-white">
                                I consent to the collection and processing of my BVN
                            </span>
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                Your Bank Verification Number (BVN) is collected solely for:
                            </p>
                            <ul className="mt-2 text-xs text-slate-600 dark:text-slate-400 space-y-1 ml-4 list-disc">
                                <li>Identity verification and fraud prevention</li>
                                <li>Compliance with Nigerian regulatory requirements</li>
                                <li>Enabling cooperative financial services (loans, savings)</li>
                            </ul>
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                                Your BVN will be stored securely and never shared with third parties without your explicit consent,
                                except as required by law. You may request deletion of your data by contacting{' '}
                                <a href="mailto:privacy@easysalescooperative.com" className="text-purple-600 hover:underline">
                                    privacy@easysalescooperative.com
                                </a>
                            </p>
                        </label>
                    </div>
                    {errors.bvnConsent && (
                        <p className="text-sm text-red-600 mt-2">{errors.bvnConsent}</p>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all"
                >
                    Continue to Payment
                </button>
            </div>
        </div>
    );
}
