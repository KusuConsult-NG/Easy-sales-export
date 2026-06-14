"use client";

import { useState, useEffect } from "react";
import { Package, Loader2, ServerCrash, RefreshCw } from "lucide-react";
import CountdownTimer from "@/components/CountdownTimer";
import BookingWizard from "@/components/modals/BookingWizard";
import QuoteRequestModal from "@/components/modals/QuoteRequestModal";
import { getActiveExportWindowsAction } from "@/app/actions/export-aggregation";
import type { ExportWindow } from "@/app/actions/export-aggregation";

export default function ExportWindowsPage() {
    const [windows, setWindows] = useState<ExportWindow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
    const [selectedWindow, setSelectedWindow] = useState<ExportWindow | null>(null);

    async function loadWindows() {
        setLoading(true);
        setError(null);
        try {
            const result = await getActiveExportWindowsAction();
            if (result.success) {
                // Deserialise dates that may arrive as strings from server serialization
                const normalized = (result.data || []).map((w: any) => ({
                    ...w,
                    startDate: w.startDate ? new Date(w.startDate) : new Date(),
                    endDate: w.endDate ? new Date(w.endDate) : new Date(),
                }));
                setWindows(normalized);
            } else {
                setError("Failed to load export windows. Please try again.");
            }
        } catch {
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadWindows();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading export windows...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center max-w-sm">
                    <ServerCrash className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <p className="text-slate-700 font-semibold mb-2">Could not load windows</p>
                    <p className="text-slate-500 text-sm mb-4">{error}</p>
                    <button
                        onClick={loadWindows}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
                    >
                        <RefreshCw className="w-4 h-4" /> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Export Aggregation Windows
                    </h1>
                    <p className="text-slate-600">
                        Join active export windows and boost your volume
                    </p>
                </div>

                {windows.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-16 text-center">
                        <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-slate-700 mb-2">No Open Windows</h2>
                        <p className="text-slate-500 max-w-sm mx-auto">
                            There are no active export windows at the moment. Check back soon or contact support to learn about upcoming opportunities.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {windows.map((window) => {
                            const progressPercent = window.targetVolume > 0
                                ? Math.min(100, Math.round((window.currentVolume / window.targetVolume) * 100))
                                : 0;
                            const availableVolume = Math.max(0, window.targetVolume - window.currentVolume);

                            return (
                                <div
                                    key={window.id}
                                    className="bg-white rounded-2xl shadow-lg overflow-hidden"
                                >
                                    <div className="bg-linear-to-r from-blue-600 to-indigo-600 text-white p-6">
                                        <div className="flex items-start justify-between mb-4">
                                            <div>
                                                <h2 className="text-2xl font-bold mb-1">{window.title}</h2>
                                                <p className="text-blue-100">{window.commodity}</p>
                                            </div>
                                            <Package className="w-8 h-8" />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-blue-100 text-sm">Destination</p>
                                                <p className="font-semibold">{window.destination}</p>
                                            </div>
                                            <div>
                                                <p className="text-blue-100 text-sm">Price/kg</p>
                                                <p className="font-semibold">₦{window.slotPrice.toLocaleString()}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-6 space-y-6">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-slate-900">
                                                    Volume Progress
                                                </span>
                                                <span className="text-sm font-bold text-blue-600">
                                                    {progressPercent}%
                                                </span>
                                            </div>

                                            <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-linear-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                                                    style={{ width: `${progressPercent}%` }}
                                                />
                                            </div>

                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-xs text-slate-500">
                                                    {window.currentVolume.toLocaleString()}kg filled
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {availableVolume.toLocaleString()}kg available
                                                </span>
                                            </div>
                                        </div>

                                        <CountdownTimer endDate={new Date(window.endDate)} />

                                        <div className="flex flex-col gap-3">
                                            <button
                                                onClick={() => {
                                                    setSelectedWindow(window);
                                                    setIsModalOpen(true);
                                                }}
                                                disabled={availableVolume === 0}
                                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition shadow-lg shadow-blue-500/30"
                                            >
                                                {availableVolume === 0 ? "Window Full" : "Book Your Slot"}
                                            </button>

                                            <button
                                                onClick={() => {
                                                    setSelectedWindow(window);
                                                    setIsQuoteModalOpen(true);
                                                }}
                                                className="w-full bg-white border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold py-3 px-6 rounded-lg transition"
                                            >
                                                Request for Quote
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Booking Wizard */}
                <BookingWizard
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedWindow(null);
                    }}
                    exportWindow={selectedWindow}
                />

                {selectedWindow && (
                    <QuoteRequestModal
                        isOpen={isQuoteModalOpen}
                        onClose={() => {
                            setIsQuoteModalOpen(false);
                            setSelectedWindow(null);
                        }}
                        item={{
                            id: selectedWindow.id || "",
                            title: selectedWindow.title || "Export Window",
                            sellerId: "admin_export", // Export windows are managed by admin/platform
                            unit: "kg",
                            sellerName: "Export Aggregation"
                        }}
                        theme="export"
                    />
                )}
            </div>
        </div>
    );
}
