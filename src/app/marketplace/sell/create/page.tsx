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
import { useStorage } from "@/hooks/use-storage";

const initialState = { success: false as const, error: "", data: null };

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

const CATEGORY_TITLES: Record<string, string[]> = {
    grains: ["White Maize", "Yellow Maize", "Sorghum", "Millet", "Local Rice", "Foreign Rice", "Wheat", "Soybeans"],
    cereal: ["White Maize", "Yellow Maize", "Sorghum", "Millet", "Local Rice", "Foreign Rice", "Wheat", "Soybeans"],
    tuber: ["Yam", "Cassava", "Sweet Potato", "Irish Potato", "Coco Yam", "Ginger"],
    root: ["Yam", "Cassava", "Sweet Potato", "Irish Potato", "Coco Yam", "Ginger"],
    fruit: ["Mango", "Orange", "Pineapple", "Banana", "Plantain", "Watermelon", "Pawpaw", "Lemon", "Lime"],
    vegetable: ["Tomatoes", "Pepper (Rodo)", "Pepper (Tatashe)", "Onions", "Cabbage", "Carrot", "Pumpkin Leaves (Ugu)", "Spinach"],
    spice: ["Garlic", "Ginger", "Turmeric", "Chili Pepper", "Clove", "Nutmeg"],
    herb: ["Garlic", "Ginger", "Turmeric", "Chili Pepper", "Clove", "Nutmeg"],
    seasoning: ["Garlic", "Ginger", "Turmeric", "Chili Pepper", "Clove", "Nutmeg"],
    nut: ["Groundnuts", "Cashew Nuts", "Sesame Seeds", "Melon Seeds (Egusi)", "Palm Kernel"],
    seed: ["Groundnuts", "Cashew Nuts", "Sesame Seeds", "Melon Seeds (Egusi)", "Palm Kernel"],
    processed: ["Garri (White)", "Garri (Yellow)", "Elubo (Yam Flour)", "Palm Oil", "Groundnut Oil", "Bean Flour"],
    livestock: ["Live Goat", "Live Sheep", "Live Ram", "Live Cow", "Pork", "Beef"],
    poultry: ["Day Old Chicks", "Broilers", "Cockerels", "Layers", "Chicken Eggs", "Turkey"],
    fishery: ["Catfish", "Tilapia", "Mackerel", "Dried Fish", "Crayfish"],
    sea_food: ["Catfish", "Tilapia", "Mackerel", "Dried Fish", "Crayfish"],
    beverage: ["Cocoa Powder", "Tea Leaves", "Coffee Beans", "Fruit Juice"],
    dairy: ["Fresh Milk", "Local Cheese (Wara)", "Yogurt", "Butter"],
};

const PRODUCT_UNITS = [
    "Kwanu",
    "mudu/darica",
    "basket(small)",
    "basket(medium)",
    "basket(big)",
    "small painter bucket",
    "big painter bucket",
    "small carton",
    "big carton",
    "other units"
];

function getTitleOptions(categoryValue: string): string[] {
    const norm = (categoryValue || "").toLowerCase();
    for (const key of Object.keys(CATEGORY_TITLES)) {
        if (norm.includes(key)) {
            return CATEGORY_TITLES[key];
        }
    }
    return [];
}

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

    const [category, setCategory] = useState("");
    const [title, setTitle] = useState("");
    const [customTitle, setCustomTitle] = useState("");
    const [unit, setUnit] = useState("");
    const [customUnit, setCustomUnit] = useState("");

    const titleOptions = getTitleOptions(category);
    const hasCategoryTitles = titleOptions.length > 0;
    const titleSelectValue = !title ? "" : (titleOptions.includes(title) ? title : "Other");
    const unitSelectValue = !unit ? "" : (PRODUCT_UNITS.includes(unit) ? unit : "other units");
    const { uploadFile, uploadState } = useStorage();
    const [isUploadingClient, setIsUploadingClient] = useState(false);

    const submitting = isPending || isUploadingClient;

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

    async function handleSubmit(formData: FormData) {
        setIsUploadingClient(true);
        try {
            // Upload to Cloudinary client-side in parallel
            const uploadedUrls = await Promise.all(
                selectedFiles.map(async (file) => {
                    const url = await uploadFile(file, `products/marketplace/${Date.now()}_${file.name}`);
                    return { name: file.name, url };
                })
            );

            // Reconstruct a new FormData object
            const submitFormData = new FormData();
            
            // Append original non-file items
            for (const [key, value] of formData.entries()) {
                if (key.startsWith("productImages_")) continue;
                submitFormData.append(key, value);
            }

            // Append pre-uploaded URLs under keys starting with 'productImages_'
            uploadedUrls.forEach(({ url }, index) => {
                submitFormData.append(`productImages_${index}`, url);
            });

            formAction(submitFormData);
        } catch (error) {
            console.error("Client upload failed:", error);
            showToast("Failed to upload product images to Cloudinary.", "error");
        } finally {
            setIsUploadingClient(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8 relative">
            {isUploadingClient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6 text-center">
                        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-slate-900">Uploading Product Images</h3>
                            <p className="text-sm text-slate-500">Please wait while we secure and upload your photos to Cloudinary.</p>
                        </div>
                        <div className="space-y-4 text-left p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                            {selectedFiles.map((file) => {
                                const state = uploadState[file.name];
                                const progress = state?.progress ?? 0;
                                const error = state?.error ?? null;
                                return (
                                    <div key={file.name} className="space-y-1.5">
                                        <div className="flex justify-between text-xs font-semibold text-slate-700">
                                            <span className="truncate max-w-[200px] flex items-center gap-1">
                                                🖼️ {file.name}
                                            </span>
                                            <span className={error ? "text-red-600" : "text-green-600"}>
                                                {error ? "Failed" : progress === 100 ? "Completed" : `${Math.round(progress)}%`}
                                            </span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
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
                </div>
            )}
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
                                {hasCategoryTitles ? (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Product Title Option *
                                            </label>
                                            <select
                                                value={titleSelectValue}
                                                name={titleSelectValue !== "Other" ? "title" : undefined}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setTitle(val);
                                                    if (val !== "Other") {
                                                        setCustomTitle("");
                                                    }
                                                }}
                                                className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary outline-none"
                                                required
                                            >
                                                <option value="">Select Option</option>
                                                {titleOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        {titleSelectValue === "Other" && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Custom Product Title *
                                                </label>
                                                <input
                                                    type="text"
                                                    name="title"
                                                    value={customTitle}
                                                    onChange={(e) => setCustomTitle(e.target.value)}
                                                    required
                                                    placeholder="e.g., Premium Yellow Maize"
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Product Title *
                                        </label>
                                        <input
                                            type="text"
                                            name="title"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            required
                                            placeholder="e.g., Fresh Organic Tomatoes"
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary outline-none"
                                        />
                                    </div>
                                )}
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
                                        value={category}
                                        onChange={(e) => {
                                            setCategory(e.target.value);
                                            setTitle("");
                                            setCustomTitle("");
                                        }}
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
                                        value={unitSelectValue}
                                        name={unitSelectValue !== "other units" ? "unit" : undefined}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setUnit(val);
                                            if (val !== "other units") {
                                                setCustomUnit("");
                                            }
                                        }}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary outline-none"
                                        required
                                    >
                                        <option value="">Select Unit</option>
                                        {PRODUCT_UNITS.map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                    {unitSelectValue === "other units" && (
                                        <input
                                            type="text"
                                            name="unit"
                                            value={customUnit}
                                            onChange={(e) => setCustomUnit(e.target.value)}
                                            required
                                            placeholder="Enter custom unit"
                                            className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary outline-none"
                                        />
                                    )}
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
                                        type="text"
                                        inputMode="decimal"
                                        pattern="[0-9.,]*"
                                        name="retailPrice"
                                        required
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
                                            type="text"
                                            inputMode="decimal"
                                            pattern="[0-9.,]*"
                                            name="bulkPrice"
                                            placeholder="Bulk Price (₦)"
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
                                            type="text"
                                            inputMode="decimal"
                                            pattern="[0-9.,]*"
                                            name="exportPrice"
                                            placeholder="Export Price (₦)"
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
                            disabled={submitting}
                            className="flex-1 px-6 py-4 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    {isUploadingClient ? "Uploading Assets..." : "Creating..."}
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
