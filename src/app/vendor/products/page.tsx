"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Edit, Trash2, ToggleLeft, ToggleRight, Loader2, Search } from "lucide-react";
import { getVendorProductsAction, toggleVendorProductStatusAction, updateVendorProductInventoryAction, deleteVendorProductAction } from "@/app/actions/vendor";
import type { VendorProduct } from "@/app/actions/vendor";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

export default function VendorProductsPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [products, setProducts] = useState<VendorProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<VendorProduct["status"] | "all">("all");

    useEffect(() => {
        loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterStatus]);

    async function loadProducts() {
        setLoading(true);
        try {
            const filters = filterStatus !== "all" ? { status: filterStatus } : undefined;
            const result = await getVendorProductsAction(filters);

            if (result.success) {
                setProducts(result.data?.products || []);
            } else {
                showToast(result.error || "Failed to load products", "error");
            }
        } catch (error) {
            showToast("Failed to load products", "error");
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatus = async (productId: string) => {
        try {
            const result = await toggleVendorProductStatusAction(productId);
            if (result.success) {
                showToast("Product status updated", "success");
                loadProducts();
            } else {
                showToast(result.error || "Failed to update status", "error");
            }
        } catch (error) {
            showToast("Failed to update status", "error");
        }
    };

    const handleDeleteProduct = async (productId: string, productName: string) => {
        if (!confirm(`Delete "${productName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteVendorProductAction(productId);
            if (result.success) {
                showToast(result.data?.message || "Product deleted successfully", "success");
                loadProducts();
            } else {
                showToast(result.error || "Failed to delete product", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting product", "error");
        }
    };

    const filteredProducts = products.filter(p =>
        searchQuery === "" ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const stats = {
        total: products.length,
        active: products.filter(p => p.status === "active").length,
        outOfStock: products.filter(p => p.status === "out_of_stock").length,
        totalValue: products.reduce((sum, p) => sum + (p.price * p.stock), 0),
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            Product Catalog
                        </h1>
                        <p className="text-gray-600">
                            Manage your product inventory
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/vendor/products/new")}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Add Product
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600">Total Products</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600">Active</p>
                        <p className="text-2xl font-bold text-green-600">{stats.active}</p>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600">Out of Stock</p>
                        <p className="text-2xl font-bold text-red-600">{stats.outOfStock}</p>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600">Total Value</p>
                        <p className="text-xl font-bold text-purple-600">{formatCurrency(stats.totalValue)}</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl p-4 shadow mb-6">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-gray-100 border-none rounded-lg text-gray-900"
                            />
                        </div>
                        <div className="flex gap-2">
                            {[
                                { key: "all", label: "All" },
                                { key: "active", label: "Active" },
                                { key: "inactive", label: "Inactive" },
                                { key: "out_of_stock", label: "Out of Stock" }
                            ].map((f) => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilterStatus(f.key as "all" | "active" | "inactive" | "out_of_stock")}
                                    className={`px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${filterStatus === f.key
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 text-gray-600"
                                        }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Products Table */}
                {filteredProducts.length === 0 ? (
                    <div className="bg-white rounded-xl p-12 text-center shadow">
                        <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900 mb-2">No Products Found</h3>
                        <p className="text-gray-600 mb-6">
                            {searchQuery || filterStatus !== "all"
                                ? "No products match your filters"
                                : "Get started by adding your first product"}
                        </p>
                        {filteredProducts.length === 0 && searchQuery === "" && filterStatus === "all" && (
                            <button
                                onClick={() => router.push("/vendor/products/new")}
                                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition"
                            >
                                Add Your First Product
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Product</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">SKU</th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Price</th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Stock</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredProducts.map((product) => (
                                        <tr key={product.id} className="hover:bg-gray-50 transition">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-semibold text-gray-900">{product.name}</p>
                                                    <p className="text-sm text-gray-500">{product.category}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-mono text-sm text-gray-600">
                                                {product.sku}
                                            </td>
                                            <td className="px-6 py-4 text-right font-semibold text-gray-900">
                                                {formatCurrency(product.price)}/{product.unit}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className={`font-bold ${product.stock === 0 ? "text-red-600" :
                                                    product.stock <= product.reorderLevel ? "text-yellow-600" :
                                                        "text-green-600"
                                                    }`}>
                                                    {product.stock} {product.unit}
                                                </span>
                                                {product.stock <= product.reorderLevel && product.stock > 0 && (
                                                    <p className="text-xs text-yellow-600 mt-1">Low stock!</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold capitalize ${product.status === "active" ? "bg-green-100 text-green-700" :
                                                    product.status === "out_of_stock" ? "bg-red-100 text-red-700" :
                                                        "bg-gray-100 text-gray-700"
                                                    }`}>
                                                    {product.status.replace("_", " ")}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleToggleStatus(product.id)}
                                                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                        title={product.status === "active" ? "Deactivate" : "Activate"}
                                                    >
                                                        {product.status === "active" ? (
                                                            <ToggleRight className="w-5 h-5 text-green-600" />
                                                        ) : (
                                                            <ToggleLeft className="w-5 h-5 text-gray-400" />
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => router.push(`/vendor/products/${product.id}`)}
                                                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                        title="Edit"
                                                    >
                                                        <Edit className="w-5 h-5 text-blue-600" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteProduct(product.id, product.name)}
                                                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-5 h-5 text-red-600" />
                                                    </button>

                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
