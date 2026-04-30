"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, AlertCircle } from "lucide-react";
import { submitExportProductAction } from "@/app/actions/export-products";

export default function CreateExportProductPage() {
    const router = useRouter();
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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const productData = {
                ...formData,
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
            setError(err.message || "An unexpected error occurred");
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
                <h1 className="text-3xl font-bold text-slate-900">Add Export Product</h1>
                <p className="text-slate-600 mt-1">Submit a new product to the export catalog. It will require admin approval before going live.</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8">
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
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
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
                        <label className="block text-sm font-medium text-slate-700 mb-2">Emoji Icon</label>
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
                            disabled={loading}
                            className="w-full md:w-auto px-8 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <Save className="w-5 h-5" />
                            )}
                            {loading ? "Submitting..." : "Submit Product for Review"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
