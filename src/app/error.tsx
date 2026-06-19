'use client';

import { logger } from '@/lib/logger';
import { useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Home, RefreshCw, LayoutDashboard } from 'lucide-react';
import { HardLogoutButton } from '@/components/auth/HardLogoutButton';

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
        msg.includes("Importing a module script failed") ||
        msg.includes("Failed to find Server Action") ||
        msg.includes("older or newer deployment")
    );
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { data: session } = useSession();
    const isLoggedIn = !!session?.user;

    useEffect(() => {
        // Stale deployment recovery
        if (isStaleDeploymentError(error)) {
            console.warn("[GlobalError] Stale deployment detected — auto-reloading.", error.name, error.message);
            window.location.reload();
            return;
        }

        // Log error for debugging
        logger.error('Global error caught:', error);
    }, [error]);

    // While a stale-deployment reload is in flight, show nothing or simple loading
    if (isStaleDeploymentError(error)) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-10 h-10 text-red-600" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    Something Went Wrong
                </h1>

                <p className="text-slate-600 mb-6">
                    {error.message || "An unexpected error occurred. Please try again."}
                </p>

                <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                        <button
                            onClick={reset}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Try Again
                        </button>
                        <Link
                            href={isLoggedIn ? "/dashboard" : "/"}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            {isLoggedIn ? <LayoutDashboard className="w-4 h-4" /> : <Home className="w-4 h-4" />}
                            {isLoggedIn ? "Return to Dashboard" : "Go Home"}
                        </Link>
                    </div>

                    <HardLogoutButton className="mt-2" />
                </div>

                {error.digest && (
                    <p className="mt-4 text-xs text-slate-500">
                        Error ID: {error.digest}
                    </p>
                )}
            </div>
        </div>
    );
}
