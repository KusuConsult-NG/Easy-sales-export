"use client";

import { useState } from "react";
import { getUsersAction, updateUserRolesAction } from "@/app/actions/admin"; // We reuse getUsersAction but filter for seller roles
import { useAdminData } from "@/hooks/useAdminData";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useToast } from "@/contexts/ToastContext";
import { Users, CheckCircle, XCircle, Shield, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";

interface SellerProfile {
    // This maps to the user object but we focus on farm nation profile details
    id: string;
    name: string;
    email: string;
    phone?: string;
    farmNation?: {
        role: string;
        profile: any;
        interests: any;
        onboardingCompletedAt: string;
    };
    serviceRegistrations?: {
        farmNation?: {
            status: string;
            role: string;
            submittedAt: any;
        }
    };
    isVerified: boolean;
    createdAt: Date;
}

export default function FarmNationSellersPage() {
    const { showToast } = useToast();
    const [selectedSeller, setSelectedSeller] = useState<SellerProfile | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const {
        data: sellers,
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
        setData,
        refresh
    } = useAdminData<SellerProfile>({
        fetchAction: async (params) => {
            // Fetch users with farm-nation-seller role or pending farm nation requests
            // For now, we fetch 'all' and filter by role in UI or backend if backend supports custom query
            // Ideally we add a 'service' filter to getUsersAction
            return await getUsersAction({
                ...params,
                role: "farm-nation-seller" // Assuming this role exists or we filter for it
            });
        },
        limit: 20
    });

    const handleApproveSeller = async (seller: SellerProfile) => {
        if (!confirm("Approve this seller and grant posting rights?")) return;
        setProcessingId(seller.id);

        try {
            const { approveFarmNationSellerAction } = await import("@/app/actions/farm-nation");
            const result = await approveFarmNationSellerAction(seller.id);

            if (result.success) {
                showToast("Seller approved successfully", "success");
                refresh();
            } else {
                showToast(result.error || "Failed to approve", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Error approving seller", "error");
        }
        setProcessingId(null);
    };

    const handleRejectSeller = async (seller: SellerProfile) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason?.trim()) return;
        setProcessingId(seller.id + "_reject");

        try {
            const { rejectFarmNationSellerAction } = await import("@/app/actions/farm-nation");
            const result = await rejectFarmNationSellerAction(seller.id, reason);

            if (result.success) {
                showToast("Seller application rejected", "success");
                refresh();
            } else {
                showToast(result.error || "Failed to reject", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Error rejecting seller", "error");
        }
        setProcessingId(null);
    };

    const columns = [
        {
            header: "Seller",
            accessor: (item: SellerProfile) => (
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <div className="font-bold text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.email}</div>
                    </div>
                </div>
            )
        },
        {
            header: "Location",
            accessor: (item: SellerProfile) => (
                <div className="text-sm text-slate-600">
                    {item.farmNation?.profile?.state || "N/A"}, {item.farmNation?.profile?.lga || ""}
                </div>
            )
        },
        {
            header: "Status",
            accessor: (item: SellerProfile) => {
                const status = item.serviceRegistrations?.farmNation?.status || "unknown";
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${status === "approved" ? "bg-green-100 text-green-700" :
                        status === "pending" ? "bg-yellow-100 text-yellow-700" :
                            "bg-slate-100 text-slate-700"
                        }`}>
                        {status}
                    </span>
                );
            }
        },
        {
            header: "Submitted",
            accessor: (item: SellerProfile) => {
                const date = item.serviceRegistrations?.farmNation?.submittedAt
                    ? new Date(item.serviceRegistrations.farmNation.submittedAt.seconds * 1000)
                    : item.createdAt;
                return (
                    <span className="text-sm text-slate-500">
                        {new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(date)}
                    </span>
                );
            },
            hideOnMobile: true
        },
        {
            header: "Actions",
            accessor: (item: SellerProfile) => (
                <div className="flex items-center gap-2 justify-end">
                    <button
                        onClick={(e) => { e.stopPropagation(); setSelectedSeller(item); setIsDetailOpen(true); }}
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        title="View Details"
                    >
                        <Shield className="w-4 h-4" />
                    </button>
                    {item.serviceRegistrations?.farmNation?.status === "pending" && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRejectSeller(item); }}
                                disabled={processingId === item.id || processingId === item.id + "_reject"}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                                title="Reject"
                            >
                                {processingId === item.id + "_reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleApproveSeller(item); }}
                                disabled={processingId === item.id || processingId === item.id + "_reject"}
                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-50"
                                title="Approve"
                            >
                                {processingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            </button>
                        </>
                    )}
                </div>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    Seller Applications
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                    Review and approve Farm Nation seller applications
                </p>
            </div>

            <AdminDataTable
                columns={columns}
                data={sellers}
                loading={loading}
                error={error}
                searchTerm={search}
                onSearch={setSearch}
                hasMore={hasMore}
                onNextPage={onNextPage}
                onPrevPage={onPrevPage}
                pageIndex={pageIndex}
                filters={
                    <select
                        value={filters.status || "all"}
                        onChange={(e) => updateFilter("status", e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                    >
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                    </select>
                }
            />

            <Modal
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                title="Seller Details"
            >
                {selectedSeller && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-500 uppercase">Name</label>
                                <p className="font-medium">{selectedSeller.name}</p>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 uppercase">Email</label>
                                <p className="font-medium">{selectedSeller.email}</p>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 uppercase">Phone</label>
                                <p className="font-medium">{selectedSeller.farmNation?.profile?.phone || selectedSeller.phone}</p>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 uppercase">Location</label>
                                <p className="font-medium">{selectedSeller.farmNation?.profile?.state}, {selectedSeller.farmNation?.profile?.lga}</p>
                            </div>
                            <div className="col-span-2">
                                <label className="text-xs text-slate-500 uppercase">Address</label>
                                <p className="font-medium">{selectedSeller.farmNation?.profile?.address}</p>
                            </div>
                            <div className="col-span-2">
                                <label className="text-xs text-slate-500 uppercase">Interests</label>
                                <div className="bg-slate-50 p-2 rounded text-sm mt-1">
                                    <pre className="whitespace-pre-wrap font-sans text-slate-600">
                                        {JSON.stringify(selectedSeller.farmNation?.interests, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-slate-200">
                            <button
                                onClick={() => setIsDetailOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:text-slate-800"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
