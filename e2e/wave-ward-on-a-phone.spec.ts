import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

/**
 * #823 — the ward field, on a phone, and on the way back.
 *
 * The owner: "The issue with ward is that it is not populating when users are
 * filling the form and go back to make corrections in what was filled
 * previously. also on mobile the dropdown doesnt show. The implementation has
 * to be mobile responsive."
 *
 * The unit suite proves the control renders real DOM. This proves the two
 * things only a browser can: that the list is VISIBLE inside a phone-sized
 * viewport, and that it comes back when an applicant returns to the step to
 * correct her answer.
 *
 * A PHONE VIEWPORT, not a device emulation. The defect was a `<datalist>`,
 * which iOS Safari declines to draw — nothing in this repository can prove
 * anything about iOS Safari, and pretending otherwise with a WebKit user agent
 * would be worse than not testing it. What IS testable, and is what the fix
 * turns on: the list is drawn by this application, so it is subject to this
 * application's layout and fits a 390px screen.
 */

/** iPhone 14 logical width — the narrowest mainstream phone this form meets. */
const PHONE = { width: 390, height: 844 };

test.describe('WAVE ward field on a phone', () => {
    test.use({ viewport: PHONE });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(180000);
        await loginAs(page, USERS.user.email, USERS.user.password);
        await page.goto('/wave/application');
        await page.evaluate(() => {
            Object.keys(localStorage)
                .filter(k => k.startsWith('wave_app_draft_'))
                .forEach(k => localStorage.removeItem(k));
        });
        await page.reload();
    });

    async function fillStepOne(page: any) {
        await page.fill('label:has-text("Surname (as on NIN)") + input', 'Doe');
        await page.fill('label:has-text("First Name (as on NIN)") + input', 'Jane');
        await page.fill('label:has-text("Date of Birth") + input', '1995-05-15');
        await page.fill('label:has-text("Phone Number (Primary)") + input', '08012345678');
        await page.fill('textarea[placeholder="Your current residential address"]', '123 Farm Road, Kaduna');
        await page.selectOption('label:has-text("State of Origin") + select', 'Kaduna');
        await page.selectOption('label:has-text("Local Government Area (LGA)") + select', 'Kaduna North');
        await page.selectOption('label:has-text("State of Residence") + select', 'Kaduna');
        await page.selectOption('label:has-text("Local Government of Residence") + select', 'Kaduna North');
        await page.check('input[name="maritalStatus"][value="single"]');
        await page.fill('label:has-text("Next of Kin Name") + input', 'John Doe');
        await page.fill('label:has-text("Next of Kin Phone Number") + input', '08033334444');
        await page.fill('label:has-text("Relationship with Next of Kin") + input', 'Brother');
        await page.click('button:has-text("Continue to Civic Status")');
    }

    test('the ward list opens, is visible on a 390px screen, and returns after going back', async ({ page }) => {
        await fillStepOne(page);

        const ward = page.getByRole('combobox', { name: 'Ward (based on residence)' });
        await expect(ward).toBeVisible();

        // ── 1. It opens at all, which the datalist never did on a phone.
        await ward.click();
        const list = page.getByRole('listbox').first();
        await expect(list).toBeVisible();

        const optionCount = await page.getByRole('option').count();
        expect(optionCount).toBeGreaterThan(1);

        // ── 2. It FITS. A list that opens below the fold is not a list she can
        //      use, and a fixed max-height is what pushes one off a small screen.
        const box = await list.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThanOrEqual(PHONE.width);
        expect(box!.height).toBeLessThanOrEqual(PHONE.height);

        // ── 3. She picks one.
        const chosen = (await page.getByRole('option').first().textContent())?.trim() ?? '';
        expect(chosen.length).toBeGreaterThan(0);
        await page.getByRole('option').first().click();
        await expect(ward).toHaveValue(chosen);

        // ── 4. THE REPORTED CASE: back to correct something, then forward.
        await page.click('button:has-text("Back")');
        await expect(page.locator('label:has-text("Local Government of Residence")')).toBeVisible();
        await page.click('button:has-text("Continue to Civic Status")');

        const wardAgain = page.getByRole('combobox', { name: 'Ward (based on residence)' });
        await expect(wardAgain).toHaveValue(chosen);

        // ── 5. And the WHOLE list comes back, not just the chosen one. This is
        //      what a datalist got wrong: it filters by the field's value, so
        //      she saw nothing and could not change her mind.
        await wardAgain.click();
        await expect(page.getByRole('listbox').first()).toBeVisible();
        expect(await page.getByRole('option').count()).toBe(optionCount);
    });
});
