"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from '@/lib/logger';
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Award, Download, Share2, CheckCircle, Loader2, ArrowLeft, Linkedin } from "lucide-react";
import Image from "next/image";
import { getCourseByIdAction, getUserProgressAction, type Course, type UserProgress } from "@/app/actions/academy";
import { useToast } from "@/contexts/ToastContext";

export default function CertificatePage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const courseId = params.certificateId as string;
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function fetchCertificateData() {
            if (!session) {
                router.push("/auth/login?callbackUrl=/academy");
                return;
            }

            if (status !== "authenticated" || !session?.user) return;

            setLoading(true);
            try {
                const [courseReq, progressReq] = await Promise.all([
                    getCourseByIdAction(courseId),
                    getUserProgressAction(session.user.id, courseId),
                ]);

                if (mounted) {
                    setCourse(courseReq.data || null);
                    setProgress(progressReq.data || null);
                }
            } catch (err) {
                logger.error("Failed to load certificate data:", err);
                // Optionally set an error state here if needed
            } finally {
                if (mounted) setLoading(false);
            }
        }

        fetchCertificateData();

        return () => { mounted = false; };
    }, [courseId, session, status, router]);



    function handleDownload() {
        setDownloading(true);
        // Use Server-Side PDF Generation API
        const date = new Date().toISOString().split('T')[0];
        const name = encodeURIComponent(session?.user?.name || 'Student');
        const url = `/api/academy/certificate/${courseId}?name=${name}&date=${date}`;

        // Open in new tab (browser handles download/view)
        window.open(url, '_blank');
        setDownloading(false);
    };

    function handleAddToLinkedIn() {
        // LinkedIn "Add to Profile" certification URL
        // https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&...
        const certName = encodeURIComponent(course?.title || "Export Trade Certificate");
        const orgName = encodeURIComponent("Easy Sales Export Academy");
        const issueYear = completionDate.getFullYear();
        const issueMonth = completionDate.getMonth() + 1; // LinkedIn expects 1-indexed month
        const certId = encodeURIComponent(`ACAD-${issueYear}-${courseId.substring(0, 6).toUpperCase()}`);
        const certUrl = encodeURIComponent(`${window.location.origin}/academy/verify/${certId}`);

        const linkedInUrl =
            `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME` +
            `&name=${certName}` +
            `&organizationName=${orgName}` +
            `&issueYear=${issueYear}` +
            `&issueMonth=${issueMonth}` +
            `&certUrl=${certUrl}` +
            `&certId=${certId}`;

        window.open(linkedInUrl, "_blank", "noopener,noreferrer");
    };

    function handleShare() {
        const shareText = `I just completed ${course?.title} on Easy Sales Export Academy! 🎓`;
        if (navigator.share) {
            navigator.share({
                title: 'Course Certificate',
                text: shareText,
                url: window.location.href,
            });
        } else {
            navigator.clipboard.writeText(shareText + ' ' + window.location.href);
            showToast('Certificate link copied to clipboard!', "success");
        }
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!course || !progress || progress.overallProgress !== 100) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <Award className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Certificate Not Available
                    </h1>
                    <p className="text-slate-600 mb-6">
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
    const completionDate = progress.completedAt && 'toDate' in progress.completedAt
        ? progress.completedAt.toDate()
        : new Date();

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-8 print:hidden">
                    <button
                        onClick={() => router.push('/academy/dashboard')}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Dashboard</span>
                    </button>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleAddToLinkedIn}
                            className="px-4 py-2 bg-[#0077B5] hover:bg-[#006097] text-white rounded-lg transition flex items-center gap-2 font-semibold"
                        >
                            <Linkedin className="w-4 h-4" />
                            <span>Add to LinkedIn</span>
                        </button>
                        <button
                            onClick={handleShare}
                            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg transition flex items-center gap-2"
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
                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                    {/* Decorative Header */}
                    <div className="bg-linear-to-r from-blue-600 via-cyan-600 to-blue-600 h-4"></div>

                    <div className="p-12 md:p-16">
                        {/* Logo & Title */}
                        <div className="text-center mb-12">
                            <div className="inline-block mb-6 bg-white rounded-xl shadow-md p-3 border border-slate-100">
                                { }
                                <Image
                                    src="/images/logo.jpg"
                                    alt="Easy Sales Export Academy"
                                    width={200}
                                    height={64}
                                    className="h-16 w-auto object-contain mx-auto"
                                />
                            </div>
                            <p className="text-sm font-bold tracking-widest uppercase text-blue-600 mb-2">Easy Sales Export Academy</p>
                            <h1 className="text-5xl font-bold text-slate-900 mb-2">
                                Certificate of Completion
                            </h1>
                            <div className="w-32 h-1 bg-linear-to-r from-transparent via-blue-600 to-transparent mx-auto"></div>
                        </div>

                        {/* Body */}
                        <div className="text-center space-y-8 mb-12">
                            <p className="text-lg text-slate-600">
                                This certifies that
                            </p>

                            <h2 className="text-4xl font-bold text-slate-900">
                                {session?.user?.name || 'Student Name'}
                            </h2>

                            <p className="text-lg text-slate-600">
                                has successfully completed the course
                            </p>

                            <h3 className="text-3xl font-bold text-blue-600">
                                {course.title}
                            </h3>

                            <div className="flex items-center justify-center gap-8 text-slate-600">
                                <div>
                                    <p className="text-sm font-medium">Instructor</p>
                                    <p className="text-lg font-bold text-slate-900">
                                        {course.instructor}
                                    </p>
                                </div>
                                <div className="w-px h-12 bg-slate-300"></div>
                                <div>
                                    <p className="text-sm font-medium">Duration</p>
                                    <p className="text-lg font-bold text-slate-900">
                                        {course.duration}
                                    </p>
                                </div>
                            </div>

                            <div className="pt-8">
                                <p className="text-sm text-slate-500 mb-2">
                                    Completed on
                                </p>
                                <p className="text-xl font-bold text-slate-900">
                                    {completionDate.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </p>
                            </div>
                        </div>

                        {/* Signature Area */}
                        <div className="pt-8 border-t border-slate-200">
                            <div className="flex items-end justify-between">
                                <div className="text-center">
                                    <div className="w-48 border-b-2 border-slate-300 mb-2"></div>
                                    <p className="text-sm text-slate-600">Program Director</p>
                                </div>
                                <div className="text-center">
                                    <div className="flex items-center gap-2 mb-2">
                                        <CheckCircle className="w-5 h-5 text-green-600" />
                                        <span className="font-mono text-sm text-slate-600">
                                            {certNumber}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-600">Certificate ID</p>
                                </div>
                            </div>
                        </div>

                        {/* Footer Note */}
                        <div className="mt-12 text-center">
                            <p className="text-xs text-slate-400">
                                Easy Sales Export Academy • www.easysalesexport.com
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                Verify this certificate at: www.easysalesexport.com/verify/{certNumber}
                            </p>
                        </div>
                    </div>

                    {/* Decorative Footer */}
                    <div className="bg-linear-to-r from-blue-600 via-cyan-600 to-blue-600 h-4"></div>
                </div>

                {/* Print Instructions */}
                <div className="mt-8 text-center text-sm text-slate-500 print:hidden">
                    <p>💡 Tip: Click "Download PDF" to get your official verifiable certificate.</p>
                </div>
            </div>
        </div>
    );
}
