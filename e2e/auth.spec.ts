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

    // These two asserted against a page that does not exist.
    //
    // /dashboard is the PLATFORM HUB: a greeting, three stat cards (Wallet
    // Balance, Unread Messages, Notifications) and a grid of module cards
    // linking to Academy, WAVE, Export, Marketplace, Cooperatives and Farm
    // Nation. It has never had "Total Savings" or "Active Loans", and it has no
    // "Loans" link — those belong to the COOPERATIVE dashboard at
    // /cooperatives/dashboard, which is where the four stat cards live.
    //
    // So the old tests expected four cards where there are three, two labels
    // that are on another page, and a nav item that is not rendered. They were
    // written against an earlier UI and never updated, and because the suite
    // had never been runnable nothing said so.
    //
    // Both pages are covered now, each asserting what it actually shows.

    test('should display the platform hub stats', async ({ page }) => {
        await expect(page.locator('text=Loading dashboard...').first()).not.toBeVisible({ timeout: 20000 });

        const statsCards = page.locator('[data-testid="stat-card"]');
        await expect(statsCards).toHaveCount(3, { timeout: 15000 });

        await expect(page.getByText('Wallet Balance')).toBeVisible();
        await expect(page.getByText('Unread Messages')).toBeVisible();
    });

    test('should list the platform modules', async ({ page }) => {
        // The hub's actual job: routing a member to the modules they hold.
        await expect(page.getByRole('heading', { name: 'Platform Modules' })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Cooperatives' })).toBeVisible();
    });

    test('should reach the cooperative dashboard, where savings and loans live', async ({ page }) => {
        // The navigation the old "should navigate to loans page" was reaching
        // for. The seeded member has an active cooperative membership, so this
        // card routes them to the dashboard rather than to onboarding.
        await page.getByRole('heading', { name: 'Cooperatives' }).click();

        await expect(page).toHaveURL(/\/cooperatives/, { timeout: 20000 });
        await expect(page.locator('[data-testid="stat-card"]').first()).toBeVisible({ timeout: 20000 });
    });
});
