"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    ArrowLeft, MapPin, DollarSign, Calendar, AlertCircle, Loader2,
    CheckCircle, Clock, XCircle, Download, Phone, Mail
} from "lucide-react";
import { getMyPurchaseRequestsAction } from "@/app/actions/farm-nation";

interface PurchaseRequest {
    id: string;
    propertyId: string;
    propertyName: string;
    propertyPrice: number;
    propertyType: "sale" | "lease";
    propertyImages?: string[];
    propertyLocation?: string;
    sellerName: string;
    sellerEmail?: string;
    sellerPhone?: string;
    status: "pending_payment" | "payment_confirmed" | "completed" | "cancelled";
    escrowStatus: "pending" | "held" | "released" | "refunded";
    createdAt: Date;
}

export default function MyPurchasesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();

    const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("all");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/login");
        } else if (status === "authenticated") {
            loadPurchases();
        }
    }, [status]);

    const loadPurchases = async () => {
        setLoading(true);
        setError(null);

        const result = await getMyPurchaseRequestsAction();

        if (result.success && result.requests) {
            setPurchases(result.requests as unknown as PurchaseRequest[]);
        } else {
            setError(result.error || "Failed to load purchase requests");
        }

        setLoading(false);
    };

    const filteredPurchases = purchases.filter(purchase => {
        if (filterStatus === "all") return true;
        return purchase.status === filterStatus;
    });

    const getStatusBadge = (status: string) => {
        const styles = {
            pending_payment: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400",
            payment_confirmed: "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
            completed: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400",
            cancelled: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400",
        };

        const icons = {
            pending_payment: Clock,
            payment_confirmed: CheckCircle,
            completed: CheckCircle,
            cancelled: XCircle,
        };

        const Icon = icons[status as keyof typeof icons] || Clock;

        return (
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg font-semibold text-sm ${styles[status as keyof typeof styles]}`}>
                <Icon className="w-4 h-4" />
                {status.replace("_", " ").toUpperCase()}
            </div>
        );
    };

    const getEscrowBadge = (escrowStatus: string) => {
        const styles = {
            pending: "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
            held: "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
            released: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400",
            refunded: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400",
        };

        return (
            <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[escrowStatus as keyof typeof styles]}`}>
                Escrow: {escrowStatus.charAt(0).toUpperCase() + escrowStatus.slice(1)}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading your purchases...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/farm-nation")}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Marketplace
                    </button>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">My Purchase Requests</h1>
                    <p className="text-slate-600 dark:text-slate-400">Track your property acquisition requests</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Requests</p>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">{purchases.length}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Pending Payment</p>
                        <p className="text-3xl font-bold text-yellow-600">
                            {purchases.filter(p => p.status === "pending_payment").length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">In Progress</p>
                        <p className="text-3xl font-bold text-blue-600">
                            {purchases.filter(p => p.status === "payment_confirmed").length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Completed</p>
                        <p className="text-3xl font-bold text-green-600">
                            {purchases.filter(p => p.status === "completed").length}
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-6 elevation-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Filter:</span>
                        {["all", "pending_payment", "payment_confirmed", "completed", "cancelled"].map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition ${filterStatus === status
                                    ? "bg-green-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                                    }`}
                            >
                                {status === "all" ? "All" : status.replace("_", " ").toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <p className="text-red-800 dark:text-red-200">{error}</p>
                    </div>
                )}

                {/* Purchases List */}
                {filteredPurchases.length === 0 ? (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center elevation-2">
                        <div className="max-w-md mx-auto">
                            <div className="w-24 h-24 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                                <DollarSign className="w-12 h-12 text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                {filterStatus === "all" ? "No Purchase Requests" : `No ${filterStatus.replace("_", " ")} Requests`}
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400 mb-6">
                                {filterStatus === "all"
                                    ? "Browse available properties and make your first purchase request."
                                    : `You don't have any requests with status "${filterStatus.replace("_", " ")}".`}
                            </p>
                            {filterStatus === "all" && (
                                <button
                                    onClick={() => router.push("/farm-nation")}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition"
                                >
                                    Browse Properties
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredPurchases.map((purchase) => (
                            <div
                                key={purchase.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift transition"
                            >
                                <div className="p-6">
                                    <div className="flex items-start gap-6">
                                        {/* Property Image */}
                                        {purchase.propertyImages && purchase.propertyImages.length > 0 ? (
                                            <div className="relative w-32 h-32 rounded-xl overflow-hidden shrink-0 bg-slate-200 dark:bg-slate-700">
                                                <Image
                                                    src={purchase.propertyImages[0]}
                                                    alt={purchase.propertyName}
                                                    fill
                                                    className="object-cover"
                                                />
                                            </div>
                                        ) : (
                                            <div className="w-32 h-32 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                                <MapPin className="w-8 h-8 text-slate-400" />
                                            </div>
                                        )}

                                        {/* Details */}
                                        <div className="flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                                                        {purchase.propertyName}
                                                    </h3>
                                                    {purchase.propertyLocation && (
                                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                                            <MapPin className="w-4 h-4" />
                                                            <span>{purchase.propertyLocation}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {getStatusBadge(purchase.status)}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                                                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Amount</p>
                                                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                                                        ₦{purchase.propertyPrice.toLocaleString()}
                                                    </p>
                                                </div>

                                                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                                                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Type</p>
                                                    <p className="text-lg font-bold text-slate-900 dark:text-white capitalize">
                                                        {purchase.propertyType}
                                                    </p>
                                                </div>

                                                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                                                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Request Date</p>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                        {new Date(purchase.createdAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Seller Info */}
                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                                                <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-2">Seller Information</p>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                                        <CheckCircle className="w-4 h-4 text-blue-600" />
                                                        <span>{purchase.sellerName}</span>
                                                    </div>
                                                    {purchase.sellerEmail && (
                                                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                                            <Mail className="w-4 h-4 text-blue-600" />
                                                            <span>{purchase.sellerEmail}</span>
                                                        </div>
                                                    )}
                                                    {purchase.sellerPhone && (
                                                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                                            <Phone className="w-4 h-4 text-blue-600" />
                                                            <span>{purchase.sellerPhone}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {getEscrowBadge(purchase.escrowStatus)}
                                                    {purchase.status === "completed" && (
                                                        <button
                                                            onClick={() => alert("Download agreement functionality coming soon!")}
                                                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition"
                                                        >
                                                            <Download className="w-4 h-4" />
                                                            Download Agreement
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => router.push(`/farm-nation/property/${purchase.propertyId}`)}
                                                        className="px-4 py-2 bg-blue-100 dark:bg-blue-900/20 hover:bg-blue-200 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-400 text-sm font-semibold rounded-lg transition"
                                                    >
                                                        View Property
                                                    </button>
                                                    {purchase.status === "pending_payment" && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm("Are you sure you want to cancel this request?")) {
                                                                    alert("Cancel functionality coming soon!");
                                                                }
                                                            }}
                                                            className="px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 text-sm font-semibold rounded-lg transition"
                                                        >
                                                            Cancel Request
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
