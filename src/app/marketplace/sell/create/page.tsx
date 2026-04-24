"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Package,
    Image as ImageIcon,
    DollarSign,
    MapPin,
    Truck,
    Upload,
    X,
    Plus,
    AlertCircle,
    CheckCircle,
    Loader2
} from "lucide-react";
import { createProductAction } from "@/app/actions/marketplace";
import Image from "next/image";
import { useToast } from "@/contexts/ToastContext";

const initialState = { success: false };

const productCategories = [
    // New categories
    { value: "poultry", label: "Poultry" },
    { value: "sea_foods", label: "Sea Foods" },
    { value: "horticultural", label: "Horticultural" },
    { value: "natural_oils", label: "Natural Oils" },
    { value: "spices_herbs_seasonings", label: "Spices, Herbs & Seasonings" },
    { value: "beverages", label: "Beverages" },
    { value: "dairy", label: "Dairy" },
    { value: "organics", label: "Organics" },
    { value: "gmos", label: "GMOs" },
    { value: "health_wellness", label: "Health & Wellness" },
    // Original categories
    { value: "grains", label: "Grains & Cereals" },
    { value: "vegetables", label: "Vegetables" },
    { value: "fruits", label: "Fruits" },
    { value: "livestock", label: "Livestock" },
    { value: "fishery", label: "Fishery" },
    { value: "processed", label: "Processed Foods" },
    { value: "equipment", label: "Farm Equipment" },
    { value: "other", label: "Other" },
];

const units = ["kg", "bags", "tonnes", "pieces", "crates", "litres"];

const nigerianStates = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara"
];

export default function CreateProductPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const { showToast } = useToast();
    const [state, formAction, isPending] = useActionState(createProductAction, initialState);

    const [images, setImages] = useState<string[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [enableBulkPricing, setEnableBulkPricing] = useState(false);
    const [enableExportPricing, setEnableExportPricing] = useState(false);

    useEffect(() => {
        if (state.success) {
            showToast("Product created successfully!", "success");
            setTimeout(() => router.push("/marketplace/sell"), 2000);
        } else if ((state as { error?: string }).error) {
            showToast((state as { error?: string }).error!, "error");
        }
    }, [state, showToast, router]);

    function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files;
        if (!files) return;

        const newFiles = Array.from(files);
        const newPreviewUrls = newFiles.map(file => URL.createObjectURL(file));

        setSelectedFiles(prev => [...prev, ...newFiles].slice(0, 5));
        setImages(prev => [...prev, ...newPreviewUrls].slice(0, 5));
    };

    const removeImage = (index: number) => {
        setImages(images.filter((_, i) => i !== index));
        setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
    };

    function handleSubmit(formData: FormData) {
        // Append files manually
        selectedFiles.forEach((file, index) => {
            formData.append(`productImages_${index}`, file);
        });
        formAction(formData);
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header */}
                <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 rounded-xl bg-primary/10">
                            <Package className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">
                                Create Product Listing
                            </h1>
                            <p className="text-gray-600">
                                List your products and reach thousands of buyers
                            </p>
                        </div>
                    </div>
                </div>

                {/* Product Form */}
                <form action={handleSubmit} className="space-y-6">
                    {/* Basic Information */}
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">
                            Basic Information
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Product Title *
                                </label>
                                <input
                                    type="text"
                                    name="title"
                                    required
                                    placeholder="e.g., Fresh Organic Tomatoes"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Description *
                                </label>
                                <textarea
                                    name="description"
                                    required
                                    rows={4}
                                    placeholder="Describe your product, quality, origin, etc."
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Category *
                                    </label>
                                    <select
                                        name="category"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="">Select Category</option>
                                        {productCategories.map(cat => (
                                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        name="unit"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="">Select Unit</option>
                                        {units.map(unit => (
                                            <option key={unit} value={unit}>{unit}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Product Images */}
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <ImageIcon className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900">
                                Product Images
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative group">
                                    <div className="relative w-full h-32 rounded-xl overflow-hidden">
                                        <Image
                                            src={img}
                                            alt={`Product ${idx + 1}`}
                                            fill
                                            sizes="200px"
                                            className="object-cover"
                                            unoptimized
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeImage(idx)}
                                        className="absolute top-2 right-2 p-1 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}

                            {images.length < 5 && (
                                <label className="w-full h-32 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary transition">
                                    <Upload className="w-6 h-6 text-gray-400 mb-2" />
                                    <span className="text-sm text-gray-500">Upload</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleImageUpload}
                                        className="hidden"
                                    />
                                </label>
                            )}
                        </div>

                        <p className="text-sm text-gray-500">Upload up to 5 images</p>
                    </div>

                    {/* Pricing */}
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <DollarSign className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900">
                                Pricing & Inventory
                            </h2>
                        </div>

                        <div className="space-y-4">
                            {/* Retail Price */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Retail Price (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        name="retailPrice"
                                        required
                                        min="0"
                                        step="0.01"
                                        placeholder="1000"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Available Quantity *
                                    </label>
                                    <input
                                        type="number"
                                        name="availableQuantity"
                                        required
                                        min="1"
                                        placeholder="100"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Minimum Order Quantity *
                                </label>
                                <input
                                    type="number"
                                    name="minimumOrderQuantity"
                                    required
                                    min="1"
                                    defaultValue="1"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                />
                            </div>

                            {/* Bulk Pricing */}
                            <div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableBulkPricing}
                                        onChange={(e) => setEnableBulkPricing(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm font-medium text-gray-700">
                                        Enable Bulk Pricing
                                    </span>
                                </label>
                                {enableBulkPricing && (
                                    <div className="grid grid-cols-2 gap-4 mt-3">
                                        <input
                                            type="number"
                                            name="bulkPrice"
                                            placeholder="Bulk Price (₦)"
                                            min="0"
                                            step="0.01"
                                            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-900"
                                        />
                                        <input
                                            type="number"
                                            name="bulkMinQuantity"
                                            placeholder="Min Qty for Bulk"
                                            min="1"
                                            defaultValue="50"
                                            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-900"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Export Pricing */}
                            <div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableExportPricing}
                                        onChange={(e) => setEnableExportPricing(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm font-medium text-gray-700">
                                        Enable Export Pricing
                                    </span>
                                </label>
                                {enableExportPricing && (
                                    <div className="grid grid-cols-2 gap-4 mt-3">
                                        <input
                                            type="number"
                                            name="exportPrice"
                                            placeholder="Export Price (₦)"
                                            min="0"
                                            step="0.01"
                                            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-900"
                                        />
                                        <input
                                            type="number"
                                            name="exportMinQuantity"
                                            placeholder="Min Qty for Export"
                                            min="1"
                                            defaultValue="100"
                                            className="px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-900"
                                        />
                                    </div>
                                )}
                            </div>

                            <input type="hidden" name="bulkAvailable" value={enableBulkPricing ? "true" : "false"} />
                            <input type="hidden" name="exportReady" value={enableExportPricing ? "true" : "false"} />
                        </div>
                    </div>

                    {/* Location & Delivery */}
                    <div className="bg-white rounded-2xl shadow-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <MapPin className="w-5 h-5 text-primary" />
                            <h2 className="text-xl font-semibold text-gray-900">
                                Location & Delivery
                            </h2>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        State *
                                    </label>
                                    <select
                                        name="state"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="">Select State</option>
                                        {nigerianStates.map(state => (
                                            <option key={state} value={state}>{state}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        LGA *
                                    </label>
                                    <input
                                        type="text"
                                        name="lga"
                                        required
                                        placeholder="e.g., Ikeja"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Delivery Method *
                                    </label>
                                    <select
                                        name="deliveryMethod"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="both">Pickup & Delivery</option>
                                        <option value="pickup">Pickup Only</option>
                                        <option value="delivery">Delivery Only</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Est. Delivery Days
                                    </label>
                                    <input
                                        type="number"
                                        name="estimatedDeliveryDays"
                                        min="1"
                                        placeholder="3-5 days"
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="flex-1 px-6 py-4 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="flex-1 px-6 py-4 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <Plus className="w-5 h-5" />
                                    Create Listing
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
