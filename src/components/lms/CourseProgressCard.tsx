"use client";

import { useEffect, useState } from "react";
import { Award, BookOpen, CheckCircle, Clock } from "lucide-react";
import { getCourseProgress, generateCourseCertificate } from "@/app/actions/course-actions";

interface CourseProgressCardProps {
    courseId: string;
    courseTitle: string;
    totalLessons?: number;
}

export default function CourseProgressCard({ courseId, courseTitle, totalLessons = 10 }: CourseProgressCardProps) {
    const [progress, setProgress] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [generatingCert, setGeneratingCert] = useState(false);

    useEffect(() => {
        const fetchProgress = async () => {
            setLoading(true);
            const result = await getCourseProgress(courseId);
            if (result.success && result.progress) {
                setProgress(result.progress);

                // Auto-generate certificate if completed and not already generated
                if (result.progress.completed && result.progress.progressPercent >= 100) {
                    handleGenerateCertificate();
                }
            }
            setLoading(false);
        };

        fetchProgress();
    }, [courseId]);

    const handleGenerateCertificate = async () => {
        setGeneratingCert(true);
        await generateCourseCertificate(courseId, courseTitle);
        setGeneratingCert(false);
    };

    if (loading) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                <div className="animate-pulse">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                </div>
            </div>
        );
    }

    const progressPercent = progress?.progressPercent || 0;
    const isCompleted = progress?.completed || false;
    const completedLessons = Math.floor((progressPercent / 100) * totalLessons);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white">Your Progress</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {completedLessons} of {totalLessons} lessons
                        </p>
                    </div>
                </div>

                {isCompleted && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full">
                        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                            Completed
                        </span>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Progress
                    </span>
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {progressPercent.toFixed(0)}%
                    </span>
                </div>
                <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-linear-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Last Watched</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {progress?.lastWatchedSecond
                                ? `${Math.floor(progress.lastWatchedSecond / 60)}m ${progress.lastWatchedSecond % 60}s`
                                : "0m 0s"}
                        </p>
                    </div>
                </div>

                {isCompleted && (
                    <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-yellow-500" />
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Certificate</p>
                            <button
                                onClick={handleGenerateCertificate}
                                disabled={generatingCert}
                                className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                            >
                                {generatingCert ? "Generating..." : "View"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Completion Message */}
            {isCompleted && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                        🎉 Congratulations! You've completed this course.
                    </p>
                </div>
            )}
        </div>
    );
}
