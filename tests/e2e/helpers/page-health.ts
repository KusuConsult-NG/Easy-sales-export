import { expect, type Page } from '@playwright/test';

/**
 * Detects failures a page can suffer while still looking fine to a weak
 * assertion.
 *
 * WHY THIS EXISTS
 * ---------------
 * The smoke suite passed all seven specs on a run where every data fetch on
 * the pages under test was failing. `getMarketplaceProductsAction` threw
 * `fetch failed`, safe-action caught it and returned `{ error }`, the page
 * rendered its error banner, and the response was still HTTP 200. The
 * assertions — "URL is not /auth/", "body is not empty" — were true of a page
 * showing nothing but an error.
 *
 * So a status-code check alone is not enough: the interesting failures are
 * caught server-side and reported in the DOM, not in the status line. This
 * helper covers the two that never reach the DOM at all, and specs assert on
 * rendered state for the rest.
 *
 * WHAT IT CATCHES
 *   - uncaught exceptions in the page (a crashed client component)
 *   - same-origin 5xx responses (a route handler or server action that blew up
 *     before it could be caught)
 *
 * WHAT IT DELIBERATELY IGNORES
 *   - cross-origin requests: third-party availability is not what these specs
 *     are testing, and failing on it makes the suite flaky for no signal
 *   - /monitoring: the Sentry tunnel, which is expected to fail when Sentry is
 *     not configured
 *   - console.error: too noisy to gate on. React logs hydration and key
 *     warnings that are real but not what a smoke test should block on.
 */
export interface PageHealth {
    /** Throws with a readable summary if anything was recorded. */
    assertClean(): void;
    /** Everything recorded so far, for specs that want to inspect rather than assert. */
    problems(): string[];
}

const IGNORED_PATHS = [
    '/monitoring',      // Sentry tunnel — expected to fail without a Sentry DSN
    '/favicon.ico',
];

export function watchPageHealth(page: Page, baseURL = 'http://localhost:3000'): PageHealth {
    const problems: string[] = [];

    page.on('pageerror', err => {
        problems.push(`Uncaught exception in page: ${err.message}`);
    });

    page.on('response', res => {
        if (res.status() < 500) return;

        const url = res.url();
        if (!url.startsWith(baseURL)) return;                      // third party
        if (IGNORED_PATHS.some(p => url.includes(p))) return;

        problems.push(`HTTP ${res.status()} from ${url.replace(baseURL, '')}`);
    });

    return {
        problems: () => [...problems],
        assertClean() {
            if (problems.length === 0) return;
            throw new Error(
                `Page reported ${problems.length} failure(s) that a URL or ` +
                `non-empty-body assertion would not have caught:\n` +
                problems.map(p => `  - ${p}`).join('\n')
            );
        },
    };
}

/**
 * The text a page has actually RENDERED, once it has rendered anything.
 *
 *   #711 EVERY CALLER OF THIS USED TO READ innerText ONCE, IMMEDIATELY, AND
 *        WAS PASSING FOR THE WRONG REASON.
 *
 *   `innerText` is the rendered text — it reflects layout, and returns '' for
 *   content the browser has parsed but not laid out. Measured on /privacy at
 *   the moment those assertions fired:
 *
 *       textContent  18,308 chars     the page IS server-rendered
 *       innerText         0 chars     none of it is laid out yet
 *       innerText (+2s)   2,343       once layout has happened
 *
 *   So "the body is not empty" never distinguished a component throwing during
 *   render — the thing it was written to catch — from layout not having
 *   finished. What held it up was the AI chat widget: a fixed element drawn on
 *   every page, outside the containers hidden until hydration, supplying the
 *   only rendered text at that instant. When #708 stopped drawing it for
 *   signed-out visitors, 92 of these assertions failed at once, on pages that
 *   render perfectly.
 *
 *   Polling keeps the property and drops the accident. A page that genuinely
 *   renders nothing still fails — that is what the timeout is for — and one
 *   that is merely slower than a turn of the event loop no longer does.
 *
 *   ONE helper rather than five copies: the five call sites had five spellings
 *   of the same unsound check, which is why fixing the first would have left
 *   four.
 */
export async function renderedText(
    page: Page,
    route: string,
    timeoutMs = 15_000,
): Promise<string> {
    const body = page.locator('body');
    await expect(body).toBeVisible();

    await expect
        .poll(async () => ((await body.innerText().catch(() => '')) || '').trim().length,
            { timeout: timeoutMs, message: `${route} rendered an empty page` })
        .toBeGreaterThan(0);

    return ((await body.innerText().catch(() => '')) || '').trim();
}
