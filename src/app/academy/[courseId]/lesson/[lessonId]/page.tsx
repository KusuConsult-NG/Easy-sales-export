"use client";

import { useState, useEffect, useCallback, use } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ArrowLeft, ArrowRight, CheckCircle, Loader2, BookOpen,
    PlayCircle, Clock, Table
} from "lucide-react";
import {
    getCourseByIdAction,
    getUserProgressAction,
    completeLessonAction,
    type Course,
    type UserProgress,
    type Lesson,
    type CourseModule
} from "@/app/actions/academy";
import {
    updateLessonProgress,
    getLessonProgress
} from "@/app/actions/course-actions";
import { VideoPlayer } from "@/components/lms/VideoPlayer"; // Explicitly Import VideoPlayer
import QuizComponent from "@/components/academy/QuizComponent";
import DOMPurify from "isomorphic-dompurify";
import { useToast } from "@/contexts/ToastContext";

interface LessonPageProps {
    params: Promise<{ courseId: string; lessonId: string }>;
}

export default function LessonPage(props: LessonPageProps) {
    // Next.js 16: params is now a Promise, must unwrap with React.use()
    const params = use(props.params);
    const { courseId, lessonId } = params;

    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
    const [currentModule, setCurrentModule] = useState<CourseModule | null>(null);
    const [loading, setLoading] = useState(true);
    const [completing, setCompleting] = useState(false);

    // NEW: Track initial video progress
    const [initialVideoProgress, setInitialVideoProgress] = useState(0);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/academy");
            return;
        }
    }, [status, router]);

    useEffect(() => {
        let mounted = true;

        async function loadLessonData() {
            if (status !== "authenticated" || !session?.user) return;

            setLoading(true);
            try {
                // Fetch Course, User Progress (Course-level), and Lesson Progress (Video-level)
                const [courseReq, progressReq, lessonProgressData] = await Promise.all([
                    getCourseByIdAction(courseId),
                    getUserProgressAction(session.user.id, courseId),
                    getLessonProgress(lessonId)
                ]);

                if (!mounted) return;
                
                const courseData = courseReq.data;
                const progressData = progressReq.data;

                if (!courseData) {
                    setLoading(false);
                    return;
                }

                // Find current lesson and module
                let foundLesson: Lesson | null = null;
                let foundModule: CourseModule | null = null;

                for (const courseModule of courseData.modules) {
                    const lesson = courseModule.lessons.find((l: Lesson) => l.id === lessonId);
                    if (lesson) {
                        foundLesson = lesson;
                        foundModule = courseModule;
                        break;
                    }
                }

                if (mounted) {
                    setCourse(courseData);
                    setProgress(progressData || null);
                    setCurrentLesson(foundLesson);
                    setCurrentModule(foundModule);

                    // Set initial video progress if exists
                    if (lessonProgressData.success && lessonProgressData.data?.progress) {
                        setInitialVideoProgress(lessonProgressData.data.progress.progressPercent);
                    }
                }
            } catch (error) {
                logger.error("Failed to load lesson data:", error);
            } finally {
                if (mounted) setLoading(false);
            }
        }

        loadLessonData();

        return () => { mounted = false; };
    }, [courseId, lessonId, session, status]);

    // Function to manually refresh lesson data (e.g. after completion)
    const loadLesson = useCallback(async () => {
        if (!session?.user) return;

        try {
            const [courseReq, progressReq] = await Promise.all([
                getCourseByIdAction(courseId),
                getUserProgressAction(session.user.id, courseId),
            ]);
            
            const courseData = courseReq.data;
            const progressData = progressReq.data;

            if (courseData) {
                // Find current lesson and module
                let foundLesson: Lesson | null = null;
                let foundModule: CourseModule | null = null;

                for (const courseModule of courseData.modules) {
                    const lesson = courseModule.lessons.find((l: Lesson) => l.id === lessonId);
                    if (lesson) {
                        foundLesson = lesson;
                        foundModule = courseModule;
                        break;
                    }
                }

                setCourse(courseData);
                setProgress(progressData || null);
                setCurrentLesson(foundLesson);
                setCurrentModule(foundModule);
            }
        } catch (error) {
            logger.error("Failed to refresh lesson:", error);
        }
    }, [courseId, lessonId, session]);

    // NEW: Handle Video Progress Update
    const handleVideoProgress = useCallback(async (progress: number, timeWatched: number) => {
        if (!currentLesson || !courseId) return;

        // This is called by VideoPlayer every 10s
        await updateLessonProgress({
            courseId,
            lessonId: currentLesson.id,
            progressPercent: progress,
            lastWatchedSecond: timeWatched
        });
    }, [courseId, currentLesson]);

    async function handleMarkComplete() {
        if (!session?.user || !currentLesson) return;

        setCompleting(true);
        const result = await completeLessonAction(
            session.user.id,
            courseId,
            currentLesson.id
        );

        if (result.success) {
            await loadLesson(); // Refresh progress
            showToast("Lesson marked as complete!", "success");
        } else {
            showToast(result.error || "Failed to mark lesson as complete", "error");
        }

        setCompleting(false);
    }

    function getNextLesson(): { lessonId: string; moduleId: string } | null {
        if (!course || !currentLesson || !currentModule) return null;

        const currentModuleIndex = course.modules.findIndex(m => m.id === currentModule.id);
        const currentLessonIndex = currentModule.lessons.findIndex(l => l.id === currentLesson.id);

        // Try next lesson in same module
        if (currentLessonIndex < currentModule.lessons.length - 1) {
            return {
                lessonId: currentModule.lessons[currentLessonIndex + 1].id,
                moduleId: currentModule.id
            };
        }

        // Try first lesson of next module
        if (currentModuleIndex < course.modules.length - 1) {
            const nextModule = course.modules[currentModuleIndex + 1];
            if (nextModule.lessons.length > 0) {
                return {
                    lessonId: nextModule.lessons[0].id,
                    moduleId: nextModule.id
                };
            }
        }

        return null; // Course complete
    }

    function getPreviousLesson(): { lessonId: string; moduleId: string } | null {
        if (!course || !currentLesson || !currentModule) return null;

        const currentModuleIndex = course.modules.findIndex(m => m.id === currentModule.id);
        const currentLessonIndex = currentModule.lessons.findIndex(l => l.id === currentLesson.id);

        // Try previous lesson in same module
        if (currentLessonIndex > 0) {
            return {
                lessonId: currentModule.lessons[currentLessonIndex - 1].id,
                moduleId: currentModule.id
            };
        }

        // Try last lesson of previous module
        if (currentModuleIndex > 0) {
            const prevModule = course.modules[currentModuleIndex - 1];
            if (prevModule.lessons.length > 0) {
                return {
                    lessonId: prevModule.lessons[prevModule.lessons.length - 1].id,
                    moduleId: prevModule.id
                };
            }
        }

        return null; // First lesson
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course || !currentLesson || !currentModule) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                        Lesson Not Found
                    </h2>
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="text-blue-500 hover:text-blue-600 font-medium"
                    >
                        ← Back to Course
                    </button>
                </div>
            </div>
        );
    }

    const isCompleted = progress?.completedLessons?.includes(currentLesson.id) || false;
    const nextLesson = getNextLesson();
    const previousLesson = getPreviousLesson();
    const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const completedLessons = progress?.completedLessons?.length || 0;
    const progressPercent = progress?.overallProgress || 0;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="mb-4 text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to {course.title}
                    </button>

                    {/* Progress Bar */}
                    <div className="bg-white rounded-xl p-4 mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-600">
                                Course Progress
                            </span>
                            <span className="text-sm font-bold text-blue-600">
                                {completedLessons} / {totalLessons} lessons ({progressPercent}%)
                            </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-blue-500 to-cyan-500 transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>

                    {/* Module & Lesson Title */}
                    <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                        <BookOpen className="w-4 h-4" />
                        <span>{currentModule.title}</span>
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        {currentLesson.title}
                    </h1>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Clock className="w-4 h-4" />
                        <span>{currentLesson.duration}</span>
                        {isCompleted && (
                            <div className="flex items-center gap-1 text-green-600 ml-4">
                                <CheckCircle className="w-4 h-4" />
                                <span>Completed</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Video Player (if video exists) */}
                {currentLesson.videoUrl && (
                    <div className="bg-black rounded-2xl overflow-hidden mb-6" style={{ aspectRatio: "16/9" }}>
                        <VideoPlayer
                            courseId={courseId}
                            videoUrl={currentLesson.videoUrl}
                            initialProgress={initialVideoProgress}
                            onProgressUpdate={handleVideoProgress}
                            onComplete={() => {
                                // Optional: Auto-mark complete or show confetti
                                // For now, we rely on the user clicking the button, but now it will be allowed!
                            }}
                        />
                    </div>
                )}

                {/* Document Viewer (if document exists) */}
                {currentLesson.documentUrl && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <BookOpen className="w-6 h-6 text-blue-600" />
                                Course Document
                            </h3>
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                                Read Only
                            </span>
                        </div>
                        <div className="w-full h-[600px] md:h-[800px] bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative" onContextMenu={(e) => e.preventDefault()}>
                            <iframe 
                                src={`${currentLesson.documentUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                                className="w-full h-full border-0"
                                title="Lesson Document"
                            />
                        </div>
                    </div>
                )}

                {/* Excel Viewer (if excel exists) */}
                {currentLesson.excelUrl && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Table className="w-6 h-6 text-green-600" />
                                Course Spreadsheet
                            </h3>
                            <div className="flex items-center gap-3">
                                <a href={currentLesson.excelUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 bg-blue-100 px-3 py-2 rounded-lg hover:bg-blue-200 transition">
                                    Download External
                                </a>
                            </div>
                        </div>
                        <div className="w-full h-[600px] md:h-[800px] bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative">
                            <iframe 
                                src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(currentLesson.excelUrl)}`}
                                className="w-full h-full border-0"
                                title="Lesson Spreadsheet"
                            />
                        </div>
                    </div>
                )}

                {/* Lesson Content Text */}
                {currentLesson.content && currentLesson.content.trim() !== '<p></p>' && currentLesson.content.trim() !== '' && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
                        <div
                            className="prose max-w-none"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentLesson.content) }}
                        />
                    </div>
                )}

                {/* Quiz Section - Render if module has quiz and lesson is completed */}
                {currentModule.quiz && isCompleted && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 mb-1">
                                    Module Quiz
                                </h2>
                                <p className="text-sm text-slate-600">
                                    {currentModule.quiz.questions.length} questions • Passing score: {currentModule.quiz.passingScore}%
                                </p>
                            </div>
                            {progress?.quizScores?.[currentModule.id] !== undefined && (
                                <div className={`px-4 py-2 rounded-lg font-bold ${(progress?.quizScores?.[currentModule.id] || 0) >= currentModule.quiz.passingScore
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                                    }`}>
                                    Score: {progress?.quizScores?.[currentModule.id]}%
                                </div>
                            )}
                        </div>

                        <QuizComponent
                            quiz={currentModule.quiz}
                            moduleId={currentModule.id}
                            courseId={courseId}
                            userId={session?.user?.id || ''}
                            existingScore={progress?.quizScores?.[currentModule.id]}
                            onComplete={loadLesson}
                        />
                    </div>
                )}

                {/* Mark Complete Button */}
                {!isCompleted && (
                    <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1">
                                    Finished this lesson?
                                </h3>
                                <p className="text-sm text-slate-600">
                                    Mark it as complete to track your progress
                                </p>
                            </div>
                            <button
                                onClick={handleMarkComplete}
                                disabled={completing}
                                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition flex items-center gap-2"
                            >
                                {completing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Marking...</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        <span>Mark as Complete</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Navigation */}
                <div className="flex items-center justify-between gap-4">
                    {previousLesson ? (
                        <button
                            onClick={() => router.push(`/academy/${courseId}/lesson/${previousLesson.lessonId}`)}
                            className="flex-1 px-6 py-4 bg-white rounded-xl shadow hover:shadow-lg transition flex items-center gap-2 justify-center"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="font-medium text-slate-900">Previous Lesson</span>
                        </button>
                    ) : (
                        <div className="flex-1" />
                    )}

                    {nextLesson ? (
                        <button
                            onClick={() => router.push(`/academy/${courseId}/lesson/${nextLesson.lessonId}`)}
                            className="flex-1 px-6 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg transition flex items-center gap-2 justify-center text-white font-semibold"
                        >
                            <span>Next Lesson</span>
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    ) : (
                        <button
                            onClick={() => router.push(`/academy/${courseId}`)}
                            className="flex-1 px-6 py-4 bg-green-600 hover:bg-green-700 rounded-xl shadow-lg transition flex items-center gap-2 justify-center text-white font-semibold"
                        >
                            <CheckCircle className="w-5 h-5" />
                            <span>Course Complete!</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
