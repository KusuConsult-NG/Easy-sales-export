"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { AlertTriangle, Home, RefreshCcw } from "lucide-react";
import Link from "next/link";

/** Returns true if the error is caused by a stale JS bundle after a new deployment */
function isStaleDeploymentError(error: Error & { digest?: string }): boolean {
    const msg = error?.message ?? "";
    const name = error?.name ?? "";
    return (
        name === "ChunkLoadError" ||
        name === "UnrecognizedActionError" ||
        msg.includes("ChunkLoadError") ||
        msg.includes("Loading chunk") ||
        msg.includes("was not found on the server") ||
        msg.includes("UnrecognizedAction") ||
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed")
    );
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        // ── Stale-deployment auto-recovery ──────────────────────────────────
        // ChunkLoadError / UnrecognizedActionError mean the browser has a stale
        // JS bundle from before the last Vercel deploy. A hard reload fetches
        // the new bundle and the user lands on the same page without any error.
        if (isStaleDeploymentError(error)) {
            console.warn("[GlobalError] Stale deployment detected — auto-reloading.", error.name, error.message);
            window.location.reload();
            return;
        }

        // Log genuine errors to telemetry
        logger.error("Next.js Global UI Boundary Caught Exception", error, {
            digest: error.digest,
            path: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
            fatal: true
        });
    }, [error]);

    // While a stale-deployment reload is in flight, show nothing
    if (isStaleDeploymentError(error)) {
        return (
            <html>
                <body>
                    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', color: '#475569' }}>
                        <p>Updating to latest version…</p>
                    </div>
                </body>
            </html>
        );
    }

    return (
        <html>
            <body>
                <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden text-center p-8">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle className="w-8 h-8 text-red-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Service Unresponsive</h2>
                        <p className="text-slate-500 mb-8">
                            A critical internal error has prevented this page from rendering.
                            Our engineering team has been notified immediately via telemetry.
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => reset()}
                                className="w-full flex items-center justify-center py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition"
                            >
                                <RefreshCcw className="w-5 h-5 mr-2" />
                                Try recovery reload
                            </button>
                            <Link
                                href="/"
                                className="w-full flex items-center justify-center py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition"
                            >
                                <Home className="w-5 h-5 mr-2" />
                                Return to Safety
                            </Link>
                        </div>
                        {process.env.NODE_ENV === 'development' && (
                            <div className="mt-8 text-left bg-slate-100 p-4 rounded-lg overflow-auto">
                                <p className="text-xs font-mono text-red-600 wrap-break-word">{error.message}</p>
                            </div>
                        )}
                    </div>
                </div>
            </body>
        </html>
    );
}
