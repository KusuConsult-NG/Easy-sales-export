"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Package, Plus, Clock, CheckCircle2, XCircle, Trash2, Loader2 } from "lucide-react";
import { getUserExportProductsAction, deleteExportProductAction } from "@/app/actions/export-products";
import { useToast } from "@/contexts/ToastContext";
import { firstImageSrc } from "@/lib/first-image";

export default function MyExportProductsPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        async function loadProducts() {
            try {
                const res = await getUserExportProductsAction();
                if (res.success && res.data) {
                    setProducts(res.data);
                }
            } catch (error) {
                console.error("Failed to load products:", error);
            } finally {
                setLoading(false);
            }
        }
        loadProducts();
    }, []);

    async function handleDeleteProduct(productId: string, productName: string) {
        if (!confirm(`Are you sure you want to delete "${productName}" from your export catalog? This action cannot be undone.`)) {
            return;
        }

        setDeletingId(productId);
        try {
            const res = await deleteExportProductAction(productId);
            if (res.success) {
                showToast("Product deleted successfully", "success");
                setProducts(prev => prev.filter(p => p.id !== productId));
            } else {
                showToast(res.error || "Failed to delete product", "error");
            }
        } catch (error) {
            console.error("Failed to delete product:", error);
            showToast("An error occurred while deleting the product.", "error");
        } finally {
            setDeletingId(null);
        }
    }

    const getStatusIcon = (status: string) => {
        if (status === 'live') return <CheckCircle2 className="w-5 h-5 text-green-500" />;
        if (status === 'rejected') return <XCircle className="w-5 h-5 text-red-500" />;
        return <Clock className="w-5 h-5 text-amber-500" />;
    };

    const getStatusText = (status: string) => {
        if (status === 'live') return "Live";
        if (status === 'rejected') return "Rejected";
        return "Pending Review";
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-slate-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading products...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">My Export Products</h1>
                    <p className="text-slate-600">Manage the products you have submitted for export</p>
                </div>
                <Link
                    href="/export/products/create"
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">Add Product</span>
                </Link>
            </div>

            {products.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-900 mb-2">No Products Yet</h2>
                    <p className="text-slate-600 mb-6">You haven't submitted any products for export yet.</p>
                    <Link
                        href="/export/products/create"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Submit First Product</span>
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products.map((product) => (
                        <div key={product.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow duration-300">
                            {/*
                              * #383: this was one of only two raw image
                              * elements left in the app — the other is a
                              * blob-preview that has to stay — and it was the
                              * odd copy of the marketplace's own tile. (The
                              * element name is described rather than written
                              * out: a ratchet greps for it, and a comment
                              * quoting it would trip that gate on itself.)
                              * The http(s)
                              * guard is that tile's, and it is load-bearing:
                              * next/image THROWS on a src that is not an
                              * absolute URL or a leading-slash path, so a row
                              * carrying a bare storage key would have broken
                              * the whole grid rather than showing one gap.
                              */}
                            {firstImageSrc(product.images) && (
                                <div className="relative h-48 w-full bg-slate-50 overflow-hidden border-b border-slate-100 shrink-0">
                                    <Image
                                        src={firstImageSrc(product.images)!}
                                        alt={product.name}
                                        fill
                                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                        className="object-cover hover:scale-105 transition-transform duration-500"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                    {product.isActive && (
                                        <span className="absolute top-3 left-3 text-[10px] font-bold bg-green-500 text-white px-2 py-0.5 rounded-full shadow-sm uppercase tracking-wider">
                                            Active
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="p-6 flex-1 flex flex-col justify-between">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        {(!product.images || product.images.length === 0) && (
                                            <div className="text-3xl bg-slate-50 w-12 h-12 flex items-center justify-center rounded-xl border border-slate-100 shadow-xs shrink-0 select-none">
                                                {product.icon || "📦"}
                                            </div>
                                        )}
                                        <div>
                                            <h3 className="font-bold text-slate-900">{product.name}</h3>
                                            <p className="text-sm text-slate-500 capitalize">{product.category}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                            {getStatusIcon(product.status || 'pending')}
                                            <span className="text-sm font-medium text-slate-700">{getStatusText(product.status || 'pending')}</span>
                                        </div>
                                        {product.isActive && (!product.images || product.images.length === 0) && (
                                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                </div>
                            
                            <div className="space-y-2 mb-4">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">Origin:</span>
                                    <span className="font-medium text-slate-900">{product.origin}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">Price/MT:</span>
                                    <span className="font-medium text-slate-900">${product.pricePerMT?.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">Min Order:</span>
                                    <span className="font-medium text-slate-900">{product.minOrderMT} MT</span>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100 text-sm">
                                <p className="text-slate-500 mb-2">Certifications:</p>
                                <div className="flex flex-wrap gap-2">
                                    {product.certifications?.map((cert: string, idx: number) => (
                                        <span key={idx} className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs">
                                            {cert}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100 flex items-center justify-between mt-4">
                                <span className="text-xs text-slate-400">
                                    {product.createdAt ? `Submitted ${new Date(product.createdAt.seconds ? product.createdAt.seconds * 1000 : product.createdAt).toLocaleDateString()}` : ""}
                                </span>
                                <button
                                    onClick={() => handleDeleteProduct(product.id, product.name)}
                                    disabled={deletingId === product.id}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition disabled:opacity-50 text-xs font-semibold"
                                    title="Delete product"
                                >
                                    {deletingId === product.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                    <span>{deletingId === product.id ? "Deleting..." : "Delete"}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                </div>
            )}
        </div>
    );
}
