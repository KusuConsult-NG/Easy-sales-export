"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import {
    Package, Plus, Pencil, Trash2, Save, X, Loader2,
    ChevronDown, ChevronUp, Tag, Globe, Award
} from "lucide-react";
import Link from "next/link";

interface CatalogProduct {
    id?: string;
    name: string;
    icon: string;
    origin: string;
    season: string;
    category: string;
    grades: string[];
    certifications: string[];
    pricePerMT: number;
    minOrderMT: number;
    isActive?: boolean;
}

const EMPTY: CatalogProduct = {
    name: "", icon: "📦", origin: "", season: "", category: "other",
    grades: [""], certifications: [""], pricePerMT: 0, minOrderMT: 1,
};

const CATEGORIES = ["nuts", "spices", "oils", "other"];

function ProductForm({ initial, onSave, onCancel }: {
    initial: CatalogProduct;
    onSave: (p: CatalogProduct) => Promise<void>;
    onCancel: () => void;
}) {
    const [p, setP] = useState<CatalogProduct>({ ...initial });
    const [saving, setSaving] = useState(false);

    const setField = (k: keyof CatalogProduct, v: any) => setP(prev => ({ ...prev, [k]: v }));

    const setArr = (k: "grades" | "certifications", i: number, v: string) => {
        const arr = [...p[k]];
        arr[i] = v;
        setField(k, arr);
    };

    const addArr = (k: "grades" | "certifications") => setField(k, [...p[k], ""]);
    const removeArr = (k: "grades" | "certifications", i: number) => setField(k, p[k].filter((_, idx) => idx !== i));

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        try {
            await onSave({ ...p, grades: p.grades.filter(Boolean), certifications: p.certifications.filter(Boolean) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-2xl p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Name*</label>
                    <input required value={p.name} onChange={e => setField("name", e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. Cashew Nuts" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Icon (emoji)</label>
                    <input value={p.icon} onChange={e => setField("icon", e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="🥜" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Origin*</label>
                    <input required value={p.origin} onChange={e => setField("origin", e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Ogbomoso, Oyo State" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Season*</label>
                    <input required value={p.season} onChange={e => setField("season", e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Feb - May" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                    <select value={p.category} onChange={e => setField("category", e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Price / MT ($)*</label>
                    <input required type="number" min={0} value={p.pricePerMT} onChange={e => setField("pricePerMT", Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Min Order (MT)*</label>
                    <input required type="number" min={1} value={p.minOrderMT} onChange={e => setField("minOrderMT", Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
            </div>

            {/* Grades */}
            <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Grades</label>
                {p.grades.map((g, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                        <input value={g} onChange={e => setArr("grades", i, e.target.value)}
                            className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm" placeholder="e.g. W320" />
                        <button type="button" onClick={() => removeArr("grades", i)} className="text-red-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={() => addArr("grades")} className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add grade
                </button>
            </div>

            {/* Certifications */}
            <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Certifications</label>
                {p.certifications.map((c, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                        <input value={c} onChange={e => setArr("certifications", i, e.target.value)}
                            className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm" placeholder="e.g. NAFDAC" />
                        <button type="button" onClick={() => removeArr("certifications", i)} className="text-red-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={() => addArr("certifications")} className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add certification
                </button>
            </div>

            <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {p.id ? "Save Changes" : "Add Product"}
                </button>
                <button type="button" onClick={onCancel}
                    className="px-5 py-2 border border-slate-300 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition">
                    Cancel
                </button>
            </div>
        </form>
    );
}

export default function AdminExportCatalogPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);

    const isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");

    useEffect(() => {
        loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadProducts() {
        setIsLoading(true);
        try {
            const res = await fetch("/api/export/catalog");
            const data = await res.json();
            if (data.success) setProducts(data.products || []);
        } catch {
            showToast("Failed to load catalog", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const saveProduct = async (p: CatalogProduct) => {
        const res = await fetch("/api/export/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
        });
        const data = await res.json();
        if (data.success) {
            showToast(p.id ? "Product updated" : "Product added", "success");
            setShowForm(false);
            setEditingProduct(null);
            await loadProducts();
        } else {
            showToast(data.error || "Save failed", "error");
        }
    };

    const deleteProduct = async (id: string) => {
        if (!confirm("Remove this product from the catalog?")) return;
        const res = await fetch(`/api/export/catalog?id=${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
            showToast("Product removed", "success");
            await loadProducts();
        } else {
            showToast("Delete failed", "error");
        }
    };

    return (
        <div className="p-6 md:p-8 max-w-6xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
                <div>
                    <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-2 inline-block">← Admin Dashboard</Link>
                    <h1 className="text-3xl font-bold text-slate-900">Export Product Catalog</h1>
                    <p className="text-slate-600 mt-1">
                        Manage the products shown to international buyers. Changes go live immediately.
                    </p>
                </div>
                {isAdmin && !showForm && !editingProduct && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition"
                    >
                        <Plus className="w-4 h-4" />
                        Add Product
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-3">
                        <Package className="w-8 h-8 text-blue-500" />
                        <div>
                            <p className="text-2xl font-bold text-slate-900">{products.length}</p>
                            <p className="text-sm text-slate-500">Total Products</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-3">
                        <Globe className="w-8 h-8 text-emerald-500" />
                        <div>
                            <p className="text-2xl font-bold text-slate-900">{[...new Set(products.map(p => p.category))].length}</p>
                            <p className="text-sm text-slate-500">Categories</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-3">
                        <Award className="w-8 h-8 text-amber-500" />
                        <div>
                            <p className="text-2xl font-bold text-slate-900">{[...new Set(products.flatMap(p => p.certifications))].length}</p>
                            <p className="text-sm text-slate-500">Unique Certifications</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Add form */}
            {showForm && (
                <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-3">New Product</h2>
                    <ProductForm
                        initial={EMPTY}
                        onSave={saveProduct}
                        onCancel={() => setShowForm(false)}
                    />
                </div>
            )}

            {/* Product list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                </div>
            ) : (
                <div className="space-y-4">
                    {products.map((product) => (
                        <div key={product.id || product.name}>
                            {editingProduct?.id === product.id ? (
                                <ProductForm
                                    initial={editingProduct!}
                                    onSave={saveProduct}
                                    onCancel={() => setEditingProduct(null)}
                                />
                            ) : (
                                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                                    <div className="flex items-start gap-4">
                                        <span className="text-3xl">{product.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <h3 className="font-bold text-slate-900 text-lg">{product.name}</h3>
                                                    <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                                                        <Globe className="w-3 h-3" />{product.origin} · {product.season}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-lg font-bold text-slate-900">${product.pricePerMT.toLocaleString()}/MT</span>
                                                    {isAdmin && (
                                                        <>
                                                            <button
                                                                onClick={() => setEditingProduct(product)}
                                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                                title="Edit"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => product.id && deleteProduct(product.id)}
                                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 mt-3">
                                                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium capitalize">{product.category}</span>
                                                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">Min: {product.minOrderMT} MT</span>
                                                {product.grades.slice(0, 2).map(g => (
                                                    <span key={g} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full flex items-center gap-1">
                                                        <Tag className="w-2.5 h-2.5" />{g}
                                                    </span>
                                                ))}
                                                {product.certifications.slice(0, 2).map(c => (
                                                    <span key={c} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-1">
                                                        <Award className="w-2.5 h-2.5" />{c}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
