"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, ArrowLeft, BookOpen, Users, PhoneOff, Loader2, AlertCircle } from "lucide-react";
import { getCourseByIdAction, endAcademyLiveSessionAction, getLiveSessionsAction } from "@/app/actions/academy";
import { toast } from "sonner";

interface Props {
    params: Promise<{ courseId: string }>;
}

export default function AdminAcademyLivePage({ params }: Props) {
    const { courseId } = use(params);
    const router = useRouter();
    const { data: session, status } = useSession();

    const [course, setCourse] = useState<any>(null);
    const [liveSession, setLiveSession] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEnding, setIsEnding] = useState(false);
    const [ended, setEnded] = useState(false);

    useEffect(() => {
        if (status === "loading") return;
        if (status === "unauthenticated") {
            router.push("/auth/login");
            return;
        }

        async function loadCourse() {
            try {
                const result = await getCourseByIdAction(courseId);
                if (result.success && result.data) {
                    setCourse(result.data);
                } else {
                    // Fallback: render room with minimal info
                    setCourse({ id: courseId, title: courseId.replace(/-/g, " "), instructor: "Easy Sales Academy" });
                }

                // Load active live session link if it exists
                const liveRes = await getLiveSessionsAction(courseId);
                if (liveRes.success && liveRes.data) {
                    const active = (liveRes.data as any[]).find((s: any) => s.status === "live");
                    if (active) {
                        setLiveSession(active);
                    }
                }
            } catch {
                setCourse({ id: courseId, title: "Live Class", instructor: "Easy Sales Academy" });
            } finally {
                setIsLoading(false);
            }
        }

        loadCourse();
    }, [status, courseId, router]);

    async function handleEndSession() {
        const confirmed = confirm("End the live session? Students will no longer be able to join.");
        if (!confirmed) return;

        setIsEnding(true);
        try {
            const result = await endAcademyLiveSessionAction(courseId);
            if (result.success) {
                toast.success("Live session ended successfully.");
                setEnded(true);
                setTimeout(() => router.push("/admin/academy"), 2000);
            } else {
                toast.error(result.error || "Failed to end session");
            }
        } catch {
            toast.error("An error occurred ending the session");
        } finally {
            setIsEnding(false);
        }
    }

    function handleMeetingLeft() {
        router.push("/admin/academy");
    }

    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold">Setting up live classroom...</p>
                </div>
            </div>
        );
    }

    if (ended) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center text-white">
                    <BookOpen className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Session Ended</h2>
                    <p className="text-slate-400">Redirecting back to Academy Management...</p>
                </div>
            </div>
        );
    }

    const roomName = `academy-${courseId}`;
    const userName = session?.user?.name || session?.user?.email || "Instructor";
    const userEmail = session?.user?.email || undefined;

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Admin Broadcast Header */}
            <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/admin/academy")}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Academy
                    </button>
                    <div className="hidden md:flex items-center gap-3">
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-bold text-sm">LIVE</span>
                        <span className="text-slate-300 text-sm font-medium truncate max-w-xs">
                            {course?.title || "Live Class"}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 bg-purple-900/40 border border-purple-700/50 rounded-lg px-3 py-1.5">
                        <Users className="w-4 h-4 text-purple-400" />
                        <span className="text-purple-300 text-xs font-semibold">Instructor (Moderator)</span>
                    </div>
                    <button
                        onClick={handleEndSession}
                        disabled={isEnding}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                        {isEnding ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <PhoneOff className="w-4 h-4" />
                        )}
                        End Class
                    </button>
                </div>
            </div>

            {/* Course Info Bar */}
            {course && (
                <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-2 flex items-center gap-6 text-xs text-slate-400 shrink-0">
                    <span className="flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        Course: <span className="text-slate-200 font-medium ml-1">{course.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Instructor: <span className="text-slate-200 font-medium ml-1">{course.instructor || "Admin"}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Students at <strong>/academy/live/{courseId}</strong> will see this session live
                    </span>
                </div>
            )}

            {/* Video Room — full remaining height */}
            <div className="flex-1 p-4">
                <div className="h-[calc(100vh-200px)] min-h-[600px]">
                    {liveSession?.customMeetingLink ? (
                        <div className="flex items-center justify-center h-full bg-slate-800 rounded-xl border border-slate-700">
                            <div className="text-center p-8 max-w-lg">
                                <Video className="w-16 h-16 text-purple-500 mx-auto mb-4 animate-pulse" />
                                <h3 className="text-2xl font-bold text-white mb-2">
                                    Google Meet / External Live Call
                                </h3>
                                <p className="text-slate-400 mb-6">
                                    This live classroom is configured to run externally. Click below to join and host the call.
                                </p>
                                <div className="space-y-4 flex flex-col items-center">
                                    <a
                                        href={liveSession.customMeetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white font-semibold rounded-xl transition shadow-lg hover:shadow-primary/20 transform hover:-translate-y-0.5"
                                    >
                                        <Video className="w-5 h-5" />
                                        Launch External Call
                                    </a>
                                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                        Note: Students visiting the live classroom page will be presented with a direct button to join this exact external call URL.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <VideoClassroom
                            roomName={roomName}
                            userName={userName}
                            userEmail={userEmail}
                            isModerator={true}
                            subject={`Academy: ${course?.title || courseId}`}
                            onMeetingEnd={handleMeetingLeft}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
