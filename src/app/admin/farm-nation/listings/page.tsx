"use client";

import { useState } from "react";
import { useAdminData } from "@/hooks/useAdminData";
import { getAdminLandVerificationsAction } from "@/app/actions/farm-nation-admin";
import { deleteLandListingAction } from "@/app/actions/land-listings";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useToast } from "@/contexts/ToastContext";
import { MapPin, ArrowUpRight, Trash2, Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { firstImageSrc } from "@/lib/first-image";

export default function FarmNationListingsPage() {
    const { showToast } = useToast();
    const [processingId, setProcessingId] = useState<string | null>(null);

    const {
        data: properties,
        loading,
        error,
        search,
        setSearch,
        filters,
        updateFilter,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        setData
    } = useAdminData<any>({
        fetchAction: getAdminLandVerificationsAction,
        limit: 20
    });

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to permanently delete this listing?")) return;
        setProcessingId(id);

        const result = await deleteLandListingAction(id, "admin");
        if (result.success) {
            setData(prev => prev.filter(p => p.id !== id));
            showToast("Property deleted successfully", "success");
        } else {
            showToast(result.error || "Failed to delete property", "error");
        }
        setProcessingId(null);
    };

    const columns = [
        {
            header: "Property",
            accessor: (item: any) => (
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden shrink-0 relative">
                        {firstImageSrc(item.images) ? (
                            <Image src={firstImageSrc(item.images)!} alt={item.title} fill sizes="48px" className="object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <MapPin className="w-5 h-5" />
                            </div>
                        )}
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 line-clamp-1">{item.title}</div>
                        <div className="text-xs text-slate-500">{item.location?.state}, {item.location?.lga}</div>
                    </div>
                </div>
            )
        },
        {
            header: "Category",
            accessor: (item: any) => {
                const category = item.category;
                const displayCategory = Array.isArray(category)
                    ? category.map(c => typeof c === 'object' && c ? (c.label || JSON.stringify(c)) : String(c).replace(/_/g, " ")).join(", ")
                    : (typeof category === 'object' && category ? (category.label || JSON.stringify(category)) : String(category || "General").replace(/_/g, " "));
                return (
                    <div className="space-y-1">
                        <div className="text-sm font-semibold capitalize bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full inline-block">
                            {displayCategory}
                        </div>
                    </div>
                );
            },
            hideOnMobile: true
        },
        {
            header: "Price",
            accessor: (item: any) => (
                <div>
                    <div className="font-bold text-green-600">
                        ₦{item.price?.toLocaleString()}
                    </div>
                    {item.size && <div className="text-xs text-slate-500">{item.size} {item.unit || "acres"}</div>}
                </div>
            )
        },
        {
            header: "Owner",
            accessor: (item: any) => (
                <div className="text-sm">
                    <div className="text-slate-900 font-semibold">{item.ownerName}</div>
                    <div className="text-slate-500 text-xs">{item.ownerEmail}</div>
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Status",
            accessor: (item: any) => {
                const rawStatus = item.verificationStatus || item.status || "pending";
                const status = typeof rawStatus === 'object' && rawStatus 
                    ? (rawStatus.verified ? "verified" : (rawStatus.status || "pending"))
                    : String(rawStatus || "pending");
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${
                        status === "verified" || status === "approved" ? "bg-green-100 text-green-700" :
                        status === "pending" || status === "pending_verification" ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                    }`}>
                        {status.replace(/_/g, " ")}
                    </span>
                );
            }
        },
        {
            header: "Actions",
            accessor: (item: any) => (
                <div className="flex items-center gap-2 justify-end">
                    <Link
                        href={`/farm-nation/property/${item.id}`}
                        target="_blank"
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    >
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                        disabled={processingId === item.id}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                    >
                        {processingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                </div>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            <div className="mb-6 sm:mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                        Master Listings Directory
                    </h1>
                    <p className="text-sm sm:text-base text-slate-600">
                        View and manage all land listings across Farm Nation
                    </p>
                </div>
                <Link
                    href="/admin/farm-nation/land-verification"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition hidden sm:block"
                >
                    Go to Verification Center
                </Link>
            </div>

            <AdminDataTable
                columns={columns}
                data={properties}
                loading={loading}
                error={error}
                searchTerm={search}
                onSearch={setSearch}
                hasMore={hasMore}
                onNextPage={onNextPage}
                onPrevPage={onPrevPage}
                pageIndex={pageIndex}
                filters={
                    <>
                        <select
                            value={filters.status || "all"}
                            onChange={(e) => updateFilter("status", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                        >
                            <option value="all">All Verification Status</option>
                            <option value="verified">Verified</option>
                            <option value="pending">Pending</option>
                            <option value="rejected">Rejected</option>
                        </select>
                        <select
                            value={filters.sortOrder || "desc"}
                            onChange={(e) => updateFilter("sortOrder", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                        >
                            <option value="desc">Newest First</option>
                            <option value="asc">Oldest First</option>
                        </select>
                    </>
                }
            />
        </div>
    );
}
