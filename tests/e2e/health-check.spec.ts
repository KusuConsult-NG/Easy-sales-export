import { test, expect } from '@playwright/test';

/**
 * System Health Diagnostic E2E Test
 * 
 * Verifies that the admin diagnostic suite is operational and reports health status correctly.
 * This serves as a "smoke test" for platform infrastructure.
 */

test.describe('System Health Diagnostic Suite', () => {
    
    test.beforeEach(async ({ page }) => {
        // Authenticate as admin
        // Note: In a real CI environment, we would use a test admin account
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_ADMIN_EMAIL || process.env.TEST_ADMIN_EMAIL || 'e2e.admin@easysalesexport.test');
        await page.fill('input[name="password"]', process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');
        await page.click('button[type="submit"]');
        
        // Wait for login to complete and redirect to hub
        await expect(page).toHaveURL(/\/admin\/system-health/);
    });

    test('should load the health dashboard and display metrics', async ({ page }) => {
        await page.goto('/admin/system-health');
        
        // Check if the dashboard header is visible
        await expect(page.locator('h1')).toContainText('Platform Health & Diagnostics');
        
        // Verify infrastructure service status section
        await expect(page.locator('text=Infrastructure Service Connectivity')).toBeVisible();
        
        // Check for specific service indicators (Redis, Firestore, Paystack, Resend)
        await expect(page.locator('text=Redis Status')).toBeVisible();
        await expect(page.locator('text=Firestore Status')).toBeVisible();
        await expect(page.locator('text=Paystack Gateway')).toBeVisible();
        await expect(page.locator('text=Resend Email')).toBeVisible();
        
        // Verify Data Integrity metrics
        await expect(page.locator('text=Data Integrity Metrics')).toBeVisible();
        await expect(page.locator('text=Orphaned Applications')).toBeVisible();
        await expect(page.locator('text=Desynced Registrations')).toBeVisible();
        
        // Verify Feature Toggles
        await expect(page.locator('text=Live Feature Toggles')).toBeVisible();
    });

    test('should trigger a fresh diagnostic run', async ({ page }) => {
        await page.goto('/admin/system-health');
        
        // Find and click the refresh/run button
        // Looking for a button with "Run Diagnostic" or similar
        const runButton = page.getByRole('button', { name: /run diagnostic/i });
        if (await runButton.isVisible()) {
            await runButton.click();
            // Expect a loading state or success toast
            await expect(page.locator('text=Diagnostic Report Generated')).toBeVisible();
        }
    });
});
