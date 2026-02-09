/**
 * Document Upload Step
 * 
 * Upload required verification documents
 */

"use client";

import { useState } from "react";
import { Upload, FileText, Image, CheckCircle, AlertCircle } from "lucide-react";

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

export default function DocumentUploadStep({ data, onChange, onNext, onBack }: DocumentUploadStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleFileUpload = (field: string, file: File | null) => {
        if (file) {
            // In production, upload to Firebase Storage
            const mockUrl = URL.createObjectURL(file);
            onChange({
                ...data,
                [field]: { name: file.name, url: mockUrl }
            });
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
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Valid ID <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Government-issued ID (NIN, Driver's License, International Passport)
                    </p>
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${errors.validId ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800"
                        }`}>
                        {data.validId ? (
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
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Passport Photo <span className="text-red-500">*</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Recent passport-sized photograph
                    </p>
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${errors.passportPhoto ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800"
                        }`}>
                        {data.passportPhoto ? (
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
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Proof of Address <span className="text-slate-500">(Optional)</span>
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Utility bill, bank statement, or tenancy agreement
                    </p>
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 text-center bg-slate-50 dark:bg-slate-800">
                        {data.proofOfAddress ? (
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
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
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
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
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
