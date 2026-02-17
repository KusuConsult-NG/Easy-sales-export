"use client";

import { useState } from "react";
import { Trash2, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { cleanupAbandonedDraftsAction } from "@/app/actions/maintenance";
import { useToast } from "@/contexts/ToastContext";

export default function MaintenancePage() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ count: number } | null>(null);
    const { showToast } = useToast();

    const handleCleanup = async () => {
        if (!confirm("Are you sure you want to delete all draft listings older than 30 days? This action cannot be undone.")) {
            return;
        }

        setLoading(true);
        try {
            const response = await cleanupAbandonedDraftsAction();
            if (response.success) {
                setResult({ count: response.count || 0 });
                showToast(`Successfully cleaned up ${response.count} drafts`, "success");
            } else {
                showToast(response.error || "Cleanup failed", "error");
            }
        } catch (error) {
            console.error(error);
            showToast("An unexpected error occurred", "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    System Maintenance
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Perform system cleanup and optimization tasks
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* Garbage Collection Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center shrink-0">
                            <Trash2 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                                Garbage Collection
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                Remove abandoned draft land listings that haven't been updated in over 30 days to save database space.
                            </p>

                            {result && (
                                <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl flex items-center gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                        Cleanup complete! Removed {result.count} items.
                                    </p>
                                </div>
                            )}

                            <button
                                onClick={handleCleanup}
                                disabled={loading}
                                className="px-4 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Cleaning...
                                    </>
                                ) : (
                                    <>
                                        Run Cleanup
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
