"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Truck, Package, MapPin, Clock, CheckCircle, XCircle,
    Loader2, Calendar, Navigation
} from "lucide-react";
import { getShipmentTrackingAction } from "@/app/actions/wave";
import type { ShipmentTracking } from "@/app/actions/wave";
import { formatDistanceToNow } from "date-fns";

export default function WaveShipmentsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [shipments, setShipments] = useState<ShipmentTracking[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedShipment, setSelectedShipment] = useState<ShipmentTracking | null>(null);
    const [showTrackingModal, setShowTrackingModal] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated" && session?.user?.id) {
            loadShipments();
        }
    }, [status, session]);

    const loadShipments = async () => {
        if (!session?.user?.id) return;

        setLoading(true);
        try {
            const result = await getShipmentTrackingAction(session.user.id);
            setShipments(result);
        } catch (error) {
            console.error("Failed to load shipments:", error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status: ShipmentTracking["status"]) => {
        switch (status) {
            case "pending": return "yellow";
            case "in_transit": return "blue";
            case "delivered": return "green";
            case "cancelled": return "red";
            default: return "gray";
        }
    };

    const getStatusIcon = (status: ShipmentTracking["status"]) => {
        switch (status) {
            case "pending": return <Clock className="w-5 h-5" />;
            case "in_transit": return <Truck className="w-5 h-5" />;
            case "delivered": return <CheckCircle className="w-5 h-5" />;
            case "cancelled": return <XCircle className="w-5 h-5" />;
            default: return <Package className="w-5 h-5" />;
        }
    };

    const stats = {
        total: shipments.length,
        pending: shipments.filter(s => s.status === "pending").length,
        inTransit: shipments.filter(s => s.status === "in_transit").length,
        delivered: shipments.filter(s => s.status === "delivered").length,
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-blue-900/20 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-blue-900/20 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                        <Truck className="w-8 h-8 text-blue-600" />
                        Shipment Tracking
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Track your WAVE program shipments in real-time
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                            <Package className="w-6 h-6 text-gray-400" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.total}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Shipments</p>
                    </div>

                    <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl p-6 shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <Clock className="w-6 h-6" />
                            <span className="text-2xl font-bold">{stats.pending}</span>
                        </div>
                        <p className="text-sm text-yellow-100">Pending</p>
                    </div>

                    <div className="bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl p-6 shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <Truck className="w-6 h-6" />
                            <span className="text-2xl font-bold">{stats.inTransit}</span>
                        </div>
                        <p className="text-sm text-blue-100">In Transit</p>
                    </div>

                    <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl p-6 shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <CheckCircle className="w-6 h-6" />
                            <span className="text-2xl font-bold">{stats.delivered}</span>
                        </div>
                        <p className="text-sm text-green-100">Delivered</p>
                    </div>
                </div>

                {/* Shipments List */}
                {shipments.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center shadow-xl">
                        <Truck className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                            No Shipments Yet
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400">
                            Your shipments will appear here once orders are placed
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {shipments.map((shipment) => {
                            const statusColor = getStatusColor(shipment.status);
                            const latestUpdate = shipment.updates && shipment.updates.length > 0
                                ? shipment.updates[shipment.updates.length - 1]
                                : null;

                            return (
                                <div
                                    key={shipment.id}
                                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition"
                                >
                                    {/* Shipment Header */}
                                    <div className={`bg-gradient-to-r from-${statusColor}-500 to-${statusColor}-600 text-white p-6`}>
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-4">
                                                <div className="p-3 bg-white/20 rounded-xl">
                                                    {getStatusIcon(shipment.status)}
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-bold mb-1">
                                                        {shipment.productName}
                                                    </h3>
                                                    <p className="text-sm opacity-90">
                                                        Order #{shipment.orderId}
                                                    </p>
                                                    <p className="text-sm opacity-75 mt-1">
                                                        Tracking: {shipment.trackingNumber}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className={`px-4 py-2 bg-white/${statusColor === 'yellow' ? '30' : '20'} rounded-lg font-bold text-sm capitalize`}>
                                                {shipment.status.replace("_", " ")}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Shipment Details */}
                                    <div className="p-6">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                            {/* Destination */}
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <MapPin className="w-5 h-5 text-gray-400" />
                                                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                                                        Destination
                                                    </p>
                                                </div>
                                                <p className="font-bold text-gray-900 dark:text-white">
                                                    {shipment.destination}
                                                </p>
                                            </div>

                                            {/* Carrier */}
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Truck className="w-5 h-5 text-gray-400" />
                                                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                                                        Carrier
                                                    </p>
                                                </div>
                                                <p className="font-bold text-gray-900 dark:text-white">
                                                    {shipment.carrier}
                                                </p>
                                            </div>

                                            {/* Estimated Delivery */}
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Calendar className="w-5 h-5 text-gray-400" />
                                                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                                                        {shipment.status === "delivered" ? "Delivered On" : "Est. Delivery"}
                                                    </p>
                                                </div>
                                                <p className="font-bold text-gray-900 dark:text-white">
                                                    {shipment.status === "delivered" && shipment.actualDelivery
                                                        ? new Date(shipment.actualDelivery as any).toLocaleDateString()
                                                        : new Date(shipment.estimatedDelivery).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Latest Update */}
                                        {latestUpdate && (
                                            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 mb-4">
                                                <div className="flex items-start gap-3">
                                                    <Navigation className="w-5 h-5 text-blue-600 mt-0.5" />
                                                    <div className="flex-1">
                                                        <p className="font-semibold text-gray-900 dark:text-white mb-1">
                                                            {latestUpdate.location}
                                                        </p>
                                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                                            {latestUpdate.note || latestUpdate.status}
                                                        </p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {formatDistanceToNow(new Date(latestUpdate.timestamp), { addSuffix: true })}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Action Button */}
                                        <button
                                            onClick={() => {
                                                setSelectedShipment(shipment);
                                                setShowTrackingModal(true);
                                            }}
                                            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                                        >
                                            <MapPin className="w-5 h-5" />
                                            View Full Tracking
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Tracking Details Modal */}
                {showTrackingModal && selectedShipment && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full my-8">
                            {/* Modal Header */}
                            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 rounded-t-2xl">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="text-2xl font-bold mb-1">
                                            Tracking Details
                                        </h2>
                                        <p className="text-blue-100">
                                            {selectedShipment.trackingNumber}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowTrackingModal(false)}
                                        className="p-2 hover:bg-white/20 rounded-lg transition"
                                    >
                                        <XCircle className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Content */}
                            <div className="p-6">
                                {/* Timeline */}
                                <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-blue-600" />
                                    Shipment History
                                </h3>

                                <div className="space-y-4">
                                    {selectedShipment.updates && selectedShipment.updates.length > 0 ? (
                                        selectedShipment.updates
                                            .slice()
                                            .reverse()
                                            .map((update, idx) => (
                                                <div key={idx} className="flex gap-4">
                                                    {/* Timeline Dot */}
                                                    <div className="flex flex-col items-center">
                                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${idx === 0
                                                                ? "bg-blue-600 text-white"
                                                                : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                                                            }`}>
                                                            {idx === 0 ? <MapPin className="w-5 h-5" /> : <div className="w-3 h-3 rounded-full bg-current" />}
                                                        </div>
                                                        {idx < selectedShipment.updates.length - 1 && (
                                                            <div className="w-0.5 h-full bg-gray-200 dark:bg-gray-700 mt-2" style={{ minHeight: "30px" }} />
                                                        )}
                                                    </div>

                                                    {/* Update Details */}
                                                    <div className="flex-1 pb-6">
                                                        <p className="font-semibold text-gray-900 dark:text-white mb-1">
                                                            {update.location}
                                                        </p>
                                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 capitalize">
                                                            {update.status}
                                                        </p>
                                                        {update.note && (
                                                            <p className="text-sm text-gray-500 dark:text-gray-500 mb-2">
                                                                {update.note}
                                                            </p>
                                                        )}
                                                        <p className="text-xs text-gray-400">
                                                            {new Date(update.timestamp).toLocaleString()}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                    ) : (
                                        <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                                            No tracking updates yet
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
