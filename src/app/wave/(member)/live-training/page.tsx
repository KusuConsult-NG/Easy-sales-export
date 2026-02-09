"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, Users, Clock, ArrowLeft } from "lucide-react";

export default function WAVELiveTrainingPage() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Get user session
        const fetchUser = async () => {
            try {
                const response = await fetch("/api/auth/session");
                const data = await response.json();
                if (data.success && data.user) {
                    setUser(data.user);
                } else {
                    router.push("/auth/login");
                }
            } catch (error) {
                console.error("Failed to fetch user:", error);
                router.push("/auth/login");
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [router]);

    const handleMeetingEnd = () => {
        router.push("/wave/dashboard");
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading training session...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    // Determine if user is a trainer
    const isTrainer = user.roles?.includes("trainer") || user.roles?.includes("admin");

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push("/wave/dashboard")}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-primary mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </button>

                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                    <Video className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                                        WAVE Live Training Session
                                    </h1>
                                    <p className="text-slate-600 dark:text-slate-400 mt-1">
                                        Interactive training with your cohort
                                    </p>
                                </div>
                            </div>

                            {isTrainer && (
                                <div className="bg-green-100 dark:bg-green-900/30 px-3 py-1 rounded-lg">
                                    <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                                        Trainer
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-3 gap-4 mt-6">
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600 dark:text-slate-400">
                                    Cohort Training
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600 dark:text-slate-400">
                                    {new Date().toLocaleDateString()}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <Video className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600 dark:text-slate-400">
                                    Live Session
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Video Classroom */}
                <div className="h-[calc(100vh-300px)] min-h-[500px]">
                    <VideoClassroom
                        roomName={`wave-training-${new Date().toISOString().split('T')[0]}`}
                        userName={user.name || user.email}
                        userEmail={user.email}
                        isModerator={isTrainer}
                        subject="WAVE Export Training Session"
                        onMeetingEnd={handleMeetingEnd}
                    />
                </div>

                {/* Instructions */}
                <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6">
                    <h3 className="font-bold text-blue-900 dark:text-blue-300 mb-3">
                        Training Tips:
                    </h3>
                    <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-400">
                        <li>• Use headphones to prevent echo</li>
                        <li>• Mute your microphone when not speaking</li>
                        <li>• Use the chat feature for questions</li>
                        <li>• Raise your hand 🖐️ to get trainer's attention</li>
                        {isTrainer && (
                            <>
                                <li>• As a trainer, you can record the session</li>
                                <li>• You can mute all participants if needed</li>
                            </>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
