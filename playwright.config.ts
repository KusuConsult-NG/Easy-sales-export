import { defineConfig, devices } from '@playwright/test';

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
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const chromiumLaunch = CHROMIUM_PATH
    ? { launchOptions: { executablePath: CHROMIUM_PATH } }
    : {};

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
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
    ],

    webServer: {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
