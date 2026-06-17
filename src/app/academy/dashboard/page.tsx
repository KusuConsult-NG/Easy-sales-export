"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { Award, BookOpen, Clock, TrendingUp, Calendar, Download, Loader2, ChevronLeft, Video } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { checkAcademyPaymentStatusAction, getLiveSessionsAction, type LiveSession } from "@/app/actions/academy";
import { useMembershipStatus } from "@/hooks/useMembershipStatus";
import { formatLocalDate } from "@/lib/date-utils";

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
    const { status } = useSession();
    const router = useRouter();
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
    const [isUnpaid, setIsUnpaid] = useState(false);
    const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);

    const { data: sessionData, update: updateSession } = useSession();
    const userId = (sessionData?.user as any)?.id;
    const { status: membershipStatus } = useMembershipStatus(userId, "academy", sessionData?.user?.email || undefined);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy/dashboard");
            return;
        }
        
        if (status === "authenticated" && membershipStatus !== "loading") {
            if (membershipStatus === "approved" || membershipStatus === "active") {
                // SILENT REFRESH: If local session is stale, refresh it
                if ((sessionData?.user as any)?.serviceRegistrations?.academy?.status !== "approved") {
                    updateSession();
                }
                setIsUnpaid(false);
                fetchDashboardData();
            } else if (membershipStatus === "pending") {
                // If application is pending, check if they have paid
                checkAcademyPaymentStatusAction().then((payStatus) => {
                    if (payStatus.success && payStatus.data === "paid") {
                        // User has paid and application is pending approval, send them to the pending screen!
                        router.replace("/academy/application/pending");
                    } else {
                        // User is pending but has not paid yet (unpaid)
                        setIsUnpaid(true);
                        setIsLoading(false);
                    }
                }).catch((err) => {
                    logger.error("Failed to check payment status on dashboard", err);
                    setIsUnpaid(true);
                    setIsLoading(false);
                });
            } else if (membershipStatus === "not_found") {
                setIsUnpaid(true);
                setIsLoading(false);
            } else {
                setIsUnpaid(true);
                setIsLoading(false);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, router, membershipStatus]);

    async function fetchDashboardData() {
        try {
            const response = await fetch("/api/academy/dashboard");
            const data = await response.json();

            if (data.success) {
                setCourses(data.courses || []);
                setCertificates(data.certificates || []);
                setStats(data.stats || stats);
            }

            // Fetch live sessions
            const liveRes = await getLiveSessionsAction();
            if (liveRes.success && liveRes.data) {
                const active = liveRes.data.filter((s: any) => s.status === "live");
                setLiveSessions(active);
            }
        } catch (error) {
            logger.error("Failed to fetch dashboard data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const downloadCertificate = async (certificateId: string) => {
        try {
            window.open(`/academy/certificate/${certificateId}`, '_blank');
        } catch (error) {
            logger.error("Failed to download certificate:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (isUnpaid) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Award className="w-10 h-10 text-red-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Payment Required
                    </h1>
                    <p className="text-slate-600 mb-8">
                        You have not completed the payment for your Academy package. You must pay your enrollment fee to access your learning dashboard.
                    </p>
                    <Link
                        href="/academy/application"
                        className="inline-flex w-full items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
                    >
                        Complete Payment
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Back to Hub Link */}
                <div className="mb-4">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 transition"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                </div>

                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        My Learning Dashboard
                    </h1>
                    <p className="text-slate-600">
                        Track your progress and achievements
                    </p>
                </div>

                {/* Active Live Sessions Banner */}
                {liveSessions.length > 0 && (
                    <div className="mb-8 space-y-4">
                        {liveSessions.map((session) => (
                            <div key={session.id} className="bg-red-50 border border-red-200 rounded-2xl p-6 shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                                        <Video className="w-6 h-6 text-red-600 animate-pulse" />
                                    </div>
                                    <div>
                                        <span className="inline-block text-[10px] bg-red-600 text-white font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse mb-1">
                                            Live Now
                                        </span>
                                        <h3 className="font-bold text-slate-900 text-lg">
                                            {session.title}
                                        </h3>
                                        <p className="text-sm text-slate-600">
                                            Instructor: {session.instructor || "Super Admin"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => router.push(`/academy/live/${session.courseId}`)}
                                    className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-sm transition flex items-center gap-2"
                                >
                                    Join Live Session
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-linear-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <BookOpen className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.totalCourses}</span>
                        </div>
                        <p className="text-blue-100 font-semibold">Total Courses</p>
                    </div>

                    <div className="bg-linear-to-br from-yellow-500 to-yellow-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <TrendingUp className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.inProgress}</span>
                        </div>
                        <p className="text-yellow-100 font-semibold">In Progress</p>
                    </div>

                    <div className="bg-linear-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <Award className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.completed}</span>
                        </div>
                        <p className="text-green-100 font-semibold">Completed</p>
                    </div>

                    <div className="bg-linear-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                        <div className="flex items-center justify-between mb-4">
                            <Clock className="w-8 h-8 opacity-80" />
                            <span className="text-3xl font-bold">{stats.learningStreak}</span>
                        </div>
                        <p className="text-purple-100 font-semibold">Day Streak 🔥</p>
                    </div>
                </div>

                {/* My Courses */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6">
                        My Courses
                    </h2>

                    {courses.length === 0 ? (
                        <div className="text-center py-12">
                            <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-500 mb-4">
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
                                    href={`/academy/${course.courseId}`}
                                    className="block"
                                >
                                    <div className="bg-slate-50 rounded-xl p-6 hover:shadow-lg transition-all border border-slate-200">
                                        <div className="flex items-start justify-between mb-4">
                                            <h3 className="text-lg font-bold text-slate-900">
                                                {course.courseTitle}
                                            </h3>
                                            {course.certificateId && (
                                                <Award className="w-6 h-6 text-yellow-500" />
                                            )}
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="mb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-semibold text-slate-900">
                                                    Progress
                                                </span>
                                                <span className="text-sm font-bold text-primary">
                                                    {course.completionPercentage}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-200 rounded-full h-2">
                                                <div
                                                    className="bg-primary h-2 rounded-full transition-all"
                                                    style={{ width: `${course.completionPercentage}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Stats */}
                                        <div className="flex items-center gap-4 text-sm text-slate-600">
                                            <div className="flex items-center gap-1">
                                                <BookOpen className="w-4 h-4" />
                                                {(course.completedLessons || []).length}/{course.totalLessons} lessons
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
                    <div className="bg-white rounded-xl shadow-lg p-6">
                        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                            <Award className="w-7 h-7 text-yellow-500" />
                            My Certificates
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {certificates.map((cert) => (
                                <div
                                    key={cert.id}
                                    className="bg-linear-to-br from-yellow-50 to-yellow-100 rounded-xl p-6 border-2 border-yellow-200"
                                >
                                    <div className="flex items-center justify-center mb-4">
                                        <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center">
                                            <Award className="w-10 h-10 text-white" />
                                        </div>
                                    </div>
                                    <h3 className="text-center font-bold text-slate-900 mb-2">
                                        {cert.courseTitle}
                                    </h3>
                                    <p className="text-center text-sm text-slate-600 mb-1">
                                        Completed: {formatLocalDate(cert.completionDate)}
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
