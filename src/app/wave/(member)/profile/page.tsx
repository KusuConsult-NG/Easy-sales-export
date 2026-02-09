"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    User,
    Briefcase,
    Award,
    Calendar,
    TrendingUp,
    Loader2,
    Heart,
    BookOpen,
    CheckCircle,
} from "lucide-react";
import { checkWaveMembershipAction, getWaveMemberStatsAction } from "@/app/actions/wave-member";

export default function WaveProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [memberData, setMemberData] = useState<any>(null);
    const [stats, setStats] = useState({
        resourcesAccessed: 0,
        trainingsRegistered: 0,
        trainingsCompleted: 0,
        daysActive: 0,
    });

    useEffect(() => {
        loadProfile();
    }, []);

    async function loadProfile() {
        setLoading(true);
        try {
            // Check membership
            const membership = await checkWaveMembershipAction();
            if (!membership.enrolled) {
                router.push("/wave");
                return;
            }

            setMemberData(membership.memberData);

            // Load stats
            const statsResult = await getWaveMemberStatsAction();
            if (statsResult.success && statsResult.stats) {
                setStats(statsResult.stats);
            }
        } catch (error) {
            console.error("Profile load error:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-pink-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-pink-600" />
            </div>
        );
    }

    const enrolledDate = memberData?.enrolledAt
        ? new Date(memberData.enrolledAt.toDate()).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        })
        : "N/A";

    return (
        <div className="min-h-screen bg-linear-to-br from-pink-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900 py-8">
            <div className="max-w-5xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/wave/dashboard")}
                        className="text-pink-600 hover:text-pink-700 font-semibold mb-4 flex items-center gap-2"
                    >
                        ← Back to Dashboard
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        My WAVE Profile
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Your journey in the Women Agripreneurs Value-creation Empowerment program
                    </p>
                </div>

                {/* Profile Card */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 mb-8 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-start gap-6">
                        <div className="w-24 h-24 bg-linear-to-br from-pink-500 to-purple-600 rounded-full flex items-center justify-center text-white text-3xl font-bold">
                            <Heart className="w-12 h-12" />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                WAVE Member
                            </h2>
                            <p className="text-gray-600 dark:text-gray-400 mb-4">
                                Member since {enrolledDate}
                            </p>
                            <div className="flex items-center gap-3">
                                <span className="px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-semibold flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" />
                                    Active Member
                                </span>
                                <span className="px-4 py-2 bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 rounded-full text-sm font-semibold">
                                    {stats.daysActive} Days Active
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Resources</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {stats.resourcesAccessed}
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Learning materials accessed
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Calendar className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Training</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {stats.trainingsRegistered}
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Events registered for
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <Award className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {stats.trainingsCompleted}
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Training sessions completed
                        </p>
                    </div>
                </div>

                {/* Progress Section */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 mb-8 border border-gray-100 dark:border-gray-700">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                        <TrendingUp className="w-6 h-6 text-pink-600" />
                        Your Progress
                    </h3>

                    {/* Engagement Score */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                Engagement Level
                            </span>
                            <span className="text-sm font-semibold text-pink-600">
                                {Math.min(100, Math.round((stats.resourcesAccessed * 10 + stats.trainingsCompleted * 20) / 3))}%
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                            <div
                                className="bg-linear-to-r from-pink-500 to-purple-600 h-3 rounded-full transition-all duration-500"
                                style={{
                                    width: `${Math.min(100, Math.round((stats.resourcesAccessed * 10 + stats.trainingsCompleted * 20) / 3))}%`,
                                }}
                            />
                        </div>
                    </div>

                    {/* Milestones */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            Milestones Achieved
                        </h4>

                        <div className="flex items-center gap-3">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${memberData?.active
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : "bg-gray-100 dark:bg-gray-700"
                                    }`}
                            >
                                <CheckCircle
                                    className={`w-5 h-5 ${memberData?.active
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-gray-400"
                                        }`}
                                />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">Enrollment Complete</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Joined WAVE program</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${stats.resourcesAccessed > 0
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : "bg-gray-100 dark:bg-gray-700"
                                    }`}
                            >
                                <CheckCircle
                                    className={`w-5 h-5 ${stats.resourcesAccessed > 0
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-gray-400"
                                        }`}
                                />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">First Resource Accessed</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Started learning journey</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${stats.trainingsRegistered > 0
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : "bg-gray-100 dark:bg-gray-700"
                                    }`}
                            >
                                <CheckCircle
                                    className={`w-5 h-5 ${stats.trainingsRegistered > 0
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-gray-400"
                                        }`}
                                />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">First Training Registered</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Engaged with live events</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${stats.trainingsCompleted > 0
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : "bg-gray-100 dark:bg-gray-700"
                                    }`}
                            >
                                <CheckCircle
                                    className={`w-5 h-5 ${stats.trainingsCompleted > 0
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-gray-400"
                                        }`}
                                />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">First Training Completed</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Achievement unlocked!</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-linear-to-r from-pink-600 to-purple-600 rounded-2xl p-8 text-white">
                    <h3 className="text-2xl font-bold mb-4">Continue Your Journey</h3>
                    <p className="text-pink-100 mb-6">
                        Keep growing your skills and building your agribusiness with WAVE resources and training.
                    </p>
                    <div className="flex flex-wrap gap-4">
                        <button
                            onClick={() => router.push("/wave/resources")}
                            className="px-6 py-3 bg-white text-pink-600 font-semibold rounded-xl hover:bg-pink-50 transition"
                        >
                            Browse Resources
                        </button>
                        <button
                            onClick={() => router.push("/wave/training")}
                            className="px-6 py-3 bg-white/20 backdrop-blur-sm text-white font-semibold rounded-xl hover:bg-white/30 transition border border-white/30"
                        >
                            View Training Events
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
