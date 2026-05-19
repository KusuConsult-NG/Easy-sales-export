"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
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
    const { status: membershipStatus } = useMembershipStatus(userId, "wave");

    useEffect(() => {
        if (membershipStatus === "not_found") {
            router.push("/wave");
            return;
        }
        if (membershipStatus === "approved" || membershipStatus === "active") {
            loadDashboard();
        }
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
            </div>
        </div>
    );
}
