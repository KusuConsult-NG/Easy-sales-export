"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A global observer that automatically scrolls newly rendered
 * error/success messages into view across the entire application.
 * This ensures users on mobile don't miss feedback after submitting forms.
 *
 * IMPORTANT: Only scrolls to elements with an explicit role="alert" or
 * data-message attribute. Bare colour classes (text-red-600, bg-green-50 etc.)
 * are intentionally NOT matched here because they appear on stat cards,
 * badges, and table rows during data load — causing unwanted mid-page scrolls.
 */

// Public pages where we should NEVER auto-scroll
const EXCLUDED_PATHS = [
    '/',
    '/wave/landing',
    '/wave',
    '/export',
    '/marketplace',
    '/cooperatives',
    '/academy',
    '/farm-nation',
    '/contact',
];

export default function GlobalScrollWatcher() {
    const pathname = usePathname();
    const isReady = useRef(false);

    const isExcluded = EXCLUDED_PATHS.some(p =>
        pathname === p || pathname.startsWith(p + '/')
    ) && !pathname.includes('/application') && !pathname.includes('/member');

    useEffect(() => {
        // Prevent scrolling on initial render to avoid jumpy page loads.
        // Only scroll to messages that appear after user interaction (e.g. form submissions).
        isReady.current = false;
        const timer = setTimeout(() => {
            isReady.current = true;
        }, 1500);

        return () => clearTimeout(timer);
    }, [pathname]);

    useEffect(() => {
        if (isExcluded) return;

        const observer = new MutationObserver((mutations) => {
            if (!isReady.current) return;

            let targetToScroll: Element | null = null;

            for (const mutation of mutations) {
                if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                    for (const node of Array.from(mutation.addedNodes)) {
                        if (node instanceof HTMLElement) {
                            // STRICT guard: only respond to elements explicitly marked as
                            // dynamic feedback. role="alert" or data-message must be present.
                            // Do NOT match bare colour classes — they appear on stat cards,
                            // table rows, and badges during initial data load and will cause
                            // unwanted mid-page scroll on every page navigation.
                            const isExplicitAlert = (el: HTMLElement) =>
                                el.getAttribute("role") === "alert" ||
                                el.dataset.message !== undefined;

                            if (isExplicitAlert(node) && node.innerText?.trim().length > 0) {
                                targetToScroll = node;
                                break;
                            }

                            // Search for explicit alert descendants only
                            const childAlert = node.querySelector?.(
                                '[role="alert"], [data-message]'
                            );
                            if (childAlert && (childAlert as HTMLElement).innerText?.trim().length > 0) {
                                targetToScroll = childAlert;
                                break;
                            }
                        }
                    }
                }
                if (targetToScroll) break;
            }

            if (targetToScroll) {
                const rect = targetToScroll.getBoundingClientRect();
                const isVerticalVisible = (rect.top >= 0) && (rect.bottom <= window.innerHeight);

                if (!isVerticalVisible) {
                    setTimeout(() => {
                        targetToScroll?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 50);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [isExcluded]);

    return null;
}
