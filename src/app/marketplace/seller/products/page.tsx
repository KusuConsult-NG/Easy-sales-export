/**
 * Seller Product Management
 * 
 * List, edit, and manage all seller products
 */

"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Edit, Trash2, Eye, AlertCircle, CheckCircle, Loader2, Package } from "lucide-react";
import Link from "next/link";
import { getSellerProductsAction } from "@/app/actions/marketplace";
import type { Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";

export default function SellerProductsPage() {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");

    useEffect(() => {
        async function loadProducts() {
            try {
                const result = await getSellerProductsAction();
                if (result.success && result.products) {
                    setProducts(result.products);
                }
            } catch (error) {
                console.error("Failed to load products:", error);
            } finally {
                setLoading(false);
            }
        }
        loadProducts();
    }, []);

    const getStatusConfig = (status: string) => {
        const configs: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Active" },
            draft: { bg: "bg-slate-100 dark:bg-slate-700", text: "text-slate-600 dark:text-slate-400", label: "Draft" },
            out_of_stock: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Out of Stock" },
            suspended: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Suspended" }
        };
        // Helper logic for low stock which isn't a direct status but a derived state
        if (status === "low_stock") {
            return { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", label: "Low Stock" };
        }
        return configs[status] || configs.active;
    };

    const filteredProducts = products.filter(product => {
        const matchesSearch = product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.category.toLowerCase().includes(searchQuery.toLowerCase());

        let matchesStatus = true;
        if (filterStatus === "all") matchesStatus = true;
        else if (filterStatus === "low_stock") matchesStatus = product.availableQuantity > 0 && product.availableQuantity < 50;
        else matchesStatus = product.status === filterStatus;

        return matchesSearch && matchesStatus;
    });

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                                My Products
                            </h1>
                            <p className="text-slate-600 dark:text-slate-400">
                                Manage your product listings and inventory
                            </p>
                        </div>
                        <Link
                            href="/marketplace/sell/create"
                            className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
                        >
                            <Plus className="w-5 h-5" />
                            Add New Product
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Search and Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search products or categories..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                            {["all", "active", "draft", "out_of_stock", "low_stock", "suspended"].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${filterStatus === status
                                        ? "bg-green-600 text-white"
                                        : "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600"
                                        }`}
                                >
                                    {status === "all" ? "All" : status.replace("_", " ")}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Products Table */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Product
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Category
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Price
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Stock
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Sold
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                    Status
                                </th>
                                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                        No products found. <Link href="/marketplace/sell/create" className="text-green-600 hover:underline">Add your first product</Link>
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product) => {
                                    // Determine display status (check for low stock overrides)
                                    let displayStatus = product.status;
                                    if (product.status === "active" && product.availableQuantity < 50 && product.availableQuantity > 0) {
                                        displayStatus = "low_stock" as any;
                                    }

                                    const statusConfig = getStatusConfig(displayStatus);

                                    const retailPrice = product.pricingTiers?.find(t => t.type === "retail")?.price || product.pricingTiers?.[0]?.price || 0;

                                    return (
                                        <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white">
                                                        {product.title}
                                                    </p>
                                                    <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                                        <Package className="h-5 w-5 text-slate-500" />
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-sm text-slate-600 dark:text-slate-400">
                                                        <Eye className="w-4 h-4" />
                                                        <span>{product.views || 0} views</span>
                                                        <span>•</span>
                                                        <span>★ {product.rating || 0}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white capitalize">
                                                {product.category}
                                            </td>
                                            <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                                                {formatCurrency(retailPrice)}/{product.unit}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`font-semibold ${product.availableQuantity === 0 ? 'text-red-600' :
                                                    product.availableQuantity < 50 ? 'text-orange-600' :
                                                        'text-green-600'
                                                    }`}>
                                                    {product.availableQuantity}{product.unit}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white">
                                                {product.orders || 0} units
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                                    {statusConfig.label}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Link
                                                        href={`/marketplace/products/${product.id}`}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
                                                        title="View"
                                                    >
                                                        <Eye className="w-5 h-5" />
                                                    </Link>
                                                    <Link
                                                        href={`/marketplace/seller/products/${product.id}/edit`}
                                                        className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg"
                                                        title="Edit"
                                                    >
                                                        <Edit className="w-5 h-5" />
                                                    </Link>
                                                    <button
                                                        className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Low Stock Alert */}
                {filteredProducts.some(p => p.availableQuantity < 50) && (
                    <div className="mt-6 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-6">
                        <div className="flex items-start gap-4">
                            <AlertCircle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold text-orange-900 dark:text-orange-200 mb-2">
                                    Stock Alert
                                </h3>
                                <p className="text-sm text-orange-800 dark:text-orange-300 mb-3">
                                    You have products with low or zero stock. Restock soon to avoid lost sales.
                                </p>
                                <div className="flex gap-3">
                                    {filteredProducts
                                        .filter(p => p.availableQuantity < 50)
                                        .slice(0, 3)
                                        .map(product => (
                                            <Link
                                                key={product.id}
                                                href={`/marketplace/seller/products/${product.id}/edit`}
                                                className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700"
                                            >
                                                Restock {product.title}
                                            </Link>
                                        ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
