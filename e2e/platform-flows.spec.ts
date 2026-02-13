import { test, expect } from '@playwright/test';

/**
 * Farm Nation E2E Tests
 */

test.describe('Farm Nation Property Listings', () => {
    test('User can browse properties', async ({ page }) => {
        await page.goto('/farm-nation');

        // Verify property grid is visible
        await expect(page.locator('[data-testid="property-grid"]')).toBeVisible();

        // Filter by sale type
        await page.click('button:has-text("For Sale")');
        await expect(page.url()).toContain('type=sale');

        // Apply price filter
        await page.fill('input[name="minPrice"]', '1000000');
        await page.fill('input[name="maxPrice"]', '5000000');
        await page.click('text=Apply Filters');

        // Verify filtered results
        await expect(page.locator('[data-testid="property-card"]').first()).toBeVisible();
    });

    test('Seller can list a new property', async ({ page }) => {
        // Login as seller
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', 'seller@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Navigate to list property
        await page.goto('/farm-nation/list-land');

        // Fill property details
        await page.fill('input[name="title"]', 'Prime Agricultural Land in Kano');
        await page.fill('textarea[name="description"]', 'Fertile land perfect for rice farming');
        await page.fill('input[name="location"]', 'Kano, Nigeria');
        await page.fill('input[name="size"]', '50');
        await page.selectOption('select[name="sizeUnit"]', 'hectares');
        await page.fill('input[name="price"]', '15000000');
        await page.selectOption('select[name="propertyType"]', 'sale');

        // Add amenities
        await page.check('input[value="water_source"]');
        await page.check('input[value="electricity"]');

        // Upload images (mock)
        const fileInput = await page.locator('input[type="file"]');
        await fileInput.setInputFiles([
            { name: 'land1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image1') },
            { name: 'land2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image2') }
        ]);

        // Submit
        await page.click('button:has-text("Submit for Verification")');

        // Verify success
        await expect(page.locator('text=Property submitted successfully')).toBeVisible();
    });
});

test.describe('Academy Course Enrollment', () => {
    test('User can enroll and complete a course', async ({ page }) => {
        // Login
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', 'student@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Browse courses
        await page.goto('/academy');
        await page.click('[data-testid="course-card"]').first();

        // Enroll
        await page.click('text=Enroll Now');

        // Start first lesson
        await page.click('text=Start Learning');
        await page.click('[data-testid="lesson-item"]').first();

        // Complete lesson
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await page.click('text=Mark as Complete');

        // Verify progress
        await expect(page.locator('text=1 of').first()).toBeVisible();
    });

    test('User can take quiz and get certificate', async ({ page }) => {
        // Login and navigate to course with quiz
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', 'student@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        await page.goto('/academy/courses/test-course');

        // Take quiz
        await page.click('text=Take Final Quiz');

        // Answer questions (assuming multiple choice)
        await page.click('input[name="q1"][value="correct_answer"]');
        await page.click('input[name="q2"][value="correct_answer"]');
        await page.click('input[name="q3"][value="correct_answer"]');

        // Submit quiz
        await page.click('button:has-text("Submit Quiz")');

        // Verify pass and certificate download
        await expect(page.locator('text=Congratulations')).toBeVisible();
        await expect(page.locator('text=Download Certificate')).toBeVisible();
    });
});

test.describe('Admin Workflows', () => {
    test('Admin can resolve dispute', async ({ page }) => {
        // Login as admin
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', 'admin@easysales.com');
        await page.fill('input[name="password"]', 'adminpassword123');
        await page.click('button[type="submit"]');

        // Navigate to disputes
        await page.goto('/admin/marketplace/disputes');

        // Open dispute
        await page.click('[data-testid="dispute-row"]').first();

        // Review evidence
        await expect(page.locator('text=Evidence')).toBeVisible();

        // Resolve in favor of buyer
        await page.click('text=Rule in Favor of Buyer');
        await page.fill('textarea[name="resolutionNote"]', 'Evidence clearly shows product damage. Refund authorized.');
        await page.click('text=Resolve Dispute');

        // Success
        await expect(page.locator('text=Dispute resolved successfully')).toBeVisible();
    });
});
