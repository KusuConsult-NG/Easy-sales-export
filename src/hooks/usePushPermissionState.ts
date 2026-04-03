"use client";

import { useState, useEffect, useCallback } from "react";

const DISMISSED_KEY = "push_banner_dismissed_v1";

/**
 * usePushPermissionState — reads the current Notification.permission without
 * prompting the user. Returns one of:
 *   'default'     — user hasn't been asked yet   → show the banner
 *   'granted'     — already enabled               → no banner
 *   'denied'      — user blocked notifications    → no banner (nothing we can do)
 *   'unsupported' — browser doesn't support it    → no banner
 *
 * Dismissal is persisted to localStorage so the banner does not reappear
 * on every page navigation within the same browser session.
 */
export function usePushPermissionState() {
  const [permissionState, setPermissionState] = useState<
    "default" | "granted" | "denied" | "unsupported" | "loading"
  >("loading");

  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        setPermissionState("unsupported");
        return;
      }

      const nativePerm = Notification.permission as
        | "default"
        | "granted"
        | "denied";

      // If the user already granted or denied at browser level, respect that
      if (nativePerm !== "default") {
        setPermissionState(nativePerm);
        return;
      }

      // Check if the user dismissed the banner in this browser (persisted)
      try {
        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (dismissed === "true") {
          setPermissionState("denied"); // treat as dismissed — hide banner
          return;
        }
      } catch {
        // localStorage may be unavailable in some environments (private mode)
      }

      setPermissionState("default");
    });
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
    // Persist dismissal so banner does not reappear on next page navigation
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Ignore if localStorage is unavailable
    }
    setPermissionState("denied");
  }, []);

  return { permissionState, request, dismiss };
}
