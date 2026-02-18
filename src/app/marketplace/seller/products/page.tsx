/**
 * Seller Product Management
 * 
 * List, edit, and manage all seller products
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from '@/lib/logger';
import { Plus, Search, Edit, Trash2, Eye, AlertCircle, Loader2, Package } from "lucide-react";
import Link from "next/link";
import { getSellerProductsAction, deleteProductAction } from "@/app/actions/marketplace";
import type { Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import BackButton from "@/components/ui/BackButton";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/contexts/ToastContext";

export default function SellerProductsPage() {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");

    // Pagination State
    const [lastId, setLastId] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    const debouncedSearch = useDebounce(searchQuery, 500);
    const { showToast } = useToast();

    const fetchProducts = useCallback(async (isReset: boolean = false) => {
        try {
            if (isReset) {
                setLoading(true);
            } else {
                setLoadingMore(true);
            }

            // If resetting, we use undefined as lastId
            // If loading more, we use the current lastId from state
            const currentLastId = isReset ? undefined : lastId;

            const result = await getSellerProductsAction({
                limit: 20,
                lastId: currentLastId,
                status: filterStatus,
                search: debouncedSearch
            });

            if (result.success && result.products) {
                setProducts(prev => isReset ? result.products : [...prev, ...result.products]);
                setLastId(result.lastId);
                setHasMore(!!result.hasMore);
            } else if (result.error) {
                logger.error("Failed to load products:", { error: result.error });
            }
        } catch (error) {
            logger.error("Failed to load products:", { error });
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [filterStatus, debouncedSearch, lastId]); // lastId dependency is tricky here

    // Effect for Search and Filter changes (Reset)
    useEffect(() => {
        fetchProducts(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterStatus, debouncedSearch]);

    const handleLoadMore = () => {
        if (!loadingMore && hasMore) {
            fetchProducts(false);
        }
    };

    const handleDeleteProduct = async (productId: string, productTitle: string) => {
        if (!confirm(`Are you sure you want to delete "${productTitle}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteProductAction(productId);
            if (result.success) {
                showToast("Product deleted successfully", "success");
                // Remove from local state
                setProducts(prev => prev.filter(p => p.id !== productId));
            } else {
                showToast(result.error || "Failed to delete product", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting", "error");
            logger.error("Delete product error:", { error });
        }
    };

    const getStatusConfig = (status: string) => {
        const configs: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: "bg-green-100", text: "text-green-700", label: "Active" },
            draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Draft" },
            out_of_stock: { bg: "bg-red-100", text: "text-red-700", label: "Out of Stock" },
            suspended: { bg: "bg-red-100", text: "text-red-700", label: "Suspended" }
        };
        // Helper logic for low stock which isn't a direct status but a derived state
        if (status === "low_stock") {
            return { bg: "bg-orange-100", text: "text-orange-700", label: "Low Stock" };
        }
        return configs[status] || configs.active;
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <BackButton fallbackPath="/marketplace/seller/dashboard" />
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                My Products
                            </h1>
                            <p className="text-slate-600">
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
                <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search products or categories..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
                                        : "bg-slate-100 text-slate-900 hover:bg-slate-200"
                                        }`}
                                >
                                    {status === "all" ? "All" : status.replace("_", " ")}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Products Table */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Product
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Category
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Price
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Stock
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Sold
                                </th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                    Status
                                </th>
                                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading && products.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center">
                                        <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto" />
                                    </td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                                        No products found. <Link href="/marketplace/sell/create" className="text-green-600 hover:underline">Add your first product</Link>
                                    </td>
                                </tr>
                            ) : (
                                products.map((product) => {
                                    // Determine display status (check for low stock overrides)
                                    let displayStatus = product.status;
                                    if (product.status === "active" && product.availableQuantity < 50 && product.availableQuantity > 0) {
                                        displayStatus = "low_stock" as any;
                                    }

                                    const statusConfig = getStatusConfig(displayStatus);
                                    const retailPrice = product.pricingTiers?.find(t => t.type === "retail")?.price || product.pricingTiers?.[0]?.price || 0;

                                    return (
                                        <tr key={product.id} className="hover:bg-slate-50">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-semibold text-slate-900 line-clamp-1">
                                                        {product.title}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1 text-sm text-slate-600">
                                                        <Eye className="w-4 h-4" />
                                                        <span>{product.views || 0} views</span>
                                                        <span>•</span>
                                                        <span>★ {product.rating || 0}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 capitalize">
                                                {product.category}
                                            </td>
                                            <td className="px-6 py-4 font-semibold text-slate-900">
                                                {formatCurrency(retailPrice)}/{product.unit}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`font-semibold ${product.availableQuantity === 0 ? 'text-red-600' :
                                                    product.availableQuantity < 50 ? 'text-orange-600' :
                                                        'text-green-600'
                                                    }`}>
                                                    {product.availableQuantity} {product.unit}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-900">
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
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                                        title="View"
                                                    >
                                                        <Eye className="w-5 h-5" />
                                                    </Link>
                                                    <Link
                                                        href={`/marketplace/seller/products/${product.id}/edit`}
                                                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                                                        title="Edit"
                                                    >
                                                        <Edit className="w-5 h-5" />
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDeleteProduct(product.id, product.title)}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
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

                {/* Load More */}
                {hasMore && (
                    <div className="mt-8 flex justify-center">
                        <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="px-6 py-3 bg-white border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition flex items-center gap-2 disabled:opacity-50"
                        >
                            {loadingMore ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                "Load More Products"
                            )}
                        </button>
                    </div>
                )}

                {/* Low Stock Alert */}
                {products.some(p => p.availableQuantity < 50 && p.availableQuantity > 0) && (
                    <div className="mt-6 bg-orange-50 border border-orange-200 rounded-xl p-6">
                        <div className="flex items-start gap-4">
                            <AlertCircle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold text-orange-900 mb-2">
                                    Stock Alert
                                </h3>
                                <p className="text-sm text-orange-800 mb-3">
                                    You have products with low stock. Restock soon to avoid lost sales.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
