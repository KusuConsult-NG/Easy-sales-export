/**
 * Step 5: Business Verification (Sellers Only)
 * 
 * Collects business documents for seller verification
 */

"use client";

import { useState } from "react";
import DocumentUpload from "@/components/shared/DocumentUpload";
import { FileText, Image, Package } from "lucide-react";

interface BusinessVerificationData {
    businessRegistration?: File;
    taxId?: string;
    farmPhotos?: File[];
    productSamples?: File[];
}

interface BusinessVerificationStepProps {
    data?: BusinessVerificationData;
    onChange: (data: BusinessVerificationData) => void;
    onNext: () => void;
    onBack: () => void;
}

export default function BusinessVerificationStep({ data = {}, onChange, onNext, onBack }: BusinessVerificationStepProps) {
    const [documents, setDocuments] = useState(data);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const updateDocument = (field: keyof BusinessVerificationData, value: any) => {
        const updated = { ...documents, [field]: value };
        setDocuments(updated);
        onChange(updated);
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        // Tax ID is required
        if (!documents.taxId || !documents.taxId.trim()) {
            newErrors.taxId = "Tax Identification Number is required";
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
                    Business Verification
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Upload documents to verify your business
                </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-6">
                {/* Info Banner */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-white text-sm">ℹ</span>
                        </div>
                        <div className="text-sm">
                            <p className="font-semibold text-blue-900 dark:text-blue-200 mb-1">
                                Document Requirements
                            </p>
                            <p className="text-blue-800 dark:text-blue-300">
                                All documents must be clear and legible. Supported formats: PDF, JPG, PNG (max 5MB each).
                                Verification typically takes 1-3 business days.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Business Registration */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <FileText className="w-5 h-5 text-slate-600" />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Business Registration Certificate (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        CAC certificate for registered businesses or cooperative registration documents
                    </p>
                    <DocumentUpload
                        label=""
                        accept=".pdf,.jpg,.jpeg,.png"
                        maxSize={5}
                        onUpload={(file) => updateDocument("businessRegistration", file)}

                    />
                </div>

                {/* Tax ID */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Tax Identification Number (TIN) *
                    </label>
                    <input
                        type="text"
                        value={documents.taxId || ""}
                        onChange={(e) => updateDocument("taxId", e.target.value)}
                        placeholder="Enter your TIN"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${errors.taxId ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.taxId && (
                        <p className="mt-1 text-sm text-red-600">{errors.taxId}</p>
                    )}
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                        Required for tax compliance and payment processing
                    </p>
                </div>

                {/* Farm/Business Location Photos */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Image className="w-5 h-5 text-slate-600" />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Farm/Business Location Photos (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Upload 2-4 photos showing your farm or business facility
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <DocumentUpload
                            label="Photo 1"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const photos = documents.farmPhotos || [];
                                photos[0] = file;
                                updateDocument("farmPhotos", photos);
                            }}
                        />
                        <DocumentUpload
                            label="Photo 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const photos = documents.farmPhotos || [];
                                photos[1] = file;
                                updateDocument("farmPhotos", photos);
                            }}
                        />
                    </div>
                </div>

                {/* Product Sample Photos */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Package className="w-5 h-5 text-slate-600" />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Product Sample Photos (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Upload photos of your products to showcase quality
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <DocumentUpload
                            label="Product 1"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const samples = documents.productSamples || [];
                                samples[0] = file;
                                updateDocument("productSamples", samples);
                            }}
                        />
                        <DocumentUpload
                            label="Product 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const samples = documents.productSamples || [];
                                samples[1] = file;
                                updateDocument("productSamples", samples);
                            }}
                        />
                    </div>
                </div>

                {/* Verification Timeline */}
                <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl p-6">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-3">
                        What happens next?
                    </h4>
                    <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                        <li className="flex items-start gap-3">
                            <span className="font-bold text-green-600">1.</span>
                            <span>Our team reviews your documents within 24 hours</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="font-bold text-green-600">2.</span>
                            <span>We may contact you for additional information</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="font-bold text-green-600">3.</span>
                            <span>You'll receive an email notification about your verification status</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="font-bold text-green-600">4.</span>
                            <span>Once approved, you can start listing products immediately</span>
                        </li>
                    </ol>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
