"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Upload,
    FileText,
    Video,
    FileSpreadsheet,
    BookOpen,
    Trash2,
    Edit,
    Loader2,
    X,
} from "lucide-react";
import {
    uploadResourceAction,
    getResourcesAction,
    deleteResourceAction,
    type WaveResource,
} from "@/app/actions/resource-actions";

const categoryOptions = [
    { value: "document", label: "Document", icon: FileText },
    { value: "video", label: "Video", icon: Video },
    { value: "template", label: "Template", icon: FileSpreadsheet },
    { value: "guide", label: "Guide", icon: BookOpen },
];

export default function AdminWaveResourcesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [resources, setResources] = useState<WaveResource[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        category: "document" as "document" | "video" | "template" | "guide",
        tags: "",
    });

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    useEffect(() => {
        async function loadResources() {
            setLoading(true);
            const data = await getResourcesAction();
            setResources(data);
            setLoading(false);
        }

        if (status === "authenticated") {
            loadResources();
        }
    }, [status]);

    async function handleUpload(e: React.FormEvent) {
        e.preventDefault();

        if (!selectedFile) {
            alert("Please select a file");
            return;
        }

        const data = new FormData();
        data.append("file", selectedFile);
        data.append("title", formData.title);
        data.append("description", formData.description);
        data.append("category", formData.category);
        data.append("tags", formData.tags);

        setUploading(true);
        const result = await uploadResourceAction(data);

        if (result.success) {
            alert("Resource uploaded successfully!");
            setShowUploadModal(false);
            setSelectedFile(null);
            setFormData({
                title: "",
                description: "",
                category: "document",
                tags: "",
            });

            // Reload resources
            const updated = await getResourcesAction();
            setResources(updated);
        } else {
            alert(result.error || "Failed to upload resource");
        }

        setUploading(false);
    }

    async function handleDelete(resourceId: string) {
        if (!confirm("Are you sure you want to delete this resource?")) return;

        const result = await deleteResourceAction(resourceId);

        if (result.success) {
            alert("Resource deleted successfully!");
            setResources((prev) => prev.filter((r) => r.id !== resourceId));
        } else {
            alert(result.error || "Failed to delete resource");
        }
    }

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function formatDate(timestamp: any): string {
        if (!timestamp) return "Unknown";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString();
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-4xl font-bold text-white mb-2">
                            Manage WAVE Resources
                        </h1>
                        <p className="text-purple-200">Upload and manage training materials</p>
                    </div>
                    <button
                        onClick={() => setShowUploadModal(true)}
                        className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-medium transition flex items-center space-x-2"
                    >
                        <Upload className="w-5 h-5" />
                        <span>Upload Resource</span>
                    </button>
                </div>

                {/* Resources Table */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-purple-300 animate-spin" />
                        </div>
                    ) : resources.length === 0 ? (
                        <div className="p-12 text-center">
                            <Upload className="w-16 h-16 text-purple-300 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">
                                No resources yet
                            </h3>
                            <p className="text-purple-200 mb-6">
                                Get started by uploading your first resource
                            </p>
                            <button
                                onClick={() => setShowUploadModal(true)}
                                className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-medium transition"
                            >
                                Upload Resource
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-white/5 border-b border-white/10">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Title
                                        </th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Category
                                        </th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Size
                                        </th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Downloads
                                        </th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Uploaded
                                        </th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10">
                                    {resources.map((resource) => (
                                        <tr key={resource.id} className="hover:bg-white/5 transition">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <div className="text-white font-medium">
                                                        {resource.title}
                                                    </div>
                                                    <div className="text-sm text-purple-300 line-clamp-1">
                                                        {resource.description}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs font-medium">
                                                    {resource.category}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-purple-200">
                                                {formatFileSize(resource.fileSize)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-purple-200">
                                                {resource.downloads}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-purple-200">
                                                {formatDate(resource.uploadedAt)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <button
                                                    onClick={() => resource.id && handleDelete(resource.id)}
                                                    className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Upload Modal */}
                {showUploadModal && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                        <div className="bg-slate-900 border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-2xl font-bold text-white">Upload Resource</h2>
                                <button
                                    onClick={() => setShowUploadModal(false)}
                                    className="p-2 hover:bg-white/10 rounded-lg transition"
                                >
                                    <X className="w-6 h-6 text-white" />
                                </button>
                            </div>

                            <form onSubmit={handleUpload} className="space-y-4">
                                {/* File Upload */}
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        File *
                                    </label>
                                    <input
                                        type="file"
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-500 file:text-white hover:file:bg-purple-600"
                                        required
                                    />
                                    {selectedFile && (
                                        <p className="mt-2 text-sm text-purple-300">
                                            {selectedFile.name} ({formatFileSize(selectedFile.size)})
                                        </p>
                                    )}
                                </div>

                                {/* Title */}
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) =>
                                            setFormData({ ...formData, title: e.target.value })
                                        }
                                        className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-purple-200/50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                        placeholder="e.g., Yam Export Guide 2024"
                                        required
                                    />
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) =>
                                            setFormData({ ...formData, description: e.target.value })
                                        }
                                        className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-purple-200/50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                        placeholder="Describe this resource..."
                                        rows={3}
                                        required
                                    />
                                </div>

                                {/* Category */}
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Category *
                                    </label>
                                    <select
                                        value={formData.category}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                category: e.target.value as any,
                                            })
                                        }
                                        className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                                    >
                                        {categoryOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Tags */}
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Tags (comma separated)
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.tags}
                                        onChange={(e) =>
                                            setFormData({ ...formData, tags: e.target.value })
                                        }
                                        className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-purple-200/50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                        placeholder="e.g., export, training, yam"
                                    />
                                </div>

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={uploading}
                                    className="w-full px-6 py-3 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                                >
                                    {uploading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            <span>Uploading...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-5 h-5" />
                                            <span>Upload Resource</span>
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
