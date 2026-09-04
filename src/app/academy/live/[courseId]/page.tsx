"use client";

import { useState, useEffect, use } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import VideoClassroom from "@/components/VideoClassroom";
import { Video, BookOpen, ArrowLeft, Users } from "lucide-react";
import { getCourseByIdAction, getLiveSessionsAction } from "@/app/actions/academy";

interface AcademyLiveClassPageProps {
    params: Promise<{ courseId: string }>;
}

export default function AcademyLiveClassPage(props: AcademyLiveClassPageProps) {
    const params = use(props.params);
    const router = useRouter();
    const { data: session, status } = useSession();
    const [course, setCourse] = useState<any>(null);
    const [liveSession, setLiveSession] = useState<any>(null);
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
                const courseReq = await getCourseByIdAction(courseId);
                if (courseReq.success && courseReq.data) {
                    setCourse(courseReq.data);
                } else {
                    // Fallback with courseId as title
                    setCourse({ id: courseId, title: courseId.replace(/-/g, " "), instructor: "Easy Sales Academy" });
                }

                // Check if active live session has an external link
                const liveRes = await getLiveSessionsAction(courseId);
                if (liveRes.success && liveRes.data) {
                    const active = (liveRes.data as any[]).find((s: any) => s.status === "live");
                    if (active) {
                        setLiveSession(active);
                    }
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

    function handleMeetingEnd() {
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
    const isInstructor = user.roles?.includes("instructor") || 
                         user.roles?.includes("admin") || 
                         user.serviceRegistrations?.academy?.plan === "elite";

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
                    {liveSession?.customMeetingLink ? (
                        <div className="flex items-center justify-center h-full bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center">
                            <div className="max-w-md mx-auto">
                                <Video className="w-16 h-16 text-primary mx-auto mb-4 animate-pulse" />
                                <h2 className="text-2xl font-bold text-slate-900 mb-2">Live Class on Google Meet</h2>
                                <p className="text-slate-600 mb-6 font-medium">
                                    This class session is being hosted externally on Google Meet (or another meeting service). Click below to join the call in a new tab.
                                </p>
                                <div className="flex flex-col items-center">
                                    <a
                                        href={liveSession.customMeetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                                    >
                                        <Video className="w-5 h-5" />
                                        Join Google Meet Call
                                    </a>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <VideoClassroom
                            // #188. This was `academy-${courseId}`, computed
                            // in the BROWSER from an id on the URL, so the room
                            // was reachable from meet.jit.si with no account.
                            // The key comes off the live-session row, which
                            // _ac_live strips for a learner whose plan does not
                            // open this tier (#267) — so the classroom is now
                            // behind the same gate as the meeting link. An
                            // empty key renders the closed-classroom notice.
                            roomKey={liveSession?.roomKey ?? ""}
                            userName={user.name || user.email || "Student"}
                            userEmail={user.email}
                            isModerator={isInstructor}
                            subject={`Academy: ${course?.title || courseId}`}
                            onMeetingEnd={handleMeetingEnd}
                        />
                    )}
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
