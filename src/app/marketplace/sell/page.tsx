"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Package, TrendingUp, ShoppingCart, DollarSign, Eye, Star,
    Plus, Edit, Trash2, BarChart3, Loader2, AlertCircle
} from "lucide-react";
import { getSellerProductsAction, getSellerVerificationAction, deleteProductAction } from "@/app/actions/marketplace";
import Image from "next/image";
import type { Product } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

export default function SellerDashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [verification, setVerification] = useState<any>(null);
    const [filterStatus, setFilterStatus] = useState<"all" | "active" | "suspended" | "sold_out">("all");
    const { showToast } = useToast();

    async function handleDeleteProduct(productId: string, productTitle: string) {
        if (!confirm(`Delete "${productTitle}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteProductAction(productId);
            if (result.success) {
                showToast(result.data?.message || "Product deleted successfully", "success");
                loadSellerData();
            } else {
                showToast(result.error || "Failed to delete product", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting product", "error");
        }
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            loadSellerData();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    async function loadSellerData() {
        setLoading(true);
        const [productsRes, verificationRes] = await Promise.all([
            getSellerProductsAction(),
            getSellerVerificationAction()
        ]);

        if (productsRes.success) {
            setProducts(productsRes.data?.products || []);
        }

        if (verificationRes.success) {
            setVerification(verificationRes.data?.verification);
        }

        setLoading(false);
    };

    const filteredProducts = products.filter(p => {
        if (filterStatus === "all") return true;
        if (filterStatus === "sold_out") return p.availableQuantity === 0;
        if (filterStatus === "suspended") return p.status === "suspended";
        return p.status === filterStatus;
    });

    // Calculate stats
    const stats = {
        totalProducts: products.length,
        activeProducts: products.filter(p => p.status === "active").length,
        totalOrders: products.reduce((sum, p) => sum + (p.orders || 0), 0),
        totalViews: products.reduce((sum, p) => sum + (p.views || 0), 0),
        averageRating: products.length > 0
            ? products.reduce((sum, p) => sum + (p.rating || 0), 0) / products.length
            : 0,
        revenue: 0, // Would calculate from orders
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    // Show verification required message
    if (!verification || verification.status !== "approved") {
        return (
            <div className="min-h-screen bg-slate-50 p-8">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-2xl p-8 text-center">
                        <AlertCircle className="w-16 h-16 text-yellow-600 mx-auto mb-4" />
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">
                            Seller Verification Required
                        </h1>
                        <p className="text-slate-600 mb-6">
                            {!verification
                                ? "You need to complete seller verification before listing products."
                                : verification.status === "pending"
                                    ? "Your seller verification is pending review."
                                    : "Your seller verification was not approved. Please contact support."}
                        </p>
                        <button
                            onClick={() => router.push(verification ? "/marketplace" : "/marketplace/seller-verification")}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                        >
                            {verification ? "Back to Marketplace" : "Start Verification"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">
                            Seller Dashboard
                        </h1>
                        <p className="text-slate-600">
                            Manage your products and track performance
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/marketplace/sell/create")}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        <span>New Product</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-xl p-6 elevation-2">
                        <div className="flex items-center justify-between mb-4">
                            <Package className="w-8 h-8 text-blue-600" />
                            <span className="text-3xl font-bold text-slate-900">
                                {stats.totalProducts}
                            </span>
                        </div>
                        <p className="text-sm font-medium text-slate-600">Total Products</p>
                        <p className="text-xs text-green-600 mt-1">{stats.activeProducts} active</p>
                    </div>

                    <div className="bg-white rounded-xl p-6 elevation-2">
                        <div className="flex items-center justify-between mb-4">
                            <ShoppingCart className="w-8 h-8 text-green-600" />
                            <span className="text-3xl font-bold text-slate-900">
                                {stats.totalOrders}
                            </span>
                        </div>
                        <p className="text-sm font-medium text-slate-600">Total Orders</p>
                        <p className="text-xs text-blue-600 mt-1">All time</p>
                    </div>

                    <div className="bg-white rounded-xl p-6 elevation-2">
                        <div className="flex items-center justify-between mb-4">
                            <Eye className="w-8 h-8 text-purple-600" />
                            <span className="text-3xl font-bold text-slate-900">
                                {stats.totalViews}
                            </span>
                        </div>
                        <p className="text-sm font-medium text-slate-600">Total Views</p>
                        <p className="text-xs text-slate-500 mt-1">Product impressions</p>
                    </div>

                    <div className="bg-white rounded-xl p-6 elevation-2">
                        <div className="flex items-center justify-between mb-4">
                            <Star className="w-8 h-8 text-yellow-600" />
                            <span className="text-3xl font-bold text-slate-900">
                                {stats.averageRating.toFixed(1)}
                            </span>
                        </div>
                        <p className="text-sm font-medium text-slate-600">Avg Rating</p>
                        <p className="text-xs text-slate-500 mt-1">Across all products</p>
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="bg-white rounded-xl p-6 elevation-2 mb-6">
                    <div className="flex items-center gap-4 overflow-x-auto">
                        {[
                            { key: "all", label: "All Products", count: products.length },
                            { key: "active", label: "Active", count: stats.activeProducts },
                            { key: "suspended", label: "Suspended", count: products.filter(p => p.status === "suspended").length },
                            { key: "sold_out", label: "Sold Out", count: products.filter(p => p.availableQuantity === 0).length }
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setFilterStatus(tab.key as "all" | "active" | "suspended" | "sold_out")}
                                className={`px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${filterStatus === tab.key
                                    ? "bg-blue-600 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {tab.label} ({tab.count})
                            </button>
                        ))}
                    </div>
                </div>

                {/* Products Grid */}
                {filteredProducts.length === 0 ? (
                    <div className="bg-white rounded-xl p-12 text-center elevation-2">
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                            No Products Found
                        </h3>
                        <p className="text-slate-600 mb-6">
                            {filterStatus === "all"
                                ? "Start by creating your first product listing"
                                : `No ${filterStatus.replace("_", " ")} products`}
                        </p>
                        <button
                            onClick={() => router.push("/marketplace/sell/create")}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                        >
                            Create Product
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredProducts.map((product) => (
                            <div
                                key={product.id}
                                className="bg-white rounded-xl overflow-hidden elevation-2 hover:shadow-xl transition"
                            >
                                {/* Product Image */}
                                <div className="relative h-48 bg-slate-200">
                                    {product.images && product.images.length > 0 ? (
                                        <Image
                                            src={product.images[0]}
                                            alt={product.title}
                                            fill
                                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full">
                                            <Package className="w-12 h-12 text-slate-400" />
                                        </div>
                                    )}

                                    {/* Status Badge */}
                                    <div className="absolute top-3 right-3">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${product.status === "active" && product.availableQuantity > 0
                                            ? "bg-green-100 text-green-700"
                                            : product.availableQuantity === 0
                                                ? "bg-red-100 text-red-700"
                                                : "bg-slate-100 text-slate-900"
                                            }`}>
                                            {product.availableQuantity === 0 ? "Sold Out" : product.status}
                                        </span>
                                    </div>
                                </div>

                                {/* Product Info */}
                                <div className="p-5">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-1">
                                        {product.title}
                                    </h3>
                                    <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                                        {product.description}
                                    </p>

                                    {/* Stats */}
                                    <div className="flex items-center gap-4 mb-4 text-sm text-slate-600">
                                        <div className="flex items-center gap-1">
                                            <Eye className="w-4 h-4" />
                                            <span>{product.views || 0}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <ShoppingCart className="w-4 h-4" />
                                            <span>{product.orders || 0}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                                            <span>{product.rating?.toFixed(1) || "0.0"}</span>
                                        </div>
                                    </div>

                                    {/* Price */}
                                    <div className="mb-4">
                                        <p className="text-2xl font-bold text-blue-600">
                                            ₦{product.pricingTiers[0]?.price.toLocaleString()}
                                            <span className="text-sm text-slate-500 font-normal">
                                                /{product.unit}
                                            </span>
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {product.availableQuantity} {product.unit}s available
                                        </p>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => router.push(`/marketplace/product/${product.id}`)}
                                            className="flex-1 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold rounded-lg transition text-sm"
                                        >
                                            View
                                        </button>
                                        <button
                                            onClick={() => router.push(`/marketplace/sell/edit/${product.id}`)}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProduct(product.id, product.title)}
                                            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
