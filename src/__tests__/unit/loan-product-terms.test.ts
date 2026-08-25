/**
 * @jest-environment node
 */

/**
 * A loan product whose numbers cannot describe a loan, and two places that
 * computed money from it.
 *
 * THE BYPASS
 * ----------
 * There are two ways to write COLLECTIONS.LOAN_PRODUCTS.
 * /api/admin/cooperative/create-loan-product validates its input — required
 * fields, minAmount < maxAmount, Number() and Boolean() coercion — and stamps
 * createdBy/createdAt/updatedAt.
 *
 * createAdminLoanProductAction did none of it. `add(data)` wrote whatever
 * arrived, and `Omit<LoanProduct, "id">` is a TypeScript type, erased before the
 * request lands. updateAdminLoanProductAction was `update(data as any)`.
 *
 * Both are admin-only, so this is not a privilege hole. It is a validation
 * bypass into a collection the money path reads: /api/cooperative/apply-loan
 * fetches the product and computes the borrower's monthly payment from its
 * interestRate and durationMonths.
 *
 * WHAT A BAD PRODUCT DID DOWNSTREAM
 * ---------------------------------
 *   durationMonths: 0      denominator (1+r)^0 - 1 = 0, so the payment is
 *                          Infinity
 *   minAmount > maxAmount  the range check can never pass; the product is
 *                          silently unusable rather than visibly wrong
 *   negative interestRate  a negative instalment — the lender pays the borrower
 *
 * THE DIVISION BY ZERO
 * --------------------
 * apply-loan inlined the annuity formula:
 *
 *     const monthlyRate = product.interestRate / 100;
 *     const monthlyPayment = (amount * monthlyRate * (1+r)^n) / ((1+r)^n - 1);
 *
 * At a rate of ZERO that is 0/0 = NaN, and `monthlyPayment: NaN` was written
 * onto the loan application. An interest-free product is a perfectly ordinary
 * thing for a cooperative to offer.
 *
 * lib/loan-terms.ts already solved this, and its comment names the case exactly:
 * "A zero rate is interest-free: the annuity formula divides by zero there." It
 * validates its inputs and runs in kobo so a schedule does not drift. So a zero
 * rate is ALLOWED by the new validation and handled properly, rather than banned
 * to work around the arithmetic.
 *
 * THE ONE A BORROWER COULD SEE
 * ----------------------------
 * The member-facing calculator at /cooperatives/loans had a third copy:
 *
 *     const monthlyRate = rate / 100 / 12;
 *
 * dividing by 12, treating the product's monthly interestRate as annual.
 * cooperative-tiers.ts and loan-terms.ts both establish it is monthly, and
 * apply-loan's own comment records that this same defect was found and fixed on
 * the SERVER. The client copy was left behind.
 *
 * So the estimate shown before applying was far below the real instalment. All
 * three now call calculateRepaymentTerms.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { calculateRepaymentTerms } from '@/lib/loan-terms';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

function setStored(data: Record<string, any> | null) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: data !== null,
        empty: data === null,
        size: data ? 1 : 0,
        docs: data ? [{ id: 'p1', data: () => data }] : [],
        data: () => data ?? {},
    }));
}

const VALID = {
    name: 'Starter', description: 'A small loan',
    minAmount: 10_000, maxAmount: 500_000,
    interestRate: 10, durationMonths: 12, isActive: true,
};

describe('the arithmetic a bad product would have driven', () => {
    it('divides by zero at a rate of zero, in the inlined form', () => {
        // Reproducing what apply-loan used to do, so the defect is stated as a
        // fact rather than as a claim about deleted code.
        const amount = 1_000_000, n = 12, rate = 0;
        const r = rate / 100;
        const inlined = (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

        expect(Number.isNaN(inlined)).toBe(true);
        expect(Math.round(inlined)).toBeNaN();
    });

    it('produces a real instalment through the shared module instead', () => {
        // An interest-free loan repays the principal in equal parts.
        const terms = calculateRepaymentTerms(1_000_000, 12, 0);

        expect(terms.monthlyPayment).toBeCloseTo(1_000_000 / 12, 2);
        expect(terms.totalInterest).toBe(0);
    });

    it('goes infinite at a zero term, in the inlined form', () => {
        const amount = 1_000_000, n = 0, r = 0.1;
        const inlined = (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

        expect(Number.isFinite(inlined)).toBe(false);
    });

    it('shows how far the member-facing estimate was out', () => {
        // The client divided the MONTHLY rate by 12 as though it were annual.
        const principal = 1_000_000, months = 12, rate = 10;

        const asAnnual = (() => {
            const r = rate / 100 / 12;
            return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
        })();
        const correct = calculateRepaymentTerms(principal, months, rate).monthlyPayment;

        // Not a neat 12×, because the term structure is not linear in the rate —
        // but a borrower was reading a number well under half the real one.
        expect(asAnnual).toBeLessThan(correct * 0.7);
        expect(correct - asAnnual).toBeGreaterThan(50_000);
    });
});

describe('a product that cannot describe a loan is not stored', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-1', ['admin']);
        setStored(null);
    });

    async function create(overrides: Record<string, any> = {}) {
        const { createAdminLoanProductAction } = await import('@/app/actions/loan-products');
        return createAdminLoanProductAction({ ...VALID, ...overrides } as any) as any;
    }

    function written(): Record<string, any> | undefined {
        return (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'interestRate' in d);
    }

    it('refuses a minimum at or above the maximum', async () => {
        // The API route checks this and the action did not.
        for (const bad of [{ minAmount: 500_000 }, { minAmount: 600_000 }]) {
            jest.clearAllMocks();
            const r = await create(bad);
            expect(r.success).toBe(false);
            expect(written()).toBeUndefined();
        }
    });

    it('refuses a zero or negative term', async () => {
        // Denominator (1+r)^0 - 1 = 0.
        for (const bad of [0, -6, 1.5]) {
            jest.clearAllMocks();
            const r = await create({ durationMonths: bad });
            expect(r.success).toBe(false);
        }
    });

    it('refuses a negative interest rate', async () => {
        const r = await create({ interestRate: -5 });

        expect(r.success).toBe(false);
    });

    it('ALLOWS a zero interest rate', async () => {
        // Deliberate. An interest-free product is a real thing, the API route
        // rejects it only by accident (`!interestRate` is true for 0), and the
        // division by zero it used to cause is fixed in apply-loan rather than
        // banned here.
        const r = await create({ interestRate: 0 });

        expect(r.success).toBe(true);
        expect(written()?.interestRate).toBe(0);
    });

    it('refuses amounts that are not numbers', async () => {
        const r = await create({ minAmount: '10000' });

        expect(r.success).toBe(false);
    });

    it('refuses missing required fields', async () => {
        for (const field of ['name', 'description', 'maxAmount', 'durationMonths']) {
            jest.clearAllMocks();
            const r = await create({ [field]: undefined });
            expect(r.success).toBe(false);
        }
    });

    it('stores only known fields', async () => {
        // `add(data)` wrote whatever arrived, including keys nothing expects.
        await create({ isAdminOverride: true, id: 'forced-id' } as any);

        expect(written()).toBeDefined();
        expect(written()).not.toHaveProperty('isAdminOverride');
        expect(written()).not.toHaveProperty('id');
    });

    it('stamps provenance like the API route does', async () => {
        await create();

        expect(written()?.createdBy).toBe('admin-1');
        expect(written()).toHaveProperty('createdAt');
    });

    it('still creates a valid product', async () => {
        // Vacuity guard.
        const r = await create();

        expect(r.success).toBe(true);
        expect(written()?.name).toBe('Starter');
    });

    it('refuses a non-admin', async () => {
        setSession('user-1', ['seller']);

        const r = await create();

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });
});

describe('an update is validated against the merged product', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-1', ['admin']);
        setStored(VALID);
    });

    async function update(patch: Record<string, any>) {
        const { updateAdminLoanProductAction } = await import('@/app/actions/loan-products');
        return updateAdminLoanProductAction('p1', patch as any) as any;
    }

    it('refuses a minimum raised above the STORED maximum', async () => {
        // THE test for this half. The patch alone looks fine — a positive
        // number — and is only wrong beside the value already on the record.
        const r = await update({ minAmount: 900_000 });

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses a maximum lowered below the stored minimum', async () => {
        const r = await update({ maxAmount: 5_000 });

        expect(r.success).toBe(false);
    });

    it('accepts a change that stays coherent', async () => {
        // Vacuity guard.
        const r = await update({ maxAmount: 900_000 });

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
    });

    it('refuses a patch of only unknown fields', async () => {
        const r = await update({ somethingElse: true });

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses to update a product that does not exist', async () => {
        setStored(null);

        const r = await update({ maxAmount: 900_000 });

        expect(r.success).toBe(false);
    });

    it('refuses a non-admin', async () => {
        setSession('user-1', ['seller']);

        expect((await update({ maxAmount: 900_000 })).success).toBe(false);
    });
});

describe('all three sites share one implementation', () => {
    async function source(rel: string): Promise<string> {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        return readFileSync(join(process.cwd(), rel), 'utf-8');
    }

    /** Comment lines removed, so prose describing the bug cannot satisfy a check for it. */
    function codeOnly(src: string): string {
        return src.split('\n').filter((line) => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        }).join('\n');
    }

    it('the loan application uses the shared module', async () => {
        const src = codeOnly(await source('src/app/api/cooperative/apply-loan/route.ts'));

        expect(src).toContain('calculateRepaymentTerms(');
        expect(src).not.toMatch(/Math\.pow\(1 \+ monthlyRate/);
    });

    it('the member calculator uses it too, and no longer divides by 12', async () => {
        const src = codeOnly(await source('src/app/cooperatives/(member)/loans/page.tsx'));

        expect(src).toContain('calculateRepaymentTerms(');
        expect(src).not.toContain('/ 100 / 12');
    });

    it('the loan application refuses a product with unusable terms', async () => {
        // Products predating the validation may already be stored. Quoting a
        // payment from terms that cannot produce one is worse than declining.
        const src = await source('src/app/api/cooperative/apply-loan/route.ts');
        const guard = src.slice(src.indexOf('Number.isFinite(product.interestRate)'));

        // Wide enough to clear the logger.error call that sits between the
        // condition and the response.
        expect(guard.slice(0, 1500)).toMatch(/not currently available/i);
        expect(guard.slice(0, 1500)).toContain('409');
        expect(src.indexOf('Number.isFinite(product.interestRate)'))
            .toBeLessThan(src.indexOf('calculateRepaymentTerms('));
    });
});
