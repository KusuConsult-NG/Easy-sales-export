"use client";

import { useEffect, useState, useCallback } from "react";
import { logger } from '@/lib/logger';
import {
    Package, Plus, Edit, Trash2, CheckCircle, XCircle, Loader2, Search, Filter, Briefcase, DollarSign, Pencil, X
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency } from "@/lib/utils";
import { useAdminData } from "@/hooks/useAdminData";
import { 
    getAdminLoanProductsAction, 
    createAdminLoanProductAction, 
    updateAdminLoanProductAction, 
    deleteAdminLoanProductAction,
    type LoanProduct 
} from "@/app/actions/loan-products";
// The default rate an admin sees pre-filled must be the platform's stated
// rate, not a copy of whatever it was when this form was written.
import { DEFAULT_MONTHLY_INTEREST_RATE } from "@/lib/cooperative-tiers";

export default function LoanProductsPage() {
    const { showToast } = useToast();

    const {
        data: products,
        loading: isLoading,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: fetchProducts
    } = useAdminData<LoanProduct>({
        fetchAction: async (opts) => {
            const result = await getAdminLoanProductsAction({
                limit: opts.limit || 20,
                lastDocId: opts.lastDocId
            });
            return {
                success: result.success,
                data: result.success ? result.data : [],
                lastDocId: result.success ? result.lastDocId : undefined,
                hasMore: result.success ? result.hasMore : false,
                error: result.success ? null : result.error
            };
        },
        limit: 20
    });
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<LoanProduct | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        minAmount: 50000,
        maxAmount: 500000,
        interestRate: DEFAULT_MONTHLY_INTEREST_RATE,
        durationMonths: 12,
        isActive: true
    });

    function handleOpenModal(product?: LoanProduct) {
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
                interestRate: DEFAULT_MONTHLY_INTEREST_RATE,
                durationMonths: 12,
                isActive: true
            });
        }
        setIsModalOpen(true);
    };

    function handleCloseModal() {
        setIsModalOpen(false);
        setEditingProduct(null);
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        try {
            let data;
            if (editingProduct) {
                data = await updateAdminLoanProductAction(editingProduct.id!, formData);
            } else {
                data = await createAdminLoanProductAction(formData);
            }

            if (data.success) {
                showToast("Product saved successfully", "success");
                handleCloseModal();
                fetchProducts();
            } else {
                showToast(data.error || "Failed to save product", "error");
            }
        } catch (error) {
            showToast("An error occurred while saving the product", "error");
        }
    };

    async function handleDelete(productId: string) {
        if (!confirm("Are you sure you want to delete this loan product?")) {
            return;
        }

        try {
            const data = await deleteAdminLoanProductAction(productId);

            if (data.success) {
                showToast("Product deleted successfully", "success");
                fetchProducts();
            } else {
                showToast(data.error || "Failed to delete product", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting the product", "error");
        }
    };

    return (
        <div className="p-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Loan Products
                    </h1>
                    <p className="text-slate-600">
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
                <div className="bg-white rounded-xl p-12 text-center shadow-lg">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading products...</p>
                </div>
            ) : products.length === 0 ? (
                <div className="bg-white rounded-xl p-12 text-center shadow-lg">
                    <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">
                        No Loan Products
                    </h3>
                    <p className="text-slate-600 mb-6">
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
                            className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-12 h-12 bg-linear-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                                    <DollarSign className="w-6 h-6 text-white" />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleOpenModal(product)}
                                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                                    >
                                        <Pencil className="w-4 h-4 text-slate-600" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(product.id!)}
                                        className="p-2 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-600" />
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {product.name}
                            </h3>
                            <p className="text-sm text-slate-600 mb-4">
                                {product.description}
                            </p>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Amount Range</span>
                                    <span className="font-bold text-slate-900">
                                        {formatCurrency(product.minAmount)} - {formatCurrency(product.maxAmount)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Interest Rate</span>
                                    <span className="font-bold text-blue-600">
                                        {product.interestRate}% per month
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Duration</span>
                                    <span className="font-bold text-slate-900">
                                        {product.durationMonths} months
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Status</span>
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${product.isActive
                                        ? "bg-green-100 text-green-700"
                                        : "bg-slate-100 text-slate-900"
                                        }`}>
                                        {product.isActive ? "Active" : "Inactive"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            
            {/* Pagination Controls */}
            {products.length > 0 && !isLoading && (
                <div className="flex items-center justify-between mt-8 p-4 bg-white rounded-xl shadow-lg border border-slate-100">
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

            {/* Create/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900">
                                {editingProduct ? "Edit Loan Product" : "Create Loan Product"}
                            </h2>
                            <button
                                onClick={handleCloseModal}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6 text-slate-600" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Product Name
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g., Quick Business Loan"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-900 mb-2">
                                    Description
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    required
                                    rows={3}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Describe the loan product..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Minimum Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.minAmount}
                                        onChange={(e) => setFormData({ ...formData, minAmount: Number(e.target.value) })}
                                        required
                                        min="0"
                                        step="10000"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Maximum Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.maxAmount}
                                        onChange={(e) => setFormData({ ...formData, maxAmount: Number(e.target.value) })}
                                        required
                                        min={formData.minAmount}
                                        step="10000"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
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
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                                        Duration (Months)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.durationMonths}
                                        onChange={(e) => setFormData({ ...formData, durationMonths: Number(e.target.value) })}
                                        required
                                        min="1"
                                        max="60"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                <label htmlFor="isActive" className="text-sm font-semibold text-slate-900">
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
                                    className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl transition-all"
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
