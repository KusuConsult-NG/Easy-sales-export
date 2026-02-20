"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A global observer that automatically scrolls newly rendered
 * error/success messages into view across the entire application.
 * This ensures users on mobile don't miss feedback after submitting forms.
 */
export default function GlobalScrollWatcher() {
    const pathname = usePathname();
    const isReady = useRef(false);

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
        const observer = new MutationObserver((mutations) => {
            if (!isReady.current) return;

            let targetToScroll: Element | null = null;

            for (const mutation of mutations) {
                if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                    for (const node of Array.from(mutation.addedNodes)) {
                        if (node instanceof HTMLElement) {
                            // Helper to check if a class string indicates a message block
                            const isMessageBlock = (className: string) => {
                                if (typeof className !== 'string') return false;

                                const isErrorText = className.includes("text-red-600") || className.includes("text-red-500");
                                const isAlertBox = (className.includes("bg-red-50") || className.includes("bg-green-50") || className.includes("bg-red-500/10")) &&
                                    (className.includes("border") || className.includes("p-4") || className.includes("p-3") || className.includes("px-4"));

                                return isErrorText || isAlertBox;
                            };

                            // Check if the newly added node itself is a message
                            if ((isMessageBlock(node.className) || (node.id && node.id.includes("message"))) && (node.innerText?.trim().length > 0)) {
                                targetToScroll = node;
                                break;
                            }

                            // Otherwise, search inside the added node
                            const childMessage = node.querySelector?.('.text-red-600, .text-red-500, .bg-red-50.border, .bg-green-50.border, .bg-red-50.p-4, .bg-green-50.p-4, [id$="message"]');
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
    }, []);

    return null;
}
