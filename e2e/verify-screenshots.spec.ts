import { test, expect, type Page } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';
import { mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

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

    /*
     *   A LISTING THAT ACTUALLY HAS THE DATA THESE SHOTS ARE ABOUT.
     *
     *   Two of the screens only appear when a listing carries something: #871's
     *   map needs `gpsCoordinates`, and #867's Hot Deal badge needs a recent
     *   price cut. The seeded plots have neither, so photographing them proved
     *   the GUARDS — no coordinates, no map — and not the features.
     *
     *   Seeded HERE rather than by hand, because the Playwright global setup
     *   reseeds the database before every run and wiped anything prepared
     *   outside it. Local stack only; it reaches nothing but 127.0.0.1.
     *
     *   Best-effort: if psql is unavailable the shots still run and simply show
     *   the guards, which is the honest fallback rather than a failed suite.
     */
    try {
        execFileSync('psql', [
            '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-tAc',
            `update document_collections
               set raw_data = raw_data
                 || jsonb_build_object('previousPrice', 6250000)
                 || jsonb_build_object('priceReducedAt',
                      to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                 || jsonb_build_object('gpsCoordinates',
                      jsonb_build_object('latitude', 6.212, 'longitude', 7.153))
             where collection_name = 'land_listings'
               and raw_data->>'title' = 'E2E Farmland Plot 2';`,
        ], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'pipe' });
    } catch {
        //   Nothing to do: the shots below degrade to showing the guards.
    }

    /*
     *   #870's support picker only appears for a member of MORE THAN ONE module
     *   — one module needs no question. Every seeded persona belongs to exactly
     *   one, so the seller is given the farmer role here to make the choice real.
     *   Local stack only.
     */
    try {
        execFileSync('psql', [
            '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-tAc',
            /*
             *   BOTH COPIES, and this is not belt-and-braces.
             *
             *   `users` is a dedicated table: `roles` is a native column AND it
             *   lives in raw_data. Queries filter on the COLUMN; doc.data()
             *   returns raw_data and falls back to the column only when the key
             *   is absent — deliberate, documented in supabase-db, and the same
             *   on both read paths.
             *
             *   Every application write goes through buildDedicatedRow, which
             *   writes the two from one object, so they cannot disagree. RAW SQL
             *   CAN. Updating the column alone produced a user who matched
             *   `array-contains 'farmer'` and came back without the role — which
             *   failed #472's DB test against correct code.
             */
            `update users
                set roles = array(select distinct unnest(roles || array['farmer'])),
                    raw_data = jsonb_set(raw_data, '{roles}',
                                 to_jsonb(array(select distinct unnest(
                                     roles || array['farmer']))))
              where email = 'e2e.seller@easysalesexport.com';`,
        ], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'pipe' });
    } catch {
        //   The picker then simply will not render, which the shot will show.
    }

    /*
     *   #872's reply box is on an inquiry, and the seed has never written one —
     *   an enquiry is something a member of the public sends, so nothing in the
     *   fixtures creates it. Without a row the screen shows "No Inquiries Yet",
     *   which photographs the empty state and not the finding.
     *
     *   Written as an ISO string because that is what every other row in this
     *   table holds: the Postgres adapter serialises serverTimestamp() that way,
     *   and the list orders by it.
     */
    try {
        execFileSync('psql', [
            '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-tAc',
            `insert into document_collections (id, collection_name, raw_data)
             values ('e2e-inquiry-1', 'land_inquiries', jsonb_build_object(
                 'listingId', 'e2e-listing-1',
                 'listingTitle', 'E2E Farmland Plot 1',
                 'listingOwnerId', (select id from users
                                     where email = 'e2e.seller@easysalesexport.com'),
                 'buyerName', 'Emeka Nwosu',
                 'buyerEmail', 'emeka@example.com',
                 'buyerPhone', '08040000000',
                 'message', 'Is the borehole working, and can I inspect it this weekend?',
                 'status', 'pending',
                 'read', false,
                 'createdAt', to_char(now() at time zone 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
             on conflict (id, collection_name) do nothing;`,
        ], { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'pipe' });
    } catch {
        //   The list then shows its empty state, which the shot will show.
    }
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

        //   Open the first submission so the property details the inspector is
        //   sent are visible. The row itself is not clickable — Review is the
        //   door, which is why clicking the row photographed the queue twice.
        const review = page.getByRole('button', { name: /Review/i }).first();
        if (await review.isVisible({ timeout: 8000 }).catch(() => false)) {
            await review.click().catch(() => undefined);
            await settle(page);
            await page.screenshot({ path: `${OUT}/09-admin-verification-details.png`, fullPage: true })
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

    test('#870 — the messages screen and its support picker', async ({ page }) => {
        await loginAs(page, USERS.seller.email, USERS.seller.password);
        await page.goto('/messages');
        await settle(page);
        //   The picker and the Contact Support button live behind New Chat.
        await page.getByRole('button', { name: 'New conversation' })
            .click().catch(() => undefined);
        await shot(page, '12-messages-support-picker');
    });

    test('#872 — an inquiry can be answered', async ({ page }) => {
        await loginAs(page, USERS.seller.email, USERS.seller.password);
        await page.goto('/farm-nation/inquiries');
        await shot(page, '13-inquiries-list');

        //   Open the first one if the local database has any; the reply box is
        //   on the detail screen.
        const first = page.locator('a[href*="/farm-nation/inquiries/"]').first();
        if (await first.isVisible({ timeout: 5000 }).catch(() => false)) {
            await first.click().catch(() => undefined);
            await settle(page);
            //   The page scrolls inside its own pane, so a full-page shot stops
            //   at the viewport and cuts the reply box in half. Bring it up.
            await page.getByPlaceholder(/Answer their question/i).first()
                .scrollIntoViewIfNeeded().catch(() => undefined);
            await shot(page, '14-inquiry-reply-box');
        }
    });

    test('#871 — coordinates on the property details page', async ({ page }) => {
        await page.goto('/farm-nation/properties');
        await settle(page);
        const view = page.getByRole('link', { name: /View Details/i }).first();
        if (await view.isVisible({ timeout: 8000 }).catch(() => false)) {
            await view.click().catch(() => undefined);
            await shot(page, '15-property-details-map');
        }
    });

    test('#864 — the admin dispatch and report panel', async ({ page }) => {
        await loginAs(page, USERS.admin.email, USERS.admin.password);
        await page.goto('/admin/farm-nation/land-verification');
        await settle(page);

        //   Review opens the submission; the dispatch form is behind its second
        //   tab, which is where #862's inspector email and #864's gate live.
        const review = page.getByRole('button', { name: /Review/i }).first();
        if (await review.isVisible({ timeout: 8000 }).catch(() => false)) {
            await review.click().catch(() => undefined);
            await settle(page);
            await page.getByRole('button', { name: /Inspector Dispatch/i })
                .first().click().catch(() => undefined);
            await shot(page, '16-admin-inspector-dispatch');
        }
    });
});
