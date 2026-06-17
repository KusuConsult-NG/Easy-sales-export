"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Video, ArrowLeft, Loader2, Calendar } from "lucide-react";
import { getLiveSessionsAction } from "@/app/actions/academy";
import { logger } from "@/lib/logger";

export default function AcademyLivePage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [liveSessions, setLiveSessions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (status === "loading") return;

        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy/live");
            return;
        }

        async function loadLiveSessions() {
            try {
                const liveRes = await getLiveSessionsAction();
                if (liveRes.success && liveRes.data) {
                    const active = (liveRes.data as any[]).filter((s: any) => s.status === "live");
                    setLiveSessions(active);
                }
            } catch (error) {
                logger.error("Failed to load live sessions:", error);
            } finally {
                setIsLoading(false);
            }
        }

        loadLiveSessions();
    }, [status, router]);

    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Checking for live classes...</p>
                </div>
            </div>
        );
    }

    if (!session?.user) return null;

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push("/academy/dashboard")}
                        className="flex items-center gap-2 text-slate-600 hover:text-primary mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Academy
                    </button>

                    <div className="bg-white rounded-xl shadow-lg p-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                <Video className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">
                                    Live Classes
                                </h1>
                                <p className="text-slate-600 mt-1">
                                    Join current interactive sessions with instructors
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Sessions List */}
                {liveSessions.length > 0 ? (
                    <div className="space-y-6">
                        {liveSessions.map((session) => (
                            <div
                                key={session.id}
                                className="bg-white rounded-2xl p-6 shadow-md border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 hover:shadow-lg transition-shadow"
                            >
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
                                            Instructor: {session.instructor || "Academy Instructor"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => router.push(`/academy/live/${session.courseId}`)}
                                    className="w-full sm:w-auto px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                                >
                                    Join Live Session
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-lg p-12 text-center border border-slate-100">
                        <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-950 mb-2">
                            No Active Live Classes
                        </h3>
                        <p className="text-slate-500 mb-6 max-w-sm mx-auto text-sm">
                            There are currently no active live session broadcasts. Check back when a session is scheduled.
                        </p>
                        <button
                            onClick={() => router.push("/academy/dashboard")}
                            className="px-6 py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition"
                        >
                            Go to Dashboard
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
