"use client";

import { useState } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    Map, MapPin, Upload, FileText, Video,
    ArrowLeft, Check, X, Plus, Loader2
} from "lucide-react";
import Link from "next/link";
import { useStorage } from "@/hooks/use-storage";
import { submitLandListingAction } from "@/app/actions/land-listings";
import { useToast } from "@/contexts/ToastContext";

type LandCategory = "farmland" | "ranch" | "forest" | "mixed" | "orchard" | "aquaculture";

export default function ListLandPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const { uploadFile, uploadState } = useStorage();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        title: "",
        category: "" as LandCategory | "",
        description: "",
        state: "",
        lga: "",
        address: "",
        size: 0,
        unit: "acres" as "acres" | "hectares",
        pricePerUnit: 0,
        latitude: "",
        longitude: "",
        availableForSale: true,
        availableForRent: false,
        escrowAvailable: true,
    });

    const [media, setMedia] = useState({
        images: [] as File[],
        video: null as File | null,
    });

    const [documents, setDocuments] = useState({
        landTitle: null as File | null,
        surveyPlan: null as File | null,
        taxClearance: null as File | null,
    });

    const landCategories = [
        { value: "farmland", label: "Farmland (Crop Cultivation)", icon: "🌾" },
        { value: "ranch", label: "Ranch/Pasture (Livestock)", icon: "🐄" },
        { value: "forest", label: "Forest Land (Timber/Conservation)", icon: "🌲" },
        { value: "mixed", label: "Mixed-Use Agricultural", icon: "🌻" },
        { value: "orchard", label: "Orchard/Plantation", icon: "🍊" },
        { value: "aquaculture", label: "Aquaculture/Fish Farm", icon: "🐟" }
    ];

    const nigerianStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
        "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
        "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
    ];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setMedia(prev => ({ ...prev, images: [...prev.images, ...files].slice(0, 8) }));
    };

    const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setMedia(prev => ({ ...prev, video: file }));
    };

    const handleDocumentChange = (field: keyof typeof documents, file: File | null) => {
        setDocuments(prev => ({ ...prev, [field]: file }));
    };

    const removeImage = (index: number) => {
        setMedia(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!session?.user) {
            showToast("Authentication Required: Please login to list your land.", "error");
            router.push("/auth/login?callbackUrl=/farm-nation/list-land");
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. Upload Images
            // Use Promise.all for parallel uploads to prevent hanging
            const imageUploadPromises = media.images.map(image => {
                const path = `farm-nation/${session.user.id}/images/${Date.now()}_${image.name}`;
                return uploadFile(image, path);
            });

            const imageUrls = await Promise.all(imageUploadPromises);

            // 2. Upload Documents
            const documentUrls: string[] = [];

            // Upload documents in parallel if they exist
            const docUploads = [];

            if (documents.landTitle) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_title_${documents.landTitle.name}`;
                docUploads.push(uploadFile(documents.landTitle, path));
            } else {
                docUploads.push(Promise.resolve(null)); // Placeholder
            }

            if (documents.surveyPlan) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_survey_${documents.surveyPlan.name}`;
                docUploads.push(uploadFile(documents.surveyPlan, path));
            } else {
                docUploads.push(Promise.resolve(null)); // Placeholder
            }

            if (documents.taxClearance) {
                const path = `farm-nation/${session.user.id}/docs/${Date.now()}_tax_${documents.taxClearance.name}`;
                docUploads.push(uploadFile(documents.taxClearance, path));
            }

            const uploadedDocs = await Promise.all(docUploads);

            // Filter out nulls and push to documentUrls
            // Note: The original code pushed to documentUrls sequentially. 
            // We need to maintain that logic if the backend expects specific order, 
            // but the original code just pushed them.
            uploadedDocs.forEach(url => {
                if (url) documentUrls.push(url);
            });

            // 3. Submit Data
            const result = await submitLandListingAction({
                ownerId: session.user.id,
                ownerName: session.user.name || "Land Owner",
                ownerEmail: session.user.email || "",
                title: formData.title,
                description: formData.description,
                location: {
                    state: formData.state,
                    lga: formData.lga,
                    address: formData.address,
                },
                size: formData.size,
                price: formData.size * formData.pricePerUnit,
                category: formData.category, // Added category
                imageUrls,
                documentUrls,
                gpsCoordinates: formData.latitude && formData.longitude ? {
                    latitude: parseFloat(formData.latitude),
                    longitude: parseFloat(formData.longitude)
                } : undefined,
                availableForSale: formData.availableForSale,
                availableForRent: formData.availableForRent,
                escrowAvailable: formData.escrowAvailable,
            } as any); // Type cast due to minor discrepancies in action signature vs local state

            if (result.success) {
                showToast("Land Listing Submitted! Your listing has been submitted for verification.", "success");
                router.push("/farm-nation");
            } else {
                showToast(`Submission Failed: ${result.error || "Failed to create listing"}`, "error");
            }
        } catch (error: any) {
            logger.error("Error:", error);
            showToast("Error: " + error.message, "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-5xl mx-auto px-4">
                <Link
                    href="/farm-nation"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Farm Nation
                </Link>

                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">List Your Land</h1>
                            <p className="text-green-100">
                                Create a listing for your agricultural land
                            </p>
                        </div>
                        <Link
                            href="/farm-nation/inquiries"
                            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white font-semibold transition backdrop-blur-sm"
                        >
                            View Inquiries
                        </Link>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* Basic Information */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Map className="w-6 h-6" />
                                Land Information
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="e.g., 50 Acres Farmland in Kaduna"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Category *
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {landCategories.map((cat) => (
                                            <button
                                                key={cat.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, category: cat.value as LandCategory })}
                                                className={`p-4 border-2 rounded-lg transition-all text-left ${formData.category === cat.value
                                                    ? "border-green-600 bg-green-50"
                                                    : "border-slate-200 hover:border-green-400"
                                                    }`}
                                            >
                                                <div className="text-2xl mb-2">{cat.icon}</div>
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {cat.label}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        rows={5}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Describe the land, its features, soil type, water access, nearby infrastructure, etc."
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Location */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <MapPin className="w-6 h-6" />
                                Location & GPS Coordinates
                            </h2>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            State *
                                        </label>
                                        <select
                                            value={formData.state}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        >
                                            <option value="">Select State</option>
                                            {nigerianStates.map(state => (
                                                <option key={state} value={state}>{state}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            LGA *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.lga}
                                            onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                            placeholder="Enter LGA"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Detailed Address *
                                    </label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={2}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Full address with landmarks"
                                        required
                                    />
                                </div>

                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <p className="text-sm font-semibold text-blue-900 mb-3">
                                        GPS Coordinates (Optional but recommended)
                                    </p>
                                    <p className="text-xs text-blue-700 mb-4">
                                        Provide accurate GPS coordinates for better visibility on the map. Nigeria bounds: Lat 4° to 14°N, Long 3° to 15°E
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 mb-1">
                                                Latitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.latitude}
                                                onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="e.g., 9.0820"
                                                step="0.000001"
                                                min="4"
                                                max="14"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 mb-1">
                                                Longitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.longitude}
                                                onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="e.g., 8.6753"
                                                step="0.000001"
                                                min="3"
                                                max="15"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Size & Pricing */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Size & Pricing
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Size *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.size}
                                        onChange={(e) => setFormData({ ...formData, size: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="0.1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        value={formData.unit}
                                        onChange={(e) => setFormData({ ...formData, unit: e.target.value as "acres" | "hectares" })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    >
                                        <option value="acres">Acres</option>
                                        <option value="hectares">Hectares</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Price per {formData.unit} (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.pricePerUnit}
                                        onChange={(e) => setFormData({ ...formData, pricePerUnit: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="1000"
                                        required
                                    />
                                </div>
                            </div>

                            {formData.size > 0 && formData.pricePerUnit > 0 && (
                                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                                    <p className="text-sm text-green-900">
                                        <span className="font-semibold">Total Price: </span>
                                        ₦{(formData.size * formData.pricePerUnit).toLocaleString()}
                                    </p>
                                </div>
                            )}
                        </section>

                        {/* Documents */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <FileText className="w-6 h-6" />
                                Legal Documents
                            </h2>

                            <div className="space-y-6">
                                <FileUploadField
                                    label="Land Title Document"
                                    description="Certificate of Occupancy (C of O) or other proof of ownership"
                                    file={documents.landTitle}
                                    onChange={(file) => handleDocumentChange("landTitle", file)}
                                    // Pass upload state if file exists
                                    uploadState={documents.landTitle ? uploadState[documents.landTitle.name] : undefined}
                                    required
                                />

                                <FileUploadField
                                    label="Survey Plan"
                                    description="Licensed surveyor's plan showing land boundaries"
                                    file={documents.surveyPlan}
                                    onChange={(file) => handleDocumentChange("surveyPlan", file)}
                                    uploadState={documents.surveyPlan ? uploadState[documents.surveyPlan.name] : undefined}
                                    required
                                />

                                <FileUploadField
                                    label="Tax Clearance Certificate (Optional)"
                                    description="Recent land tax payment receipt or clearance"
                                    file={documents.taxClearance}
                                    onChange={(file) => handleDocumentChange("taxClearance", file)}
                                    uploadState={documents.taxClearance ? uploadState[documents.taxClearance.name] : undefined}
                                />
                            </div>
                        </section>

                        {/* Media */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <Video className="w-6 h-6" />
                                Photos & Video
                            </h2>

                            <div className="space-y-6">
                                {/* Images */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Land Photos (Max 8) *
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6">
                                        {media.images.length > 0 ? (
                                            <div className="grid grid-cols-4 gap-4 mb-4">
                                                {media.images.map((img, index) => (
                                                    <div key={index} className="relative group">
                                                        {/* Show Progress Overlay */}
                                                        {uploadState[img.name]?.isUploading && (
                                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg z-10">
                                                                <div className="text-white text-xs font-bold">
                                                                    {Math.round(uploadState[img.name].progress)}%
                                                                </div>
                                                            </div>
                                                        )}
                                                        <img
                                                            src={URL.createObjectURL(img)}
                                                            alt={`Land ${index + 1}`}
                                                            className="w-full h-24 object-cover rounded-lg"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeImage(index)}
                                                            className="absolute top-1 right-1 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}

                                        {media.images.length < 8 && (
                                            <label className="flex flex-col items-center cursor-pointer">
                                                <Upload className="w-12 h-12 text-slate-400 mb-3" />
                                                <p className="text-sm font-semibold text-slate-900 mb-1">
                                                    Click to upload photos
                                                </p>
                                                <p className="text-xs text-slate-500">JPG, PNG (max 5MB each)</p>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    onChange={handleImageSelect}
                                                    className="hidden"
                                                />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Availability Options */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Availability Options
                            </h2>

                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="forSale"
                                        checked={formData.availableForSale}
                                        onChange={(e) => setFormData({ ...formData, availableForSale: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="forSale" className="text-sm font-semibold text-slate-900">
                                        Available for Sale
                                    </label>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="forRent"
                                        checked={formData.availableForRent}
                                        onChange={(e) => setFormData({ ...formData, availableForRent: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="forRent" className="text-sm font-semibold text-slate-900">
                                        Available for Rent/Lease
                                    </label>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="escrow"
                                        checked={formData.escrowAvailable}
                                        onChange={(e) => setFormData({ ...formData, escrowAvailable: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="escrow" className="text-sm font-semibold text-slate-900">
                                        Enable Escrow Protection (Recommended)
                                    </label>
                                </div>
                            </div>
                        </section>

                        {/* Submit Button */}
                        <div className="flex gap-4 pt-4">
                            <button
                                type="submit"
                                disabled={isSubmitting || media.images.length === 0 || !documents.landTitle || !documents.surveyPlan}
                                className="flex-1 px-8 py-4 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting Listing...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-5 h-5" />
                                        Submit Land Listing
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <p className="text-sm text-yellow-900">
                                ⚠️ Your listing will be reviewed by our team to verify the documents and land details before going live.
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

// Helper component for file uploads
function FileUploadField({
    label,
    description,
    file,
    onChange,
    required,
    uploadState
}: {
    label: string;
    description: string;
    file: File | null;
    onChange: (file: File | null) => void;
    required?: boolean;
    uploadState?: { progress: number; isUploading: boolean; error: string | null };
}) {
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0] || null;
        onChange(selectedFile);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
                {label} {required && "*"}
            </label>
            <p className="text-sm text-slate-600 mb-3">{description}</p>

            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 relative">
                {/* Upload Overlay */}
                {uploadState?.isUploading && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 flex-col">
                        <Loader2 className="w-6 h-6 animate-spin text-green-600 mb-2" />
                        <span className="text-sm font-bold text-green-800">Uploading {Math.round(uploadState.progress)}%</span>
                    </div>
                )}

                {file ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-green-600" />
                            <div>
                                <p className="font-semibold text-slate-900">{file.name}</p>
                                <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            disabled={uploadState?.isUploading}
                            className="p-2 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <X className="w-5 h-5 text-red-600" />
                        </button>
                    </div>
                ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                        <Upload className="w-12 h-12 text-slate-400 mb-3" />
                        <p className="text-sm font-semibold text-slate-900 mb-1">
                            Click to upload
                        </p>
                        <p className="text-xs text-slate-500">PDF, JPG, PNG (max 5MB)</p>
                        <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleFileSelect}
                            className="hidden"
                            required={required}
                        />
                    </label>
                )}
            </div>
        </div>
    );
}
