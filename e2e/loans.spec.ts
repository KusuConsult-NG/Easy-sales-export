import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';

test.describe('Loan Application Flow', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
        await loginAs(page, USERS.user.email, USERS.user.password);
    });

    test('should complete loan application successfully', async ({ page }) => {
        // 1. Navigate to loans page
        await page.goto('/loans');

        // 2. Click "Apply for Loan" button
        await page.click('text=Apply for Loan');

        // 3. Wait for application form
        await page.waitForURL('/loans/apply');
        await expect(page.locator('h1, h2').first()).toContainText(/Loan/i);

        // Step 1: Details
        console.log("Wizard Step 1: Filling details...");
        await page.fill('input[name="amount"]', '50000');
        await page.fill('input[name="repaymentPeriod"]', '12');
        await page.click('text=Next');
        console.log("Wizard Step 1 Next clicked. URL:", page.url());

        // Step 2: Collateral
        console.log("Wizard Step 2: Filling collateral...");
        await page.fill('input[name="collateral.type"]', 'Farmland');
        await page.fill('input[name="collateral.value"]', '100000');
        await page.fill('textarea[name="collateral.description"]', 'Farming land located in Kano state');
        await page.click('text=Next');
        console.log("Wizard Step 2 Next clicked. URL:", page.url());

        // Step 3: Business Details
        console.log("Wizard Step 3: Filling business details...");
        await page.fill('input[name="businessDetails.name"]', 'Kano Farm Cooperative');
        await page.fill('input[name="businessDetails.type"]', 'Agriculture');
        await page.fill('input[name="businessDetails.yearsInOperation"]', '5');
        await page.fill('input[name="businessDetails.annualRevenue"]', '200000');
        await page.click('text=Next');
        console.log("Wizard Step 3 Next clicked. URL:", page.url());

        // Step 4: Documents.
        //
        // This clicked Next with the comment "simplified/default documents
        // used". There are no defaults: loanApplicationSchema requires
        // `documents` to have at least one entry, and step 4 validates that
        // field before advancing. So the wizard never left step 4, and the
        // failure surfaced two steps later as "Submit Application not visible",
        // which reads like a broken step 5.
        console.log("Wizard Step 4: Uploading a document...");
        // Wait for the SERVER ACTION, not for /api/upload.
        //
        // The wizard uploads through uploadDocumentAction, a server action —
        // it never touches /api/upload. A previous attempt waited on that
        // route and blocked until its own timeout, so the document was still
        // unattached when Next was clicked, and step 4 refused to advance.
        // Zero /api/upload requests was the correct observation and the wrong
        // conclusion: the path simply is not that one.
        //
        // Server actions POST to the current URL, so that is the signal.
        const uploadResponse = page.waitForResponse(
            r => r.request().method() === 'POST' && r.url().includes('/loans/apply'),
            { timeout: 30000 },
        );
        // Scoped to the Government-issued ID uploader rather than "the first
        // file input on the page" — the layout renders others, and picking the
        // wrong one silently uploads nothing.
        await page.locator('label:has-text("Government-issued ID") >> xpath=.. >> input[type="file"]').first().setInputFiles({
            name: 'id.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4 e2e identity document'),
        });
        // Two signals, in order, because neither alone is sufficient.
        //
        // A first attempt waited for /uploaded|id\.pdf/i and passed instantly
        // against the word "Upload" already in the step's own heading — a
        // vacuous assertion that let the test continue with no document
        // attached and fail two steps later.
        //
        // Waiting only for the POST response is not enough either: the
        // response arriving is not the same as React having processed it. The
        // action resolves, then setValue("documents", ...) runs, then the
        // component re-renders. Clicking Next in that gap validates an empty
        // `documents` array, step 4 refuses to advance, and the failure
        // surfaces on step 5 as a missing Submit button.
        //
        // The rendered "Uploaded (1)" counter is the only thing that means the
        // form field is populated, and an exact match cannot be satisfied by
        // the "Upload Documents" heading.
        await uploadResponse;
        await expect(page.getByText(/^Uploaded \(1\)$/)).toBeVisible({ timeout: 15000 });
        await page.click('text=Next');
        console.log("Wizard Step 4 Next clicked. URL:", page.url());

        // Step 5: Review & Submit
        console.log("Wizard Step 5: Clicking Submit Application...");
        const submitBtn = page.locator('button:has-text("Submit Application")');
        await expect(submitBtn).toBeVisible({ timeout: 10000 });
        await submitBtn.click();
        
        console.log("Waiting for URL to contain success...");
        await page.waitForURL(/.*\/loans\/success/, { timeout: 15000 });
        console.log("Reached success URL! URL:", page.url());

        // 5. Verify success (redirect to success page)
        await expect(page.locator('text=Loan Application Submitted!')).toBeVisible({ timeout: 15000 });

        console.log('✅ Loan application submitted via wizard');
    });

    test.skip('should display user eligibility information (cooperative-only feature)', async ({ page }) => {
        await page.goto('/loans/apply');

        // Check for eligibility info
        const eligibilityCard = page.locator('[data-testid="eligibility-info"]');
        await expect(eligibilityCard).toBeVisible({ timeout: 5000 });

        // Should show tier and max loan amount
        await expect(page.locator('text=Your Tier')).toBeVisible();
        await expect(page.locator('text=Max Loan Amount')).toBeVisible();
    });
});

/**
 * Split out of "Loan Application Flow" deliberately.
 *
 * That describe's beforeEach signs in as USERS.user, and this test needs a
 * different borrower — the test above SUBMITS an application as USERS.user,
 * and a borrower with an open application is refused a second one, so
 * /loans/apply stops presenting a fresh wizard.
 *
 * The first attempt at that was a SECOND loginAs inside the test body, which
 * failed about two runs in five. Two consecutive next-auth signIn() calls in
 * one page race: the second throws
 *
 *     ClientFetchError: Failed to fetch  (at getSession, inside signIn)
 *
 * and when it does, the FIRST session survives. The browser log gave it away —
 * SessionGuard was fetching e2e.user's id on a test that had just asked to be
 * e2e.wave. The wizard then belonged to a borrower with an open application,
 * and the amount field never behaved as the test expected.
 *
 * One describe, one persona, one login.
 */
test.describe('Loan Application Validation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
        // A borrower nobody else files an application for.
        await loginAs(page, USERS.wave.email, USERS.wave.password);
    });

    test('should show validation errors for invalid amounts', async ({ page }) => {
        await page.goto('/loans/apply');

        // Wait for react-hook-form to APPLY ITS DEFAULT before typing.
        //
        // useForm gives amount a defaultValue of 10000, and RHF writes it into
        // the input after mount. Filling before that lands does not get
        // overwritten — it gets MERGED: a fill of "0" into a field RHF is about
        // to populate produced "100000", which then settled to "10000". The
        // test asserted "0" and saw neither.
        //
        // Waiting for the field to be visible is not enough, and neither is
        // waiting for the Next control: both are present before the default
        // arrives. The default itself is the only signal that RHF has finished,
        // so that is what is waited on.
        const amountField = page.locator('input[name="amount"]');
        await expect(amountField).toBeVisible({ timeout: 15000 });
        await expect(amountField).toHaveValue('10000', { timeout: 15000 });

        // Fill and RE-fill until it sticks.
        //
        // Retrying the ASSERTION cannot help and Playwright already does it:
        // when this goes wrong the field reverts to its default and stays
        // there, so the fill is what has to be repeated. The layout remounts
        // after navigation — NotificationCenter was measured issuing 6
        // server-action POSTs in 20 idle seconds, three times the single 10s
        // poll it schedules — and each remount re-initialises react-hook-form
        // from defaultValues, putting 10000 back.
        //
        // Belt and braces alongside the single login above; the polling
        // multiplication is recorded separately as a defect of its own.
        await expect.poll(async () => {
            await amountField.fill('0');
            return amountField.inputValue();
        }, { timeout: 20000, message: 'amount field kept reverting to its default' }).toBe('0');
        await page.click('text=Next');

        // Should see validation error
        const errorMessage = page.locator('text=Minimum loan amount is ₦1,000');
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
    });

});

test.describe('Loan Approval (Admin)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.admin.email, USERS.admin.password);
    });

    test('should view and approve pending loan applications', async ({ page }) => {
        // Log browser console
        page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

        // 1. Navigate to admin loans page
        await page.goto('/admin/cooperatives/loans');

        // 2. Verify pending loans table
        const loansTable = page.locator('table');
        await expect(loansTable).toBeVisible({ timeout: 20000 });

        // 3. Approve THIS TEST'S OWN ROW, not "whatever is first".
        //
        // The queue is ordered newest-first and the wizard test above files an
        // application for E2E Member, so `.first()` actioned that row instead —
        // and it has guarantorVerified false, which approveLoanAction refuses.
        // The test passed alone and failed in sequence, which reads like a
        // broken approval rather than a test picking the wrong row.
        //
        // The seeded pending application belongs to E2E Cooperative (see
        // scripts/seed-local.ts) and carries the guarantorVerified and
        // contributionAmount approval requires.
        const seededRow = page.locator('table tr', { hasText: 'E2E Cooperative' }).first();
        await expect(seededRow).toBeVisible({ timeout: 15000 });
        const approveButton = seededRow.locator('button[title="Approve Loan"]').first();

        if (await approveButton.isVisible()) {
            console.log("Approve button is visible. Registering dialog handler...");
            // Handle browser confirm dialog
            page.on('dialog', async dialog => {
                console.log(`DIALOG RECEIVED: type=${dialog.type()}, message="${dialog.message()}"`);
                await dialog.accept();
                console.log("DIALOG ACCEPTED");
            });
            
            console.log("Clicking Approve button...");
            await approveButton.click();
            console.log("Approve button clicked.");

            // 5. Verify success message
            await expect(page.locator('text=Loan application approved!').first()).toBeVisible({ timeout: 15000 });

            console.log('✅ Loan approved by admin');
        } else {
            console.log('⚠️ No pending loans to approve');
        }
    });
});
