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
        test.setTimeout(60000);
        // 1. Registration
        await page.goto('/auth/register');
        await page.fill('input[name="fullName"]', 'Test Buyer');
        await page.fill('input[name="email"]', testEmail);
        await page.fill('input[name="phone"]', testPhone);
        await page.fill('input[name="password"]', 'Password123!');
        await page.fill('input[name="confirmPassword"]', 'Password123!');
        await page.selectOption('select[name="gender"]', 'Female');
        await page.click('button[type="submit"]');

        // 2. Expect redirect to Get Started (Module Selection)
        await expect(page).toHaveURL(/\/auth\/get-started/, { timeout: 15000 });
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Choose Your Module');

        // 3. Select Marketplace
        await page.click('text=Marketplace');
        await expect(page).toHaveURL(/\/marketplace\/onboarding/, { timeout: 15000 });

        // 4. Step 1: Account Type (Buyer)
        await page.click('text=Buyer');
        await page.click('button:has-text("Continue")');

        // 5. Step 2: Business Profile
        //
        //   ADDRESSED BY ID, NOT BY POSITION. This read
        //   `page.locator('select').first()` for the State, and a Business
        //   Status select was added above it — so `.first()` resolved to the
        //   new control and the test spent sixty seconds looking for "Lagos"
        //   among its three options. A positional locator on a form is a test
        //   that breaks the next time anybody adds a field, which is not what
        //   it is here to detect.
        await page.fill('input[placeholder="Enter your business or farm name"]', 'Test Buyer Business');
        // Business type defaults to 'individual', which is correct, so no need to click.
        await page.selectOption('#businessStatus', 'registered');
        await page.fill('input[placeholder="08012345678"]', testPhone);
        await page.selectOption('#state', 'Lagos');
        await page.selectOption('#lga', 'Ikeja');
        await page.fill('textarea[placeholder="Enter your complete business address"]', '123 Test Street, Ikeja');
        await page.click('button:has-text("Continue")');

        // 6. Step 3: Product Interests
        //   These two set `buyerInterests`, which is now required of a buyer —
        //   the step used to be enforced by nothing but its own button, and
        //   that button is skippable via a restored draft. A seller would also
        //   have to answer Product Status here; a buyer does not, because it
        //   describes goods she is not selling.
        await page.click('button:has-text("Grains & Cereals")');
        await page.click('button:has-text("Roots & Tubers")');
        await page.click('button:has-text("Continue")');

        // 7. Step 4: Terms
        await page.locator('input[type="checkbox"]').check();
        await page.click('button:has-text("Complete Registration")');

        // 8. Expect redirect to Buyer Dashboard
        await expect(page).toHaveURL(/\/marketplace\/buyer\/dashboard/, { timeout: 15000 });
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Buyer Dashboard');
    });
});
