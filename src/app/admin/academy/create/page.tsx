"use client";

import { createCourseAction } from "@/app/actions/academy";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Image as ImageIcon, Loader2, Save } from "lucide-react";

export default function CreateCoursePage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        instructor: "",
        category: "export-basics",
        thumbnail: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const result = await createCourseAction({
                title: formData.title,
                description: formData.description,
                instructor: formData.instructor,
                thumbnail: formData.thumbnail,
                level: "beginner",
                duration: "4 weeks",
                modules: [],
                createdAt: undefined as any,
                updatedAt: undefined as any,
            });

            if (result.success && result.id) {
                toast.success("Course created successfully!");
                router.push(`/admin/academy/${result.id}`);
            } else {
                toast.error(result.error || "Failed to create course");
            }
        } catch (error) {
            toast.error("Failed to create course");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="mb-6">
                    <Link
                        href="/admin/academy"
                        className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-2 mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Academy
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Create New Course</h1>
                    <p className="text-slate-600 dark:text-slate-400">Start by filling in the basic details for the course</p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        {/* Title */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                Course Title
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="e.g., Export Documentation Masterclass"
                                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                Description
                            </label>
                            <textarea
                                required
                                rows={4}
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="What will students learn in this course?"
                                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Instructor */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                    Instructor Name
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.instructor}
                                    onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                                    placeholder="e.g., Dr. Kusu"
                                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                    Category
                                </label>
                                <select
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                                >
                                    <option value="export-basics">Export Basics</option>
                                    <option value="compliance">Compliance & Legal</option>
                                    <option value="logistics">Logistics & Shipping</option>
                                    <option value="market-entry">Market Entry Strategies</option>
                                    <option value="finance">Finance & Payment</option>
                                </select>
                            </div>
                        </div>

                        {/* Thumbnail Upload Placeholder */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                Course Thumbnail
                            </label>
                            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-slate-500 hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer">
                                <ImageIcon className="w-10 h-10 mb-2" />
                                <p className="text-sm">Click to upload or drag and drop</p>
                                <p className="text-xs text-slate-400 mt-1">SVG, PNG, JPG or GIF (max. 2MB)</p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-4 flex items-center justify-end gap-4 border-t border-slate-100 dark:border-slate-800">
                            <Link
                                href="/admin/academy"
                                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors"
                            >
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-all shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                Create Course
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
