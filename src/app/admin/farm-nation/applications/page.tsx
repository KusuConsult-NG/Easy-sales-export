"use client";

import { useState } from "react";
import { updateUserRolesAction } from "@/app/actions/admin";
import { getStandardFarmNationRegistrantsAction } from "@/app/actions/farm-nation-admin";
import { StandardPendingForm } from "@/lib/types/admin";
import { useAdminData } from "@/hooks/useAdminData";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useToast } from "@/contexts/ToastContext";
import { Users, CheckCircle, XCircle, Shield, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";

interface SellerProfile {
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
        };
    };
    isVerified: boolean;
    createdAt: Date;
}

export default function FarmNationApplicationsPage() {
    const { showToast } = useToast();
    const [selectedSeller, setSelectedSeller] = useState<StandardPendingForm<SellerProfile> | null>(null);
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
    } = useAdminData<StandardPendingForm<SellerProfile>>({
        fetchAction: async (params) => {
            const result = await getStandardFarmNationRegistrantsAction({
                status: (params.status as any) || "all",
                search: params.search,
                limit: params.limit || 20,
                lastDocId: params.lastDocId
            });

            return {
                success: result.success,
                error: result.error,
                data: result.data || [],
                hasMore: !!result.hasMore,
                lastDocId: result.lastDocId,
            };
        },
        limit: 20
    });

    async function handleApproveSeller(seller: StandardPendingForm<SellerProfile>) {
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

    async function handleRejectSeller(seller: StandardPendingForm<SellerProfile>) {
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

    const getStatusBadge = (status: string) => {
        const map: Record<string, string> = {
            approved: "bg-green-100 text-green-700",
            pending: "bg-yellow-100 text-yellow-700",
            rejected: "bg-red-100 text-red-700",
            revision_required: "bg-orange-100 text-orange-700",
        };
        return map[status] || "bg-slate-100 text-slate-700";
    };

    const columns = [
        {
            header: "Applicant",
            accessor: (item: StandardPendingForm<SellerProfile>) => (
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <div className="font-bold text-slate-900">{item.user.name}</div>
                        <div className="text-xs text-slate-500">{item.user.email}</div>
                    </div>
                </div>
            )
        },
        {
            header: "Role",
            accessor: (item: StandardPendingForm<SellerProfile>) => (
                <span className="text-sm text-slate-700 capitalize">
                    {item.data.serviceRegistrations?.farmNation?.role?.replace(/_/g, " ") || "—"}
                </span>
            ),
            hideOnMobile: true
        },
        {
            header: "Location",
            accessor: (item: StandardPendingForm<SellerProfile>) => (
                <div className="text-sm text-slate-600">
                    {item.data.farmNation?.profile?.state
                        ? `${item.data.farmNation.profile.state}${item.data.farmNation.profile.lga ? `, ${item.data.farmNation.profile.lga}` : ""}`
                        : "—"}
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Status",
            accessor: (item: StandardPendingForm<SellerProfile>) => {
                const status = item.status;
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getStatusBadge(status)}`}>
                        {status.replace(/_/g, " ")}
                    </span>
                );
            }
        },
        {
            header: "Submitted",
            accessor: (item: StandardPendingForm<SellerProfile>) => {
                let date = new Date();
                const ts = item.data.serviceRegistrations?.farmNation?.submittedAt;
                if (ts?.seconds) date = new Date(ts.seconds * 1000);
                else if (ts) date = new Date(ts as string);
                else if (item.data.createdAt) {
                    if ((item.data.createdAt as any).seconds) date = new Date((item.data.createdAt as any).seconds * 1000);
                    else date = new Date(item.data.createdAt);
                }
                
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
            accessor: (item: StandardPendingForm<SellerProfile>) => (
                <div className="flex items-center gap-2 justify-end flex-wrap">
                    <button
                        onClick={(e) => { e.stopPropagation(); setSelectedSeller(item); setIsDetailOpen(true); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                    >
                        <Shield className="w-3.5 h-3.5" />
                        View
                    </button>
                    {item.status === "pending" && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRejectSeller(item); }}
                                disabled={processingId === item.id || processingId === item.id + "_reject"}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition disabled:opacity-50"
                            >
                                {processingId === item.id + "_reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                Reject
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleApproveSeller(item); }}
                                disabled={processingId === item.id || processingId === item.id + "_reject"}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition disabled:opacity-50"
                            >
                                {processingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                Approve
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
                    Registration Applications
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                    Review and approve Farm Nation applications
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
                        <option value="rejected">Rejected</option>
                        <option value="revision_required">Revision Required</option>
                    </select>
                }
            />

            <Modal
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                title="Applicant Details"
            >
                {selectedSeller && (
                    <div className="space-y-4">
                        {/* Basic Info */}
                        <div>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Basic Information</h4>
                            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl text-sm">
                                <div>
                                    <span className="text-slate-500 block text-xs mb-0.5">Name</span>
                                    <p className="font-medium text-slate-900">{selectedSeller.user.name}</p>
                                </div>
                                <div>
                                    <span className="text-slate-500 block text-xs mb-0.5">Email</span>
                                    <p className="font-medium text-slate-900">{selectedSeller.user.email}</p>
                                </div>
                                <div>
                                    <span className="text-slate-500 block text-xs mb-0.5">Phone</span>
                                    <p className="font-medium text-slate-900">
                                        {selectedSeller.data.farmNation?.profile?.phone || selectedSeller.data.phone || "—"}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-slate-500 block text-xs mb-0.5">Location</span>
                                    <p className="font-medium text-slate-900">
                                        {selectedSeller.data.farmNation?.profile?.state
                                            ? `${selectedSeller.data.farmNation.profile.state}, ${selectedSeller.data.farmNation.profile.lga || ""}`
                                            : "—"}
                                    </p>
                                </div>
                                {selectedSeller.data.farmNation?.profile?.address && (
                                    <div className="col-span-2">
                                        <span className="text-slate-500 block text-xs mb-0.5">Address</span>
                                        <p className="font-medium text-slate-900">{selectedSeller.data.farmNation.profile.address}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Registration Status */}
                        <div>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Registration</h4>
                            <div className="bg-slate-50 p-4 rounded-xl text-sm space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Role Applied For</span>
                                    <span className="font-medium capitalize">
                                        {selectedSeller.data.serviceRegistrations?.farmNation?.role?.replace(/_/g, " ") || "—"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Status</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${getStatusBadge(selectedSeller.status)}`}>
                                        {selectedSeller.status.replace(/_/g, " ")}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Interests — shown as readable tags, not raw JSON */}
                        {selectedSeller.data.farmNation?.interests && (
                            <div>
                                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Farm Interests</h4>
                                <div className="flex flex-wrap gap-2">
                                    {Array.isArray(selectedSeller.data.farmNation.interests)
                                        ? selectedSeller.data.farmNation.interests.map((interest: string, i: number) => (
                                            <span key={i} className="px-2 py-1 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium">
                                                {interest}
                                            </span>
                                        ))
                                        : typeof selectedSeller.data.farmNation.interests === "object"
                                            ? Object.entries(selectedSeller.data.farmNation.interests).map(([k, v]) => (
                                                <span key={k} className="px-2 py-1 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium capitalize">
                                                    {k.replace(/_/g, " ")}: {String(v)}
                                                </span>
                                            ))
                                            : <span className="text-sm text-slate-600">{String(selectedSeller.data.farmNation.interests)}</span>
                                    }
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                            {selectedSeller.status === "pending" && (
                                <>
                                    <button
                                        onClick={() => { handleRejectSeller(selectedSeller); setIsDetailOpen(false); }}
                                        disabled={!!processingId}
                                        className="px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 font-semibold rounded-lg text-sm disabled:opacity-50"
                                    >
                                        Reject
                                    </button>
                                    <button
                                        onClick={() => { handleApproveSeller(selectedSeller); setIsDetailOpen(false); }}
                                        disabled={!!processingId}
                                        className="px-4 py-2 bg-green-600 text-white hover:bg-green-700 font-semibold rounded-lg text-sm disabled:opacity-50"
                                    >
                                        Approve
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setIsDetailOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
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
