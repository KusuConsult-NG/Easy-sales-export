import { test, expect } from '@playwright/test';

test.describe('Loan Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Login
        await page.goto('/login');
        await page.fill('input[type="email"]', 'test@example.com');
        await page.fill('input[type="password"]', 'password123');
        await page.click('button[type="submit"]');
        await page.waitForURL('/dashboard');
    });

    test('should complete loan application successfully', async ({ page }) => {
        // 1. Navigate to loans page
        await page.goto('/loans');

        // 2. Click "Apply for Loan" button
        await page.click('text=Apply for Loan');

        // 3. Wait for application form
        await page.waitForURL('/loans/apply');
        await expect(page.locator('h1')).toContainText(/Apply for Loan/i);

        // 4. Fill out loan application form
        await page.fill('input[name="amount"]', '50000');
        await page.fill('textarea[name="purpose"]', 'Sesame farming expansion');
        await page.selectOption('select[name="duration"]', '6');

        // 5. Submit application
        await page.click('button[type="submit"]');

        // 6. Wait for success message or redirect
        await page.waitForTimeout(2000);

        // 7. Verify success (either toast or redirect to loans page)
        const successMessage = page.locator('text=Application submitted successfully');
        const successToast = page.locator('[role="status"]');

        await expect(successMessage.or(successToast)).toBeVisible({ timeout: 5000 });

        console.log('✅ Loan application submitted');
    });

    test('should show validation errors for invalid amounts', async ({ page }) => {
        await page.goto('/loans/apply');

        // Try to submit with zero amount
        await page.fill('input[name="amount"]', '0');
        await page.fill('textarea[name="purpose"]', 'Test');
        await page.click('button[type="submit"]');

        // Should see validation error
        const errorMessage = page.locator('text=Amount must be greater than 0');
        await expect(errorMessage).toBeVisible({ timeout: 3000 });
    });

    test('should display user eligibility information', async ({ page }) => {
        await page.goto('/loans/apply');

        // Check for eligibility info
        const eligibilityCard = page.locator('[data-testid="eligibility-info"]');
        await expect(eligibilityCard).toBeVisible({ timeout: 5000 });

        // Should show tier and max loan amount
        await expect(page.locator('text=Your Tier')).toBeVisible();
        await expect(page.locator('text=Max Loan Amount')).toBeVisible();
    });
});

test.describe('Loan Approval (Admin)', () => {
    test.beforeEach(async ({ page }) => {
        // Login as admin
        await page.goto('/login');
        await page.fill('input[type="email"]', 'admin@example.com');
        await page.fill('input[type="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await page.waitForURL('/dashboard');
    });

    test('should view and approve pending loan applications', async ({ page }) => {
        // 1. Navigate to admin loans page
        await page.goto('/admin/loans');

        // 2. Verify pending loans table
        const loansTable = page.locator('table');
        await expect(loansTable).toBeVisible({ timeout: 5000 });

        // 3. Find first pending loan and click approve
        const approveButton = page.locator('button:has-text("Approve")').first();

        if (await approveButton.isVisible()) {
            await approveButton.click();

            // 4. Confirm approval
            const confirmButton = page.locator('button:has-text("Confirm")');
            if (await confirmButton.isVisible()) {
                await confirmButton.click();
            }

            // 5. Verify success message
            await expect(page.locator('text=Loan approved')).toBeVisible({ timeout: 5000 });

            console.log('✅ Loan approved by admin');
        } else {
            console.log('⚠️ No pending loans to approve');
        }
    });
});
