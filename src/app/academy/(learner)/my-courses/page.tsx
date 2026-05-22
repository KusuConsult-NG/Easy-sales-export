"use client";

import { useState, useEffect } from "react";
import { BookOpen, Clock, CheckCircle, Play, Award, Loader2 } from "lucide-react";
import Link from "next/link";
import BackButton from "@/components/ui/BackButton";
import { getEnrolledCoursesWithDetailsAction, type EnrolledCourseWithDetails } from "@/app/actions/academy";

export default function MyCoursesPage() {
    const [courses, setCourses] = useState<EnrolledCourseWithDetails[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getEnrolledCoursesWithDetailsAction()
            .then((result) => {
                if (result.success) setCourses((result.data?.courses as EnrolledCourseWithDetails[]) ?? []);
            })
            .finally(() => setLoading(false));
    }, []);

    const inProgressCourses = courses.filter((c) => c.status === "in-progress");
    const completedCourses = courses.filter((c) => c.status === "completed");

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <BackButton fallbackPath="/academy/dashboard" />
                <h1 className="text-3xl font-bold text-slate-900 mb-2">My Courses</h1>
                <p className="text-slate-600">Continue learning and track your progress</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl p-6 border border-slate-200">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <BookOpen className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-600">Enrolled Courses</p>
                            <p className="text-2xl font-bold text-slate-900">{courses.length}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl p-6 border border-slate-200">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-600">Completed</p>
                            <p className="text-2xl font-bold text-slate-900">{completedCourses.length}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl p-6 border border-slate-200">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Clock className="w-6 h-6 text-orange-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-600">In Progress</p>
                            <p className="text-2xl font-bold text-slate-900">{inProgressCourses.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* In Progress Courses */}
            {inProgressCourses.length > 0 && (
                <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Continue Learning</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {inProgressCourses.map((course) => (
                            <div
                                key={course.courseId}
                                className="bg-white rounded-xl overflow-hidden border border-slate-200 hover:shadow-lg transition-shadow"
                            >
                                {/* Thumbnail */}
                                <div className="h-40 bg-linear-to-br from-blue-500/20 to-indigo-500/20 relative flex items-center justify-center">
                                    <BookOpen className="w-16 h-16 text-blue-300" />
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    <h3 className="text-lg font-bold text-slate-900 mb-1">{course.title}</h3>
                                    <p className="text-sm text-slate-600 mb-4">{course.instructor}</p>

                                    {/* Progress Bar */}
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-slate-900">
                                                {course.progress}% Complete
                                            </span>
                                            <span className="text-xs text-slate-500">
                                                {course.completedLessons}/{course.totalLessons} lessons
                                            </span>
                                        </div>
                                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-600 rounded-full transition-all"
                                                style={{ width: `${course.progress}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Clock className="w-4 h-4" />
                                            <span>Started {course.startedAt}</span>
                                        </div>
                                        <Link
                                            href={`/academy/${course.courseId}`}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
                                        >
                                            <Play className="w-4 h-4" />
                                            Continue
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Completed Courses */}
            {completedCourses.length > 0 && (
                <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Award className="w-5 h-5 text-yellow-500" />
                        Completed Courses
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {completedCourses.map((course) => (
                            <div
                                key={course.courseId}
                                className="bg-white rounded-xl overflow-hidden border border-green-200 relative"
                            >
                                {/* Completed Badge */}
                                <div className="absolute top-4 right-4 z-10">
                                    <div className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3" />
                                        Completed
                                    </div>
                                </div>

                                {/* Thumbnail */}
                                <div className="h-32 bg-linear-to-br from-green-500 to-emerald-600 relative flex items-center justify-center">
                                    <Award className="w-12 h-12 text-white/30" />
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    <h3 className="text-lg font-bold text-slate-900 mb-1">{course.title}</h3>
                                    <p className="text-sm text-slate-600 mb-4">{course.instructor}</p>

                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-green-600 font-semibold">
                                            Certificate earned!
                                        </div>
                                        <Link
                                            href={`/academy/certificate/${course.courseId}`}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition"
                                        >
                                            <Award className="w-4 h-4" />
                                            View Certificate
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {courses.length === 0 && (
                <div className="bg-white rounded-xl p-12 text-center border border-slate-200">
                    <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No Courses Enrolled Yet</h3>
                    <p className="text-slate-600 mb-6">
                        Start your learning journey by browsing our course catalog
                    </p>
                    <Link
                        href="/academy/courses"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                    >
                        <BookOpen className="w-5 h-5" />
                        Browse Courses
                    </Link>
                </div>
            )}
        </div>
    );
}
