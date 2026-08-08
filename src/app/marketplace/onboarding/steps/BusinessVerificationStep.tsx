/**
 * Step 5: Business Verification (Sellers Only)
 *
 * Collects business documents. TIN and CAC verification is manual (admin-reviewed).
 * QoreID live verification has been removed.
 */

"use client";

import { useState } from "react";
import DocumentUpload from "@/components/shared/DocumentUpload";
import { uploadDocumentAction } from "@/app/actions/upload";
import { FileText, Image as ImageIcon, Package } from "lucide-react";

interface BusinessVerificationData {
    businessRegistration?: { name: string; url: string };
    cacNumber?: string;
    companyName?: string;
    taxId?: string;
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

    const [uploading, setUploading] = useState<string[]>([]);
    const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

    const updateDocuments = (updates: Partial<BusinessVerificationData>) => {
        setDocuments(prev => {
            const next = { ...prev, ...updates };
            onChange(next);
            return next;
        });
    };

    /**
     * Uploads a file and returns its stored URL, or null on failure.
     *
     * Every slot on this step previously recorded URL.createObjectURL(file) —
     * a blob: URL valid only inside the uploader's own browser tab. It dies
     * with the tab, so no seller verification document was ever retained and
     * admins reviewing an application saw broken links.
     *
     * uploadDocumentAction validates type and size and stores the file in
     * Cloudinary. It existed, fully written, with no callers.
     */
    async function uploadFile(slot: string, file: File, documentType: string): Promise<string | null> {
        setUploadErrors(prev => {
            const next = { ...prev };
            delete next[slot];
            return next;
        });
        setUploading(prev => [...prev, slot]);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("fileName", file.name);
            formData.append("mimeType", file.type);
            formData.append("documentType", documentType);

            const result = await uploadDocumentAction(formData);

            if (!result.success || !result.url) {
                setUploadErrors(prev => ({
                    ...prev,
                    [slot]: result.success ? "Upload returned no file location." : result.error,
                }));
                return null;
            }

            return result.url as string;
        } catch (err) {
            setUploadErrors(prev => ({
                ...prev,
                [slot]: err instanceof Error ? err.message : "Upload failed. Please try again.",
            }));
            return null;
        } finally {
            setUploading(prev => prev.filter(s => s !== slot));
        }
    }

    /** Places an uploaded photo at a fixed index within a list field. */
    async function uploadPhotoAt(
        field: "farmPhotos" | "productSamples",
        index: number,
        file: File,
        documentType: string
    ) {
        const slot = `${field}-${index}`;
        const url = await uploadFile(slot, file, documentType);
        if (!url) return;

        const list = documents[field] ? [...documents[field]!] : [];
        list[index] = { name: file.name, url };
        updateDocuments({ [field]: list } as Partial<BusinessVerificationData>);
    }

    return (
        <div className="space-y-6">
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
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-blue-600 text-sm font-bold">ℹ</span>
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

                {/* Business Registration Certificate */}
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
                        error={uploadErrors["businessRegistration"]}
                        onUpload={async (file) => {
                            const url = await uploadFile(
                                "businessRegistration",
                                file,
                                "marketplace_business_registration"
                            );
                            if (url) {
                                updateDocuments({ businessRegistration: { name: file.name, url } });
                            }
                        }}
                    />
                    {uploading.includes("businessRegistration") && (
                        <p className="mt-2 text-sm text-slate-500">Uploading…</p>
                    )}

                    {documents.businessRegistration && (
                        <div className="mt-4 p-4 border border-slate-200 rounded-lg bg-white space-y-4">
                            <h4 className="font-semibold text-slate-900 text-sm">Business Registration Details</h4>
                            <p className="text-xs text-slate-500">
                                Our team will manually review your registration document within 1-3 business days.
                            </p>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Company Name
                                    </label>
                                    <input
                                        type="text"
                                        value={documents.companyName || ""}
                                        onChange={(e) => updateDocuments({ companyName: e.target.value })}
                                        placeholder="Enter full company name"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        RC Number / Business Number
                                    </label>
                                    <input
                                        type="text"
                                        value={documents.cacNumber || ""}
                                        onChange={(e) => updateDocuments({ cacNumber: e.target.value })}
                                        placeholder="RC-123456"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Tax ID — plain text, admin reviews manually */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Tax Identification Number (TIN){" "}
                        <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                    </label>
                    <input
                        type="text"
                        value={documents.taxId || ""}
                        onChange={(e) => updateDocuments({ taxId: e.target.value })}
                        placeholder="Enter your TIN"
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <p className="mt-2 text-sm text-slate-600">
                        Collected for tax compliance — reviewed by our team
                    </p>
                </div>

                {/* Farm/Business Location Photos */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <ImageIcon className="w-5 h-5 text-slate-600" />
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
                            error={uploadErrors["farmPhotos-0"]}
                            onUpload={(file) => uploadPhotoAt("farmPhotos", 0, file, "marketplace_farm_photo")}
                        />
                        <DocumentUpload
                            label="Photo 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            error={uploadErrors["farmPhotos-1"]}
                            onUpload={(file) => uploadPhotoAt("farmPhotos", 1, file, "marketplace_farm_photo")}
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
                            error={uploadErrors["productSamples-0"]}
                            onUpload={(file) => uploadPhotoAt("productSamples", 0, file, "marketplace_product_sample")}
                        />
                        <DocumentUpload
                            label="Product 2"
                            accept=".jpg,.jpeg,.png"
                            maxSize={5}
                            error={uploadErrors["productSamples-1"]}
                            onUpload={(file) => uploadPhotoAt("productSamples", 1, file, "marketplace_product_sample")}
                        />
                    </div>
                </div>

                {/* Verification Timeline */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
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
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={onNext}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
