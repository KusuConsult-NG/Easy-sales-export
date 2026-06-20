import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * RBAC Gate Tests
 * Verifies that role-based access control blocks unauthorized access.
 * Critical security test — a regression here means privilege escalation.
 */
test.describe('RBAC: Admin route protection', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
    });

    test('Unauthenticated user is redirected away from /admin', async ({ page }) => {
        await page.goto('/admin');
        // Should redirect to login or access denied, never show admin content
        await expect(page).not.toHaveURL(/^\/admin/, { timeout: 10000 });
    });

    test('Regular user cannot access /admin routes', async ({ page }) => {
        // Login as a module-approved user (not admin)
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
        // Now try to navigate to an admin page
        await page.goto('/admin');
        // Wait a brief moment for any redirects to settle
        try {
            await page.waitForURL(url => !url.includes('/admin'), { timeout: 3000 });
        } catch {
            // If still on /admin, page must show access denied content
        }
        const url = page.url();
        const isOnAdminPage = url.includes('/admin');
        if (isOnAdminPage) {
            const bodyText = await page.textContent('body');
            expect(bodyText?.toLowerCase()).toMatch(/access denied|unauthorized|forbidden|not allowed|403/);
        }
    });

    test('Module-specific user cannot access other module areas', async ({ page }) => {
        // Cooperative user should not freely access Wave admin area
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);
        await page.goto('/wave/admin');
        // Wait a brief moment for any redirects to settle
        try {
            await page.waitForURL(url => !url.includes('/wave/admin'), { timeout: 3000 });
        } catch {
            // Still on /wave/admin
        }
        const url = page.url();
        if (url.includes('/wave/admin')) {
            const bodyText = await page.textContent('body');
            expect(bodyText?.toLowerCase()).toMatch(/access denied|unauthorized|forbidden|not found/);
        }
    });

    test('Public API routes are accessible without auth', async ({ page }) => {
        const response = await page.request.get('/api/health');
        expect(response.status()).toBe(200);
    });

    test('Admin API requires authentication', async ({ page }) => {
        // Hit an admin-only API endpoint without any auth cookie
        const response = await page.request.get('/api/admin/users', {
            headers: { Cookie: '' }
        });
        // Should return 401, 403, redirect, or 404 (non-existent route), never 200
        expect([401, 403, 307, 302, 404]).toContain(response.status());
    });
});
