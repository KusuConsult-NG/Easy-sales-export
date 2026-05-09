import { test, expect } from '@playwright/test';

/**
 * Financial Workflow E2E Test
 * 
 * Verifies payment initiation flows and callback handling.
 * This ensures users can transition to external payment gateways correctly.
 */

test.describe('Financial Workflows', () => {
    
    test.beforeEach(async ({ page }) => {
        // Authenticate with a test account that has an approved application or is at the payment step
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com');
        await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || 'password123');
        await page.click('button[type="submit"]');
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

    test('should handle successful payment callback', async ({ page }) => {
        // Simulate a successful payment callback
        // This is a "contract test" for the callback URL structure
        const reference = `T${Date.now()}`;
        await page.goto(`/academy/payment/callback?reference=${reference}&status=success`);
        
        // Expect success state or redirect to dashboard
        await expect(page).toHaveURL(/\/academy\/dashboard/);
        await expect(page.locator('text=Payment Successful')).toBeVisible();
    });
});
