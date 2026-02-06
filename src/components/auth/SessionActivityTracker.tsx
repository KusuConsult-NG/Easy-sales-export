"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Session Activity Tracker
 * 
 * Tracks user activity and automatically logs out inactive users after timeout.
 * Features:
 * - 30-minute inactivity timeout
 * - Warning modal 2 minutes before logout
 * - Cross-tab synchronization via localStorage
 * - Debounced activity tracking
 * - Event listeners for: mousemove, keydown, click, scroll, touchstart
 */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_THRESHOLD_MS = 2 * 60 * 1000; // Show warning 2 minutes before timeout
const ACTIVITY_DEBOUNCE_MS = 30 * 1000; // Update activity timestamp max once per 30 seconds

export default function SessionActivityTracker() {
    const [showWarning, setShowWarning] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [lastActivityTime, setLastActivityTime] = useState(Date.now());

    // Update activity timestamp
    const updateActivity = useCallback(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastActivityTime;

        // Debounce: only update if > 30 seconds since last update
        if (timeSinceLastUpdate >= ACTIVITY_DEBOUNCE_MS) {
            setLastActivityTime(now);
            localStorage.setItem("lastActivity", now.toString());
            setShowWarning(false);
        }
    }, [lastActivityTime]);

    // Check session timeout
    useEffect(() => {
        const checkTimeout = () => {
            const lastActivity = parseInt(localStorage.getItem("lastActivity") || Date.now().toString(), 10);
            const timeSinceActivity = Date.now() - lastActivity;
            const remaining = SESSION_TIMEOUT_MS - timeSinceActivity;

            setTimeRemaining(remaining);

            // Show warning if close to timeout
            if (remaining <= WARNING_THRESHOLD_MS && remaining > 0) {
                setShowWarning(true);
            }

            // Auto-logout if timeout exceeded
            if (remaining <= 0) {
                handleLogout();
            }
        };

        // Initialize localStorage
        if (!localStorage.getItem("lastActivity")) {
            localStorage.setItem("lastActivity", Date.now().toString());
        }

        // Check every second
        const interval = setInterval(checkTimeout, 1000);

        return () => clearInterval(interval);
    }, []);

    // Activity event listeners
    useEffect(() => {
        const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];

        events.forEach((event) => {
            window.addEventListener(event, updateActivity, { passive: true });
        });

        return () => {
            events.forEach((event) => {
                window.removeEventListener(event, updateActivity);
            });
        };
    }, [updateActivity]);

    // Cross-tab synchronization
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === "lastActivity" && e.newValue) {
                setLastActivityTime(parseInt(e.newValue, 10));
                setShowWarning(false);
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, []);

    const handleLogout = async () => {
        localStorage.removeItem("lastActivity");
        await signOut({ callbackUrl: "/auth/login?timeout=true" });
    };

    const handleExtendSession = () => {
        updateActivity();
        setShowWarning(false);
    };

    const formatTime = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    if (!showWarning) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                {/* Header */}
                <div className="bg-linear-to-r from-amber-500 to-orange-500 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">Session Timeout Warning</h2>
                                <p className="text-sm text-white/90">Your session is about to expire</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <div className="mb-6">
                        <p className="text-slate-700 dark:text-slate-300 mb-4">
                            You've been inactive for a while. For your security, you'll be automatically
                            logged out soon.
                        </p>

                        <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 rounded">
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-1">
                                Time Remaining
                            </p>
                            <p className="text-3xl font-bold text-amber-600 dark:text-amber-500 tabular-nums">
                                {formatTime(timeRemaining)}
                            </p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                        <button
                            onClick={handleExtendSession}
                            className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition"
                        >
                            <span>Continue Session</span>
                        </button>

                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center justify-center space-x-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-medium py-3 px-4 rounded-lg transition"
                        >
                            <span>Logout Now</span>
                        </button>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-4">
                        Click anywhere or press any key to stay logged in
                    </p>
                </div>
            </div>
        </div>
    );
}
