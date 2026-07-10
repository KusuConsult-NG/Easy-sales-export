import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

/**
 * WAVE Program Application Flow
 * Tests the multi-step application process
 */

test.describe('WAVE Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Increase timeout to 90s for this flow to accommodate Next.js compilation time on dev server
        test.setTimeout(90000);
        // Login first
        await loginAs(page, USERS.user.email, USERS.user.password);
    });

    test('User can complete WAVE application', async ({ page }) => {
        // Generate random unique NIN and BVN for each run
        const randomNin = '123' + Math.floor(10000000 + Math.random() * 90000000);
        const randomBvn = '222' + Math.floor(10000000 + Math.random() * 90000000);

        // Mock BVN verification API to avoid live KYC failures
        await page.route('**/api/kyc/verify-bvn', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    isMatch: true
                })
            });
        });

        // Navigate to WAVE application
        await page.goto('/wave/application');

        // Step 1: Personal Details
        await page.fill('label:has-text("Surname (as on NIN)") + input', 'Doe');
        await page.fill('label:has-text("First Name (as on NIN)") + input', 'Jane');
        await page.fill('label:has-text("Date of Birth") + input', '1995-05-15');
        await page.fill('label:has-text("Phone Number (Primary)") + input', '080' + Math.floor(10000000 + Math.random() * 90000000));
        await page.fill('textarea[placeholder="Your current residential address"]', '123 Farm Road, Kaduna');

        await page.selectOption('label:has-text("State of Origin") + select', 'Kaduna');
        await page.selectOption('label:has-text("Local Government Area (LGA)") + select', 'Kaduna North');
        await page.selectOption('label:has-text("State of Residence") + select', 'Kaduna');
        await page.selectOption('label:has-text("Local Government of Residence") + select', 'Kaduna North');

        await page.check('input[name="maritalStatus"][value="single"]');

        await page.fill('label:has-text("Next of Kin Name") + input', 'John Doe');
        await page.fill('label:has-text("Next of Kin Phone Number") + input', '08033334444');
        await page.fill('label:has-text("Relationship with Next of Kin") + input', 'Brother');

        await page.click('button:has-text("Continue to Civic Status")');

        // Step 2: Civic Status
        await page.fill('input[placeholder="Enter your NIN"]', randomNin);

        await page.fill('input[placeholder="e.g. 90F5B123456789012345"]', 'VIN123456789');
        await page.check('label:has-text("Yes") input[name="votedInLastElection"]');

        await page.click('button:has-text("Continue")');

        // Step-3: Socio-Economic
        await page.selectOption('label:has-text("Highest Level of Education") + select', 'tertiary');
        await page.fill('label:has-text("Current Occupation") + input', 'Farmer');
        await page.selectOption('label:has-text("Average Monthly Income") + select', '50k_100k');
        await page.check('label:has-text("Yes") input[name="involvedInAgriculture"]');
        await page.check('label:has-text("Farming") input[type="checkbox"]');

        await page.click('button:has-text("Continue")');

        // Step 4: Agri Interest
        await page.check('label:has-text("Crop Production") input[type="checkbox"]');
        await page.check('label:has-text("Maize") input[type="checkbox"]');
        await page.check('label:has-text("No") input[name="hasAccessToFarmland"]');

        await page.click('button:has-text("Continue")');

        // Step 5: Financial
        await page.fill('label:has-text("Bank Name") + input', 'Zenith Bank');
        await page.fill('label:has-text("Account Number") + input', '1234567890');
        await page.fill('input[placeholder="Enter BVN"]', randomBvn);
        await page.click('button:has-text("Verify")');
        await expect(page.locator('p:has-text("BVN verified successfully")')).toBeVisible({ timeout: 15000 });

        await page.check('label:has-text("No") input[name="isMemberOfCooperative"]');
        await page.check('label:has-text("Yes") input[name="willingToJoinCooperative"]');

        await page.click('button:has-text("Continue")');

        // Step 6: Training
        await page.check('label:has-text("Training") input[type="checkbox"]');
        await page.check('label:has-text("Yes") input[name="willingToUndergoTraining"]');
        await page.check('label:has-text("Yes") input[name="willingToComplyWithStandards"]');
        await page.check('label:has-text("Yes") input[name="willingToParticipateInME"]');

        await page.click('button:has-text("Continue to Review")');

        // Capture console errors
        page.on('console', msg => {
            console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
        });

        // Step 7: Review & Submit
        await expect(page.locator('h2:has-text("Review & Submit Application")')).toBeVisible({ timeout: 15000 });
        await page.check('label:has-text("Declaration of Truthfulness") input[type="checkbox"]');
        await page.check('label:has-text("Consent for Data Processing") input[type="checkbox"]');

        // Mock the submission response intercept if needed, or rely on integration
        // For real end-to-end, we click submit
        await page.click('button:has-text("Submit Application")');

        try {
            // Verify Redirection
            // Should go to success page or review pending
            await expect(page).toHaveURL(/.*\/wave\/application\/success|.*review-pending/, { timeout: 40000 });
        } catch (err) {
            // If the URL redirect fails, print visible toast/alert content to console
            const toastContent = await page.locator('.sonner-toast, div[role="status"], div[role="alert"]').allTextContents().catch(() => []);
            console.log('--- SUBMISSION TIMEOUT DEBUG ---');
            console.log('Visible toasts/alerts:', toastContent);
            console.log('Current URL:', page.url());
            throw err;
        }

        // Verify Content
        await expect(page.locator('text=Your WAVE Registration Is Submitted')).toBeVisible({ timeout: 30000 });
    });
});
