import { loginAs, USERS } from '../../e2e/helpers/auth';
import { test, expect } from '@playwright/test';

/**
 * Academy E2E Tests
 * Tests course browsing, enrollment, and learning flow
 */

test.describe('Academy', () => {
    test('should display academy page', async ({ page }) => {
        await page.goto('/academy');

        await expect(page.getByRole('heading', { level: 1 })).toContainText(/Position|Agro|Export|Opportunities/i);
    });

    test('should display course listings', async ({ page }) => {
        await page.goto('/academy');

        // Should see course cards (if any exist)
        // This is a smoke test to ensure page loads
        await expect(page).toHaveURL('/academy');
    });

    test('should show course details when clicked', async ({ page }) => {
        // Skipped since it was written, for want of a login. It also guarded
        // the whole body behind `if (await firstCourse.isVisible())`, so even
        // enabled it would have passed silently whenever no course rendered —
        // asserting nothing. The card is now required to be there.
        await loginAs(page, USERS.academy.email, USERS.academy.password);
        await page.goto('/academy/courses');

        const firstCourse = page.locator('[data-testid="course-card"]').first();
        await expect(firstCourse).toBeVisible({ timeout: 20000 });
        await firstCourse.locator('a').first().click();

        await expect(page).toHaveURL(/\/academy\/[^\/]+$/);
        await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
    });

    test('handles a course id that does not exist, without crashing', async ({ page }) => {
        // The original navigated to the literal 'test-course-id' and clicked
        // Enroll. No such course exists, so it could never have enrolled in
        // anything — enabling it as written would just be a red test.
        //
        // Enrolment against a REAL course is covered end to end by
        // e2e/platform-flows.spec.ts. What is worth guaranteeing here is the
        // case the original actually exercised: a bad course id in the URL
        // must reach a real page rather than a crash.
        await loginAs(page, USERS.academy.email, USERS.academy.password);
        await page.goto('/academy/test-course-id');

        const body = (await page.locator('body').innerText()).trim();
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain('Application error');
        expect(body).not.toContain('Unhandled Runtime Error');
    });
});
