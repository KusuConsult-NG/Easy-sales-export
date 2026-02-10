"use client";

import { useState, useEffect } from "react";
import { Truck, CheckCircle, XCircle, Loader2, AlertCircle, Eye, Package } from "lucide-react";
import { getAllExportRequestsAction } from "@/app/actions/admin";
import { updateExportStatusAction } from "@/app/actions/export";

// Import types if needed, or define locally for now
type ExportWindow = {
    id: string;
    orderId: string;
    commodity: string;
    quantity: string;
    amount: number;
    status: string;
    userId: string;
    orderDate: Date;
    deliveryDate?: Date;
    createdAt: Date;
    [key: string]: any;
};

export default function AdminExportPage() {
    const [exports, setExports] = useState<ExportWindow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedExport, setSelectedExport] = useState<ExportWindow | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [filter, setFilter] = useState("all");

    // Load exports
    async function loadExports() {
        setLoading(true);
        const result = await getAllExportRequestsAction(
            filter === "all" ? undefined : (filter as "pending" | "in_transit" | "delivered" | "completed")
        );
        if (result.success && result.exports) {
            setExports(result.exports);
        } else {
            console.error(result.error);
        }
        setLoading(false);
    }

    useEffect(() => {
        loadExports();
    }, [filter]);

    // Handle Status Update
    async function handleStatusUpdate(newStatus: "pending" | "in_transit" | "delivered" | "completed") {
        if (!selectedExport) return;
        if (!confirm(`Change status to ${newStatus}?`)) return;

        setActionLoading(true);
        const result = await updateExportStatusAction(selectedExport.id, newStatus);

        if (result.success) {
            alert("Status updated successfully!");
            setSelectedExport(null);
            await loadExports();
        } else {
            alert(result.error || "Failed to update status");
        }
        setActionLoading(false);
    }

    const getStatusColor = (status: string) => {
        const colors: any = {
            pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
            in_transit: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
            delivered: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
            completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
        };
        return colors[status] || "bg-slate-100 text-slate-800";
    };

    if (loading && exports.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            Export Requests
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Manage and track commodity exports
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                    {["all", "pending", "in_transit", "delivered", "completed"].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition ${filter === f
                                ? "bg-blue-600 text-white"
                                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                                }`}
                        >
                            {f.replace("_", " ")}
                        </button>
                    ))}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <p className="text-xs text-slate-500 mb-1">Total Requests</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{exports.length}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <p className="text-xs text-slate-500 mb-1">Pending Action</p>
                        <p className="text-2xl font-bold text-amber-600">
                            {exports.filter(e => e.status === 'pending').length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <p className="text-xs text-slate-500 mb-1">In Transit</p>
                        <p className="text-2xl font-bold text-blue-600">
                            {exports.filter(e => e.status === 'in_transit').length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                        <p className="text-xs text-slate-500 mb-1">Total Volume</p>
                        <p className="text-2xl font-bold text-emerald-600">
                            {exports.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">NGN</span>
                        </p>
                    </div>
                </div>

                {/* List */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="px-6 py-4 font-semibold">Order ID</th>
                                    <th className="px-6 py-4 font-semibold">Commodity</th>
                                    <th className="px-6 py-4 font-semibold">Quantity</th>
                                    <th className="px-6 py-4 font-semibold">Amount</th>
                                    <th className="px-6 py-4 font-semibold">Status</th>
                                    <th className="px-6 py-4 font-semibold">Date</th>
                                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {exports.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                            <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                            <p>No export requests found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    exports.map((exp) => (
                                        <tr key={exp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                            <td className="px-6 py-4 font-mono text-xs">{exp.orderId}</td>
                                            <td className="px-6 py-4 capitalize">{exp.commodity}</td>
                                            <td className="px-6 py-4">{exp.quantity}</td>
                                            <td className="px-6 py-4 font-medium">₦{exp.amount.toLocaleString()}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(exp.status)}`}>
                                                    {exp.status.replace("_", " ")}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-500">
                                                {new Date(exp.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => setSelectedExport(exp)}
                                                    className="inline-flex items-center justify-center p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Detail Modal */}
                {selectedExport && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
                            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    Export Details
                                </h3>
                                <button
                                    onClick={() => setSelectedExport(null)}
                                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                >
                                    <XCircle className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Order ID</p>
                                        <p className="font-mono font-medium">{selectedExport.orderId}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Status</p>
                                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(selectedExport.status)}`}>
                                            {selectedExport.status.replace("_", " ")}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Commodity</p>
                                        <p className="font-medium capitalize">{selectedExport.commodity}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Quantity</p>
                                        <p className="font-medium">{selectedExport.quantity}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Amount</p>
                                        <p className="font-medium text-emerald-600">₦{selectedExport.amount.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Delivery Date</p>
                                        <p className="font-medium">
                                            {selectedExport.deliveryDate ? new Date(selectedExport.deliveryDate).toLocaleDateString() : 'N/A'}
                                        </p>
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                                    <h4 className="text-sm font-semibold mb-3">Update Status</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => handleStatusUpdate("in_transit")}
                                            disabled={actionLoading || selectedExport.status === "in_transit"}
                                            className="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium transition disabled:opacity-50"
                                        >
                                            In Transit
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate("delivered")}
                                            disabled={actionLoading || selectedExport.status === "delivered"}
                                            className="px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-sm font-medium transition disabled:opacity-50"
                                        >
                                            Delivered
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate("completed")}
                                            disabled={actionLoading || selectedExport.status === "completed"}
                                            className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-sm font-medium transition disabled:opacity-50"
                                        >
                                            Completed
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate("pending")}
                                            disabled={actionLoading || selectedExport.status === "pending"}
                                            className="px-4 py-2 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-sm font-medium transition disabled:opacity-50"
                                        >
                                            Pending
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
