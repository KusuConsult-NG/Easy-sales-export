import { test, expect } from '@playwright/test';

/**
 * Role-Based Access Control (RBAC) Security Tests
 * 
 * Verifies that protected routes are gated correctly based on user roles.
 * Prevents unauthorized access to administrative and module-specific zones.
 */

test.describe('RBAC Security Enforcement', () => {
    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
    });
    
    test('unauthenticated users should be redirected to login from protected routes', async ({ page }) => {
        const protectedRoutes = [
            '/admin/system-health',
            '/marketplace/buyer/dashboard',
            '/academy/dashboard',
            '/cooperatives/onboarding'
        ];

        for (const route of protectedRoutes) {
            await page.goto(route);
            // Should be redirected to login with a callback URL
            await expect(page).toHaveURL(/\/auth\/login/);
        }
    });

    test('non-admin users should NOT access admin dashboard', async ({ page }) => {
        // Authenticate as a regular user
        await page.goto('/auth/login');
        await page.waitForLoadState('load');
        await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');
        await page.click('button[type="submit"]');
        await page.waitForURL(/dashboard|get-started|admin/, { timeout: 45000 });
        await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });

        // Attempt to access admin health page
        try {
            await page.goto('/admin/system-health');
        } catch (err: any) {
            if (!err.message.includes('net::ERR_ABORTED')) {
                throw err;
            }
        }
        
        // Should be redirected back to their respective module or hub
        // Based on getPostLoginRedirect logic, it might go to /auth/get-started or /
        await expect(page).not.toHaveURL(/\/admin\//);
    });

    test('admin users SHOULD access admin dashboard', async ({ page }) => {
        // Authenticate as admin
        await page.goto('/auth/login');
        await page.waitForLoadState('load');
        await page.fill('input[name="email"]', process.env.TEST_ADMIN_EMAIL || process.env.TEST_ADMIN_EMAIL || 'e2e.admin@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_ADMIN_PASSWORD || 'E2eAdmin@2024!');
        await page.click('button[type="submit"]');
        await page.waitForURL(/dashboard|get-started|admin/, { timeout: 45000 });
        await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });

        // Access admin health page
        await page.goto('/admin/system-health');
        await expect(page.getByRole('heading', { level: 1 })).toContainText('System Health Monitor');
    });
});
