"use client";

import { useState, useEffect } from "react";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, GripVertical, Trash2, Edit2, PlayCircle, FileText, HelpCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { getCourseByIdAction, updateCourseAction, updateCourseModulesAction, type Course, type CourseModule, type Lesson, type Quiz } from "@/app/actions/academy";
import { toast } from "sonner";


// Local interface for UI state
interface LessonWithState extends Lesson {
    type?: 'video' | 'text' | 'quiz';
}

interface CourseModuleWithState extends Omit<CourseModule, 'lessons'> {
    isExpanded?: boolean;
    lessons: LessonWithState[];
}

export default function CourseManagerPage() {
    const params = useParams();
    const router = useRouter();
    const courseId = params.courseId as string;

    const [isLoading, setIsLoading] = useState(true);
    const [course, setCourse] = useState<Course | null>(null);
    const [modules, setModules] = useState<CourseModuleWithState[]>([]);

    useEffect(() => {
        loadCourse();
    }, [courseId]);

    async function loadCourse() {
        try {
            const data = await getCourseByIdAction(courseId);
            if (data) {
                setCourse(data);
                // Cast the modules to include the optional UI state properties
                setModules((data.modules || []) as CourseModuleWithState[]);
            } else {
                toast.error("Course not found");
                router.push("/admin/academy");
            }
        } catch (error) {
            toast.error("Failed to load course");
        } finally {
            setIsLoading(false);
        }
    }

    const toggleModule = (moduleId: string) => {
        setModules(modules.map(m =>
            m.id === moduleId ? { ...m, isExpanded: !m.isExpanded } : m
        ));
    };

    const handleAddModule = () => {
        const title = prompt("Enter Module Title:");
        if (!title) return;

        const newModule: CourseModule = {
            id: `m-${Date.now()}`,
            title,
            description: "",
            lessons: [],
            order: modules.length,
        };
        const newModules = [...modules, newModule];
        setModules(newModules);
        saveModules(newModules);
    };

    const handleAddLesson = (moduleId: string) => {
        const title = prompt("Enter Lesson Title:");
        if (!title) return;

        const newModules = modules.map(m => {
            if (m.id === moduleId) {
                return {
                    ...m,
                    lessons: [...m.lessons, {
                        id: `l-${Date.now()}`,
                        title,
                        content: "",
                        duration: "00:00",
                        order: m.lessons.length
                    }]
                };
            }
            return m;
        });
        setModules(newModules);
        saveModules(newModules);
    };

    const handleDeleteModule = (moduleId: string) => {
        if (!confirm("Delete this module and all its lessons?")) return;
        const newModules = modules.filter(m => m.id !== moduleId);
        setModules(newModules);
        saveModules(newModules);
    };

    const handleDeleteLesson = (moduleId: string, lessonId: string) => {
        if (!confirm("Delete this lesson?")) return;
        const newModules = modules.map(m => {
            if (m.id === moduleId) {
                return { ...m, lessons: m.lessons.filter(l => l.id !== lessonId) };
            }
            return m;
        });
        setModules(newModules);
        saveModules(newModules);
    };

    const saveModules = async (updatedModules: CourseModuleWithState[]) => {
        // Remove UI state before saving
        const modulesToSave = updatedModules.map(({ isExpanded, lessons, ...m }) => ({
            ...m,
            lessons: lessons.map(({ type, ...l }) => l)
        }));

        const result = await updateCourseModulesAction(courseId, modulesToSave);
        if (result.success) {
            toast.success("Changes saved");
        } else {
            toast.error("Failed to save changes");
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "video": return <PlayCircle className="w-4 h-4 text-blue-500" />;
            case "text": return <FileText className="w-4 h-4 text-orange-500" />;
            case "quiz": return <HelpCircle className="w-4 h-4 text-purple-500" />;
            default: return <FileText className="w-4 h-4" />;
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!course) return null;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/admin/academy"
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{course.title}</h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Course Content Manager</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href={`/admin/academy/${courseId}/edit`}
                            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                        >
                            Edit Details
                        </Link>
                        <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium shadow-lg shadow-primary/20 flex items-center gap-2 transition">
                            <Save className="w-4 h-4" />
                            Save Changes
                        </button>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Add Module Button */}
                    <button
                        onClick={handleAddModule}
                        className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 hover:border-primary hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800/50 transition flex items-center justify-center gap-2 font-medium"
                    >
                        <Plus className="w-5 h-5" />
                        Add New Module
                    </button>

                    {/* Modules List */}
                    {modules.map((module, index) => (
                        <div key={module.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                            {/* Module Header */}
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <GripVertical className="w-5 h-5 text-slate-400 cursor-move" />
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{module.title}</h3>
                                    <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs text-slate-600 dark:text-slate-400 font-semibold">
                                        {module.lessons.length} lessons
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleDeleteModule(module.id)} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 rounded-lg transition">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => toggleModule(module.id)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition text-sm font-medium">
                                        {module.isExpanded ? "Collapse" : "Expand"}
                                    </button>
                                </div>
                            </div>

                            {/* Lessons List */}
                            {/* @ts-ignore - Local UI state */}
                            {module.isExpanded !== false && (
                                <div className="p-2 space-y-2">
                                    {module.lessons.map((lesson, lIndex) => (
                                        <div key={lesson.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition rounded-lg group">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                                    {getIcon("video")}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-slate-900 dark:text-white text-sm">{lesson.title}</p>
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <span>{lesson.duration}</span>
                                                    </div>
                                                </div>
                                            </div>


                                            <div className="hidden group-hover:flex items-center gap-2">
                                                <button className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 rounded-lg transition" title="Edit Content">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                {lesson.type === "quiz" && (
                                                    <Link href={`/admin/academy/${courseId}/quiz/${lesson.id}`} className="p-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600 rounded-lg transition" title="Edit Quiz">
                                                        <HelpCircle className="w-4 h-4" />
                                                    </Link>
                                                )}
                                                <button onClick={() => handleDeleteLesson(module.id, lesson.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 rounded-lg transition" title="Delete">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => handleAddLesson(module.id)}
                                        className="w-full py-2 flex items-center justify-center gap-2 text-sm text-primary hover:bg-primary/5 rounded-lg transition dashed-border"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Lesson to {module.title}
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
