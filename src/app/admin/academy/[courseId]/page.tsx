"use client";

import { useState, useEffect } from "react";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Plus, GripVertical, FileText, PlayCircle, HelpCircle, Upload, Save, Edit2, Loader2, ArrowLeft, Settings, UploadCloud, FileSpreadsheet } from "lucide-react";
import { getCourseByIdAction, updateCourseAction, updateCourseModulesAction, type Course, type CourseModule, type Lesson, type Quiz } from "@/app/actions/academy";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import { uploadFile, type UploadProgress } from "@/lib/storage-upload";


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
                const processedModules = (data.modules || []).map(m => ({ ...m, isExpanded: false })) as CourseModuleWithState[];
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
        // Remove UI state before saving
        const modulesToSave = updatedModules.map(({ isExpanded, lessons, ...m }) => ({
            ...m,
            lessons: lessons.map(({ type, ...l }) => l)
        }));

        const result = await updateCourseModulesAction(courseId, modulesToSave);
        if (result.success) {
            if (!silent) toast.success("Changes saved");
        } else {
            toast.error("Failed to save changes");
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
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-slate-100 rounded-lg">
                                                    {getIcon("video")}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-slate-900 text-sm">{lesson.title}</p>
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <span>{lesson.duration}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="hidden group-hover:flex items-center gap-2">
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

                        {/* Upload Field */}
                        <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50 space-y-3">
                            <p className="text-sm font-semibold text-slate-700">
                                {newModuleForm.contentType === 'video' ? 'Upload Video' : newModuleForm.contentType === 'excel' ? 'Upload Excel File' : 'Upload Document / PDF'}
                                <span className="text-slate-400 font-normal ml-1">(optional — you can add content later)</span>
                            </p>

                            {newModuleForm.contentType === 'video' ? (
                                newModuleForm.videoUrl ? (
                                    <div className="flex items-center justify-between bg-green-50 text-green-700 p-3 rounded-lg border border-green-200">
                                        <span className="text-sm">✓ Video uploaded and ready</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setNewModuleForm(p => ({ ...p, videoUrl: undefined }))}>Remove</button>
                                    </div>
                                ) : (
                                    <>
                                        <input type="file" accept="video/*" onChange={(e) => handleFileUpload(e, 'video')} className="hidden" id="new-module-video-upload" />
                                        <label htmlFor="new-module-video-upload" className="w-full py-2.5 border border-slate-300 rounded-lg text-slate-600 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer text-sm">
                                            <UploadCloud className="w-5 h-5" />
                                            Choose Video File
                                        </label>
                                    </>
                                )
                            ) : newModuleForm.contentType === 'excel' ? (
                                newModuleForm.excelUrl ? (
                                    <div className="flex items-center justify-between bg-green-50 text-green-700 p-3 rounded-lg border border-green-200">
                                        <span className="text-sm">✓ Excel file uploaded and ready</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setNewModuleForm(p => ({ ...p, excelUrl: undefined }))}>Remove</button>
                                    </div>
                                ) : (
                                    <>
                                        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFileUpload(e, 'excel')} className="hidden" id="new-module-excel-upload" />
                                        <label htmlFor="new-module-excel-upload" className="w-full py-2.5 border border-slate-300 rounded-lg text-slate-600 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer text-sm">
                                            <UploadCloud className="w-5 h-5" />
                                            Choose Excel File
                                        </label>
                                    </>
                                )
                            ) : (
                                newModuleForm.documentUrl ? (
                                    <div className="flex items-center justify-between bg-blue-50 text-blue-700 p-3 rounded-lg border border-blue-200">
                                        <span className="text-sm">✓ Document uploaded and ready</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setNewModuleForm(p => ({ ...p, documentUrl: undefined }))}>Remove</button>
                                    </div>
                                ) : (
                                    <>
                                        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => handleFileUpload(e, 'document')} className="hidden" id="new-module-doc-upload" />
                                        <label htmlFor="new-module-doc-upload" className="w-full py-2.5 border border-slate-300 rounded-lg text-slate-600 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer text-sm">
                                            <UploadCloud className="w-5 h-5" />
                                            Choose PDF / Document
                                        </label>
                                    </>
                                )
                            )}

                            {uploadProgress && (
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs font-medium text-slate-500">
                                        <span>Uploading...</span>
                                        <span>{Math.round(uploadProgress.progress)}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress.progress}%` }} />
                                    </div>
                                </div>
                            )}
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

                            {/* Video Upload */}
                            <div className="border p-4 rounded-xl space-y-3 bg-slate-50">
                                <label className="block text-sm font-bold text-slate-700">Video Content</label>
                                {editingLesson.lesson.videoUrl ? (
                                    <div className="flex items-center justify-between bg-green-50 text-green-700 p-3 rounded-lg border border-green-200">
                                        <span className="text-sm">Video uploaded and attached</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, videoUrl: undefined } } : null)}>Remove</button>
                                    </div>
                                ) : (
                                    <div>
                                        <input
                                            type="file"
                                            accept="video/*"
                                            onChange={(e) => handleFileUpload(e, 'video')}
                                            className="hidden"
                                            id="video-upload"
                                        />
                                        <label htmlFor="video-upload" className="w-full py-2 border border-slate-300 rounded-lg text-slate-700 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer">
                                            <UploadCloud className="w-5 h-5" />
                                            Upload Video
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Document Upload */}
                            <div className="border p-4 rounded-xl space-y-3 bg-slate-50">
                                <label className="block text-sm font-bold text-slate-700">Document/PDF Content</label>
                                {editingLesson.lesson.documentUrl ? (
                                    <div className="flex items-center justify-between bg-blue-50 text-blue-700 p-3 rounded-lg border border-blue-200">
                                        <span className="text-sm truncate mr-2" title={editingLesson.lesson.documentUrl}>Document uploaded</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, documentUrl: undefined } } : null)}>Remove</button>
                                    </div>
                                ) : (
                                    <div>
                                        <input
                                            type="file"
                                            accept=".pdf,.doc,.docx"
                                            onChange={(e) => handleFileUpload(e, 'document')}
                                            className="hidden"
                                            id="document-upload"
                                        />
                                        <label htmlFor="document-upload" className="w-full py-2 border border-slate-300 rounded-lg text-slate-700 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer">
                                            <UploadCloud className="w-5 h-5" />
                                            Upload Document
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Excel Upload */}
                            <div className="border p-4 rounded-xl space-y-3 bg-slate-50">
                                <label className="block text-sm font-bold text-slate-700">Excel/Spreadsheet Content</label>
                                {editingLesson.lesson.excelUrl ? (
                                    <div className="flex items-center justify-between bg-green-50 text-green-700 p-3 rounded-lg border border-green-200">
                                        <span className="text-sm truncate mr-2" title={editingLesson.lesson.excelUrl}>Excel file uploaded</span>
                                        <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={() => setEditingLesson(prev => prev ? { ...prev, lesson: { ...prev.lesson, excelUrl: undefined } } : null)}>Remove</button>
                                    </div>
                                ) : (
                                    <div>
                                        <input
                                            type="file"
                                            accept=".xlsx,.xls,.csv"
                                            onChange={(e) => handleFileUpload(e, 'excel')}
                                            className="hidden"
                                            id="excel-upload"
                                        />
                                        <label htmlFor="excel-upload" className="w-full py-2 border border-slate-300 rounded-lg text-slate-700 hover:border-primary hover:text-primary transition flex items-center justify-center gap-2 font-medium cursor-pointer">
                                            <UploadCloud className="w-5 h-5" />
                                            Upload Excel File
                                        </label>
                                    </div>
                                )}
                            </div>

                            {uploadProgress && (
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs font-medium text-slate-500">
                                        <span>Uploading...</span>
                                        <span>{Math.round(uploadProgress.progress)}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress.progress}%` }} />
                                    </div>
                                </div>
                            )}

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
            </div>
        </div>
    );
}
