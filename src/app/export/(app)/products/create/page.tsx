"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowLeft, Save, AlertCircle, Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { submitExportProductAction } from "@/app/actions/export-products";
import { useStorage } from "@/hooks/use-storage";

export default function CreateExportProductPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { uploadFile, uploadState } = useStorage();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: "",
        icon: "📦",
        category: "nuts",
        origin: "",
        season: "",
        pricePerMT: "",
        minOrderMT: "",
        grades: "",
        certifications: ""
    });

    const [imageFiles, setImageFiles] = useState<File[]>([]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // 1. Upload Images to Cloudinary in parallel
            const imageUploadPromises = imageFiles.map(image => {
                const folderPath = `export-catalog/${session?.user?.id || "anonymous"}/images/${Date.now()}_${image.name}`;
                return uploadFile(image, folderPath);
            });
            const imageUrls = await Promise.all(imageUploadPromises);

            // 2. Submit the product
            const productData = {
                ...formData,
                images: imageUrls,
                pricePerMT: Number(formData.pricePerMT),
                minOrderMT: Number(formData.minOrderMT),
                grades: formData.grades.split(",").map(g => g.trim()).filter(Boolean),
                certifications: formData.certifications.split(",").map(c => c.trim()).filter(Boolean),
            };

            const res = await submitExportProductAction(productData);

            if (res.success) {
                router.push("/export/products");
                router.refresh();
            } else {
                setError(res.error || "Failed to submit product");
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred during submission");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <div className="mb-6">
                <Link href="/export/products" className="inline-flex items-center text-slate-500 hover:text-slate-900 mb-4 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Products
                </Link>
                <h1 className="text-3xl font-bold text-slate-900 animate-fadeIn">Add Export Product</h1>
                <p className="text-slate-600 mt-1">Submit a new product to the export catalog. It will require admin approval before going live.</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 border border-red-200">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs">
                {loading ? (
                    /* Submitting Loading Assets Progress State */
                    <div className="text-center py-12 space-y-6 animate-fadeIn">
                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                            <Loader2 className="w-10 h-10 text-slate-900 animate-spin" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-2xl font-bold text-slate-900">Uploading Product Assets</h3>
                            <p className="text-slate-500 max-w-md mx-auto">Please wait while we secure and upload your photos and product details.</p>
                        </div>
                        {imageFiles.length > 0 && (
                            <div className="max-w-md mx-auto space-y-4 text-left p-6 bg-slate-50 border border-slate-200 rounded-2xl">
                                {imageFiles.map((file) => {
                                    const state = uploadState[file.name];
                                    const progress = state?.progress ?? 0;
                                    const fileError = state?.error ?? null;
                                    return (
                                        <div key={file.name} className="space-y-1.5 animate-fadeIn">
                                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                                                <span className="truncate max-w-[240px] flex items-center gap-1.5">
                                                    🖼️ {file.name}
                                                </span>
                                                <span className={fileError ? "text-red-600" : "text-slate-900"}>
                                                    {fileError ? "Failed" : progress === 100 ? "Completed" : `${Math.round(progress)}%`}
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${fileError ? "bg-red-500" : "bg-slate-900"}`}
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            {fileError && <p className="text-[10px] text-red-500 font-medium">{fileError}</p>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Product Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    required
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="e.g. Premium Cashew Nuts"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Category</label>
                                <select
                                    name="category"
                                    value={formData.category}
                                    onChange={handleChange}
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none bg-white text-slate-900"
                                >
                                    <option value="nuts">Nuts & Seeds</option>
                                    <option value="spices">Spices & Herbs</option>
                                    <option value="oils">Oils & Extracts</option>
                                    <option value="grains">Grains & Cereals</option>
                                    <option value="other">Other Agricultural</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Origin (State/Region)</label>
                                <input
                                    type="text"
                                    name="origin"
                                    required
                                    value={formData.origin}
                                    onChange={handleChange}
                                    placeholder="e.g. Ogbomoso, Oyo State"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Season</label>
                                <input
                                    type="text"
                                    name="season"
                                    required
                                    value={formData.season}
                                    onChange={handleChange}
                                    placeholder="e.g. Feb - May"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Price per MT (USD)</label>
                                <input
                                    type="number"
                                    name="pricePerMT"
                                    required
                                    min="1"
                                    value={formData.pricePerMT}
                                    onChange={handleChange}
                                    placeholder="e.g. 2850"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Minimum Order (MT)</label>
                                <input
                                    type="number"
                                    name="minOrderMT"
                                    required
                                    min="1"
                                    value={formData.minOrderMT}
                                    onChange={handleChange}
                                    placeholder="e.g. 20"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Available Grades (Comma separated)</label>
                            <input
                                type="text"
                                name="grades"
                                required
                                value={formData.grades}
                                onChange={handleChange}
                                placeholder="e.g. W320, W240, W210"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Certifications (Comma separated)</label>
                            <input
                                type="text"
                                name="certifications"
                                required
                                value={formData.certifications}
                                onChange={handleChange}
                                placeholder="e.g. NAFDAC, SON, SGS"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Product Images (Up to 4, JPG/PNG, Max 5MB each)
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                {imageFiles.map((file, idx) => {
                                    const previewUrl = URL.createObjectURL(file);
                                    return (
                                        <div key={idx} className="relative aspect-square bg-slate-50 border border-slate-200 rounded-xl overflow-hidden group shadow-xs">
                                            <img
                                                src={previewUrl}
                                                alt={file.name}
                                                className="w-full h-full object-cover"
                                                onLoad={() => URL.revokeObjectURL(previewUrl)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setImageFiles(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute top-2 right-2 p-1.5 bg-slate-950/80 text-white hover:bg-slate-900 rounded-full transition shadow-sm opacity-100 sm:opacity-0 group-hover:opacity-100"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                            <div className="absolute bottom-0 inset-x-0 p-1.5 bg-slate-950/50 text-center">
                                                <p className="text-[10px] text-white truncate font-medium">{file.name}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                                {imageFiles.length < 4 && (
                                    <label className="aspect-square border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition shadow-xs">
                                        <Upload className="w-6 h-6 text-slate-400 mb-2" />
                                        <span className="text-xs text-slate-500 font-semibold">Upload Image</span>
                                        <input
                                            type="file"
                                            accept="image/png, image/jpeg, image/jpg, image/webp"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                if (e.target.files) {
                                                    const selected = Array.from(e.target.files);
                                                    setImageFiles(prev => [...prev, ...selected].slice(0, 4));
                                                }
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Emoji Icon (Fallback if no images uploaded)</label>
                            <input
                                type="text"
                                name="icon"
                                required
                                maxLength={5}
                                value={formData.icon}
                                onChange={handleChange}
                                placeholder="e.g. 🥜"
                                className="w-full md:w-32 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-center text-xl"
                            />
                        </div>

                        <div className="pt-6 border-t border-slate-200">
                            <button
                                type="submit"
                                className="w-full md:w-auto px-8 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium flex items-center justify-center gap-2"
                            >
                                <Save className="w-5 h-5" />
                                Submit Product for Review
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
