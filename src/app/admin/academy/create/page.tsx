"use client";

import { createCourseAction } from "@/app/actions/academy";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Image as ImageIcon, Loader2, Save, X } from "lucide-react";
import { useStorage } from "@/hooks/use-storage";
import { ThumbnailImage } from "@/components/ui/ThumbnailImage";
import {
    COURSE_CATEGORIES,
    COURSE_LEVELS,
    DEFAULT_COURSE_CATEGORY,
    DEFAULT_COURSE_LEVEL,
} from "@/lib/academy-course-fields";

export default function CreateCoursePage() {
    const router = useRouter();
    const { uploadFile } = useStorage();
    const [isLoading, setIsLoading] = useState(false);

    /*
     *   THE OWNER: "the thumbnail doesn't show even after videos are added."
     *
     *   IT NEVER COULD. What stood here was labelled, in the source,
     *   "Thumbnail Upload Placeholder": a styled <div> with an icon and the
     *   words "Click to upload or drag and drop", and NO file input, no click
     *   handler and no onChange. It looked exactly like a working drop zone and
     *   was decoration.
     *
     *   So `thumbnail` left this form as "" on every course ever created here,
     *   and the card on /admin/academy drew its placeholder — correctly, having
     *   been given nothing. Adding videos to the course was never going to
     *   change that: the thumbnail is its own field and nothing else writes it.
     *
     *   A real input now, with the local preview shown before the upload
     *   finishes so the admin can see what they picked.
     */
    const [thumbFile, setThumbFile] = useState<File | null>(null);
    const [thumbPreview, setThumbPreview] = useState<string | null>(null);
    const [isUploadingThumb, setIsUploadingThumb] = useState(false);
    /*
     *   #930 — LEVEL AND DURATION ARE ASKED FOR NOW.
     *
     *   They were sent as the literals "beginner" and "4 weeks" from the
     *   payload below, on every course this form has ever created, and the edit
     *   screen collects neither — so nothing on the platform could set them.
     *   Five screens display them, including the CERTIFICATE, which prints
     *   `{course.duration}` on the document a learner shows an employer.
     */
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        instructor: "",
        category: DEFAULT_COURSE_CATEGORY as string,
        tier: "foundation",
        level: DEFAULT_COURSE_LEVEL as string,
        duration: "",
        thumbnail: "",
    });

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);

        try {
            /*
             *   Uploaded HERE rather than on selection: a course the admin
             *   abandons should not leave an orphan asset in storage, and the
             *   preview above is local so nothing is waiting on the network.
             */
            let thumbnailUrl = formData.thumbnail;
            if (thumbFile) {
                setIsUploadingThumb(true);
                try {
                    thumbnailUrl = await uploadFile(
                        thumbFile,
                        `academy/courses/${Date.now()}_${thumbFile.name}`,
                    );
                } finally {
                    setIsUploadingThumb(false);
                }
            }

            const result = await createCourseAction({
                title: formData.title,
                description: formData.description,
                instructor: formData.instructor,
                thumbnail: thumbnailUrl,
                tier: formData.tier,
                level: formData.level,
                duration: formData.duration,
                //   #930 — the answer the select has always collected. The
                //   schema has admitted `category` since the tier fix; this
                //   caller simply never passed it, so every choice an admin
                //   made in that dropdown was dropped on the floor here.
                category: formData.category,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            if (result.success && result.data?.id) {
                toast.success("Course created successfully!");
                router.push(`/admin/academy/${result.data.id}`);
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
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="mb-6">
                    <Link
                        href="/admin/academy"
                        className="text-slate-500 hover:text-slate-900 flex items-center gap-2 mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Academy
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900">Create New Course</h1>
                    <p className="text-slate-600">Start by filling in the basic details for the course</p>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        {/* Title */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Course Title
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="e.g., Export Documentation Masterclass"
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Description
                            </label>
                            <textarea
                                required
                                rows={4}
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="What will students learn in this course?"
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Instructor */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Instructor Name
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.instructor}
                                    onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                                    placeholder="e.g., Dr. Kusu"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Category
                                </label>
                                <select
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                                >
                                    {COURSE_CATEGORIES.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Course Tier */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Course Tier Access
                                </label>
                                <select
                                    value={formData.tier}
                                    onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                                >
                                    <option value="foundation">Foundation</option>
                                    <option value="standard">Standard</option>
                                    <option value="elite">Elite</option>
                                </select>
                            </div>

                            {/*
                              *   #930 — LEVEL. The catalogue's own filter reads it,
                              *   so a course whose level is wrong is a course that
                              *   filter can never find.
                              */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Level
                                </label>
                                <select
                                    value={formData.level}
                                    onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                                >
                                    {COURSE_LEVELS.map((l) => (
                                        <option key={l} value={l} className="capitalize">{l}</option>
                                    ))}
                                </select>
                            </div>

                            {/*
                              *   #930 — DURATION, and `required` because the schema
                              *   requires it: a course stored without one is what
                              *   this finding is about. It is printed on the
                              *   learner's certificate, so the placeholder asks for
                              *   the real length rather than suggesting a default.
                              */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Duration
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.duration}
                                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                                    placeholder="e.g., 6 weeks"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                    Shown in the catalogue and printed on the learner&apos;s certificate.
                                </p>
                            </div>
                        </div>

                        {/* Thumbnail Upload Placeholder */}
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Course Thumbnail
                            </label>
                            {thumbPreview ? (
                                <div className="relative w-full h-48 rounded-xl overflow-hidden border border-slate-200">
                                    <ThumbnailImage
                                        src={thumbPreview}
                                        alt="Course thumbnail"
                                        className="object-cover"
                                        fallback={<ImageIcon className="w-10 h-10" />}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setThumbFile(null); setThumbPreview(null); }}
                                        className="absolute top-2 right-2 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full"
                                        aria-label="Remove thumbnail"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <label className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-slate-500 hover:border-primary hover:bg-slate-50 transition cursor-pointer">
                                    <ImageIcon className="w-10 h-10 mb-2" />
                                    <p className="text-sm">Click to upload or drag and drop</p>
                                    <p className="text-xs text-slate-400 mt-1">SVG, PNG, JPG or GIF (max. 2MB)</p>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            setThumbFile(file);
                                            setThumbPreview(URL.createObjectURL(file));
                                        }}
                                    />
                                </label>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-4 flex items-center justify-end gap-4 border-t border-slate-100">
                            <Link
                                href="/admin/academy"
                                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg font-medium transition-colors"
                            >
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-all shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isLoading || isUploadingThumb ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                Create Course
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
