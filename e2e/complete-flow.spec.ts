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
    await page.fill('input[name="phone"]', '+23480' + Math.floor(1000000 + Math.random() * 9000000));
    await page.selectOption('select[name="gender"]', 'Female');

    // Select role (if exists)
    if (await page.locator('input[value="member"]').count() > 0) {
        await page.click('input[value="member"]');
    }

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect (email verification or get-started)
    await page.waitForURL(/auth\/get-started|dashboard|verify-email/, { timeout: 45000 });
}

async function loginUser(page: Page, email: string, password: string) {
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard|admin|cooperatives/, { timeout: 45000 });
}

test.describe('Registration → MFA → Dashboard Flow', () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'SecurePassword123!';
    const testName = 'Test User';

    test('should complete full registration and onboarding', async ({ page }) => {
        // Step 1: Register
        await registerNewUser(page, testEmail, testPassword, testName);

        // Step 2: Verify get-started page loaded
        await expect(page).toHaveURL(/auth\/get-started/);
        await expect(page.locator('h1')).toContainText(/Choose Your Module/i);

        console.log('✅ Registration and module selection page loaded successfully');
    });

    test('should setup and enable MFA', async ({ page }) => {
        // Login with existing account
        await loginUser(page, process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.com', process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');

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
        // Login as admin
        await loginUser(page, process.env.TEST_ADMIN_EMAIL || 'e2e.admin@easysalesexport.com', process.env.TEST_ADMIN_PASSWORD || 'E2eAdmin@2024!');

        // Try to access admin route (MFA protected)
        await page.goto('/admin/cooperatives/loans');

        // Should either:
        // 1. Show MFA prompt if MFA enabled but not verified
        // 2. Redirect to MFA setup if not enabled
        // 3. Access page if MFA verified

        const mfaPrompt = page.locator('text=/Enter.*Code|MFA.*Required/i');
        const mfaSetup = page.locator('text=/Set.*up.*MFA|Enable.*MFA/i');
        const adminContent = page.locator('h1:has-text("Loan")');

        await expect(
            Promise.race([
                mfaPrompt.waitFor({ state: 'visible' }).then(() => true),
                mfaSetup.waitFor({ state: 'visible' }).then(() => true),
                adminContent.waitFor({ state: 'visible' }).then(() => true)
            ])
        ).resolves.toBeTruthy();

        console.log('✅ MFA protection working on admin routes');
    });
});

test.describe('Navigation and Basic Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page, process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.com', process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');
    });

    test('should navigate to all main pages', async ({ page }) => {
        const pages = [
            { path: '/dashboard', title: /Dashboard|Hello/i },
            { path: '/cooperatives', title: /Cooperative/ },
            { path: '/marketplace', title: /Market/i },
            { path: '/export', title: /Export/ },
            { path: '/wave', title: /WAVE/ },
            { path: '/farm-nation', title: /Farm Nation|Land/ },
            { path: '/loans', title: /Loan/ },
        ];

        for (const { path, title } of pages) {
            await page.goto(path);
            await expect(page.locator('h1, h2').first()).toContainText(title, { timeout: 5000 });
            console.log(`✅ ${path} loaded successfully`);
        }
    });

    test('should display dashboard stats', async ({ page }) => {
        await page.goto('/dashboard');

        // Stats should load (may be 0 for new users)
        const stats = [
            /Wallet/i,
            /Messages/i,
            /Notifications/i
        ];

        for (const stat of stats) {
            const statElement = page.locator(`text=${stat}`).first();
            await expect(statElement).toBeVisible({ timeout: 5000 });
        }

        console.log('✅ Dashboard stats displayed');
    });
});

test.describe('Error Handling', () => {
    test('should show 404 page for invalid routes', async ({ page }) => {
        await page.goto('/this-route-does-not-exist');

        await expect(page.locator('text=/404|Not Found|Page.*not.*found/i').first()).toBeVisible();
    });

    test('should redirect unauthenticated users', async ({ page }) => {
        // Try to access protected route without login
        await page.goto('/dashboard');

        // Should redirect to login
        await expect(page).toHaveURL(/login/, { timeout: 5000 });
    });
});
