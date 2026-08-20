/**
 * @jest-environment node
 */

/**
 * One collection, two loan products, and no row said which.
 *
 * LOAN_APPLICATIONS holds both of this platform's loans, written by three
 * different places:
 *
 *   api/cooperative/apply-loan            cooperative — productId, a MANDATORY
 *                                         guarantor, a membership check and a
 *                                         savings-multiple cap
 *   cooperative/_loans_applications.ts    cooperative — the member loan form
 *   actions/loan-actions.ts               business — collateral and
 *                                         businessDetails, validated against
 *                                         lib/validations/loan.ts, which has no
 *                                         guarantor field at all
 *
 * Every admin queue then filtered on `status` and nothing else. So
 * /loans/approve listed cooperative applications, and the cooperative admin
 * queue listed business ones, and nothing on the row told the admin which set
 * of rules the thing in front of them was written against.
 *
 * The concrete BYPASS was closed earlier: guarantorBlocksApproval now runs on
 * all three approval doors, so an unverified guarantor cannot be approved on
 * the door that used to skip the check. What this fixes is the other half —
 * two products with entirely different underwriting sharing one queue.
 *
 * WHY INFERENCE AND NOT A MIGRATION
 * ---------------------------------
 * Every row in production predates the discriminator. loanProductOf reads the
 * stamped field when present and otherwise falls back to the fields that have
 * ALWAYS separated the two — a cooperative application records a productId and
 * a guarantor; a business one records collateral and businessDetails. Existing
 * rows therefore classify correctly on the next read with no data change.
 *
 * That is also why the queues filter IN MEMORY. A
 * `where("loanProduct", "==", ...)` would silently drop every row written
 * before this existed, which today is all of them — the failure mode would be
 * an empty approval queue, not a visibly wrong one.
 *
 * WHY AN UNKNOWN ROW READS AS "business"
 * --------------------------------------
 * It is the weaker claim: the business product asserts no membership, no
 * guarantor and no savings cap. Defaulting an unrecognised row to
 * "cooperative" would assert all three about a row that may have none of them.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    loanProductOf,
    isCooperativeLoan,
    isBusinessLoan,
    filterByLoanProduct,
} from '@/lib/loan-product';

const ROOT = process.cwd();

const BUSINESS_WRITER = 'src/app/actions/loan-actions.ts';
const COOP_ROUTE_WRITER = 'src/app/api/cooperative/apply-loan/route.ts';
const COOP_ACTION_WRITER = 'src/app/actions/cooperative/_loans_applications.ts';
const BUSINESS_QUEUE = 'src/app/actions/loan-actions.ts';
const COOP_QUEUE = 'src/app/actions/admin/_loans.ts';
const COOP_API_QUEUE = 'src/app/api/admin/cooperative/loan-applications/route.ts';
const BUSINESS_SCHEMA = 'src/lib/validations/loan.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('a stamped row says what it is', () => {
    it('cooperative', () => {
        expect(loanProductOf({ loanProduct: 'cooperative' })).toBe('cooperative');
        expect(isCooperativeLoan({ loanProduct: 'cooperative' })).toBe(true);
    });

    it('business', () => {
        expect(loanProductOf({ loanProduct: 'business' })).toBe('business');
        expect(isBusinessLoan({ loanProduct: 'business' })).toBe(true);
    });

    it('and the stamp beats the inferred shape', () => {
        // A row carrying both a guarantor and an explicit stamp trusts the
        // stamp — otherwise the field would be decorative.
        expect(loanProductOf({ loanProduct: 'business', guarantorName: 'A Guarantor' })).toBe('business');
        expect(loanProductOf({ loanProduct: 'cooperative', collateral: 'A shop' })).toBe('cooperative');
    });

    it('an unrecognised stamp falling through to inference rather than being trusted', () => {
        expect(loanProductOf({ loanProduct: 'something-else', guarantorName: 'A Guarantor' })).toBe('cooperative');
    });
});

describe('an unstamped row — every row in production — is inferred', () => {
    it('a guarantor means cooperative, THE signal', () => {
        // Mandatory on the cooperative door, absent from the business schema.
        expect(loanProductOf({ guarantorName: 'A Guarantor' })).toBe('cooperative');
    });

    it('so does a productId', () => {
        expect(loanProductOf({ productId: 'prod_123' })).toBe('cooperative');
    });

    it('collateral or business details mean business', () => {
        expect(loanProductOf({ collateral: 'A shop' })).toBe('business');
        expect(loanProductOf({ businessDetails: 'Retail, 3 years' })).toBe('business');
    });

    it('and empty strings do not count as present', () => {
        // A row with `guarantorName: ""` is not a cooperative application; the
        // field exists on the shape and was never filled.
        expect(loanProductOf({ guarantorName: '', collateral: 'A shop' })).toBe('business');
        expect(loanProductOf({ productId: '   ', collateral: 'A shop' })).toBe('business');
    });

    it('an unrecognisable row reading as business, the weaker claim', () => {
        expect(loanProductOf({})).toBe('business');
        expect(loanProductOf({ amount: 50000, status: 'pending' })).toBe('business');
        expect(loanProductOf(null)).toBe('business');
        expect(loanProductOf(undefined)).toBe('business');
    });

    it('the business schema really having no guarantor, which is what makes it reliable', () => {
        // Vacuity guard on the inference rule.
        const schema = code(BUSINESS_SCHEMA);
        expect(schema).toContain('collateral');
        expect(schema).toContain('businessDetails');
        expect(schema).not.toContain('guarantorName');
    });
});

describe('filtering a queue', () => {
    const docs = [
        { id: 'a', data: () => ({ loanProduct: 'cooperative', amount: 1 }) },
        { id: 'b', data: () => ({ loanProduct: 'business', amount: 2 }) },
        { id: 'c', data: () => ({ guarantorName: 'Legacy Guarantor', amount: 3 }) },
        { id: 'd', data: () => ({ collateral: 'Legacy shop', amount: 4 }) },
    ];

    it('keeps only the cooperative ones, stamped or inferred', () => {
        expect(filterByLoanProduct(docs, 'cooperative').map((d) => d.id)).toEqual(['a', 'c']);
    });

    it('and only the business ones', () => {
        expect(filterByLoanProduct(docs, 'business').map((d) => d.id)).toEqual(['b', 'd']);
    });

    it('the two halves partitioning the set with nothing lost or duplicated', () => {
        // THE property that matters for an approval queue: an application that
        // appears on neither screen is worse than one on both.
        const coop = filterByLoanProduct(docs, 'cooperative').map((d) => d.id);
        const biz = filterByLoanProduct(docs, 'business').map((d) => d.id);

        expect([...coop, ...biz].sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(coop.filter((id) => biz.includes(id))).toEqual([]);
    });

    it('and plain objects work too, not only snapshot docs', () => {
        expect(filterByLoanProduct(
            [{ loanProduct: 'cooperative' }, { loanProduct: 'business' }] as any,
            'cooperative',
        )).toHaveLength(1);
    });
});

describe('every writer stamps the product', () => {
    it('the business action', () => {
        expect(code(BUSINESS_WRITER)).toContain('loanProduct: "business" as const,');
    });

    it('the cooperative route', () => {
        expect(code(COOP_ROUTE_WRITER)).toContain('loanProduct: "cooperative" as const,');
    });

    it('and the cooperative action', () => {
        expect(code(COOP_ACTION_WRITER)).toContain('loanProduct: "cooperative" as const,');
    });

    it('the type carrying it as optional, because old rows have none', () => {
        expect(code('src/lib/types/cooperative-loans.ts'))
            .toContain('loanProduct?: "cooperative" | "business";');
    });

    it('and all three really do write the same collection, which is the premise', () => {
        // Vacuity guard: a discriminator only matters if one collection holds
        // both.
        for (const rel of [BUSINESS_WRITER, COOP_ROUTE_WRITER, COOP_ACTION_WRITER]) {
            expect(code(rel)).toContain('COLLECTIONS.LOAN_APPLICATIONS');
        }
    });
});

describe('every queue asks for one product', () => {
    it('/loans/approve takes the business ones', () => {
        const q = code(BUSINESS_QUEUE);
        const fn = q.slice(q.indexOf('export async function getPendingLoanApplications'));

        expect(fn).toContain("filterByLoanProduct(snapshot.docs, 'business')");
    });

    it('the cooperative admin action takes the cooperative ones', () => {
        expect(code(COOP_QUEUE)).toContain("filterByLoanProduct(snapshot.docs, 'cooperative')");
    });

    it('and so does the cooperative admin route', () => {
        expect(code(COOP_API_QUEUE)).toContain("filterByLoanProduct(snapshot.docs, 'cooperative')");
    });

    it('the cooperative action paginating over the FILTERED set', () => {
        // Sharp: slicing the unfiltered docs to `limit` and then filtering would
        // return a short page and a wrong hasMore, so a pending cooperative
        // application could sit past the end of a page that looked complete.
        const q = code(COOP_QUEUE);

        expect(q).toContain('const pageDocs = cooperativeDocs.slice(0, limit);');
        expect(q).toContain('const hasMore = cooperativeDocs.length > limit;');
        expect(q).not.toContain('const hasMore = snapshot.docs.length > limit;');
    });

    it('and none of them filtering with a where clause', () => {
        // A where would silently drop every row written before the
        // discriminator existed — which is all of them today.
        for (const rel of [BUSINESS_QUEUE, COOP_QUEUE, COOP_API_QUEUE]) {
            expect(code(rel)).not.toContain('where("loanProduct"');
            expect(code(rel)).not.toContain("where('loanProduct'");
        }
    });
});

describe('what this does NOT claim', () => {
    it('the guarantor control still runs on all three doors', () => {
        // The concrete bypass was closed separately and must stay closed: this
        // change is about which queue shows what, not about the control.
        for (const rel of [
            'src/app/actions/loan-actions.ts',
            'src/app/actions/cooperative/_loans_decisions.ts',
            'src/app/api/admin/cooperative/approve-loan/route.ts',
        ]) {
            expect(code(rel)).toContain('guarantorBlocksApproval(');
        }
    });

    it('and a member still sees all of their own applications', () => {
        // getUserLoanApplications is deliberately unfiltered: a borrower's own
        // list should hold everything they applied for, whichever product.
        const q = code(BUSINESS_QUEUE);
        const fn = q.slice(
            q.indexOf('export async function getUserLoanApplications'),
            q.indexOf('export async function getLoanApplication'),
        );

        expect(fn).toContain("where('userId', '==', session.user.id)");
        expect(fn).not.toContain('filterByLoanProduct');
    });
});
