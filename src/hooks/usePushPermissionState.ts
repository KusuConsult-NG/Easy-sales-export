"use client";

import { useState, useEffect, useCallback } from "react";

const DISMISSED_KEY = "push_banner_dismissed_v1";

/**
 *   #416 A HOOK FOR A FEATURE THIS PLATFORM DOES NOT HAVE.
 *
 *   NOT WIRED, AND NOTHING TO WIRE IT TO. Nothing imports this hook. More to
 *   the point, the browser push feature it front-ends does not exist anywhere
 *   in this repository:
 *
 *     - no service worker (no `navigator.serviceWorker`, no sw.js in public/)
 *     - no `pushManager` / `PushSubscription` anywhere
 *     - no collection or column storing a push subscription
 *     - no web-push dependency and no sender
 *
 *   This file is the ONLY mention of the Notification API in src.
 *
 *   WHY THAT MATTERS RATHER THAN BEING HARMLESS. Wiring the banner alone is a
 *   one-line change, and it would ask every member for browser notification
 *   permission that the platform can then never use — and a permission prompt
 *   dismissed or denied is not re-askable. It looks finished, which is what
 *   makes it worth a note rather than silence. #384's class: scaffolding that
 *   reads as a feature.
 *
 *   KEPT, NOT DELETED — the standing rule on this codebase. It is a correct
 *   reader of Notification.permission and is the right starting point the day
 *   push is actually built. What it needs first is the other half: a service
 *   worker, a subscription store, and something that sends.
 *
 *   ONE THING TO FIX WHEN IT IS BUILT. `dismiss()` records the dismissal as
 *   `"denied"`, which is the browser's word for "the user blocked us". They are
 *   not the same state and a screen that explains one will mis-explain the
 *   other — and the localStorage key is permanent, so a member who waves the
 *   banner away once can never be offered push again from that browser.
 *
 *
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

      const nativePerm = window.Notification.permission as
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
      const perm = await window.Notification.requestPermission();
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
