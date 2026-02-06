"use client";

import { useState, useEffect } from "react";
import { Package, Clock, Users, TrendingUp } from "lucide-react";
import CountdownTimer from "@/components/CountdownTimer";
import BookingModal from "@/components/modals/BookingModal";
import type { ExportWindow } from "@/app/actions/export-aggregation";

export default function ExportWindowsPage() {
    const [windows, setWindows] = useState<ExportWindow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedWindow, setSelectedWindow] = useState<ExportWindow | null>(null);

    useEffect(() => {
        // Mock data - in real app, fetch from API
        setWindows([
            {
                id: "1",
                title: "Cashew Nuts Export - Europe",
                commodity: "Cashew Nuts",
                targetVolume: 50000,
                currentVolume: 28500,
                slotPrice: 1200,
                startDate: new Date("2026-02-01"),
                endDate: new Date("2026-03-15"),
                destination: "Rotterdam, Netherlands",
                status: "open",
                createdAt: { seconds: Date.now() / 1000 } as any,
                createdBy: "admin",
            },
            {
                id: "2",
                title: "Ginger Export - Dubai",
                commodity: "Fresh Ginger",
                targetVolume: 30000,
                currentVolume: 15200,
                slotPrice: 950,
                startDate: new Date("2026-02-10"),
                endDate: new Date("2026-03-01"),
                destination: "Dubai, UAE",
                status: "open",
                createdAt: { seconds: Date.now() / 1000 } as any,
                createdBy: "admin",
            },
        ]);
        setLoading(false);
    }, []);

    if (loading) {
        return <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
            <div className="text-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-slate-600 dark:text-slate-400">Loading export windows...</p>
            </div>
        </div>;
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Export Aggregation Windows
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Join active export windows and boost your volume
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {windows.map((window) => {
                        const progressPercent = Math.round((window.currentVolume / window.targetVolume) * 100);
                        const availableVolume = window.targetVolume - window.currentVolume;

                        return (
                            <div
                                key={window.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden"
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
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                Volume Progress
                                            </span>
                                            <span className="text-sm font-bold text-blue-600">
                                                {progressPercent}%
                                            </span>
                                        </div>

                                        <div className="w-full h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
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

                                    <button
                                        onClick={() => {
                                            setSelectedWindow(window);
                                            setIsModalOpen(true);
                                        }}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition shadow-lg shadow-blue-500/30"
                                    >
                                        Book Your Slot
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Booking Modal */}
                <BookingModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedWindow(null);
                    }}
                    exportWindow={selectedWindow}
                />
            </div>
        </div>
    );
}
