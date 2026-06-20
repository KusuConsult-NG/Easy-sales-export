import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

/**
 * Farm Nation E2E Tests
 */

test.describe('Farm Nation Property Listings', () => {
    test('User can browse properties', async ({ page }) => {
        await page.goto('/farm-nation/properties');

        // Verify property grid is visible
        await expect(page.locator('[data-testid="property-grid"]')).toBeVisible();

        // Filter by sale type
        await page.locator('select:has(option[value="sale"])').selectOption('sale');

        // Apply price filter (under ₦20M)
        await page.locator('select:has(option[value="under-20m"])').selectOption('under-20m');

        // Verify filtered results
        await expect(page.locator('[data-testid="property-card"]').first()).toBeVisible();
    });

    test('Seller can list a new property', async ({ page }) => {
        // Login as seller
        await loginAs(page, 'e2e.seller@easysalesexport.com', 'E2eSeller@2024!');

        // Navigate to list property
        await page.goto('/farm-nation/list-land');

        // Fill property details
        await page.locator('input[placeholder="e.g., 50 Acres Farmland in Kaduna"]').fill('Prime Agricultural Land in Kano');
        await page.locator('button:has-text("Farmland")').first().click();
        await page.locator('textarea[placeholder*="Describe the land"]').fill('Fertile land perfect for rice farming');
        
        // Select state and fill LGA
        await page.locator('select').first().selectOption('Kano');
        await page.locator('input[placeholder="Enter LGA"]').fill('Kano Municipal');
        await page.locator('textarea[placeholder*="Full address with landmarks"]').fill('123 Farm Road, Kano');

        // Size and price per unit
        await page.locator('input[type="number"]').nth(0).fill('50');
        await page.locator('select').nth(1).selectOption('hectares');
        await page.locator('input[type="number"]').nth(1).fill('300000'); // total price = 50 * 300,000 = 15,000,000

        // Upload documents and photos
        await page.locator('div:has(label:has-text("Land Title Document"))').locator('input[type="file"]').setInputFiles([
            { name: 'title.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf-data') }
        ]);

        await page.locator('div:has(label:has-text("Survey Plan"))').locator('input[type="file"]').setInputFiles([
            { name: 'survey.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf-data') }
        ]);

        await page.locator('div:has(label:has-text("Land Photos"))').locator('input[type="file"]').setInputFiles([
            { name: 'land1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image1') },
            { name: 'land2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image2') }
        ]);

        // Submit
        const submitButton = page.locator('button:has-text("Submit Land Listing")');
        await expect(submitButton).toBeEnabled();
        await submitButton.click();

        // Verify success
        await expect(page.locator('text=submitted for verification').first()).toBeVisible({ timeout: 15000 });
    });
});

test.describe('Academy Course Enrollment', () => {
    test('User can enroll and complete a course', async ({ page }) => {
        // Login
        await loginAs(page, USERS.academy.email, USERS.academy.password);

        // Browse courses
        await page.goto('/academy/courses');

        // Wait for the loading state to resolve
        await expect(page.locator('text=Loading...')).not.toBeVisible({ timeout: 20000 });

        // Click on first course link
        const courseCards = page.locator('[data-testid="course-card"]');
        await expect(courseCards.first()).toBeVisible({ timeout: 10000 });
        await courseCards.first().locator('a').first().click();

        // Enroll if not already enrolled
        const enrollBtn = page.locator('button:has-text("Enroll Now")');
        if (await enrollBtn.isVisible()) {
            await enrollBtn.click();
        }

        // Start first lesson
        await page.locator('button:has-text("Learning")').first().click();
        
        // Wait for lesson page to load
        await page.waitForURL(/\/academy\/[a-zA-Z0-9_-]+\/lesson\/[a-zA-Z0-9_-]+/);

        // Complete lesson
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await page.click('text=Mark as Complete');

        // Verify progress
        await expect(page.locator('text=1 of').first()).toBeVisible({ timeout: 10000 });
    });

    test.skip('User can take quiz and get certificate', async ({ page }) => {
        // Skip course-level quiz as quizzes are module-specific in the current design
    });
});

test.describe('Admin Workflows', () => {
    test('Admin can resolve dispute', async ({ page }) => {
        // Login as admin
        await loginAs(page, 'e2e.admin@easysalesexport.com', 'E2eAdmin@2024!');

        // Navigate to disputes
        await page.goto('/admin/marketplace/disputes');

        // Open dispute
        await page.locator('button:has-text("Review Case")').first().click();

        // Review page loaded
        await expect(page.locator('text=/Buyer|Seller|Dispute/i').first()).toBeVisible({ timeout: 10000 });

        // Resolve in favor of buyer
        await page.click('button:has-text("Resolve Dispute")');
        await page.click('button:has-text("Refund Buyer (Full)")');
        await page.locator('textarea[placeholder*="Explain the reasoning"]').fill('Evidence clearly shows product damage. Refund authorized.');
        await page.click('button:has-text("Resolve & Close")');

        // Success
        await expect(page.locator('text=Dispute resolved successfully')).toBeVisible({ timeout: 10000 });
    });
});
