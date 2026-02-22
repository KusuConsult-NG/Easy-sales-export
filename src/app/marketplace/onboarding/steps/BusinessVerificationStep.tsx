/**
 * Step 5: Business Verification (Sellers Only)
 * 
 * Collects business documents for seller verification
 */

"use client";

import { useState } from "react";
import DocumentUpload from "@/components/shared/DocumentUpload";
import { FileText, Image, Package } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

interface BusinessVerificationData {
    businessRegistration?: { name: string; url: string }; // Changed to object for URL mapping if using Firebase
    cacNumber?: string;
    cacVerified?: boolean;
    companyName?: string;
    taxId?: string;
    tinVerified?: boolean;
    farmPhotos?: { name: string; url: string }[];
    productSamples?: { name: string; url: string }[];
}

interface BusinessVerificationStepProps {
    data?: BusinessVerificationData;
    onChange: (data: BusinessVerificationData) => void;
    onNext: () => void;
    onBack: () => void;
}

export default function BusinessVerificationStep({ data = {}, onChange, onNext, onBack }: BusinessVerificationStepProps) {
    const [documents, setDocuments] = useState<BusinessVerificationData>(data);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Verification loading states
    const [verifyingTin, setVerifyingTin] = useState(false);
    const [verifyingCac, setVerifyingCac] = useState(false);

    const updateDocument = (field: keyof BusinessVerificationData, value: any) => {
        const updated = { ...documents, [field]: value };
        setDocuments(updated);
        onChange(updated);
    };

    const { showToast } = useToast();

    const validate = () => {
        const newErrors: Record<string, string> = {};

        // Tax ID is required
        if (!documents.taxId || !documents.taxId.trim()) {
            newErrors.taxId = "Tax Identification Number is required";
        } else if (!documents.tinVerified) {
            newErrors.taxId = "You must verify your TIN";
        }

        // If registration is uploaded, CAC verification is required
        if (documents.businessRegistration) {
            if (!documents.cacNumber) {
                newErrors.cacNumber = "RC Number is required when uploading a business certificate";
            }
            if (!documents.companyName) {
                newErrors.companyName = "Company name is required for CAC verification";
            }
            if (documents.cacNumber && documents.companyName && !documents.cacVerified) {
                newErrors.cacVerified = "You must verify your CAC Registration";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const verifyTIN = async () => {
        if (!documents.taxId) {
            showToast("Please enter a TIN to verify", "error");
            return;
        }

        setVerifyingTin(true);
        setErrors(prev => ({ ...prev, verifyTin: "" }));

        try {
            const res = await fetch('/api/kyc/verify-business', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'tin',
                    number: documents.taxId,
                })
            });
            const resData = await res.json();

            if (resData.success && resData.isMatch) {
                updateDocument("tinVerified", true);
                showToast("TIN successfully verified via QoreID", "success");
            } else {
                updateDocument("tinVerified", false);
                setErrors(prev => ({ ...prev, verifyTin: resData.error || "TIN Verification failed" }));
                showToast(resData.error || "TIN Verification failed", "error");
            }
        } catch (err) {
            updateDocument("tinVerified", false);
            setErrors(prev => ({ ...prev, verifyTin: "Network error during verification" }));
        } finally {
            setVerifyingTin(false);
        }
    };

    const verifyCAC = async () => {
        if (!documents.cacNumber || !documents.companyName) {
            showToast("Please enter an RC Number and Company Name to verify", "error");
            return;
        }

        setVerifyingCac(true);
        setErrors(prev => ({ ...prev, verifyCac: "" }));

        try {
            const res = await fetch('/api/kyc/verify-business', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'cac',
                    number: documents.cacNumber,
                    companyName: documents.companyName
                })
            });
            const resData = await res.json();

            if (resData.success && resData.isMatch) {
                updateDocument("cacVerified", true);
                showToast("CAC successfully verified via QoreID", "success");
            } else {
                updateDocument("cacVerified", false);
                setErrors(prev => ({ ...prev, verifyCac: resData.error || "CAC Verification failed" }));
                showToast(resData.error || "CAC Verification failed", "error");
            }
        } catch (err) {
            updateDocument("cacVerified", false);
            setErrors(prev => ({ ...prev, verifyCac: "Network error during verification" }));
        } finally {
            setVerifyingCac(false);
        }
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
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Business Verification
                </h2>
                <p className="text-lg text-slate-600">
                    Upload documents to verify your business
                </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-6">
                {/* Info Banner */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-white text-sm">ℹ</span>
                        </div>
                        <div className="text-sm">
                            <p className="font-semibold text-blue-900 mb-1">
                                Document Requirements
                            </p>
                            <p className="text-blue-800">
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
                        <label className="block text-sm font-semibold text-slate-900">
                            Business Registration Certificate (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">
                        CAC certificate for registered businesses or cooperative registration documents
                    </p>
                    <DocumentUpload
                        label=""
                        accept=".pdf,.jpg,.jpeg,.png"
                        maxSize={5}
                        onUpload={(file) => updateDocument("businessRegistration", { name: file.name, url: URL.createObjectURL(file) })}
                    />

                    {documents.businessRegistration && (
                        <div className="mt-4 p-4 border border-slate-200 rounded-xl bg-white space-y-4">
                            <h4 className="font-semibold text-slate-900 text-sm">Verify Business Registration</h4>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Company Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={documents.companyName || ""}
                                        onChange={(e) => {
                                            updateDocument("companyName", e.target.value);
                                            updateDocument("cacVerified", false);
                                        }}
                                        disabled={documents.cacVerified || verifyingCac}
                                        placeholder="Enter full company name"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                                    />
                                    {errors.companyName && <p className="text-xs text-red-600 mt-1">{errors.companyName}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        RC Number / Business Number <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={documents.cacNumber || ""}
                                            onChange={(e) => {
                                                updateDocument("cacNumber", e.target.value);
                                                updateDocument("cacVerified", false);
                                            }}
                                            placeholder="RC-123456"
                                            disabled={documents.cacVerified || verifyingCac}
                                            className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={verifyCAC}
                                            disabled={!documents.cacNumber || !documents.companyName || documents.cacVerified || verifyingCac}
                                            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap ${documents.cacVerified
                                                ? "bg-green-100 text-green-700 cursor-default"
                                                : verifyingCac || !documents.cacNumber || !documents.companyName
                                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                                    : "bg-green-100 text-green-700 hover:bg-green-200"
                                                }`}
                                        >
                                            {verifyingCac ? "Verifying..." : documents.cacVerified ? "Verified ✓" : "Verify CAC"}
                                        </button>
                                    </div>
                                    {errors.cacNumber && <p className="text-xs text-red-600 mt-1">{errors.cacNumber}</p>}
                                    {errors.cacVerified && <p className="text-xs text-red-600 mt-1">{errors.cacVerified}</p>}
                                    {errors.verifyCac && <p className="text-xs text-red-600 mt-1">{errors.verifyCac}</p>}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Tax ID */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Tax Identification Number (TIN) *
                    </label>
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={documents.taxId || ""}
                            onChange={(e) => {
                                updateDocument("taxId", e.target.value);
                                updateDocument("tinVerified", false);
                            }}
                            disabled={documents.tinVerified || verifyingTin}
                            placeholder="Enter your TIN"
                            className={`flex-1 px-4 py-3 border rounded-xl bg-white text-slate-900 ${errors.taxId ? "border-red-500" : "border-slate-300"
                                } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                        />
                        <button
                            type="button"
                            onClick={verifyTIN}
                            disabled={!documents.taxId || documents.tinVerified || verifyingTin}
                            className={`px-6 py-3 rounded-xl font-semibold transition-colors whitespace-nowrap ${documents.tinVerified
                                ? "bg-green-100 text-green-700 cursor-default"
                                : verifyingTin || !documents.taxId
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-green-100 text-green-700 hover:bg-green-200"
                                }`}
                        >
                            {verifyingTin ? "Verifying..." : documents.tinVerified ? "Verified ✓" : "Verify TIN"}
                        </button>
                    </div>
                    {errors.taxId && (
                        <p className="mt-1 text-sm text-red-600">{errors.taxId}</p>
                    )}
                    {errors.verifyTin && (
                        <p className="mt-1 text-sm text-red-600">{errors.verifyTin}</p>
                    )}
                    <p className="mt-2 text-sm text-slate-600">
                        Required for tax compliance and payment processing
                    </p>
                </div>

                {/* Farm/Business Location Photos */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Image className="w-5 h-5 text-slate-600" />
                        <label className="block text-sm font-semibold text-slate-900">
                            Farm/Business Location Photos (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">
                        Upload 2-4 photos showing your farm or business facility
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <DocumentUpload
                            label="Photo 1"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const photos = documents.farmPhotos ? [...documents.farmPhotos] : [];
                                photos[0] = { name: file.name, url: URL.createObjectURL(file) };
                                updateDocument("farmPhotos", photos);
                            }}
                        />
                        <DocumentUpload
                            label="Photo 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const photos = documents.farmPhotos ? [...documents.farmPhotos] : [];
                                photos[1] = { name: file.name, url: URL.createObjectURL(file) };
                                updateDocument("farmPhotos", photos);
                            }}
                        />
                    </div>
                </div>

                {/* Product Sample Photos */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Package className="w-5 h-5 text-slate-600" />
                        <label className="block text-sm font-semibold text-slate-900">
                            Product Sample Photos (Optional)
                        </label>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">
                        Upload photos of your products to showcase quality
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <DocumentUpload
                            label="Product 1"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const samples = documents.productSamples ? [...documents.productSamples] : [];
                                samples[0] = { name: file.name, url: URL.createObjectURL(file) };
                                updateDocument("productSamples", samples);
                            }}
                        />
                        <DocumentUpload
                            label="Product 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            onUpload={(file) => {
                                const samples = documents.productSamples ? [...documents.productSamples] : [];
                                samples[1] = { name: file.name, url: URL.createObjectURL(file) };
                                updateDocument("productSamples", samples);
                            }}
                        />
                    </div>
                </div>

                {/* Verification Timeline */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                    <h4 className="font-bold text-slate-900 mb-3">
                        What happens next?
                    </h4>
                    <ol className="space-y-2 text-sm text-slate-900">
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
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
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
