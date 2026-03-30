"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Bell, Check, Trash2, Filter, Eye,
    Package, DollarSign, AlertCircle, TrendingUp,
    Users, Loader2, Info, CheckCircle, XCircle,
    Landmark, BookOpen,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { db } from "@/lib/firebase";
import { collection, query, where, orderBy, limit, onSnapshot, doc, deleteDoc, updateDoc, Timestamp } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useToast } from "@/contexts/ToastContext";

/* ──────────────────────────────────────────────────────────────
 * Types — aligned with Firestore schema in actions/notifications.ts
 * ────────────────────────────────────────────────────────────── */
type NotifType =
    | "info" | "success" | "warning" | "error"
    | "loan" | "payment" | "wave" | "withdrawal"
    | "land" | "escrow" | "dispute"
    | "order" | "academy" | "cooperative" | "system"
    | "export" | "payout" | "farm_nation" | "marketplace"
    | "general" | "transaction";

interface Notification {
    id: string;
    userId: string;
    type: NotifType;
    title: string;
    message: string;
    link?: string;
    linkText?: string;
    read: boolean;
    createdAt: any; // Firestore Timestamp
}

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */
function getIcon(type: NotifType) {
    switch (type) {
        case "order": case "transaction": return <Package className="w-5 h-5" />;
        case "payment": case "payout": return <DollarSign className="w-5 h-5" />;
        case "warning": case "dispute": return <AlertCircle className="w-5 h-5" />;
        case "wave": return <TrendingUp className="w-5 h-5" />;
        case "cooperative": return <Users className="w-5 h-5" />;
        case "academy": return <BookOpen className="w-5 h-5" />;
        case "loan": case "export": return <Landmark className="w-5 h-5" />;
        case "success": return <CheckCircle className="w-5 h-5" />;
        case "error": case "withdrawal": return <XCircle className="w-5 h-5" />;
        case "info": default: return <Info className="w-5 h-5" />;
    }
}

function getIconColor(type: NotifType): string {
    switch (type) {
        case "order": case "transaction": return "text-blue-600 bg-blue-100";
        case "payment": case "payout": return "text-green-600 bg-green-100";
        case "warning": return "text-yellow-600 bg-yellow-100";
        case "error": case "dispute": return "text-red-600 bg-red-100";
        case "wave": return "text-purple-600 bg-purple-100";
        case "cooperative": return "text-indigo-600 bg-indigo-100";
        case "academy": return "text-pink-600 bg-pink-100";
        case "loan": case "export": return "text-cyan-600 bg-cyan-100";
        case "success": return "text-emerald-600 bg-emerald-100";
        default: return "text-gray-600 bg-gray-100";
    }
}

function toDate(val: any): Date {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (val?.toDate) return val.toDate();
    if (val?.seconds) return new Date(val.seconds * 1000);
    return new Date(val);
}

/* ──────────────────────────────────────────────────────────────
 * Filter Tab Config
 * ────────────────────────────────────────────────────────────── */
const FILTER_TABS: { key: string; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "payment", label: "Payments" },
    { key: "order", label: "Orders" },
    { key: "wave", label: "WAVE" },
    { key: "cooperative", label: "Cooperative" },
    { key: "academy", label: "Academy" },
    { key: "loan", label: "Loans" },
    { key: "dispute", label: "Disputes" },
];

export default function NotificationsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const userId = session?.user?.id;

    /* ── Real-time Firestore listener ── */
    useEffect(() => {
        if (status === "unauthenticated") { router.push("/auth/login"); return; }
        if (!userId) return;

        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(100)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const data: Notification[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            } as Notification));
            setNotifications(data);
            setLoading(false);
        }, (error) => {
            console.error("Notification listener error:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [userId, status, router]);

    /* ── Filtered list ── */
    const filtered = notifications.filter(n => {
        if (filter === "all") return true;
        if (filter === "unread") return !n.read;
        // Match on type — also treat "payment"/"payout" as same bucket, etc.
        if (filter === "payment") return n.type === "payment" || n.type === "payout" || n.type === "transaction";
        if (filter === "order") return n.type === "order" || n.type === "transaction";
        return n.type === filter;
    });

    const unreadCount = notifications.filter(n => !n.read).length;

    /* ── Actions ── */
    async function handleMarkAsRead(id: string) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
        try {
            await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id), { read: true });
        } catch {
            showToast("Failed to mark as read", "error");
        }
    }

    async function handleMarkAllAsRead() {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        try {
            const unreadItems = notifications.filter(n => !n.read);
            await Promise.all(
                unreadItems.map(n => updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, n.id), { read: true }))
            );
        } catch {
            showToast("Failed to mark all as read", "error");
        }
    }

    async function handleDelete(id: string) {
        setDeletingId(id);
        setNotifications(prev => prev.filter(n => n.id !== id));
        try {
            await deleteDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id));
        } catch {
            showToast("Failed to delete notification", "error");
            // Re-fetch is handled by onSnapshot — deleted doc will disappear automatically
        } finally {
            setDeletingId(null);
        }
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-1">Notifications</h1>
                        <p className="text-gray-500 text-sm">
                            {unreadCount > 0
                                ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                                : "All caught up!"}
                        </p>
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllAsRead}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex items-center gap-2 text-sm font-semibold"
                        >
                            <Check className="w-4 h-4" />
                            Mark All Read
                        </button>
                    )}
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl p-3 shadow-sm mb-5 overflow-x-auto">
                    <div className="flex items-center gap-2 min-w-max">
                        <Filter className="w-4 h-4 text-gray-400 shrink-0" />
                        {FILTER_TABS.map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={`px-3 py-1.5 rounded-lg font-medium text-sm transition whitespace-nowrap ${
                                    filter === f.key
                                        ? "bg-blue-600 text-white shadow-sm"
                                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                }`}
                            >
                                {f.label}
                                {f.key === "unread" && unreadCount > 0 && (
                                    <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded-full text-xs">
                                        {unreadCount}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Notifications List */}
                {filtered.length === 0 ? (
                    <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                        <Bell className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900 mb-1">No Notifications</h3>
                        <p className="text-gray-500 text-sm">
                            {filter === "all" ? "You're all caught up!" : `No ${filter} notifications`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((notif) => (
                            <div
                                key={notif.id}
                                className={`bg-white rounded-xl p-5 shadow-sm transition hover:shadow-md ${
                                    !notif.read ? "border-l-4 border-blue-500" : "border border-slate-100"
                                }`}
                            >
                                <div className="flex items-start gap-4">
                                    {/* Icon */}
                                    <div className={`p-2.5 rounded-xl shrink-0 ${getIconColor(notif.type)}`}>
                                        {getIcon(notif.type)}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-3 mb-1">
                                            <h3 className={`font-bold text-sm ${!notif.read ? "text-gray-900" : "text-gray-600"}`}>
                                                {notif.title}
                                            </h3>
                                            <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                                                {formatDistanceToNow(toDate(notif.createdAt), { addSuffix: true })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-500 leading-relaxed mb-3">
                                            {notif.message}
                                        </p>

                                        {/* Actions */}
                                        <div className="flex items-center flex-wrap gap-2">
                                            {notif.link && (
                                                <button
                                                    onClick={() => router.push(notif.link!)}
                                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                    {notif.linkText || "View"}
                                                </button>
                                            )}
                                            {!notif.read && (
                                                <button
                                                    onClick={() => handleMarkAsRead(notif.id)}
                                                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                    Mark Read
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(notif.id)}
                                                disabled={deletingId === notif.id}
                                                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 disabled:opacity-50"
                                            >
                                                {deletingId === notif.id
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <Trash2 className="w-3.5 h-3.5" />
                                                }
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
