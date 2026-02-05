"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MapPin, Upload, FileText, CheckCircle, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { submitLandListingAction } from "@/app/actions/land-listings";

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
}

export default function SubmitLandListingPage() {
    const router = useRouter();
    const { data: session } = useSession();
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
    });

    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [documentFiles, setDocumentFiles] = useState<File[]>([]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setImageFiles(Array.from(e.target.files).slice(0, 5)); // Max 5 images
        }
    };

    const handleDocumentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setDocumentFiles(Array.from(e.target.files).slice(0, 3)); // Max 3 documents
        }
    };

    const validateStep = (currentStep: number): boolean => {
        if (currentStep === 1) {
            return !!(formData.title && formData.description && formData.state && formData.lga);
        }
        if (currentStep === 2) {
            return !!(formData.size && formData.price);
        }
        if (currentStep === 3) {
            return imageFiles.length > 0;
        }
        return true;
    };

    const handleNext = () => {
        if (validateStep(step)) {
            setError(null);
            setStep(step + 1);
        } else {
            setError("Please fill in all required fields");
        }
    };

    const handleBack = () => {
        setError(null);
        setStep(step - 1);
    };

    const handleSubmit = async () => {
        if (!session?.user) {
            setError("You must be logged in to submit a listing");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await submitLandListingAction({
                ownerId: session.user.id!,
                ownerName: session.user.name || "Unknown",
                ownerEmail: session.user.email!,
                title: formData.title,
                description: formData.description,
                location: {
                    state: formData.state,
                    lga: formData.lga,
                    address: formData.address,
                },
                size: parseFloat(formData.size),
                price: parseFloat(formData.price),
                soilType: formData.soilType,
                waterSource: formData.waterSource,
                imageFiles,
                documentFiles,
            });

            if (result.success) {
                setStep(5); // Success step
                setTimeout(() => router.push("/land"), 3000);
            } else {
                setError(result.error || "Failed to submit listing");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    if (!session) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md text-center shadow-xl">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                        Authentication Required
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Please log in to submit a land listing
                    </p>
                    <button
                        onClick={() => router.push("/login")}
                        className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                    >
                        Go to Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Submit Land Listing
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
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
                                                : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                                            }`}
                                    >
                                        {s}
                                    </div>
                                    {s < 4 && (
                                        <div
                                            className={`flex-1 h-1 mx-2 transition ${step > s ? "bg-green-600" : "bg-slate-200 dark:bg-slate-700"
                                                }`}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                            <span>Basic Info</span>
                            <span>Details</span>
                            <span>Images</span>
                            <span>Documents</span>
                        </div>
                    </div>
                )}

                {/* Form Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-xl">
                    {error && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Step 1: Basic Information */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Basic Information
                            </h2>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Listing Title *
                                </label>
                                <input
                                    type="text"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleInputChange}
                                    placeholder="e.g., 10 Hectares Fertile Farmland in Osun"
                                    className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Description *
                                </label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    rows={4}
                                    placeholder="Describe key features, crops grown, accessibility, etc."
                                    className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        State *
                                    </label>
                                    <select
                                        name="state"
                                        value={formData.state}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
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
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Local Government Area *
                                    </label>
                                    <input
                                        type="text"
                                        name="lga"
                                        value={formData.lga}
                                        onChange={handleInputChange}
                                        placeholder="Enter LGA"
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    Street Address
                                </label>
                                <input
                                    type="text"
                                    name="address"
                                    value={formData.address}
                                    onChange={handleInputChange}
                                    placeholder="Specific location or nearest landmark"
                                    className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Land Details */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Land Details
                            </h2>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Size (Hectares) *
                                    </label>
                                    <input
                                        type="number"
                                        name="size"
                                        value={formData.size}
                                        onChange={handleInputChange}
                                        placeholder="e.g., 10"
                                        min="0"
                                        step="0.01"
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Price (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        name="price"
                                        value={formData.price}
                                        onChange={handleInputChange}
                                        placeholder="e.g., 5000000"
                                        min="0"
                                        step="1000"
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Soil Type
                                    </label>
                                    <select
                                        name="soilType"
                                        value={formData.soilType}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
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
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        Water Source
                                    </label>
                                    <select
                                        name="waterSource"
                                        value={formData.waterSource}
                                        onChange={handleInputChange}
                                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600 outline-none"
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
                        </div>
                    )}

                    {/* Step 3: Images */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Upload Images *
                            </h2>

                            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center">
                                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="text-slate-600 dark:text-slate-400 mb-4">
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
                                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                                        Selected Images ({imageFiles.length}/5)
                                    </h3>
                                    <div className="space-y-2">
                                        {imageFiles.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg"
                                            >
                                                <CheckCircle className="w-5 h-5 text-green-600" />
                                                <span className="text-sm text-slate-900 dark:text-white">
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
                    {step === 4 && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Upload Documents (Optional)
                            </h2>

                            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center">
                                <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="text-slate-600 dark:text-slate-400 mb-2">
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
                                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                                        Selected Documents ({documentFiles.length}/3)
                                    </h3>
                                    <div className="space-y-2">
                                        {documentFiles.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                                            >
                                                <CheckCircle className="w-5 h-5 text-blue-600" />
                                                <span className="text-sm text-slate-900 dark:text-white">
                                                    {file.name}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 5: Success */}
                    {step === 5 && (
                        <div className="text-center py-8">
                            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-12 h-12 text-green-600" />
                            </div>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">
                                Listing Submitted!
                            </h2>
                            <p className="text-slate-600 dark:text-slate-400 mb-6">
                                Your land listing has been submitted for verification.
                                You'll be notified once it's approved.
                            </p>
                            <p className="text-sm text-slate-500">
                                Redirecting to land listings...
                            </p>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    {step < 5 && (
                        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={handleBack}
                                disabled={step === 1}
                                className="px-6 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
