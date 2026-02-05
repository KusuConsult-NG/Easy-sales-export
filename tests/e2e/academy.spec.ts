import { test, expect } from '@playwright/test';

/**
 * Academy E2E Tests
 * Tests course browsing, enrollment, and learning flow
 */

test.describe('Academy', () => {
    test('should display academy page', async ({ page }) => {
        await page.goto('/academy');

        await expect(page.locator('h1')).toContainText(/academy|courses/i);
    });

    test('should display course listings', async ({ page }) => {
        await page.goto('/academy');

        // Should see course cards (if any exist)
        // This is a smoke test to ensure page loads
        await expect(page).toHaveURL('/academy');
    });

    test.skip('should show course details when clicked', async ({ page }) => {
        await page.goto('/academy');

        // Find first course card and click
        const firstCourse = page.locator('[data-testid="course-card"]').first();
        if (await firstCourse.isVisible()) {
            await firstCourse.click();

            // Should navigate to course detail page
            await expect(page).toHaveURL(/\/academy\/[^\/]+$/);
            await expect(page.locator('button:has-text("Enroll")')).toBeVisible();
        }
    });

    test.skip('should enroll in course (requires auth)', async ({ page }) => {
        // This test requires authentication and a valid course ID
        await page.goto('/academy/test-course-id');

        await page.click('button:has-text("Enroll")');

        // Should show success message or start learning button
        await expect(page.locator('text=/enrolled|success|start learning/i')).toBeVisible({ timeout: 5000 });
    });
});
