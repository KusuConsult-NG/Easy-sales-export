import { test, expect } from '@playwright/test';

/**
 * Critical User Flow: Marketplace Purchase
 * Tests the complete end-to-end purchase flow
 */

test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    page.on('console', msg => {
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
        console.error(`[Browser PageError] ${err.message}`);
    });
});

test.describe('Marketplace Purchase Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Guest user can browse products', async ({ page }) => {
        // Navigate to marketplace
        await page.goto('/marketplace');
        await expect(page).toHaveURL(/.*marketplace/);

        // Asserted through the accessibility tree, not through locator('h1').
        //
        // locator('h1') hit a strict mode violation: "resolved to 2 elements",
        // both <h1>Easy Market Nigeria</h1> with identical classes. That is a
        // TRANSIENT during hydration, and it was measured rather than guessed —
        // sampling document.querySelectorAll('h1').length every 50ms from
        // navigation-commit gives a series like 1,2,1,1,1,... The server sends
        // exactly one h1, the source contains exactly one, and the settled DOM
        // has exactly one; React briefly holds both while it reconciles.
        //
        // Only one of the two is in the accessibility tree — Playwright's own
        // error named the second one getByText(...).nth(1) rather than
        // getByRole('heading'), and the captured aria snapshot lists a single
        // heading. So a role-based locator resolves to one element throughout,
        // and it also asserts the thing that matters: what a user, and a screen
        // reader, actually perceive as the page's heading.
        await expect(page.getByRole('heading', { level: 1 }))
            .toContainText(/Easy Market|Featured|Marketplace/i);

        // Navigate to products catalog
        await page.goto('/marketplace/products');

        // Search for a product
        await page.fill('input[placeholder*="Search"]', 'Yam');
        await page.waitForTimeout(1000);
        
        // Handle empty state gracefully on production
        const viewDetails = page.locator('text=View Details').first();
        if (await viewDetails.count() > 0) {
            await expect(viewDetails).toBeVisible();
        } else {
            await expect(page.locator('text=No products found').first()).toBeVisible();
        }
    });

    test('Authenticated user can complete purchase with Paystack', async ({ page }) => {
        // Login first
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
        await page.waitForTimeout(2000);

        // Navigate to marketplace
        await page.goto('/marketplace/products');

        /*
         *   #798 THIS TEST HAD NEVER RUN, AND SAID SO EVERY TIME.
         *
         *   It was:
         *
         *       const viewDetails = page.locator('text=View Details').first();
         *       if (await viewDetails.count() === 0) {
         *           console.log('⚠️ Skipping … Empty products catalog');
         *           return;
         *       }
         *
         *   `count()` fires the instant goto() resolves. The catalogue loads
         *   CLIENT-SIDE, so at that moment there are zero cards no matter what
         *   is in the database, and every run printed "Empty products catalog
         *   on production" and returned GREEN.
         *
         *   MEASURED rather than assumed: seed-local writes three products
         *   with status "active", and /api/marketplace/products returns all
         *   three. The catalogue was never empty; the check was early.
         *
         *   Waiting is the whole fix, and the skip is gone with it. A missing
         *   fixture now FAILS here — an end-to-end suite that excuses itself
         *   when its data is absent is how #789 and #794 both shipped past a
         *   green run.
         */
        const viewDetails = page.getByRole('link', { name: /view details/i }).first();
        await expect(viewDetails, 'the seeded catalogue has at least one product')
            .toBeVisible({ timeout: 20000 });

        // Add product to cart
        await viewDetails.click();
        await page.click('text=Add to Cart');
        await expect(page.locator('text=Added to cart')).toBeVisible();

        // Proceed to checkout (waits for automatic client-side transition to checkout)
        await expect(page).toHaveURL(/.*checkout/, { timeout: 10000 });

        // Fill shipping details using specific layout selectors
        await page.fill('#delivery-street-input', '123 Test Street');
        await page.fill('input[placeholder="e.g. Ikeja"]', 'Lagos');
        await page.locator('select').first().selectOption('Lagos');
        
        // Wait for LGA options to populate
        await page.waitForTimeout(500);
        await page.locator('select').last().selectOption('Ikeja');

        // Fill phone number using custom phone input placeholder match
        await page.fill('input[placeholder*="080"]', '080' + Math.floor(10000000 + Math.random() * 90000000));

        // Wait for auto-geocoding to resolve and click bypass button if visible
        await page.waitForTimeout(2000);
        const bypassButton = page.locator('button:has-text("Use Address Anyway")');
        if (await bypassButton.isVisible()) {
            await bypassButton.click();
        }

        // Select Paystack payment and submit
        await page.click('text=Complete Payment');

        /*
         *   #798 AN EXPLICIT OUTCOME, EITHER WAY — and this is the honest
         *   version of an assertion that could not hold everywhere.
         *
         *   The old line was `toHaveURL(/paystack/)`, which requires a real
         *   PAYSTACK_SECRET_KEY. A local stack and a CI runner have none by
         *   design, so the assertion was unreachable — and it never ran, because
         *   the catalogue check above returned before it.
         *
         *   Weakening it to "something happened" would be worthless. What is
         *   asserted instead is the property that holds with OR without a
         *   payment provider, and the one that actually protects a buyer:
         *   pressing Complete Payment must produce an ANSWER. Either she
         *   reaches Paystack, or she is told the payment could not be started.
         *
         *   What must never happen is the third outcome — the button consumes
         *   the click and the page sits there — which is #405's finding
         *   ("no screen can strand its own control") on the screen where the
         *   money is.
         */
        const reachedPaystack = page.waitForURL(/paystack/, { timeout: 20000 })
            .then(() => 'paystack' as const).catch(() => null);
        /*
         *   The wording the screen ACTUALLY uses, not the wording I guessed.
         *
         *   The first draft matched "payment failed" and "unable to
         *   initialise", and the checkout says neither — it renders
         *
         *       "Failed to initialize payment: Paystack API error: Forbidden"
         *
         *   so the app satisfied the property and this assertion reported it
         *   as stranding the buyer. An over-narrow matcher fails in the
         *   direction that blames working code, which is the cheaper of the
         *   two directions but still a false answer.
         */
        const toldWhyNot = page
            .getByText(/failed to initiali[sz]e payment|payment (service|gateway).*(not|un)configured|could not.*payment|payment failed|unable to (start|initialise|initialize)/i)
            .first().waitFor({ state: 'visible', timeout: 20000 })
            .then(() => 'told' as const).catch(() => null);

        const outcome = (await Promise.all([reachedPaystack, toldWhyNot])).find(Boolean);
        expect(
            outcome,
            'Complete Payment must either reach Paystack or say why it could not — '
            + 'a click that produces neither strands the buyer on the checkout screen',
        ).toBeTruthy();
    });
});

test.describe('Dispute Flow', () => {
    test('User can file a dispute', async ({ page }) => {
        // Login
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
        await page.waitForTimeout(2000);

        /*
         *   #798 THIS SPEC HAD NEVER RUN EITHER, AND COULD NOT HAVE.
         *
         *   It was looking for a card containing "ORD-E2E-DELIVERED". That
         *   string exists NOWHERE else in this repository — no seed, no
         *   fixture, no migration writes it — so the lookup was guaranteed to
         *   find nothing, and the spec printed "No active ORD-E2E-DELIVERED
         *   order found on production" and returned GREEN on every run since
         *   it was written.
         *
         *   seed-local.ts now creates e2e-delivered-order, and this addresses
         *   it BY ID instead of scraping a card for a number the orders list
         *   may not print at all. A missing fixture now fails here.
         */
        await page.goto('/marketplace/buyer/orders/e2e-delivered-order');

        //   Evidence is mandatory on the dispute form and uploads to
        //   Cloudinary, which no local stack or CI runner has. One boundary
        //   stubbed; the dispute write itself is real. See
        //   marketplace-seller-products.spec.ts for the same note in full.
        await page.route('**/api/upload', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                url: 'https://res.cloudinary.com/demo/image/upload/v1/e2e-evidence.png',
            }),
        }));

        // Open dispute
        const raise = page.getByRole('link', { name: /raise dispute/i });
        await expect(raise, 'a delivered order offers Raise Dispute')
            .toBeVisible({ timeout: 20000 });
        await raise.click();

        // Fill dispute form using custom buttons layout
        await page.click('text=Damaged/Defective');
        await page.fill('textarea', 'Product arrived damaged with visible cracks. The yams were rotten and broken upon delivery. Completely unusable.');

        // Upload evidence (mock file - valid transparent PNG buffer to pass Cloudinary checks)
        const fileInput = await page.locator('input[type="file"]');
        await fileInput.setInputFiles({
            name: 'evidence.png',
            mimeType: 'image/png',
            buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
        });

        // Submit dispute
        await page.click('button[type="submit"]');

        // Verify success
        await expect(page.locator('text=Dispute submitted successfully')).toBeVisible();
    });
});
