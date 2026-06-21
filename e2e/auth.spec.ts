import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
    test('should login successfully with valid credentials', async ({ page }) => {
        // 1. Go to login page
        await page.goto('/login');
        await page.waitForLoadState('load');

        // 2. Verify login page loaded
        await expect(page).toHaveTitle(/Easy Sales Export/);
        await expect(page.locator('h1')).toContainText(/Login|Sign In|Welcome Back/i);

        // 3. Fill in credentials
        await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.com');
        await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');

        // 4. Submit form
        await page.click('button[type="submit"]');

        // 5. Wait for redirect to dashboard
        await page.waitForURL(/\/dashboard/, { timeout: 30000 });
        await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });

        // 6. Verify dashboard loaded
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.locator('text=Loading dashboard...').first()).not.toBeVisible({ timeout: 20000 });
        await expect(page.locator('h1').first()).toContainText(/Dashboard|Welcome|Hello/i, { timeout: 15000 });

        console.log('✅ Login successful');
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('load');

        // Try invalid email
        await page.fill('input[type="email"]', 'invalid@example.com');
        await page.fill('input[type="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Should see error message
        const errorMessage = page.locator('text=Invalid credentials')
            .or(page.locator('text=Invalid email or password'))
            .or(page.locator('text=Email address not registered.'));
        await expect(errorMessage).toBeVisible({ timeout: 5000 });

        // Should still be on login page
        await expect(page).toHaveURL(/\/login/);
    });

    test('should navigate to registration page', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('load');

        // Click "Create account" link
        await page.click('text=Create account');

        // Should redirect to register page
        await expect(page).toHaveURL(/\/register/);
        await expect(page.locator('h1, h2').first()).toContainText(/Register|Sign Up|Create Account/i);
    });
});

test.describe('Dashboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Login before each test
        await page.goto('/login');
        await page.waitForLoadState('load');
        await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.com');
        await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');
        await page.click('button[type="submit"]');
        await page.waitForURL('/dashboard');
        await expect(page.locator('h1, h2, [data-testid="stat-card"], main').first()).toBeVisible({ timeout: 15000 });
    });

    test('should display user stats on dashboard', async ({ page }) => {
        // Wait for dashboard to finish loading
        await expect(page.locator('text=Loading dashboard...').first()).not.toBeVisible({ timeout: 20000 });

        // Verify stats cards are visible
        const statsCards = page.locator('[data-testid="stat-card"]');
        await expect(statsCards).toHaveCount(4, { timeout: 15000 });

        // Check for stat labels
        await expect(page.locator('text=Total Savings')).toBeVisible();
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
