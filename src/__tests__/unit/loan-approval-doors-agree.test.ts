/**
 * @jest-environment node
 */

/**
 * The same loan, refused on two screens and approved on the third.
 *
 * LOAN_APPLICATIONS holds two different products, and three admin doors open
 * onto it:
 *
 *   cooperative/_loans_decisions.ts::approveLoanAction
 *   api/admin/cooperative/approve-loan
 *   actions/loan-actions.ts::approveLoanApplication      — behind /loans/approve
 *
 * The cooperative pass added `guarantorBlocksApproval`: a loan application that
 * records a guarantor cannot be approved until an admin has verified them
 * through /api/admin/cooperative/verify-guarantor. The first two doors call it.
 * The third did not.
 *
 * That mattered because the third door's queue is not filtered by product.
 * getPendingLoanApplications selects `status == PENDING` and nothing else, so
 * it returns EVERY pending row in the collection — cooperative applications
 * included. And /loans/approve is the screen an admin reaches from the "Loan
 * Application" notification admin/_loans.ts sends.
 *
 * So an unverified guarantor stopped an approval on two screens and stopped
 * nothing on the third. The control existed, was applied twice out of three
 * times, and the gap was invisible because all three write the same field of
 * the same collection.
 *
 * WHY ADDING IT IS SAFE FOR THE OTHER PRODUCT
 * ------------------------------------------
 * This file was written for a business loan: /loans/apply validates against
 * lib/validations/loan.ts, whose schema is amount, purpose, repaymentPeriod,
 * collateral and businessDetails — no guarantor fields exist on it.
 * guarantorBlocksApproval returns false when no guarantor is recorded, so a
 * business loan is unaffected. Only the case the control was written for
 * changes.
 *
 * RECORDED, NOT FIXED: the two products share one collection with no field
 * saying which is which, and both admin queues therefore show both. The rules
 * genuinely differ — a cooperative loan needs membership, a savings-multiple
 * cap and a guarantor; a business loan needs collateral and business details
 * and none of the three. Which screen should own which application is a product
 * decision, not an audit's. What is fixed here is the control that both
 * products' applications should pass through the same way.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    guarantorBlocksApproval,
    recordsAGuarantor,
    GUARANTOR_UNVERIFIED_MESSAGE,
} from '@/lib/loan-approval-policy';

const GENERAL = 'src/app/actions/loan-actions.ts';
const COOP_DECISIONS = 'src/app/actions/cooperative/_loans_decisions.ts';
const COOP_ROUTE = 'src/app/api/admin/cooperative/approve-loan/route.ts';
const COOP_APPLY = 'src/app/api/cooperative/apply-loan/route.ts';
const BUSINESS_SCHEMA = 'src/lib/validations/loan.ts';
const ADMIN_LOANS = 'src/app/actions/admin/_loans.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('every door onto LOAN_APPLICATIONS applies the guarantor control', () => {
    const DOORS: [string, string][] = [
        ['the general/business door behind /loans/approve', GENERAL],
        ['the cooperative action', COOP_DECISIONS],
        ['the cooperative admin route', COOP_ROUTE],
    ];

    it.each(DOORS)('%s calls guarantorBlocksApproval', (_label, rel) => {
        // THE test. The first entry is the one that did not.
        expect(code(rel)).toContain('guarantorBlocksApproval(');
    });

    it('and each refuses with the shared message rather than its own wording', () => {
        for (const [, rel] of DOORS) {
            expect(code(rel)).toContain('GUARANTOR_UNVERIFIED_MESSAGE');
        }
    });

    it('with the general door checking BEFORE it claims the transition', () => {
        // A claim that has already moved the status cannot be undone by a later
        // refusal.
        const general = code(GENERAL);
        const guardAt = general.indexOf('if (guarantorBlocksApproval(loanData)) {');
        const dualAt = general.indexOf('const requiresDualControl = needsDualControl(loanData.amount);');

        expect(guardAt).toBeGreaterThan(-1);
        expect(dualAt).toBeGreaterThan(guardAt);
    });
});

describe('the control itself, exercised rather than read', () => {
    it('blocks an application whose guarantor is unverified', () => {
        expect(guarantorBlocksApproval({ guarantorName: 'A Guarantor' })).toBe(true);
        expect(guarantorBlocksApproval({ guarantorName: 'A Guarantor', guarantorVerified: false })).toBe(true);
    });

    it('permits one whose guarantor is verified', () => {
        expect(guarantorBlocksApproval({ guarantorName: 'A Guarantor', guarantorVerified: true })).toBe(false);
    });

    it('and does not block an application that records no guarantor at all', () => {
        // THE reason adding this to the business-loan door is safe.
        expect(recordsAGuarantor({})).toBe(false);
        expect(guarantorBlocksApproval({})).toBe(false);
        expect(guarantorBlocksApproval({ guarantorName: '' })).toBe(false);
        expect(guarantorBlocksApproval({ guarantorName: '   ' })).toBe(false);
    });

    it('the message being a single shared string', () => {
        expect(GUARANTOR_UNVERIFIED_MESSAGE).toContain('Guarantor verification required');
    });
});

describe('why the gap was reachable', () => {
    it('the general queue filters on status alone, so it holds both products', () => {
        // THE premise. Without this the third door would only ever see business
        // loans and the missing check would not matter.
        const general = code(GENERAL);
        const queue = general.slice(general.indexOf('export async function getPendingLoanApplications'));

        expect(queue).toContain("COLLECTIONS.LOAN_APPLICATIONS");
        expect(queue).toContain("where('status', '==', LoanStatus.PENDING)");
        // No product/type narrowing of any kind.
        expect(queue.slice(0, queue.indexOf('.get()'))).not.toMatch(/where\((?!'status')/);
    });

    it('and the cooperative apply route writes into that same collection', () => {
        const apply = code(COOP_APPLY);

        expect(apply).toContain('COLLECTIONS.LOAN_APPLICATIONS');
        expect(apply).toContain('guarantorName');
    });

    it('recording a guarantor, which is mandatory on that door', () => {
        // So cooperative rows are exactly the ones the control exists for.
        expect(code(COOP_APPLY)).toMatch(/!guarantorName|!body\.guarantorName|!productId \|\| !rawAmount \|\| !purpose \|\| !guarantorName/);
    });

    it('while the business schema has no guarantor field to record', () => {
        // Vacuity guard on "safe for the other product".
        const schema = code(BUSINESS_SCHEMA);

        expect(schema).toContain('collateral');
        expect(schema).toContain('businessDetails');
        expect(schema).not.toContain('guarantorName');
        expect(schema).not.toContain('guarantorVerified');
    });

    it('and an admin is sent to that screen by a notification', () => {
        // Not a forgotten page: admin/_loans.ts links there.
        expect(code(ADMIN_LOANS)).toContain('link: "/loans"');
    });
});

describe('the general door asks the permission matrix', () => {
    const general = code(GENERAL);

    it('rather than a hand-written list of role names', () => {
        // It named ['admin', 'super_admin'] at five sites, which omits
        // `cooperative_admin` — the role whose entire job this is, and which
        // the other two doors honour through the matrix.
        expect(general).not.toContain("roles?.includes('admin')");
        expect(general).not.toContain("roles?.includes('super_admin')");

        const gates = general.match(/hasAdminPermission\(session\.user\.roles, "cooperatives:approve_loans"\)/g) ?? [];
        expect(gates.length).toBe(5);
    });

    it('naming the same permission the other two doors use', () => {
        expect(code(COOP_DECISIONS)).toContain('"cooperatives:approve_loans"');
        expect(code(COOP_ROUTE)).toContain('"cooperatives:approve_loans"');
    });
});

describe('the wallet lifetime totals count every transaction', () => {
    const WALLET = 'src/app/actions/wallet.ts';

    it('sweeping unbounded rather than stopping at the default cap', () => {
        // Same class as the finance-service and integrity-checker totals.
        // "Aggregate stats over all transactions" is what these three figures
        // claim to be, and a bare .get() stops at DEFAULT_QUERY_LIMIT (5,000)
        // while looking complete — so a long-standing account would see a Total
        // Funded and Total Spent that had quietly stopped counting, and a
        // Pending Withdrawals that could omit a real pending payout.
        const wallet = code(WALLET);
        const stats = wallet.slice(
            wallet.indexOf('async function _getWalletAction'),
            wallet.indexOf('let totalFunded = 0;'),
        );

        expect(stats).toContain('.all()');
        expect(stats).toContain('.get();');
        expect(wallet).toContain('if (txnsSnap.truncated) {');
    });

    it('and those totals really are computed from that sweep', () => {
        // Vacuity guard: the cap only mattered because the figures are derived
        // from the snapshot rather than from a stored counter.
        const wallet = code(WALLET);

        expect(wallet).toContain('txnsSnap.docs.forEach((doc) => {');
        expect(wallet).toContain('totalFunded += amount;');
        expect(wallet).toContain('pendingWithdrawals += Math.abs(amount);');
        expect(wallet).toContain('stats: { totalFunded, totalSpent, pendingWithdrawals }');
    });
});
