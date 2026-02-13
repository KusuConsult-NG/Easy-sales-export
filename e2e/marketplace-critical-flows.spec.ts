import { test, expect } from '@playwright/test';

/**
 * Critical User Flow: Marketplace Purchase
 * Tests the complete end-to-end purchase flow
 */

test.describe('Marketplace Purchase Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Guest user can browse products', async ({ page }) => {
        // Navigate to marketplace
        await page.click('text=Marketplace');
        await expect(page).toHaveURL(/.*marketplace/);

        // Verify products are visible
        await expect(page.locator('text=Featured Products').first()).toBeVisible();

        // Search for a product
        await page.fill('input[placeholder*="Search"]', 'agriculture');
        await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();
    });

    test('Authenticated user can complete purchase with Paystack', async ({ page }) => {
        // Login first
        await page.click('text=Login');
        await page.fill('input[name="email"]', 'buyer@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/);

        // Navigate to marketplace
        await page.goto('/marketplace');

        // Add product to cart
        await page.click('[data-testid="product-card"]').first();
        await page.click('text=Add to Cart');
        await expect(page.locator('text=Added to cart')).toBeVisible();

        // Proceed to checkout
        await page.click('[data-testid="cart-icon"]');
        await page.click('text=Checkout');

        // Fill shipping details
        await page.fill('input[name="address"]', '123 Test Street');
        await page.fill('input[name="city"]', 'Lagos');
        await page.fill('input[name="phone"]', '08012345678');

        // Select Paystack payment
        await page.click('input[value="paystack"]');
        await page.click('text=Place Order');

        // Should redirect to Paystack (we won't complete payment in test)
        await expect(page.url()).toContain('paystack');
    });

    test('User can initiate bank transfer payment', async ({ page }) => {
        // Login
        await page.click('text=Login');
        await page.fill('input[name="email"]', 'buyer@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Add to cart and checkout
        await page.goto('/marketplace');
        await page.click('[data-testid="product-card"]').first();
        await page.click('text=Add to Cart');
        await page.goto('/marketplace/checkout');

        // Select bank transfer
        await page.click('input[value="bank_transfer"]');
        await page.click('text=Place Order');

        // Verify bank details are shown
        await expect(page.locator('text=Bank Account Details')).toBeVisible();
        await expect(page.locator('text=Account Number')).toBeVisible();
    });
});

test.describe('Dispute Flow', () => {
    test('User can file a dispute', async ({ page }) => {
        // Login
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', 'buyer@test.com');
        await page.fill('input[name="password"]', 'testpassword123');
        await page.click('button[type="submit"]');

        // Go to orders
        await page.goto('/dashboard/orders');

        // Open first delivered order
        await page.click('[data-testid="order-card"]').first();

        // Open dispute
        await page.click('text=Open Dispute');

        // Fill dispute form
        await page.selectOption('select[name="reason"]', 'damaged');
        await page.fill('textarea[name="description"]', 'Product arrived damaged with visible cracks');

        // Upload evidence (mock file)
        const fileInput = await page.locator('input[type="file"]');
        await fileInput.setInputFiles({
            name: 'evidence.jpg',
            mimeType: 'image/jpeg',
            buffer: Buffer.from('fake-image-data')
        });

        // Submit dispute
        await page.click('button[type="submit"]');

        // Verify success
        await expect(page.locator('text=Dispute created successfully')).toBeVisible();
    });
});
