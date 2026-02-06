"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { X, Package, Calendar, DollarSign, AlertCircle, CheckCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { createExportWindowAction, type CreateExportActionState } from "@/app/actions/export";

const initialState: CreateExportActionState = { error: "Initializing...", success: false };

interface ExportWindowModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ExportWindowModal({ isOpen, onClose }: ExportWindowModalProps) {
    const [state, formAction, isPending] = useFormState(createExportWindowAction, initialState);

    // Reset form and close modal on success
    if (state.success && !isPending) {
        setTimeout(() => {
            onClose();
            window.location.reload(); // Refresh to show new export
        }, 2000);
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Export Window">
            <form action={formAction} className="space-y-4">
                {/* Error Display */}
                {state.error && !state.success && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{state.error}</p>
                    </div>
                )}

                {/* Success Display */}
                {state.success && state.message && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-green-300 text-sm font-medium">{state.message}</p>
                            {('orderId' in state) && (
                                <p className="text-green-400 text-xs mt-1">Order ID: {state.orderId}</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Commodity Selection */}
                <div>
                    <label htmlFor="commodity" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <Package className="w-4 h-4 inline mr-2" />
                        Commodity Type
                    </label>
                    <select
                        id="commodity"
                        name="commodity"
                        required
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    >
                        <option value="">Select commodity...</option>
                        <option value="yam">🌾 Yam Tubers</option>
                        <option value="sesame">🌰 Sesame Seeds</option>
                        <option value="hibiscus">🌺 Hibiscus (Zobo)</option>
                        <option value="other">📦 Other</option>
                    </select>
                </div>

                {/* Quantity */}
                <div>
                    <label htmlFor="quantity" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Quantity (kg/tons)
                    </label>
                    <input
                        type="text"
                        id="quantity"
                        name="quantity"
                        required
                        placeholder="e.g., 500 tons"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    />
                </div>

                {/* Amount */}
                <div>
                    <label htmlFor="amount" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <DollarSign className="w-4 h-4 inline mr-2" />
                        Amount (₦)
                    </label>
                    <input
                        type="number"
                        id="amount"
                        name="amount"
                        required
                        min="0"
                        step="1000"
                        placeholder="e.g., 50000000"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Total value of the export window
                    </p>
                </div>

                {/* Delivery Date (Optional) */}
                <div>
                    <label htmlFor="deliveryDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <Calendar className="w-4 h-4 inline mr-2" />
                        Expected Delivery Date (Optional)
                    </label>
                    <input
                        type="date"
                        id="deliveryDate"
                        name="deliveryDate"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Escrow will be released 30 days after delivery
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isPending}
                        className="flex-1 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isPending}
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? "Creating..." : "Create Export Window"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
