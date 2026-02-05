"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    BookOpen, Clock, Users, PlayCircle, Award, CheckCircle,
    ArrowRight, Loader2, Calendar
} from "lucide-react";
import {
    getCourseByIdAction,
    enrollInCourseAction,
    getUserProgressAction,
    type Course,
    type UserProgress
} from "@/app/actions/academy";

interface CourseDetailPageProps {
    params: { courseId: string };
}

export default function CourseDetailPage({ params }: CourseDetailPageProps) {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [course, setCourse] = useState<Course | null>(null);
    const [progress, setProgress] = useState<UserProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);

    const courseId = params.courseId;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    useEffect(() => {
        if (status === "authenticated" && session?.user) {
            loadCourse();
        }
    }, [status, session, courseId]);

    async function loadCourse() {
        setLoading(true);
        const [courseData, progressData] = await Promise.all([
            getCourseByIdAction(courseId),
            getUserProgressAction(session!.user.id, courseId),
        ]);

        setCourse(courseData);
        setProgress(progressData);
        setLoading(false);
    }

    async function handleEnroll() {
        if (!session?.user) return;

        setEnrolling(true);
        const result = await enrollInCourseAction(session.user.id, courseId);

        if (result.success) {
            await loadCourse(); // Refresh to show enrollment
        } else {
            alert(result.error || "Failed to enroll");
        }

        setEnrolling(false);
    }

    function handleStartLearning() {
        if (!course || !course.modules.length) return;

        // Navigate to first lesson of first module
        const firstModule = course.modules[0];
        const firstLesson = firstModule.lessons[0];

        if (firstLesson) {
            router.push(`/academy/${courseId}/lesson/${firstLesson.id}`);
        }
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!course) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Course Not Found
                    </h2>
                    <button
                        onClick={() => router.push("/academy")}
                        className="text-blue-500 hover:text-blue-600 font-medium"
                    >
                        ← Back to Academy
                    </button>
                </div>
            </div>
        );
    }

    const isEnrolled = progress !== null;
    const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
    const completedLessons = progress?.completedLessons.length || 0;
    const progressPercent = progress?.overallProgress || 0;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header Section */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden mb-8">
                    <div className="bg-linear-to-r from-blue-600 to-cyan-600 p-8 text-white">
                        <button
                            onClick={() => router.push("/academy")}
                            className="mb-4 text-white/90 hover:text-white text-sm font-medium"
                        >
                            ← Back to Academy
                        </button>

                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-medium mb-3">
                                    {course.level.charAt(0).toUpperCase() + course.level.slice(1)}
                                </div>
                                <h1 className="text-4xl font-bold mb-3">{course.title}</h1>
                                <p className="text-lg text-white/90 mb-4">{course.description}</p>

                                <div className="flex flex-wrap items-center gap-4 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        <span>{course.instructor}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        <span>{course.duration}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="w-4 h-4" />
                                        <span>{course.modules.length} Modules • {totalLessons} Lessons</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Enrollment/Progress Section */}
                    <div className="p-8 border-t border-slate-200 dark:border-slate-700">
                        {isEnrolled ? (
                            <div>
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                            Course Progress
                                        </span>
                                        <span className="text-sm font-bold text-blue-600">
                                            {progressPercent}%
                                        </span>
                                    </div>
                                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-linear-to-r from-blue-500 to-cyan-500 transition-all duration-500"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                        {completedLessons} of {totalLessons} lessons completed
                                    </p>
                                </div>

                                <button
                                    onClick={handleStartLearning}
                                    className="w-full md:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                                >
                                    <PlayCircle className="w-5 h-5" />
                                    <span>{progressPercent > 0 ? "Continue Learning" : "Start Learning"}</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                        Start your learning journey
                                    </h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        Enroll now to access all course materials
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnroll}
                                    disabled={enrolling}
                                    className="px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl transition flex items-center gap-2"
                                >
                                    {enrolling ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            <span>Enrolling...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Award className="w-5 h-5" />
                                            <span>Enroll Now</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Course Modules */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        Course Modules
                    </h2>

                    <div className="space-y-6">
                        {course.modules.map((module, moduleIndex) => {
                            const moduleCompleted = progress?.completedModules.includes(module.id);
                            const quizScore = progress?.quizScores[module.id];

                            return (
                                <div
                                    key={module.id}
                                    className={`border-2 rounded-xl p-6 ${moduleCompleted
                                            ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                                            : "border-slate-200 dark:border-slate-700"
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                                    Module {moduleIndex + 1}
                                                </span>
                                                {moduleCompleted && (
                                                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                                        <CheckCircle className="w-4 h-4" />
                                                        <span className="text-xs font-medium">Completed</span>
                                                    </div>
                                                )}
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                                {module.title}
                                            </h3>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                {module.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Lessons List */}
                                    <div className="space-y-2 mb-4">
                                        {module.lessons.map((lesson, lessonIndex) => {
                                            const lessonCompleted = progress?.completedLessons.includes(lesson.id);

                                            return (
                                                <button
                                                    key={lesson.id}
                                                    onClick={() => isEnrolled && router.push(`/academy/${courseId}/lesson/${lesson.id}`)}
                                                    disabled={!isEnrolled}
                                                    className={`w-full flex items-center justify-between p-4 rounded-lg transition ${isEnrolled
                                                            ? "hover:bg-slate-50 dark:hover:bg-slate-700"
                                                            : "opacity-50 cursor-not-allowed"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {lessonCompleted ? (
                                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                                        ) : (
                                                            <PlayCircle className="w-5 h-5 text-slate-400" />
                                                        )}
                                                        <div className="text-left">
                                                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                                                                {lesson.title}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                                {lesson.duration}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <ArrowRight className="w-4 h-4 text-slate-400" />
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Quiz Info */}
                                    {module.quiz && (
                                        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                                                        Module Quiz
                                                    </p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                                        {module.quiz.questions.length} questions • Passing score: {module.quiz.passingScore}%
                                                    </p>
                                                </div>
                                                {quizScore !== undefined && (
                                                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${quizScore >= module.quiz.passingScore
                                                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                        }`}>
                                                        Score: {quizScore}%
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
