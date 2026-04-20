"use client";

/**
 * DeploymentWatcher
 *
 * Silently polls /api/version every 5 minutes. When it detects the
 * server is running a newer build than the current browser tab, it shows
 * a soft banner inviting the user to refresh — preventing all the
 * "ChunkLoadError" / "Server Action not found" issues that happen when
 * Vercel deploys a new build while users are mid-session.
 *
 * No dependencies beyond React — no polling during SSR, no effect on
 * performance outside of a 5-minute interval fetch.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function DeploymentWatcher() {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        // Capture the build ID the browser loaded with
        const currentBuildId = (window as any).__NEXT_DATA__?.buildId;
        if (!currentBuildId) return; // Can't compare — skip

        let timer: ReturnType<typeof setInterval>;

        async function checkForUpdate() {
            try {
                // /_next/static/chunks/pages/_app.js would change hash, but simpler:
                // Next.js exposes the build ID in /_next/static/[buildId]/_ssgManifest.js
                // We can also check a lightweight custom endpoint.
                const res = await fetch(`/_next/static/${currentBuildId}/_ssgManifest.js`, {
                    method: "HEAD",
                    cache: "no-store",
                });
                // If the current build manifest file is GONE (404), a new build deployed
                if (res.status === 404) {
                    setUpdateAvailable(true);
                    clearInterval(timer);
                }
            } catch {
                // Network errors are not deployment events — ignore
            }
        }

        // Start polling after the first interval (not immediately on mount)
        timer = setInterval(checkForUpdate, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, []);

    if (!updateAvailable) return null;

    return (
        <div
            role="alert"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-2xl shadow-2xl border border-white/10 animate-in slide-in-from-bottom-4 duration-300"
        >
            <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>A new version is available.</span>
            <button
                onClick={() => window.location.reload()}
                className="ml-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg text-xs font-bold transition-colors"
            >
                Refresh now
            </button>
            <button
                onClick={() => setUpdateAvailable(false)}
                aria-label="Dismiss"
                className="ml-1 text-white/40 hover:text-white transition-colors text-lg leading-none"
            >
                ×
            </button>
        </div>
    );
}
