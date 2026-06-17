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
    Users,
} from "lucide-react";
import { checkWaveEligibilityAction } from "@/app/actions/wave";
import { getResourcesAction, downloadResourceAction, type WaveResource } from "@/app/actions/resource-actions";
import { useToast } from "@/contexts/ToastContext";

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
    const { showToast } = useToast();
    const [checking, setChecking] = useState(true);
    const [resources, setResources] = useState<WaveResource[]>([]);
    const [filteredResources, setFilteredResources] = useState<WaveResource[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [downloading, setDownloading] = useState<string | null>(null);

    // Check enrollment eligibility
    useEffect(() => {
        if (sessionStatus === "loading") return;

        if (sessionStatus === "unauthenticated" || !session?.user?.id) {
            router.push("/auth/login?callbackUrl=/wave/resources");
            return;
        }

        async function checkEligibility() {
            setChecking(true);
            const eligibility = await checkWaveEligibilityAction(session!.user.id);
            if (!eligibility.success) {
                // If status is not active, redirect to wave application/landing page
                router.push("/wave/application");
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
            if (data.success && data.data && data.data.length > 0) {
                // Map the default resources to guides if their title matches
                const mapped = data.data.map((r: WaveResource) => {
                    if (r.title.includes("WAVE Cooperative Legal Framework Agreement")) {
                        return { ...r, category: "guide" as const };
                    }
                    return r;
                });
                setResources(mapped);
                setFilteredResources(mapped);
            } else {
                const defaultResources: WaveResource[] = [
                    {
                        id: "default-guide-1",
                        title: "Agripreneur Export Masterclass Guide",
                        description: "Comprehensive handbook detailing international standards, phytosanitary requirements, and customs procedures for exporting agricultural commodities from Nigeria.",
                        category: "guide",
                        fileUrl: "https://www.fao.org/3/i0582e/i0582e.pdf",
                        fileName: "agripreneur_export_masterclass.pdf",
                        fileSize: 5033164,
                        fileType: "application/pdf",
                        uploadedAt: new Date() as any,
                        uploadedBy: "system",
                        uploadedByName: "System Admin",
                        downloads: 142,
                        tags: ["export", "guide", "standards"],
                        isActive: true
                    },
                    {
                        id: "default-template-1",
                        title: "WAVE Cooperative Legal Framework Agreement",
                        description: "A standard legal partnership template designed for female agricultural cooperatives to establish governance, profit sharing, and membership protocols.",
                        category: "guide",
                        fileUrl: "https://www.ilo.org/wcmsp5/groups/public/---ed_emp/---emp_ent/---coop/documents/instructionalmaterial/wcms_645415.pdf",
                        fileName: "cooperative_legal_framework.pdf",
                        fileSize: 1258291,
                        fileType: "application/pdf",
                        uploadedAt: new Date() as any,
                        uploadedBy: "system",
                        uploadedByName: "System Admin",
                        downloads: 89,
                        tags: ["cooperative", "legal", "guide"],
                        isActive: true
                    },
                    {
                        id: "default-form-1",
                        title: "CBN Agri-Business SME Loan Application Form",
                        description: "Official Central Bank of Nigeria guidelines and application framework document for securing SME agricultural intervention credit loans.",
                        category: "document",
                        fileUrl: "https://www.cbn.gov.ng/out/2020/dfd/agsmeis%20guidelines%20updated.pdf",
                        fileName: "cbn_sme_loan_application.pdf",
                        fileSize: 2621440,
                        fileType: "application/pdf",
                        uploadedAt: new Date() as any,
                        uploadedBy: "system",
                        uploadedByName: "System Admin",
                        downloads: 215,
                        tags: ["loan", "finance", "cbn"],
                        isActive: true
                    }
                ];
                setResources(defaultResources);
                setFilteredResources(defaultResources);
            }
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

        if (resource.title.includes("Agripreneur Export Masterclass Guide")) {
            router.push("/academy");
            return;
        }
        if (resource.title.includes("WAVE Cooperative Legal Framework Agreement")) {
            router.push("/cooperatives");
            return;
        }

        setDownloading(resource.id);

        if (resource.id.startsWith("default-")) {
            window.open(resource.fileUrl, "_blank");
            setResources((prev) =>
                prev.map((r) =>
                    r.id === resource.id ? { ...r, downloads: r.downloads + 1 } : r
                )
            );
            showToast("Resource download started", "success");
            setDownloading(null);
            return;
        }

        const result = await downloadResourceAction(resource.id);

        if (result.success && result.data?.url) {
            // Open in new tab
            window.open(result.data.url, "_blank");

            // Update local download count
            setResources((prev) =>
                prev.map((r) =>
                    r.id === resource.id ? { ...r, downloads: r.downloads + 1 } : r
                )
            );
            showToast("Resource download started", "success");
        } else {
            showToast(result.error || "Failed to download resource", "error");
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
            <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-white mb-2">WAVE Resource Library</h1>
                    <p className="text-emerald-200">
                        Training materials, templates, and guides for women entrepreneurs
                    </p>
                </div>

                {/* Search and Filters */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                            <input
                                type="text"
                                placeholder="Search resources..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder:text-emerald-200/50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>

                        {/* Category Filter */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                    <div className="mt-4 text-sm text-emerald-200">
                        Showing {filteredResources.length} of {resources.length} resources
                    </div>
                </div>

                {/* Resources Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                    </div>
                ) : filteredResources.length === 0 ? (
                    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-12 text-center">
                        <BookOpen className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-white mb-2">No resources found</h3>
                        <p className="text-emerald-200">
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
                                    <p className="text-sm text-emerald-200 mb-4 line-clamp-3">
                                        {resource.description}
                                    </p>

                                    {/* Meta Info */}
                                    <div className="flex items-center justify-between text-xs text-emerald-400 mb-4">
                                        <span>{formatFileSize(resource.fileSize)}</span>
                                        <span>{resource.downloads} downloads</span>
                                    </div>

                                    {/* Download/Action Button */}
                                    <button
                                        onClick={() => handleDownload(resource)}
                                        disabled={downloading === resource.id}
                                        className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                                    >
                                        {downloading === resource.id ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Downloading...</span>
                                            </>
                                        ) : resource.title.includes("Agripreneur Export Masterclass Guide") ? (
                                            <>
                                                <BookOpen className="w-5 h-5" />
                                                <span>Go to Academy</span>
                                            </>
                                        ) : resource.title.includes("WAVE Cooperative Legal Framework Agreement") ? (
                                            <>
                                                <Users className="w-5 h-5" />
                                                <span>Go to Cooperatives</span>
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
