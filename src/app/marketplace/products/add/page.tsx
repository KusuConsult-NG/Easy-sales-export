"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Package, DollarSign, Award, Video,
    ArrowLeft, Plus, X, Upload
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import LoadingButton from "@/components/ui/LoadingButton";

export default function AddProductPage() {
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        name: "",
        category: "",
        description: "",
        specifications: "",
        unit: "kg",
        minOrder: 1,
        stockQuantity: 0,
        retailPrice: 0,
        bulkPrice: 0,
        exportPrice: 0,
        certifications: [] as string[],
        escrowAvailable: true,
    });

    const [media, setMedia] = useState({
        images: [] as File[],
        video: null as File | null,
    });

    const [newCertification, setNewCertification] = useState("");

    const categories = [
        "Grains & Cereals",
        "Tubers & Roots",
        "Fruits",
        "Vegetables",
        "Spices",
        "Nuts & Seeds",
        "Processed Foods",
        "Livestock Products",
        "Poultry Products",
        "Other"
    ];

    const commonCertifications = [
        "Organic Certified",
        "NAFDAC Approved",
        "Halal Certified",
        "Fair Trade",
        "ISO 22000",
        "HACCP Certified",
        "Non-GMO",
        "Rainforest Alliance"
    ];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setMedia(prev => ({ ...prev, images: [...prev.images, ...files].slice(0, 5) }));
    };

    const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setMedia(prev => ({ ...prev, video: file }));
    };

    const removeImage = (index: number) => {
        setMedia(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };

    const addCertification = (cert: string) => {
        if (cert && !formData.certifications.includes(cert)) {
            setFormData(prev => ({
                ...prev,
                certifications: [...prev.certifications, cert]
            }));
        }
        setNewCertification("");
    };

    const removeCertification = (cert: string) => {
        setFormData(prev => ({
            ...prev,
            certifications: prev.certifications.filter(c => c !== cert)
        }));
    };

    const { showToast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const submitData = new FormData();

            // Add form fields
            Object.entries(formData).forEach(([key, value]) => {
                if (key === "certifications") {
                    submitData.append(key, JSON.stringify(value));
                } else {
                    submitData.append(key, String(value));
                }
            });

            // Add images
            media.images.forEach((image, index) => {
                submitData.append(`image${index}`, image);
            });

            // Add video
            if (media.video) {
                submitData.append("video", media.video);
            }

            const response = await fetch("/api/marketplace/create-product", {
                method: "POST",
                body: submitData,
            });

            const data = await response.json();

            if (data.success) {
                showToast("Product listed successfully!", "success");
                setTimeout(() => router.push("/marketplace/sell"), 1000);
            } else {
                showToast(data.message || "Failed to create product", "error");
            }
        } catch (error) {
            showToast("An error occurred while creating the product", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-5xl mx-auto px-4">
                <Link
                    href="/marketplace/sell"
                    className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Seller Dashboard
                </Link>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-linear-to-r from-green-600 to-emerald-600 p-8 text-white">
                        <h1 className="text-3xl font-bold mb-2">Add New Product</h1>
                        <p className="text-green-100">
                            Create a listing for your agricultural product
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-8">
                        {/* Basic Information */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Package className="w-6 h-6" />
                                Basic Information
                            </h2>

                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            Product Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            placeholder="e.g., Premium Yam Tubers"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                            Category *
                                        </label>
                                        <select
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                            required
                                        >
                                            <option value="">Select Category</option>
                                            {categories.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        rows={4}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Provide a detailed description of your product..."
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Specifications
                                    </label>
                                    <textarea
                                        value={formData.specifications}
                                        onChange={(e) => setFormData({ ...formData, specifications: e.target.value })}
                                        rows={3}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Add any specifications (size, color, variety, origin, etc.)"
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Pricing Tiers */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <DollarSign className="w-6 h-6" />
                                Pricing Tiers
                            </h2>

                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                                <p className="text-sm text-blue-900 dark:text-blue-100">
                                    💡 Set different prices for retail, bulk, and export orders. Bulk pricing applies to orders above MOQ.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Retail Price (₦ per {formData.unit}) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.retailPrice}
                                        onChange={(e) => setFormData({ ...formData, retailPrice: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        step="100"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Bulk Price (₦ per {formData.unit})
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.bulkPrice}
                                        onChange={(e) => setFormData({ ...formData, bulkPrice: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Optional"
                                        min="0"
                                        step="100"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Export Price (₦ per {formData.unit})
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.exportPrice}
                                        onChange={(e) => setFormData({ ...formData, exportPrice: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="Optional"
                                        min="0"
                                        step="100"
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Inventory & MOQ */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Inventory & Minimum Order
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Unit *
                                    </label>
                                    <select
                                        value={formData.unit}
                                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        required
                                    >
                                        <option value="kg">Kilogram (kg)</option>
                                        <option value="ton">Ton</option>
                                        <option value="bag">Bag</option>
                                        <option value="carton">Carton</option>
                                        <option value="piece">Piece</option>
                                        <option value="liter">Liter</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Minimum Order Quantity (MOQ) *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.minOrder}
                                        onChange={(e) => setFormData({ ...formData, minOrder: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="1"
                                        min="1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Available Stock *
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.stockQuantity}
                                        onChange={(e) => setFormData({ ...formData, stockQuantity: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        placeholder="0"
                                        min="0"
                                        required
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Certifications */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Award className="w-6 h-6" />
                                Certifications
                            </h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Add Certification
                                    </label>
                                    <div className="flex gap-2">
                                        <select
                                            value={newCertification}
                                            onChange={(e) => setNewCertification(e.target.value)}
                                            className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                        >
                                            <option value="">Select or enter custom certification</option>
                                            {commonCertifications.map(cert => (
                                                <option key={cert} value={cert}>{cert}</option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => addCertification(newCertification)}
                                            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-all"
                                        >
                                            <Plus className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {formData.certifications.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {formData.certifications.map((cert, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg"
                                            >
                                                <Award className="w-4 h-4" />
                                                <span className="font-semibold">{cert}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeCertification(cert)}
                                                    className="p-1 hover:bg-green-200 dark:hover:bg-green-900/50 rounded transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Media Upload */}
                        <section>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <Video className="w-6 h-6" />
                                Product Media
                            </h2>

                            <div className="space-y-6">
                                {/* Images */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Product Images (Max 5) *
                                    </label>
                                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6">
                                        {media.images.length > 0 ? (
                                            <div className="grid grid-cols-3 gap-4 mb-4">
                                                {media.images.map((img, index) => (
                                                    <div key={index} className="relative">
                                                        <img
                                                            src={URL.createObjectURL(img)}
                                                            alt={`Product ${index + 1}`}
                                                            className="w-full h-32 object-cover rounded-lg"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeImage(index)}
                                                            className="absolute top-2 right-2 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}

                                        {media.images.length < 5 && (
                                            <label className="flex flex-col items-center cursor-pointer">
                                                <Upload className="w-12 h-12 text-slate-400 mb-3" />
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                                                    Click to upload images
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
                                        Product Video (Optional)
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

                        {/* Options */}
                        <section>
                            <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="escrow"
                                    checked={formData.escrowAvailable}
                                    onChange={(e) => setFormData({ ...formData, escrowAvailable: e.target.checked })}
                                    className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                />
                                <label htmlFor="escrow" className="text-sm font-semibold text-slate-900 dark:text-white">
                                    Enable Escrow Protection (Recommended for buyer trust)
                                </label>
                            </div>
                        </section>

                        {/* Submit Button */}
                        <div className="flex gap-4 pt-4">
                            <LoadingButton
                                type="submit"
                                disabled={media.images.length === 0}
                                loading={isSubmitting}
                                loadingText="Creating Product..."
                                variant="success"
                                size="lg"
                                className="flex-1"
                            >
                                List Product
                            </LoadingButton>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
