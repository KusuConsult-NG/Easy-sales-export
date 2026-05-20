"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Package, Plus, Clock, CheckCircle2, XCircle } from "lucide-react";
import { getUserExportProductsAction } from "@/app/actions/export-products";

export default function MyExportProductsPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

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
                            {product.images && product.images.length > 0 && (
                                <div className="relative h-48 w-full bg-slate-50 overflow-hidden border-b border-slate-100 shrink-0">
                                    <img
                                        src={product.images[0]}
                                        alt={product.name}
                                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
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
                        </div>
                    </div>
                ))}
                </div>
            )}
        </div>
    );
}
