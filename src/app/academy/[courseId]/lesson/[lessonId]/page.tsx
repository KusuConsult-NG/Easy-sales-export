"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ArrowLeft, ArrowRight, CheckCircle, Loader2, BookOpen,
    PlayCircle, Clock
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
import QuizComponent from "@/components/academy/QuizComponent";

interface LessonPageProps {
    params: { courseId: string; lessonId: string };
}

export default function LessonPage({ params }: LessonPageProps) {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
    const [currentModule, setCurrentModule] = useState<CourseModule | null>(null);
    const [loading, setLoading] = useState(true);
    const [completing, setCompleting] = useState(false);

    const { courseId, lessonId } = params;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            loadLesson();
        }
    }, [status, session, courseId, lessonId]);

    async function loadLesson() {
        setLoading(true);

        const [courseData, progressData] = await Promise.all([
            getCourseByIdAction(courseId),
            getUserProgressAction(session!.user.id, courseId),
        ]);

        if (!courseData) {
            setLoading(false);
            return;
        }

        // Find current lesson and module
        let foundLesson: Lesson | null = null;
        let foundModule: CourseModule | null = null;

        for (const module of courseData.modules) {
            const lesson = module.lessons.find(l => l.id === lessonId);
            if (lesson) {
                foundLesson = lesson;
                foundModule = module;
                break;
            }
        }

        setCourse(courseData);
        setProgress(progressData);
        setCurrentLesson(foundLesson);
        setCurrentModule(foundModule);
        setLoading(false);
    }

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
        } else {
            alert(result.error || "Failed to mark lesson as complete");
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
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course || !currentLesson || !currentModule) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
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

    const isCompleted = progress?.completedLessons.includes(currentLesson.id) || false;
    const nextLesson = getNextLesson();
    const previousLesson = getPreviousLesson();
    const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const completedLessons = progress?.completedLessons.length || 0;
    const progressPercent = progress?.overallProgress || 0;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push(`/academy/${courseId}`)}
                        className="mb-4 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm font-medium flex items-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to {course.title}
                    </button>

                    {/* Progress Bar */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                Course Progress
                            </span>
                            <span className="text-sm font-bold text-blue-600">
                                {completedLessons} / {totalLessons} lessons ({progressPercent}%)
                            </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-blue-500 to-cyan-500 transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>

                    {/* Module & Lesson Title */}
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
                        <BookOpen className="w-4 h-4" />
                        <span>{currentModule.title}</span>
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        {currentLesson.title}
                    </h1>
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Clock className="w-4 h-4" />
                        <span>{currentLesson.duration}</span>
                        {isCompleted && (
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400 ml-4">
                                <CheckCircle className="w-4 h-4" />
                                <span>Completed</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Video Player (if video exists) */}
                {currentLesson.videoUrl && (
                    <div className="bg-black rounded-2xl overflow-hidden mb-6" style={{ aspectRatio: "16/9" }}>
                        <video
                            controls
                            className="w-full h-full"
                            src={currentLesson.videoUrl}
                        >
                            Your browser does not support the video tag.
                        </video>
                    </div>
                )}

                {/* Lesson Content */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-6">
                    <div
                        className="prose dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: currentLesson.content }}
                    />
                </div>

                {/* Quiz Section - Render if module has quiz and lesson is completed */}
                {currentModule.quiz && isCompleted && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                                    Module Quiz
                                </h2>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {currentModule.quiz.questions.length} questions • Passing score: {currentModule.quiz.passingScore}%
                                </p>
                            </div>
                            {progress?.quizScores[currentModule.id] !== undefined && (
                                <div className={`px-4 py-2 rounded-lg font-bold ${(progress.quizScores[currentModule.id] || 0) >= currentModule.quiz.passingScore
                                    ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                    : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                    }`}>
                                    Score: {progress.quizScores[currentModule.id]}%
                                </div>
                            )}
                        </div>

                        <QuizComponent
                            quiz={currentModule.quiz}
                            moduleId={currentModule.id}
                            courseId={courseId}
                            userId={session?.user?.id || ''}
                            existingScore={progress?.quizScores[currentModule.id]}
                            onComplete={loadLesson}
                        />
                    </div>
                )}

                {/* Mark Complete Button */}
                {!isCompleted && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Finished this lesson?
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
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
                            className="flex-1 px-6 py-4 bg-white dark:bg-slate-800 rounded-xl shadow hover:shadow-lg transition flex items-center gap-2 justify-center"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="font-medium text-slate-900 dark:text-white">Previous Lesson</span>
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
