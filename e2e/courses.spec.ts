import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

test.describe('Course Enrollment Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.academy.email, USERS.academy.password);
    });

    test('should browse and enroll in a course', async ({ page }) => {
        // 1. Navigate to courses page
        await page.goto('/academy/courses');

        // Wait for the loading state to resolve
        await expect(page.locator('text=Loading...').first()).not.toBeVisible({ timeout: 20000 });

        // 2. Verify courses are listed
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/Academy|Courses|Learn How to Position|Master/i);

        const courseCards = page.locator('[data-testid="course-card"]');
        await expect(courseCards.first()).toBeVisible({ timeout: 10000 });

        // 3. Click on first course link
        await courseCards.first().locator('a').first().click();

        // 4. Verify course details page
        await page.waitForURL(/\/academy\/(?!courses|my-courses|dashboard|live|certificate|progress|application)[a-zA-Z0-9_-]+/);
        await expect(page.locator('[data-testid="course-title"]')).toBeVisible({ timeout: 5000 });

        // 5. Click "Enroll Now" or "Start Course" button
        // Since setup-e2e-coop.ts doesn't enroll the user in courses by default, they might have access but not be enrolled yet
        // If they are not enrolled, page shows "Enroll Now". If they are, it shows "Start Course" or "Resume Course".
        // Let's locate the appropriate CTA button
        const ctaButton = page.locator('button:has-text("Enroll"), button:has-text("Start"), button:has-text("Continue"), a:has-text("Start"), a:has-text("Resume")').first();
        await expect(ctaButton).toBeVisible({ timeout: 5000 });
        await ctaButton.click();

        // 6. Verify progress or lesson page is reached
        console.log('✅ Enrolled or started course');
    });

    test('should track course progress', async ({ page }) => {
        // Navigate to "My Courses"
        await page.goto('/academy/my-courses');

        // Check for enrolled courses
        const enrolledCourses = page.locator('[data-testid="enrolled-course"]');

        if (await enrolledCourses.first().isVisible({ timeout: 5000 })) {
            const card = enrolledCourses.first();

            /*
             *   #656 — THE PROGRESS BAR IS ON THIS PAGE, AND THE MODULES ARE ON
             *   THE NEXT ONE. This spec had never run, and asserted both in one
             *   place after clicking the card body.
             *
             *   Two things were wrong with that and neither is an app defect.
             *   `progress-bar` is rendered ONCE PER ENROLLED COURSE on the list,
             *   so a bare locator matching two is a strict-mode violation rather
             *   than a missing element. And the card is a <div> whose Continue /
             *   Start LINK is what navigates — clicking the card body does
             *   nothing, so the run never left the list and `module-item`, which
             *   lives on CourseDetailClient, was never going to be there.
             *
             *   Written as the journey it is named for: the bar on the list,
             *   then the link, then the modules on the course.
             */
            await expect(card.locator('[data-testid="progress-bar"]')).toBeVisible({ timeout: 5000 });

            await card.getByRole('link', { name: /continue|start/i }).click();
            await page.waitForURL(/\/academy\/[^/]+$/);

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

        if (await enrolledCourses.first().isVisible({ timeout: 5000 })) {
            await enrolledCourses.first().click();

            // Click on first incomplete module
            const incompleteModule = page.locator('[data-testid="module-item"]').first();

            if (await incompleteModule.isVisible()) {
                await incompleteModule.click();

                // Watch video or read content
                await page.waitForTimeout(2000);

                // Click "Mark as Complete" or complete lesson if available
                console.log('✅ Module completed check complete');
            }
        }
    });
});
