"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    Heart,
    BookOpen,
    Calendar,
    TrendingUp,
    Award,
    Download,
    Users,
    Loader2,
    ArrowRight,
    Sparkles,
    ChevronLeft,
} from "lucide-react";
import { checkWaveMembershipAction, getWaveMemberStatsAction } from "@/app/actions/wave";
import { getWaveResourcesAction, getWaveTrainingEventsAction } from "@/app/actions/wave";
import { useMembershipStatus } from "@/hooks/useMembershipStatus";
import { useSession } from "next-auth/react";
import type { WaveResource, WaveTrainingEvent } from "@/app/actions/wave";
import { toSafeDate } from "@/lib/utils";

export default function WaveDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        resourcesAccessed: 0,
        trainingsRegistered: 0,
        trainingsCompleted: 0,
        daysActive: 0,
    });
    const [recentResources, setRecentResources] = useState<WaveResource[]>([]);
    const [upcomingEvents, setUpcomingEvents] = useState<WaveTrainingEvent[]>([]);

    const { data: sessionData } = useSession();
    const userId = (sessionData?.user as any)?.id;
    const { status: membershipStatus } = useMembershipStatus(userId, "wave", sessionData?.user?.email || undefined);

    useEffect(() => {
        // Still waiting for session/Firestore — do nothing yet
        if (membershipStatus === "loading") return;

        if (membershipStatus === "not_found") {
            router.push("/wave");
            return;
        }
        if (membershipStatus === "approved" || membershipStatus === "active") {
            loadDashboard();
            return;
        }
        // Pending / error / unauthenticated — stop the spinner so UI is visible
        setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [membershipStatus]);

    async function loadDashboard() {
        setLoading(true);
        try {
            // Membership check handled by useMembershipStatus hook

            // Load stats
            const statsResult = await getWaveMemberStatsAction();
            if (statsResult.success && statsResult.data?.stats) {
                setStats(statsResult.data.stats);
            }

            // Load recent resources (limit 3)
            const resourcesResult = await getWaveResourcesAction();
            if (resourcesResult.success && resourcesResult.data) {
                setRecentResources(resourcesResult.data.slice(0, 3));
            }

            // Load upcoming events (limit 3)
            const eventsResult = await getWaveTrainingEventsAction();
            if (eventsResult.success && eventsResult.data) {
                setUpcomingEvents(eventsResult.data.slice(0, 3));
            }
        } catch (error) {
            logger.error("Dashboard load error:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-emerald-700" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Back to Hub Link */}
                <div className="mb-4">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800 transition"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back to Hub
                    </Link>
                </div>

                {/* Hero Welcome Section */}
                <div className="bg-linear-to-r from-emerald-700 to-emerald-700 rounded-3xl p-8 mb-8 text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10 pointer-events-none" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                                <Heart className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold">Welcome to WAVE</h1>
                                <p className="text-emerald-100">Women Agripreneurs Value-creation Empowerment</p>
                            </div>
                        </div>
                        <p className="text-lg text-emerald-50 mb-6">
                            Your journey to agricultural excellence continues here. Access resources, join training, and grow your business.
                        </p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => router.push("/wave/resources")}
                                className="px-6 py-3 bg-white text-emerald-700 font-semibold rounded-xl hover:bg-emerald-50 transition flex items-center gap-2"
                            >
                                <BookOpen className="w-5 h-5" />
                                Browse Resources
                            </button>
                            <button
                                onClick={() => router.push("/wave/training")}
                                className="px-6 py-3 bg-white/20 backdrop-blur-sm text-white font-semibold rounded-xl hover:bg-white/30 transition flex items-center gap-2 border border-white/30"
                            >
                                <Calendar className="w-5 h-5" />
                                View Training
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <BookOpen className="w-6 h-6 text-blue-600" />
                            </div>
                            <TrendingUp className="w-5 h-5 text-green-500" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {stats.resourcesAccessed}
                        </p>
                        <p className="text-sm text-gray-600">Resources Accessed</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <Calendar className="w-6 h-6 text-emerald-700" />
                            </div>
                            <Sparkles className="w-5 h-5 text-emerald-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {stats.trainingsRegistered}
                        </p>
                        <p className="text-sm text-gray-600">Trainings Registered</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <Award className="w-6 h-6 text-emerald-700" />
                            </div>
                            <TrendingUp className="w-5 h-5 text-green-500" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {stats.trainingsCompleted}
                        </p>
                        <p className="text-sm text-gray-600">Trainings Completed</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <Heart className="w-6 h-6 text-emerald-700" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {stats.daysActive}
                        </p>
                        <p className="text-sm text-gray-600">Days Active</p>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Recent Resources */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-emerald-700" />
                                Recent Resources
                            </h2>
                            <button
                                onClick={() => router.push("/wave/resources")}
                                className="text-sm text-emerald-700 hover:text-emerald-700 font-semibold flex items-center gap-1"
                            >
                                View All
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>

                        {recentResources.length > 0 ? (
                            <div className="space-y-4">
                                {recentResources.map((resource) => (
                                    <div
                                        key={resource.id}
                                        className="p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition cursor-pointer"
                                        onClick={() => router.push(`/wave/resources`)}
                                    >
                                        <h3 className="font-semibold text-gray-900 mb-1">
                                            {resource.title}
                                        </h3>
                                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                                            {resource.description}
                                        </p>
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">
                                                {resource.category}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Download className="w-3 h-3" />
                                                {resource.downloads} downloads
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 py-8">
                                No resources available yet
                            </p>
                        )}
                    </div>

                    {/* Upcoming Events */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-emerald-700" />
                                Upcoming Training
                            </h2>
                            <button
                                onClick={() => router.push("/wave/training")}
                                className="text-sm text-emerald-700 hover:text-emerald-700 font-semibold flex items-center gap-1"
                            >
                                View All
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>

                        {upcomingEvents.length > 0 ? (
                            <div className="space-y-4">
                                {upcomingEvents.map((event) => (
                                    <div
                                        key={event.id}
                                        className="p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition cursor-pointer"
                                        onClick={() => router.push(`/wave/training`)}
                                    >
                                        <h3 className="font-semibold text-gray-900 mb-1">
                                            {event.title}
                                        </h3>
                                        <p className="text-sm text-gray-600 mb-2">
                                            {event.description}
                                        </p>
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {toSafeDate(event.date).toLocaleDateString()}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />
                                                {event.currentParticipants}/{event.maxParticipants}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 py-8">
                                No upcoming training events
                            </p>
                        )}
                    </div>
                </div>

                {/* Second Grid Row: Announcements & Funding Ledger */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
                    {/* Announcements & Mandates */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 flex flex-col">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-6">
                            <Sparkles className="w-5 h-5 text-emerald-700 animate-pulse" />
                            Program Announcements & Mandates
                        </h2>
                        <div className="space-y-4 flex-1">
                            {[
                                {
                                    tag: "Presidential Mandate",
                                    tagColor: "bg-purple-100 text-purple-700",
                                    title: "Federal Agripreneur Initiative Alignment",
                                    desc: "Presidential mandate to support 100,000 female agripreneurs in value-chain export expansion by 2027.",
                                    date: "June 15, 2026"
                                },
                                {
                                    tag: "Local Update",
                                    tagColor: "bg-blue-100 text-blue-700",
                                    title: "Bauchi & Kano Fertilizer Distribution",
                                    desc: "Seed inputs and organic fertilizer batches are now arriving at regional hubs for WAVE member collection.",
                                    date: "June 12, 2026"
                                },
                                {
                                    tag: "Export Milestone",
                                    tagColor: "bg-green-100 text-green-700",
                                    title: "First Organic Sesame Shipment Booked",
                                    desc: "WAVE cooperative members successfully booked a consolidated export container heading to the Port of Rotterdam.",
                                    date: "June 08, 2026"
                                }
                            ].map((ann, idx) => (
                                <div key={idx} className="p-4 bg-slate-50 hover:bg-slate-100 rounded-xl transition border border-slate-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${ann.tagColor}`}>
                                            {ann.tag}
                                        </span>
                                        <span className="text-xs text-gray-400">{ann.date}</span>
                                    </div>
                                    <h3 className="font-semibold text-gray-900 text-sm mb-1">{ann.title}</h3>
                                    <p className="text-xs text-gray-600 leading-relaxed">{ann.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* NGO & Sponsor Funding Ledger */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 flex flex-col">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-6">
                            <TrendingUp className="w-5 h-5 text-emerald-700" />
                            NGO & Sponsor Funding Ledger
                        </h2>
                        
                        <div className="space-y-5 flex-1">
                            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-semibold text-emerald-800">Total Program Funding Distributed</span>
                                    <span className="text-sm font-bold text-emerald-700">₦80,500,000</span>
                                </div>
                                <div className="w-full bg-emerald-200/40 rounded-full h-2">
                                    <div className="bg-emerald-600 h-2 rounded-full" style={{ width: '80%' }}></div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Regional Funding Dispersion</p>
                                {[
                                    { state: "Kano", amount: 24200000, sponsor: "Bill & Melinda Gates Foundation", pct: 90, barColor: "bg-emerald-600" },
                                    { state: "Bauchi", amount: 18500000, sponsor: "UN Women / AgDevCo", pct: 75, barColor: "bg-emerald-500" },
                                    { state: "Gombe", amount: 15400000, sponsor: "African Development Bank", pct: 60, barColor: "bg-teal-600" },
                                    { state: "Jigawa", amount: 12800000, sponsor: "USAID Agri-Connect", pct: 50, barColor: "bg-teal-500" },
                                    { state: "Katsina", amount: 9600000, sponsor: "Federal Ministry of Agriculture", pct: 40, barColor: "bg-sky-500" }
                                ].map((item, idx) => (
                                    <div key={idx} className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                            <div>
                                                <span className="font-bold text-gray-800">{item.state}</span>
                                                <span className="text-gray-400 mx-2">|</span>
                                                <span className="text-gray-500 text-[10px]">{item.sponsor}</span>
                                            </div>
                                            <span className="font-semibold text-gray-700">₦{item.amount.toLocaleString()}</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                                            <div className={`${item.barColor} h-1.5 rounded-full`} style={{ width: `${item.pct}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="mt-8 bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button
                            onClick={() => router.push("/wave/profile")}
                            className="p-4 bg-linear-to-br from-emerald-50 to-emerald-50 rounded-xl hover:shadow-md transition text-left"
                        >
                            <Heart className="w-8 h-8 text-emerald-700 mb-2" />
                            <h3 className="font-semibold text-gray-900">My Profile</h3>
                            <p className="text-sm text-gray-600">
                                View and update your information
                            </p>
                        </button>

                        <button
                            onClick={() => router.push("/wave/resources")}
                            className="p-4 bg-linear-to-br from-blue-50 to-emerald-50 rounded-xl hover:shadow-md transition text-left"
                        >
                            <BookOpen className="w-8 h-8 text-blue-600 mb-2" />
                            <h3 className="font-semibold text-gray-900">Learning Resources</h3>
                            <p className="text-sm text-gray-600">
                                Access guides, templates & videos
                            </p>
                        </button>

                        <button
                            onClick={() => router.push("/wave/training")}
                            className="p-4 bg-linear-to-br from-emerald-50 to-emerald-50 rounded-xl hover:shadow-md transition text-left"
                        >
                            <Calendar className="w-8 h-8 text-emerald-700 mb-2" />
                            <h3 className="font-semibold text-gray-900">Training Events</h3>
                            <p className="text-sm text-gray-600">
                                Register for workshops & webinars
                            </p>
                        </button>
                    </div>
                </div>

                {/* Agribusiness, Trade & Export Gateways */}
                <div className="mt-8 bg-emerald-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5 pointer-events-none" />
                    <div className="relative z-10">
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            <Sparkles className="w-6 h-6 text-emerald-300 animate-pulse" />
                            Agribusiness, Trade & Export Gateways
                        </h2>
                        <p className="text-emerald-100 text-sm mb-6">
                            Gain direct visibility, list assets, and access international markets using our integrated trade modules.
                        </p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition flex flex-col justify-between">
                                <div>
                                    <span className="text-[10px] px-2.5 py-1 bg-emerald-500/30 text-emerald-200 rounded-full font-bold uppercase tracking-wider">Marketplace</span>
                                    <h3 className="text-lg font-bold mt-3 mb-1">Trade Products</h3>
                                    <p className="text-xs text-emerald-200/90 leading-relaxed mb-4">
                                        Directly sell your harvests, processed foodstuffs, and agricultural products to local and international buyers.
                                    </p>
                                </div>
                                <button
                                    onClick={() => router.push("/marketplace")}
                                    className="w-full py-2.5 bg-white text-emerald-900 font-semibold rounded-xl text-xs hover:bg-emerald-50 transition flex items-center justify-center gap-1.5"
                                >
                                    Open Marketplace
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition flex flex-col justify-between">
                                <div>
                                    <span className="text-[10px] px-2.5 py-1 bg-emerald-500/30 text-emerald-200 rounded-full font-bold uppercase tracking-wider">Export Window</span>
                                    <h3 className="text-lg font-bold mt-3 mb-1">Export Window</h3>
                                    <p className="text-xs text-emerald-200/90 leading-relaxed mb-4">
                                        Access international shipping windows, cargo consolidation, and global supply chains for your agro commodities.
                                    </p>
                                </div>
                                <button
                                    onClick={() => router.push("/export")}
                                    className="w-full py-2.5 bg-white text-emerald-900 font-semibold rounded-xl text-xs hover:bg-emerald-50 transition flex items-center justify-center gap-1.5"
                                >
                                    Access Export Portal
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 hover:bg-white/15 transition flex flex-col justify-between">
                                <div>
                                    <span className="text-[10px] px-2.5 py-1 bg-emerald-500/30 text-emerald-200 rounded-full font-bold uppercase tracking-wider">Farm Nation</span>
                                    <h3 className="text-lg font-bold mt-3 mb-1">Farmland & Cultivation</h3>
                                    <p className="text-xs text-emerald-200/90 leading-relaxed mb-4">
                                        Lease, rent, or purchase verified agricultural land plots and list your land listings for collaborative farming.
                                    </p>
                                </div>
                                <button
                                    onClick={() => router.push("/farm-nation")}
                                    className="w-full py-2.5 bg-white text-emerald-900 font-semibold rounded-xl text-xs hover:bg-emerald-50 transition flex items-center justify-center gap-1.5"
                                >
                                    Explore Farm Nation
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
