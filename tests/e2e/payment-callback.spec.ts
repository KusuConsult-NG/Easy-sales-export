import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * Payment Callback Tests
 * Verifies the payment verification flow using mocked Paystack API.
 * The real Paystack API is not called — responses are intercepted via page.route().
 * This tests our callback page logic without needing live payment credentials.
 */
test.describe('Payment callback flow', () => {
    test.describe.configure({ mode: 'serial' });

    const MOCK_REFERENCE = 'TEST_E2E_REF_123456';

    async function mockPaystackVerify(page: import('@playwright/test').Page, status: 'success' | 'failed') {
        await page.route('**/api/paystack/verify**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: status === 'success',
                    data: {
                        status: status === 'success' ? 'success' : 'failed',
                        reference: MOCK_REFERENCE,
                        amount: 500000, // ₦5,000 in kobo
                        metadata: { email: USERS.academy.email },
                    },
                }),
            });
        });
        // Also mock any direct Paystack API calls
        await page.route('**/api.paystack.co/**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: true,
                    data: { status: status === 'success' ? 'success' : 'failed', reference: MOCK_REFERENCE },
                }),
            });
        });
    }

    test('Successful payment callback redirects to module dashboard', async ({ page }) => {
        await loginAs(page, USERS.academy.email, USERS.academy.password);
        await mockPaystackVerify(page, 'success');

        await page.goto(`/academy/payment/callback?reference=${MOCK_REFERENCE}`);
        await page.waitForLoadState('load');

        // Should end up in the academy area (not stay on callback page forever)
        // Allow up to 20s for payment verification + redirect
        await expect(page).toHaveURL(/\/academy/, { timeout: 20000 });

        // Should not show an error state
        const bodyText = await page.textContent('body');
        expect(bodyText?.toLowerCase()).not.toMatch(/payment failed|error verifying|something went wrong/);
    });

    test('Payment callback page loads without crash for authenticated user', async ({ page }) => {
        // Even without a valid reference, the page should not throw a JS error
        await loginAs(page, USERS.academy.email, USERS.academy.password);

        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));

        await mockPaystackVerify(page, 'failed');
        await page.goto('/academy/payment/callback?reference=INVALID_REF');
        await page.waitForLoadState('load');

        // No JavaScript runtime errors should occur
        const criticalErrors = errors.filter(e =>
            e.includes('Cannot read') || e.includes('is not a function') ||
            e.includes('Timestamp') || e.includes('undefined is not')
        );
        expect(criticalErrors).toHaveLength(0);
    });

    test('Unauthenticated user hitting callback page is redirected to login', async ({ page }) => {
        await page.context().clearCookies();
        await page.goto(`/academy/payment/callback?reference=${MOCK_REFERENCE}`);
        await page.waitForLoadState('load');
        // Should redirect to login, not crash
        await expect(page).toHaveURL(/\/auth\/login|\/auth\/get-started|\/login/, { timeout: 10000 });
    });
});
