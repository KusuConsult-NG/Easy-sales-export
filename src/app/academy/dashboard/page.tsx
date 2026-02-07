"use client";

import { useState, useEffect } from "react";
import { Award, BookOpen, Clock, TrendingUp, Calendar, Download } from "lucide-react";
import Link from "next/link";

type CourseProgress = {
    courseId: string;
    courseTitle: string;
    completionPercentage: number;
    enrolledAt: Date;
    lastAccessedAt: Date;
    completedLessons: string[];
    totalLessons: number;
    quizScore?: number;
    quizPassed?: boolean;
    certificateId?: string;
};

type Certificate = {
    id: string;
    courseTitle: string;
    completionDate: Date;
    grade?: number;
};

export default function AcademyDashboardPage() {
    const [courses, setCourses] = useState<CourseProgress[]>([]);
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState({
        totalCourses: 0,
        inProgress: 0,
        completed: 0,
        certificatesEarned: 0,
        totalHours: 0,
        learningStreak: 0,
    });

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/academy/dashboard");
            const data = await response.json();

            if (data.success) {
                setCourses(data.courses || []);
                setCertificates(data.certificates || []);
                setStats(data.stats || stats);
            }
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const downloadCertificate = async (certificateId: string) => {
        try {
            window.open(`/academy/certificate/${certificateId}`, '_blank');
        } catch (error) {
            console.error("Failed to download certificate:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        My Learning Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your progress and achievements
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <BookOpen className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.totalCourses}</span>
                        </div>
                        <p className="text-blue-100 font-semibold">Total Courses</p>
                    </div>

                    <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <TrendingUp className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.inProgress}</span>
                        </div>
                        <p className="text-yellow-100 font-semibold">In Progress</p>
                    </div>

                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <Award className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.completed}</span>
                        </div>
                        <p className="text-green-100 font-semibold">Completed</p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <Clock className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.learningStreak}</span>
                        </div>
                        <p className="text-purple-100 font-semibold">Day Streak 🔥</p>
                    </div>
                </div>

                {/* My Courses */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        My Courses
                    </h2>

                    {courses.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-slate-400 mb-4">
                                You haven't enrolled in any courses yet
                            </p>
                            <Link
                                href="/academy/courses"
                                className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all"
                            >
                                Browse Courses
                            </Link>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {courses.map((course) => (
                                <Link
                                    key={course.courseId}
                                    href={`/academy/courses/${course.courseId}`}
                                    className="block"
                                >
                                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 hover:shadow-lg transition-all border border-slate-200 dark:border-slate-700">
                                        <div className="flex items-start justify-between mb-4">
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                                {course.courseTitle}
                                            </h3>
                                            {course.certificateId && (
                                                <Award className="w-6 h-6 text-yellow-500" />
                                            )}
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="mb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                                    Progress
                                                </span>
                                                <span className="text-sm font-bold text-primary">
                                                    {course.completionPercentage}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                                <div
                                                    className="bg-primary h-2 rounded-full transition-all"
                                                    style={{ width: `${course.completionPercentage}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Stats */}
                                        <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                                            <div className="flex items-center gap-1">
                                                <BookOpen className="w-4 h-4" />
                                                {course.completedLessons.length}/{course.totalLessons} lessons
                                            </div>
                                            {course.quizPassed !== undefined && (
                                                <div className={`flex items-center gap-1 ${course.quizPassed ? 'text-green-600' : 'text-yellow-600'
                                                    }`}>
                                                    <Award className="w-4 h-4" />
                                                    Quiz: {course.quizScore}%
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>

                {/* Certificates */}
                {certificates.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                            <Award className="w-7 h-7 text-yellow-500" />
                            My Certificates
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {certificates.map((cert) => (
                                <div
                                    key={cert.id}
                                    className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20 rounded-xl p-6 border-2 border-yellow-200 dark:border-yellow-700"
                                >
                                    <div className="flex items-center justify-center mb-4">
                                        <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center">
                                            <Award className="w-10 h-10 text-white" />
                                        </div>
                                    </div>
                                    <h3 className="text-center font-bold text-slate-900 dark:text-white mb-2">
                                        {cert.courseTitle}
                                    </h3>
                                    <p className="text-center text-sm text-slate-600 dark:text-slate-400 mb-1">
                                        Completed: {new Date(cert.completionDate).toLocaleDateString()}
                                    </p>
                                    {cert.grade && (
                                        <p className="text-center text-sm font-semibold text-green-600 mb-4">
                                            Grade: {cert.grade}%
                                        </p>
                                    )}
                                    <button
                                        onClick={() => downloadCertificate(cert.id)}
                                        className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
