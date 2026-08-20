import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

test.describe('E2E: Auto-Approval and Communications Hub Filters', () => {
    test.describe.configure({ mode: 'serial' });

    test('Communications Hub has unpaid filters for Cooperative & Academy', async ({ page }) => {
        // 1. Log in as admin
        await loginAs(page, USERS.admin.email, USERS.admin.password);

        // 2. Go to Broadcast compose page
        await page.goto('/admin/communications/broadcast');
        await page.waitForLoadState('load');

        // 3. Select Academy Users audience radio
        //
        // Addressed by role, not by input[value=...]. The attribute selector hit
        // a strict mode violation — "resolved to 2 elements", both the same
        // radio — which is a transient during hydration, not two radios on the
        // page: sampling the DOM from navigation-commit shows the duplicate
        // appear and disappear within about a tenth of a second while React
        // reconciles, and the settled page has one.
        //
        // Playwright's own error is the evidence for which element survives in
        // the accessibility tree: it named the first getByRole('radio', ...) and
        // the second getByLabel(...).nth(1). Addressing by role therefore
        // resolves to one element throughout, and asserts what a user actually
        // operates rather than an attribute value.
        const academyRadio = page.getByRole('radio', { name: /Academy Users/i });
        await expect(academyRadio).toBeVisible();
        await academyRadio.click();

        // 4. Verify "Unpaid" option is present in the status dropdown
        const statusSelect = page.locator('select').nth(1); // The second select is moduleStatus when academy_users is active
        await expect(statusSelect).toBeVisible();
        const unpaidOptionAcademy = statusSelect.locator('option[value="unpaid"]');
        await expect(unpaidOptionAcademy).toBeAttached();
        await expect(unpaidOptionAcademy).toHaveText('Unpaid');

        // 5. Select "Unpaid" status
        await statusSelect.selectOption('unpaid');
        await expect(statusSelect).toHaveValue('unpaid');

        // 6. Select Cooperative Members audience radio
        const coopRadio = page.locator('input[value="cooperative_members"]');
        await expect(coopRadio).toBeVisible();
        await coopRadio.click();

        // 7. Verify "Unpaid" option is present in status dropdown for Cooperative
        const unpaidOptionCoop = statusSelect.locator('option[value="unpaid"]');
        await expect(unpaidOptionCoop).toBeAttached();
        await expect(unpaidOptionCoop).toHaveText('Unpaid');

        // 8. Select "Unpaid" status
        await statusSelect.selectOption('unpaid');
        await expect(statusSelect).toHaveValue('unpaid');
    });

    test('Cooperative payment callback auto-approves and redirects to dashboard', async ({ page }) => {
        // Mock Paystack verification API for Cooperative
        await page.route('**/api/cooperative/verify-payment', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    message: 'Payment verified successfully!',
                    data: {
                        status: 'success',
                        reference: 'MOCK_COOP_REF_E2E',
                        amount: 1000000,
                    }
                }),
            });
        });

        // 1. Log in as Cooperative user
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);

        // 2. Navigate to Cooperative payment callback URL
        await page.goto('/cooperatives/payment/callback?reference=MOCK_COOP_REF_E2E');
        await page.waitForLoadState('load');

        // 3. Page should verify payment, show success screen and redirect to dashboard
        // Redirection should complete within 10 seconds
        await expect(page).toHaveURL(/\/dashboard|\/cooperatives\/dashboard/, { timeout: 15000 });
    });

    test('Academy payment callback auto-approves and redirects to learning dashboard', async ({ page }) => {
        // Mock Paystack verification API for Academy
        await page.route('**/api/paystack/verify**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        status: 'success',
                        reference: 'MOCK_ACAD_REF_E2E',
                        amount: 4500000,
                        metadata: { email: USERS.academy.email }
                    }
                }),
            });
        });

        // 1. Log in as Academy user
        await loginAs(page, USERS.academy.email, USERS.academy.password);

        // 2. Navigate to Academy payment callback URL
        await page.goto('/academy/payment/callback?reference=MOCK_ACAD_REF_E2E');
        await page.waitForLoadState('load');

        // 3. Should verify and redirect to learning dashboard
        await expect(page).toHaveURL(/\/academy/, { timeout: 15000 });
    });
});
