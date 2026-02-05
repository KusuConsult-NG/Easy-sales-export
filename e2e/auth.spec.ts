import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
    test('should login successfully with valid credentials', async ({ page }) => {
        // 1. Go to login page
        await page.goto('/login');

        // 2. Verify login page loaded
        await expect(page).toHaveTitle(/Easy Sales Export/);
        await expect(page.locator('h1')).toContainText(/Login|Sign In/i);

        // 3. Fill in credentials
        await page.fill('input[type="email"]', 'test@example.com');
        await page.fill('input[type="password"]', 'password123');

        // 4. Submit form
        await page.click('button[type="submit"]');

        // 5. Wait for redirect to dashboard
        await page.waitForURL('/dashboard', { timeout: 10000 });

        // 6. Verify dashboard loaded
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.locator('h1')).toContainText(/Dashboard|Welcome/i);

        console.log('✅ Login successful');
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/login');

        // Try invalid email
        await page.fill('input[type="email"]', 'invalid@example.com');
        await page.fill('input[type="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Should see error message
        const errorMessage = page.locator('text=Invalid credentials');
        await expect(errorMessage).toBeVisible({ timeout: 5000 });

        // Should still be on login page
        await expect(page).toHaveURL(/\/login/);
    });

    test('should navigate to registration page', async ({ page }) => {
        await page.goto('/login');

        // Click "Create account" link
        await page.click('text=Create account');

        // Should redirect to register page
        await expect(page).toHaveURL(/\/register/);
        await expect(page.locator('h1')).toContainText(/Register|Sign Up|Create Account/i);
    });
});

test.describe('Dashboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Login before each test
        await page.goto('/login');
        await page.fill('input[type="email"]', 'test@example.com');
        await page.fill('input[type="password"]', 'password123');
        await page.click('button[type="submit"]');
        await page.waitForURL('/dashboard');
    });

    test('should display user stats on dashboard', async ({ page }) => {
        // Verify stats cards are visible
        const statsCards = page.locator('[data-testid="stat-card"]');
        await expect(statsCards).toHaveCount(4, { timeout: 5000 });

        // Check for stat labels
        await expect(page.locator('text=Total Contributions')).toBeVisible();
        await expect(page.locator('text=Active Loans')).toBeVisible();
    });

    test('should navigate to loans page', async ({ page }) => {
        // Click Loans nav item
        await page.click('text=Loans');

        // Verify URL changed
        await expect(page).toHaveURL(/\/loans/);

        // Verify loans page loaded
        await expect(page.locator('h1')).toContainText(/Loans|Loan Applications/i);
    });
});
