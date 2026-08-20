import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * Escrow, loans and admin feature toggles.
 *
 * EVERY TEST IN THIS FILE WAS test.skip, with the reason written in each name:
 * "(requires auth)" and "(requires admin)". They were written before the suite
 * had a login helper or seeded identities, so they could not sign in — and
 * then sat switched off. Eight of the fifteen skipped tests in the whole suite
 * were in this one file, and nothing was checking escrow, disputes or the
 * feature-toggle admin at all.
 *
 * Both of those now exist: e2e/helpers/auth.ts and the personas
 * scripts/seed-local.ts creates. The tests log in.
 *
 * The escrow tests navigate to a MADE-UP escrow id. That is deliberate and the
 * assertions say so: with no such record the page must answer with a "not
 * found" state rather than a crash or a blank screen, which is the thing worth
 * guaranteeing for a URL a user can type or a stale link can point at. A test
 * of a real escrow needs a seeded escrow and belongs with the marketplace
 * purchase flow that creates one.
 */

test.describe('Escrow Management', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
    });

    test('should display escrow dashboard', async ({ page }) => {
        await page.goto('/escrow');

        // Signed in, so the guard must let this through rather than bounce to
        // login — which is what made this untestable before.
        await expect(page).not.toHaveURL(/\/auth\//);
        await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
    });

    test('handles an escrow id that does not exist, without crashing', async ({ page }) => {
        // A URL a user can type, or a stale link. It must reach a real page.
        const escrowId = 'test-escrow-id';
        await page.goto(`/escrow/${escrowId}/chat`);

        const body = (await page.locator('body').innerText()).trim();
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain('Application error');
        expect(body).not.toContain('Unhandled Runtime Error');
    });

    test('handles a dispute page for an escrow that does not exist', async ({ page }) => {
        const escrowId = 'test-escrow-id';
        await page.goto(`/escrow/${escrowId}/dispute`);

        const body = (await page.locator('body').innerText()).trim();
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain('Application error');
        expect(body).not.toContain('Unhandled Runtime Error');
    });

    // 'should validate dispute reason' is REMOVED rather than enabled.
    //
    // It navigated to the same made-up escrow id, clicked submit and asserted
    // `textarea:invalid`. With no such escrow there is no dispute form to
    // validate, so it could only ever have asserted something about an error
    // page. Dispute validation against a REAL escrow is worth testing and
    // belongs with the flow that creates one — e2e/marketplace-critical-flows
    // already files a dispute end to end.
});

/**
 * Loan Management E2E Tests
 */
test.describe('Loan Application', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.user.email, USERS.user.password);
    });

    test('should display loan application form', async ({ page }) => {
        await page.goto('/loans/apply');

        await expect(page.getByRole('heading', { level: 1 })).toContainText(/loan|apply/i);
        await expect(page.locator('input[name="amount"]')).toBeVisible();
    });

    test('should validate loan amount', async ({ page }) => {
        await page.goto('/loans/apply');

        // The wizard's step 1 has no submit — it advances with Next, and the
        // amount is validated there. The original asserted a submit button
        // that does not exist on this step, which is one reason it was easier
        // to leave switched off than to fix.
        const amountField = page.locator('input[name="amount"]');
        await expect(amountField).toBeVisible({ timeout: 15000 });
        await expect(amountField).toHaveValue('10000', { timeout: 15000 });

        await amountField.fill('500');
        await page.click('text=Next');

        await expect(page.locator('text=/minimum/i').first()).toBeVisible({ timeout: 10000 });
    });
});

/**
 * Admin Features E2E Tests
 */
test.describe('Admin Dashboards', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.admin.email, USERS.admin.password);
    });

    test('should display feature toggles page', async ({ page }) => {
        await page.goto('/admin/feature-toggles');

        // Should show feature toggles dashboard
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/feature toggles/i);
    });

    // 'should filter feature toggles' is REMOVED rather than enabled.
    //
    // It selected 'BETA' on the first <select> on the page and asserted a
    // `[data-category="BETA"]` element appeared. Neither exists: the page has
    // no category filter and nothing renders that attribute. It was written
    // against a design that was never built, which is why it was skipped
    // rather than fixed. Enabling it would only add a red test describing a
    // feature that does not exist.
});
