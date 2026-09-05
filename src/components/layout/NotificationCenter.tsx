"use client";

import { useState, useEffect, useRef } from "react";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { Bell, BellDot, Package, DollarSign, GraduationCap, Users, Wallet, TrendingUp, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import { getMyNotifications } from "@/app/actions/my-data";
import { markNotificationAsReadAction, markAllAsReadAction } from "@/app/actions/notifications";
import { isNotificationVisible } from "@/lib/notification-filter";
import { toDate } from "@/lib/date-utils";

import type { Notification as FirestoreNotification } from "@/lib/types/firestore";

export interface Notification extends Omit<FirestoreNotification, "createdAt" | "readAt"> {
    createdAt: any;
    readAt?: any;
}

export default function NotificationCenter() {
    const { data: session } = useSession();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    // Track IDs we've already queued for mark-as-read to avoid duplicate writes
    const pendingReadRef = useRef<Set<string>>(new Set());

    const userId = session?.user?.id;

    // Subscription data for module-based filtering
    const serviceRegistrations = (session?.user as any)?.serviceRegistrations as Record<string, any> | undefined;
    const roles = (session?.user as any)?.roles as string[] | undefined;

    // Load notifications via Polling
    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }

        let isMounted = true;
        // Scoped server-side to the signed-in user. This previously queried
        // Supabase directly from the browser with the public anon key.
        async function fetchNotifications() {
            try {
                const notifs = await getMyNotifications(50);
                if (isMounted) setNotifications(notifs as any);
            } catch (err) {
                console.error("Failed to fetch notifications:", err);
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        fetchNotifications();
        const interval = setInterval(fetchNotifications, 10000); // Poll every 10 seconds

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [userId]);

    // Filter to only show notifications for subscribed modules
    const visibleNotifications = notifications.filter((n) =>
        isNotificationVisible(n.type, serviceRegistrations, roles)
    );

    const unreadCount = visibleNotifications.filter((n) => !n.read).length;

    /**
     *   #406 THE ROLLBACK WAS WRITTEN FOR A FAILURE THAT NEVER ARRIVES.
     *
     *   The revert below lived in the `catch` alone. Both notification actions
     *   catch internally and RETURN `{ success: false, error }` — an
     *   unauthenticated caller, a service failure, an ownership refusal, all of
     *   them resolve rather than throw. So the branch that undoes the optimistic
     *   write only ran for an exception, which is the rare case, and never for
     *   the ordinary one.
     *
     *   The result of the await was not looked at at all, at any of the three
     *   call sites in this file. A refused write left the row displayed as read
     *   and the badge decremented, and nothing told the user or the code.
     *
     *   That is #331's shape — a check that cannot fail — sitting on top of
     *   #337's: a control that reports success it did not obtain.
     *
     *   Rolled back per-id rather than by restoring a snapshot of the list,
     *   because the poll on this component can deliver new notifications while
     *   the write is in flight and a snapshot would drop them.
     */
    const markAsRead = async (id: string) => {
        // Optimistic update — decrement immediately in local state
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: true } : n)
        );
        const revert = () => setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: false } : n)
        );
        try {
            const result = await markNotificationAsReadAction(id);
            if (!result?.success) {
                console.error("Mark as read refused:", result?.error);
                revert();
            }
        } catch (error) {
            console.error("Mark as read error:", error);
            revert();
        }
    };

    async function markAllAsRead() {
        if (!session?.user?.id) return;
        // The ids this call is actually changing. Anything already read stays
        // read on a failure — reverting the whole list would mark them unread.
        const changed = notifications.filter(n => !n.read).map(n => n.id);
        if (changed.length === 0) return;

        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        const revert = () => setNotifications(prev =>
            prev.map(n => changed.includes(n.id) ? { ...n, read: false } : n)
        );
        try {
            const result = await markAllAsReadAction(session.user.id);
            if (!result?.success) {
                console.error("Mark all as read refused:", result?.error);
                revert();
            }
        } catch (error) {
            console.error("Mark all as read error:", error);
            revert();
        }
    }

    // When the panel opens, auto-mark all currently-visible unread notifications as read
    useEffect(() => {
        if (!isOpen || !session?.user?.id) return;

        const unreadVisible = visibleNotifications.filter(n => !n.read);
        if (unreadVisible.length === 0) return;

        // Filter out IDs already in-flight to avoid duplicate writes
        const toMark = unreadVisible.filter(n => !pendingReadRef.current.has(n.id));
        if (toMark.length === 0) return;

        // Optimistic update
        const ids = toMark.map(n => n.id);
        ids.forEach(id => pendingReadRef.current.add(id));
        setNotifications(prev =>
            prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n)
        );

        /**
         * #406, third call site. This was Promise.all(...).then(...) with the
         * results thrown away, so opening the panel marked everything read
         * locally whether or not a single write landed — and `Promise.all`
         * rejects on the FIRST throw, leaving the rest unaccounted for either
         * way. allSettled reports on every id, and each one that was refused or
         * threw goes back to unread.
         */
        Promise.allSettled(ids.map(id => markNotificationAsReadAction(id))).then(results => {
            const failed = ids.filter((_, i) => {
                const r = results[i];
                return r.status === "rejected" || !r.value?.success;
            });
            if (failed.length > 0) {
                setNotifications(prev =>
                    prev.map(n => failed.includes(n.id) ? { ...n, read: false } : n)
                );
            }
            ids.forEach(id => pendingReadRef.current.delete(id));
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

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
                        <Menu.Items className="absolute left-0 mt-2 w-96 max-w-[calc(100vw-2rem)] origin-top-left rounded-2xl bg-white shadow-xl ring-1 ring-black/5 focus:outline-none z-50">
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
                                ) : visibleNotifications.length === 0 ? (
                                    <div className="px-6 py-8 text-center">
                                        <Bell className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                                        <p className="text-sm text-slate-500">
                                            No notifications yet
                                        </p>
                                    </div>
                                ) : (
                                    visibleNotifications.map((notification) => (
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
                                                                <p className="font-semibold text-sm text-slate-900 break-words">
                                                                    {notification.title}
                                                                </p>
                                                                {!notification.read && (
                                                                    <div className="w-2 h-2 bg-blue-600 rounded-full shrink-0 mt-1" />
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-slate-600 mb-2 break-words">
                                                                {notification.message}
                                                            </p>
                                                            <p className="text-xs text-slate-500">
                                                                {formatDistanceToNow(
                                                                    toDate(notification.createdAt),
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
                            {visibleNotifications.length > 0 && (
                                <div className="px-6 py-3 border-t border-slate-200">
                                    <a
                                        href="/dashboard/notifications"
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
