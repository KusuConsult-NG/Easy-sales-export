"use client";

/**
 * useFCMRegistration — passive foreground message handler.
 *
 * This hook NO LONGER calls Notification.requestPermission().
 * Permission prompting is delegated to <PushNotificationBanner> so users
 * see an in-app explanation before the native browser dialog fires.
 *
 * What this hook DOES do:
 *   - If permission is already 'granted', registers the service worker + FCM
 *     token on first mount (e.g. returning users who previously accepted).
 *   - Sets up the onMessage handler for foreground push notifications.
 */

import { useEffect } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export function useFCMRegistration() {
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!("Notification" in window)) return;
        if (!("serviceWorker" in navigator)) return;

        // Only proceed if the user has ALREADY granted permission. 
        // Never auto-prompt — that's the banner's job.
        if (Notification.permission !== "granted") return;

        const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
        if (!vapidKey) return;

        async function rehydrate() {
            try {
                const app = getApps().length
                    ? getApps()[0]
                    : initializeApp(firebaseConfig);
                const messaging = getMessaging(app);

                const registration = await navigator.serviceWorker.register(
                    "/firebase-messaging-sw.js"
                );
                registration.active?.postMessage({
                    type: "FIREBASE_CONFIG",
                    config: firebaseConfig,
                });

                const token = await getToken(messaging, {
                    vapidKey,
                    serviceWorkerRegistration: registration,
                });

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
                    new Notification(title, {
                        body,
                        icon: "/icons/icon-192x192.png",
                    });
                });
            } catch (err) {
                console.warn("[fcm] Rehydration failed (non-fatal):", err);
            }
        }

        rehydrate();
    }, []);
}

