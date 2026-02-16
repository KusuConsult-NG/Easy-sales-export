"use client";

import { useState } from "react";
import { getPropertiesAction, deletePropertyAction, Property } from "@/app/actions/farm-nation";
import { useAdminData } from "@/hooks/useAdminData";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useToast } from "@/contexts/ToastContext";
import { MapPin, ArrowUpRight, Trash2, Loader2, Link as LinkIcon, Eye } from "lucide-react";
import Link from "next/link";

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
    } = useAdminData<Property>({
        fetchAction: async (params) => {
            // Adapt params for getPropertiesAction
            // Note: getPropertiesAction needs an update to support pagination/search if it doesn't already
            // For now we pass standard params, assuming we will update action next
            return await getPropertiesAction(params);
        },
        limit: 20
    });

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this listing?")) return;
        setProcessingId(id);

        const result = await deletePropertyAction(id);
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
            accessor: (item: Property) => (
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden shrink-0">
                        {item.images?.[0] ? (
                            <img src={item.images[0]} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <MapPin className="w-5 h-5" />
                            </div>
                        )}
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 dark:text-white line-clamp-1">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.location}, {item.state}</div>
                    </div>
                </div>
            )
        },
        {
            header: "Type",
            accessor: (item: Property) => (
                <div className="space-y-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${item.type === "sale" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>
                        {item.type}
                    </span>
                    <div className="text-xs text-slate-500 capitalize">{item.category?.replace("farming-", "")}</div>
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Price",
            accessor: (item: Property) => (
                <div>
                    <div className="font-bold text-green-600">
                        ₦{item.price.toLocaleString()}
                    </div>
                    {item.size && <div className="text-xs text-slate-500">{item.size} Acres</div>}
                </div>
            )
        },
        {
            header: "Owner",
            accessor: (item: Property) => (
                <div className="text-sm">
                    <div className="text-slate-900 dark:text-white">{item.ownerName}</div>
                    <div className="text-slate-500 text-xs">{item.ownerEmail}</div>
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Status",
            accessor: (item: Property) => (
                <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${item.status === "available" ? "bg-green-100 text-green-700" :
                        item.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                            item.status === "sold" ? "bg-slate-100 text-slate-700" :
                                "bg-red-100 text-red-700"
                    }`}>
                    {item.status}
                </span>
            )
        },
        {
            header: "Actions",
            accessor: (item: Property) => (
                <div className="flex items-center gap-2 justify-end">
                    <Link
                        href={`/farm-nation/property/${item.id}`}
                        target="_blank"
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                    >
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                        disabled={processingId === item.id}
                        className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                    >
                        {processingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                </div>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
            <div className="mb-6 sm:mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Property Listings
                    </h1>
                    <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
                        Manage Farm Nation property listings
                    </p>
                </div>
                <Link
                    href="/farm-nation/listing/new"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition hidden sm:block"
                >
                    Create Listing
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
                            value={filters.type || "all"}
                            onChange={(e) => updateFilter("type", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        >
                            <option value="all">All Types</option>
                            <option value="sale">For Sale</option>
                            <option value="lease">For Lease</option>
                        </select>
                        <select
                            value={filters.status || "all"}
                            onChange={(e) => updateFilter("status", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        >
                            <option value="all">All Status</option>
                            <option value="available">Available</option>
                            <option value="pending">Pending</option>
                            <option value="sold">Sold</option>
                        </select>
                    </>
                }
            />
        </div>
    );
}
