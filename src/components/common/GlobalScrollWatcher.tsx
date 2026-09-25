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

/**
 * Public pages where we should NEVER auto-scroll.
 *
 *   #922 MATCHED AS A SUBTREE, AND THAT SWITCHED THIS OFF ON HALF THE
 *   APPLICATION — including every screen that has a form.
 *
 *   The test was
 *
 *       pathname === p || pathname.startsWith(p + '/')
 *
 *   with two escape hatches, `!pathname.includes('/application')` and
 *   `!pathname.includes('/member')`. So `/academy`, `/wave`, `/marketplace`,
 *   `/cooperatives`, `/farm-nation` and `/export` excluded their whole subtrees.
 *
 *   AND THE SECOND HATCH IS DEAD. Every member area in this app lives in a Next
 *   ROUTE GROUP — `(member)`, `(learner)`, `(app)` — and route groups are
 *   stripped from the URL. `/farm-nation/(member)/offers` is served at
 *   `/farm-nation/offers`, which contains no `/member` at all. Measured across
 *   all 254 pages: the only URLs containing `/member` are
 *   /admin/cooperatives/members and /admin/wave/members, and /admin was never on
 *   this list, so the clause could never un-exclude anything. It was written
 *   against the filesystem path, not the address.
 *
 *   WHAT THAT COST, counted: 122 of 254 pages were excluded — /academy/dashboard,
 *   /cooperatives/my-savings, /marketplace/seller/dashboard,
 *   /farm-nation/inquiries, /export/portfolio, every orders list, every savings
 *   screen. This component exists, in its own words, so that "users on mobile
 *   don't miss feedback after submitting forms", and it was off on the screens
 *   with the forms.
 *
 *   EXACT MATCH NOW, which is what this list's own heading describes: these
 *   PAGES, not their descendants. Nine pages instead of 122. Both hatches go
 *   with it — `/academy/application` is simply not equal to `/academy`.
 *
 *   The list already thought this way, which is the tell: `/wave/landing` is
 *   listed separately although the subtree rule made `/wave` cover it.
 *
 *   SAFE TO WIDEN BECAUSE THE GUARD BELOW IS STRICT. The subtree exclusion was
 *   compensating for a matcher that fired on bare colour classes; that was
 *   already replaced by an explicit role="alert" / data-message test, plus a
 *   1.5s readiness delay and a "skip if already on screen" check. A fixed-position
 *   toast is always in the viewport, so it is never scrolled to.
 */
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

    const isExcluded = EXCLUDED_PATHS.includes(pathname);

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
