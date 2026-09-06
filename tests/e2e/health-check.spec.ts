import { test, expect } from '@playwright/test';

/**
 * System Health Diagnostic E2E Test
 * 
 * Verifies that the admin diagnostic suite is operational and reports health status correctly.
 * This serves as a "smoke test" for platform infrastructure.
 */

test.describe('System Health Diagnostic Suite', () => {
    
    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
        // Authenticate as admin
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_ADMIN_EMAIL || 'e2e.admin@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_ADMIN_PASSWORD || 'E2eAdmin@2024!');
        await page.click('button[type="submit"]');
        
        // Wait for login to complete and redirect to admin/dashboard
        await page.waitForURL(/\/admin|\/dashboard/, { timeout: 45000 });
        await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });
        await page.goto('/admin/system-health');
    });

    test('should load the health dashboard and display metrics', async ({ page }) => {
        // Check if the dashboard header is visible
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/System Health Monitor/i);

        // Wait for the diagnostic loading state to complete
        await expect(page.locator('text=Running platform-wide structural tests...').first()).not.toBeVisible({ timeout: 30000 });
        
        // Verify infrastructure service status section
        await expect(page.locator('text=Infrastructure Connectivity')).toBeVisible();
        
        // Check for specific service indicators (Redis, Firestore, Paystack, Resend)
        await expect(page.locator('text=Upstash Redis')).toBeVisible();
        await expect(page.locator('text=Cloud Firestore')).toBeVisible();
        await expect(page.locator('text=Paystack API')).toBeVisible();
        await expect(page.locator('text=Resend Mail')).toBeVisible();
        
        // Verify Data Integrity metrics
        await expect(page.locator('text=Orphaned Apps')).toBeVisible();

        // #440 removed the "Desynced Regs" tile. Its number came from
        // `const desyncedRegs = 0;` — declared zero and never computed — so the
        // tile issued a clean bill of health without looking, and THIS
        // ASSERTION PASSED ON IT. The cross-module questions are answered by
        // the forensic scan, which can report "inconclusive"; the tile now
        // links there. Asserted on the link so the panel cannot silently
        // disappear the way the number silently lied.
        await expect(page.locator('text=Cross-module checks')).toBeVisible();
        await expect(page.getByRole('link', { name: /forensic scan/i })).toHaveAttribute(
            'href', '/admin/forensics');
        
        // Verify Feature Toggles
        await expect(page.locator('text=Feature Activation States')).toBeVisible();
    });

    test('should trigger a fresh diagnostic run', async ({ page }) => {
        // Wait for the initial diagnostic loading to finish first
        await expect(page.locator('text=Running platform-wide structural tests...').first()).not.toBeVisible({ timeout: 30000 });

        // Find and click the refresh/run button
        const runButton = page.getByRole('button', { name: /run diagnostic/i });
        await expect(runButton).toBeVisible();
        await runButton.click();
        
        // Expect a loading state
        await expect(page.locator('text=Running platform-wide structural tests...').first()).toBeVisible();
        
        // Wait for loading to finish
        await expect(page.locator('text=Running platform-wide structural tests...').first()).not.toBeVisible({ timeout: 30000 });
    });
});
