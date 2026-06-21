"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MapPin, Upload, FileText, CheckCircle, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { submitLandListingAction } from "@/app/actions/land-listings";
import { useStorage } from "@/hooks/use-storage";
import { parseCurrencyStringToFloat } from "@/lib/utils";

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara"
];

const SOIL_TYPES = ["Loamy", "Clay", "Sandy", "Silty", "Peaty", "Chalky"];
const WATER_SOURCES = ["Borehole", "River", "Stream", "Well", "Dam", "Rain-fed", "None"];

interface FormData {
    title: string;
    description: string;
    state: string;
    lga: string;
    address: string;
    size: string;
    price: string;
    soilType: string;
    waterSource: string;
    type: "sale" | "rent" | "lease";
}

export default function SubmitLandListingPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { uploadFile, uploadState } = useStorage();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState<FormData>({
        title: "",
        description: "",
        state: "",
        lga: "",
        address: "",
        size: "",
        price: "",
        soilType: "",
        waterSource: "",
        type: "sale",
    });

    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [documentFiles, setDocumentFiles] = useState<File[]>([]);

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files) {
            setImageFiles(Array.from(e.target.files).slice(0, 5)); // Max 5 images
        }
    };

    function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files) {
            setDocumentFiles(Array.from(e.target.files).slice(0, 3)); // Max 3 documents
        }
    };

    const validateStep = (currentStep: number): boolean => {
        if (currentStep === 1) {
            return !!(formData.title && formData.description && formData.state && formData.lga);
        }
        if (currentStep === 2) {
            return !!(formData.size && formData.price && formData.type);
        }
        if (currentStep === 3) {
            return imageFiles.length > 0;
        }
        return true;
    };

    function handleNext() {
        if (validateStep(step)) {
            setError(null);
            setStep(step + 1);
        } else {
            setError("Please fill in all required fields");
        }
    };

    function handleBack() {
        setError(null);
        setStep(step - 1);
    };

    async function handleSubmit() {
        if (!session?.user) {
            setError("You must be logged in to submit a listing");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Upload Images
            const imageUploadPromises = imageFiles.map(image => {
                const path = `land-listings/${session.user.id}/images/${Date.now()}_${image.name}`;
                return uploadFile(image, path);
            });
            const imageUrls = await Promise.all(imageUploadPromises);

            // 2. Upload Documents
            const documentUploadPromises = documentFiles.map(doc => {
                const path = `land-listings/${session.user.id}/docs/${Date.now()}_${doc.name}`;
                return uploadFile(doc, path);
            });
            const documentUrls = await Promise.all(documentUploadPromises);

            // 3. Submit
            const result = await submitLandListingAction({
                ownerId: session.user.id || "",
                ownerName: session.user.name || "Unknown",
                ownerEmail: session.user.email || "",
                title: formData.title,
                description: formData.description,
                location: {
                    state: formData.state,
                    lga: formData.lga,
                    address: formData.address,
                },
                size: parseCurrencyStringToFloat(formData.size),
                price: parseCurrencyStringToFloat(formData.price),
                soilType: formData.soilType,
                waterSource: formData.waterSource,
                availableForSale: formData.type === "sale",
                availableForRent: formData.type === "rent" || formData.type === "lease",
                availableForLease: formData.type === "lease",
                type: formData.type,
                imageUrls,
                documentUrls,
            });

            if (result.success) {
                setStep(5); // Success step
                setTimeout(() => router.push("/land"), 3000);
            } else {
                setError(result.error || "Failed to submit listing");
            }
        } catch (err: any) {
            setError(err?.message || "An unexpected error occurred during submission");
        } finally {
            setLoading(false);
        }
    };

    if (!session) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-xl">
                    <h2 className="text-2xl font-bold text-slate-900 mb-4">
                        Authentication Required
                    </h2>
                    <p className="text-slate-600 mb-6">
                        Please log in to submit a land listing
                    </p>
                    <button
                        onClick={() => router.push("/auth/login?callbackUrl=/land/submit")}
                        className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                    >
                        Go to Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 p-8">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Submit Land Listing
                    </h1>
                    <p className="text-slate-600">
                        List your agricultural land for sale or lease
                    </p>
                </div>

                {/* Progress Bar */}
                {step < 5 && (
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            {[1, 2, 3, 4].map((s) => (
                                <div key={s} className="flex-1 flex items-center">
                                    <div
                                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition ${step >= s
                                            ? "bg-green-600 text-white"
                                            : "bg-slate-200 text-slate-400"
                                            }`}
                                    >
                                        {s}
                                    </div>
                                    {s < 4 && (
                                        <div
                                            className={`flex-1 h-1 mx-2 transition ${step > s ? "bg-green-600" : "bg-slate-200"
                                                }`}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between text-sm text-slate-600">
                            <span>Basic Info</span>
                            <span>Details</span>
                            <span>Images</span>
                            <span>Documents</span>
                        </div>
                    </div>
                )}

                {/* Form Card */}
                <div className="bg-white rounded-2xl p-8 shadow-xl">
                    {error && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Step 1: Basic Information */}
                    {!loading && step === 1 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Basic Information
                            </h2>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Listing Title *
                                </label>
                                <input
                                    type="text"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleInputChange}
                                    placeholder="e.g., 10 Hectares Fertile Farmland in Osun"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Description *
                                </label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    rows={4}
                                    placeholder="Describe key features, crops grown, accessibility, etc."
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        State *
                                    </label>
                                    <select
                                        name="state"
                                        value={formData.state}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    >
                                        <option value="">Select State</option>
                                        {NIGERIAN_STATES.map((state) => (
                                            <option key={state} value={state}>
                                                {state}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Local Government Area *
                                    </label>
                                    <input
                                        type="text"
                                        name="lga"
                                        value={formData.lga}
                                        onChange={handleInputChange}
                                        placeholder="Enter LGA"
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Street Address
                                </label>
                                <input
                                    type="text"
                                    name="address"
                                    value={formData.address}
                                    onChange={handleInputChange}
                                    placeholder="Specific location or nearest landmark"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Land Details */}
                    {!loading && step === 2 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Land Details
                            </h2>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Size (Hectares) *
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="[0-9.,]*"
                                        name="size"
                                        value={formData.size}
                                        onChange={handleInputChange}
                                        placeholder="e.g., 10"
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Price (₦) *
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="[0-9.,]*"
                                        name="price"
                                        value={formData.price}
                                        onChange={handleInputChange}
                                        placeholder="e.g., 5000000"
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Soil Type
                                    </label>
                                    <select
                                        name="soilType"
                                        value={formData.soilType}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    >
                                        <option value="">Select Soil Type</option>
                                        {SOIL_TYPES.map((type) => (
                                            <option key={type} value={type}>
                                                {type}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Water Source
                                    </label>
                                    <select
                                        name="waterSource"
                                        value={formData.waterSource}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-600 outline-none"
                                    >
                                        <option value="">Select Water Source</option>
                                        {WATER_SOURCES.map((source) => (
                                            <option key={source} value={source}>
                                                {source}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-slate-900">
                                    Listing Type *
                                </label>
                                <div className="grid grid-cols-3 gap-4">
                                    {[
                                        { value: "sale", label: "For Sale", icon: "🏷️" },
                                        { value: "rent", label: "For Rent", icon: "🔑" },
                                        { value: "lease", label: "For Lease", icon: "📄" }
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, type: option.value as "sale" | "rent" | "lease" })}
                                            className={`p-4 border-2 rounded-xl transition-all text-center flex flex-col items-center justify-center gap-1 cursor-pointer ${formData.type === option.value
                                                ? "border-green-600 bg-green-50/50 ring-2 ring-green-600/25"
                                                : "border-slate-200 hover:border-green-400 hover:bg-slate-50/50"
                                                }`}
                                        >
                                            <span className="text-2xl">{option.icon}</span>
                                            <span className="font-bold text-slate-950 text-sm">{option.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Images */}
                    {!loading && step === 3 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Upload Images *
                            </h2>

                            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
                                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="text-slate-600 mb-4">
                                    Choose land photos (max 5, PNG/JPG)
                                </p>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageUpload}
                                    className="hidden"
                                    id="image-upload"
                                />
                                <label
                                    htmlFor="image-upload"
                                    className="inline-block px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 cursor-pointer transition"
                                >
                                    Select Images
                                </label>
                            </div>

                            {imageFiles.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                                        Selected Images ({imageFiles.length}/5)
                                    </h3>
                                    <div className="space-y-2">
                                        {imageFiles.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center gap-3 p-3 bg-green-50 rounded-lg"
                                            >
                                                <CheckCircle className="w-5 h-5 text-green-600" />
                                                <span className="text-sm text-slate-900">
                                                    {file.name}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 4: Documents */}
                    {!loading && step === 4 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Upload Documents (Optional)
                            </h2>

                            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
                                <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="text-slate-600 mb-2">
                                    Upload land documents (max 3, PDF)
                                </p>
                                <p className="text-xs text-slate-500 mb-4">
                                    C of O, Survey Plans, Title Deeds, etc.
                                </p>
                                <input
                                    type="file"
                                    accept=".pdf"
                                    multiple
                                    onChange={handleDocumentUpload}
                                    className="hidden"
                                    id="document-upload"
                                />
                                <label
                                    htmlFor="document-upload"
                                    className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 cursor-pointer transition"
                                >
                                    Select Documents
                                </label>
                            </div>

                            {documentFiles.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                                        Selected Documents ({documentFiles.length}/3)
                                    </h3>
                                    <div className="space-y-2">
                                        {documentFiles.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg"
                                            >
                                                <CheckCircle className="w-5 h-5 text-blue-600" />
                                                <span className="text-sm text-slate-900">
                                                    {file.name}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Submitting Loading Assets Progress State */}
                    {loading && (
                        <div className="text-center py-12 space-y-6 animate-fadeIn">
                            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                                <Loader2 className="w-10 h-10 text-green-600 animate-spin" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-bold text-slate-900">Uploading Land Assets</h3>
                                <p className="text-slate-500 max-w-md mx-auto">Please wait while we secure and upload your photos and documents to our server.</p>
                            </div>
                            <div className="max-w-md mx-auto space-y-4 text-left p-6 bg-slate-50 border border-slate-200 rounded-2xl">
                                {[...imageFiles, ...documentFiles].map((file) => {
                                    const state = uploadState[file.name];
                                    const progress = state?.progress ?? 0;
                                    const error = state?.error ?? null;
                                    return (
                                        <div key={file.name} className="space-y-1.5">
                                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                                                <span className="truncate max-w-[240px] flex items-center gap-1.5">
                                                    {file.type.startsWith("image/") ? "🖼️" : "📄"} {file.name}
                                                </span>
                                                <span className={error ? "text-red-600" : "text-green-600"}>
                                                    {error ? "Failed" : progress === 100 ? "Completed" : `${Math.round(progress)}%`}
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${error ? "bg-red-500" : "bg-green-600"}`}
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            {error && <p className="text-[10px] text-red-500 font-medium">{error}</p>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Step 5: Success */}
                    {step === 5 && (
                        <div className="text-center py-8">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-12 h-12 text-green-600" />
                            </div>
                            <h2 className="text-3xl font-bold text-slate-900 mb-4">
                                Listing Submitted!
                            </h2>
                            <p className="text-slate-600 mb-6">
                                Your land listing has been submitted for verification.
                                You'll be notified once it's approved.
                            </p>
                            <p className="text-sm text-slate-500">
                                Redirecting to land listings...
                            </p>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    {!loading && step < 5 && (
                        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
                            <button
                                onClick={handleBack}
                                disabled={step === 1}
                                className="px-6 py-3 border border-slate-300 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                Back
                            </button>

                            {step < 4 ? (
                                <button
                                    onClick={handleNext}
                                    className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2"
                                >
                                    Next
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSubmit}
                                    disabled={loading}
                                    className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        <>
                                            Submit Listing
                                            <CheckCircle className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
