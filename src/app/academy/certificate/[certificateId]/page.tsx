"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Award, Download, Share2, CheckCircle, Loader2, ArrowLeft } from "lucide-react";
import { getCourseByIdAction, getUserProgressAction, type Course, type UserProgress } from "@/app/actions/academy";

export default function CertificatePage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();

    const courseId = params.certificateId as string;
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated" && session?.user) {
            loadCertificate();
        }
    }, [status, session, courseId]);

    const loadCertificate = async () => {
        setLoading(true);
        const [courseData, progressData] = await Promise.all([
            getCourseByIdAction(courseId),
            getUserProgressAction(session!.user.id, courseId),
        ]);

        setCourse(courseData);
        setProgress(progressData);
        setLoading(false);
    };

    const handleDownload = () => {
        setDownloading(true);
        // Generate certificate number
        const certNumber = `ACAD-${new Date().getFullYear()}-${courseId.substring(0, 6).toUpperCase()}`;

        // In production, this would call a backend API to generate PDF
        // For now, we'll simulate and open print dialog
        setTimeout(() => {
            window.print();
            setDownloading(false);
        }, 500);
    };

    const handleShare = () => {
        const shareText = `I just completed ${course?.title} on Easy Sales Export Academy! 🎓`;
        if (navigator.share) {
            navigator.share({
                title: 'Course Certificate',
                text: shareText,
                url: window.location.href,
            });
        } else {
            navigator.clipboard.writeText(shareText + ' ' + window.location.href);
            alert('Certificate link copied to clipboard!');
        }
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!course || !progress || progress.overallProgress !== 100) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <Award className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Certificate Not Available
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Complete all lessons to earn your certificate.
                    </p>
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition"
                    >
                        Back to Course
                    </button>
                </div>
            </div>
        );
    }

    const certNumber = `ACAD-${new Date().getFullYear()}-${courseId.substring(0, 6).toUpperCase()}`;
    const completionDate = progress.completedAt?.toDate() || new Date();

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-8 print:hidden">
                    <button
                        onClick={() => router.push('/academy/dashboard')}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Dashboard</span>
                    </button>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleShare}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-lg transition flex items-center gap-2"
                        >
                            <Share2 className="w-4 h-4" />
                            <span>Share</span>
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={downloading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition flex items-center gap-2"
                        >
                            {downloading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Preparing...</span>
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    <span>Download PDF</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Certificate */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                    {/* Decorative Header */}
                    <div className="bg-linear-to-r from-blue-600 via-cyan-600 to-blue-600 h-4"></div>

                    <div className="p-12 md:p-16">
                        {/* Logo & Title */}
                        <div className="text-center mb-12">
                            <div className="inline-block mb-4">
                                <Award className="w-24 h-24 text-yellow-500" />
                            </div>
                            <h1 className="text-5xl font-bold text-slate-900 dark:text-white mb-2">
                                Certificate of Completion
                            </h1>
                            <div className="w-32 h-1 bg-linear-to-r from-transparent via-blue-600 to-transparent mx-auto"></div>
                        </div>

                        {/* Body */}
                        <div className="text-center space-y-8 mb-12">
                            <p className="text-lg text-slate-600 dark:text-slate-400">
                                This certifies that
                            </p>

                            <h2 className="text-4xl font-bold text-slate-900 dark:text-white">
                                {session?.user?.name || 'Student Name'}
                            </h2>

                            <p className="text-lg text-slate-600 dark:text-slate-400">
                                has successfully completed the course
                            </p>

                            <h3 className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                                {course.title}
                            </h3>

                            <div className="flex items-center justify-center gap-8 text-slate-600 dark:text-slate-400">
                                <div>
                                    <p className="text-sm font-medium">Instructor</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                                        {course.instructor}
                                    </p>
                                </div>
                                <div className="w-px h-12 bg-slate-300 dark:bg-slate-600"></div>
                                <div>
                                    <p className="text-sm font-medium">Duration</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">
                                        {course.duration}
                                    </p>
                                </div>
                            </div>

                            <div className="pt-8">
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                                    Completed on
                                </p>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">
                                    {completionDate.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </p>
                            </div>
                        </div>

                        {/* Signature Area */}
                        <div className="pt-8 border-t border-slate-200 dark:border-slate-700">
                            <div className="flex items-end justify-between">
                                <div className="text-center">
                                    <div className="w-48 border-b-2 border-slate-300 dark:border-slate-600 mb-2"></div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Program Director</p>
                                </div>
                                <div className="text-center">
                                    <div className="flex items-center gap-2 mb-2">
                                        <CheckCircle className="w-5 h-5 text-green-600" />
                                        <span className="font-mono text-sm text-slate-600 dark:text-slate-400">
                                            {certNumber}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">Certificate ID</p>
                                </div>
                            </div>
                        </div>

                        {/* Footer Note */}
                        <div className="mt-12 text-center">
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                                Easy Sales Export Academy • www.easysalesexport.com
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                Verify this certificate at: www.easysalesexport.com/verify/{certNumber}
                            </p>
                        </div>
                    </div>

                    {/* Decorative Footer */}
                    <div className="bg-linear-to-r from-blue-600 via-cyan-600 to-blue-600 h-4"></div>
                </div>

                {/* Print Instructions */}
                <div className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400 print:hidden">
                    <p>💡 Tip: Click "Download PDF" to save or print your certificate</p>
                </div>
            </div>
        </div>
    );
}
