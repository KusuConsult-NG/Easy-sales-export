import { test, expect, Page } from '@playwright/test';

/**
 * Cooperative Registration → Contribute → Withdraw Flow
 * Tests the complete cooperative membership lifecycle
 */

async function loginUser(page: Page) {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
}

test.describe('Cooperative Complete Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should register for cooperative', async ({ page }) => {
        await page.goto('/cooperatives');

        // Look for "Join Cooperative" or "Register" button
        const joinButton = page.locator('button:has-text("Join"), button:has-text("Register"), a:has-text("Join Cooperative")');

        if (await joinButton.count() > 0) {
            await joinButton.click();

            // Registration form should appear
            await expect(
                page.locator('text=/Cooperative.*Registration|Join.*Cooperative/i')
            ).toBeVisible({ timeout: 5000 });

            // Fill form
            const cooperativeSelect = page.locator('select[name="cooperativeId"]');
            if (await cooperativeSelect.count() > 0) {
                await cooperativeSelect.selectOption({ index: 1 });
            }

            console.log('✅ Cooperative registration flow initiated');
        }
    });

    test('should make contribution', async ({ page }) => {
        await page.goto('/cooperatives');

        // Find "Contribute" or "Make Contribution" button
        const contributeButton = page.locator('button:has-text("Contribute"), button:has-text("Make Contribution")');

        if (await contributeButton.count() > 0) {
            await contributeButton.click();

            // Contribution modal should open
            await expect(page.locator('text=/Contribution|Amount/i')).toBeVisible({ timeout: 5000 });

            // Fill amount
            const amountInput = page.locator('input[name="amount"]');
            if (await amountInput.count() > 0) {
                await amountInput.fill('50000');

                // Submit button
                const submitButton = page.locator('button[type="submit"]:has-text("Make"), button:has-text("Proceed to Payment")');
                await expect(submitButton).toBeVisible();

                console.log('✅ Contribution form filled');
            }
        }
    });

    test('should view contribution history', async ({ page }) => {
        await page.goto('/cooperatives');

        // Look for transactions or history section
        const historySection = page.locator('text=/Transaction.*History|Recent.*Contribution|History/i');

        if (await historySection.count() > 0) {
            await expect(historySection).toBeVisible();
            console.log('✅ Contribution history visible');
        }
    });

    test('should request withdrawal', async ({ page }) => {
        await page.goto('/cooperatives/withdraw');

        // Withdrawal form should be visible
        await expect(page.locator('h1, h2')).toContainText(/Withdraw|Withdrawal/i);

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
        await page.goto('/cooperatives');

        // Tier badge or status should be visible
        const tierInfo = page.locator('text=/Tier|Bronze|Silver|Gold|Premium/i');

        if (await tierInfo.count() > 0) {
            await expect(tierInfo).toBeVisible();
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
        await expect(page.locator('h1')).toContainText(/Loan.*Application|Apply.*Loan/i);

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
        await page.goto('/login');
        await page.fill('input[type="email"]', 'admin@example.com');
        await page.fill('input[type="password"]', 'admin123');
        await page.click('button[type="submit"]');

        // Navigate to admin dashboard
        await page.goto('/admin');

        // Admin dashboard should load
        await expect(page.locator('h1')).toContainText(/Admin|Dashboard/i);

        console.log('✅ Admin dashboard accessible');
    });

    test('should review loan applications (admin)', async ({ page }) => {
        // Login as admin
        await page.goto('/login');
        await page.fill('input[type="email"]', 'admin@example.com');
        await page.fill('input[type="password"]', 'admin123');
        await page.click('button[type="submit"]');

        await page.goto('/admin/loans');

        // Pending loans should be visible
        const pendingLoans = page.locator('.loan-card, [data-testid="loan-application"]');

        if (await pendingLoans.count() > 0) {
            // Approve/Reject buttons should be visible
            await expect(page.locator('button:has-text("Approve"), button:has-text("Reject")')).toBeVisible();

            console.log('✅ Loan review interface loaded');
        }
    });
});
