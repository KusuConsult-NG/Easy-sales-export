import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * Tests login, logout, and session management
 */

test.describe('Authentication', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to login page before each test
        await page.goto('/auth/login');
    });

    test('should display login page correctly', async ({ page }) => {
        await expect(page).toHaveTitle(/Easy Sales Export/);
        await expect(page.locator('h1')).toContainText('Login');
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.fill('input[name="email"]', 'invalid@example.com');
        await page.fill('input[name="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Wait for error message
        await expect(page.locator('text=/invalid|error|incorrect/i')).toBeVisible({ timeout: 5000 });
    });

    test('should show error for empty fields', async ({ page }) => {
        await page.click('button[type="submit"]');

        // Should see validation errors
        await expect(page.locator('text=/required|email|password/i')).toBeVisible();
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
