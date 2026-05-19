"use client";

import { useState } from "react";
import { X, Send, Loader2, Package, Calendar, MessageSquare } from "lucide-react";
import { submitQuoteRequestAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";

interface QuoteRequestModalProps {
    isOpen: boolean;
    item: {
        id: string;
        title: string;
        sellerId: string;
        unit: string;
        sellerName?: string;
    };
    onClose: () => void;
    theme?: "marketplace" | "export";
}

export default function QuoteRequestModal({ isOpen, item, onClose, theme = "marketplace" }: QuoteRequestModalProps) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [notes, setNotes] = useState("");
    const [deliveryDate, setDeliveryDate] = useState("");

    if (!isOpen) return null;

    const isExport = theme === "export";
    const primaryColor = isExport ? "blue" : "green";
    const fromColor = isExport ? "from-blue-600" : "from-green-600";
    const toColor = isExport ? "to-indigo-600" : "to-emerald-600";
    const focusRing = isExport ? "focus:ring-blue-500" : "focus:ring-green-500";
    const bgColor = isExport ? "bg-blue-100" : "bg-green-100";
    const textColor = isExport ? "text-blue-600" : "text-green-600";
    const btnColor = isExport ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700";
    const shadowColor = isExport ? "hover:shadow-blue-200" : "hover:shadow-green-200";

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);

        try {
            const result = await submitQuoteRequestAction({
                productId: item.id,
                productName: item.title,
                sellerId: item.sellerId,
                quantity: quantity,
                unit: item.unit,
                notes: notes,
                preferredDeliveryDate: deliveryDate
            });

            if (result.success) {
                showToast(result.data?.message || "Quote request submitted successfully", "success");
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
                <div className={`bg-linear-to-r ${fromColor} ${toColor} p-6 text-white flex justify-between items-center`}>
                    <div>
                        <h2 className="text-xl font-bold">Request for Quote</h2>
                        <p className={`${isExport ? "text-blue-100" : "text-green-100"} text-sm`}>
                            {isExport ? "Send a custom aggregation inquiry" : "Send a custom inquiry to the seller"}
                        </p>
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
                        <div className={`w-12 h-12 ${bgColor} rounded-xl flex items-center justify-center ${textColor}`}>
                            <Package className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-sm text-slate-500">{isExport ? "Aggregation Window" : "Product"}</div>
                            <div className="font-bold text-slate-900 line-clamp-1">{item.title}</div>
                        </div>
                    </div>

                    {/* Quantity Field */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <Package className={`w-4 h-4 ${textColor}`} />
                            Quantity Needed ({item.unit})
                        </label>
                        <input
                            type="number"
                            required
                            min="1"
                            value={quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                            className={`w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 ${focusRing} transition`}
                            placeholder="Enter quantity"
                        />
                    </div>

                    {/* Delivery Date */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <Calendar className={`w-4 h-4 ${textColor}`} />
                            Preferred Delivery Date (Optional)
                        </label>
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className={`w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 ${focusRing} transition`}
                        />
                    </div>

                    {/* Notes Field */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <MessageSquare className={`w-4 h-4 ${textColor}`} />
                            Additional Requirements / Notes
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={4}
                            className={`w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 ${focusRing} transition resize-none`}
                            placeholder="Explain any specific requirements, packing needs, or logistics questions..."
                        />
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-4 ${btnColor} text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg ${shadowColor} disabled:bg-slate-300 disabled:cursor-not-allowed`}
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
