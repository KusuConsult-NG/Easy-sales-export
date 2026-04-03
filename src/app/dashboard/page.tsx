"use client";

import { useEffect, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
    Wallet, Package, MessageCircle, Bell, Award, IdCard,
    AlertTriangle, Star, Sparkles, ChevronRight, Loader2,
    TrendingUp, Users, BookOpen, Landmark, ExternalLink,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, doc, query, where, onSnapshot, orderBy, limit, getDocs } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserRole } from "@/lib/types/roles";

const fmt = (n: number = 0) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n || 0);

interface StatsState {
    walletBalance: number;
    activeOrders: number;
    unreadNotifications: number;
    unreadMessages: number;
    loading: boolean;
}

interface RecentNotification {
    id: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    createdAt: any;
}

/** Returns module cards for user's approved roles */
function getModuleCards(roles: UserRole[]) {
    const cards: { label: string; description: string; href: string; icon: React.ElementType; color: string }[] = [];

    if (roles.includes("wave_participant")) {
        cards.push({
            label: "WAVE Program",
            description: "Access your WAVE dashboard, resources & earnings",
            href: "/wave/dashboard",
            icon: Sparkles,
            color: "from-purple-600 to-violet-700",
        });
    }
    if (roles.includes("academy_participant")) {
        cards.push({
            label: "Academy",
            description: "Continue your courses and view certificates",
            href: "/academy/dashboard",
            icon: BookOpen,
            color: "from-blue-600 to-indigo-700",
        });
    }
    if (roles.includes("buyer") || roles.includes("seller")) {
        cards.push({
            label: "Marketplace",
            description: roles.includes("seller") ? "Manage your store & products" : "Browse & buy products",
            href: roles.includes("seller") ? "/marketplace/seller/dashboard" : "/marketplace/buyer/dashboard",
            icon: Package,
            color: "from-orange-500 to-amber-600",
        });
    }
    if (roles.includes("cooperative_member")) {
        cards.push({
            label: "Cooperative",
            description: "Savings, loans & cooperative management",
            href: "/cooperatives/dashboard",
            icon: Users,
            color: "from-teal-600 to-emerald-700",
        });
    }
    if (roles.includes("export_participant")) {
        cards.push({
            label: "Export Hub",
            description: "Manage your export investments & portfolio",
            href: "/export/dashboard",
            icon: Landmark,
            color: "from-cyan-600 to-sky-700",
        });
    }
    if (roles.includes("farmer") || roles.includes("land_owner") || roles.includes("investor")) {
        cards.push({
            label: "Farm Nation",
            description: "Farm properties, investments & land",
            href: "/farm-nation/dashboard",
            icon: ExternalLink,
            color: "from-lime-600 to-green-700",
        });
    }

    return cards;
}

function DashboardHomeContent() {
    const { data: session, status } = useSession();
    const userId = session?.user?.id;
    const roles = (session?.user?.roles as UserRole[]) || [];
    const userName = session?.user?.name?.split(" ")[0] || "there";

    const [stats, setStats] = useState<StatsState>({
        walletBalance: 0, activeOrders: 0,
        unreadNotifications: 0, unreadMessages: 0,
        loading: true,
    });
    const [recentNotifications, setRecentNotifications] = useState<RecentNotification[]>([]);

    // Real-time unread notifications
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            where("read", "==", false)
        );
        const unsub = onSnapshot(q, (snap) => {
            setStats(s => ({ ...s, unreadNotifications: snap.size }));
        });
        return () => unsub();
    }, [userId]);

    // Real-time unread messages
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId)
        );
        const unsub = onSnapshot(q, (snap) => {
            let count = 0;
            snap.docs.forEach((doc) => {
                const data = doc.data();
                const lastRead = data.participantDetails?.[userId]?.lastRead;
                const lastMsg = data.lastMessage?.timestamp;
                if (lastMsg && (!lastRead || lastMsg.toMillis?.() > lastRead.toMillis?.())) count++;
            });
            setStats(s => ({ ...s, unreadMessages: count, loading: false }));
        });
        return () => unsub();
    }, [userId]);

    // Wallet balance — keyed by userId (walletId === userId)
    useEffect(() => {
        if (!userId) return;
        const walletRef = doc(db, COLLECTIONS.WALLETS, userId);
        const unsub = onSnapshot(walletRef, (snap) => {
            if (snap.exists()) {
                setStats(s => ({ ...s, walletBalance: snap.data()?.balance || 0 }));
            }
        });
        return () => unsub();
    }, [userId]);

    // Recent notifications (last 4)
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(4)
        );
        const unsub = onSnapshot(q, (snap) => {
            setRecentNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecentNotification)));
        });
        return () => unsub();
    }, [userId]);

    // Orders count
    useEffect(() => {
        if (!userId) return;

        async function fetchOrders() {
            try {
                const snap = await getDocs(
                    query(
                        collection(db, COLLECTIONS.ORDERS),
                        where("buyerId", "==", userId),
                        where("status", "in", ["pending_payment", "payment_received", "processing", "shipped"])
                    )
                );
                setStats(s => ({ ...s, activeOrders: snap.size }));
            } catch { /* silently ignore */ }
        }
        fetchOrders();
    }, [userId]);

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            </div>
        );
    }

    const moduleCards = getModuleCards(roles);

    const statCards = [
        { label: "Wallet Balance", value: fmt(stats.walletBalance), icon: Wallet, color: "text-emerald-600 bg-emerald-50", href: "/dashboard/wallet" },
        { label: "Unread Messages", value: stats.unreadMessages.toString(), icon: MessageCircle, color: "text-violet-600 bg-violet-50", href: "/messages" },
        { label: "Notifications", value: stats.unreadNotifications.toString(), icon: Bell, color: "text-orange-600 bg-orange-50", href: "/dashboard/notifications" },
    ];

    function getNotifIcon(type: string) {
        const map: Record<string, string> = {
            payment: "💳", order: "📦", wave: "🌊", cooperative: "🤝",
            academy: "🎓", info: "ℹ️", success: "✅", warning: "⚠️", loan: "🏦",
        };
        return map[type] || "🔔";
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero welcome banner */}
            <div className="bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-10 lg:py-14">
                <div className="max-w-5xl mx-auto">
                    <p className="text-emerald-400 font-semibold text-sm mb-1">Welcome back 👋</p>
                    <h1 className="text-3xl lg:text-4xl font-black text-white mb-2">
                        Hello, {userName}!
                    </h1>
                    <p className="text-slate-400 text-sm">
                        Here&apos;s an overview of your Easy Sales account.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 lg:px-6 py-8 space-y-10">

                {/* ── Stats Grid ─────────────────────────────────── */}
                <section>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {statCards.map(({ label, value, icon: Icon, color, href }) => (
                            <Link
                                key={label}
                                href={href}
                                className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-shadow group"
                            >
                                <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center mb-4`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <p className="text-2xl font-black text-slate-900 leading-tight">{value}</p>
                                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                                    {label}
                                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ── My Modules ──────────────────────────────────── */}
                {moduleCards.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-slate-900">My Modules</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {moduleCards.map((card) => (
                                <Link
                                    key={card.href}
                                    href={card.href}
                                    className="group relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-6 hover:shadow-lg transition-all hover:-translate-y-0.5"
                                >
                                    <div className={`absolute top-0 right-0 w-32 h-32 bg-linear-to-br ${card.color} opacity-5 rounded-full translate-x-8 -translate-y-8 group-hover:opacity-10 transition-opacity`} />
                                    <div className={`w-12 h-12 rounded-xl bg-linear-to-br ${card.color} flex items-center justify-center mb-4 shadow`}>
                                        <card.icon className="w-6 h-6 text-white" />
                                    </div>
                                    <h3 className="font-bold text-slate-900 mb-1">{card.label}</h3>
                                    <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
                                    <div className="mt-4 flex items-center text-sm font-semibold text-emerald-600 gap-1 group-hover:gap-2 transition-all">
                                        Go to {card.label} <ChevronRight className="w-4 h-4" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                {moduleCards.length === 0 && (
                    <section className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
                        <TrendingUp className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-700 mb-2">No Active Modules</h3>
                        <p className="text-slate-500 text-sm max-w-md mx-auto">
                            You haven&apos;t been approved for any modules yet. Once approved by an admin,
                            your modules will appear here.
                        </p>
                    </section>
                )}

                {/* ── Quick Links ─────────────────────────────────── */}
                <section>
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Quick Access</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {[
                            { label: "Wallet", href: "/dashboard/wallet", icon: Wallet },
                            { label: "Messages", href: "/messages", icon: MessageCircle },
                            { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
                        ].map(({ label, href, icon: Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-sm transition-all text-center group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-emerald-50 flex items-center justify-center transition-colors">
                                    <Icon className="w-5 h-5 text-slate-600 group-hover:text-emerald-600 transition-colors" />
                                </div>
                                <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                                    {label}
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ── Recent Notifications ─────────────────────────── */}
                {recentNotifications.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-slate-900">Recent Notifications</h2>
                            <Link
                                href="/dashboard/notifications"
                                className="text-sm text-emerald-600 font-semibold hover:underline flex items-center gap-1"
                            >
                                View all <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>
                        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                            {recentNotifications.map((notif) => (
                                <div
                                    key={notif.id}
                                    className={`flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${!notif.read ? "border-l-2 border-l-emerald-500" : ""}`}
                                >
                                    <span className="text-xl shrink-0 mt-0.5">{getNotifIcon(notif.type)}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-semibold truncate ${!notif.read ? "text-slate-900" : "text-slate-600"}`}>
                                            {notif.title}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate mt-0.5">{notif.message}</p>
                                    </div>
                                    {!notif.read && (
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

export default function DashboardHome() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            </div>
        }>
            <DashboardHomeContent />
        </Suspense>
    );
}
