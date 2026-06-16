"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { HardLogoutButton } from "@/components/auth/HardLogoutButton";

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

export default function WaveApplicationError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        if (isStaleDeploymentError(error)) {
            console.warn("[WaveApplicationError] Stale deployment detected — auto-reloading.", error.name, error.message);
            window.location.reload();
            return;
        }
        console.error("[WAVE Application Error]", error);
    }, [error]);

    if (isStaleDeploymentError(error)) {
        return (
            <div className="min-h-[400px] flex items-center justify-center p-6 bg-slate-50">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-slate-50">
            <div className="max-w-md w-full bg-white border border-red-100 rounded-2xl p-8 shadow-sm text-center">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-3">Something went wrong!</h2>
                <p className="text-slate-500 mb-8 text-sm leading-relaxed">
                    We encountered an unexpected error while loading the WAVE application. Our technical team has been notified.
                </p>
                <div className="flex flex-col gap-3 justify-center items-center">
                    <div className="flex flex-col sm:flex-row gap-3 w-full">
                        <button
                            onClick={() => reset()}
                            className="flex-1 px-6 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors cursor-pointer"
                        >
                            Try again
                        </button>
                        <button
                            onClick={() => window.location.href = "/wave"}
                            className="flex-1 px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                            Back to WAVE
                        </button>
                    </div>
                    <HardLogoutButton variant="ghost" />
                </div>
            </div>
        </div>
    );
}
