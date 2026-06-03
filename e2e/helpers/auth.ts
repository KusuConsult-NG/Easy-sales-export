import { Page } from '@playwright/test';

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
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    if (expectUrl) {
        await page.waitForURL(expectUrl, { timeout: 15000 });
    } else {
        // Wait for any post-login redirect (dashboard, get-started, module)
        await page.waitForURL(/\/dashboard|\/auth\/get-started|\/marketplace|\/academy|\/cooperatives/, { timeout: 15000 });
    }
}

/** Pre-approved module users (seeded with serviceRegistrations.status = 'approved') */
export const USERS = {
    buyer:       { email: 'marketplaceuser04@gmail.com',  password: 'Marketplace@2026' },
    academy:     { email: 'academyuser02@gmail.com',      password: '@2025Easysales!' },
    cooperative: { email: 'cooperativeuser02@gmail.com',  password: 'Cooperative@2026' },
    wave:        { email: 'waveuser02@gmail.com',         password: 'WAVE@2026' },
    export:      { email: 'exportwindowuser@gmail.com',   password: 'Exportwindow@2026' },
    // General test users (new, no module approval)
    user:        { email: 'e2e.user@easysalesexport.test',  password: 'E2eTest@2024!' },
    admin:       { email: 'e2e.admin@easysalesexport.test', password: 'E2eAdmin@2024!' },
} as const;
