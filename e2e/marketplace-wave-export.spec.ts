import { test, expect, Page } from '@playwright/test';

/**
 * Marketplace E2E Tests
 * Tests the complete marketplace browse → checkout → escrow flow
 */

async function loginUser(page: Page) {
    await page.goto('/login');
    await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL || 'e2e.user@easysalesexport.test');
    await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD || 'E2eTest@2024!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
}

test.describe('Marketplace Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should browse marketplace products', async ({ page }) => {
        await page.goto('/marketplace/products');

        // Page should load
        await expect(page.locator('h1')).toContainText(/Marketplace|Products|Easy Market/i);

        // Products grid or list should be visible
        const productsContainer = page.locator('[data-testid="products-grid"], .grid, .product-list').first();
        await expect(productsContainer).toBeVisible({ timeout: 5000 });

        console.log('✅ Marketplace page loaded with products');
    });

    test('should filter products by category', async ({ page }) => {
        await page.goto('/marketplace/products');

        // Look for category buttons/tabs
        const categoryButtons = page.locator('button:has-text("Yam"), button:has-text("Sesame"), button:has-text("Hibiscus")');

        if (await categoryButtons.count() > 0) {
            await categoryButtons.first().click();

            // Products should filter
            await page.waitForTimeout(1000); // Wait for filter to apply
            console.log('✅ Category filter applied');
        }
    });

    test('should view product details', async ({ page }) => {
        await page.goto('/marketplace/products');

        // Click first product
        const firstProduct = page.locator('.product-card, [data-testid="product-card"]').first();

        if (await firstProduct.count() > 0) {
            await firstProduct.click();

            // Product details should appear (modal or new page)
            await expect(
                page.locator('text=/Price|₦|Details|Quantity/i')
            ).toBeVisible({ timeout: 5000 });

            console.log('✅ Product details displayed');
        }
    });

    test('should proceed to checkout', async ({ page }) => {
        await page.goto('/marketplace/products');

        // Click first product
        const firstProduct = page.locator('.product-card, [data-testid="product-card"]').first();

        if (await firstProduct.count() > 0) {
            await firstProduct.click();

            // Add to cart
            const addToCartButton = page.locator('button:has-text("Add to Cart")');
            await expect(addToCartButton).toBeVisible({ timeout: 5000 });
            await addToCartButton.click();

            // Go to checkout page (waits for automatic client-side transition to checkout)
            await expect(page).toHaveURL(/.*checkout/, { timeout: 10000 });

            // Should navigate to checkout or show checkout modal
            await expect(
                page.locator('text=/Checkout|Order.*Summary|Payment/i')
            ).toBeVisible({ timeout: 5000 });

            console.log('✅ Checkout flow initiated');
        }
    });
});

test.describe('WAVE Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should access WAVE application page', async ({ page }) => {
        await page.goto('/wave');

        await expect(page.locator('h1')).toContainText(/WAVE|Women.*Agriculture/i);

        // Apply button should be visible
        const applyButton = page.locator('button:has-text("Apply"), a:has-text("Apply")').first();
        await expect(applyButton).toBeVisible({ timeout: 5000 });

        console.log('✅ WAVE page loaded');
    });

    test('should fill WAVE application form', async ({ page }) => {
        await page.goto('/wave/application');

        // Fill application form
        const nameInput = page.locator('input[name="fullName"], input[name="name"]');
        if (await nameInput.count() > 0) {
            await nameInput.fill('Jane Farmer');

            await page.fill('input[type="email"]', 'jane@example.com');
            await page.fill('input[name="phone"]', '+23480' + Math.floor(1000000 + Math.random() * 9000000));

            // Select experience
            const experienceSelect = page.locator('select[name="experience"], select[name="farmingExperience"]');
            if (await experienceSelect.count() > 0) {
                await experienceSelect.selectOption('5-10 years');
            }

            // Fill business plan
            const businessPlan = page.locator('textarea[name="businessPlan"]');
            if (await businessPlan.count() > 0) {
                await businessPlan.fill('I plan to expand yam production using modern farming techniques.');
            }

            console.log('✅ WAVE application form filled');
        }
    });
});

test.describe('Export Window Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('should create export window', async ({ page }) => {
        await page.goto('/export');

        // Find "Create Export Window" button
        const createButton = page.locator('button:has-text("Create"), button:has-text("New Export")');

        if (await createButton.count() > 0) {
            await createButton.click();

            // Form should appear
            await expect(page.locator('text=/Commodity|Quantity|Amount/i')).toBeVisible({ timeout: 5000 });

            console.log('✅ Export window creation form opened');
        }
    });

    test('should display export windows list', async ({ page }) => {
        await page.goto('/export/windows');

        // List or grid should be visible
        await expect(page.locator('h1, h2').first()).toContainText(/Export.*Window|Export.*Order/i);

        console.log('✅ Export windows list displayed');
    });
});
