"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    FileText,
    Video,
    FileSpreadsheet,
    BookOpen,
    Download,
    Search,
    Filter,
    Loader2,
} from "lucide-react";
import { checkWaveEligibilityAction } from "@/app/actions/wave";
import { getResourcesAction, downloadResourceAction, type WaveResource } from "@/app/actions/resource-actions";

const categoryIcons = {
    document: FileText,
    video: Video,
    template: FileSpreadsheet,
    guide: BookOpen,
};

const categoryColors = {
    document: "blue",
    video: "purple",
    template: "green",
    guide: "orange",
};

export default function WaveResourcesPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [checking, setChecking] = useState(true);
    const [resources, setResources] = useState<WaveResource[]>([]);
    const [filteredResources, setFilteredResources] = useState<WaveResource[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [downloading, setDownloading] = useState<string | null>(null);

    // Check WAVE eligibility
    useEffect(() => {
        async function checkEligibility() {
            if (sessionStatus === "loading") return;

            if (!session?.user?.id) {
                router.push("/auth/login");
                return;
            }

            const result = await checkWaveEligibilityAction(session.user.id);

            if (!result.eligible) {
                router.push("/wave/access-denied");
                return;
            }

            setChecking(false);
        }

        checkEligibility();
    }, [session, sessionStatus, router]);

    // Load resources
    useEffect(() => {
        async function loadResources() {
            if (checking) return;

            setLoading(true);
            const data = await getResourcesAction();
            setResources(data);
            setFilteredResources(data);
            setLoading(false);
        }

        loadResources();
    }, [checking]);

    // Filter and search
    useEffect(() => {
        let filtered = resources;

        // Category filter
        if (selectedCategory !== "all") {
            filtered = filtered.filter((r) => r.category === selectedCategory);
        }

        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (r) =>
                    r.title.toLowerCase().includes(query) ||
                    r.description.toLowerCase().includes(query) ||
                    r.tags?.some((tag) => tag.toLowerCase().includes(query))
            );
        }

        setFilteredResources(filtered);
    }, [selectedCategory, searchQuery, resources]);

    async function handleDownload(resource: WaveResource) {
        if (!resource.id) return;

        setDownloading(resource.id);
        const result = await downloadResourceAction(resource.id);

        if (result.success && result.url) {
            // Open in new tab
            window.open(result.url, "_blank");

            // Update local download count
            setResources((prev) =>
                prev.map((r) =>
                    r.id === resource.id ? { ...r, downloads: r.downloads + 1 } : r
                )
            );
        } else {
            alert(result.error || "Failed to download resource");
        }

        setDownloading(null);
    }

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    if (checking || sessionStatus === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-purple-300 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-white mb-2">WAVE Resource Library</h1>
                    <p className="text-purple-200">
                        Training materials, templates, and guides for women entrepreneurs
                    </p>
                </div>

                {/* Search and Filters */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-300" />
                            <input
                                type="text"
                                placeholder="Search resources..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-purple-200/50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                            />
                        </div>

                        {/* Category Filter */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-300" />
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                            >
                                <option value="all">All Categories</option>
                                <option value="document">Documents</option>
                                <option value="video">Videos</option>
                                <option value="template">Templates</option>
                                <option value="guide">Guides</option>
                            </select>
                        </div>
                    </div>

                    {/* Results Count */}
                    <div className="mt-4 text-sm text-purple-200">
                        Showing {filteredResources.length} of {resources.length} resources
                    </div>
                </div>

                {/* Resources Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-purple-300 animate-spin" />
                    </div>
                ) : filteredResources.length === 0 ? (
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-12 text-center">
                        <BookOpen className="w-16 h-16 text-purple-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-white mb-2">No resources found</h3>
                        <p className="text-purple-200">
                            {searchQuery || selectedCategory !== "all"
                                ? "Try adjusting your search or filters"
                                : "Resources will appear here once uploaded by administrators"}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredResources.map((resource) => {
                            const Icon = categoryIcons[resource.category];
                            const color = categoryColors[resource.category];

                            return (
                                <div
                                    key={resource.id}
                                    className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 hover:bg-white/15 transition group"
                                >
                                    {/* Icon and Category */}
                                    <div className="flex items-center justify-between mb-4">
                                        <div className={`w-12 h-12 bg-${color}-500/20 rounded-lg flex items-center justify-center`}>
                                            <Icon className={`w-6 h-6 text-${color}-300`} />
                                        </div>
                                        <span className={`text-xs px-3 py-1 bg-${color}-500/20 text-${color}-300 rounded-full font-medium`}>
                                            {resource.category}
                                        </span>
                                    </div>

                                    {/* Title and Description */}
                                    <h3 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                                        {resource.title}
                                    </h3>
                                    <p className="text-sm text-purple-200 mb-4 line-clamp-3">
                                        {resource.description}
                                    </p>

                                    {/* Meta Info */}
                                    <div className="flex items-center justify-between text-xs text-purple-300 mb-4">
                                        <span>{formatFileSize(resource.fileSize)}</span>
                                        <span>{resource.downloads} downloads</span>
                                    </div>

                                    {/* Download Button */}
                                    <button
                                        onClick={() => handleDownload(resource)}
                                        disabled={downloading === resource.id}
                                        className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                                    >
                                        {downloading === resource.id ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Downloading...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-5 h-5" />
                                                <span>Download</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
