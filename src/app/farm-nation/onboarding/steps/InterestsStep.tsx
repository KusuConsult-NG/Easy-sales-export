"use client";

import { useState } from "react";
import { CheckCircle, ArrowRight, ArrowLeft, Upload, Loader2, Trash2, FileText } from "lucide-react";
import { useStorage } from "@/hooks/use-storage";

interface InterestsStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
    role: "buyer" | "seller" | "both";
    onChange?: (data: any) => void;
}

const PROPERTY_TYPES = [
    "Cropland",
    "Pasture/Rangeland",
    "Fish Pond",
    "Poultry Farm",
    "Mixed Farm",
    "Orchard",
    "Greenhouse",
    "Livestock Farm",
];

const BUDGET_RANGES = [
    "Under ₦5M",
    "₦5M - ₦10M",
    "₦10M - ₦25M",
    "₦25M - ₦50M",
    "₦50M - ₦100M",
    "Over ₦100M",
];

const ACREAGE_RANGES = [
    "Under 5 acres",
    "5 - 10 acres",
    "10 - 50 acres",
    "50 - 100 acres",
    "Over 100 acres",
];

export default function InterestsStep({ onNext, onBack, initialData, role }: InterestsStepProps) {
    const isBuyer = role === "buyer" || role === "both";
    const isSeller = role === "seller" || role === "both";
    const { uploadFile, uploadState } = useStorage();
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    const [formData, setFormData] = useState({
        // Buyer fields
        buyerPropertyTypes: role === "both" || role === "buyer" ? (initialData?.propertyTypes || []) : [],
        budgetRange: initialData?.budgetRange || "",
        preferredSize: initialData?.preferredSize || "",
        // Seller fields
        sellerPropertyTypes: role === "both" || role === "seller" ? (initialData?.propertyTypes || []) : [],
        listingTypes: initialData?.listingTypes || [],
        totalAcreage: initialData?.totalAcreage || "",
        readyToList: initialData?.readyToList || false,
        farmLocation: initialData?.farmLocation || "",
        latitude: initialData?.latitude || "",
        longitude: initialData?.longitude || "",
        farmDocuments: initialData?.farmDocuments || [],
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const toggleBuyerPropertyType = (type: string) => {
        setFormData((prev) => ({
            ...prev,
            buyerPropertyTypes: prev.buyerPropertyTypes.includes(type)
                ? prev.buyerPropertyTypes.filter((t: string) => t !== type)
                : [...prev.buyerPropertyTypes, type],
        }));
        if (errors.buyerPropertyTypes) {
            setErrors((prev) => ({ ...prev, buyerPropertyTypes: "" }));
        }
    };

    const toggleSellerPropertyType = (type: string) => {
        setFormData((prev) => ({
            ...prev,
            sellerPropertyTypes: prev.sellerPropertyTypes.includes(type)
                ? prev.sellerPropertyTypes.filter((t: string) => t !== type)
                : [...prev.sellerPropertyTypes, type],
        }));
        if (errors.sellerPropertyTypes) {
            setErrors((prev) => ({ ...prev, sellerPropertyTypes: "" }));
        }
    };

    const toggleListingType = (type: string) => {
        setFormData((prev) => ({
            ...prev,
            listingTypes: prev.listingTypes.includes(type)
                ? prev.listingTypes.filter((t: string) => t !== type)
                : [...prev.listingTypes, type],
        }));
        if (errors.listingTypes) {
            setErrors((prev) => ({ ...prev, listingTypes: "" }));
        }
    };

    const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingDoc(true);
        try {
            const path = `farm-nation/onboarding/docs/${Date.now()}_${file.name}`;
            const url = await uploadFile(file, path);
            setFormData((prev: any) => ({
                ...prev,
                farmDocuments: [...(prev.farmDocuments || []), url]
            }));
        } catch (err: any) {
            console.error("Document upload failed:", err);
            alert("Upload failed: " + err.message);
        } finally {
            setIsUploadingDoc(false);
        }
    };

    const handleRemoveDocument = (index: number) => {
        setFormData((prev: any) => ({
            ...prev,
            farmDocuments: prev.farmDocuments.filter((_: any, i: number) => i !== index)
        }));
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (isBuyer) {
            if (formData.buyerPropertyTypes.length === 0) {
                newErrors.buyerPropertyTypes = "Select at least one property type";
            }
            if (!formData.budgetRange) {
                newErrors.budgetRange = "Select your budget range";
            }
        }

        if (isSeller) {
            if (formData.sellerPropertyTypes.length === 0) {
                newErrors.sellerPropertyTypes = "Select at least one property type to list";
            }
            if (formData.listingTypes.length === 0) {
                newErrors.listingTypes = "Select at least one transaction option (Sale, Rent, Lease)";
            }
            if (!formData.farmLocation || !formData.farmLocation.trim()) {
                newErrors.farmLocation = "Exact farm location is required";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (validate()) {
            const mergedPropertyTypes = Array.from(new Set([
                ...(isBuyer ? formData.buyerPropertyTypes : []),
                ...(isSeller ? formData.sellerPropertyTypes : [])
            ]));

            onNext({
                interests: {
                    propertyTypes: mergedPropertyTypes,
                    budgetRange: formData.budgetRange,
                    preferredSize: formData.preferredSize,
                    listingTypes: formData.listingTypes,
                    totalAcreage: formData.totalAcreage,
                    readyToList: formData.readyToList,
                    farmLocation: formData.farmLocation,
                    latitude: formData.latitude,
                    longitude: formData.longitude,
                    farmDocuments: formData.farmDocuments,
                }
            });
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                    Your Property Preferences
                </h2>
                <p className="text-slate-600">
                    Tell us what you're looking for so we can help you better
                </p>
            </div>

            {/* Buyer Interests */}
            {isBuyer && (
                <div className="space-y-6 p-6 bg-slate-50 rounded-xl">
                    <h3 className="text-lg font-bold text-slate-900">
                        Buyer Preferences
                    </h3>

                    {/* Property Types */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                            What type of properties are you interested in? <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {PROPERTY_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleBuyerPropertyType(type)}
                                    className={`p-3 rounded-lg border-2 transition-all text-sm font-medium ${formData.buyerPropertyTypes.includes(type)
                                            ? "border-teal-600 bg-teal-50 text-teal-900"
                                            : "border-slate-200 text-slate-900 hover:border-teal-300"
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                        {errors.buyerPropertyTypes && (
                            <p className="mt-2 text-sm text-red-500">{errors.buyerPropertyTypes}</p>
                        )}
                    </div>

                    {/* Budget Range */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Budget Range <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={formData.budgetRange}
                            onChange={(e) => setFormData((prev) => ({ ...prev, budgetRange: e.target.value }))}
                            className={`w-full px-4 py-3 bg-white border ${errors.budgetRange ? "border-red-500" : "border-slate-200"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500`}
                        >
                            <option value="">Select budget range</option>
                            {BUDGET_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                        {errors.budgetRange && (
                            <p className="mt-1 text-sm text-red-500">{errors.budgetRange}</p>
                        )}
                    </div>

                    {/* Preferred Size */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Preferred Property Size <span className="text-slate-400">(Optional)</span>
                        </label>
                        <select
                            value={formData.preferredSize}
                            onChange={(e) => setFormData((prev) => ({ ...prev, preferredSize: e.target.value }))}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Select size range</option>
                            {ACREAGE_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Seller Interests */}
            {isSeller && (
                <div className="space-y-6 p-6 bg-slate-50 rounded-xl">
                    <h3 className="text-lg font-bold text-slate-900">
                        Farm Information
                    </h3>

                    {/* Property Types */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                            What type of properties do you want to list? <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {PROPERTY_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleSellerPropertyType(type)}
                                    className={`p-3 rounded-lg border-2 transition-all text-sm font-medium ${formData.sellerPropertyTypes.includes(type)
                                            ? "border-teal-600 bg-teal-50 text-teal-900"
                                            : "border-slate-200 text-slate-900 hover:border-teal-300"
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                        {errors.sellerPropertyTypes && (
                            <p className="mt-2 text-sm text-red-500">{errors.sellerPropertyTypes}</p>
                        )}
                    </div>

                    {/* Transaction / Listing Types */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                            What listing options do you want to offer? <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {[
                                { value: "sale", label: "For Sale", description: "Permanent land purchase", icon: "🏷️" },
                                { value: "rent", label: "For Rent", description: "Short-term rental", icon: "🔑" },
                                { value: "lease", label: "For Lease", description: "Long-term agricultural lease", icon: "📄" }
                            ].map((opt) => {
                                const isSelected = formData.listingTypes.includes(opt.value);
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => toggleListingType(opt.value)}
                                        className={`p-4 rounded-xl border-2 transition-all text-left flex flex-col gap-1 cursor-pointer ${
                                            isSelected
                                                ? "border-teal-600 bg-teal-50/50 ring-2 ring-teal-600/25"
                                                : "border-slate-200 hover:border-teal-400 hover:bg-slate-50/50 text-slate-900"
                                        }`}
                                    >
                                        <div className="text-2xl mb-1">{opt.icon}</div>
                                        <div className="font-bold text-slate-950 text-sm">{opt.label}</div>
                                        <div className="text-[11px] text-slate-500 leading-normal">{opt.description}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {errors.listingTypes && (
                            <p className="mt-2 text-sm text-red-500">{errors.listingTypes}</p>
                        )}
                    </div>

                    {/* Total Acreage */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Total Acreage Available <span className="text-slate-400">(Optional)</span>
                        </label>
                        <select
                            value={formData.totalAcreage}
                            onChange={(e) => setFormData((prev) => ({ ...prev, totalAcreage: e.target.value }))}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Select total acreage</option>
                            {ACREAGE_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Exact Farm Location */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Exact Farm Location <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={formData.farmLocation}
                            onChange={(e) => setFormData((prev) => ({ ...prev, farmLocation: e.target.value }))}
                            placeholder="e.g. Km 12, Kaduna-Zaria Road, Kaduna"
                            className={`w-full px-4 py-3 bg-white border ${errors.farmLocation ? "border-red-500" : "border-slate-200"} rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500`}
                        />
                        {errors.farmLocation && (
                            <p className="mt-1 text-sm text-red-500">{errors.farmLocation}</p>
                        )}
                    </div>

                    {/* Farm Coordinates */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                Latitude <span className="text-slate-400">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={formData.latitude}
                                onChange={(e) => setFormData((prev) => ({ ...prev, latitude: e.target.value }))}
                                placeholder="e.g. 10.5105"
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                Longitude <span className="text-slate-400">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={formData.longitude}
                                onChange={(e) => setFormData((prev) => ({ ...prev, longitude: e.target.value }))}
                                placeholder="e.g. 7.4165"
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                    </div>

                    {/* Farm Documents */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Farm Documents <span className="text-slate-400">(Optional)</span>
                        </label>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition text-sm font-semibold text-slate-700">
                                    <Upload className="w-4 h-4" />
                                    Choose File
                                    <input
                                        type="file"
                                        onChange={handleUploadDocument}
                                        disabled={isUploadingDoc}
                                        className="hidden"
                                    />
                                </label>
                                {isUploadingDoc && (
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                                        Uploading document...
                                    </div>
                                )}
                            </div>

                            {formData.farmDocuments && formData.farmDocuments.length > 0 && (
                                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden">
                                    {formData.farmDocuments.map((doc: string, idx: number) => (
                                        <li key={idx} className="flex items-center justify-between p-3 text-sm">
                                            <a href={doc} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-teal-600 hover:underline font-medium">
                                                <FileText className="w-4 h-4" />
                                                Document {idx + 1}
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveDocument(idx)}
                                                className="text-red-500 hover:text-red-700 transition p-1 hover:bg-red-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Ready to List */}
                    <div>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.readyToList}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, readyToList: e.target.checked }))
                                }
                                className="w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-2 focus:ring-teal-500"
                            />
                            <span className="text-sm text-slate-900">
                                I have properties ready to list now
                            </span>
                        </label>
                    </div>
                </div>
            )}

            <div className="flex justify-between pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-lg font-bold hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <button
                    type="submit"
                    className="px-8 py-3 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-colors flex items-center gap-2"
                >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </form>
    );
}
