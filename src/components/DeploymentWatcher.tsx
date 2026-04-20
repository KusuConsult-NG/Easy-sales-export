"use client";

/**
 * DeploymentWatcher
 *
 * Polls /api/health every 5 minutes. When it detects the server is running
 * a newer build than the current browser tab (build timestamps differ), it
 * shows a soft banner inviting the user to refresh.
 *
 * Works with Railway's Docker-based deployments: each new container has a
 * unique BUILD_TIME stamped at `next build` time.
 *
 * Prevents ChunkLoadError / "Server Action not found" issues that happen
 * when Railway switches to a new container while users are mid-session.
 */

import { useEffect, useState, useRef } from "react";
import { RefreshCw } from "lucide-react";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function DeploymentWatcher() {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    // Capture the build time the browser loaded with (set at next build via next.config.ts)
    const currentBuildTime = useRef<string | null>(
        typeof window !== "undefined"
            ? (window as any).__NEXT_BUILD_TIME ||
              process.env.NEXT_PUBLIC_BUILD_TIME ||
              null
            : null
    );

    useEffect(() => {
        async function checkForUpdate() {
            try {
                const res = await fetch("/api/health", {
                    cache: "no-store",
                    headers: { "Accept": "application/json" },
                });
                if (!res.ok) return;

                const data = await res.json();
                const serverBuildTime: string | undefined = data?.buildTime;

                if (!serverBuildTime) return;

                // First call — capture the server's build time as our baseline
                if (!currentBuildTime.current) {
                    currentBuildTime.current = serverBuildTime;
                    return;
                }

                // If the server reports a different (newer) build time, a new
                // Docker container has been deployed
                if (serverBuildTime !== currentBuildTime.current) {
                    setUpdateAvailable(true);
                }
            } catch {
                // Network errors are not deployment events — ignore
            }
        }

        // Start polling (not immediately — wait one interval first)
        const timer = setInterval(checkForUpdate, POLL_INTERVAL_MS);
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
