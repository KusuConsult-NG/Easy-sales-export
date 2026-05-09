import { test, expect } from '@playwright/test';

/**
 * Onboarding Flow E2E Test
 * 
 * Verifies the full user journey from registration to module selection and onboarding completion.
 * This ensures that new users can successfully join the platform.
 */

test.describe('User Onboarding Journey', () => {
    const testEmail = `testuser_${Date.now()}@example.com`;
    const testPhone = `080${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;

    test('should complete the Marketplace Buyer onboarding flow', async ({ page }) => {
        // 1. Registration
        await page.goto('/auth/register');
        await page.fill('input[name="firstName"]', 'Test');
        await page.fill('input[name="lastName"]', 'Buyer');
        await page.fill('input[name="email"]', testEmail);
        await page.fill('input[name="phone"]', testPhone);
        await page.fill('input[name="password"]', 'Password123!');
        await page.fill('input[name="confirmPassword"]', 'Password123!');
        await page.click('button[type="submit"]');

        // 2. Expect redirect to Get Started (Module Selection)
        await expect(page).toHaveURL(/\/auth\/get-started/);
        await expect(page.locator('h1')).toContainText('Choose Your Module');

        // 3. Select Marketplace
        await page.click('text=Marketplace');
        await expect(page).toHaveURL(/\/marketplace\/onboarding/);

        // 4. Step 1: Account Type (Buyer)
        await page.click('text=Buyer');
        await page.click('button:has-text("Continue")');

        // 5. Step 2: Business Profile
        await page.fill('input[name="businessName"]', 'Test Buyer Business');
        await page.selectOption('select[name="businessType"]', 'individual');
        // Phone is pre-filled from registration usually, but let's be sure
        await page.fill('input[name="phone"]', testPhone);
        
        // Handle custom state/lga selectors if they are not standard selects
        // Assuming they are input fields or select for this test
        await page.fill('input[name="state"]', 'Lagos');
        await page.fill('input[name="lga"]', 'Ikeja');
        await page.fill('textarea[name="address"]', '123 Test Street, Ikeja');
        await page.click('button:has-text("Continue")');

        // 6. Step 3: Product Interests
        // Select some checkboxes
        await page.check('input[value="Grains"]');
        await page.check('input[value="Tubers"]');
        await page.click('button:has-text("Continue")');

        // 7. Step 4: Terms
        await page.check('input[name="termsAccepted"]');
        await page.click('button:has-text("Complete Onboarding")');

        // 8. Expect redirect to Buyer Dashboard
        await expect(page).toHaveURL(/\/marketplace\/buyer\/dashboard/);
        await expect(page.locator('h1')).toContainText('Buyer Dashboard');
    });
});
