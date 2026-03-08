"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { usePushPermissionState } from "@/hooks/usePushPermissionState";
import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * PushNotificationBanner
 * 
 * A subtle, dismissible banner shown to authenticated users who haven't yet
 * granted or denied push notification permission.
 * 
 * Behaviour:
 *   - Only shown when Notification.permission === 'default'
 *   - User clicks "Enable" → native browser permission prompt is shown
 *   - On grant → FCM token registered silently
 *   - User clicks "×" → banner hides for the session
 *   - If already granted or denied → banner never appears
 */
export function PushNotificationBanner() {
    const { permissionState, request, dismiss } = usePushPermissionState();
    const [enabling, setEnabling] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const fcmSetupDone = useRef(false);

    // Animate in
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (permissionState === "default") {
            const t = setTimeout(() => setVisible(true), 1200); // slight delay after page load
            return () => clearTimeout(t);
        }
    }, [permissionState]);

    async function handleEnable() {
        if (enabling) return;
        setEnabling(true);
        const granted = await request();
        setEnabling(false);

        if (!granted || fcmSetupDone.current) return;
        fcmSetupDone.current = true;

        // Register FCM token silently now that we have permission
        const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
        if (!vapidKey) return;

        try {
            const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
            const messaging = getMessaging(app);
            const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
            registration.active?.postMessage({ type: "FIREBASE_CONFIG", config: firebaseConfig });

            const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
            if (token) {
                await fetch("/api/notifications/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });
            }

            // Handle foreground messages
            onMessage(messaging, (payload) => {
                const { title = "Notification", body = "" } = payload.notification || {};
                new Notification(title, { body, icon: "/icons/icon-192x192.png" });
            });

            setEnabled(true);
        } catch (err) {
            console.warn("[fcm] Registration failed (non-fatal):", err);
        }
    }

    function handleDismiss() {
        setVisible(false);
        // Wait for CSS fade-out animation then call dismiss
        setTimeout(dismiss, 300);
    }

    // Success state — briefly shows confirmation then fades
    if (enabled) {
        return (
            <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl text-sm font-semibold animate-pulse-once">
                <Bell className="w-4 h-4" />
                Notifications enabled!
            </div>
        );
    }

    if (permissionState !== "default" || !visible) return null;

    return (
        <div
            className={`fixed bottom-4 right-4 z-50 max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                }`}
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5 p-2 bg-emerald-100 rounded-xl">
                    <Bell className="w-4 h-4 text-emerald-700" />
                </div>
                <div className="flex-1">
                    <p className="font-bold text-slate-900 text-sm leading-tight">
                        Stay in the loop
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                        Enable push notifications to get instant alerts on orders, escrow updates, and withdrawals.
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                        <button
                            onClick={handleEnable}
                            disabled={enabling}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-60 flex items-center gap-1.5"
                        >
                            {enabling ? (
                                <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Bell className="w-3 h-3" />
                            )}
                            Enable Notifications
                        </button>
                        <button
                            onClick={handleDismiss}
                            className="px-3 py-1.5 text-slate-400 text-xs hover:text-slate-700 transition rounded-xl hover:bg-slate-100"
                        >
                            Not now
                        </button>
                    </div>
                </div>
                <button
                    onClick={handleDismiss}
                    className="text-slate-300 hover:text-slate-600 transition mt-0.5"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
