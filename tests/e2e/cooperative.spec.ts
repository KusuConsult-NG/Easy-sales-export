import { loginAs, USERS } from '../../e2e/helpers/auth';
import { test, expect } from '@playwright/test';

/**
 * Cooperative Contribution E2E Tests
 * Tests the payment flow for cooperative contributions
 */

test.describe('Cooperative Contribution', () => {
    // NOTE: These tests require authentication
    // They are skipped by default and should be run with authenticated session

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
        await amount.fill('500');
        await page.click('button[type="submit"]');

        // Below the minimum must be refused, and the page must stay put.
        await expect(page).toHaveURL(/\/cooperatives\/contribute/);
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
});
