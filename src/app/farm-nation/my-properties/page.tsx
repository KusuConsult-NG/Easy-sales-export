"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
    Plus, MapPin, DollarSign, Maximize, Eye, Heart, Edit, Trash2,
    Loader2, AlertCircle, TrendingUp
} from "lucide-react";
import { getMyPropertiesAction, deletePropertyAction, type Property } from "@/app/actions/farm-nation";
import { useToast } from "@/contexts/ToastContext";

export default function MyPropertiesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>("all");

    async function loadProperties() {
        if (!session?.user?.id) return;

        try {
            const result = await getMyPropertiesAction();
            if (result.success && result.properties) {
                setProperties(result.properties);
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
            const result = await deletePropertyAction(propertyId);
            if (result.success) {
                showToast(result.message || "Property deleted successfully", "success");
                loadProperties();
            } else {
                showToast(result.error || "Failed to delete property", "error");
            }
        } catch (error) {
            showToast("An error occurred while deleting property", "error");
        }
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            loadProperties();
        }
    }, [status, session]);

    const filteredProperties = properties.filter(prop => {
        if (filterStatus === "all") return true;
        return prop.status === filterStatus;
    });

    const stats = {
        total: properties.length,
        available: properties.filter(p => p.status === "available").length,
        pending: properties.filter(p => p.status === "pending").length,
        sold: properties.filter(p => p.status === "sold" || p.status === "leased").length,
        totalViews: properties.reduce((sum, p) => sum + (p.viewCount || 0), 0),
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
                    <p className="text-slate-600">Loading your properties...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 mb-2">My Properties</h1>
                        <p className="text-slate-600">Manage your land listings</p>
                    </div>
                    <button
                        onClick={() => router.push("/farm-nation/list-land")}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        List New Property
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 mb-1">Total Listings</p>
                        <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 mb-1">Available</p>
                        <p className="text-3xl font-bold text-green-600">{stats.available}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 mb-1">Pending Sale</p>
                        <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2">
                        <p className="text-sm text-slate-600 mb-1">Total Views</p>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-600" />
                            <p className="text-3xl font-bold text-slate-900">{stats.totalViews}</p>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl p-4 mb-6 elevation-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">Filter:</span>
                        {["all", "available", "pending", "sold", "leased"].map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition ${filterStatus === status
                                    ? "bg-green-600 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <p className="text-red-800">{error}</p>
                    </div>
                )}

                {/* Properties Grid */}
                {filteredProperties.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center elevation-2">
                        <div className="max-w-md mx-auto">
                            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <MapPin className="w-12 h-12 text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {filterStatus === "all" ? "No Properties Listed" : `No ${filterStatus} Properties`}
                            </h3>
                            <p className="text-slate-600 mb-6">
                                {filterStatus === "all"
                                    ? "Get started by listing your first property on Farm Nation marketplace."
                                    : `You don't have any properties with status "${filterStatus}".`}
                            </p>
                            {filterStatus === "all" && (
                                <button
                                    onClick={() => router.push("/farm-nation/list-land")}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition"
                                >
                                    List Your First Property
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredProperties.map((property) => (
                            <div
                                key={property.id}
                                className="bg-white rounded-2xl overflow-hidden elevation-2 hover-lift transition"
                            >
                                {/* Property Image */}
                                <div className="relative aspect-video bg-slate-200">
                                    {property.images && property.images.length > 0 ? (
                                        <Image
                                            src={property.images[0]}
                                            alt={property.name}
                                            fill
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <MapPin className="w-12 h-12 text-slate-400" />
                                        </div>
                                    )}

                                    {/* Status Badge */}
                                    <div className="absolute top-3 right-3">
                                        <span
                                            className={`px-3 py-1 rounded-lg text-xs font-bold ${property.status === "available"
                                                ? "bg-green-600 text-white"
                                                : property.status === "pending"
                                                    ? "bg-yellow-600 text-white"
                                                    : "bg-slate-600 text-white"
                                                }`}
                                        >
                                            {property.status.toUpperCase()}
                                        </span>
                                    </div>

                                    {/* Verification Badge */}
                                    {property.verified && (
                                        <div className="absolute top-3 left-3 bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1">
                                            ✓ Verified
                                        </div>
                                    )}
                                </div>

                                {/* Property Info */}
                                <div className="p-5">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2 line-clamp-1">
                                        {property.name}
                                    </h3>

                                    <div className="flex items-center gap-2 text-sm text-slate-600 mb-4">
                                        <MapPin className="w-4 h-4" />
                                        <span className="line-clamp-1">{property.location}, {property.state}</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-green-600 mb-1">
                                                <DollarSign className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Price</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                ₦{(property.price / 1000000).toFixed(1)}M
                                            </p>
                                        </div>

                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="flex items-center gap-1 text-blue-600 mb-1">
                                                <Maximize className="w-4 h-4" />
                                                <span className="text-xs font-semibold">Size</span>
                                            </div>
                                            <p className="text-sm font-bold text-slate-900">
                                                {property.size} ha
                                            </p>
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="flex items-center justify-between text-xs text-slate-500 mb-4 pb-4 border-b border-slate-200">
                                        <div className="flex items-center gap-1">
                                            <Eye className="w-3 h-3" />
                                            <span>{property.viewCount || 0} views</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Heart className="w-3 h-3" />
                                            <span>{property.favoriteCount || 0} favorites</span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => router.push(`/farm-nation/property/${property.id}`)}
                                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Property
                                        </button>
                                        <button
                                            onClick={() => router.push(`/farm-nation/edit-property/${property.id}`)}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition"
                                            title="Edit Property"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProperty(property.id, property.name)}
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
