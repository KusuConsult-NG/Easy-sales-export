"use client";

import { useState, useEffect, use } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, BookOpen, ArrowLeft, Users } from "lucide-react";
import { getCourseByIdAction } from "@/app/actions/academy";

interface AcademyLiveClassPageProps {
    params: Promise<{ courseId: string }>;
}

export default function AcademyLiveClassPage(props: AcademyLiveClassPageProps) {
    const params = use(props.params);
    const router = useRouter();
    const { data: session, status } = useSession();
    const [course, setCourse] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    const courseId = params.courseId;

    useEffect(() => {
        if (status === "loading") return;

        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy");
            return;
        }

        async function loadCourse() {
            try {
                const courseData = await getCourseByIdAction(courseId);
                if (courseData) {
                    setCourse(courseData);
                } else {
                    // Fallback with courseId as title
                    setCourse({ id: courseId, title: courseId.replace(/-/g, " "), instructor: "Easy Sales Academy" });
                }
            } catch (error) {
                logger.error("Failed to load course:", error);
                setCourse({ id: courseId, title: "Live Class", instructor: "Easy Sales Academy" });
            } finally {
                setIsLoading(false);
            }
        }

        loadCourse();
    }, [status, courseId, router]);

    const handleMeetingEnd = () => {
        router.push("/academy/dashboard");
    };

    if (status === "loading" || isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading live class...</p>
                </div>
            </div>
        );
    }

    if (!session?.user) return null;

    const user = session.user as any;
    const isInstructor = user.roles?.includes("instructor") || user.roles?.includes("admin");

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
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
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                    <BookOpen className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900">
                                        {course?.title || "Live Class"}
                                    </h1>
                                    <p className="text-slate-600 mt-1">
                                        Live interactive session with instructor
                                    </p>
                                </div>
                            </div>

                            {isInstructor && (
                                <div className="bg-purple-100 px-3 py-1 rounded-lg">
                                    <span className="text-sm font-semibold text-purple-700">
                                        Instructor
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-6 mt-6 text-sm">
                            <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600">
                                    {course?.instructor || "Easy Sales Academy"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Video className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-600">Live Session</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Video Classroom */}
                <div className="h-[calc(100vh-300px)] min-h-[500px]">
                    <VideoClassroom
                        roomName={`academy-${courseId}`}
                        userName={user.name || user.email || "Student"}
                        userEmail={user.email}
                        isModerator={isInstructor}
                        subject={`Academy: ${course?.title || courseId}`}
                        onMeetingEnd={handleMeetingEnd}
                    />
                </div>

                {/* Guidelines */}
                <div className="mt-6 bg-purple-50 rounded-xl p-6">
                    <h3 className="font-bold text-purple-900 mb-3">Live Class Guidelines:</h3>
                    <ul className="space-y-2 text-sm text-purple-800">
                        <li>• Please mute your microphone when the instructor is speaking</li>
                        <li>• Use the &quot;Raise Hand&quot; feature to ask questions</li>
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
