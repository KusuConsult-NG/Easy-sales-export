"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

/**
 * Shared upload error boundary UI
 * Used across all 6 modules wherever file upload can fail.
 */
export default function UploadErrorPage({
    error,
    reset,
    backHref = "/",
    backLabel = "Go to Dashboard",
}: {
    error: Error & { digest?: string };
    reset: () => void;
    backHref?: string;
    backLabel?: string;
}) {
    useEffect(() => {
        // Log to console in dev; in production a real error monitor would capture this
        console.error("[Upload Error]", error);
    }, [error]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                </div>

                <h1 className="text-xl font-bold text-slate-900 mb-2">
                    Something went wrong
                </h1>
                <p className="text-slate-600 mb-2 text-sm">
                    We couldn&apos;t process your file upload. This is usually a temporary issue.
                </p>
                <p className="text-slate-500 text-xs mb-6">
                    Please check your file (max 5MB, JPG/PNG/PDF only) and try again. If the problem
                    persists, contact support.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-sm transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                    <Link
                        href={backHref}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-sm transition-colors"
                    >
                        <Home className="w-4 h-4" />
                        {backLabel}
                    </Link>
                </div>

                {error.digest && (
                    <p className="mt-4 text-xs text-slate-400">
                        Reference: {error.digest}
                    </p>
                )}
            </div>
        </div>
    );
}
