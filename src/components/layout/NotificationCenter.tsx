"use client";

import { useState, useEffect } from "react";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { Bell, BellDot, Package, DollarSign, GraduationCap, Users, Wallet, TrendingUp, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import { collection, query, where, onSnapshot, Timestamp, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { markNotificationAsReadAction, markAllAsReadAction } from "@/app/actions/notifications";
import { useFirebaseAuthed } from "@/hooks/useFirebaseAuthed";

import type { Notification as FirestoreNotification } from "@/lib/types/firestore";

export interface Notification extends Omit<FirestoreNotification, "createdAt" | "readAt"> {
    createdAt: Timestamp;
    readAt?: Timestamp;
}

export default function NotificationCenter() {
    const { data: session } = useSession();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    const userId = session?.user?.id;
    const isAuthed = useFirebaseAuthed(userId);

    // Real-time Firestore listener
    useEffect(() => {
        if (!userId || !isAuthed) {
            setLoading(false);
            return;
        }

        // Query notifications for current user
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(50) // Limit to latest 50 notifications
        );

        // Set up real-time listener
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const notifs: Notification[] = [];
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    notifs.push({
                        id: doc.id,
                        userId: data.userId,
                        type: data.type || "info",
                        title: data.title,
                        message: data.message,
                        link: data.link,
                        linkText: data.linkText,
                        read: data.read,
                        createdAt: data.createdAt,
                        readAt: data.readAt,
                    });
                });
                setNotifications(notifs);
                setLoading(false);
            },
            (error) => {
                console.error("Notification listener error:", error);
                setLoading(false);
            }
        );

        // Cleanup listener on unmount
        return () => unsubscribe();
    }, [userId, isAuthed]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const markAsRead = async (id: string) => {
        try {
            await markNotificationAsReadAction(id);
            // UI will update automatically via onSnapshot listener
        } catch (error) {
            console.error("Mark as read error:", error);
        }
    };

    async function markAllAsRead() {
        if (!session?.user?.id) return;

        try {
            await markAllAsReadAction(session.user.id);
            // UI will update automatically via onSnapshot listener
        } catch (error) {
            console.error("Mark all as read error:", error);
        }
    };

    const getNotificationIcon = (type: Notification["type"]) => {
        switch (type) {
            case "payment":
                return <DollarSign className="w-5 h-5" />;
            case "loan":
            case "escrow":
            case "payout":
                return <Wallet className="w-5 h-5" />;
            case "wave":
                return <TrendingUp className="w-5 h-5" />;
            case "academy":
                return <GraduationCap className="w-5 h-5" />;
            case "order":
            case "transaction":
            case "marketplace":
                return <Package className="w-5 h-5" />;
            case "cooperative":
            case "farm_nation":
                return <Users className="w-5 h-5" />;
            default:
                return <Bell className="w-5 h-5" />;
        }
    };

    const getNotificationColor = (type: Notification["type"]) => {
        switch (type) {
            case "payment":
            case "success":
                return "bg-green-100 text-green-600";
            case "loan":
            case "info":
            case "system":
            case "general":
                return "bg-blue-100 text-blue-600";
            case "wave":
            case "warning":
                return "bg-yellow-100 text-yellow-600";
            case "payout":
            case "escrow":
                return "bg-purple-100 text-purple-600";
            case "farm_nation":
            case "cooperative":
                return "bg-emerald-100 text-emerald-600";
            case "order":
            case "transaction":
            case "marketplace":
            case "event":
                return "bg-indigo-100 text-indigo-600";
            default:
                return "bg-slate-100 text-slate-600";
        }
    };

    // Don't show notification bell if not logged in
    if (!session?.user) {
        return null;
    }

    return (
        <Menu as="div" className="relative">
            {({ open }) => (
                <>
                    <Menu.Button
                        className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {unreadCount > 0 ? (
                            <>
                                <BellDot className="w-6 h-6 text-slate-900" />
                                <span className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            </>
                        ) : (
                            <Bell className="w-6 h-6 text-slate-900" />
                        )}
                    </Menu.Button>

                    <Transition
                        as={Fragment}
                        show={open}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                    >
                        <Menu.Items className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl bg-white shadow-xl ring-1 ring-black/5 focus:outline-none z-50">
                            {/* Header */}
                            <div className="px-6 py-4 border-b border-slate-200">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-slate-900">
                                        Notifications
                                    </h3>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={markAllAsRead}
                                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Notifications List */}
                            <div className="max-h-96 overflow-y-auto">
                                {loading ? (
                                    <div className="px-6 py-8 text-center">
                                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                                        <p className="text-sm text-slate-500">
                                            Loading notifications...
                                        </p>
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className="px-6 py-8 text-center">
                                        <Bell className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                                        <p className="text-sm text-slate-500">
                                            No notifications yet
                                        </p>
                                    </div>
                                ) : (
                                    notifications.map((notification) => (
                                        <Menu.Item key={notification.id}>
                                            {({ active }) => (
                                                <div
                                                    className={`relative px-6 py-4 border-b border-slate-100 last:border-0 cursor-pointer transition ${active
                                                            ? "bg-slate-50"
                                                            : ""
                                                        } ${!notification.read
                                                            ? "bg-blue-50/30"
                                                            : ""
                                                        }`}
                                                    onClick={() => {
                                                        if (!notification.read) {
                                                            markAsRead(notification.id);
                                                        }
                                                        if (notification.link) {
                                                            window.location.href = notification.link;
                                                        }
                                                    }}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div
                                                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getNotificationColor(
                                                                notification.type
                                                            )}`}
                                                        >
                                                            {getNotificationIcon(notification.type)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                                <p className="font-semibold text-sm text-slate-900">
                                                                    {notification.title}
                                                                </p>
                                                                {!notification.read && (
                                                                    <div className="w-2 h-2 bg-blue-600 rounded-full shrink-0 mt-1" />
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-slate-600 mb-2">
                                                                {notification.message}
                                                            </p>
                                                            <p className="text-xs text-slate-500">
                                                                {formatDistanceToNow(
                                                                    notification.createdAt.toDate(),
                                                                    { addSuffix: true }
                                                                )}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </Menu.Item>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            {notifications.length > 0 && (
                                <div className="px-6 py-3 border-t border-slate-200">
                                    <a
                                        href="/notifications"
                                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center justify-center transition"
                                    >
                                        View All Notifications
                                    </a>
                                </div>
                            )}
                        </Menu.Items>
                    </Transition>
                </>
            )}
        </Menu>
    );
}
