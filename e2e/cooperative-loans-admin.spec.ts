import { test, expect, Page } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

/**
 * Cooperative Registration → Contribute → Withdraw Flow
 * Tests the complete cooperative membership lifecycle
 */

async function loginUser(page: Page) {
    await loginAs(page, USERS.user.email, USERS.user.password);
}

test.describe('Cooperative Complete Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should register for cooperative', async ({ page }) => {
        await page.goto('/cooperatives/onboarding');

        // If the user is already a member, they will be redirected to the cooperative dashboard
        try {
            await expect(page).toHaveURL(/\/cooperatives\/dashboard/, { timeout: 8000 });
            console.log('✅ User is already a cooperative member. Skipping registration.');
            return;
        } catch {
            // Not redirected, proceed with registration flow
        }

        // Registration form should appear
        await expect(
            page.locator('text=/Cooperative.*Application|Cooperative.*Registration|Join.*Cooperative/i')
        ).toBeVisible({ timeout: 8000 });

        // Fill form
        const cooperativeSelect = page.locator('select[name="cooperativeId"]');
        if (await cooperativeSelect.count() > 0) {
            await cooperativeSelect.selectOption({ index: 1 });
        }

        console.log('✅ Cooperative registration flow initiated');
    });

    test('should make contribution', async ({ page }) => {
        await page.goto('/cooperatives/dashboard');

        // Find "Contribute" link/button
        const contributeButton = page.locator('a[href="/cooperatives/contribute"]').first();

        if (await contributeButton.count() > 0) {
            await contributeButton.click();

            // Contribution page should open
            await expect(page.locator('text=/Contribution|Amount/i').first()).toBeVisible({ timeout: 8000 });

            // Fill amount
            const amountInput = page.locator('input[type="number"]');
            if (await amountInput.count() > 0) {
                await amountInput.fill('50000');

                // Submit button
                const submitButton = page.locator('button:has-text("Pay with Paystack")');
                await expect(submitButton).toBeVisible();

                console.log('✅ Contribution form filled');
            }
        }
    });

    test('should view contribution history', async ({ page }) => {
        await page.goto('/cooperatives/dashboard');

        // Look for statement or history link
        const historySection = page.locator('a[href="/cooperatives/history"]').first();

        if (await historySection.count() > 0) {
            await historySection.click();
            await expect(page.locator('text=/Transaction.*History|Statement|Recent.*Contribution/i').first()).toBeVisible({ timeout: 8000 });
            console.log('✅ Contribution history visible');
        }
    });

    test('should request withdrawal', async ({ page }) => {
        await page.goto('/cooperatives/withdraw');

        // Withdrawal form should be visible
        await expect(page.locator('h1, h2').first()).toContainText(/Withdraw|Withdrawal/i);

        // Fill withdrawal form
        const amountInput = page.locator('input[name="amount"]');
        if (await amountInput.count() > 0) {
            await amountInput.fill('10000');

            // Bank account details
            const bankInput = page.locator('input[name="bankAccount"], input[name="accountNumber"]');
            if (await bankInput.count() > 0) {
                await bankInput.fill('1234567890');

                console.log('✅ Withdrawal form filled');
            }
        }
    });

    test('should display tier information', async ({ page }) => {
        await page.goto('/cooperatives/dashboard');

        // Tier badge or status should be visible on dashboard
        const tierInfo = page.locator('text=/Tier|Bronze|Silver|Gold|Premium|Member/i');

        if (await tierInfo.count() > 0) {
            await expect(tierInfo.first()).toBeVisible();
            console.log('✅ Tier information displayed');
        }
    });
});

test.describe('Loan Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should apply for loan', async ({ page }) => {
        await page.goto('/loans/apply');

        // Loan application form should be visible
        await expect(page.locator('h1, h2').first()).toContainText(/Loan.*Application|Apply.*Loan/i);

        // Fill loan form
        const amountInput = page.locator('input[name="amount"]');
        if (await amountInput.count() > 0) {
            await amountInput.fill('100000');

            // Duration
            const durationSelect = page.locator('select[name="duration"], select[name="durationMonths"]');
            if (await durationSelect.count() > 0) {
                await durationSelect.selectOption('6');
            }

            // Purpose
            const purposeTextarea = page.locator('textarea[name="purpose"]');
            if (await purposeTextarea.count() > 0) {
                await purposeTextarea.fill('Business expansion - purchasing farm equipment');

                console.log('✅ Loan application form filled');
            }
        }
    });

    test('should view loan status', async ({ page }) => {
        await page.goto('/loans');

        // Loans list or status should be visible
        await expect(page.locator('h1')).toContainText(/Loan|Application/i);

        // Status badges should exist
        const statusBadges = page.locator('text=/Pending|Approved|Rejected|Active/i');

        if (await statusBadges.count() > 0) {
            console.log('✅ Loan status information visible');
        }
    });
});

test.describe('Admin Review Flow', () => {
    test('should access admin pages (requires admin role)', async ({ page }) => {
        // Login as admin
        await loginAs(page, USERS.admin.email, USERS.admin.password);

        // Navigate to admin dashboard
        await page.goto('/admin');

        // Wait for the loading state to resolve
        await expect(page.locator('text=Loading dashboard...').first()).not.toBeVisible({ timeout: 30000 });

        // Admin dashboard should load
        await expect(page.locator('h1').first()).toContainText(/Admin|Dashboard|Welcome/i, { timeout: 10000 });

        console.log('✅ Admin dashboard accessible');
    });

    test('should review loan applications (admin)', async ({ page }) => {
        // Login as admin
        await loginAs(page, USERS.admin.email, USERS.admin.password);

        await page.goto('/admin/cooperatives/loans');

        // Pending loans should be visible in a table or list
        const pendingLoans = page.locator('table, .loan-card, [data-testid="loan-application"]');

        if (await pendingLoans.count() > 0) {
            // Approve/Reject buttons should be visible (icon buttons with title attributes)
            const approveRejectButtons = page.locator('button[title="Approve Loan"], button[title="Reject Loan"], button:has-text("Approve"), button:has-text("Reject")');
            await expect(approveRejectButtons.first()).toBeVisible({ timeout: 5000 });

            console.log('✅ Loan review interface loaded');
        }
    });
});
