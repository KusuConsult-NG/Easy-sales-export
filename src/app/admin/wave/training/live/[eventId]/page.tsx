"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, ArrowLeft, Users, Clock, PhoneOff, Loader2, AlertCircle } from "lucide-react";
import { getWaveTrainingEventsAction, endWaveLiveSessionAction } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";

interface Props {
    params: Promise<{ eventId: string }>;
}

export default function AdminWaveLivePage({ params }: Props) {
    const { eventId } = use(params);
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [event, setEvent] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEnding, setIsEnding] = useState(false);
    const [ended, setEnded] = useState(false);

    useEffect(() => {
        if (status === "loading") return;
        if (status === "unauthenticated") {
            router.push("/auth/login");
            return;
        }

        // Load event details
        async function loadEvent() {
            try {
                // Fetch events and find the matching one
                const result = await getWaveTrainingEventsAction(undefined, 100);
                if (result.success && result.data) {
                    const found = (result.data as any[]).find((e: any) => e.id === eventId);
                    setEvent(found || null);
                }
            } catch (err) {
                // Fallback: render the room with minimal info
                setEvent({ id: eventId, title: "WAVE Live Training", instructor: "Admin" });
            } finally {
                setIsLoading(false);
            }
        }

        loadEvent();
    }, [status, eventId, router]);

    async function handleEndSession() {
        const confirmed = confirm("End the live session? Users will no longer be able to join.");
        if (!confirmed) return;

        setIsEnding(true);
        try {
            const result = await endWaveLiveSessionAction(eventId);
            if (result.success) {
                showToast("Live session ended successfully.", "success");
                setEnded(true);
                setTimeout(() => router.push("/admin/wave/training"), 2000);
            } else {
                showToast(result.error || "Failed to end session", "error");
            }
        } catch {
            showToast("An error occurred ending the session", "error");
        } finally {
            setIsEnding(false);
        }
    }

    function handleMeetingLeft() {
        // User left the Jitsi room — offer to end the session
        router.push("/admin/wave/training");
    }

    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold">Setting up live broadcast...</p>
                </div>
            </div>
        );
    }

    if (ended) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center text-white">
                    <Video className="w-16 h-16 text-pink-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Session Ended</h2>
                    <p className="text-slate-400">Redirecting back to Training Management...</p>
                </div>
            </div>
        );
    }

    const roomName = `wave-training-${eventId}`;
    const userName = session?.user?.name || session?.user?.email || "Admin";
    const userEmail = session?.user?.email || undefined;

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Admin Broadcast Header */}
            <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/admin/wave/training")}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Events
                    </button>
                    <div className="hidden md:flex items-center gap-3">
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-bold text-sm">LIVE</span>
                        <span className="text-slate-300 text-sm font-medium truncate max-w-xs">
                            {event?.title || "WAVE Training Session"}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg px-3 py-1.5">
                        <Users className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-300 text-xs font-semibold">Trainer (Moderator)</span>
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
                        End Session
                    </button>
                </div>
            </div>

            {/* Session Info Bar */}
            {event && (
                <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-2 flex items-center gap-6 text-xs text-slate-400 shrink-0">
                    <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Instructor: <span className="text-slate-200 font-medium ml-1">{event.instructor || "Admin"}</span>
                    </span>
                    {event.duration && (
                        <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Duration: <span className="text-slate-200 font-medium ml-1">{event.duration}</span>
                        </span>
                    )}
                    <span className="flex items-center gap-1.5 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Users at <strong>/wave/live-training</strong> will see this session live
                    </span>
                </div>
            )}

            {/* Video Room — full remaining height */}
            <div className="flex-1 p-4">
                <div className="h-full min-h-[500px]">
                    <VideoClassroom
                        roomName={roomName}
                        userName={userName}
                        userEmail={userEmail}
                        isModerator={true}
                        subject={event?.title || "WAVE Live Training"}
                        onMeetingEnd={handleMeetingLeft}
                    />
                </div>
            </div>
        </div>
    );
}
