"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import {
    Package, Plus, Pencil, Trash2, Save, X, Loader2,
    Globe, Award, Clock, CheckCircle, XCircle
} from "lucide-react";
import Link from "next/link";
import { useAdminData } from "@/hooks/useAdminData";
import { 
    getAdminExportCatalogAction, 
    createExportCatalogAction, 
    deleteExportCatalogAction, 
    getExportCatalogStatsAction,
    getAdminPendingExportProductsAction,
    reviewExportProductAction
} from "@/app/actions/export-admin";

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
    status?: string;
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
    const [showForm, setShowForm] = useState(false);
    const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
    const [activeTab, setActiveTab] = useState<"live" | "pending">("live");

    const isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");

    const [serverTotal, setServerTotal] = useState<number | null>(null);
    useEffect(() => {
        getExportCatalogStatsAction().then(r => {
            if (r.success && r.data) setServerTotal(r.data.totalProducts);
        });
    }, [activeTab]);

    const {
        data: products,
        loading: isLoading,
        hasMore,
        refresh: loadProducts,
        onNextPage,
        onPrevPage,
        pageIndex
    } = useAdminData<CatalogProduct>({
        fetchAction: async (opts) => {
            if (activeTab === "live") {
                const result = await getAdminExportCatalogAction({
                    limit: opts.limit || 50,
                    lastDocId: opts.lastDocId
                });
                if (!result.success) {
                    showToast(result.error || "Failed to load catalog", "error");
                    return { success: false, data: [], meta: { hasMore: false }, error: result.error };
                }
                return {
                    ...result,
                    lastDocId: result.lastDocId ?? undefined,
                    data: result.data || [],
                };
            } else {
                const result = await getAdminPendingExportProductsAction();
                if (!result.success) {
                    showToast(result.error || "Failed to load pending products", "error");
                    return { success: false, data: [], meta: { hasMore: false }, error: result.error };
                }
                return {
                    success: true,
                    data: result.data || [],
                    meta: { hasMore: false },
                    lastDocId: undefined
                };
            }
        },
        limit: 50,
        dependencies: [activeTab]
    });

    const saveProduct = async (p: CatalogProduct) => {
        const result = await createExportCatalogAction(p);
        
        if (result.success) {
            showToast(p.id ? "Product updated" : "Product added", "success");
            setShowForm(false);
            setEditingProduct(null);
            await loadProducts();
        } else {
            showToast(result.error || "Save failed", "error");
        }
    };

    const deleteProduct = async (id: string) => {
        if (!confirm("Remove this product from the catalog?")) return;
        const result = await deleteExportCatalogAction(id);
        
        if (result.success) {
            showToast("Product removed", "success");
            await loadProducts();
        } else {
            showToast(result.error || "Delete failed", "error");
        }
    };

    const handleReview = async (id: string, action: 'approve' | 'reject') => {
        if (!confirm(`Are you sure you want to ${action} this product?`)) return;
        const result = await reviewExportProductAction(id, action);
        if (result.success) {
            showToast(`Product ${action}d successfully`, "success");
            loadProducts();
        } else {
            showToast(result.error || `Failed to ${action} product`, "error");
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
                {isAdmin && !showForm && !editingProduct && activeTab === "live" && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition"
                    >
                        <Plus className="w-4 h-4" />
                        Add Product
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-4 border-b border-slate-200 mb-8">
                <button
                    onClick={() => setActiveTab("live")}
                    className={`pb-4 px-2 text-sm font-semibold transition-colors border-b-2 ${
                        activeTab === "live" 
                            ? "border-blue-600 text-blue-600" 
                            : "border-transparent text-slate-500 hover:text-slate-900"
                    }`}
                >
                    Live Products
                </button>
                <button
                    onClick={() => setActiveTab("pending")}
                    className={`pb-4 px-2 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                        activeTab === "pending" 
                            ? "border-orange-600 text-orange-600" 
                            : "border-transparent text-slate-500 hover:text-slate-900"
                    }`}
                >
                    Pending Approvals
                </button>
            </div>

            {/* Stats */}
            {activeTab === "live" && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3">
                            <Package className="w-8 h-8 text-blue-500" />
                            <div>
                                {serverTotal === null
                                    ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
                                    : <p className="text-2xl font-bold text-slate-900">{serverTotal.toLocaleString()}</p>
                                }
                                <p className="text-sm text-slate-500">Total Products</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3">
                            <Globe className="w-8 h-8 text-emerald-500" />
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{[...new Set(products.map(p => p.category))].length}</p>
                                <p className="text-sm text-slate-500">Categories (this page)</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3">
                            <Award className="w-8 h-8 text-amber-500" />
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{[...new Set(products.flatMap(p => p.certifications))].length}</p>
                                <p className="text-sm text-slate-500">Certifications (this page)</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add form */}
            {showForm && activeTab === "live" && (
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
            ) : products.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    {activeTab === "live" ? (
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    ) : (
                        <Clock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    )}
                    <h3 className="text-lg font-bold text-slate-900 mb-2">
                        {activeTab === "live" ? "No Live Products" : "No Pending Approvals"}
                    </h3>
                    <p className="text-slate-500">
                        {activeTab === "live" 
                            ? "There are currently no active products in the export catalog." 
                            : "All user-submitted products have been reviewed."}
                    </p>
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
                                                    <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                                                        {product.name}
                                                        {activeTab === "pending" && (
                                                            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1">
                                                                <Clock className="w-3 h-3" /> Pending Review
                                                            </span>
                                                        )}
                                                    </h3>
                                                    <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                                                        <Globe className="w-3 h-3" />{product.origin} · {product.season}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-lg font-bold text-slate-900">${product.pricePerMT?.toLocaleString()}/MT</span>
                                                    
                                                    {isAdmin && activeTab === "live" && (
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

                                                    {isAdmin && activeTab === "pending" && (
                                                        <div className="flex items-center gap-2 ml-4 border-l pl-4">
                                                            <button
                                                                onClick={() => product.id && handleReview(product.id, 'approve')}
                                                                className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition font-medium text-sm"
                                                            >
                                                                <CheckCircle className="w-4 h-4" />
                                                                Approve
                                                            </button>
                                                            <button
                                                                onClick={() => product.id && handleReview(product.id, 'reject')}
                                                                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition font-medium text-sm"
                                                            >
                                                                <XCircle className="w-4 h-4" />
                                                                Reject
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 mt-3">
                                                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium capitalize">{product.category}</span>
                                                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">Min: {product.minOrderMT} MT</span>
                                                {product.grades?.slice(0, 2).map(g => (
                                                    <span key={g} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full flex items-center gap-1">
                                                        <Package className="w-2.5 h-2.5" />{g}
                                                    </span>
                                                ))}
                                                {product.certifications?.slice(0, 2).map(c => (
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
            
            {/* Pagination Controls */}
            {!isLoading && products.length > 0 && activeTab === "live" && (
                <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                    <div className="flex gap-2">
                        <button
                            onClick={onPrevPage}
                            disabled={pageIndex === 0 || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                        >
                            Previous
                        </button>
                        <button
                            onClick={onNextPage}
                            disabled={!hasMore || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
