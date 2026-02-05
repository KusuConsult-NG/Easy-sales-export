import { test, expect } from '@playwright/test';

test.describe('Course Enrollment Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Login
        await page.goto('/login');
        await page.fill('input[type="email"]', 'test@example.com');
        await page.fill('input[type="password"]', 'password123');
        await page.click('button[type="submit"]');
        await page.waitForURL('/dashboard');
    });

    test('should browse and enroll in a course', async ({ page }) => {
        // 1. Navigate to courses/academy page
        await page.goto('/academy');

        // 2. Verify courses are listed
        await expect(page.locator('h1')).toContainText(/Academy|Courses/i);

        const courseCards = page.locator('[data-testid="course-card"]');
        await expect(courseCards.first()).toBeVisible({ timeout: 5000 });

        // 3. Click on first course
        await courseCards.first().click();

        // 4. Verify course details page
        await page.waitForTimeout(1000);
        await expect(page.locator('[data-testid="course-title"]')).toBeVisible();

        // 5. Click "Enroll Now" button
        const enrollButton = page.locator('button:has-text("Enroll")');
        await enrollButton.click();

        // 6. Verify enrollment success
        await expect(page.locator('text=Enrolled successfully')).toBeVisible({ timeout: 5000 });

        console.log('✅ Enrolled in course');
    });

    test('should track course progress', async ({ page }) => {
        // Navigate to "My Courses"
        await page.goto('/academy/my-courses');

        // Check for enrolled courses
        const enrolledCourses = page.locator('[data-testid="enrolled-course"]');

        if (await enrolledCourses.first().isVisible()) {
            // Click on first enrolled course
            await enrolledCourses.first().click();

            // Verify progress bar or indicator
            const progressIndicator = page.locator('[data-testid="progress-bar"]');
            await expect(progressIndicator).toBeVisible({ timeout: 5000 });

            // Check for module list
            const modules = page.locator('[data-testid="module-item"]');
            await expect(modules.first()).toBeVisible();

            console.log('✅ Course progress visible');
        } else {
            console.log('⚠️ No enrolled courses found');
        }
    });

    test('should complete a module and update progress', async ({ page }) => {
        await page.goto('/academy/my-courses');

        const enrolledCourses = page.locator('[data-testid="enrolled-course"]');

        if (await enrolledCourses.first().isVisible()) {
            await enrolledCourses.first().click();

            // Click on first incomplete module
            const incompleteModule = page.locator('[data-testid="module-item"]:not([data-completed="true"])').first();

            if (await incompleteModule.isVisible()) {
                await incompleteModule.click();

                // Watch video or read content
                await page.waitForTimeout(2000);

                // Click "Mark as Complete"
                const completeButton = page.locator('button:has-text("Mark as Complete")');
                if (await completeButton.isVisible()) {
                    await completeButton.click();

                    // Verify progress updated
                    await expect(page.locator('text=Progress updated')).toBeVisible({ timeout: 5000 });

                    console.log('✅ Module completed');
                }
            }
        }
    });
});
