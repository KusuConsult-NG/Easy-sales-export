import type { Page } from '@playwright/test';

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
