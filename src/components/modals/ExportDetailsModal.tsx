"use client";

import { Package, Calendar, DollarSign, TrendingUp, MapPin, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import Modal from "@/components/ui/Modal";

type ExportStatus = "pending" | "in_transit" | "delivered" | "completed";

interface ExportWindow {
    id: string;
    orderId: string;
    commodity: string;
    quantity: string;
    amount: number;
    status: ExportStatus;
    createdAt: Date;
    updatedAt: Date;
    deliveryDate?: Date;
    escrowReleaseDate?: Date;
}

interface ExportDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    exportWindow: ExportWindow;
}

export default function ExportDetailsModal({
    isOpen,
    onClose,
    exportWindow
}: ExportDetailsModalProps) {
    const formatDate = (date: Date | undefined) => {
        if (!date) return "Not set";
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric"
        }).format(new Date(date));
    };

    const getStatusColor = (status: ExportStatus) => {
        switch (status) {
            case "delivered":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            case "in_transit":
                return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
            case "pending":
                return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
            case "completed":
                return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
            default:
                return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400";
        }
    };

    // Timeline based on status
    const timeline = [
        {
            stage: "Order Created",
            date: formatDate(exportWindow.createdAt),
            completed: true
        },
        {
            stage: "Processing",
            date: exportWindow.status !== "pending" ? formatDate(exportWindow.updatedAt) : "Pending",
            completed: exportWindow.status !== "pending"
        },
        {
            stage: "In Transit",
            date: exportWindow.status === "in_transit" || exportWindow.status === "delivered" || exportWindow.status === "completed"
                ? formatDate(exportWindow.updatedAt)
                : "Awaiting",
            completed: exportWindow.status === "in_transit" || exportWindow.status === "delivered" || exportWindow.status === "completed"
        },
        {
            stage: "Delivered",
            date: exportWindow.deliveryDate ? formatDate(exportWindow.deliveryDate) : "Expected",
            completed: exportWindow.status === "delivered" || exportWindow.status === "completed"
        },
        {
            stage: "Escrow Released",
            date: exportWindow.escrowReleaseDate ? formatDate(exportWindow.escrowReleaseDate) : "30 days after delivery",
            completed: exportWindow.status === "completed"
        },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Export Details">
            <div className="space-y-6">
                {/* Header Info */}
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                            {exportWindow.commodity}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Order ID: <span className="font-mono font-semibold">{exportWindow.orderId}</span>
                        </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(exportWindow.status)}`}>
                        {exportWindow.status.replace("_", " ")}
                    </span>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                        <Package className="w-5 h-5 text-primary mb-2" />
                        <p className="text-xs text-slate-500 dark:text-slate-400">Quantity</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">
                            {exportWindow.quantity}
                        </p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                        <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400 mb-2" />
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total Value</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">
                            {formatCurrency(exportWindow.amount)}
                        </p>
                    </div>
                </div>

                {/* Timeline */}
                <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-primary" />
                        Order Timeline
                    </h4>
                    <div className="space-y-3">
                        {timeline.map((item, index) => (
                            <div key={index} className="flex items-start gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${item.completed
                                        ? "bg-green-500 text-white"
                                        : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                                    }`}>
                                    {item.completed ? "✓" : index + 1}
                                </div>
                                <div className="flex-1">
                                    <p className={`font-semibold ${item.completed
                                            ? "text-slate-900 dark:text-white"
                                            : "text-slate-400 dark:text-slate-500"
                                        }`}>
                                        {item.stage}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {item.date}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Dates Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Created
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {formatDate(exportWindow.createdAt)}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Last Updated
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {formatDate(exportWindow.updatedAt)}
                        </p>
                    </div>
                    {exportWindow.deliveryDate && (
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                Delivery Date
                            </p>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                {formatDate(exportWindow.deliveryDate)}
                            </p>
                        </div>
                    )}
                    {exportWindow.escrowReleaseDate && (
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                                <DollarSign className="w-3 h-3" />
                                Escrow Release
                            </p>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                {formatDate(exportWindow.escrowReleaseDate)}
                            </p>
                        </div>
                    )}
                </div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="w-full px-6 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                    Close
                </button>
            </div>
        </Modal>
    );
}
