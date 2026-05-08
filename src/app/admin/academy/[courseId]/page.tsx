"use client";

import { useState, useEffect } from "react";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Plus, GripVertical, FileText, PlayCircle, HelpCircle, Upload, Save, Edit2, Loader2, ArrowLeft, Settings, UploadCloud, FileSpreadsheet, Eye, X, ExternalLink } from "lucide-react";
import { getCourseByIdAction, updateCourseAction, updateCourseModulesAction, type Course, type CourseModule, type Lesson, type Quiz } from "@/app/actions/academy";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import { uploadFile, type UploadProgress } from "@/lib/storage-upload";
import MasterUploader from "@/components/shared/MasterUploader";


// Local interface for UI state
interface LessonWithState extends Lesson {
    type?: 'video' | 'text' | 'quiz' | 'excel';
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

    const [editingLesson, setEditingLesson] = useState<{ moduleId: string; lesson: LessonWithState } | null>(null);
    const [editingModule, setEditingModule] = useState<CourseModuleWithState | null>(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isCourseSettingsOpen, setIsCourseSettingsOpen] = useState(false);
    const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
    const [previewLesson, setPreviewLesson] = useState<LessonWithState | null>(null);
    const [newModuleForm, setNewModuleForm] = useState<{
        title: string;
        description: string;
        contentType: 'video' | 'document' | 'excel';
        videoUrl?: string;
        documentUrl?: string;
        excelUrl?: string;
    }>({
        title: '',
        description: '',
        contentType: 'video',
    });
    const [courseDetailsForm, setCourseDetailsForm] = useState<{
        title: string;
        description: string;
        instructor: string;
        tier: "foundation" | "standard" | "elite";
    }>({
        title: "",
        description: "",
        instructor: "",
        tier: "foundation",
    });
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [uploadContext, setUploadContext] = useState<'lesson' | 'newModule'>('lesson');

    useEffect(() => {
        loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseId]);

    async function loadCourse() {
        try {
            const dataReq = await getCourseByIdAction(courseId);
            if (dataReq.success && dataReq.data) {
                const data = dataReq.data;
                setCourse(data);
                // Cast the modules to include the optional UI state properties
                const processedModules = (data.modules || []).map((m: CourseModule) => ({ ...m, isExpanded: false })) as CourseModuleWithState[];
                setModules(processedModules.sort((a, b) => a.order - b.order));
                setCourseDetailsForm({
                    title: data.title || "",
                    description: data.description || "",
                    instructor: data.instructor || "",
                    tier: (data.tier as "foundation" | "standard" | "elite") || "foundation"
                });
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

    function handleAddModule() {
        setNewModuleForm({ title: '', description: '', contentType: 'video' });
        setUploadContext('newModule');
        setIsAddModuleOpen(true);
    };

    async function handleCreateModule() {
        if (!newModuleForm.title.trim()) {
            toast.error("Please enter a module title.");
            return;
        }
        const firstLessonId = `l-${Date.now()}`;
        const newModule: CourseModuleWithState = {
            id: `m-${Date.now()}`,
            title: newModuleForm.title.trim(),
            description: newModuleForm.description,
            lessons: newModuleForm.videoUrl || newModuleForm.documentUrl || newModuleForm.excelUrl ? [{
                id: firstLessonId,
                title: `${newModuleForm.title} — Lesson 1`,
                content: newModuleForm.documentUrl || newModuleForm.excelUrl || '',
                duration: '00:00',
                order: 0,
                type: newModuleForm.contentType === 'video' ? 'video' : newModuleForm.contentType === 'excel' ? 'excel' : 'text',
                ...(newModuleForm.videoUrl && { videoUrl: newModuleForm.videoUrl }),
                ...(newModuleForm.documentUrl && { documentUrl: newModuleForm.documentUrl }),
                ...(newModuleForm.excelUrl && { excelUrl: newModuleForm.excelUrl }),
            } as LessonWithState] : [],
            order: modules.length,
            isExpanded: true,
        };
        const newModules = [...modules, newModule];
        setModules(newModules);
        await saveModules(newModules, true);
        setIsAddModuleOpen(false);
        setUploadContext('lesson');
        toast.success(`Module "${newModule.title}" created successfully.`);
    };

    function handleAddLesson(moduleId: string) {
        const newModules = modules.map(m => {
            if (m.id === moduleId) {
                return {
                    ...m,
                    lessons: [...m.lessons, {
                        id: `l-${Date.now()}`,
                        title: "New Lesson (Click Edit to Rename)",
                        content: "",
                        duration: "00:00",
                        order: m.lessons.length
                    }]
                };
            }
            return m;
        });
        setModules(newModules);
        saveModules(newModules, true); // silent — toast shown below
        toast.success("Lesson added. Click the edit icon to set its content.");
    };

    function handleDeleteModule(moduleId: string) {
        toast("Delete this module and all its lessons?", {
            action: {
                label: "Delete",
                onClick: () => {
                    const newModules = modules.filter(m => m.id !== moduleId);
                    setModules(newModules);
                    saveModules(newModules, true);
                    toast.success("Module deleted.");
                }
            },
            cancel: { label: "Cancel", onClick: () => {} }
        });
    };

    function handleDeleteLesson(moduleId: string, lessonId: string) {
        toast("Delete this lesson?", {
            action: {
                label: "Delete",
                onClick: () => {
                    const newModules = modules.map(m => {
                        if (m.id === moduleId) {
                            return { ...m, lessons: m.lessons.filter(l => l.id !== lessonId) };
                        }
                        return m;
                    });
                    setModules(newModules);
                    saveModules(newModules, true);
                    toast.success("Lesson deleted.");
                }
            },
            cancel: { label: "Cancel", onClick: () => {} }
        });
    };

    function handleEditLesson(moduleId: string, lesson: LessonWithState) {
        setEditingLesson({ moduleId, lesson: { ...lesson } });
        setIsUploadModalOpen(true);
    };

    async function handleSaveLessonEdit() {
        if (!editingLesson) return;
        const newModules = modules.map(m => {
            if (m.id === editingLesson.moduleId) {
                return {
                    ...m,
                    lessons: m.lessons.map(l => l.id === editingLesson.lesson.id ? editingLesson.lesson : l)
                };
            }
            return m;
        });
        setModules(newModules);
        await saveModules(newModules);
        setIsUploadModalOpen(false);
        setEditingLesson(null);
    };

    async function handleSaveModuleEdit() {
        if (!editingModule) return;
        const newModules = modules.map(m => m.id === editingModule.id ? editingModule : m);
        setModules(newModules);
        await saveModules(newModules, true);
        setEditingModule(null);
        toast.success("Module updated.");
    }

    async function handleSaveCourseDetails() {
        if (!course) return;
        setIsLoading(true);
        try {
            const result = await updateCourseAction(courseId, courseDetailsForm);
            if (result.success) {
                setCourse({ ...course, ...courseDetailsForm });
                setIsCourseSettingsOpen(false);
                toast.success("Course details updated successfully");
            } else {
                toast.error(result.error || "Failed to update course details");
            }
        } catch (error) {
            toast.error("An error occurred while updating course details");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'video' | 'document' | 'excel') {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const path = `academy/courses/${courseId}/materials/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const url = await uploadFile(file, path, (progress) => {
                setUploadProgress(progress);
            });

            if (uploadContext === 'newModule') {
                // Uploading for the Add Module modal
                setNewModuleForm(prev => ({
                    ...prev,
                    ...(type === 'video' ? { videoUrl: url } : type === 'excel' ? { excelUrl: url } : { documentUrl: url }),
                }));
            } else if (editingLesson) {
                // Uploading for an existing lesson
                setEditingLesson(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        lesson: {
                            ...prev.lesson,
                            ...(type === 'video' ? { videoUrl: url } : type === 'excel' ? { excelUrl: url, content: url } : { documentUrl: url, content: url })
                        }
                    };
                });
            }
            toast.success(`${type === 'video' ? 'Video' : type === 'excel' ? 'Excel File' : 'Document'} uploaded successfully`);
        } catch (error: any) {
            toast.error(`Failed to upload ${type}: ${error.message}`);
        } finally {
            setUploadProgress(null);
        }
    };

    const saveModules = async (updatedModules: CourseModuleWithState[], silent = false) => {
        try {
            // Remove UI state and undefined fields before saving
            // Next.js Server Actions crash if objects contain 'undefined'
            const modulesToSave = updatedModules.map(({ isExpanded, lessons, quiz, ...m }) => ({
                ...m,
                ...(quiz ? { quiz } : {}),
                lessons: lessons.map(({ type, videoUrl, documentUrl, excelUrl, ...l }) => ({
                    ...l,
                    ...(videoUrl ? { videoUrl } : {}),
                    ...(documentUrl ? { documentUrl } : {}),
                    ...(excelUrl ? { excelUrl } : {})
                }))
            }));

            const result = await updateCourseModulesAction(courseId, modulesToSave);
            if (result.success) {
                if (!silent) toast.success("Changes saved");
            } else {
                toast.error(result.error || "Failed to save changes");
            }
        } catch (error: any) {
            console.error("Failed to save modules:", error);
            toast.error("An error occurred while saving modules");
        }
    };


    const getIcon = (type: string) => {
        switch (type) {
            case "video": return <PlayCircle className="w-4 h-4 text-blue-500" />;
            case "text": return <FileText className="w-4 h-4 text-orange-500" />;
            case "quiz": return <HelpCircle className="w-4 h-4 text-purple-500" />;
            case "excel": return <FileSpreadsheet className="w-4 h-4 text-green-500" />;
            default: return <FileText className="w-4 h-4" />;
        }
    };

    const detectLessonType = (lesson: LessonWithState): string => {
        if (lesson.videoUrl) return 'video';
        if (lesson.excelUrl) return 'excel';
        if (lesson.documentUrl) return 'text';
        if (lesson.type) return lesson.type;
        return 'text';
    };

    const getLessonPreviewUrl = (lesson: LessonWithState): string | null => {
        return lesson.videoUrl || lesson.documentUrl || lesson.excelUrl || null;
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!course) return null;

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/admin/academy"
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">{course.title}</h1>
                            <p className="text-sm text-slate-500">Course Content Manager</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsCourseSettingsOpen(true)}
                            className="px-4 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition flex items-center gap-2"
                        >
                            <Settings className="w-4 h-4" />
                            Edit Details
                        </button>
                        <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium shadow-lg shadow-primary/20 flex items-center gap-2 transition" onClick={() => toast.success("All changes automatically saved!")}>
                            <Save className="w-4 h-4" />
                            Saved
                        </button>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Add Module Button */}
                    <button
                        onClick={handleAddModule}
                        className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-primary hover:text-primary hover:bg-slate-50 transition flex items-center justify-center gap-2 font-medium"
                    >
                        <Plus className="w-5 h-5" />
                        Add New Module
                    </button>

                    {/* Modules List */}
                    {modules.map((module, index) => (
                        <div key={module.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            {/* Module Header */}
                            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <GripVertical className="w-5 h-5 text-slate-400 cursor-move" />
                                    <h3 className="font-bold text-slate-800">{module.title}</h3>
                                    <span className="px-2 py-0.5 bg-slate-200 rounded text-xs text-slate-600 font-semibold">
                                        {module.lessons.length} lessons
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setEditingModule(module)} className="p-2 hover:bg-blue-100 text-blue-500 rounded-lg transition" title="Edit Module Name">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDeleteModule(module.id)} className="p-2 hover:bg-red-100 text-red-500 rounded-lg transition" title="Delete Module">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => toggleModule(module.id)} className="p-2 hover:bg-slate-200 rounded-lg transition text-sm font-medium">
                                        {module.isExpanded ? "Collapse" : "Expand"}
                                    </button>
                                </div>
                            </div>

                            {/* Lessons List */}
                            {module.isExpanded !== false && (
                                <div className="p-2 space-y-2">
                                    {module.lessons.map((lesson, lIndex) => (
                                        <div key={lesson.id} className="flex items-center justify-between p-3 hover:bg-slate-50 transition rounded-lg group">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                                                    {getIcon(detectLessonType(lesson))}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-medium text-slate-900 text-sm truncate">{lesson.title}</p>
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <span className="capitalize">{detectLessonType(lesson)}</span>
                                                        <span>·</span>
                                                        <span>{lesson.duration}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                                {getLessonPreviewUrl(lesson) && (
                                                    <button onClick={() => setPreviewLesson(lesson)} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition" title="Preview">
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button onClick={() => handleEditLesson(module.id, lesson)} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition" title="Edit Content">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                {lesson.type === "quiz" && (
                                                    <Link href={`/admin/academy/${courseId}/quiz/${lesson.id}`} className="p-2 hover:bg-purple-50 text-purple-600 rounded-lg transition" title="Edit Quiz">
                                                        <HelpCircle className="w-4 h-4" />
                                                    </Link>
                                                )}
                                                <button onClick={() => handleDeleteLesson(module.id, lesson.id)} className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition" title="Delete">
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

                {/* Add New Module Modal */}
                <Modal
                    isOpen={isAddModuleOpen}
                    onClose={() => setIsAddModuleOpen(false)}
                    title="Add New Module"
                    maxWidth="lg"
                >
                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Module Title <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                placeholder="e.g., Introduction to Export Basics"
                                value={newModuleForm.title}
                                onChange={(e) => setNewModuleForm({ ...newModuleForm, title: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                            <textarea
                                placeholder="Brief overview of what this module covers..."
                                value={newModuleForm.description}
                                onChange={(e) => setNewModuleForm({ ...newModuleForm, description: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg h-20 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                        </div>

                        {/* Content Type Selector */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Content Type for First Lesson</label>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setNewModuleForm({ ...newModuleForm, contentType: 'video', documentUrl: undefined })}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium text-sm transition ${newModuleForm.contentType === 'video' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                >
                                    <PlayCircle className="w-5 h-5" />
                                    Video Lesson
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNewModuleForm({ ...newModuleForm, contentType: 'document', videoUrl: undefined, excelUrl: undefined })}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium text-sm transition ${newModuleForm.contentType === 'document' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                >
                                    <FileText className="w-5 h-5" />
                                    Document / PDF
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNewModuleForm({ ...newModuleForm, contentType: 'excel', videoUrl: undefined, documentUrl: undefined })}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium text-sm transition ${newModuleForm.contentType === 'excel' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                >
                                    <FileSpreadsheet className="w-5 h-5" />
                                    Excel File
                                </button>
                            </div>
                        </div>

                        {/* Master Uploader Integration */}
                        <div className="border rounded-xl p-4 bg-slate-50">
                            <MasterUploader 
                                label={newModuleForm.contentType === 'video' ? 'Course Video' : newModuleForm.contentType === 'excel' ? 'Excel Spreadsheet' : 'PDF Document'}
                                folder="academy/courses"
                                moduleId="academy"
                                accept={newModuleForm.contentType === 'video' ? 'video/*' : newModuleForm.contentType === 'excel' ? '.xlsx,.xls,.csv' : '.pdf,.doc,.docx'}
                                onComplete={(data) => {
                                    setNewModuleForm(prev => ({
                                        ...prev,
                                        ...(newModuleForm.contentType === 'video' ? { videoUrl: data.url } : newModuleForm.contentType === 'excel' ? { excelUrl: data.url } : { documentUrl: data.url }),
                                    }));
                                }}
                                description={`Upload the ${newModuleForm.contentType} content for the first lesson in this module.`}
                            />
                        </div>

                        <div className="pt-2 flex justify-end gap-3 border-t">
                            <button
                                type="button"
                                onClick={() => setIsAddModuleOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateModule}
                                disabled={!!uploadProgress}
                                className="px-6 py-2 bg-primary text-white rounded-lg font-medium shadow shadow-primary/20 hover:bg-primary/90 transition disabled:opacity-50"
                            >
                                Create Module
                            </button>
                        </div>
                    </div>
                </Modal>

                {/* Lesson Edit/Upload Modal */}
                {editingLesson && (
                    <Modal
                        isOpen={isUploadModalOpen}
                        onClose={() => setIsUploadModalOpen(false)}
                        title="Edit Lesson Content"
                        maxWidth="lg"
                    >
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                                <input
                                    type="text"
                                    value={editingLesson.lesson.title}
                                    onChange={(e) => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, title: e.target.value } } : null)}
                                    className="w-full px-4 py-2 border rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Lesson Type</label>
                                <select
                                    value={editingLesson.lesson.type || "video"}
                                    onChange={(e) => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, type: e.target.value as "video" | "text" | "quiz" | "excel" } } : null)}
                                    className="w-full px-4 py-2 border rounded-lg"
                                >
                                    <option value="video">Video Lesson</option>
                                    <option value="text">Text/Document Lesson</option>
                                    <option value="excel">Excel/Spreadsheet Lesson</option>
                                    <option value="quiz">Interactive Quiz</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Duration (e.g., "10:00")</label>
                                <input
                                    type="text"
                                    value={editingLesson.lesson.duration}
                                    onChange={(e) => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, duration: e.target.value } } : null)}
                                    className="w-full px-4 py-2 border rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Content (Text/Description)</label>
                                <textarea
                                    value={editingLesson.lesson.content}
                                    onChange={(e) => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, content: e.target.value } } : null)}
                                    className="w-full px-4 py-2 border rounded-lg h-24"
                                />
                            </div>

                            {/* Master Uploader for Lesson Content */}
                            <div className="p-4 rounded-xl space-y-3 bg-slate-50 border border-slate-200">
                                <MasterUploader 
                                    label="Lesson Content File"
                                    folder="academy/materials"
                                    moduleId="academy"
                                    accept={editingLesson.lesson.type === 'video' ? 'video/*' : editingLesson.lesson.type === 'excel' ? '.xlsx,.xls,.csv' : '.pdf,.doc,.docx'}
                                    onComplete={(data) => {
                                        setEditingLesson(prev => {
                                            if (!prev) return prev;
                                            return {
                                                ...prev,
                                                lesson: {
                                                    ...prev.lesson,
                                                    ...(editingLesson.lesson.type === 'video' ? { videoUrl: data.url } : editingLesson.lesson.type === 'excel' ? { excelUrl: data.url, content: data.url } : { documentUrl: data.url, content: data.url })
                                                }
                                            };
                                        });
                                    }}
                                    description={`Upload the file content for this ${editingLesson.lesson.type || 'lesson'}.`}
                                />
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    onClick={() => setIsUploadModalOpen(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveLessonEdit}
                                    disabled={!!uploadProgress && uploadProgress.status === 'uploading'}
                                    className="px-6 py-2 bg-primary text-white rounded-lg font-medium shadow shadow-primary/20 hover:bg-primary/90 transition disabled:opacity-50"
                                >
                                    Save Lesson
                                </button>
                            </div>
                        </div>
                    </Modal>
                )}

                {/* Module Edit Modal */}
                {editingModule && (
                    <Modal
                        isOpen={!!editingModule}
                        onClose={() => setEditingModule(null)}
                        title="Edit Module Details"
                        maxWidth="md"
                    >
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Module Title</label>
                                <input
                                    type="text"
                                    value={editingModule.title}
                                    onChange={(e) => setEditingModule({ ...editingModule, title: e.target.value })}
                                    className="w-full px-4 py-2 border rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                                <textarea
                                    value={editingModule.description || ""}
                                    onChange={(e) => setEditingModule({ ...editingModule, description: e.target.value })}
                                    className="w-full px-4 py-2 border rounded-lg h-24"
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    onClick={() => setEditingModule(null)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveModuleEdit}
                                    className="px-6 py-2 bg-primary text-white rounded-lg font-medium shadow shadow-primary/20 hover:bg-primary/90 transition"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </Modal>
                )}

                {/* Course Settings Modal */}
                <Modal
                    isOpen={isCourseSettingsOpen}
                    onClose={() => setIsCourseSettingsOpen(false)}
                    title="Edit Course Details"
                    maxWidth="md"
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Course Title</label>
                            <input
                                type="text"
                                value={courseDetailsForm.title}
                                onChange={(e) => setCourseDetailsForm({ ...courseDetailsForm, title: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Instructor</label>
                            <input
                                type="text"
                                value={courseDetailsForm.instructor}
                                onChange={(e) => setCourseDetailsForm({ ...courseDetailsForm, instructor: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                            <textarea
                                value={courseDetailsForm.description}
                                onChange={(e) => setCourseDetailsForm({ ...courseDetailsForm, description: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg h-24"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Tier Access</label>
                            <select
                                value={courseDetailsForm.tier}
                                onChange={(e) => setCourseDetailsForm({ ...courseDetailsForm, tier: e.target.value as "foundation" | "standard" | "elite" })}
                                className="w-full px-4 py-2 border rounded-lg"
                            >
                                <option value="foundation">Foundation</option>
                                <option value="standard">Standard</option>
                                <option value="elite">Elite</option>
                            </select>
                        </div>
                        <div className="pt-4 flex justify-end gap-3 border-t">
                            <button
                                onClick={() => setIsCourseSettingsOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveCourseDetails}
                                disabled={isLoading}
                                className="px-6 py-2 bg-primary text-white rounded-lg font-medium shadow shadow-primary/20 hover:bg-primary/90 transition flex items-center gap-2"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Details"}
                            </button>
                        </div>
                    </div>
                </Modal>

                {/* Fullscreen Content Preview */}
                {previewLesson && (
                    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 bg-black/80 border-b border-white/10">
                            <div className="min-w-0">
                                <h3 className="text-white font-bold text-lg truncate">{previewLesson.title}</h3>
                                <p className="text-white/60 text-sm capitalize">{detectLessonType(previewLesson)} preview</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                {getLessonPreviewUrl(previewLesson) && (
                                    <a
                                        href={getLessonPreviewUrl(previewLesson)!}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        Download
                                    </a>
                                )}
                                <button
                                    onClick={() => setPreviewLesson(null)}
                                    className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
                            {/* Video */}
                            {previewLesson.videoUrl && (
                                <video
                                    src={previewLesson.videoUrl}
                                    controls
                                    autoPlay={false}
                                    className="max-w-full max-h-full rounded-xl"
                                    style={{ maxHeight: 'calc(100vh - 100px)' }}
                                >
                                    Your browser does not support video playback.
                                </video>
                            )}

                            {/* PDF — direct embed */}
                            {previewLesson.documentUrl && previewLesson.documentUrl.match(/\.pdf/i) && (
                                <iframe
                                    src={previewLesson.documentUrl}
                                    className="w-full max-w-5xl rounded-xl bg-white"
                                    style={{ height: 'calc(100vh - 100px)' }}
                                    title={previewLesson.title}
                                />
                            )}

                            {/* DOCX — Google Docs Viewer */}
                            {previewLesson.documentUrl && !previewLesson.documentUrl.match(/\.pdf/i) && (
                                <iframe
                                    src={`https://docs.google.com/gview?url=${encodeURIComponent(previewLesson.documentUrl)}&embedded=true`}
                                    className="w-full max-w-5xl rounded-xl bg-white"
                                    style={{ height: 'calc(100vh - 100px)' }}
                                    title={previewLesson.title}
                                />
                            )}

                            {/* Excel — Google Docs Viewer */}
                            {previewLesson.excelUrl && (
                                <iframe
                                    src={`https://docs.google.com/gview?url=${encodeURIComponent(previewLesson.excelUrl)}&embedded=true`}
                                    className="w-full max-w-5xl rounded-xl bg-white"
                                    style={{ height: 'calc(100vh - 100px)' }}
                                    title={previewLesson.title}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
