"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { TrendingUp, Award, Clock, Target, CheckCircle, BookOpen, Trophy, Loader2 } from "lucide-react";
import { getUserAggregateProgressAction } from "@/app/actions/academy";
import BackButton from "@/components/ui/BackButton";

export default function ProgressPage() {
    const { data: session } = useSession();
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [progressData, setProgressData] = useState({
        totalCourses: 0,
        completedCourses: 0,
        inProgressCourses: 0,
        totalHoursLearned: 0,
        certificatesEarned: 0,
        currentStreak: 0, // Streak tracking requires activity log collection - can be added post-launch
        totalLessons: 0,
        completedLessons: 0,
        overallProgress: 0,
    });

    useEffect(() => {
        if (session?.user?.id) {
            setUserId(session.user.id);
        }
    }, [session]);

    useEffect(() => {
        async function loadProgress() {
            if (!userId) return;

            setLoading(true);
            try {
                const data = await getUserAggregateProgressAction(userId);
                setProgressData({
                    ...data,
                    currentStreak: 0, // Placeholder for streak implementation
                });
            } catch (error) {
                console.error("Failed to load progress:", error);
            } finally {
                setLoading(false);
            }
        }

        loadProgress();
    }, [userId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <BackButton fallbackPath="/academy/dashboard" />
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Learning Progress
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Track your achievements and learning milestones
                </p>
            </div>

            {/* Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-3">
                            <BookOpen className="w-6 h-6 text-blue-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {progressData.totalCourses}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Total Courses</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-3">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {progressData.completedCourses}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Completed</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center mb-3">
                            <Award className="w-6 h-6 text-yellow-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {progressData.certificatesEarned}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Certificates</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mb-3">
                            <Clock className="w-6 h-6 text-orange-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {Math.round(progressData.totalHoursLearned)}h
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Learning Time</p>
                    </div>
                </div>
            </div>

            {/* Overall Progress */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Overall Progress</h2>
                    <span className="text-2xl font-bold text-blue-600">{progressData.overallProgress}%</span>
                </div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                    <div
                        className="h-2 bg-linear-to-r from-primary to-blue-500 rounded-full transition-all"
                        style={{ width: `${progressData.overallProgress}%` }}
                    />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    {progressData.completedLessons} of {progressData.totalLessons} lessons completed
                </p>
            </div>

            {/* Empty State or Stats */}
            {progressData.totalCourses === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-xl p-12 border border-slate-200 dark:border-slate-700 text-center">
                    <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
                        <BookOpen className="w-10 h-10 text-slate-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        No Courses Enrolled
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                        Start your learning journey by enrolling in courses from our Academy catalog
                    </p>
                    <a
                        href="/academy"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                    >
                        <BookOpen className="w-5 h-5" />
                        Browse Courses
                    </a>
                </div>
            ) : (
                <>
                    {/* Course Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                    <TrendingUp className="w-5 h-5 text-blue-600" />
                                </div>
                                <h3 className="font-bold text-slate-900 dark:text-white">In Progress</h3>
                            </div>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                                {progressData.inProgressCourses}
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Courses currently learning
                            </p>
                        </div>

                        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                                    <Trophy className="w-5 h-5 text-green-600" />
                                </div>
                                <h3 className="font-bold text-slate-900 dark:text-white">Completion Rate</h3>
                            </div>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                                {progressData.totalCourses > 0
                                    ? Math.round((progressData.completedCourses / progressData.totalCourses) * 100)
                                    : 0}%
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                {progressData.completedCourses} of {progressData.totalCourses} completed
                            </p>
                        </div>
                    </div>

                    {/* Info Card */}
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
                        <div className="flex gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                <Target className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
                                    Keep Learning!
                                </h4>
                                <p className="text-sm text-slate-900 dark:text-white">
                                    You&apos;re making great progress! Complete lessons to unlock certificates and advance your career in agribusiness.
                                </p>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
