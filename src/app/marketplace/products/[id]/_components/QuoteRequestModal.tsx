"use client";

import { useState } from "react";
import { X, Send, Loader2, Package, Calendar, MessageSquare } from "lucide-react";
import { submitQuoteRequestAction } from "@/app/actions/marketplace-quotes";
import { useToast } from "@/contexts/ToastContext";

interface QuoteRequestModalProps {
    product: {
        id: string;
        title: string;
        sellerId: string;
        unit: string;
        sellerName?: string;
    };
    onClose: () => void;
}

export default function QuoteRequestModal({ product, onClose }: QuoteRequestModalProps) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [notes, setNotes] = useState("");
    const [deliveryDate, setDeliveryDate] = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);

        try {
            const result = await submitQuoteRequestAction({
                productId: product.id,
                productName: product.title,
                sellerId: product.sellerId,
                quantity: quantity,
                unit: product.unit,
                notes: notes,
                preferredDeliveryDate: deliveryDate
            });

            if (result.success) {
                showToast(result.message || "Quote request submitted successfully", "success");
                onClose();
            } else {
                showToast(result.error || "Failed to submit quote request", "error");
            }
        } catch (error) {
            showToast("An unexpected error occurred", "error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="bg-linear-to-r from-green-600 to-emerald-600 p-6 text-white flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold">Request for Quote</h2>
                        <p className="text-green-100 text-sm">Send a custom inquiry to the seller</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-white/20 rounded-full transition"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {/* Product Summary */}
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-green-600">
                            <Package className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-sm text-slate-500">Product</div>
                            <div className="font-bold text-slate-900 line-clamp-1">{product.title}</div>
                        </div>
                    </div>

                    {/* Quantity Field */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <Package className="w-4 h-4 text-green-600" />
                            Quantity Needed ({product.unit})
                        </label>
                        <input
                            type="number"
                            required
                            min="1"
                            value={quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                            placeholder="Enter quantity"
                        />
                    </div>

                    {/* Delivery Date */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-green-600" />
                            Preferred Delivery Date (Optional)
                        </label>
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                        />
                    </div>

                    {/* Notes Field */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-green-600" />
                            Additional Requirements / Notes
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={4}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition resize-none"
                            placeholder="Explain any specific requirements, packing needs, or logistics questions..."
                        />
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-green-200 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                Submit Quote Request
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
