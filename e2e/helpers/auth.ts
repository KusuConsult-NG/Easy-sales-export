import { Page, expect } from '@playwright/test';

/**
 * loginAs — Performs a full login flow and waits for redirect.
 * Extracts the per-test login pattern used throughout the suite.
 */
export async function loginAs(
    page: Page,
    email: string,
    password: string,
    { expectUrl }: { expectUrl?: RegExp | string } = {}
): Promise<void> {
    await page.goto('/auth/login');
    await page.waitForLoadState('load');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    if (expectUrl) {
        await page.waitForURL(expectUrl, { timeout: 45000 });
    } else {
        await page.waitForURL(/\/dashboard|\/auth\/get-started|\/marketplace|\/academy|\/cooperatives|\/wave|\/export|\/farm-nation|\/admin/, { timeout: 45000 });
    }
    await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });
}

/**
 * The identities the suite logs in as.
 *
 * THESE WERE REAL PRODUCTION ACCOUNTS, WITH THEIR REAL PASSWORDS, COMMITTED HERE
 * -----------------------------------------------------------------------------
 * The five module personas were `marketplaceuser04@gmail.com`,
 * `academyuser02@gmail.com`, `cooperativeuser02@gmail.com`,
 * `waveuser02@gmail.com` and `exportwindowuser@gmail.com`, each with a working
 * password in plain text. Two consequences, and both bit:
 *
 *   1. Anyone with read access to this repository had five live logins to the
 *      production platform. Those passwords must be treated as compromised and
 *      rotated, regardless of what happens to this file.
 *
 *   2. The suite could only ever pass against production, because those
 *      accounts exist nowhere else. Seven specs failed on a local stack for
 *      exactly this reason — login stayed on /auth/login and every
 *      waitForURL timed out after 45 seconds, which reads like a broken login
 *      rather than a missing fixture.
 *
 * They are seeded identities now, created by scripts/seed-local.ts with the
 * serviceRegistrations each module dashboard requires. Every value is
 * overridable by environment variable so a staging run can supply its own
 * without editing code — which is the mechanism that should have existed
 * instead of hardcoding production.
 *
 * NOTHING HERE IS A SECRET. These credentials only work against a database
 * seeded by scripts/seed-local.ts, which refuses to run against any host that
 * is not localhost.
 */
export const USERS = {
    /** Approved for marketplace → lands on /marketplace/buyer/dashboard */
    buyer:       { email: process.env.TEST_BUYER_EMAIL       || 'e2e.buyer@easysalesexport.com',       password: process.env.TEST_BUYER_PASSWORD       || 'E2eBuyer@2024!' },
    /** Approved for academy → lands on /academy/dashboard */
    academy:     { email: process.env.TEST_ACADEMY_EMAIL     || 'e2e.academy@easysalesexport.com',     password: process.env.TEST_ACADEMY_PASSWORD     || 'E2eAcademy@2024!' },
    /**
     * A SECOND academy identity, so two specs do not enrol the same learner.
     *
     * Enrolment is not idempotent from the learner's side — a course already
     * started shows "Resume" where a spec expects "Enroll" — so courses.spec.ts
     * and platform-flows.spec.ts fought over one persona and the second to run
     * failed. Each has its own now.
     */
    academy2:    { email: process.env.TEST_ACADEMY2_EMAIL    || 'e2e.academy2@easysalesexport.com',    password: process.env.TEST_ACADEMY2_PASSWORD    || 'E2eAcademy@2024!' },
    /** Approved for cooperatives → lands on /cooperatives/dashboard */
    cooperative: { email: process.env.TEST_COOPERATIVE_EMAIL || 'e2e.cooperative@easysalesexport.com', password: process.env.TEST_COOPERATIVE_PASSWORD || 'E2eCoop@2024!' },
    /** Approved for wave → lands on /wave/dashboard */
    wave:        { email: process.env.TEST_WAVE_EMAIL        || 'e2e.wave@easysalesexport.com',        password: process.env.TEST_WAVE_PASSWORD        || 'E2eWave@2024!' },
    /** Approved for export → lands on /export/dashboard */
    export:      { email: process.env.TEST_EXPORT_EMAIL      || 'e2e.export@easysalesexport.com',      password: process.env.TEST_EXPORT_PASSWORD      || 'E2eExport@2024!' },
    /** Approved seller, owns the seeded marketplace products */
    seller:      { email: process.env.TEST_SELLER_EMAIL      || 'e2e.seller@easysalesexport.com',      password: process.env.TEST_SELLER_PASSWORD      || 'E2eSeller@2024!' },
    /** No module approval — lands on the generic hub at /dashboard */
    user:        { email: process.env.TEST_USER_EMAIL        || 'e2e.user@easysalesexport.com',        password: process.env.TEST_USER_PASSWORD        || 'E2eTest@2024!' },
    admin:       { email: process.env.TEST_ADMIN_EMAIL       || 'e2e.admin@easysalesexport.com',       password: process.env.TEST_ADMIN_PASSWORD       || 'E2eAdmin@2024!' },
} as const;
