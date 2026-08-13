/**
 * @jest-environment node
 */

/**
 * Every cooperative loan was recorded at 5% over 6 months, whatever product the
 * member chose.
 *
 * #145 found "two places that computed money from" a loan product and made both
 * call calculateRepaymentTerms: /api/cooperative/apply-loan and the member-facing
 * estimate on /cooperatives/loans. There were three.
 *
 * _applyForLoanAction — the one the member form actually submits to — read the
 * product like this:
 *
 *     let interestRate = 5; // Default 5%
 *     let durationMonths = 6;
 *
 *     const productDoc = await db.collection(COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS).doc(productId).get();
 *     if (productDoc.exists) { ... }
 *
 * COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS is "cooperative_loan_products", and
 * NOTHING WRITES IT. Every product an admin creates goes to
 * COLLECTIONS.LOAN_PRODUCTS ("loan_products") — what the four admin CRUD routes,
 * the public list and apply-loan all use. The only reference to the other name
 * anywhere in the repository is the line defining it.
 *
 * So `productDoc.exists` was always false, and every application fell through to
 * the defaults.
 *
 * WHAT THE MEMBER SAW
 * -------------------
 * The loans page fetches products from /api/cooperative/loan-products, displays
 * each real rate, and quotes with calculateRepaymentTerms — the half #145
 * corrected. Then the form submits here through useActionState.
 *
 * A borrower was quoted their chosen product's terms and the loan was written at
 * 5% over 6 months. The quote and the record disagreed by construction.
 *
 * THE ARITHMETIC DIFFERED TOO
 * ---------------------------
 * The action computed `amount * (interestRate / 100)` once — a flat charge —
 * while the route, the quote, cooperative-tiers.ts and loan-terms.ts all treat
 * interestRate as a MONTHLY rate. That is the very defect #145 fixed in the
 * other two copies.
 *
 * All three call calculateRepaymentTerms now, and the action fails closed on a
 * missing or malformed product exactly as the route does. A silent default is
 * what turned a wrong collection name into money.
 *
 * AND A SWITCHED-OFF PRODUCT WAS STILL OFFERED
 * --------------------------------------------
 * create-loan-product and update-loan-product both write
 * `isActive: Boolean(isActive)`, and nothing read it — not the public route, not
 * the admin list, not the application path. Deactivating a product removed it
 * from nowhere.
 *
 * Third collected-stored-never-consulted control in this audit, after MFA
 * enforcement and the notification settings. This one had a price on it.
 *
 * The same route also returned `createdBy` — an admin's user id — with no
 * authentication, which is the export-catalogue and land-listing shape a third
 * time.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calculateRepaymentTerms } from '@/lib/loan-terms';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const action = source('src/app/actions/cooperative/_actions.ts');
const publicRoute = source('src/app/api/cooperative/loan-products/route.ts');
const applyRoute = source('src/app/api/cooperative/apply-loan/route.ts');
const page = source('src/app/cooperatives/(member)/loans/page.tsx');

describe("the loan is written on the chosen product's terms", () => {
    it('reads the collection the admin actually writes', () => {
        // THE test.
        const code = codeOnly(action);

        expect(code).toContain('COLLECTIONS.LOAN_PRODUCTS).doc(productId).get()');
        expect(code).not.toContain('COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS');
    });

    it('the empty collection is referenced nowhere but its own definition', () => {
        // The premise, asserted so it cannot quietly come back.
        const refs = execSync(
            `grep -rn 'COOPERATIVE_LOAN_PRODUCTS' src --include='*.ts' || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        )
            .split('\n')
            .filter(Boolean)
            .filter((l) => !l.includes('__tests__'))
            .filter((l) => {
                const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
            });

        expect(refs.map((r) => r.split(':')[0])).toEqual(['src/lib/types/firestore.ts']);
    });

    it('there is no silent default any more', () => {
        const code = codeOnly(action);

        expect(code).not.toContain('let interestRate = 5');
        expect(code).not.toContain('let durationMonths = 6');
        expect(action).toContain('That loan product is no longer available.');
    });

    it('refuses a product with unusable terms, as the route does', () => {
        expect(action).toContain('!Number.isFinite(interestRate)');
        expect(action).toContain('!Number.isInteger(durationMonths)');
        expect(applyRoute).toContain('!Number.isFinite(product.interestRate)');
    });

    it('all three paths call the same repayment function', () => {
        // #145 made two of them agree. This is the third.
        expect(action).toContain('calculateRepaymentTerms(amount, durationMonths, interestRate)');
        expect(applyRoute).toContain('calculateRepaymentTerms(');
        expect(page).toContain('calculateRepaymentTerms(');
    });

    it('no longer charges a flat percentage', () => {
        expect(codeOnly(action)).not.toContain('amount * (interestRate / 100)');
    });

    it('and the difference was not academic', () => {
        // The monthly reading against the flat one the action used, on a real
        // shape of loan.
        const monthly = calculateRepaymentTerms(1_000_000, 12, 10);
        const flatInterest = 1_000_000 * (10 / 100);

        expect(monthly.totalRepayment - 1_000_000).toBeGreaterThan(flatInterest * 2);
    });

    it('still records the fields a loan needs', () => {
        // Vacuity guard: throwing on everything satisfies the assertions above
        // and removes loan applications.
        for (const field of ['interestAmount,', 'totalRepayment,', 'monthlyPayment,', 'durationMonths,']) {
            expect(action).toContain(field);
        }
    });

    it('the member form submits through this action', () => {
        // The premise for severity: this is the live path, not the route.
        expect(page).toContain('useActionState(applyForLoanAction, initialState)');
    });
});

describe('a switched-off product is not offered', () => {
    it('the public list filters on isActive', () => {
        expect(publicRoute).toContain('.where("isActive", "==", true)');
    });

    it('the flag is written by both admin paths', () => {
        // Which makes filtering on it honouring an existing intent rather than
        // inventing one.
        for (const r of ['create-loan-product', 'update-loan-product']) {
            expect(source(`src/app/api/admin/cooperative/${r}/route.ts`))
                .toContain('isActive: Boolean(isActive)');
        }
    });

    it('the admin list stays unfiltered, deliberately', () => {
        // An admin managing products has to see the inactive ones.
        expect(source('src/app/api/admin/cooperative/loan-products/route.ts'))
            .not.toContain('.where("isActive"');
    });
});

describe('the public list publishes named fields only', () => {
    it('does not spread the document', () => {
        expect(codeOnly(publicRoute)).not.toContain('...doc.data()');
        expect(publicRoute).toContain('PUBLIC_PRODUCT_FIELDS');
    });

    it('does not publish the admin who created the product', () => {
        const listed = publicRoute.slice(
            publicRoute.indexOf('const PUBLIC_PRODUCT_FIELDS'),
            publicRoute.indexOf('] as const')
        );

        expect(listed).not.toContain('createdBy');
    });

    it('publishes what a borrower needs to choose', () => {
        // Vacuity guard: an empty list satisfies the two above and empties the
        // product page.
        const listed = publicRoute.slice(
            publicRoute.indexOf('const PUBLIC_PRODUCT_FIELDS'),
            publicRoute.indexOf('] as const')
        );

        for (const field of ['name', 'description', 'minAmount', 'maxAmount', 'interestRate', 'durationMonths']) {
            expect(listed).toContain(`"${field}"`);
        }
    });

    it('the page reads those fields', () => {
        expect(page).toContain('/api/cooperative/loan-products');
        expect(page).toContain('interestRate');
    });
});

describe('the suite #145 left in place', () => {
    it('still covers the product validation it was written for', () => {
        // Separate files on purpose: that one mocks the session and exercises
        // the admin write path, this one is about which product the borrower's
        // loan is priced from.
        expect(source('src/__tests__/unit/loan-product-terms.test.ts'))
            .toContain('A loan product whose numbers cannot describe a loan');
    });
});
