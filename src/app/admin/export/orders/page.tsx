"use client";

import { useEffect, useRef, useState } from "react";
import { getAdminExportOrdersAction, updateAdminExportOrderStatusAction } from "@/app/actions/export-admin";
import { Ship, DollarSign, Package, CheckCircle, Clock, AlertCircle, FileText, Upload } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function AdminExportOrdersPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateStatus, setUpdateStatus] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchOrders();
    }, []);

    async function fetchOrders() {
        setLoading(true);
        try {
            const result = await getAdminExportOrdersAction();
            if (result.success && result.data) {
                setOrders(result.data);
            } else {
                setError(result.error || "Failed to load orders");
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateStatus() {
        if (!selectedOrder || !updateStatus) return;
        setIsUpdating(true);
        try {
            const result = await updateAdminExportOrderStatusAction(selectedOrder.id, updateStatus);
            if (result.success) {
                // Refresh data
                await fetchOrders();
                setSelectedOrder(null);
            } else {
                alert(result.error || "Failed to update status");
            }
        } catch (error) {
            alert("An error occurred");
        } finally {
            setIsUpdating(false);
        }
    }

    /**
     * Attach a shipping document to the selected order.
     *
     * Every piece of this already existed and none of them were joined up:
     * updateAdminExportOrderStatusAction has always taken an optional
     * `documentData` and arrayUnion'd it onto `documents`, the panel above
     * renders `documents` as {name, url}, /api/upload stores a file and returns
     * exactly that pair — and the "Upload Document" button had no handler at
     * all. So the panel said "No documents uploaded yet" for every order,
     * permanently, and the one control offered to change that did nothing when
     * clicked.
     *
     * The status is re-sent unchanged because the action requires one; this
     * attaches a document, it does not move the order.
     */
    async function handleUploadDocument(file: File) {
        if (!selectedOrder || !file) return;
        setUploadError(null);
        setIsUploading(true);
        try {
            const body = new FormData();
            body.append("file", file);
            body.append("folder", "export-orders");
            body.append("documentType", "shipping_document");

            const res = await fetch("/api/upload", { method: "POST", body });
            const uploaded = await res.json();
            if (!res.ok || !uploaded?.success || !uploaded?.url) {
                setUploadError(uploaded?.error || "Upload failed");
                return;
            }

            const result = await updateAdminExportOrderStatusAction(
                selectedOrder.id,
                selectedOrder.status,
                { name: uploaded.filename || file.name, url: uploaded.url, type: file.type },
            );
            if (!result.success) {
                setUploadError(result.error || "Could not attach the document to this order");
                return;
            }

            // Refresh, and keep the panel on the same order so the new document
            // appears in the list the admin is looking at.
            const refreshed = await getAdminExportOrdersAction();
            if (refreshed.success && refreshed.data) {
                setOrders(refreshed.data);
                const updated = refreshed.data.find((o: any) => o.id === selectedOrder.id);
                if (updated) setSelectedOrder(updated);
            }
        } catch {
            setUploadError("An error occurred while uploading");
        } finally {
            setIsUploading(false);
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case "processing": return "bg-blue-100 text-blue-700";
            case "shipped": return "bg-purple-100 text-purple-700";
            case "delivered": return "bg-green-100 text-green-700";
            case "pending_payment": return "bg-yellow-100 text-yellow-700";
            default: return "bg-slate-100 text-slate-700";
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Export Orders</h1>
                    <p className="text-slate-500 mt-1">Manage international buyer orders and shipping documents.</p>
                </div>
            </div>

            {error && (
                <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    <p>{error}</p>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-slate-50 text-slate-900 border-b border-slate-200">
                            <tr>
                                <th className="p-4 font-semibold">Order Details</th>
                                <th className="p-4 font-semibold">Buyer & Logistics</th>
                                <th className="p-4 font-semibold">Value</th>
                                <th className="p-4 font-semibold">Status</th>
                                <th className="p-4 font-semibold">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-500">
                                        No export orders found.
                                    </td>
                                </tr>
                            ) : (
                                orders.map(order => (
                                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <p className="font-medium text-slate-900 mb-1">{order.orderId}</p>
                                            <p className="text-xs text-slate-500 mb-2">
                                                {order.createdAt ? formatDistanceToNow(new Date(order.createdAt), { addSuffix: true }) : 'Unknown date'}
                                            </p>
                                            <div className="space-y-1">
                                                {order.items?.map((item: any, i: number) => (
                                                    <div key={i} className="flex items-center gap-2 text-xs">
                                                        <Package className="w-3 h-3 text-slate-400" />
                                                        <span>{item.quantityMT}MT {item.name} ({item.grade})</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <p className="font-medium text-slate-900">{order.buyerDetails?.companyName}</p>
                                            <p className="text-xs text-slate-500 mb-2">{order.buyerDetails?.country}</p>
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-1 rounded w-max">
                                                <Ship className="w-3.5 h-3.5" />
                                                {order.buyerDetails?.shippingTerm} - {order.buyerDetails?.portOfDestination}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <p className="font-bold text-slate-900">${order.totalUSD?.toLocaleString()}</p>
                                            <p className="text-xs text-slate-500">₦{order.totalNGN?.toLocaleString()}</p>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                                {order.status.replace("_", " ").toUpperCase()}
                                            </span>
                                            {order.documents && order.documents.length > 0 && (
                                                <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                                                    <FileText className="w-3 h-3" />
                                                    {order.documents.length} Docs Attached
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => { setSelectedOrder(order); setUpdateStatus(order.status); }}
                                                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors"
                                            >
                                                Manage Order
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Manage Order Modal */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-xl font-bold text-slate-900">Manage Export Order</h2>
                            <p className="text-sm text-slate-500">{selectedOrder.orderId}</p>
                        </div>
                        <div className="p-6 space-y-6">
                            
                            {/* Update Status */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Update Status</label>
                                <select 
                                    value={updateStatus}
                                    onChange={(e) => setUpdateStatus(e.target.value)}
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                                >
                                    <option value="pending_payment">Pending Payment</option>
                                    <option value="processing">Processing (Paid)</option>
                                    <option value="shipped">Shipped (In Transit)</option>
                                    <option value="delivered">Delivered</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </div>

                            {/* Documents Section */}
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-500" />
                                    Shipping Documents
                                </h3>
                                
                                {selectedOrder.documents && selectedOrder.documents.length > 0 ? (
                                    <ul className="space-y-2 mb-4">
                                        {selectedOrder.documents.map((doc: any, i: number) => (
                                            <li key={i} className="flex justify-between items-center text-sm bg-white p-2 rounded border border-slate-100">
                                                <span className="font-medium text-slate-700">{doc.name}</span>
                                                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View</a>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-slate-500 mb-4">No documents uploaded yet.</p>
                                )}

                                <input
                                    ref={documentInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,image/jpeg,image/png,image/webp"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        // Clear the input so re-picking the same
                                        // file fires change again.
                                        e.target.value = "";
                                        if (file) handleUploadDocument(file);
                                    }}
                                />
                                <button
                                    type="button"
                                    disabled={isUploading}
                                    onClick={() => documentInputRef.current?.click()}
                                    className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Upload className="w-4 h-4" />
                                    {isUploading ? "Uploading…" : "Upload Document (Bill of Lading, Invoice)"}
                                </button>
                                {uploadError && (
                                    <p className="mt-2 text-sm text-red-600">{uploadError}</p>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button 
                                onClick={() => setSelectedOrder(null)}
                                className="px-5 py-2 text-slate-600 hover:bg-slate-200 font-medium rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleUpdateStatus}
                                disabled={isUpdating}
                                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
                            >
                                {isUpdating ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
