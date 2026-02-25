"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A global observer that automatically scrolls newly rendered
 * error/success messages into view across the entire application.
 * This ensures users on mobile don't miss feedback after submitting forms.
 *
 * Excluded on public/landing pages to prevent false triggers from
 * static page sections that share CSS classes with message blocks.
 */

// Public pages where we should NEVER auto-scroll (they have static sections
// whose CSS classes overlap with the error/success message selectors)
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

    // Disable on public landing pages entirely
    const isExcluded = EXCLUDED_PATHS.some(p =>
        pathname === p || pathname.startsWith(p + '/')
    ) && !pathname.includes('/application') && !pathname.includes('/member');

    useEffect(() => {
        // Prevent scrolling on initial render to avoid jumpy page loads.
        // We only want to scroll to messages that appear dynamically (e.g. form submissions).
        isReady.current = false;
        const timer = setTimeout(() => {
            isReady.current = true;
        }, 1000);

        return () => clearTimeout(timer);
    }, [pathname]);

    useEffect(() => {
        // Don't attach the observer on excluded public pages
        if (isExcluded) return;

        const observer = new MutationObserver((mutations) => {
            if (!isReady.current) return;

            let targetToScroll: Element | null = null;

            for (const mutation of mutations) {
                if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                    for (const node of Array.from(mutation.addedNodes)) {
                        if (node instanceof HTMLElement) {
                            // Helper to check if a class string indicates a dynamic message block.
                            // We require BOTH a colour class AND a role/aria or data attribute to
                            // avoid matching static page sections that share the same colour classes.
                            const isMessageBlock = (el: HTMLElement) => {
                                const cls = el.className;
                                if (typeof cls !== 'string') return false;

                                const hasErrorColour = cls.includes("text-red-600") || cls.includes("text-red-500");
                                // For alert boxes: must have bg-red/green-50 + border + p-4,
                                // AND must be role="alert" or have data-message attribute to
                                // distinguish dynamic alerts from static section cards.
                                const isAlertBox =
                                    (cls.includes("bg-red-50") || cls.includes("bg-green-50")) &&
                                    cls.includes("border") &&
                                    (cls.includes("p-4") || cls.includes("p-3")) &&
                                    (el.getAttribute("role") === "alert" || el.dataset.message !== undefined);

                                return hasErrorColour || isAlertBox;
                            };

                            // Check if the newly added node itself is a message
                            if ((isMessageBlock(node) || (node.id && node.id.includes("message"))) &&
                                (node.innerText?.trim().length > 0)) {
                                targetToScroll = node;
                                break;
                            }

                            // Otherwise, search inside the added node — inline errors only
                            const childMessage = node.querySelector?.(
                                '.text-red-600, .text-red-500, [role="alert"], [data-message]'
                            );
                            if (childMessage && (childMessage as HTMLElement).innerText?.trim().length > 0) {
                                targetToScroll = childMessage;
                                break;
                            }
                        }
                    }
                }
                if (targetToScroll) break;
            }

            if (targetToScroll) {
                // Check if completely in viewport to avoid annoying micro-scrolls
                const rect = targetToScroll.getBoundingClientRect();
                const isVerticalVisible = (rect.top >= 0) && (rect.bottom <= window.innerHeight);

                if (!isVerticalVisible) {
                    // Let the browser finish painting, then scroll
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
