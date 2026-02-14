import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * Tests login, logout, and session management
 */

test.describe('Authentication', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to login page before each test
        await page.goto('/cooperatives/login');
    });

    test('should display login page correctly', async ({ page }) => {
        await expect(page).toHaveTitle(/Easy Sales Export/);
        await expect(page.locator('h1')).toContainText('Welcome Back');
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.fill('input[name="email"]', 'invalid@example.com');
        await page.fill('input[name="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Wait for error message (include "attempts" for rate limit errors)
        await expect(page.locator('text=/invalid|error|incorrect|failed|attempts/i')).toBeVisible({ timeout: 10000 });
    });

    test('should show error for empty fields', async ({ page }) => {
        // Disable HTML5 validation to test server-side validation
        await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) form.noValidate = true;
        });

        await page.click('button[type="submit"]');

        // Should see validation errors
        await expect(page.locator('text=/required|email|password|invalid/i')).toBeVisible();
    });

    // NOTE: Actual login test requires valid test credentials
    // Uncomment and configure when test account is available
    // test('should login successfully with valid credentials', async ({ page }) => {
    //   await page.fill('input[name="email"]', 'test@example.com');
    //   await page.fill('input[name="password"]', 'testpassword123');
    //   await page.click('button[type="submit"]');
    //   
    //   // Should redirect to dashboard
    //   await expect(page).toHaveURL('/dashboard');
    //   await expect(page.locator('text=Dashboard')).toBeVisible();
    // });
});
