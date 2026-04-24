"use client";

import { useState, useEffect } from "react";
import { Search, BookOpen, Edit, Trash2, Users, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { getCoursesAction, type Course } from "@/app/actions/academy";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";
import { useAdminData } from "@/hooks/useAdminData";
import { formatDate } from "@/lib/utils";

export default function AcademyAdminPage() {
    const {
        data: courses,
        loading: isLoading,
        error,
        search: searchQuery,
        setSearch: setSearchQuery,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadCourses
    } = useAdminData<Course>({
        fetchAction: async (opts) => {
            const result = await getCoursesAction(opts.limit || 12, opts.lastDocId);
            return {
                success: result.success,
                data: result.data as any,
                meta: result.meta,
                error: result.error
            };
        },
        limit: 12
    });

    // Note: useAdminData already applies basic local search text filter,
    // but its internal filter looks at generic text fields if we pass search.
    // If we want to ensure instructor and title match purely locally we can still do a manual filter:
    const filteredCourses = courses.filter(course =>
        course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.instructor.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusBadge = (status: string = 'draft') => {
        const styles = {
            published: "bg-green-100 text-green-800",
            draft: "bg-yellow-100 text-yellow-800",
            archived: "bg-slate-100 text-slate-800",
        };
        // Default to draft if status is undefined or unknown
        const statusKey = (status in styles) ? status : 'draft';

        return (
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[statusKey as keyof typeof styles]}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };



    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Academy Management</h1>
                        <p className="text-slate-600 mt-1">Create and manage courses, lessons, and quizzes</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin/academy/applications"
                            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg font-medium flex items-center gap-2 transition-colors"
                        >
                            <Users className="w-5 h-5" />
                            Applications
                        </Link>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl shadow-sm p-4 mb-6 flex items-center gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search courses..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </div>
                </div>

                {/* Course List */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white rounded-xl p-6 shadow-sm animate-pulse h-64" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredCourses.map((course) => (
                            <div key={course.id} className="group bg-white rounded-xl shadow-sm hover:shadow-md transition-all border border-slate-100 overflow-hidden flex flex-col">
                                <div className="h-40 bg-slate-100 relative">
                                    {course.thumbnail ? (
                                        <Image src={course.thumbnail} alt={course.title} fill className="object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                                            <BookOpen className="w-12 h-12" />
                                        </div>
                                    )}
                                    <div className="absolute top-4 right-4">
                                        {getStatusBadge(course.level)} {/* Using level as badge for now, or add status to type if needed */}
                                    </div>
                                </div>
                                <div className="p-6 flex-1 flex flex-col">
                                    <h3 className="text-xl font-bold text-slate-900 mb-2 line-clamp-2">
                                        {course.title}
                                    </h3>
                                    <p className="text-slate-600 text-sm mb-4 line-clamp-2 flex-1">
                                        {course.description}
                                    </p>

                                    <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
                                        <span>{course.modules?.length || 0} Modules</span>
                                        <span className="capitalize">{course.level}</span>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                                        <span className="text-sm text-slate-500">
                                            Updated {formatDate(course.updatedAt)}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Link
                                                href={`/admin/academy/${course.id}`}
                                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                                                title="Edit Course"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </Link>
                                            <button className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors" title="Delete Course">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!isLoading && filteredCourses.length === 0 && (
                    <div className="text-center py-12">
                        <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900">No courses found</h3>
                        <p className="text-slate-600 mt-2">Get started by creating your first course.</p>
                    </div>
                )}
                
                {/* Pagination Controls */}
                {filteredCourses.length > 0 && (
                    <div className="flex items-center justify-between mt-8 p-4 border-t border-slate-200">
                        <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={onPrevPage}
                                disabled={pageIndex === 0 || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <button
                                onClick={onNextPage}
                                disabled={!hasMore || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
