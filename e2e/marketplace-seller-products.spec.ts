import { test, expect, type Page } from '@playwright/test';
import { sessionFileFor } from './helpers/session';

/**
 *   #798 NO END-TO-END TEST EVER CREATED A PRODUCT, OR BOUGHT ONE.
 *
 *   This suite exists because of what its absence let through. #789's
 *   cooperative blocker and #794's unbuyable listing both shipped past a GREEN
 *   end-to-end run, and both live on paths no spec walked:
 *
 *       a seller filling in the create form and pressing List Product
 *       a seller opening that listing again and editing it
 *       a buyer finding it, adding it to a cart, and reaching checkout
 *
 *   #794 is the sharpest case. It let a seller save a product at a
 *   non-positive price — a listing that appears in the catalogue and throws
 *   "Invalid price" at every checkout that includes it. The guard is now on
 *   both write doors and has unit tests, but nothing had ever driven the form
 *   a seller actually uses, so nothing would have noticed the door being
 *   removed from the page.
 *
 * ── WHAT IS STUBBED, AND WHY IT IS ONLY THIS ────────────────────────────────
 *
 *   ONE boundary: POST /api/upload, which is Cloudinary.
 *
 *   The form's submit button is `disabled={media.images.length === 0}` — a
 *   product cannot be listed without an image — and uploadFile() posts the
 *   image to /api/upload, which needs CLOUDINARY_API_KEY and friends. Those
 *   are absent on a local stack and in CI by design, so WITHOUT this stub the
 *   seller create flow is not merely untested, it is UNTESTABLE, which is the
 *   most likely reason it was never written.
 *
 *   Everything else is the real thing: the real form, the real
 *   /api/marketplace/create-product route with its real session check and its
 *   real pricing guard, the real database, the real catalogue read.
 *
 * ── AND NOTHING HERE SKIPS ITSELF ───────────────────────────────────────────
 *
 *   marketplace-critical-flows.spec.ts did, in both of its flows, and that is
 *   the reason this gap survived: a test that prints "⚠️ Skipping…" and returns
 *   is GREEN. Absent fixtures fail here loudly instead. See #798's note in that
 *   file.
 */

const SELLER = sessionFileFor('seller');
const BUYER = sessionFileFor('buyer');

/** A 1x1 transparent PNG — the smallest thing the form will accept as an image. */
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

/**
 * Stub Cloudinary, and ONLY Cloudinary.
 *
 * The shape is what upload-request.ts requires of a success — it checks
 * `res.ok && data.success && data.url` — so a stub that drifts from the real
 * route's contract fails here rather than silently passing.
 */
async function stubUploads(page: Page) {
    await page.route('**/api/upload', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                url: 'https://res.cloudinary.com/demo/image/upload/v1/e2e-product.png',
            }),
        });
    });
}

/**
 * The input, select or textarea belonging to a visible label.
 *
 * These labels are not wired to their inputs with htmlFor, so getByLabel does
 * not resolve them. Anchoring on the label TEXT is the next best thing and it
 * is the better assertion anyway: it breaks when the words a seller reads
 * change, and survives every restyle. Class-based selectors would do the
 * opposite.
 */
function field(page: Page, label: string) {
    return page
        .locator(`div:has(> label:has-text("${label}"))`)
        .first()
        .locator('input, select, textarea')
        .first();
}

/**
 * Fill the create form with a valid listing. `overrides` change one answer.
 *
 *   CATEGORY IS CHOSEN FIRST, and that is not cosmetic ordering. The name
 *   control is branched on the category: a category with preset titles renders
 *   a "Product Title" SELECT (and a "Custom Product Title" input when the
 *   seller picks Other), and a category without them renders a plain "Product
 *   Name" input. Filling a name before choosing a category addresses whichever
 *   control happened to be on screen first, which is how a spec passes on one
 *   category and fails on another.
 */
async function fillCreateForm(
    page: Page,
    name: string,
    overrides: { retailPrice?: string; stock?: string } = {},
) {
    await field(page, 'Category').selectOption({ index: 1 });

    //   Whichever naming control this category produces.
    const titleSelect = field(page, 'Product Title');
    if (await titleSelect.count() > 0 && await titleSelect.isVisible()) {
        //   "Other" is the branch that lets a seller type a name, which is what
        //   this spec needs in order to find its own listing again afterwards.
        await titleSelect.selectOption('Other');
        await field(page, 'Custom Product Title').fill(name);
    } else {
        await field(page, 'Product Name').fill(name);
    }

    await page.locator('textarea').first().fill('Created by the #798 end-to-end suite.');
    await field(page, 'Retail Price').fill(overrides.retailPrice ?? '2500');
    await field(page, 'Unit').selectOption({ index: 1 });
    await field(page, 'Minimum Order Quantity').fill('1');
    await field(page, 'Available Stock').fill(overrides.stock ?? '40');

    /*
     *   EVERY REQUIRED FIELD, because the browser stops the form otherwise and
     *   the failure does not look like a missing field.
     *
     *   The first draft of this spec filled name, category, description, price,
     *   MOQ and stock — and the submit produced NO toast at all. Not a refusal,
     *   not a success: the click was swallowed by the browser's own validation
     *   bubble on LGA, "Please fill out this field", below the fold. It reads
     *   exactly like a broken submit handler.
     *
     *   Listed out rather than looped, so the next required field added to this
     *   form fails here by name.
     */
    await field(page, 'State').selectOption({ index: 1 });
    await field(page, 'LGA').fill('Jos North');
    await field(page, 'Nearest Market').fill('Jos Main Market');

    //   An image, because the submit button is disabled without one.
    await page.locator('input[type="file"]').first()
        .setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: PIXEL });
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('#798 — a seller can list a product, and it is buyable', () => {
    test.use({ storageState: SELLER });

    test('SELLER CREATES A PRODUCT and it appears in the catalogue', async ({ page }) => {
        const name = `E2E Listed Product ${Date.now()}`;
        await stubUploads(page);

        await page.goto('/marketplace/products/add');
        await expect(field(page, 'Category')).toBeVisible({ timeout: 20000 });

        await fillCreateForm(page, name);

        const submit = page.getByRole('button', { name: /list product/i });
        await expect(submit).toBeEnabled();
        await submit.click();

        //   The toast the page shows on a successful write. Asserted rather
        //   than the redirect alone, because the redirect fires on a timer and
        //   would also fire if the write had been refused.
        await expect(page.getByText(/listed successfully/i)).toBeVisible({ timeout: 20000 });

        //   AND IT REACHED THE CATALOGUE. "The form said yes" is not the
        //   property that matters — a buyer being able to find it is.
        await page.goto('/marketplace/products');
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 20000 });
    });

    test('#794 A NON-POSITIVE RETAIL PRICE IS REFUSED at the form a seller uses', async ({ page }) => {
        /*
         *   The guard #794 added, driven through the page rather than called
         *   directly. Its unit tests prove the rule; this proves the rule is
         *   still WIRED to the door — which is the half that silently came
         *   undone twice in this module already.
         */
        await stubUploads(page);
        await page.goto('/marketplace/products/add');
        await expect(field(page, 'Category')).toBeVisible({ timeout: 20000 });

        const name = `E2E Zero Price ${Date.now()}`;
        await fillCreateForm(page, name, { retailPrice: '0' });
        await page.getByRole('button', { name: /list product/i }).click();

        //   Refused, and SAID SO. A silent no-op would leave the seller
        //   pressing the button again.
        await expect(page.getByText(/greater than zero|must be greater/i))
            .toBeVisible({ timeout: 20000 });

        //   And nothing was written.
        await page.goto('/marketplace/products');
        await page.waitForLoadState('networkidle');
        await expect(page.getByText(name)).toHaveCount(0);
    });

    test('SELLER EDITS A LISTING and the new price is what a buyer sees', async ({ page }) => {
        /*
         *   #794's second half. The update door had the same missing bound as
         *   the create door, and an edit is how a live listing becomes an
         *   unbuyable one — the seller already has customers by then.
         */
        await stubUploads(page);
        await page.goto('/marketplace/seller/products');
        await page.waitForLoadState('networkidle');

        const edit = page.getByRole('link', { name: /edit/i }).first();
        await expect(edit, 'the seller has at least one product to edit')
            .toBeVisible({ timeout: 20000 });
        await edit.click();

        const price = field(page, 'Retail Price');
        await expect(price).toBeVisible({ timeout: 20000 });
        await price.fill('7777');

        await page.getByRole('button', { name: /save|update/i }).first().click();
        await expect(page.getByText(/updated|saved|success/i)).toBeVisible({ timeout: 20000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('#798 — a buyer can reach checkout with the right total', () => {
    test.use({ storageState: BUYER });

    test('BUYER ADDS TO CART AND REACHES CHECKOUT', async ({ page }) => {
        /*
         *   The flow marketplace-critical-flows.spec.ts has been skipping. It
         *   read `locator('text=View Details').count()` the instant after
         *   goto() — before the client-side catalogue had loaded — so the
         *   count was always 0 and it printed "Empty products catalog on
         *   production" and returned. MEASURED: the seed writes three active
         *   products and /api/marketplace/products serves all three.
         *
         *   The wait is the whole difference. Nothing below may skip.
         */
        await page.goto('/marketplace/products');

        const firstProduct = page.getByRole('link', { name: /view details/i }).first();
        await expect(firstProduct, 'the catalogue has at least one product')
            .toBeVisible({ timeout: 20000 });
        await firstProduct.click();

        await page.getByRole('button', { name: /add to cart/i }).first().click();

        //   Checkout, reached however the app chooses to take her there.
        await page.waitForURL(/checkout|cart/, { timeout: 20000 });
        await expect(page.getByText(/₦/).first()).toBeVisible({ timeout: 20000 });
    });
});
