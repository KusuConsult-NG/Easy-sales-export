"use client";

import { useState, useEffect } from "react";
import { Package, Clock, CheckCircle, AlertCircle, Plus, Loader2, TrendingUp, Edit, Calendar as CalendarIcon, List } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import ExportWindowModal from "@/components/modals/ExportWindowModal";
import StatusUpdateModal from "@/components/modals/StatusUpdateModal";
import ExportDetailsModal from "@/components/modals/ExportDetailsModal";
import DateRangePicker from "@/components/export/DateRangePicker";
import ExportCalendar from "@/components/export/ExportCalendar";
import EmptyState from "@/components/ui/EmptyState";
import { getExportWindowsAction } from "@/app/actions/export";

type DateRange = {
    from: Date | null;
    to: Date | null;
};

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

export default function ExportWindowsPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedExport, setSelectedExport] = useState<ExportWindow | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<ExportWindow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
    const [view, setView] = useState<"list" | "calendar">("list");

    // Fetch export windows on mount and when filter changes
    useEffect(() => {
        const fetchExports = async () => {
            setIsLoading(true);
            setError(null);

            const result = await getExportWindowsAction(
                statusFilter !== "all" ? statusFilter : undefined,
                dateRange.from?.toISOString(),
                dateRange.to?.toISOString()
            );

            if (result.success && result.data) {
                setOrders(result.data);
            } else {
                setError(result.error || "Failed to load export windows");
            }

            setIsLoading(false);
        };

        fetchExports();
    }, [statusFilter, dateRange]);

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

    const getStatusIcon = (status: ExportStatus) => {
        switch (status) {
            case "delivered":
                return <CheckCircle className="w-5 h-5" />;
            case "in_transit":
                return <Package className="w-5 h-5" />;
            case "pending":
                return <Clock className="w-5 h-5" />;
            case "completed":
                return <TrendingUp className="w-5 h-5" />;
            default:
                return <AlertCircle className="w-5 h-5" />;
        }
    };

    const formatDate = (date: Date | undefined) => {
        if (!date) return "Not set";
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric"
        }).format(new Date(date));
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            Export Windows
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Track your commodity export orders and escrow status
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition flex items-center gap-2 elevation-2 hover-lift"
                    >
                        <Plus className="w-5 h-5" />
                        Create Export Window
                    </button>
                </div>

                {/* Status Filter */}
                <div className="mb-6 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Filter:</span>
                        <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                            {["all", "pending", "in_transit", "delivered", "completed"].map((filter) => (
                                <button
                                    key={filter}
                                    onClick={() => setStatusFilter(filter)}
                                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${statusFilter === filter
                                        ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                        }`}
                                >
                                    {filter.replace("_", " ")}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="w-full sm:w-80">
                        <DateRangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            placeholder="Filter by date range"
                        />
                    </div>

                    {/* View Toggle */}
                    <div className="ml-auto flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            onClick={() => setView("list")}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${view === "list"
                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                }`}
                        >
                            <List className="w-4 h-4" />
                            List
                        </button>
                        <button
                            onClick={() => setView("calendar")}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${view === "calendar"
                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                }`}
                        >
                            <CalendarIcon className="w-4 h-4" />
                            Calendar
                        </button>
                    </div>
                </div>

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="ml-3 text-slate-600 dark:text-slate-400">Loading exports...</span>
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
                        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-3" />
                        <p className="text-red-300">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && !error && orders.length === 0 && (
                    <EmptyState
                        icon={Package}
                        title="No Export Windows Found"
                        description={statusFilter !== "all" || dateRange.from || dateRange.to
                            ? "No export windows match your current filters. Try adjusting your search criteria."
                            : "You haven't created any export windows yet. Start by creating your first export window."}
                        actionLabel="Create Export Window"
                        onAction={() => setIsModalOpen(true)}
                    />
                )}

                {/* Export Cards - List View */}
                {!isLoading && !error && view === "list" && orders.length > 0 && (
                    <div className="space-y-6">
                        {orders.map((order, index) => (
                            <div
                                key={order.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                {/* Order Header */}
                                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                                    <div>
                                        <div className="flex items-center gap-3 mb-2">
                                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                                {order.commodity}
                                            </h3>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${getStatusColor(order.status)}`}>
                                                {getStatusIcon(order.status)}
                                                {order.status.replace("_", " ")}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Order ID: <span className="font-mono font-semibold">{order.orderId}</span>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-primary mb-1">
                                            {formatCurrency(order.amount)}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {order.quantity}
                                        </p>
                                    </div>
                                </div>

                                {/* Order Details Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Order Date</p>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {formatDate(order.createdAt)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Delivery Date</p>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {formatDate(order.deliveryDate)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Escrow Release</p>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {formatDate(order.escrowReleaseDate)}
                                        </p>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="mt-6 flex gap-3">
                                    <button
                                        onClick={() => {
                                            setSelectedExport(order);
                                            setIsDetailsModalOpen(true);
                                        }}
                                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                                    >
                                        View Details
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSelectedExport(order);
                                            setIsStatusModalOpen(true);
                                        }}
                                        className="flex-1 px-4 py-2 border border-primary text-primary font-semibold rounded-lg hover:bg-primary/10 transition flex items-center justify-center gap-2"
                                    >
                                        <Edit className="w-4 h-4" />
                                        Update Status
                                    </button>
                                    {order.status === "delivered" && (
                                        <button className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition">
                                            Release Escrow
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}


                        {/* Empty State */}
                        {orders.length === 0 && (
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center elevation-2">
                                <Package className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    No Export Windows Found
                                </h3>
                                <p className="text-slate-600 dark:text-slate-400 mb-6">
                                    {statusFilter !== "all"
                                        ? `No exports with status "${statusFilter.replace("_", " ")}". Try a different filter.`
                                        : "Create your first export window to start tracking commodity exports"
                                    }
                                </p>
                                <button
                                    onClick={() => setIsModalOpen(true)}
                                    className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition inline-flex items-center gap-2"
                                >
                                    <Plus className="w-5 h-5" />
                                    Create Export Window
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Help Section */}
                {!isLoading && !error && (
                    <div className="mt-8 p-6 bg-primary/5 border border-primary/20 rounded-2xl">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-primary" />
                            About Escrow Protection
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Your payment is held in escrow for 30 days after delivery. This protects both buyers and sellers.
                            You can release the escrow early if you're satisfied with the delivery, or file a dispute if there are issues.
                        </p>
                        <a
                            href="/faq"
                            className="text-sm font-semibold text-primary hover:underline"
                        >
                            Learn more about our escrow system →
                        </a>
                    </div>
                )}

                {/* Calendar View */}
                {!isLoading && !error && view === "calendar" && (
                    <ExportCalendar exportWindows={orders} />
                )}
            </div>

            {/* Export Window Creation Modal */}
            <ExportWindowModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

            {/* Status Update Modal */}
            {selectedExport && (
                <StatusUpdateModal
                    isOpen={isStatusModalOpen}
                    onClose={() => {
                        setIsStatusModalOpen(false);
                        setSelectedExport(null);
                    }}
                    exportId={selectedExport.id}
                    currentStatus={selectedExport.status}
                />
            )}

            {/* Export Details Modal */}
            {selectedExport && (
                <ExportDetailsModal
                    isOpen={isDetailsModalOpen}
                    onClose={() => {
                        setIsDetailsModalOpen(false);
                        setSelectedExport(null);
                    }}
                    exportWindow={selectedExport}
                />
            )}
        </div>
    );
}
