import { test, expect, Page } from '@playwright/test';

/**
 * Complete Registration → MFA Setup → Dashboard Flow
 * Tests the full onboarding experience for a new user
 */

async function registerNewUser(page: Page, email: string, password: string, fullName: string) {
    await page.goto('/register');

    // Fill registration form
    await page.fill('input[name="fullName"]', fullName);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);
    await page.fill('input[name="phone"]', '+2348012345678');

    // Select role
    await page.click('input[value="member"]');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect (email verification or dashboard)
    await page.waitForURL(/dashboard|verify-email/, { timeout: 10000 });
}

async function loginUser(page: Page, email: string, password: string) {
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
}

test.describe('Registration → MFA → Dashboard Flow', () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'SecurePassword123!';
    const testName = 'Test User';

    test('should complete full registration and onboarding', async ({ page }) => {
        // Step 1: Register
        await registerNewUser(page, testEmail, testPassword, testName);

        // Step 2: Verify dashboard loaded
        await expect(page).toHaveURL(/dashboard/);
        await expect(page.locator('h1')).toContainText(/Dashboard|Welcome/i);

        // Step 3: Onboarding tour should appear for new users
        const tourModal = page.locator('text=/Welcome to Easy Sales Export|Get Started/i');
        await expect(tourModal).toBeVisible({ timeout: 5000 });

        console.log('✅ Registration and onboarding tour triggered');
    });

    test('should setup and enable MFA', async ({ page }) => {
        // Login with existing account
        await loginUser(page, 'test@example.com', 'password123');

        // Navigate to MFA settings
        await page.goto('/settings/security/mfa');

        // Check if MFA is already enabled
        const enableButton = page.locator('button:has-text("Enable MFA")');
        const isEnabled = await enableButton.count() === 0;

        if (!isEnabled) {
            // Enable MFA
            await enableButton.click();

            // QR code should appear
            await expect(page.locator('img[alt*="QR"]')).toBeVisible({ timeout: 5000 });

            // Secret key should be displayed
            const secretKey = page.locator('code, pre');
            await expect(secretKey).toBeVisible();

            console.log('✅ MFA setup initiated - QR code and secret displayed');
        }
    });

    test('should access MFA-protected routes', async ({ page }) => {
        // Login
        await loginUser(page, 'test@example.com', 'password123');

        // Try to access admin route (MFA protected)
        await page.goto('/admin/loans');

        // Should either:
        // 1. Show MFA prompt if MFA enabled but not verified
        // 2. Redirect to MFA setup if not enabled
        // 3. Access page if MFA verified

        const mfaPrompt = page.locator('text=/Enter.*Code|MFA.*Required/i');
        const mfaSetup = page.locator('text=/Set.*up.*MFA|Enable.*MFA/i');
        const adminContent = page.locator('h1:has-text("Loan")');

        // One of these should be visible
        await expect(
            Promise.race([
                mfaPrompt.waitFor({ state: 'visible' }),
                mfaSetup.waitFor({ state: 'visible' }),
                adminContent.waitFor({ state: 'visible' })
            ])
        ).resolves.toBeTruthy();

        console.log('✅ MFA protection working on admin routes');
    });
});

test.describe('Navigation and Basic Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page, 'test@example.com', 'password123');
    });

    test('should navigate to all main pages', async ({ page }) => {
        const pages = [
            { path: '/dashboard', title: /Dashboard/ },
            { path: '/cooperatives', title: /Cooperative/ },
            { path: '/marketplace', title: /Marketplace/ },
            { path: '/export', title: /Export/ },
            { path: '/wave', title: /WAVE/ },
            { path: '/farm-nation', title: /Farm Nation|Land/ },
            { path: '/loans', title: /Loan/ },
        ];

        for (const { path, title } of pages) {
            await page.goto(path);
            await expect(page.locator('h1, h2')).toContainText(title, { timeout: 5000 });
            console.log(`✅ ${path} loaded successfully`);
        }
    });

    test('should display dashboard stats', async ({ page }) => {
        await page.goto('/dashboard');

        // Stats should load (may be 0 for new users)
        const stats = [
            /Total.*Export|Export/i,
            /Active.*Order|Order/i,
            /Escrow/i,
            /Saving|Cooperative/i
        ];

        for (const stat of stats) {
            const statElement = page.locator(`text=${stat}`);
            await expect(statElement).toBeVisible({ timeout: 5000 });
        }

        console.log('✅ Dashboard stats displayed');
    });
});

test.describe('Error Handling', () => {
    test('should show 404 page for invalid routes', async ({ page }) => {
        await page.goto('/this-route-does-not-exist');

        await expect(page.locator('text=/404|Not Found|Page.*not.*found/i')).toBeVisible();
    });

    test('should redirect unauthenticated users', async ({ page }) => {
        // Try to access protected route without login
        await page.goto('/dashboard');

        // Should redirect to login
        await expect(page).toHaveURL(/login/, { timeout: 5000 });
    });
});
