/**
 * @jest-environment node
 */

/**
 *   #302 THREE MORE DELETES, ON THE ROWS THAT DEFINE WHAT SOMEBODY BOUGHT.
 *
 *        #300 was the erasure path, #301 the catalogues. These are the
 *        definitions: a course, a loan product, a training event. Each is read
 *        BY ID from records that outlive it.
 *
 *          ACADEMY_COURSES        enrolments, progress rows and issued
 *                                 certificates all key on courseId.
 *                                 _ac_progress.ts reads the course for each of a
 *                                 learner's enrolments and the certificate
 *                                 routes read it to render the certificate — so
 *                                 deleting a course took away the record of what
 *                                 a learner had FINISHED.
 *
 *          LOAN_PRODUCTS          holds the interest rate and duration a loan was
 *                                 granted on. The sibling API route's own
 *                                 comment admitted the loss — "Irreversible, and
 *                                 the deleted product's terms are gone with it —
 *                                 so the record keeps them" — and copied the
 *                                 product into an audit entry to soften it.
 *                                 TWO doors, both destroying.
 *
 *          WAVE_TRAINING_EVENTS   and, with it, every registration. Those rows
 *                                 carry `attended`, and _member.ts counts
 *                                 trainingsCompleted from them.
 *
 *        THE THIRD ONE WAS MY OWN EARLIER FIX. The registration delete was
 *        added to stop a withdrawn event inflating trainingsRegistered, argued
 *        as "Deleted rather than marked, matching how the event itself is
 *        removed". The reasoning held only while the event was destroyed —
 *        which is exactly the assumption this change removes. Erasing
 *        attendance history to correct a tally is not a fix; the tally is
 *        corrected at the reader now.
 *
 *        AND THE FLAG WAS ALREADY THERE, TWICE OVER. `isActive` exists on every
 *        loan product, written by both creators and read by NOTHING.
 *        "cancelled" is already in the training-event status union and the
 *        member list already excludes it. So in both cases the retirement
 *        mechanism was sitting unused while the code deleted.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
    updateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const ADMIN = 'admin-1';
const PRODUCT = 'lp-1';

// ─────────────────────────────────────────────────────────────────────────────
describe('#302 — the loan product, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: ADMIN, email: 'a@e.com', roles: ['super_admin'] } },
        });
        store.seed(COLLECTIONS.LOAN_PRODUCTS, PRODUCT, {
            name: 'Working Capital',
            interestRate: 2.5,
            durationMonths: 6,
            minAmount: 50_000,
            maxAmount: 500_000,
            isActive: true,
        });
    });

    const remove = async () =>
        (await (await import('@/app/actions/loan-products')).deleteAdminLoanProductAction(PRODUCT)) as any;

    it('THE TERMS SURVIVE — every loan written against this product needs them', async () => {
        expect(await remove()).toMatchObject({ success: true });

        const row = store.get(COLLECTIONS.LOAN_PRODUCTS, PRODUCT);
        expect(row).toBeDefined();
        expect(row?.interestRate).toBe(2.5);
        expect(row?.durationMonths).toBe(6);
    });

    it('and it is marked inactive, using the flag that already existed', async () => {
        await remove();

        expect(store.get(COLLECTIONS.LOAN_PRODUCTS, PRODUCT)?.isActive).toBe(false);
        expect(store.get(COLLECTIONS.LOAN_PRODUCTS, PRODUCT)?.retired).toBe(true);
    });

    it('IT LEAVES THE ADMIN LIST, so "delete" still looks like delete', async () => {
        const { getAdminLoanProductsAction } = await import('@/app/actions/loan-products');

        const before: any = await getAdminLoanProductsAction({});
        expect(before.data).toHaveLength(1);

        await remove();

        const after: any = await getAdminLoanProductsAction({});
        expect(after.data).toEqual([]);
    });

    it('a role without cooperatives:approve_loans cannot retire it', async () => {
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'x', email: 'x@e.com', roles: ['academy_admin'] } },
        });

        expect(await remove()).toMatchObject({ success: false });
        expect(store.get(COLLECTIONS.LOAN_PRODUCTS, PRODUCT)?.isActive).toBe(true);
        expect(store.get(COLLECTIONS.LOAN_PRODUCTS, PRODUCT)?.retired).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#302 — no door destroys a definition', () => {
    const DOORS: Array<[string, string]> = [
        ['the academy course door', 'src/app/actions/academy/_ac_catalog.ts'],
        ['the loan product action', 'src/app/actions/loan-products.ts'],
        ['the loan product API route', 'src/app/api/admin/cooperative/delete-loan-product/route.ts'],
        ['the WAVE training event door', 'src/app/actions/wave/_wv_admin_resources.ts'],
    ];

    it.each(DOORS)('%s calls no .delete()', (_name, path) => {
        expect(code(path)).not.toMatch(/\.delete\(\)/);
    });

    it('AND THE WAVE DOOR DELETES NO REGISTRATION EITHER', () => {
        // The one that was my own earlier fix. Stated separately because
        // batch.delete on the registrations is a different call shape from
        // .delete() on the event, and only the second is covered above.
        const src = code('src/app/actions/wave/_wv_admin_resources.ts');

        expect(src).not.toContain('regBatch.delete(');
        expect(src).not.toContain('deleteBatch.delete(');
        expect(src).not.toMatch(/batch\.delete\(/);
    });

    it('the WAVE door uses the status its own type union already declared', () => {
        const src = code('src/app/actions/wave/_wv_admin_resources.ts');
        const types = code('src/lib/types/wave-actions.ts');

        expect(src).toMatch(/status: "cancelled"/);
        expect(types).toMatch(/"upcoming" \| "ongoing" \| "completed" \| "cancelled"/);
    });

    it('the loan product doors use isActive, which both creators already write', () => {
        for (const path of [
            'src/app/actions/loan-products.ts',
            'src/app/api/admin/cooperative/delete-loan-product/route.ts',
        ]) {
            expect({ path, marks: code(path).includes('isActive: false') })
                .toEqual({ path, marks: true });
        }
    });

    it('and every door records the shared bookkeeping', () => {
        for (const [, path] of DOORS) {
            expect({ path, uses: code(path).includes('retirementPatch(') })
                .toEqual({ path, uses: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#302 — a retired definition is refused, not merely hidden', () => {
    /**
     * Hiding a loan product from the list is not enough. Both apply paths read
     * LOAN_PRODUCTS.doc(productId) from a caller-supplied id, and the check
     * that used to stop a withdrawn product was the row's ABSENCE. Keeping the
     * row removes that check, so the refusal has to be explicit — otherwise
     * retiring a product would quietly make it applicable again.
     */
    it.each([
        ['the cooperative action', 'src/app/actions/cooperative/_coop_money.ts'],
        ['the apply-loan API route', 'src/app/api/cooperative/apply-loan/route.ts'],
    ])('%s refuses a retired product', (_name, path) => {
        const src = code(path);

        expect(src).toMatch(/isRetired\(\w+\)\s*\|\|\s*\w+\.isActive === false/);
        expect(src).toMatch(/no longer available/);
    });

    it('and the academy auto-enrolment will not enrol into a retired course', () => {
        expect(code('src/app/actions/academy/_ac_enrollment.ts'))
            .toMatch(/if \(isRetired\(courseData\)\) return false;/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#302 — the lists and counts that had no status filter', () => {
    it('the course catalogue filters retired courses', () => {
        expect(code('src/app/actions/academy/_ac_catalog.ts'))
            .toMatch(/pageDocs\.filter\(\(d: any\) => !isRetired\(d\.data\(\)\)\)/);
    });

    it('BOTH loan product lists filter, not just one', () => {
        // Fixing one of a pair is the mistake this audit keeps finding — #297
        // was exactly that, on the upload retry loop.
        for (const path of [
            'src/app/actions/loan-products.ts',
            'src/app/api/admin/cooperative/loan-products/route.ts',
        ]) {
            expect({ path, filters: code(path).includes('isRetired(') })
                .toEqual({ path, filters: true });
        }
    });

    it('THE MEMBER COUNT EXCLUDES A CANCELLED EVENT, which is what the delete was for', () => {
        // The whole justification for deleting the registrations was that they
        // inflated trainingsRegistered. If this filter is absent, the deletion
        // was removed and nothing replaced it.
        const src = code('src/app/actions/wave/_member.ts');

        expect(src).toMatch(/eventCancelled !== true/);
        expect(src).toMatch(/trainingsRegistered: liveRegistrations\.length/);
    });

    it('but ATTENDANCE still counts — a training somebody attended happened', () => {
        // The row is kept precisely so this stays true. Counting attendance off
        // the unfiltered list is deliberate, not an oversight.
        const src = code('src/app/actions/wave/_member.ts');

        expect(src).toMatch(/trainingsCompleted = trainingSnap\.docs\.filter/);
    });
});
