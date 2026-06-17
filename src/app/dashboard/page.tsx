"use client";

import { useEffect, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
    Wallet, Package, MessageCircle, Bell, Award, IdCard,
    AlertTriangle, Star, Sparkles, ChevronRight, Loader2,
    TrendingUp, Users, BookOpen, Landmark, ExternalLink, Settings,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, doc, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useFirebaseAuthed } from "@/hooks/useFirebaseAuthed";
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

/** Returns all platform modules with their dynamic application status */
function getPlatformModules(serviceRegistrations: Record<string, any>, roles: UserRole[], gender?: string, createdAt?: string) {
    const isMale = gender?.toLowerCase() === "male";
    
    // Define cutoff date: June 17, 2026
    const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
    const registeredOnOrAfterCutoff = !!createdAt && new Date(createdAt) >= CUTOFF_DATE;
    const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

    const waveRegStatus = serviceRegistrations?.wave?.status;
    const hasWaveAccess = roles.includes("wave_participant") || 
                          waveRegStatus === "approved" || 
                          waveRegStatus === "active" || 
                          waveRegStatus === "pending" || 
                          waveRegStatus === "under_review" ||
                          waveRegStatus === "revision_required";

    const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccess);

    const modulesDef = [
        {
            id: "academy",
            label: "Academy",
            description: "Agricultural education and training",
            icon: BookOpen,
            color: "from-blue-600 to-indigo-700",
            onboardingUrl: "/academy/setup",
            dashboardUrl: "/academy/dashboard",
            pendingUrl: "/academy/setup",
        },
        {
            id: "wave",
            label: "WAVE Program",
            description: "Women Agro-processors Venture Empowerment",
            icon: Sparkles,
            color: "from-purple-600 to-violet-700",
            onboardingUrl: "/wave/application",
            dashboardUrl: "/wave/dashboard",
            pendingUrl: "/wave/application/review-pending",
        },
        {
            id: "export",
            label: "Export Windows",
            description: "Agricultural Export Crowdfunding",
            icon: Landmark,
            color: "from-cyan-600 to-sky-700",
            onboardingUrl: "/export/onboarding",
            dashboardUrl: "/export/dashboard",
            pendingUrl: "/export/onboarding/pending",
        },
        {
            id: "marketplace",
            label: "Marketplace",
            description: "Buy and sell agricultural products",
            icon: Package,
            color: "from-orange-500 to-amber-600",
            onboardingUrl: "/marketplace/onboarding",
            dashboardUrl: roles.includes("seller") ? "/marketplace/seller/dashboard" : "/marketplace/buyer/dashboard",
            pendingUrl: "/marketplace/onboarding/pending",
        },
        {
            id: "cooperatives",
            label: "Cooperatives",
            description: "Farmer cooperative savings and loans",
            icon: Users,
            color: "from-teal-600 to-emerald-700",
            onboardingUrl: "/cooperatives/onboarding",
            dashboardUrl: "/cooperatives/dashboard",
            pendingUrl: "/cooperatives/onboarding/pending",
        },
        {
            id: "farmNation",
            label: "Farm Nation",
            description: "Farm properties, investments & land",
            icon: ExternalLink,
            color: "from-lime-600 to-green-700",
            onboardingUrl: "/farm-nation/onboarding",
            dashboardUrl: "/farm-nation/dashboard",
            pendingUrl: "/farm-nation/onboarding/pending",
        }
    ].filter(mod => !(mod.id === "wave" && isWaveBlocked));

    return modulesDef.map(mod => {
        const registrationStatus = serviceRegistrations[mod.id]?.status 
            || (mod.id === 'farmNation' ? serviceRegistrations['farm_nation']?.status : null)
            || (mod.id === 'cooperatives' ? serviceRegistrations['cooperative']?.status : null);
        const paymentStatus = serviceRegistrations[mod.id]?.paymentStatus 
            || (mod.id === 'farmNation' ? serviceRegistrations['farm_nation']?.paymentStatus : null)
            || (mod.id === 'cooperatives' ? serviceRegistrations['cooperative']?.paymentStatus : null);
            
        let status: 'unapplied' | 'pending' | 'approved' | 'payment_required' = 'unapplied';
        if (registrationStatus === 'approved' || registrationStatus === 'active' || registrationStatus === 'verified') {
            const requiresPayment = mod.id === 'academy' || mod.id === 'cooperatives';
            status = (!requiresPayment || paymentStatus === 'completed' || registrationStatus === 'active') ? 'approved' : 'payment_required';
        }
        else if (registrationStatus === 'pending' || registrationStatus === 'under_review' || registrationStatus === 'pending_review' || registrationStatus === 'paid' || registrationStatus === 'pending_approval' || registrationStatus === 'legacy_pending_onboarding') {
            status = 'pending';
        }

        // WAVE and Farm Nation do not require payment — treat any approved/active/verified registration as fully approved
        if ((mod.id === 'wave' || mod.id === 'farmNation') && status === 'payment_required') status = 'approved';

        // Override approved based on roles for safety (in case admin bypassed standard flow)
        if (mod.id === 'academy' && roles.includes('academy_participant')) status = 'approved';
        if (mod.id === 'wave' && roles.includes('wave_participant')) status = 'approved';
        if (mod.id === 'export' && roles.includes('export_participant')) status = 'approved';
        if (mod.id === 'marketplace' && (roles.includes('seller') || roles.includes('buyer'))) status = 'approved';
        if (mod.id === 'cooperatives' && roles.includes('cooperative_member')) status = 'approved';
        if (mod.id === 'farmNation' && (roles.includes('farmer') || roles.includes('land_owner') || roles.includes('investor'))) status = 'approved';
        
        const href = 
            status === 'approved' ? mod.dashboardUrl : 
            status === 'payment_required' ? mod.onboardingUrl :
            status === 'pending' ? mod.pendingUrl : 
            mod.onboardingUrl;
            
        return {
            ...mod,
            status,
            href
        };
    });
}

function DashboardHomeContent() {
    const { data: session, status } = useSession();
    const userId = session?.user?.id;
    const roles = (session?.user?.roles as UserRole[]) || [];
    const userName = session?.user?.name?.split(" ")[0] || "there";
    const isAuthed = useFirebaseAuthed(userId);

    const [stats, setStats] = useState<StatsState>({
        walletBalance: 0, activeOrders: 0,
        unreadNotifications: 0, unreadMessages: 0,
        loading: true,
    });
    const [serviceRegistrations, setServiceRegistrations] = useState<Record<string, any>>({});
    const [recentNotifications, setRecentNotifications] = useState<RecentNotification[]>([]);

    // Real-time user profile (for serviceRegistrations)
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const unsub = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
                setServiceRegistrations(snap.data()?.serviceRegistrations || {});
            }
        }, (error) => {
            console.error("Dashboard userRef listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // Real-time unread notifications
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            where("read", "==", false)
        );
        const unsub = onSnapshot(q, (snap) => {
            setStats(s => ({ ...s, unreadNotifications: snap.size }));
        }, (error) => {
            console.error("Dashboard unread notifications listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // Real-time unread messages
    useEffect(() => {
        if (!userId || !isAuthed) return;
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
        }, (error) => {
            console.error("Dashboard unread messages listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // Wallet balance — keyed by userId (walletId === userId)
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const walletRef = doc(db, COLLECTIONS.WALLETS, userId);
        const unsub = onSnapshot(walletRef, (snap) => {
            if (snap.exists()) {
                setStats(s => ({ ...s, walletBalance: snap.data()?.balance || 0 }));
            }
        }, (error) => {
            console.error("Dashboard walletRef listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // Recent notifications (last 4)
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(4)
        );
        const unsub = onSnapshot(q, (snap) => {
            setRecentNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecentNotification)));
        }, (error) => {
            console.error("Dashboard recent notifications listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // Active orders count — real-time onSnapshot (avoids getDocs stale count and composite index crash).
    // ⚠️ Firestore requires a composite index for (buyerId + orderStatus IN [...]) which may not exist.
    // Safe alternative: listen on buyerId only, then filter client-side (resultset is small per-user).
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const q = query(
            collection(db, COLLECTIONS.MARKETPLACE_ORDERS),
            where("buyerId", "==", userId)
        );
        const ACTIVE_STATUSES = new Set(["pending", "confirmed", "processing", "shipped"]);
        const unsub = onSnapshot(q, (snap) => {
            const activeCount = snap.docs.filter(d => ACTIVE_STATUSES.has(d.data().orderStatus)).length;
            setStats(s => ({ ...s, activeOrders: activeCount, loading: false }));
        }, (error) => {
            console.error("Dashboard active orders listener failed:", error);
            // On error (e.g. missing index) silently set loading done, count stays 0
            setStats(s => ({ ...s, loading: false }));
        });
        return () => unsub();
    }, [userId, isAuthed]);


    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            </div>
        );
    }

    const platformModules = getPlatformModules(serviceRegistrations, roles, session?.user?.gender, session?.user?.createdAt);

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

                {/* ── Platform Modules ──────────────────────────────────── */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900">Platform Modules</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {platformModules.map((card) => (
                            <Link
                                key={card.href}
                                href={card.href}
                                className={`group relative overflow-hidden rounded-2xl bg-white border p-6 hover:shadow-lg transition-all hover:-translate-y-0.5 ${
                                    card.status === 'approved' ? 'border-slate-200' : 'border-slate-200 opacity-90'
                                }`}
                            >
                                <div className={`absolute top-0 right-0 w-32 h-32 bg-linear-to-br ${card.color} opacity-5 rounded-full translate-x-8 -translate-y-8 group-hover:opacity-10 transition-opacity`} />
                                
                                <div className="flex justify-between items-start mb-4">
                                    <div className={`w-12 h-12 rounded-xl bg-linear-to-br ${card.color} flex items-center justify-center shadow ${card.status !== 'approved' ? 'grayscale opacity-75' : ''}`}>
                                        <card.icon className="w-6 h-6 text-white" />
                                    </div>
                                    
                                    {/* Status Badge */}
                                    {card.status === 'approved' && (
                                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 rounded-lg">Active</span>
                                    )}
                                    {card.status === 'pending' && (
                                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 rounded-lg">Pending Review</span>
                                    )}
                                    {card.status === 'payment_required' && (
                                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 rounded-lg italic animate-pulse">Payment Required</span>
                                    )}
                                </div>
                                
                                <h3 className={`font-bold text-slate-900 mb-1 ${card.status !== 'approved' ? 'text-slate-700' : ''}`}>{card.label}</h3>
                                <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
                                
                                <div className={`mt-4 flex items-center text-sm font-semibold gap-1 group-hover:gap-2 transition-all ${
                                    card.status === 'approved' ? 'text-emerald-600' :
                                    card.status === 'payment_required' ? 'text-rose-600' :
                                    card.status === 'pending' ? 'text-amber-600' :
                                    'text-blue-600'
                                }`}>
                                    {card.status === 'approved' ? 'Go to Dashboard' :
                                     card.status === 'payment_required' ? 'Complete Payment' :
                                     card.status === 'pending' ? 'Check Status' :
                                     'Apply Now'} <ChevronRight className="w-4 h-4" />
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ── Quick Links ─────────────────────────────────── */}
                <section>
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Quick Access</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {[
                            { label: "Wallet", href: "/dashboard/wallet", icon: Wallet },
                            { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
                            { label: "Settings", href: "/profile", icon: Settings },
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
