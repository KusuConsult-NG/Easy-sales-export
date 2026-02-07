"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, BookOpen, ArrowLeft, Users } from "lucide-react";

export default function AcademyLiveClassPage() {
    const router = useRouter();
    const params = useParams();
    const [user, setUser] = useState<any>(null);
    const [course, setCourse] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    const courseId = params?.courseId as string || "general";

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Get user session
                const sessionResponse = await fetch("/api/auth/session");
                const sessionData = await sessionResponse.json();

                if (!sessionData.success || !sessionData.user) {
                    router.push("/auth/login");
                    return;
                }

                setUser(sessionData.user);

                // Get course details (optional - you can enhance this)
                // For now, we'll use a placeholder
                setCourse({
                    id: courseId,
                    title: "Export Fundamentals",
                    instructor: "Easy Sales Academy"
                });

            } catch (error) {
                console.error("Failed to fetch data:", error);
                router.push("/auth/login");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [courseId, router]);

    const handleMeetingEnd = () => {
        router.push("/academy/courses");
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading live class...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    const isInstructor = user.roles?.includes("instructor") || user.roles?.includes("admin");

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push("/academy/courses")}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-primary mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Courses
                    </button>

                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                    <BookOpen className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                                        {course?.title || "Live Class"}
                                    </h1>
                                    <p className="text-slate-600 dark:text-slate-400 mt-1">
                                        Live interactive session with instructor
                                    </p>
                                </div>
                            </div>

                            {isInstructor && (
                                <div className="bg-purple-100 dark:bg-purple-900/30 px-3 py-1 rounded-lg">
                                    <span className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                                        Instructor
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-6 mt-6 text-sm">
                            <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600 dark:text-slate-400">
                                    {course?.instructor}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
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
                        roomName={`academy-${courseId}`}
                        userName={user.name || user.email}
                        userEmail={user.email}
                        isModerator={isInstructor}
                        subject={`Academy: ${course?.title || courseId}`}
                        onMeetingEnd={handleMeetingEnd}
                    />
                </div>

                {/* Instructions */}
                <div className="mt-6 bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6">
                    <h3 className="font-bold text-purple-900 dark:text-purple-300 mb-3">
                        Live Class Guidelines:
                    </h3>
                    <ul className="space-y-2 text-sm text-purple-800 dark:text-purple-400">
                        <li>• Please mute your microphone when the instructor is speaking</li>
                        <li>• Use the "Raise Hand" feature to ask questions</li>
                        <li>• Chat is open for questions and discussions</li>
                        <li>• Screen sharing is available for presentations</li>
                        {isInstructor && (
                            <>
                                <li>• As an instructor, you can record this session</li>
                                <li>• Use the chat to engage with students</li>
                                <li>• You have moderator controls for the room</li>
                            </>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
