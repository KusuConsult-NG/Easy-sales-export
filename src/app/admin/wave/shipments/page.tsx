"use client";

import { useState, useEffect } from "react";
import { 
    Truck, Package, MapPin, Clock, CheckCircle, XCircle, 
    Loader2, Search, Plus, RefreshCw, X, ArrowLeft, Calendar, Edit2, Info
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { 
    createWaveShipmentAction, 
    getWaveShipmentsAction, 
    updateShipmentStatusAction, 
    syncShipmentWithCarrierAction,
    getStandardWaveApplicationsAction
} from "@/app/actions/wave";
import type { ShipmentTracking } from "@/app/actions/wave";

interface UserSearchRef {
    id: string;
    name: string;
    email: string;
    city?: string;
    state?: string;
}

export default function AdminWaveShipmentsPage() {
    const { showToast } = useToast();

    // Data states
    const [shipments, setShipments] = useState<ShipmentTracking[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    
    // Search & Filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");

    // Modal states
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isUpdateOpen, setIsUpdateOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    
    // Selected shipment for modals
    const [selectedShipment, setSelectedShipment] = useState<ShipmentTracking | null>(null);

    // Create Shipment form states
    const [searchUserQuery, setSearchUserQuery] = useState("");
    const [searchedUsers, setSearchedUsers] = useState<UserSearchRef[]>([]);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserSearchRef | null>(null);
    const [productName, setProductName] = useState("WAVE Starter Kit");
    const [carrier, setCarrier] = useState("MockLogistics");
    const [destination, setDestination] = useState("");
    const [trackingNumber, setTrackingNumber] = useState("");
    const [submittingCreate, setSubmittingCreate] = useState(false);

    // Update Status form states
    const [updateStatus, setUpdateStatus] = useState<ShipmentTracking["status"]>("in_transit");
    const [updateLocation, setUpdateLocation] = useState("");
    const [updateNote, setUpdateNote] = useState("");
    const [submittingUpdate, setSubmittingUpdate] = useState(false);

    // Syncing state
    const [syncingId, setSyncingId] = useState<string | null>(null);

    useEffect(() => {
        loadShipments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadShipments() {
        setLoading(true);
        try {
            const result = await getWaveShipmentsAction();
            if (result.success && result.data) {
                setShipments(result.data as any);
            } else {
                showToast(result.error || "Failed to load shipments", "error");
            }
        } catch (error) {
            showToast("Failed to load shipments", "error");
        } finally {
            setLoading(false);
        }
    }

    async function handleRefresh() {
        setRefreshing(true);
        await loadShipments();
        setRefreshing(false);
    }

    // Search users via server action
    async function handleSearchUsers() {
        if (!searchUserQuery.trim()) return;
        setSearchingUsers(true);
        try {
            const result = await getStandardWaveApplicationsAction({
                status: "approved",
                search: searchUserQuery,
                limit: 10
            });

            if (result.success && result.data) {
                const list: UserSearchRef[] = (result.data || []).map((item: any) => {
                    const data = item.data || {};
                    const user = item.user || {};
                    const fullName = data.fullName || [data.firstName, data.otherNames, data.surname].filter(Boolean).join(" ").trim() || user.name || "Unknown";
                    return {
                        id: user.id || item.id,
                        name: fullName,
                        email: user.email || data.email || data.userEmail || "",
                        city: user.city || data.city || "",
                        state: user.state || data.state || ""
                    };
                });
                setSearchedUsers(list);
                if (list.length === 0) {
                    showToast("No active WAVE members matched that search query", "info");
                }
            } else {
                showToast(result.error || "Failed to search members", "error");
            }
        } catch (error) {
            showToast("Error searching members", "error");
        } finally {
            setSearchingUsers(false);
        }
    }

    async function handleCreateShipment(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedUser) {
            showToast("Please select a WAVE member first", "error");
            return;
        }
        if (!productName || !carrier || !destination) {
            showToast("Please fill all required fields", "error");
            return;
        }

        setSubmittingCreate(true);
        try {
            const result = await createWaveShipmentAction({
                memberId: selectedUser.id,
                productName,
                destination,
                carrier,
                trackingNumber: trackingNumber || undefined
            });

            if (result.success) {
                showToast("WAVE shipment created successfully!", "success");
                setIsCreateOpen(false);
                resetCreateForm();
                loadShipments();
            } else {
                showToast(result.error || "Failed to create shipment", "error");
            }
        } catch (error) {
            showToast("An error occurred while creating shipment", "error");
        } finally {
            setSubmittingCreate(false);
        }
    }

    async function handleUpdateStatus(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedShipment) return;
        if (!updateLocation) {
            showToast("Current location is required", "error");
            return;
        }

        setSubmittingUpdate(true);
        try {
            const result = await updateShipmentStatusAction(
                selectedShipment.id,
                updateStatus,
                updateLocation,
                updateNote || undefined
            );

            if (result.success) {
                showToast("Shipment status updated successfully!", "success");
                setIsUpdateOpen(false);
                loadShipments();
            } else {
                showToast(result.error || "Failed to update status", "error");
            }
        } catch (error) {
            showToast("An error occurred while updating status", "error");
        } finally {
            setSubmittingUpdate(false);
        }
    }

    async function handleSyncCarrier(shipmentId: string) {
        setSyncingId(shipmentId);
        try {
            const result = await syncShipmentWithCarrierAction(shipmentId);
            if (result.success) {
                showToast("Carrier details synced successfully!", "success");
                loadShipments();
            } else {
                showToast(result.error || "Failed to sync carrier", "error");
            }
        } catch (error) {
            showToast("An error occurred while syncing", "error");
        } finally {
            setSyncingId(null);
        }
    }

    function resetCreateForm() {
        setSelectedUser(null);
        setSearchUserQuery("");
        setSearchedUsers([]);
        setProductName("WAVE Starter Kit");
        setCarrier("MockLogistics");
        setDestination("");
        setTrackingNumber("");
    }

    // Filter shipments
    const filteredShipments = shipments.filter(shipment => {
        const matchesSearch = 
            (shipment.trackingNumber || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (shipment.productName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (shipment.memberName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (shipment.memberEmail || "").toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus = statusFilter === "all" || shipment.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    // Stats
    const stats = {
        total: shipments.length,
        pending: shipments.filter(s => s.status === "pending").length,
        inTransit: shipments.filter(s => s.status === "in_transit").length,
        delivered: shipments.filter(s => s.status === "delivered").length,
        cancelled: shipments.filter(s => s.status === "cancelled").length,
    };

    const getStatusBadge = (status: ShipmentTracking["status"]) => {
        const classes: Record<ShipmentTracking["status"], string> = {
            pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
            in_transit: "bg-blue-50 text-blue-700 border-blue-200",
            delivered: "bg-green-50 text-green-700 border-green-200",
            cancelled: "bg-red-50 text-red-700 border-red-200",
        };
        const labels: Record<ShipmentTracking["status"], string> = {
            pending: "Pending",
            in_transit: "In Transit",
            delivered: "Delivered",
            cancelled: "Cancelled",
        };
        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${classes[status]}`}>
                {labels[status]}
            </span>
        );
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <Link
                        href="/admin/wave"
                        className="inline-flex items-center gap-2 text-slate-550 hover:text-slate-900 text-sm font-medium mb-3 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to WAVE Dashboard
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Truck className="w-8 h-8 text-blue-600 animate-pulse" />
                        WAVE Shipment Management
                    </h1>
                    <p className="text-slate-600 mt-1">
                        Create, track, and update logistics input shipments for WAVE program participants
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing || loading}
                        className="p-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-755 rounded-xl transition disabled:opacity-50"
                        title="Refresh Shipments"
                    >
                        <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={() => { resetCreateForm(); setIsCreateOpen(true); }}
                        className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/10 hover:shadow-blue-600/20 transition"
                    >
                        <Plus className="w-5 h-5" />
                        Create Shipment
                    </button>
                </div>
            </div>

            {/* Stats Summary Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total</div>
                    <div className="text-3xl font-extrabold text-slate-800">{stats.total}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Pending</div>
                    <div className="text-3xl font-extrabold text-yellow-600">{stats.pending}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">In Transit</div>
                    <div className="text-3xl font-extrabold text-blue-600">{stats.inTransit}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Delivered</div>
                    <div className="text-3xl font-extrabold text-green-600">{stats.delivered}</div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Cancelled</div>
                    <div className="text-3xl font-extrabold text-red-600">{stats.cancelled}</div>
                </div>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3.5 top-3.5 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search by tracking number, product, or member name..."
                        className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                </div>
                <div className="flex gap-2 w-full md:w-auto shrink-0">
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="w-full md:w-48 px-4 py-3 border border-slate-200 rounded-xl text-slate-705 bg-white text-sm focus:ring-2 focus:ring-blue-500 transition-all font-semibold"
                    >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="in_transit">In Transit</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>

            {/* Shipment Table Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-24 flex flex-col items-center justify-center gap-4 text-slate-500">
                        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                        <p className="font-semibold text-sm">Loading shipments...</p>
                    </div>
                ) : filteredShipments.length === 0 ? (
                    <div className="py-20 text-center">
                        <Truck className="w-16 h-16 text-slate-350 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-900 mb-1">No Shipments Found</h3>
                        <p className="text-slate-500 max-w-sm mx-auto mb-4">
                            We couldn't find any WAVE shipments matching your query.
                        </p>
                        {searchQuery || statusFilter !== "all" ? (
                            <button
                                onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
                                className="px-5 py-2 bg-slate-100 hover:bg-slate-205 text-slate-700 font-bold rounded-lg transition text-sm"
                            >
                                Clear Filters
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-400 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                                    <th className="px-6 py-4">Shipment ID / Tracking</th>
                                    <th className="px-6 py-4">WAVE Member</th>
                                    <th className="px-6 py-4">Product/Kit</th>
                                    <th className="px-6 py-4">Destination</th>
                                    <th className="px-6 py-4">Carrier</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                                {filteredShipments.map((shipment) => (
                                    <tr key={shipment.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-slate-900">{shipment.id}</div>
                                            <div className="text-xs font-mono text-slate-400 mt-0.5">{shipment.trackingNumber}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-slate-800">{shipment.memberName}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">{shipment.memberEmail}</div>
                                        </td>
                                        <td className="px-6 py-4 font-semibold text-slate-900">{shipment.productName}</td>
                                        <td className="px-6 py-4 text-xs max-w-xs truncate">{shipment.destination}</td>
                                        <td className="px-6 py-4 font-mono text-xs">{shipment.carrier}</td>
                                        <td className="px-6 py-4">{getStatusBadge(shipment.status)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => { setSelectedShipment(shipment); setIsDetailOpen(true); }}
                                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                    title="View Details & Timeline"
                                                >
                                                    <Info className="w-4.5 h-4.5" />
                                                </button>
                                                {shipment.status !== "delivered" && shipment.status !== "cancelled" && (
                                                    <>
                                                        <button
                                                            onClick={() => {
                                                                setSelectedShipment(shipment);
                                                                setUpdateStatus(shipment.status);
                                                                setUpdateLocation(shipment.updates?.[shipment.updates.length - 1]?.location || "");
                                                                setUpdateNote("");
                                                                setIsUpdateOpen(true);
                                                            }}
                                                            className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition"
                                                            title="Update Shipment Status"
                                                        >
                                                            <Edit2 className="w-4.5 h-4.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleSyncCarrier(shipment.id)}
                                                            disabled={syncingId === shipment.id}
                                                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition disabled:opacity-50"
                                                            title="Sync Carrier Status"
                                                        >
                                                            {syncingId === shipment.id ? (
                                                                <Loader2 className="w-4.5 h-4.5 animate-spin" />
                                                            ) : (
                                                                <RefreshCw className="w-4.5 h-4.5" />
                                                            )}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create Shipment Modal */}
            {isCreateOpen && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl max-w-lg w-full my-8 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Plus className="w-5 h-5 text-blue-600" />
                                Create WAVE Shipment
                            </h2>
                            <button onClick={() => setIsCreateOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        {/* Scrollable Content */}
                        <form onSubmit={handleCreateShipment} className="flex-1 overflow-y-auto p-6 space-y-4">
                            {/* Member Search / Select */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">WAVE Participant</label>
                                {!selectedUser ? (
                                    <div className="space-y-3">
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-3 top-2.5 w-4.5 h-4.5 text-slate-400" />
                                                <input
                                                    type="text"
                                                    value={searchUserQuery}
                                                    onChange={e => setSearchUserQuery(e.target.value)}
                                                    placeholder="Search member by name or email..."
                                                    className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSearchUsers}
                                                disabled={searchingUsers || !searchUserQuery.trim()}
                                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition disabled:opacity-50"
                                            >
                                                {searchingUsers ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                                            </button>
                                        </div>
                                        {searchedUsers.length > 0 && (
                                            <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto divide-y divide-slate-100">
                                                {searchedUsers.map(user => (
                                                    <button
                                                        key={user.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedUser(user);
                                                            if (user.city && user.state) {
                                                                setDestination(`${user.city}, ${user.state}`);
                                                            } else if (user.state) {
                                                                setDestination(user.state);
                                                            }
                                                        }}
                                                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition flex items-center justify-between text-xs"
                                                    >
                                                        <div>
                                                            <div className="font-bold text-slate-800">{user.name}</div>
                                                            <div className="text-slate-400 mt-0.5">{user.email}</div>
                                                        </div>
                                                        <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold">Select</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-slate-800">{selectedUser.name}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">{selectedUser.email}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedUser(null)}
                                            className="text-xs text-red-600 font-bold hover:underline"
                                        >
                                            Change
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Produce or Kit Name */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Product / Input Kit Name</label>
                                <input
                                    type="text"
                                    value={productName}
                                    onChange={e => setProductName(e.target.value)}
                                    required
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            {/* Destination */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Destination Address</label>
                                <input
                                    type="text"
                                    value={destination}
                                    onChange={e => setDestination(e.target.value)}
                                    required
                                    placeholder="City, State"
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            {/* Carrier */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Carrier</label>
                                <select
                                    value={carrier}
                                    onChange={e => setCarrier(e.target.value)}
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-700 bg-white text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                                >
                                    <option value="MockLogistics">MockLogistics (Dynamic mock provider)</option>
                                    <option value="GIG Logistics">GIG Logistics</option>
                                    <option value="Kwik Delivery">Kwik Delivery</option>
                                </select>
                            </div>

                            {/* Tracking Number */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Tracking Number (Optional)</label>
                                <input
                                    type="text"
                                    value={trackingNumber}
                                    onChange={e => setTrackingNumber(e.target.value)}
                                    placeholder="Leave empty to auto-generate"
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateOpen(false)}
                                    className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingCreate}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {submittingCreate && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Create Shipment
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Update Status Modal */}
            {isUpdateOpen && selectedShipment && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Edit2 className="w-5 h-5 text-blue-600" />
                                Update Status
                            </h2>
                            <button onClick={() => setIsUpdateOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        {/* Content */}
                        <form onSubmit={handleUpdateStatus} className="p-6 space-y-4">
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Shipment</div>
                                <div className="font-semibold text-slate-800">{selectedShipment.productName} ({selectedShipment.id})</div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Status</label>
                                <select
                                    value={updateStatus}
                                    onChange={e => setUpdateStatus(e.target.value as any)}
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-700 bg-white text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                                >
                                    <option value="pending">Pending</option>
                                    <option value="in_transit">In Transit</option>
                                    <option value="delivered">Delivered (Fulfillment Complete)</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Current Location</label>
                                <input
                                    type="text"
                                    value={updateLocation}
                                    onChange={e => setUpdateLocation(e.target.value)}
                                    required
                                    placeholder="e.g. Lagos Hub, In Transit to Abuja"
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Notes / Description (Optional)</label>
                                <textarea
                                    value={updateNote}
                                    onChange={e => setUpdateNote(e.target.value)}
                                    placeholder="e.g. Sorted and dispatched for transit"
                                    rows={3}
                                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsUpdateOpen(false)}
                                    className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingUpdate}
                                    className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {submittingUpdate && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Save Updates
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Shipment Detail Modal */}
            {isDetailOpen && selectedShipment && (
                <div className="fixed inset-0 bg-black/55 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl max-w-xl w-full my-8 shadow-2xl border border-slate-100">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Shipment Details</h2>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedShipment.id}</p>
                            </div>
                            <button onClick={() => setIsDetailOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        {/* Content */}
                        <div className="p-6 space-y-6">
                            {/* Summary Grid */}
                            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
                                <div>
                                    <span className="text-slate-400 block font-semibold mb-0.5">WAVE Member</span>
                                    <span className="font-bold text-slate-800">{selectedShipment.memberName}</span>
                                    <span className="text-[10px] text-slate-550 block mt-0.5">{selectedShipment.memberEmail}</span>
                                </div>
                                <div>
                                    <span className="text-slate-400 block font-semibold mb-0.5">Carrier / Tracking</span>
                                    <span className="font-bold text-slate-800">{selectedShipment.carrier}</span>
                                    <span className="text-[10px] font-mono text-slate-550 block mt-0.5">{selectedShipment.trackingNumber}</span>
                                </div>
                                <div>
                                    <span className="text-slate-400 block font-semibold mb-0.5">Destination</span>
                                    <span className="font-bold text-slate-800 flex items-center gap-1">
                                        <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                        {selectedShipment.destination}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-slate-400 block font-semibold mb-0.5">Est. Delivery</span>
                                    <span className="font-bold text-slate-800 flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                        {new Date(selectedShipment.estimatedDelivery).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>

                            {/* Timeline */}
                            <div className="space-y-4">
                                <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                                    <Clock className="w-4.5 h-4.5 text-blue-600" />
                                    Transit History
                                </h3>

                                <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
                                    {selectedShipment.updates && selectedShipment.updates.length > 0 ? (
                                        selectedShipment.updates
                                            .slice()
                                            .reverse()
                                            .map((update, idx) => (
                                                <div key={idx} className="flex gap-4">
                                                    <div className="flex flex-col items-center">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                                            idx === 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-550"
                                                        }`}>
                                                            {idx === 0 ? (
                                                                <MapPin className="w-4 h-4" />
                                                            ) : (
                                                                <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                                                            )}
                                                        </div>
                                                        {idx < selectedShipment.updates.length - 1 && (
                                                            <div className="w-0.5 h-full bg-slate-200 mt-2 min-h-[30px]" />
                                                        )}
                                                    </div>

                                                    <div className="flex-1 pb-4">
                                                        <div className="flex items-center justify-between gap-1">
                                                            <span className="font-bold text-slate-800 text-xs">
                                                                {update.location}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {new Date(update.timestamp).toLocaleString()}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] font-semibold text-slate-550 capitalize mt-0.5">
                                                            Status: {update.status.replace("_", " ")}
                                                        </div>
                                                        {update.note && (
                                                            <div className="text-xs text-slate-655 mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100 italic">
                                                                {update.note}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                    ) : (
                                        <p className="text-center text-xs text-slate-400 py-6">
                                            No transit updates available yet
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
