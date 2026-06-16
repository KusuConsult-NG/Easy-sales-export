"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import {
    Package,
    Image as ImageIcon,
    DollarSign,
    MapPin,
    Truck,
    Upload,
    X,
    AlertCircle,
    CheckCircle,
    Loader2,
    ArrowLeft,
    Save
} from "lucide-react";
import { getProductByIdAction, updateProductAction } from "@/app/actions/marketplace";
import Image from "next/image";
import { useToast } from "@/contexts/ToastContext";
import { useStorage } from "@/hooks/use-storage";
import type { Product } from "@/lib/types/marketplace";

const productCategories = [
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

export default function EditProductPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const { uploadFile, uploadState } = useStorage();

    const productId = params.id as string;

    // Loading & Detail State
    const [loadingProduct, setLoadingProduct] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [isUploadingClient, setIsUploadingClient] = useState(false);
    const [error, setError] = useState("");

    // Form fields state
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [unit, setUnit] = useState("");
    const [retailPrice, setRetailPrice] = useState<number>(0);
    const [availableQuantity, setAvailableQuantity] = useState<number>(0);
    const [minimumOrderQuantity, setMinimumOrderQuantity] = useState<number>(1);
    
    // Pricing tiers state
    const [enableBulkPricing, setEnableBulkPricing] = useState(false);
    const [bulkPrice, setBulkPrice] = useState<string>("");
    const [bulkMinQuantity, setBulkMinQuantity] = useState<number>(50);

    const [enableExportPricing, setEnableExportPricing] = useState(false);
    const [exportPrice, setExportPrice] = useState<string>("");
    const [exportMinQuantity, setExportMinQuantity] = useState<number>(100);

    // Location & delivery state
    const [state, setState] = useState("");
    const [lga, setLga] = useState("");
    const [nearestMarket, setNearestMarket] = useState("");
    const [deliveryMethod, setDeliveryMethod] = useState("both");
    const [estimatedDeliveryDays, setEstimatedDeliveryDays] = useState<string>("");
    const [videoUrl, setVideoUrl] = useState("");

    // Images State
    const [images, setImages] = useState<string[]>([]); // URLs of existing or new previews
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [fileNamesToUpload, setFileNamesToUpload] = useState<string[]>([]);

    useEffect(() => {
        async function fetchProduct() {
            if (!productId) return;
            try {
                const result = await getProductByIdAction(productId);
                if (result.success && result.data) {
                    const prod = result.data;
                    
                    // Pre-fill states
                    setTitle(prod.title);
                    setDescription(prod.description);
                    setCategory(prod.category);
                    setUnit(prod.unit);
                    setAvailableQuantity(prod.availableQuantity);
                    setMinimumOrderQuantity(prod.minimumOrderQuantity || 1);
                    setImages(prod.images || []);
                    setVideoUrl(prod.videoUrl || "");
                    
                    // Location
                    setState(prod.location?.state || "");
                    setLga(prod.location?.lga || "");
                    setNearestMarket(prod.location?.nearestMarket || "");
                    setDeliveryMethod(prod.deliveryMethod || "both");
                    setEstimatedDeliveryDays(prod.estimatedDeliveryDays?.toString() || "");

                    // Pricing Tiers
                    const retailTier = prod.pricingTiers?.find(t => t.type === "retail");
                    if (retailTier) setRetailPrice(retailTier.price);

                    const bulkTier = prod.pricingTiers?.find(t => t.type === "bulk");
                    if (bulkTier) {
                        setEnableBulkPricing(true);
                        setBulkPrice(bulkTier.price.toString());
                        setBulkMinQuantity(bulkTier.minQuantity);
                    }

                    const exportTier = prod.pricingTiers?.find(t => t.type === "export");
                    if (exportTier) {
                        setEnableExportPricing(true);
                        setExportPrice(exportTier.price.toString());
                        setExportMinQuantity(exportTier.minQuantity);
                    }
                } else {
                    setError(result.error || "Failed to fetch product details");
                }
            } catch (err) {
                setError("An error occurred while loading the product.");
            } finally {
                setLoadingProduct(false);
            }
        }

        fetchProduct();
    }, [productId]);

    function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files;
        if (!files) return;

        const newFiles = Array.from(files);
        const newPreviewUrls = newFiles.map(file => URL.createObjectURL(file));

        const totalImagesCount = images.length + newFiles.length;
        if (totalImagesCount > 5) {
            showToast("You can upload a maximum of 5 images.", "error");
            return;
        }

        setSelectedFiles(prev => [...prev, ...newFiles]);
        setImages(prev => [...prev, ...newPreviewUrls]);
        setFileNamesToUpload(prev => [...prev, ...newFiles.map(f => f.name)]);
    }

    const removeImage = (index: number) => {
        const imageToRemove = images[index];
        setImages(images.filter((_, i) => i !== index));

        // If this image was a local file preview, we must find it and remove from selectedFiles
        if (imageToRemove.startsWith("blob:")) {
            // Find which file is associated with this preview
            const fileIndex = selectedFiles.findIndex(file => URL.createObjectURL(file) === imageToRemove || file.name === fileNamesToUpload[index - (images.length - selectedFiles.length)]);
            if (fileIndex > -1) {
                setSelectedFiles(selectedFiles.filter((_, i) => i !== fileIndex));
                setFileNamesToUpload(fileNamesToUpload.filter((_, i) => i !== fileIndex));
            }
        }
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setIsUploadingClient(true);

        try {
            // 1. Upload new files to Cloudinary in parallel
            const uploadedUrls = await Promise.all(
                selectedFiles.map(async (file) => {
                    const url = await uploadFile(file, `products/marketplace/${Date.now()}_${file.name}`);
                    return url;
                })
            );

            // 2. Filter images list to only keep existing Cloudinary URLs
            const existingCloudinaryUrls = images.filter(img => !img.startsWith("blob:"));

            // 3. Combine existing URLs and new uploaded URLs
            const finalImageUrls = [...existingCloudinaryUrls, ...uploadedUrls];

            // 4. Construct FormData
            const submitFormData = new FormData();
            submitFormData.append("productId", productId);
            submitFormData.append("title", title);
            submitFormData.append("description", description);
            submitFormData.append("category", category);
            submitFormData.append("unit", unit);
            submitFormData.append("retailPrice", retailPrice.toString());
            submitFormData.append("availableQuantity", availableQuantity.toString());
            submitFormData.append("minimumOrderQuantity", minimumOrderQuantity.toString());
            
            submitFormData.append("bulkAvailable", enableBulkPricing ? "true" : "false");
            if (enableBulkPricing && bulkPrice) {
                submitFormData.append("bulkPrice", bulkPrice);
                submitFormData.append("bulkMinQuantity", bulkMinQuantity.toString());
            }

            submitFormData.append("exportReady", enableExportPricing ? "true" : "false");
            if (enableExportPricing && exportPrice) {
                submitFormData.append("exportPrice", exportPrice);
                submitFormData.append("exportMinQuantity", exportMinQuantity.toString());
            }

            submitFormData.append("state", state);
            submitFormData.append("lga", lga);
            submitFormData.append("nearestMarket", nearestMarket);
            submitFormData.append("deliveryMethod", deliveryMethod);
            if (estimatedDeliveryDays) {
                submitFormData.append("estimatedDeliveryDays", estimatedDeliveryDays);
            }
            submitFormData.append("videoUrl", videoUrl);

            // Append images
            finalImageUrls.forEach((url, idx) => {
                submitFormData.append(`productImages_${idx}`, url);
            });

            // 5. Trigger the server action
            const result = await updateProductAction(null, submitFormData);
            if (result.success) {
                showToast("Product updated successfully!", "success");
                router.push("/marketplace/seller/products");
            } else {
                showToast(result.error || "Failed to update product", "error");
            }
        } catch (err) {
            console.error("Update error:", err);
            showToast("An error occurred during updating product.", "error");
        } finally {
            setIsUploadingClient(false);
            setSubmitting(false);
        }
    }

    if (loadingProduct) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-violet-600" />
            </div>
        );
    }

    if (error || !title) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Error Loading Product</h1>
                <p className="text-slate-600 mb-6">{error || "The product could not be loaded."}</p>
                <button
                    onClick={() => router.back()}
                    className="px-6 py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition"
                >
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 relative">
            {isUploadingClient && selectedFiles.length > 0 && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6 text-center">
                        <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                            <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-slate-900">Uploading New Images</h3>
                            <p className="text-sm text-slate-500">Please wait while we secure and upload your photos to Cloudinary.</p>
                        </div>
                        <div className="space-y-4 text-left p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                            {selectedFiles.map((file) => {
                                const state = uploadState[file.name];
                                const progress = state?.progress ?? 0;
                                const fileError = state?.error ?? null;
                                return (
                                    <div key={file.name} className="space-y-1.5">
                                        <div className="flex justify-between text-xs font-semibold text-slate-700">
                                            <span className="truncate max-w-[200px] flex items-center gap-1">
                                                🖼️ {file.name}
                                            </span>
                                            <span className={fileError ? "text-red-600" : "text-violet-600"}>
                                                {fileError ? "Failed" : progress === 100 ? "Completed" : `${Math.round(progress)}%`}
                                            </span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-300 ${fileError ? "bg-red-500" : "bg-violet-600"}`}
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                        {fileError && <p className="text-[10px] text-red-500 font-medium">{fileError}</p>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-4xl mx-auto px-4">
                {/* Back Link & Header */}
                <div className="bg-white rounded-2xl shadow-md p-8 mb-6 border border-slate-100">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-slate-600 hover:text-violet-700 font-semibold mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Products
                    </button>
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-violet-50 border border-violet-100">
                            <Package className="w-8 h-8 text-violet-700" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">
                                Edit Product Listing
                            </h1>
                            <p className="text-slate-600">
                                Update details, pricing, and stock of your active product
                            </p>
                        </div>
                    </div>
                </div>

                {/* Product Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Basic Information */}
                    <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-100">
                        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-6 bg-violet-600 rounded-full inline-block"></span>
                            Basic Information
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Product Title *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g., Fresh Organic Tomatoes"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Description *
                                </label>
                                <textarea
                                    required
                                    rows={4}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Describe your product, quality, origin, etc."
                                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Category *
                                    </label>
                                    <select
                                        required
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    >
                                        <option value="">Select Category</option>
                                        {productCategories.map(cat => (
                                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        required
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    >
                                        <option value="">Select Unit</option>
                                        {units.map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Product Images */}
                    <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <ImageIcon className="w-5 h-5 text-violet-700" />
                            <h2 className="text-xl font-bold text-slate-900">
                                Product Images
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative group">
                                    <div className="relative w-full h-32 rounded-xl overflow-hidden border border-slate-200">
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
                                        className="absolute top-2 right-2 p-1.5 rounded-full bg-red-600 text-white shadow-md hover:bg-red-700 transition"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}

                            {images.length < 5 && (
                                <label className="w-full h-32 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50/50 transition">
                                    <Upload className="w-6 h-6 text-slate-400 mb-2" />
                                    <span className="text-sm font-semibold text-slate-500">Upload</span>
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

                        <p className="text-sm text-slate-500">Upload up to 5 images. You can manage existing images or add new ones.</p>
                    </div>

                    {/* Pricing */}
                    <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <DollarSign className="w-5 h-5 text-violet-700" />
                            <h2 className="text-xl font-bold text-slate-900">
                                Pricing & Inventory
                            </h2>
                        </div>

                        <div className="space-y-4">
                            {/* Retail Price */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Retail Price (₦) *
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        step="0.01"
                                        value={retailPrice}
                                        onChange={(e) => setRetailPrice(parseFloat(e.target.value) || 0)}
                                        placeholder="1000"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Available Quantity *
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        value={availableQuantity}
                                        onChange={(e) => setAvailableQuantity(parseInt(e.target.value) || 0)}
                                        placeholder="100"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Minimum Order Quantity *
                                </label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={minimumOrderQuantity}
                                    onChange={(e) => setMinimumOrderQuantity(parseInt(e.target.value) || 1)}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                />
                            </div>

                            {/* Bulk Pricing */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="flex items-center gap-2 cursor-pointer py-1">
                                    <input
                                        type="checkbox"
                                        checked={enableBulkPricing}
                                        onChange={(e) => setEnableBulkPricing(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                    />
                                    <span className="text-sm font-semibold text-slate-700">
                                        Enable Bulk Pricing
                                    </span>
                                </label>
                                {enableBulkPricing && (
                                    <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-fadeIn">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1">Bulk Price (₦)</label>
                                            <input
                                                type="number"
                                                value={bulkPrice}
                                                onChange={(e) => setBulkPrice(e.target.value)}
                                                placeholder="Bulk Price (₦)"
                                                min="0"
                                                step="0.01"
                                                className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1">Min Qty for Bulk</label>
                                            <input
                                                type="number"
                                                value={bulkMinQuantity}
                                                onChange={(e) => setBulkMinQuantity(parseInt(e.target.value) || 50)}
                                                placeholder="Min Qty for Bulk"
                                                min="1"
                                                className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-900"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Export Pricing */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="flex items-center gap-2 cursor-pointer py-1">
                                    <input
                                        type="checkbox"
                                        checked={enableExportPricing}
                                        onChange={(e) => setEnableExportPricing(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                    />
                                    <span className="text-sm font-semibold text-slate-700">
                                        Enable Export Pricing
                                    </span>
                                </label>
                                {enableExportPricing && (
                                    <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-fadeIn">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1">Export Price (₦)</label>
                                            <input
                                                type="number"
                                                value={exportPrice}
                                                onChange={(e) => setExportPrice(e.target.value)}
                                                placeholder="Export Price (₦)"
                                                min="0"
                                                step="0.01"
                                                className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1">Min Qty for Export</label>
                                            <input
                                                type="number"
                                                value={exportMinQuantity}
                                                onChange={(e) => setExportMinQuantity(parseInt(e.target.value) || 100)}
                                                placeholder="Min Qty for Export"
                                                min="1"
                                                className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-900"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Location & Delivery */}
                    <div className="bg-white rounded-2xl shadow-md p-6 border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <MapPin className="w-5 h-5 text-violet-700" />
                            <h2 className="text-xl font-bold text-slate-900">
                                Location & Delivery
                            </h2>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        State *
                                    </label>
                                    <select
                                        required
                                        value={state}
                                        onChange={(e) => setState(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    >
                                        <option value="">Select State</option>
                                        {nigerianStates.map(st => (
                                            <option key={st} value={st}>{st}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        LGA *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={lga}
                                        onChange={(e) => setLga(e.target.value)}
                                        placeholder="e.g., Ikeja"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Nearest Market *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={nearestMarket}
                                        onChange={(e) => setNearestMarket(e.target.value)}
                                        placeholder="e.g., Mile 12 Market"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Delivery Method *
                                    </label>
                                    <select
                                        value={deliveryMethod}
                                        onChange={(e) => setDeliveryMethod(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    >
                                        <option value="both">Pickup & Delivery</option>
                                        <option value="pickup">Pickup Only</option>
                                        <option value="delivery">Delivery Only</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Est. Delivery Days
                                    </label>
                                    <input
                                        type="number"
                                        value={estimatedDeliveryDays}
                                        onChange={(e) => setEstimatedDeliveryDays(e.target.value)}
                                        min="1"
                                        placeholder="e.g., 3"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Video URL (Optional)
                                </label>
                                <input
                                    type="url"
                                    value={videoUrl}
                                    onChange={(e) => setVideoUrl(e.target.value)}
                                    placeholder="https://youtube.com/watch?v=..."
                                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Submit Buttons */}
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="flex-1 px-6 py-4 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-6 py-4 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-violet-200"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    {isUploadingClient ? "Uploading Assets..." : "Saving..."}
                                </>
                            ) : (
                                <>
                                    <Save className="w-5 h-5" />
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
