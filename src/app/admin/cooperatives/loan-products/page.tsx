"use client";

import { useEffect, useState } from "react";
import {
    Package, Plus, Pencil, Trash2, DollarSign,
    Calendar, TrendingUp, X
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type LoanProduct = {
    id: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;
    durationMonths: number;
    isActive: boolean;
};

export default function LoanProductsPage() {
    const [products, setProducts] = useState<LoanProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<LoanProduct | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        minAmount: 50000,
        maxAmount: 500000,
        interestRate: 5,
        durationMonths: 12,
        isActive: true
    });

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/admin/cooperative/loan-products");
            const data = await response.json();

            if (data.success) {
                setProducts(data.products || []);
            }
        } catch (error) {
            console.error("Failed to fetch products:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenModal = (product?: LoanProduct) => {
        if (product) {
            setEditingProduct(product);
            setFormData({
                name: product.name,
                description: product.description,
                minAmount: product.minAmount,
                maxAmount: product.maxAmount,
                interestRate: product.interestRate,
                durationMonths: product.durationMonths,
                isActive: product.isActive
            });
        } else {
            setEditingProduct(null);
            setFormData({
                name: "",
                description: "",
                minAmount: 50000,
                maxAmount: 500000,
                interestRate: 5,
                durationMonths: 12,
                isActive: true
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingProduct(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const url = editingProduct
                ? "/api/admin/cooperative/update-loan-product"
                : "/api/admin/cooperative/create-loan-product";

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    productId: editingProduct?.id
                }),
            });

            const data = await response.json();

            if (data.success) {
                alert(editingProduct ? "Product updated successfully!" : "Product created successfully!");
                handleCloseModal();
                fetchProducts();
            } else {
                alert(data.message || "Failed to save product");
            }
        } catch (error) {
            alert("An error occurred while saving the product");
        }
    };

    const handleDelete = async (productId: string) => {
        if (!confirm("Are you sure you want to delete this loan product?")) {
            return;
        }

        try {
            const response = await fetch("/api/admin/cooperative/delete-loan-product", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Product deleted successfully");
                fetchProducts();
            } else {
                alert(data.message || "Failed to delete product");
            }
        } catch (error) {
            alert("An error occurred while deleting the product");
        }
    };

    return (
        <div className="p-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Loan Products
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Manage available loan products for cooperative members
                    </p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="px-6 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" />
                    Add Product
                </button>
            </div>

            {isLoading ? (
                <div className="bg-white dark:bg-slate-800 rounded-xl p-12 text-center shadow-lg">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading products...</p>
                </div>
            ) : products.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-xl p-12 text-center shadow-lg">
                    <Package className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                        No Loan Products
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Create your first loan product to get started
                    </p>
                    <button
                        onClick={() => handleOpenModal()}
                        className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all"
                    >
                        Add Product
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products.map((product) => (
                        <div
                            key={product.id}
                            className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition-all"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-12 h-12 bg-linear-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                                    <DollarSign className="w-6 h-6 text-white" />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleOpenModal(product)}
                                        className="p-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                                    >
                                        <Pencil className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(product.id)}
                                        className="p-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                {product.name}
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                {product.description}
                            </p>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Amount Range</span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {formatCurrency(product.minAmount)} - {formatCurrency(product.maxAmount)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Interest Rate</span>
                                    <span className="font-bold text-blue-600 dark:text-blue-400">
                                        {product.interestRate}% APR
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Duration</span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {product.durationMonths} months
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Status</span>
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${product.isActive
                                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                            : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-400"
                                        }`}>
                                        {product.isActive ? "Active" : "Inactive"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                {editingProduct ? "Edit Loan Product" : "Create Loan Product"}
                            </h2>
                            <button
                                onClick={handleCloseModal}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6 text-slate-600 dark:text-slate-400" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    Product Name
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., Quick Business Loan"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    Description
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    required
                                    rows={3}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Describe the loan product..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Minimum Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.minAmount}
                                        onChange={(e) => setFormData({ ...formData, minAmount: Number(e.target.value) })}
                                        required
                                        min="0"
                                        step="10000"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Maximum Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.maxAmount}
                                        onChange={(e) => setFormData({ ...formData, maxAmount: Number(e.target.value) })}
                                        required
                                        min={formData.minAmount}
                                        step="10000"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Interest Rate (%)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.interestRate}
                                        onChange={(e) => setFormData({ ...formData, interestRate: Number(e.target.value) })}
                                        required
                                        min="0"
                                        max="100"
                                        step="0.1"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                        Duration (Months)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.durationMonths}
                                        onChange={(e) => setFormData({ ...formData, durationMonths: Number(e.target.value) })}
                                        required
                                        min="1"
                                        max="60"
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="isActive"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <label htmlFor="isActive" className="text-sm font-semibold text-slate-900 dark:text-white">
                                    Product is active (visible to members)
                                </label>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button
                                    type="submit"
                                    className="flex-1 px-6 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all"
                                >
                                    {editingProduct ? "Update Product" : "Create Product"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="px-6 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-bold rounded-xl transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
