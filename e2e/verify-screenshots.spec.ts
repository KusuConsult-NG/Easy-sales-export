import { test, expect, type Page } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';
import { mkdirSync } from 'fs';

/**
 * Screenshots of every screen this audit changed, for the owner to verify.
 *
 *   NOT A TEST OF BEHAVIOUR. The findings each have their own suite; this exists
 *   only to photograph what a person actually sees, because "15,105 tests pass"
 *   and "the screen shows what I asked for" are different claims and only the
 *   second one is what was asked for here.
 *
 *   IT RUNS AGAINST THE LOCAL STACK, not production. Every image is this branch
 *   rendered against a local database seeded by scripts/local-stack — so it
 *   shows what the code does, not what is deployed. That distinction matters:
 *   nothing in this session has ever been able to reach production.
 *
 *   Each shot is full-page and named for the finding it evidences.
 */

const OUT = 'screenshots';

test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
});

/** Settle the page: fonts, images and any client fetch the screen makes. */
async function settle(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    //   networkidle rather than load: these screens fetch after hydration, and a
    //   photograph taken before that is a picture of a spinner.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1200);
}

async function shot(page: Page, name: string) {
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test.describe('what the owner sees', () => {
    /*
     *   NOT serial. These are independent photographs, and running them in a
     *   chain means one screen that will not open costs every screen after it —
     *   which is what happened first time round.
     */
    test.describe.configure({ mode: 'parallel', retries: 0 });

    test('#856 #857 #859 #860 #861 #868 #869 — the listing form', async ({ page }) => {
        await loginAs(page, USERS.seller.email, USERS.seller.password);
        await page.goto('/farm-nation/list-land');

        const title = page.locator('input[placeholder="e.g., 50 Acres Farmland in Kaduna"]');
        await expect(title).toBeVisible({ timeout: 20000 });
        await title.fill('Prime Agricultural Land in Kano');

        //   #869 one category, #857 state then LGA.
        await page.getByRole('button', { name: /Farmland/i }).first().click();
        await page.locator('select').first().selectOption('Enugu').catch(() => undefined);

        await shot(page, '01-list-land-top');

        //   #869 tick a second offer so the rent price and the term appear.
        const forRent = page.getByRole('button', { name: /For Rent/i }).first();
        if (await forRent.isVisible().catch(() => false)) await forRent.click();

        await page.getByText(/Listing Type/i).first().scrollIntoViewIfNeeded().catch(() => undefined);
        await shot(page, '02-list-land-offers-and-rent-price');

        //   #868 the map picker, #860 the extra documents.
        await page.getByText(/Location on the map/i).first().scrollIntoViewIfNeeded().catch(() => undefined);
        await shot(page, '03-list-land-location-picker');

        await page.getByText(/Other Supporting Documents/i).first()
            .scrollIntoViewIfNeeded().catch(() => undefined);
        await shot(page, '04-list-land-multiple-documents');
    });

    test('#865 — NIN and BVN on Farm Nation onboarding', async ({ page }) => {
        await loginAs(page, USERS.user.email, USERS.user.password);
        await page.goto('/farm-nation/onboarding');
        //   The NIN/BVN fields are on step 2 (Profile & Location); step 1 picks
        //   the account type. A screenshot of step 1 evidences nothing.
        await settle(page);
        //   Step 1 asks what the applicant is here to do, and Continue stays
        //   disabled until it is answered.
        await page.getByText(/Property Seller/i).first().click().catch(() => undefined);
        await page.getByRole('button', { name: /Continue/i }).first().click().catch(() => undefined);
        await page.getByText(/KYC Notice/i).first().waitFor({ timeout: 20000 }).catch(() => undefined);
        await shot(page, '05-onboarding-nin-bvn');
    });

    test('#867 — hot deals on Farm Nation', async ({ page }) => {
        await page.goto('/farm-nation/properties');
        await shot(page, '06-farm-nation-hot-deals-filter');
    });

    test('#867 — flash sales on the marketplace', async ({ page }) => {
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
        await page.goto('/marketplace/buyer/products');
        await shot(page, '07-marketplace-flash-sales-tab');
    });

    test('#862 #864 — the admin land verification queue', async ({ page }) => {
        await loginAs(page, USERS.admin.email, USERS.admin.password);
        await page.goto('/admin/farm-nation/land-verification');
        await shot(page, '08-admin-land-verification');

        //   Open the first row so the dispatch tab and its new fields show.
        //   Best-effort: the queue may be empty on a fresh local database, and a
        //   missing row is not a failure of the thing being photographed.
        const row = page.locator('tbody tr, [data-testid="verification-row"]').first();
        if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
            await row.click().catch(() => undefined);
            await page.getByText(/Inspector Dispatch/i).first().click().catch(() => undefined);
            await settle(page);
            await page.screenshot({ path: `${OUT}/09-admin-inspector-dispatch.png`, fullPage: true })
                .catch(() => undefined);
        }
    });

    test('#866 — marketplace seller onboarding documents', async ({ page }) => {
        await loginAs(page, USERS.user.email, USERS.user.password);
        await page.goto('/marketplace/onboarding');
        await shot(page, '10-marketplace-onboarding-uploads');
    });

    test('#869 — the Farm Nation map', async ({ page }) => {
        await page.goto('/farm-nation/map');
        await shot(page, '11-farm-nation-map');
    });
});
