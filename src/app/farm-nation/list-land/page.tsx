"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Map, MapPin, Upload, FileText, Video,
    ArrowLeft, Check, X, Plus
} from "lucide-react";
import Link from "next/link";

type LandCategory = "farmland" | "ranch" | "forest" | "mixed" | "orchard" | "aquaculture";

export default function ListLandPage() {
    const router = useRouter();
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
        setIsSubmitting(true);

        try {
            const submitData = new FormData();

            // Add form fields
            Object.entries(formData).forEach(([key, value]) => {
                submitData.append(key, String(value));
            });

            // Calculate total price
            const totalPrice = formData.size * formData.pricePerUnit;
            submitData.append("totalPrice", String(totalPrice));

            // Add images
            media.images.forEach((image, index) => {
                submitData.append(`image${index}`, image);
            });

            // Add video
            if (media.video) {
                submitData.append("video", media.video);
            }

            // Add documents
            if (documents.landTitle) submitData.append("landTitle", documents.landTitle);
            if (documents.surveyPlan) submitData.append("surveyPlan", documents.surveyPlan);
            if (documents.taxClearance) submitData.append("taxClearance", documents.taxClearance);

            const response = await fetch("/api/farm-nation/create-listing", {
                method: "POST",
                body: submitData,
            });

            const data = await response.json();

            if (data.success) {
                alert("Land listing created successfully! It will be reviewed by our team.");
                router.push("/farm-nation");
            } else {
                alert(data.message || "Failed to create listing");
            }
        } catch (error) {
            alert("An error occurred while creating the listing");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-5xl mx-auto px-4">
                <Link
                    href="/farm-nation"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Farm Nation
                </Link>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white">
                        <h1 className="text-3xl font-bold mb-2">List Your Land</h1>
                        <p className="text-green-100">
                            Create a listing for your agricultural land
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* Basic Information */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Map className="w-6 h-6" />
                                Land Information
                            </h2>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Land Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="e.g., 50 Acres Farmland in Kaduna"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Land Category *
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {landCategories.map((cat) => (
                                            <button
                                                key={cat.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, category: cat.value as LandCategory })}
                                                className={`p-4 border-2 rounded-lg transition-all text-left ${formData.category === cat.value
                                                        ? "border-green-600 bg-green-50 dark:bg-green-900/30"
                                                        : "border-slate-200 dark:border-slate-700 hover:border-green-400"
                                                    }`}
                                            >
                                                <div className="text-2xl mb-2">{cat.icon}</div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                    {cat.label}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        rows={5}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Describe the land, its features, soil type, water access, nearby infrastructure, etc."
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Location */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <MapPin className="w-6 h-6" />
                                Location & GPS Coordinates
                            </h2>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            State *
                                        </label>
                                        <select
                                            value={formData.state}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        >
                                            <option value="">Select State</option>
                                            {nigerianStates.map(state => (
                                                <option key={state} value={state}>{state}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            LGA *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.lga}
                                            onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            placeholder="Enter LGA"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Detailed Address *
                                    </label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={2}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Full address with landmarks"
                                        required
                                    />
                                </div>

                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
                                        GPS Coordinates (Optional but recommended)
                                    </p>
                                    <p className="text-xs text-blue-700 dark:text-blue-300 mb-4">
                                        Provide accurate GPS coordinates for better visibility on the map. Nigeria bounds: Lat 4° to 14°N, Long 3° to 15°E
                                    </p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">
                                                Latitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.latitude}
                                                onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="e.g., 9.0820"
                                                step="0.000001"
                                                min="4"
                                                max="14"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">
                                                Longitude
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.longitude}
                                                onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Size & Pricing
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Land Size *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.size}
                                        onChange={(e) => setFormData({ ...formData, size: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="0.1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        value={formData.unit}
                                        onChange={(e) => setFormData({ ...formData, unit: e.target.value as "acres" | "hectares" })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    >
                                        <option value="acres">Acres</option>
                                        <option value="hectares">Hectares</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Price per {formData.unit} (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.pricePerUnit}
                                        onChange={(e) => setFormData({ ...formData, pricePerUnit: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="1000"
                                        required
                                    />
                                </div>
                            </div>

                            {formData.size > 0 && formData.pricePerUnit > 0 && (
                                <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                    <p className="text-sm text-green-900 dark:text-green-100">
                                        <span className="font-semibold">Total Price: </span>
                                        ₦{(formData.size * formData.pricePerUnit).toLocaleString()}
                                    </p>
                                </div>
                            )}
                        </section>

                        {/* Documents */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <FileText className="w-6 h-6" />
                                Legal Documents
                            </h2>

                            <div className="space-y-6">
                                <FileUploadField
                                    label="Land Title Document"
                                    description="Certificate of Occupancy (C of O) or other proof of ownership"
                                    file={documents.landTitle}
                                    onChange={(file) => handleDocumentChange("landTitle", file)}
                                    required
                                />

                                <FileUploadField
                                    label="Survey Plan"
                                    description="Licensed surveyor's plan showing land boundaries"
                                    file={documents.surveyPlan}
                                    onChange={(file) => handleDocumentChange("surveyPlan", file)}
                                    required
                                />

                                <FileUploadField
                                    label="Tax Clearance Certificate (Optional)"
                                    description="Recent land tax payment receipt or clearance"
                                    file={documents.taxClearance}
                                    onChange={(file) => handleDocumentChange("taxClearance", file)}
                                />
                            </div>
                        </section>

                        {/* Media */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Video className="w-6 h-6" />
                                Photos & Video
                            </h2>

                            <div className="space-y-6">
                                {/* Images */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Land Photos (Max 8) *
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                                        {media.images.length > 0 ? (
                                            <div className="grid grid-cols-4 gap-4 mb-4">
                                                {media.images.map((img, index) => (
                                                    <div key={index} className="relative">
                                                        <img
                                                            src={URL.createObjectURL(img)}
                                                            alt={`Land ${index + 1}`}
                                                            className="w-full h-24 object-cover rounded-lg"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeImage(index)}
                                                            className="absolute top-1 right-1 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full"
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
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
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

                                {/* Video */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Land Walkthrough Video (Optional)
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                                        {media.video ? (
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <Video className="w-8 h-8 text-green-600" />
                                                    <div>
                                                        <p className="font-semibold text-slate-900 dark:text-white">{media.video.name}</p>
                                                        <p className="text-sm text-slate-500">{(media.video.size / 1024 / 1024).toFixed(2)} MB</p>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setMedia(prev => ({ ...prev, video: null }))}
                                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                >
                                                    <X className="w-5 h-5 text-red-600" />
                                                </button>
                                            </div>
                                        ) : (
                                            <label className="flex flex-col items-center cursor-pointer">
                                                <Video className="w-12 h-12 text-slate-400 mb-3" />
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                                                    Click to upload video
                                                </p>
                                                <p className="text-xs text-slate-500">MP4, MOV (max 50MB)</p>
                                                <input
                                                    type="file"
                                                    accept="video/*"
                                                    onChange={handleVideoSelect}
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
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Availability Options
                            </h2>

                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="forSale"
                                        checked={formData.availableForSale}
                                        onChange={(e) => setFormData({ ...formData, availableForSale: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="forSale" className="text-sm font-semibold text-slate-900 dark:text-white">
                                        Available for Sale
                                    </label>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="forRent"
                                        checked={formData.availableForRent}
                                        onChange={(e) => setFormData({ ...formData, availableForRent: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="forRent" className="text-sm font-semibold text-slate-900 dark:text-white">
                                        Available for Rent/Lease
                                    </label>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="escrow"
                                        checked={formData.escrowAvailable}
                                        onChange={(e) => setFormData({ ...formData, escrowAvailable: e.target.checked })}
                                        className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                    />
                                    <label htmlFor="escrow" className="text-sm font-semibold text-slate-900 dark:text-white">
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
                                        Submitting for Review...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-5 h-5" />
                                        Submit Land Listing
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <p className="text-sm text-yellow-900 dark:text-yellow-100">
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
    required
}: {
    label: string;
    description: string;
    file: File | null;
    onChange: (file: File | null) => void;
    required?: boolean;
}) {
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0] || null;
        onChange(selectedFile);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                {label} {required && "*"}
            </label>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{description}</p>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                {file ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-green-600" />
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">{file.name}</p>
                                <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-red-600" />
                        </button>
                    </div>
                ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                        <Upload className="w-12 h-12 text-slate-400 mb-3" />
                        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
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
