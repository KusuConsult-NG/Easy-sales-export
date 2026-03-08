"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * usePushPermissionState — reads the current Notification.permission without 
 * prompting the user. Returns one of:
 *   'default'  — user hasn't been asked yet   → show the banner
 *   'granted'  — already enabled               → no banner
 *   'denied'   — user blocked notifications    → no banner (nothing we can do)
 *   'unsupported' — browser doesn't support it → no banner
 */
export function usePushPermissionState() {
    const [permissionState, setPermissionState] = useState<
        "default" | "granted" | "denied" | "unsupported" | "loading"
    >("loading");

    useEffect(() => {
        if (typeof window === "undefined" || !("Notification" in window)) {
            setPermissionState("unsupported");
            return;
        }
        setPermissionState(Notification.permission as "default" | "granted" | "denied");
    }, []);

    const request = useCallback(async (): Promise<boolean> => {
        if (!("Notification" in window)) return false;
        try {
            const perm = await Notification.requestPermission();
            setPermissionState(perm as "default" | "granted" | "denied");
            return perm === "granted";
        } catch {
            return false;
        }
    }, []);

    const dismiss = useCallback(() => {
        // Mark as "denied" locally so the banner hides for this session.
        // (Not persisted — will reappear on next login if still 'default')
        setPermissionState("denied");
    }, []);

    return { permissionState, request, dismiss };
}
