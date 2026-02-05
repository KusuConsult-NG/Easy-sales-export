"use client";

import { useState, useEffect } from "react";
import { getAllFeatureToggles, updateFeatureToggle } from "@/app/actions/feature-toggles";
import { FEATURE_METADATA, type FeatureToggle, FEATURE_CATEGORIES } from "@/lib/feature-toggles";
import { Shield, ToggleLeft, ToggleRight, Loader2, CheckCircle, XCircle, AlertTriangle, Search, Filter } from "lucide-react";

export default function FeatureTogglesPage() {
    const [toggles, setToggles] = useState<FeatureToggle[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

    useEffect(() => {
        loadToggles();
    }, []);

    async function loadToggles() {
        setLoading(true);
        const result = await getAllFeatureToggles();
        if (result.success && result.data) {
            setToggles(result.data);
        }
        setLoading(false);
    }

    async function handleToggle(featureId: string, currentState: boolean) {
        setUpdating(featureId);
        const result = await updateFeatureToggle(featureId, !currentState);

        if (result.success) {
            // Update local state
            setToggles(prev =>
                prev.map(toggle =>
                    toggle.id === featureId
                        ? { ...toggle, enabled: !currentState }
                        : toggle
                )
            );
        } else {
            alert(result.error || "Failed to update toggle");
        }

        setUpdating(null);
    }

    const filteredToggles = toggles.filter(toggle => {
        const metadata = FEATURE_METADATA[toggle.id];
        const matchesSearch = toggle.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            toggle.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = categoryFilter === "ALL" || metadata?.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const groupedToggles = filteredToggles.reduce((acc, toggle) => {
        const metadata = FEATURE_METADATA[toggle.id];
        const category = metadata?.category || "CORE";
        if (!acc[category]) acc[category] = [];
        acc[category].push(toggle);
        return acc;
    }, {} as Record<string, FeatureToggle[]>);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-8">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                            <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                                Feature Toggles
                            </h1>
                            <p className="text-slate-600 dark:text-slate-400">
                                Manage feature rollout and access control
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={loadToggles}
                        disabled={loading}
                        className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                        <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </button>
                </div>

                {/* Search and Filter */}
                <div className="flex space-x-4 mt-6">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search features..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                    </div>
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                        <option value="ALL">All Categories</option>
                        <option value="CORE">Core Features</option>
                        <option value="BETA">Beta Features</option>
                        <option value="EXPERIMENTAL">Experimental</option>
                    </select>
                </div>
            </div>

            {/* Feature Toggles by Category */}
            <div className="max-w-7xl mx-auto space-y-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : Object.keys(groupedToggles).length === 0 ? (
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center">
                        <p className="text-slate-600 dark:text-slate-400">No features found</p>
                    </div>
                ) : (
                    Object.entries(groupedToggles).map(([category, categoryToggles]) => (
                        <div key={category} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4">
                                <h2 className="text-xl font-bold text-white">
                                    {FEATURE_CATEGORIES[category as keyof typeof FEATURE_CATEGORIES]}
                                </h2>
                                <p className="text-sm text-slate-300">{categoryToggles.length} features</p>
                            </div>

                            <div className="divide-y divide-slate-200 dark:divide-slate-700">
                                {categoryToggles.map((toggle) => {
                                    const metadata = FEATURE_METADATA[toggle.id];
                                    const isUpdating = updating === toggle.id;

                                    return (
                                        <div
                                            key={toggle.id}
                                            className="p-6 hover:bg-slate-50 dark:hover:bg-slate-750 transition"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-3 mb-2">
                                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                            {metadata?.name || toggle.name}
                                                        </h3>
                                                        {toggle.enabled ? (
                                                            <span className="flex items-center space-x-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full">
                                                                <CheckCircle className="w-3 h-3" />
                                                                <span>Active</span>
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center space-x-1 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                                                                <XCircle className="w-3 h-3" />
                                                                <span>Disabled</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                                                        {metadata?.description || toggle.description}
                                                    </p>
                                                    <div className="flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-500">
                                                        <span>ID: <code className="bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">{toggle.id}</code></span>
                                                        {toggle.targetRoles && toggle.targetRoles.length > 0 && (
                                                            <span className="flex items-center space-x-1">
                                                                <Shield className="w-3 h-3" />
                                                                <span>Roles: {toggle.targetRoles.join(", ")}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Toggle Button */}
                                                <button
                                                    onClick={() => handleToggle(toggle.id, toggle.enabled)}
                                                    disabled={isUpdating}
                                                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition disabled:opacity-50 ${toggle.enabled
                                                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
                                                            : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                                                        }`}
                                                >
                                                    {isUpdating ? (
                                                        <Loader2 className="w-5 h-5 animate-spin" />
                                                    ) : toggle.enabled ? (
                                                        <ToggleRight className="w-5 h-5" />
                                                    ) : (
                                                        <ToggleLeft className="w-5 h-5" />
                                                    )}
                                                    <span>{toggle.enabled ? "Disable" : "Enable"}</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Warning Notice */}
            <div className="max-w-7xl mx-auto mt-8">
                <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 rounded">
                    <div className="flex items-start space-x-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5" />
                        <div>
                            <h4 className="font-semibold text-amber-800 dark:text-amber-400">Important</h4>
                            <p className="text-sm text-amber-700 dark:text-amber-500 mt-1">
                                Disabling core features may affect user experience. All toggle changes are logged in the audit trail.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
