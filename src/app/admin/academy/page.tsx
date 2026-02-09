"use client";

import { useState, useEffect } from "react";
import { Plus, Search, BookOpen, Edit, Trash2 } from "lucide-react";
import Link from "next/link";
import { getCoursesAction, type Course } from "@/app/actions/academy";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";

export default function AcademyAdminPage() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        loadCourses();
    }, []);

    async function loadCourses() {
        setIsLoading(true);
        const result = await getCoursesAction();
        if (result) {
            setCourses(result);
        } else {
            toast.error("Failed to load courses");
        }
        setIsLoading(false);
    }

    const filteredCourses = courses.filter(course =>
        course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.instructor.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusBadge = (status: string = 'draft') => {
        const styles = {
            published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
            draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
            archived: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400",
        };
        // Default to draft if status is undefined or unknown
        const statusKey = (status in styles) ? status : 'draft';

        return (
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[statusKey as keyof typeof styles]}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    // Helper to format date safely
    const formatDate = (date: Timestamp | Date | any) => {
        if (!date) return 'N/A';
        // Handle Firestore Timestamp
        if (date.seconds) {
            return new Date(date.seconds * 1000).toLocaleDateString();
        }
        // Handle Date object or string
        return new Date(date).toLocaleDateString();
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Academy Management</h1>
                        <p className="text-slate-600 dark:text-slate-400 mt-1">Create and manage courses, lessons, and quizzes</p>
                    </div>
                    <Link
                        href="/admin/academy/create"
                        className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                    >
                        <Plus className="w-5 h-5" />
                        Create New Course
                    </Link>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 mb-6 flex items-center gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search courses..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </div>
                </div>

                {/* Course List */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white dark:bg-slate-900 rounded-xl p-6 shadow-sm animate-pulse h-64" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredCourses.map((course) => (
                            <div key={course.id} className="group bg-white dark:bg-slate-900 rounded-xl shadow-sm hover:shadow-md transition-all border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col">
                                <div className="h-40 bg-slate-100 dark:bg-slate-800 relative">
                                    {course.thumbnail ? (
                                        <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                                            <BookOpen className="w-12 h-12" />
                                        </div>
                                    )}
                                    <div className="absolute top-4 right-4">
                                        {getStatusBadge(course.level)} {/* Using level as badge for now, or add status to type if needed */}
                                    </div>
                                </div>
                                <div className="p-6 flex-1 flex flex-col">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 line-clamp-2">
                                        {course.title}
                                    </h3>
                                    <p className="text-slate-600 dark:text-slate-400 text-sm mb-4 line-clamp-2 flex-1">
                                        {course.description}
                                    </p>

                                    <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-500 mb-4">
                                        <span>{course.modules?.length || 0} Modules</span>
                                        <span className="capitalize">{course.level}</span>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                        <span className="text-sm text-slate-500">
                                            Updated {formatDate(course.updatedAt)}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Link
                                                href={`/admin/academy/${course.id}`}
                                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 transition-colors"
                                                title="Edit Course"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </Link>
                                            <button className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-600 transition-colors" title="Delete Course">
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
                        <BookOpen className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">No courses found</h3>
                        <p className="text-slate-600 dark:text-slate-400 mt-2">Get started by creating your first course.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
