import { test, expect } from '@playwright/test';

/**
 * WAVE Program Application Flow
 * Tests the multi-step application process
 */

test.describe('WAVE Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Login first
        await page.goto('/login');
        await page.fill('input[name="email"]', 'wave_applicant@test.com');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/.*dashboard/);
    });

    test('User can complete WAVE application', async ({ page }) => {
        // Navigate to WAVE application
        await page.goto('/wave/application');

        // Step 1: Personal Details
        await page.fill('input[name="firstName"]', 'Jane');
        await page.fill('input[name="surname"]', 'Doe');
        await page.fill('input[name="phone"]', '08012345678');
        await page.fill('textarea[name="residentialAddress"]', '123 Farm Road, Kaduna');
        await page.selectOption('select[name="stateOfResidence"]', 'Kaduna');
        await page.click('button:has-text("Next")');

        // Step 2: Civic Status
        await page.fill('input[name="nin"]', '12345678901');
        await page.fill('input[name="votersCardNumber"]', 'VIN123456789');
        await page.check('input[name="votedInLastElection"]'); // Yes
        await page.click('button:has-text("Next")');

        // Step 3: Socio-Economic
        await page.selectOption('select[name="highestEducation"]', 'tertiary');
        await page.fill('input[name="currentOccupation"]', 'Farmer');
        await page.check('input[name="involvedInAgriculture"]');
        await page.click('button:has-text("Next")');

        // Step 4: Agri Interest
        await page.check('input[value="crop_production"]');
        await page.check('input[value="maize"]');
        await page.click('button:has-text("Next")');

        // Step 5: Financial
        await page.check('input[name="hasBankAccount"]');
        await page.fill('input[name="bankName"]', 'Zenith Bank');
        await page.fill('input[name="accountNumber"]', '1234567890');
        await page.click('button:has-text("Next")');

        // Step 6: Training
        await page.check('input[value="training"]');
        await page.check('input[name="willingToUndergoTraining"]');
        await page.click('button:has-text("Next")');

        // Step 7: Review & Submit
        await expect(page.locator('h3:has-text("Review Your Application")')).toBeVisible();
        await page.check('input[name="declarationAccepted"]');
        await page.check('input[name="consentGiven"]');

        // Mock the submission response intercept if needed, or rely on integration
        // For real end-to-end, we click submit
        await page.click('button:has-text("Submit Application")');

        // Verify Redirection
        // Should go to success page or review pending
        await expect(page).toHaveURL(/.*\/wave\/application\/success|.*review-pending/);

        // Verify Content
        await expect(page.locator('text=Application Submitted')).toBeVisible();
    });
});
