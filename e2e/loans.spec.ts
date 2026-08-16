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
        const uploadResponse = page.waitForResponse(
            r => r.url().includes('/api/upload') && r.request().method() === 'POST',
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
        // Wait for the upload REQUEST, not for text on the page.
        //
        // A first attempt waited for /uploaded|id\.pdf/i and passed instantly
        // against the word "Upload" already in the step's own heading — a
        // vacuous assertion that let the test continue with no document
        // attached and fail two steps later. The response is the only
        // unambiguous signal that `documents` has been populated.
        await uploadResponse;
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

    test('should show validation errors for invalid amounts', async ({ page }) => {
        await page.goto('/loans/apply');

        // Wait for the form to be live before typing into it.
        //
        // This filled immediately after goto() and then asserted the field held
        // "0", which failed. The wizard is a react-hook-form client component:
        // until it hydrates and register() binds the input, a fill can be
        // discarded by RHF's own reset. The sibling test above never hit this
        // because it reaches the page by clicking through, which takes long
        // enough for hydration to finish — a timing difference that reads as
        // "the amount field is broken".
        const amountField = page.locator('input[name="amount"]');
        await expect(amountField).toBeVisible({ timeout: 15000 });
        await expect(page.locator('text=Next').first()).toBeVisible({ timeout: 15000 });

        // Try to submit with invalid amount (0)
        await amountField.fill('0');
        await expect(amountField).toHaveValue('0');
        await page.click('text=Next');

        // Should see validation error
        const errorMessage = page.locator('text=Minimum loan amount is ₦1,000');
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
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
