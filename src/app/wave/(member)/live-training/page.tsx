"use client";

import { useState, useEffect } from "react";
import { Video, Users, Clock, Calendar, Lock, ChevronRight } from "lucide-react";
import BackButton from "@/components/ui/BackButton";
import VideoClassroom from "@/components/VideoClassroom";
import { useSession } from "next-auth/react";
import { logger } from "@/lib/logger";

interface TrainingSession {
    id: string;
    title: string;
    description?: string;
    scheduledAt: string; // ISO date string
    durationMinutes: number;
    roomName: string;
    /**
     * #188 — the server-minted classroom key. `roomName` is derived from the
     * event id and is only the row's correlation key; this is what opens the
     * room, and /api/wave/training-sessions serves it behind
     * canReadWaveProgramme.
     */
    roomKey?: string | null;
    isActive: boolean;
    customMeetingLink?: string;
}

export default function WAVELiveTrainingPage() {
    const { data: session, status: sessionStatus } = useSession();
    const [sessions, setSessions] = useState<TrainingSession[]>([]);
    const [activeSession, setActiveSession] = useState<TrainingSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (sessionStatus === "loading") return;

        const fetchSessions = async () => {
            try {
                const res = await fetch("/api/wave/training-sessions");
                if (res.ok) {
                    const data = await res.json();
                    const all: TrainingSession[] = data.data?.sessions || [];
                    setSessions(all);

                    // Auto-activate a session that started in the last 2h and ends within durationMinutes
                    const now = Date.now();
                    const live = all.find(s => {
                        const start = new Date(s.scheduledAt).getTime();
                        const end = start + s.durationMinutes * 60 * 1000;
                        return now >= start && now < end;
                    });
                    setActiveSession(live || null);
                }
            } catch (err) {
                logger.error("Failed to fetch WAVE training sessions:", err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSessions();
        // Refresh every 60s so session state updates automatically
        const timer = setInterval(fetchSessions, 60_000);
        return () => clearInterval(timer);
    }, [sessionStatus]);

    const handleMeetingEnd = () => setActiveSession(null);

    const isTrainer = (session?.user?.roles as string[] | undefined)?.includes("trainer") || session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading training sessions...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                <div className="mb-6">
                    <BackButton fallbackPath="/wave/dashboard" />
                    <div className="bg-white rounded-xl shadow-lg p-6 mt-4">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                <Video className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">WAVE Live Training</h1>
                                <p className="text-slate-600">Interactive training with your cohort</p>
                            </div>
                            {isTrainer && (
                                <div className="ml-auto bg-emerald-100 px-3 py-1 rounded-lg">
                                    <span className="text-sm font-semibold text-emerald-800">Trainer</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* If there's an active session → show Jitsi or custom meeting link */}
                {activeSession ? (
                    <div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 flex items-center gap-3">
                            <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse shrink-0" />
                            <p className="font-semibold text-emerald-800">Live now: {activeSession.title}</p>
                        </div>
                        {activeSession.customMeetingLink ? (
                            <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center max-w-2xl mx-auto my-8">
                                <Video className="w-16 h-16 text-primary mx-auto mb-4 animate-pulse" />
                                <h2 className="text-2xl font-bold text-slate-900 mb-2">Live Session on Google Meet</h2>
                                <p className="text-slate-600 mb-6 font-medium">
                                    This training session is being hosted externally on Google Meet (or another meeting service). Click below to join the call in a new tab.
                                </p>
                                <div className="flex flex-col items-center">
                                    <a
                                        href={activeSession.customMeetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                                    >
                                        <Video className="w-5 h-5" />
                                        Join Google Meet Call
                                    </a>
                                </div>
                            </div>
                        ) : (
                            <div className="h-[calc(100vh-300px)] min-h-[500px]">
                                <VideoClassroom
                                    roomKey={activeSession.roomKey ?? ""}
                                    userName={session?.user?.name || session?.user?.email || "WAVE Member"}
                                    userEmail={session?.user?.email || ""}
                                    isModerator={isTrainer}
                                    subject={activeSession.title}
                                    onMeetingEnd={handleMeetingEnd}
                                />
                            </div>
                        )}
                        <div className="mt-6 bg-blue-50 rounded-xl p-6">
                            <h3 className="font-bold text-blue-900 mb-3">Training Tips:</h3>
                            <ul className="space-y-2 text-sm text-blue-800">
                                <li>• Use headphones to prevent echo</li>
                                <li>• Mute your microphone when not speaking</li>
                                <li>• Use the chat feature for questions</li>
                                <li>• Raise your hand 🖐️ to get trainer&apos;s attention</li>
                                {isTrainer && (
                                    <>
                                        <li>• As a trainer, you can record the session</li>
                                        <li>• You can mute all participants if needed</li>
                                    </>
                                )}
                            </ul>
                        </div>
                    </div>
                ) : (
                    /* No active session — show scheduled sessions */
                    <div className="space-y-4">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                            <Lock className="w-5 h-5 text-amber-600 shrink-0" />
                            <p className="text-amber-800 text-sm">No live session is running right now. The room opens automatically when a scheduled session begins.</p>
                        </div>

                        {sessions.length === 0 ? (
                            <div className="bg-white rounded-xl shadow p-10 text-center">
                                <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                <h2 className="text-xl font-bold text-slate-900 mb-2">No sessions scheduled yet</h2>
                                <p className="text-slate-500">Your trainer will schedule live sessions soon. Check back here or watch for notifications.</p>
                            </div>
                        ) : (
                            sessions.map(s => {
                                const start = new Date(s.scheduledAt);
                                const isPast = Date.now() > start.getTime() + s.durationMinutes * 60 * 1000;
                                const isUpcoming = start.getTime() > Date.now();
                                return (
                                    <div key={s.id} className="bg-white rounded-xl shadow p-6 flex items-start gap-4">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isUpcoming ? "bg-blue-100" : isPast ? "bg-slate-100" : "bg-green-100"}`}>
                                            {isUpcoming ? <Calendar className="w-6 h-6 text-blue-600" /> : isPast ? <Clock className="w-6 h-6 text-slate-400" /> : <Video className="w-6 h-6 text-green-600" />}
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="font-bold text-slate-900">{s.title}</h3>
                                            {s.description && <p className="text-sm text-slate-500 mt-1">{s.description}</p>}
                                            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{start.toLocaleDateString()}</span>
                                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.durationMinutes} min</span>
                                            </div>
                                        </div>
                                        <div>
                                            {isPast && <span className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded-full">Ended</span>}
                                            {isUpcoming && <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-semibold">Upcoming</span>}
                                        </div>
                                    </div>
                                );
                            })
                        )}

                        {isTrainer && (
                            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center">
                                <p className="text-slate-500 text-sm mb-3">As a trainer, you can schedule sessions from the Admin panel.</p>
                                <a href="/admin/wave/training" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
                                    Manage Training Sessions <ChevronRight className="w-4 h-4" />
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
