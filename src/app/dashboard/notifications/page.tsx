"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Bell, X, Check, Trash2, Filter, Eye,
    Package, DollarSign, AlertCircle, TrendingUp, Users, Loader2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Notification {
    id: string;
    userId: string;
    type: "order" | "payment" | "system" | "wave" | "cooperative" | "academy";
    title: string;
    message: string;
    link?: string;
    read: boolean;
    createdAt: Date;
    priority: "low" | "medium" | "high";
}

export default function NotificationsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "unread" | Notification["type"]>("all");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            loadNotifications();
        }
    }, [status]);

    const loadNotifications = async () => {
        setLoading(true);
        try {
            // In production, fetch from getNotificationsAction
            const mockNotifications: Notification[] = [
                {
                    id: "1",
                    userId: session?.user?.id || "",
                    type: "order",
                    title: "New Order Received",
                    message: "You have a new order #ORD-2026-145 worth ₦125,000",
                    link: "/marketplace/sell/orders",
                    read: false,
                    createdAt: new Date(Date.now() - 1000 * 60 * 15),
                    priority: "high"
                },
                {
                    id: "2",
                    userId: session?.user?.id || "",
                    type: "payment",
                    title: "Payment Confirmed",
                    message: "Payment of ₦300,000 has been confirmed for order #ORD-2026-144",
                    link: "/wallet/transactions",
                    read: false,
                    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
                    priority: "medium"
                },
                {
                    id: "3",
                    userId: session?.user?.id || "",
                    type: "academy",
                    title: "Course Completed",
                    message: "Congratulations! You've completed 'Export Fundamentals'",
                    link: "/academy/dashboard",
                    read: true,
                    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
                    priority: "low"
                },
                {
                    id: "4",
                    userId: session?.user?.id || "",
                    type: "wave",
                    title: "WAVE Training Session",
                    message: "Reminder: Business Planning workshop starts in 2 hours",
                    link: "/wave/training",
                    read: false,
                    createdAt: new Date(Date.now() - 1000 * 60 * 120),
                    priority: "high"
                },
                {
                    id: "5",
                    userId: session?.user?.id || "",
                    type: "cooperative",
                    title: "Loan Approved",
                    message: "Your loan application of ₦500,000 has been approved",
                    link: "/cooperatives/my-loans",
                    read: true,
                    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
                    priority: "high"
                }
            ];
            setNotifications(mockNotifications);
        } catch (error) {
            console.error("Failed to load notifications:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredNotifications = notifications.filter(n => {
        if (filter === "all") return true;
        if (filter === "unread") return !n.read;
        return n.type === filter;
    });

    const unreadCount = notifications.filter(n => !n.read).length;

    const handleMarkAsRead = (id: string) => {
        setNotifications(prev => prev.map(n =>
            n.id === id ? { ...n, read: true } : n
        ));
    };

    const handleMarkAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const handleDelete = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const getIcon = (type: Notification["type"]) => {
        switch (type) {
            case "order": return <Package className="w-5 h-5" />;
            case "payment": return <DollarSign className="w-5 h-5" />;
            case "system": return <AlertCircle className="w-5 h-5" />;
            case "wave": return <TrendingUp className="w-5 h-5" />;
            case "cooperative": return <Users className="w-5 h-5" />;
            case "academy": return <Bell className="w-5 h-5" />;
            default: return <Bell className="w-5 h-5" />;
        }
    };

    const getIconColor = (type: Notification["type"]) => {
        switch (type) {
            case "order": return "text-blue-600 bg-blue-100 dark:bg-blue-900/20";
            case "payment": return "text-green-600 bg-green-100 dark:bg-green-900/20";
            case "system": return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/20";
            case "wave": return "text-purple-600 bg-purple-100 dark:bg-purple-900/20";
            case "cooperative": return "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/20";
            case "academy": return "text-pink-600 bg-pink-100 dark:bg-pink-900/20";
            default: return "text-gray-600 bg-gray-100 dark:bg-gray-900/20";
        }
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            Notifications
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
                            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
                        </p>
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllAsRead}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex items-center gap-2"
                        >
                            <Check className="w-4 h-4" />
                            Mark All Read
                        </button>
                    )}
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow mb-6">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <Filter className="w-5 h-5 text-gray-400 shrink-0" />
                        {[
                            { key: "all", label: "All" },
                            { key: "unread", label: "Unread" },
                            { key: "order", label: "Orders" },
                            { key: "payment", label: "Payments" },
                            { key: "wave", label: "WAVE" },
                            { key: "cooperative", label: "Cooperative" },
                            { key: "academy", label: "Academy" }
                        ].map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key as any)}
                                className={`px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${filter === f.key
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                                    }`}
                            >
                                {f.label}
                                {f.key === "unread" && unreadCount > 0 && (
                                    <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                                        {unreadCount}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Notifications List */}
                {filteredNotifications.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center shadow">
                        <Bell className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                            No Notifications
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400">
                            {filter === "all"
                                ? "You're all caught up!"
                                : `No ${filter} notifications`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredNotifications.map((notif) => (
                            <div
                                key={notif.id}
                                className={`bg-white dark:bg-gray-800 rounded-xl p-5 shadow transition hover:shadow-lg ${!notif.read ? "border-l-4 border-blue-600" : ""
                                    }`}
                            >
                                <div className="flex items-start gap-4">
                                    {/* Icon */}
                                    <div className={`p-3 rounded-xl shrink-0 ${getIconColor(notif.type)}`}>
                                        {getIcon(notif.type)}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-3 mb-2">
                                            <h3 className={`font-bold ${!notif.read ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}>
                                                {notif.title}
                                            </h3>
                                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                                {formatDistanceToNow(notif.createdAt, { addSuffix: true })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                            {notif.message}
                                        </p>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2">
                                            {notif.link && (
                                                <button
                                                    onClick={() => router.push(notif.link!)}
                                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition flex items-center gap-1.5"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                    View
                                                </button>
                                            )}
                                            {!notif.read && (
                                                <button
                                                    onClick={() => handleMarkAsRead(notif.id)}
                                                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition flex items-center gap-1.5"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                    Mark Read
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(notif.id)}
                                                className="px-3 py-1.5 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg transition flex items-center gap-1.5"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                Delete
                                            </button>
                                        </div>
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
