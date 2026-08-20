import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * Financial Workflow E2E Test
 * 
 * Verifies payment initiation flows and callback handling.
 * This ensures users can transition to external payment gateways correctly.
 */

test.describe('Financial Workflows', () => {
    
    test.beforeEach(async ({ page }) => {
        // Authenticate with a test account that has an approved application or is at the payment step
        await loginAs(page, USERS.user.email, USERS.user.password);
    });

    test('should initiate Academy payment and redirect to Paystack', async ({ page }) => {
        // Navigate to academy application (which handles payment)
        await page.goto('/academy/application');
        
        // If the user is already at the payment step (Step 5)
        // We'll look for the plan selection
        const planSection = page.locator('text=Select Academy Plan');
        if (await planSection.isVisible()) {
            // Select Standard Plan
            await page.click('text=Standard Plan');
            
            // Trigger payment
            await page.click('button:has-text(/Pay ₦50,000 to Continue/i)');
            
            // Expect redirect to Paystack checkout
            // We verify the URL contains paystack.com
            await page.waitForURL(/checkout\.paystack\.com/);
            expect(page.url()).toContain('paystack.com');
        } else {
            console.log('User not at payment step, skipping redirection check');
        }
    });

    test('refuses a payment callback whose reference cannot be verified', async ({ page }) => {
        // THIS TEST ASSERTED THE OPPOSITE, AND THAT WAS A FRAUD HOLE.
        //
        // It used to send reference `T${Date.now()}` with status=success and
        // expect "Payment confirmed". It passed, because verifyPaystackPayment
        // fabricated a successful ₦50,000 payment for ANY reference starting
        // with the letter T:
        //
        //     const isTestRef = reference.startsWith('T') || ...
        //     if (isTestRef) { ...return a fabricated successful payment... }
        //
        // T + fifteen digits is one of Paystack's REAL reference formats —
        // production cooperative records carry T457550806738035 and others — so
        // this was not a test-only shape. Anyone could invent a string starting
        // with T, hand it to any verify path, and have the platform record a
        // successful ₦50,000 payment and fulfil against it.
        //
        // The fabrication was removed, and src/__tests__/unit/
        // paystack-verify-no-mock.test.ts guards it. That commit's notes say
        // "no e2e spec sends such a reference" — true of e2e/, checked, but
        // this file lives in tests/e2e/ and was missed. So this spec kept
        // asserting the vulnerable behaviour and simply went red.
        //
        // Inverted rather than deleted: an unverifiable reference reaching the
        // callback MUST NOT be confirmed, and that is worth a standing test.
        //
        // The success path is deliberately NOT tested here. It needs a real
        // verified transaction, and the only ways to fake one are the mock that
        // was removed or a stubbed Paystack host — both of which reopen this
        // hole. It belongs in a sandbox-credential run, not in this suite.
        const reference = `T${Date.now()}`;
        await page.goto(`/academy/payment/callback?reference=${reference}&status=success`);

        await expect(page).toHaveURL(/\/academy\/payment\/callback|\/academy\/dashboard/);

        // The page must say the verification failed...
        await expect(
            page.getByRole('heading', { name: /Payment Verification Failed/i })
        ).toBeVisible({ timeout: 15000 });

        // ...and must NOT claim success anywhere on it. This half is the point:
        // without it, a page that showed both would pass.
        await expect(page.getByText(/Payment confirmed|Payment Successful/i)).toHaveCount(0);
    });
});
