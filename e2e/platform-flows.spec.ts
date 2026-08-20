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

        // Wait for the form to hydrate before touching it.
        //
        // The category buttons are plain type="button" elements whose only
        // effect is an onClick. Until React hydrates and binds it, a click does
        // nothing at all — silently. The submit handler then bails at
        // "Please select at least one land category" BEFORE its upload loop,
        // which is why not a single /api/upload request ever reached the
        // server while the test still appeared to fill the form and submit.
        const titleField = page.locator('input[placeholder="e.g., 50 Acres Farmland in Kaduna"]');
        await expect(titleField).toBeVisible({ timeout: 15000 });
        await titleField.fill('Prime Agricultural Land in Kano');

        // Click the category, then PROVE it registered. The selected state is a
        // border colour change; asserting it is what turns a silently-dropped
        // click into a visible failure at the point it happens, rather than an
        // unexplained absence six steps later.
        const farmlandCategory = page.locator('button:has-text("Farmland")').first();
        await farmlandCategory.click();
        await expect(farmlandCategory).toHaveClass(/border-green-600/, { timeout: 10000 });
        await page.locator('textarea[placeholder*="Describe the land"]').fill('Fertile land perfect for rice farming');
        
        // Select state and fill LGA
        await page.locator('select').first().selectOption('Kano');
        await page.locator('input[placeholder="Enter LGA"]').fill('Kano Municipal');
        await page.locator('textarea[placeholder*="Full address with landmarks"]').fill('123 Farm Road, Kano');

        // Size and price per unit
        await page.locator('label:has-text("Land Size") >> xpath=.. >> input[type="number"]').fill('50');
        await page.locator('label:has-text("Unit") >> xpath=.. >> select').selectOption('hectares');
        await page.locator('label:has-text("Price per") >> xpath=.. >> input[type="number"]').fill('300000');

        // The submit button is disabled until a land photo, the Land Title
        // Document and the Survey Plan are all present. It used to say nothing
        // about which of the three it wanted — a seller with everything but a
        // survey plan got a dead grey button and no explanation. The page now
        // lists what is outstanding, and that message is asserted below before
        // any of it is supplied.
        const submitButton = page.locator('button:has-text("Submit Land Listing")');
        await expect(submitButton).toBeDisabled();
        await expect(page.getByRole('status')).toContainText('the Survey Plan');
        await expect(page.getByRole('status')).toContainText('at least one land photo');

        // Each field is uploaded ONCE. FileUploadField swaps the <input> for a
        // "file attached" panel as soon as a file is set, so a second
        // setInputFiles on the same field waits 90 seconds for an element that
        // has been removed from the DOM — which is exactly what this spec did
        // to the Survey Plan, and why it timed out there rather than at any of
        // the assertions it was written to make.
        await page.locator('label:has-text("Land Title Document") >> xpath=.. >> input[type="file"]').setInputFiles([
            { name: 'title.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 land title') }
        ]);

        await page.locator('label:has-text("Survey Plan") >> xpath=.. >> input[type="file"]').setInputFiles([
            { name: 'survey.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 survey plan') }
        ]);

        await page.locator('label:has-text("Land Photos") >> xpath=.. >> input[type="file"]').setInputFiles([
            { name: 'land1.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') },
            { name: 'land2.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }
        ]);

        // With all three supplied the message goes and the button comes alive —
        // the other half of the guarantee.
        await expect(page.getByRole('status')).toHaveCount(0);
        await expect(submitButton).toBeEnabled();
        await submitButton.click();

        // Verify success
        await expect(page.locator('text=submitted for verification').first()).toBeVisible({ timeout: 15000 });
    });
});

test.describe('Academy Course Enrollment', () => {
    test('User can enroll and complete a course', async ({ page }) => {
        // Login
        // Its own learner — courses.spec.ts drives USERS.academy through the
        // same enrolment, and a course already started shows Resume where this
        // spec expects Enroll.
        await loginAs(page, USERS.academy2.email, USERS.academy2.password);

        // Browse courses
        await page.goto('/academy/courses');

        // Wait for the loading state to resolve
        await expect(page.locator('text=Loading...').first()).not.toBeVisible({ timeout: 20000 });

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

        // The lesson must NOT already be complete, or there is nothing to test.
        //
        // A completed lesson renders "Completed" and no "Mark as Complete"
        // button, so this spec used to time out after 90 seconds waiting for a
        // control that would never appear again — it passed on a fresh database
        // and was blocked on every run afterwards. scripts/seed-local.ts now
        // clears academy progress for the seeded personas, and this asserts
        // that it worked rather than trusting it.
        await expect(page.getByText('Completed')).toHaveCount(0);

        // Complete lesson
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await page.click('text=Mark as Complete');

        // Verify progress ADVANCED.
        //
        // The old assertion was `text=1 /` — which the page already showed
        // before the click whenever a previous run had left the lesson
        // complete, so it could pass without the click doing anything. The
        // count is read before and after instead.
        await expect(page.getByText(/\d+ \/ \d+ lessons/)).toContainText('1 / 3 lessons', { timeout: 10000 });
        await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 10000 });
    });

    // 'User can take quiz and get certificate' is REMOVED.
    //
    // Its body was EMPTY apart from the comment "quizzes are module-specific in
    // the current design". An empty skipped test is not coverage of anything —
    // it is a note, and it reads on a report as though a quiz flow is tested.
    //
    // Module-level quizzes do exist (admin/academy/[courseId]/quiz/[quizId]).
    // A real test of taking one and earning a certificate is worth writing and
    // needs a seeded quiz with questions; it is not this.
});

test.describe('Admin Workflows', () => {
    test('Admin can resolve dispute', async ({ page }) => {
        // Capture browser console logs
        page.on('console', msg => {
            console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
        });

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
        
        console.log("[E2E TEST] Clicking 'Resolve & Close' button...");
        await page.click('button:has-text("Resolve & Close")');
        console.log("[E2E TEST] Clicked 'Resolve & Close' button. Waiting for success message...");

        // Success
        await expect(page.locator('text=Dispute resolved successfully')).toBeVisible({ timeout: 15000 });
    });
});
