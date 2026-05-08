"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    Plus, MapPin, DollarSign, Maximize, Eye, Edit, Trash2,
    Loader2, AlertCircle
} from "lucide-react";
import { getMyLandListings, deleteLandListing } from "@/app/actions/land-actions";
import { useToast } from "@/contexts/ToastContext";

export default function MyPropertiesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [properties, setProperties] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("all");

    async function loadProperties() {
        if (!session?.user?.id) return;

        try {
            const result = await getMyLandListings();
            if (result.success && result.data) {
                setProperties(result.data);
            }
        } catch (error) {
            logger.error("Failed to load properties:", error);
        }
        setLoading(false);
    }

    async function handleDeleteProperty(propertyId: string, propertyName: string) {
        if (!confirm(`Are you sure you want to delete "${propertyName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteLandListing(propertyId);
            if (result.success) {
                showToast("Listing deleted successfully", "success");
                loadProperties();
            } else {
                showToast(result.error || "Failed to delete listing", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting listing", "error");
        }
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            loadProperties();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session]);

    const filteredProperties = properties.filter(prop => {
        if (filterStatus === "all") return true;
        return prop.status === filterStatus;
    });

    const stats = {
        total: properties.length,
        verified: properties.filter(p => p.status === "verified").length,
        pending: properties.filter(p => p.status === "pending_verification").length,
        rejected: properties.filter(p => p.status === "rejected").length,
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600">Loading your land listings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 mb-2">My Listings</h1>
                        <p className="text-slate-600">Manage your farm land listings</p>
                    </div>
                    <button
                        onClick={() => router.push("/farm-nation/list-land")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        List New Land
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Total Listings</p>
                        <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Verified</p>
                        <p className="text-3xl font-bold text-green-600">{stats.verified}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Pending Verification</p>
                        <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-600 mb-1">Rejected</p>
                        <p className="text-3xl font-bold text-red-600">{stats.rejected}</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-4 mb-6 shadow-sm">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">Filter:</span>
                        {[
                            { value: "all", label: "All" },
                            { value: "verified", label: "Verified" },
                            { value: "pending_verification", label: "Pending" },
                            { value: "rejected", label: "Rejected" }
                        ].map(({ value, label }) => (
                            <button
                                key={value}
                                onClick={() => setFilterStatus(value)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition ${filterStatus === value
                                    ? "bg-green-600 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <p className="text-red-800">{error}</p>
                    </div>
                )}

                {filteredProperties.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
                        <div className="max-w-md mx-auto">
                            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <MapPin className="w-12 h-12 text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {filterStatus === "all" ? "No Listings Found" : `No ${filterStatus.replace("_", " ")} Listings`}
                            </h3>
                            <p className="text-slate-600 mb-6">
                                {filterStatus === "all"
                                    ? "Get started by sharing your first farm land on the marketplace."
                                    : `You don't have any listings with status "${filterStatus.replace("_", " ")}".`}
                            </p>
                            {filterStatus === "all" && (
                                <button
                                    onClick={() => router.push("/farm-nation/list-land")}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition"
                                >
                                    List Your Land
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredProperties.map((property) => (
                            <div
                                key={property.id}
                                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition"
                            >
                                <div className="relative aspect-video bg-slate-200">
                                    {property.images && property.images.length > 0 ? (
                                        <Image
                                            src={property.images[0]}
                                            alt={property.title}
                                            fill
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <MapPin className="w-12 h-12 text-slate-400" />
                                        </div>
                                    )}

                                    <div className="absolute top-3 right-3">
                                        <span
                                            className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                                                property.status === "verified"
                                                ? "bg-green-600 text-white"
                                                : property.status === "pending_verification"
                                                    ? "bg-yellow-600 text-white"
                                                    : "bg-red-600 text-white"
                                                }`}
                                        >
                                            {property.status.replace("_", " ")}
                                        </span>
                                    </div>
                                </div>

                                <div className="p-5">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-1">
                                        {property.title}
                                    </h3>

                                    <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
                                        <MapPin className="w-4 h-4" />
                                        <span className="line-clamp-1">{property.location?.state}, {property.location?.lga}</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-green-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Price</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                ₦{property.price?.toLocaleString()}
                                            </p>
                                        </div>

                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-blue-600 mb-1">
                                                <Maximize className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Size</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                {property.size} {property.unit || "acres"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-4 border-t border-slate-100">
                                        <button
                                            onClick={() => router.push(`/farm-nation/property/${property.id}`)}
                                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View
                                        </button>
                                        <button
                                            onClick={() => router.push(`/farm-nation/edit-property/${property.id}`)}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition"
                                            title="Edit Property"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProperty(property.id, property.title)}
                                            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition"
                                            title="Delete Property"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
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
