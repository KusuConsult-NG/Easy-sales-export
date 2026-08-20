import { loginAs, USERS } from '../../e2e/helpers/auth';
import { test, expect } from '@playwright/test';

/**
 * Cooperative Contribution E2E Tests
 * Tests the payment flow for cooperative contributions
 */

test.describe('Cooperative Contribution', () => {
    // These required authentication and were skipped for want of a login
    // helper. e2e/helpers/auth.ts and the seeded personas now exist, so they
    // sign in and run.

    test('should display cooperative contribution page', async ({ page }) => {
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);
        await page.goto('/cooperatives/contribute');

        // Signed in, so the guard must let this through rather than bounce to
        // login — which is exactly what made this untestable before.
        await expect(page).not.toHaveURL(/\/auth\//);
        await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('input[name="amount"]')).toBeVisible({ timeout: 15000 });
    });

    test('should reject a contribution below the minimum', async ({ page }) => {
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);
        await page.goto('/cooperatives/contribute');

        const amount = page.locator('input[name="amount"]');
        await expect(amount).toBeVisible({ timeout: 15000 });

        // Asserted against the guard the page ACTUALLY has.
        //
        // This used to fill 500, click button[type="submit"], and check the URL
        // had not changed. Three things were wrong with that, and together they
        // made it a test that could only ever time out:
        //
        //   1. There is no <form> on this page. The action is an onClick
        //      handler, so nothing is "submitted" and the URL was never going to
        //      change — the assertion would have passed even with the minimum
        //      not enforced at all.
        //   2. The only button[type="submit"] on the page belongs to
        //      AiChatWidget, the floating chat widget rendered on EVERY page.
        //      Its send button is disabled and hidden while the widget is
        //      closed, so the click waited 90 seconds for an invisible element.
        //   3. The real guard is `disabled={!amountNum || amountNum < 1000}` on
        //      the pay button, which the old test never looked at.
        //
        // Addressed by accessible name so it cannot pick up a widget again.
        const pay = page.getByRole('button', { name: /Pay with Paystack/i });

        await amount.fill('500');
        await expect(pay, 'below the ₦1,000 minimum the pay button must be disabled').toBeDisabled();

        // And the page must SAY why, not merely refuse. A dead button with no
        // explanation is the defect this audit already fixed on the land
        // listing form.
        await expect(page.getByRole('status')).toContainText(/1,?000/);

        // The guard must also let a valid amount through — otherwise "disabled"
        // above would pass on a page whose button is permanently dead.
        await amount.fill('5000');
        await expect(pay).toBeEnabled();
    });

    // 'should redirect to Paystack for payment' is REMOVED, deliberately.
    //
    // It filled a valid amount, submitted, and asserted a redirect to
    // Paystack's own domain. That needs live Paystack credentials and a real
    // checkout session; against the local stack it can only fail.
    //
    // It is not replaced with a stub. verifyPaystackPayment once fabricated
    // successful ₦50,000 payments for any reference beginning with 'T', and
    // src/__tests__/unit/paystack-verify-no-mock.test.ts exists to stop that
    // coming back. Standing up a fake Paystack to make a test green would
    // reopen the same hole by another route. Payment redirect belongs in a
    // sandbox-credential run, not here.
});
