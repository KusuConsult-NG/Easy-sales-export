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
        await page.goto('/marketplace');
        await expect(page).toHaveURL(/.*marketplace/);

        // Verify products are visible
        await expect(page.locator('text=Featured Products').first()).toBeVisible();

        // Navigate to products catalog
        await page.goto('/marketplace/products');

        // Search for a product
        await page.fill('input[placeholder*="Search"]', 'Yam');
        await page.waitForTimeout(1000);
        await expect(page.locator('text=View Details').first()).toBeVisible();
    });

    test('Authenticated user can complete purchase with Paystack', async ({ page }) => {
        // Login first
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.test');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });

        // Navigate to marketplace
        await page.goto('/marketplace/products');

        // Add product to cart
        await page.locator('text=View Details').first().click();
        await page.click('text=Add to Cart');
        await expect(page.locator('text=Added to cart')).toBeVisible();

        // Proceed to checkout (waits for automatic client-side transition to checkout)
        await expect(page).toHaveURL(/.*checkout/, { timeout: 10000 });

        // Fill shipping details
        await page.fill('input[name="address"]', '123 Test Street');
        await page.fill('input[name="city"]', 'Lagos');
        await page.fill('input[name="phone"]', '080' + Math.floor(10000000 + Math.random() * 90000000));

        // Select Paystack payment
        await page.click('input[value="paystack"]');
        await page.click('text=Place Order');

        // Should redirect to Paystack (we won't complete payment in test)
        await expect(page.url()).toContain('paystack');
    });

    test('User can initiate bank transfer payment', async ({ page }) => {
        // Login
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.test');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });

        // Add to cart and checkout
        await page.goto('/marketplace/products');
        await page.locator('text=View Details').first().click();
        await page.click('text=Add to Cart');
        await expect(page).toHaveURL(/.*checkout/, { timeout: 10000 });

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
        await page.fill('input[name="email"]', process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.test');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });

        // Go to orders
        await page.goto('/marketplace/buyer/orders');

        // Open first delivered order
        await page.locator('text=View Details').first().click();

        // Open dispute
        await page.click('text=Raise Dispute');

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
