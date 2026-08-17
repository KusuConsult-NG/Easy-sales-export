import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectChromium } from './e2e/helpers/chromium';

/**
 * Playwright E2E Test Configuration
 *
 * Directory layout:
 *   e2e/            ← Full suite (auth-required, module flows)
 *   tests/e2e/      ← Smoke + RBAC (some tests are auth-required, some are public)
 *
 * Environment:
 *   PLAYWRIGHT_BASE_URL   Override base URL (e.g. staging URL in CI)
 *   TEST_USER_EMAIL       Regular test user email (default: e2e.user@easysalesexport.test)
 *   TEST_USER_PASSWORD    Regular test user password
 *   TEST_ADMIN_EMAIL      Admin test user email
 *   TEST_ADMIN_PASSWORD   Admin test user password
 *   TEST_BUYER_EMAIL      Marketplace buyer test email
 *   TEST_SELLER_EMAIL     Marketplace seller test email
 *
 * Projects:
 *   smoke     → tests/e2e/public-routes.spec.ts only — fast, no auth needed, runs on every PR
 *   full      → All specs in both e2e/ and tests/e2e/ — requires running server + seed data
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

/**
 * Use an already-installed Chromium when one is provided.
 *
 * Playwright pins an exact browser build per release, so a sandbox or CI image
 * that ships its own Chromium fails with "Executable doesn't exist at
 * .../chromium_headless_shell-<build>" even though a perfectly usable browser
 * is present. Downloading the pinned build is often not possible in those
 * environments, which is one reason this suite has never been run.
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH to the chrome binary to use it instead.
 * Unset, Playwright resolves its own download exactly as before.
 */
const CHROMIUM_PATH = detectChromium();
const chromiumLaunch = CHROMIUM_PATH
    ? { launchOptions: { executablePath: CHROMIUM_PATH } }
    : {};

/**
 * WebKit is a separate download, and the images that lack a matching Chromium
 * generally have no WebKit at all. Every spec in that project then fails on
 * browser launch, which buries the real results under ~70 identical errors —
 * the state this suite was in.
 *
 * So the project is included only when a WebKit build is actually present, and
 * its absence is announced rather than left to look like a pass.
 */
const WEBKIT_AVAILABLE = (() => {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
    try {
        return fs.readdirSync(root).some(entry => entry.startsWith('webkit-'));
    } catch {
        return false;
    }
})();

if (!WEBKIT_AVAILABLE) {
    console.warn(
        '[playwright] No WebKit build found — the "webkit" project is EXCLUDED from this run. ' +
        'Cross-browser coverage is NOT being checked. Run `npx playwright install webkit` to restore it.'
    );
}

export default defineConfig({
    // Default to full suite; override with --project=smoke for fast CI checks
    testDir: './',
    testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
    testIgnore: [
        'e2e/global-setup.ts',
        'e2e/global-teardown.ts',
    ],

    fullyParallel: false,           // Tests share state (logged-in sessions) — run serially
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? [['html'], ['github']] : 'html',
    timeout: 90000,

    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',

    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ignoreHTTPSErrors: true,
        // Pass test credentials to all specs via process.env
        // Specs read: process.env.TEST_USER_EMAIL || 'fallback'
    },

    projects: [
        // ── Smoke project: public routes only, no auth, fast ──────────────────
        {
            name: 'smoke',
            testMatch: ['tests/e2e/public-routes.spec.ts'],
            use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
        },

        // ── Full suite: Chromium (primary CI browser) ──────────────────────────
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
        },

        // ── Safari: run full suite cross-browser ───────────────────────────────
        // Only when a WebKit build exists — see WEBKIT_AVAILABLE above.
        ...(WEBKIT_AVAILABLE
            ? [{
                name: 'webkit',
                use: { ...devices['Desktop Safari'] },
            }]
            : []),
    ],

    webServer: {
        /**
         * A PRODUCTION BUILD, not `next dev`.
         *
         * WHY, measured rather than assumed:
         *
         *   `next dev` took 256 SECONDS to answer its first request on this
         *   machine, because Turbopack compiles each route on demand and the
         *   root page is the first one asked for. Then it does that again for
         *   every one of the ~205 pages the smoke suites visit, which is why
         *   full runs took 27–32 minutes.
         *
         *   A build compiles everything once. The server then answers
         *   immediately and every page is already built.
         *
         * This was not possible until sign-ins came down. consumeLoginAttempt
         * enforces 5 attempts per 15 minutes PER EMAIL once NODE_ENV is
         * production, and the suite used to sign in ~205 times, so a production
         * build would have rate-limited itself and the failures would have read
         * as broken authentication. global-setup now signs in nine times, once
         * per persona — comfortably inside the limit, and each a different
         * address.
         *
         * It also means the suite exercises what users actually get: the
         * production bundle, with production's rate limiting and no dev overlay.
         *
         * Override with PLAYWRIGHT_BASE_URL to point at a server you started
         * yourself; reuseExistingServer means an already-running one is adopted.
         */
        command: 'npm run build && npm run start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        /**
         * Build plus start, with room to spare.
         *
         * 120s failed here, then 300s failed too — and a webServer timeout
         * fails the ENTIRE run before a single test, which is an expensive way
         * to find out the machine was busy. The build is the long pole at a few
         * minutes; the server itself starts in seconds once it exists.
         */
        timeout: 900_000,
        /**
         * Both streams piped.
         *
         * stdout was 'ignore', which hid the one thing needed when this times
         * out: whether the server was starting slowly or failing outright. The
         * 300s timeout above produced a log with nothing in it but Sentry
         * deprecation notices.
         */
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
