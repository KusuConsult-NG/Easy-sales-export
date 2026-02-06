"use client";

import { useState } from "react";
import { X, Package, Hash, Loader2, CheckCircle } from "lucide-react";
import type { ExportWindow } from "@/app/actions/export-aggregation";

interface BookingModalProps {
    isOpen: boolean;
    onClose: () => void;
    exportWindow: ExportWindow | null;
}

export default function BookingModal({ isOpen, onClose, exportWindow }: BookingModalProps) {
    const [quantity, setQuantity] = useState<number>(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    if (!isOpen || !exportWindow) return null;

    const availableVolume = exportWindow.targetVolume - exportWindow.currentVolume;
    const totalPrice = quantity * exportWindow.slotPrice;

    const handleSubmit = async () => {
        if (quantity <= 0 || quantity > availableVolume) {
            alert(`Please enter a quantity between 1 and ${availableVolume}kg`);
            return;
        }

        setIsSubmitting(true);

        // Simulate booking persistence
        try {
            // TODO: Replace with actual Firestore booking action
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // Store booking locally for now
            const booking = {
                id: `BOOK-${Date.now()}`,
                exportWindowId: exportWindow.id,
                quantity,
                totalPrice,
                status: "pending",
                createdAt: new Date().toISOString(),
            };

            const existingBookings = JSON.parse(
                localStorage.getItem("export_bookings") || "[]"
            );
            existingBookings.push(booking);
            localStorage.setItem("export_bookings", JSON.stringify(existingBookings));

            setIsSuccess(true);
            setTimeout(() => {
                onClose();
                setIsSuccess(false);
                setQuantity(1);
                setIsSubmitting(false);
            }, 2000);
        } catch (error) {
            alert("Booking failed. Please try again.");
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div
                className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 animate-[slideInUp_0.3s_ease-out]"
                onClick={(e) => e.stopPropagation()}
            >
                {isSuccess ? (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            Booking Submitted!
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Your slot reservation is pending confirmation
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-start justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                                    Book Your Slot
                                </h2>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {exportWindow.title}
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Window Details */}
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <Package className="w-4 h-4" />
                                    <span>Commodity</span>
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                    {exportWindow.commodity}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <Hash className="w-4 h-4" />
                                    <span>Price per kg</span>
                                </div>
                                <span className="font-semibold text-primary">
                                    ₦{exportWindow.slotPrice.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <Package className="w-4 h-4" />
                                    <span>Available</span>
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                    {availableVolume.toLocaleString()}kg
                                </span>
                            </div>
                        </div>

                        {/* Quantity Input */}
                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Quantity (kg)
                            </label>
                            <input
                                type="number"
                                min="1"
                                max={availableVolume}
                                value={quantity}
                                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                                className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Maximum: {availableVolume.toLocaleString()}kg
                            </p>
                        </div>

                        {/* Total */}
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                    Total Amount
                                </span>
                                <span className="text-2xl font-bold text-primary">
                                    ₦{totalPrice.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting || quantity <= 0 || quantity > availableVolume}
                                className="flex-1 px-4 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Booking...
                                    </>
                                ) : (
                                    "Confirm Booking"
                                )}
                            </button>
                        </div>

                        <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-4">
                            Pending confirmation - payment details will be sent to your email
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
