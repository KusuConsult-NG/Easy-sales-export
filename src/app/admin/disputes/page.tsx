"use client";

import { useState } from "react";
import {
    AlertCircle,
    Clock,
    CheckCircle,
    MessageSquare,
    Filter,
    Search,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function AdminDisputesPage() {
    const [selectedDispute, setSelectedDispute] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState("all");

    // Mock disputes data
    const disputes = [
        {
            id: "DSP-2024-001",
            orderId: "EXP-2024-001",
            type: "order",
            subject: "Product Quality Issue",
            description:
                "Received yam tubers do not match the quality specifications agreed upon",
            complainant: {
                id: "USR-001",
                name: "John Doe",
                email: "john@example.com",
            },
            respondent: {
                id: "USR-045",
                name: "Farm Nation Cooperative",
                email: "farmnation@example.com",
            },
            status: "investigating",
            priority: "high",
            amount: 150000,
            createdAt: "2024-02-01",
            messages: [
                {
                    id: "1",
                    senderId: "USR-001",
                    senderName: "John Doe",
                    message:
                        "The yam tubers delivered were significantly smaller than the samples shown during ordering. Request full refund.",
                    timestamp: "2024-02-01 10:30 AM",
                },
                {
                    id: "2",
                    senderId: "ADMIN",
                    senderName: "Admin Support",
                    message:
                        "Thank you for reporting this issue. We have notified the seller and are reviewing the evidence provided.",
                    timestamp: "2024-02-01 11:15 AM",
                },
            ],
        },
        {
            id: "DSP-2024-002",
            orderId: "EXP-2024-015",
            type: "payment",
            subject: "Escrow Release Delay",
            description: "Seller requesting early escrow release before standard 15-day period",
            complainant: {
                id: "USR-078",
                name: "WAVE Women's Group",
                email: "wave@example.com",
            },
            respondent: {
                id: "USR-023",
                name: "AGCorporative",
                email: "buyer@example.com",
            },
            status: "open",
            priority: "medium",
            amount: 80000,
            createdAt: "2024-02-02",
            messages: [
                {
                    id: "1",
                    senderId: "USR-078",
                    senderName: "WAVE Women's Group",
                    message:
                        "Delivery was confirmed 3 days ago. Requesting early release of escrow payment.",
                    timestamp: "2024-02-02 09:00 AM",
                },
            ],
        },
        {
            id: "DSP-2024-003",
            orderId: "EXP-2024-008",
            type: "order",
            subject: "Non-Delivery Complaint",
            description: "Order not received within agreed timeframe",
            complainant: {
                id: "USR-112",
                name: "Export Direct Ltd",
                email: "export@example.com",
            },
            respondent: {
                id: "USR-056",
                name: "Northern Agro Coop",
                email: "northern@example.com",
            },
            status: "resolved",
            priority: "urgent",
            amount: 350000,
            createdAt: "2024-01-28",
            messages: [
                {
                    id: "1",
                    senderId: "USR-112",
                    senderName: "Export Direct Ltd",
                    message: "Order was supposed to arrive 5 days ago. No updates from seller.",
                    timestamp: "2024-01-28 02:30 PM",
                },
                {
                    id: "2",
                    senderId: "ADMIN",
                    senderName: "Admin Support",
                    message:
                        "Investigation complete. Full refund issued to buyer. Seller account suspended.",
                    timestamp: "2024-01-30 04:00 PM",
                },
            ],
        },
    ];

    const getStatusBadge = (status: string) => {
        const config = {
            open: {
                bg: "bg-yellow-100 dark:bg-yellow-900/30",
                text: "text-yellow-700 dark:text-yellow-400",
                icon: Clock,
            },
            investigating: {
                bg: "bg-blue-100 dark:bg-blue-900/30",
                text: "text-blue-700 dark:text-blue-400",
                icon: AlertCircle,
            },
            resolved: {
                bg: "bg-green-100 dark:bg-green-900/30",
                text: "text-green-700 dark:text-green-400",
                icon: CheckCircle,
            },
            closed: {
                bg: "bg-slate-100 dark:bg-slate-700",
                text: "text-slate-700 dark:text-slate-300",
                icon: CheckCircle,
            },
        };

        const { bg, text, icon: Icon } = config[status as keyof typeof config] || config.open;

        return (
            <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit ${bg} ${text}`}>
                <Icon className="w-3 h-3" />
                {status.toUpperCase()}
            </span>
        );
    };

    const getPriorityBadge = (priority: string) => {
        const colors = {
            low: "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
            medium:
                "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
            high: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
            urgent: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
        };

        return (
            <span
                className={`px-2 py-1 rounded text-xs font-bold ${colors[priority as keyof typeof colors]
                    }`}
            >
                {priority.toUpperCase()}
            </span>
        );
    };

    const filteredDisputes =
        filterStatus === "all"
            ? disputes
            : disputes.filter((d) => d.status === filterStatus);

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Dispute Management
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and resolve member disputes
                </p>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[300px]">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by ID, order, or complainant..."
                                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-slate-500" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Status</option>
                            <option value="open">Open</option>
                            <option value="investigating">Investigating</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Disputes List */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Disputes Sidebar */}
                <div className="lg:col-span-1 space-y-4">
                    {filteredDisputes.map((dispute, index) => (
                        <div
                            key={dispute.id}
                            onClick={() => setSelectedDispute(dispute.id)}
                            className={`bg-white dark:bg-slate-800 rounded-xl p-5 cursor-pointer transition-all animate-[slideInUp_0.6s_ease-out] ${selectedDispute === dispute.id
                                    ? "ring-2 ring-primary elevation-3"
                                    : "elevation-1 hover-lift"
                                }`}
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                        {dispute.id}
                                    </p>
                                    <h3 className="font-bold text-slate-900 dark:text-white">
                                        {dispute.subject}
                                    </h3>
                                </div>
                                {getPriorityBadge(dispute.priority)}
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 line-clamp-2">
                                {dispute.description}
                            </p>
                            <div className="flex items-center justify-between">
                                {getStatusBadge(dispute.status)}
                                <span className="text-xs text-slate-500">
                                    {dispute.createdAt}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Dispute Detail */}
                <div className="lg:col-span-2">
                    {selectedDispute ? (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                            {(() => {
                                const dispute = disputes.find((d) => d.id === selectedDispute);
                                if (!dispute) return null;

                                return (
                                    <>
                                        {/* Header */}
                                        <div className="mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                                                        Dispute ID: {dispute.id}
                                                    </p>
                                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                                        {dispute.subject}
                                                    </h2>
                                                </div>
                                                <div className="text-right">
                                                    {getStatusBadge(dispute.status)}
                                                </div>
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-400 mb-4">
                                                {dispute.description}
                                            </p>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                                        Complainant
                                                    </p>
                                                    <p className="font-semibold text-slate-900 dark:text-white">
                                                        {dispute.complainant.name}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                                        {dispute.complainant.email}
                                                    </p>
                                                </div>
                                                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                                        Respondent
                                                    </p>
                                                    <p className="font-semibold text-slate-900 dark:text-white">
                                                        {dispute.respondent.name}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                                        {dispute.respondent.email}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Messages */}
                                        <div className="mb-6">
                                            <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                                <MessageSquare className="w-5 h-5" />
                                                Conversation History
                                            </h3>
                                            <div className="space-y-4">
                                                {dispute.messages.map((message) => (
                                                    <div
                                                        key={message.id}
                                                        className={`p-4 rounded-xl ${message.senderId === "ADMIN"
                                                                ? "bg-primary/10 border border-primary/20"
                                                                : "bg-slate-50 dark:bg-slate-900"
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between mb-2">
                                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                                {message.senderName}
                                                            </p>
                                                            <p className="text-xs text-slate-500">
                                                                {message.timestamp}
                                                            </p>
                                                        </div>
                                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                                            {message.message}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex flex-wrap gap-3">
                                            {dispute.status !== "resolved" && (
                                                <>
                                                    <button className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors">
                                                        Resolve in Favor of Buyer
                                                    </button>
                                                    <button className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors">
                                                        Resolve in Favor of Seller
                                                    </button>
                                                    <button className="px-6 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                                                        Request More Info
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 elevation-2 text-center">
                            <AlertCircle className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-slate-400">
                                Select a dispute to view details
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
