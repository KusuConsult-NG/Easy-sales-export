/**
 * @jest-environment node
 */

/**
 * An admin could see a member's loan application and could not act on it.
 *
 * WHERE THIS PICKS UP
 * -------------------
 * An earlier pass found that loan applications are written to TWO collections —
 * loan_applications by the wizard, the API route and loan-actions.ts;
 * cooperative_loans by _applyForLoanAction, which is the ONLY path the member
 * loan page submits through — and that the admin queue read the first alone. It
 * fixed the queue (merge both) and the approve route (resolve the id across
 * both), and left everything else pointing at one collection.
 *
 * So the fix made things visible without making them actionable. On a row filed
 * by a member, /admin/cooperatives/loans now offered:
 *
 *   Reject             → 404 "Application not found"
 *   Verify Guarantor   → 404 "Application not found"
 *   Approve (modal)    → permanently disabled, "Verify Guarantor First"
 *   Approve (table ✓)  → worked
 *   Record Repayment   → "Loan not found"
 *
 * Five buttons on one row, disagreeing about whether the row exists.
 *
 * THE GUARANTOR RULE WAS WRONG IN BOTH DOORS, IN OPPOSITE DIRECTIONS
 * ------------------------------------------------------------------
 *   route:  `if (appData.tier && !appData.guarantorVerified)`
 *   action: `if (!appData.guarantorVerified) throw`
 *
 * Only the wizard writes `tier`. /api/cooperative/apply-loan records a
 * guarantor and `guarantorVerified: false` and no tier — so the route SKIPPED
 * the check for exactly the applications carrying an unverified guarantor. The
 * action demanded the flag from applications that record no guarantor at all
 * and so can never have it. One rule, in lib/loan-approval-policy.ts, about the
 * guarantor rather than about a tier.
 *
 * AND REJECTION WROTE BLIND
 * -------------------------
 * Both rejection doors did `update({ status: "rejected" })` with no status check
 * whatsoever, while approval and disbursement on either side of them claim the
 * transition. A disbursed loan could be marked rejected after the money had
 * gone; a rejected one could be rejected again, the new reason replacing any
 * record of the first.
 *
 * THE COUNTS CONTRADICTED THE LIST
 * --------------------------------
 * The four cards above the queue, the CSV export, and the pending-applications
 * reader all counted loan_applications alone, over a list that merges both. An
 * admin saw "Pending: 0" above a screen of pending applications.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    recordsAGuarantor,
    guarantorBlocksApproval,
    GUARANTOR_UNVERIFIED_MESSAGE,
    LOAN_REJECTABLE_STATUSES,
} from '@/lib/loan-approval-policy';

const DECISIONS = 'src/app/actions/cooperative/_loans_decisions.ts';
const APPLICATIONS = 'src/app/actions/cooperative/_loans_applications.ts';
const REPAYMENTS = 'src/app/actions/cooperative/_loans_repayments.ts';
const COOP_MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const APPROVE_ROUTE = 'src/app/api/admin/cooperative/approve-loan/route.ts';
const REJECT_ROUTE = 'src/app/api/admin/cooperative/reject-loan/route.ts';
const GUARANTOR_ROUTE = 'src/app/api/admin/cooperative/verify-guarantor/route.ts';
const APPLY_ROUTE = 'src/app/api/cooperative/apply-loan/route.ts';
const ADMIN_PAGE = 'src/app/admin/cooperatives/loans/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** One function's body, so a correct sibling in the same file cannot mask it. */
function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

describe('the two document shapes, which is the whole premise', () => {
    it('the member loan page files into cooperative_loans, and NOW records a guarantor', () => {
        /**
         *   #377 THIS USED TO ASSERT `not.toContain('guarantorName')`.
         *
         *        That was a faithful description of the code and, read back, a
         *        statement of the defect: the ONLY member entrance in the
         *        product recorded no guarantor, so this file's own rule —
         *        "an application that recorded a guarantor must have that
         *        guarantor verified before approval" — was satisfied vacuously
         *        by every application anyone could actually file. The control
         *        was live on the wizard's rows, which no screen can create.
         *
         *        The guarantor is collected now, unverified on arrival, exactly
         *        as the other three writers do it. What has NOT changed is the
         *        premise this describe block exists for: this row still carries
         *        no `tier`, which is why keying the gate on `tier` was a hole.
         */
        const apply = fn(COOP_MONEY, '_applyForLoanAction');

        expect(apply).toContain('table: "cooperative_loans"');
        expect(apply).toContain('memberId: userId');
        expect(apply).toMatch(/guarantorVerified:\s*false/);
        expect(apply).toMatch(/\bguarantorName\b/);
        expect(apply).not.toMatch(/\btier:/);
    });

    it('while /api/cooperative/apply-loan records a guarantor and NO tier', () => {
        // This is what made keying the gate on `tier` a hole rather than a
        // harmless simplification.
        const route = code(APPLY_ROUTE);

        expect(route).toContain('guarantorVerified: false');
        expect(route).toContain('guarantorName: guarantorName.trim()');
        expect(route).not.toMatch(/\n\s+tier:/);
    });

    it('and the wizard records both', () => {
        const wizard = fn(APPLICATIONS, 'submitLoanApplicationAction');

        expect(wizard).toContain('tier: formData.tier');
        expect(wizard).toContain('guarantorVerified: false');
    });
});

describe('the guarantor rule', () => {
    it('applies to an application that recorded a guarantor', () => {
        expect(guarantorBlocksApproval({ guarantorName: 'Ada Obi', guarantorVerified: false })).toBe(true);
        expect(guarantorBlocksApproval({ guarantorName: 'Ada Obi' })).toBe(true);
    });

    it('and lifts once that guarantor is verified', () => {
        expect(guarantorBlocksApproval({ guarantorName: 'Ada Obi', guarantorVerified: true })).toBe(false);
    });

    it('and does not apply where no guarantor was ever recorded', () => {
        // The cooperative_loans shape. Demanding a flag that path never writes
        // is how the action would have refused every member application.
        expect(guarantorBlocksApproval({})).toBe(false);
        expect(guarantorBlocksApproval({ guarantorName: '   ' })).toBe(false);
        expect(guarantorBlocksApproval(null)).toBe(false);
    });

    it('and does not read a JSONB string as verified', () => {
        // The adapter stores whatever it is handed; "false" is truthy.
        expect(guarantorBlocksApproval({ guarantorName: 'Ada', guarantorVerified: 'false' as any })).toBe(true);
        expect(guarantorBlocksApproval({ guarantorName: 'Ada', guarantorVerified: 'true' as any })).toBe(true);
    });

    it('is independent of tier, which is what the route got wrong', () => {
        // An apply-loan-route application: guarantor, unverified, no tier.
        expect(recordsAGuarantor({ guarantorName: 'Ada Obi' })).toBe(true);
        expect(guarantorBlocksApproval({ guarantorName: 'Ada Obi', guarantorVerified: false })).toBe(true);
    });
});

describe('both approval doors ask the shared rule', () => {
    it.each([APPROVE_ROUTE, DECISIONS])('%s', (rel: string) => {
        const src = code(rel);

        expect(src).toContain('guarantorBlocksApproval(');
        expect(src).toContain('GUARANTOR_UNVERIFIED_MESSAGE');
    });

    it('and neither still keys the gate on tier', () => {
        // THE test for the route's half.
        expect(code(APPROVE_ROUTE)).not.toContain('appData.tier &&');
    });

    it('nor demands the flag unconditionally', () => {
        // THE test for the action's half.
        expect(code(DECISIONS)).not.toContain('if (!appData.guarantorVerified)');
    });

    it('and the message is the one the platform already used', () => {
        expect(GUARANTOR_UNVERIFIED_MESSAGE).toContain('Guarantor verification required');
    });
});

describe('every door onto one application resolves it across both collections', () => {
    const DOORS: Array<[string, string]> = [
        ['approve route', APPROVE_ROUTE],
        ['reject route', REJECT_ROUTE],
        ['verify-guarantor route', GUARANTOR_ROUTE],
        ['approve/reject/disburse actions', DECISIONS],
        ['repayment actions', REPAYMENTS],
    ];

    it.each(DOORS)('%s', (_label: string, rel: string) => {
        // THE test. Every one of these answered 404 for a member's own
        // application before this.
        expect(code(rel)).toContain('resolveLoanApplication(');
    });

    it.each(DOORS)('%s no longer opens loan_applications by a caller id', (_label: string, rel: string) => {
        // Vacuity guard: importing the resolver and then ignoring it would pass
        // the assertion above. `.doc()` with no argument is a NEW document and
        // is fine; `.doc(something)` is the lookup that assumed one collection.
        const direct = code(rel).match(/LOAN_APPLICATIONS\)\.doc\([^)]+\)/g) ?? [];

        expect(direct).toEqual([]);
    });

    it('and the resolver really does check both, so this is not cosmetic', () => {
        const resolver = code('src/lib/loan-application-location.ts');

        expect(resolver).toContain('COLLECTIONS.LOAN_APPLICATIONS,');
        expect(resolver).toContain('COLLECTIONS.COOPERATIVE_LOANS,');
    });
});

describe('rejection claims its transition', () => {
    it.each([
        ['route', REJECT_ROUTE],
        ['action', DECISIONS],
    ])('%s', (_label: string, rel: string) => {
        // THE test. Both were `update({ status: "rejected" })` behind nothing.
        const src = code(rel);

        expect(src).toContain('claimStatusTransitionFromAny({');
        expect(src).toContain('fromAny: [...LOAN_REJECTABLE_STATUSES]');
        expect(src).toContain('to: "rejected"');
    });

    it.each([
        ['route', REJECT_ROUTE],
        ['action', DECISIONS],
    ])('%s no longer writes the status blind', (_label: string, rel: string) => {
        expect(code(rel)).not.toMatch(/update\(\{\s*status: "rejected"/);
    });

    it('and says so rather than reporting success', () => {
        expect(code(REJECT_ROUTE)).toContain('can no longer be rejected');
        expect(code(DECISIONS)).toContain('can no longer be rejected');
    });

    it('from the statuses that precede a decision, and not from "approved"', () => {
        // Rejecting an approved loan would need the loanBalance increment that
        // the approve route applies to be reversed. That is a reversal, not a
        // rejection — see the note in loan-approval-policy.ts.
        expect([...LOAN_REJECTABLE_STATUSES]).toEqual(['pending', 'reviewing', 'partially_approved']);
        expect([...LOAN_REJECTABLE_STATUSES]).not.toContain('approved');
        expect([...LOAN_REJECTABLE_STATUSES]).not.toContain('disbursed');
    });

    it('which is a real interlock: the approve route does move a balance', () => {
        // Vacuity guard for the paragraph above.
        expect(code(APPROVE_ROUTE)).toContain('loanBalance: FieldValue.increment(appData.amount)');
    });
});

describe('verifying a guarantor', () => {
    it('refuses an application that recorded none', () => {
        const src = code(GUARANTOR_ROUTE);

        expect(src).toContain('if (!recordsAGuarantor(appData))');
        expect(src).toContain('nothing to verify');
    });

    it('before it writes the attestation', () => {
        const src = code(GUARANTOR_ROUTE);
        const guard = src.indexOf('if (!recordsAGuarantor(appData))');
        const write = src.indexOf('guarantorVerified: true');

        expect(guard).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(guard);
    });
});

describe('the admin page agrees with the server', () => {
    it('gates Approve on the shared rule rather than on the raw flag', () => {
        // Scoped to the modal's action footer. The Guarantor Details block above
        // it reads guarantorVerified to render a Verified/Pending badge, which is
        // display and is correct — the defect was using it as the gate.
        const page = source(ADMIN_PAGE);
        const footer = page.slice(page.indexOf('{selectedApplication.status === "pending" && ('));

        expect(footer).toContain('{guarantorBlocksApproval(selectedApplication) && (');
        expect(footer).toContain('{!guarantorBlocksApproval(selectedApplication) ? (');
        expect(footer).not.toContain('{!selectedApplication.guarantorVerified && (');
        expect(footer).not.toContain('{selectedApplication.guarantorVerified ? (');
    });

    it('and it is the same module both server doors import', () => {
        // Vacuity guard: a page-local copy of the rule is the defect, not the fix.
        expect(source(ADMIN_PAGE)).toContain('from "@/lib/loan-approval-policy"');
    });
});

describe('the counts above the queue', () => {
    it('cover both collections the queue merges', () => {
        // THE test. "Pending: 0" over a list of pending applications.
        const stats = fn(APPLICATIONS, 'getAdminLoanStatsAction');

        expect(stats).toContain('LOAN_APPLICATION_COLLECTIONS.map(');
        expect(stats).not.toContain('const col = db.collection(COLLECTIONS.LOAN_APPLICATIONS);');
    });

    it('and so does the export', () => {
        // Pinned to the QUERY, not to a mention of the collection name: the
        // normaliseLoanApplication call below it names COOPERATIVE_LOANS too, so
        // a looser assertion passed against a merge that read the wrong table.
        const exportFn = fn(APPLICATIONS, 'getAdminLoanApplicationsExportAction');

        expect(exportFn).toContain('const coopSnap = await db.collection(COLLECTIONS.COOPERATIVE_LOANS)');
        expect(exportFn).toContain('normaliseLoanApplication(row, COLLECTIONS.COOPERATIVE_LOANS)');
    });

    it('and so does the pending-applications reader', () => {
        const pending = fn(APPLICATIONS, 'getPendingLoanApplicationsAction');

        expect(pending).toContain('LOAN_APPLICATION_COLLECTIONS.map(');
    });

    it('which the queue itself really does merge, so the premise holds', () => {
        const queue = fn(APPLICATIONS, 'getAdminLoanApplicationsAction');

        expect(queue).toContain('COLLECTIONS.COOPERATIVE_LOANS');
    });
});

describe('the merged rows obey the same filters as the queried ones', () => {
    const queue = fn(APPLICATIONS, 'getAdminLoanApplicationsAction');

    it('including the date range, which they escaped entirely', () => {
        // THE test. An admin narrowing to last week still saw every
        // cooperative_loans row ever filed.
        expect(queue).toContain('const fromTime = options.dateFrom ? dateRangeStart(options.dateFrom).getTime() : null;');
        expect(queue).toContain('const toTime = options.dateTo ? dateRangeEnd(options.dateTo).getTime() : null;');
        expect(queue).toContain('if (fromTime !== null && appTime < fromTime) return false;');
        expect(queue).toContain('if (toTime !== null && appTime > toTime) return false;');
    });

    it('and the disbursed/active equivalence the query applies', () => {
        expect(queue).toContain('? ["disbursed", "active"]');
        expect(queue).not.toContain('return row.status === options.statusFilter;');
    });

    it('and the Next Page cursor resolves across both, so it advances', () => {
        // The cursor is the last row of the page just shown, which after the
        // merge can be a cooperative_loans id. Looked up in loan_applications
        // alone it did not exist, startAfter was skipped, and Next Page served
        // page one again with the page number climbing over the top of it.
        expect(queue).toContain('const lastDoc = await resolveLoanApplication(options.lastDocId);');
        expect(queue).toContain('query = query.startAfter(lastDoc.snap);');
        expect(queue).not.toContain('db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(options.lastDocId)');
    });

    it('and the cursor really is set from the merged rows, so this is reachable', () => {
        // Vacuity guard: if nextCursor came only from the queried collection
        // there would be nothing to resolve.
        expect(queue).toContain('nextCursor = hasMore && applicationsRaw.length > 0');
    });

    it('which the query really does apply, so the two now agree', () => {
        // Vacuity guard: the mapping is the file's own rule, not one invented here.
        expect(queue).toContain('(options.statusFilter === "active" || options.statusFilter === "disbursed")');
    });
});

describe('a repayment is bound to the loan it claims to pay', () => {
    const submit = fn(REPAYMENTS, 'submitRepaymentAction');

    it('refusing an instalment that belongs to a different loan', () => {
        // THE test. loanId and installmentId were two independent
        // caller-supplied ids and nothing tied them together.
        expect(submit).toContain('if (installmentData.loanId !== data.loanId)');
        expect(submit).toContain('does not belong to this loan');
    });

    it('or to a different borrower', () => {
        expect(submit).toContain('installmentData.userId !== data.userId');
        expect(submit).toContain('does not belong to this borrower');
    });

    it('before it credits anything', () => {
        // #212 made the credit per LINE — one transfer may now be allocated
        // across instalments — so the amount credited is `line.amount` rather
        // than the whole transfer. The guarantee is unchanged and, because both
        // bindings and the credit sit in the same per-line loop, it now runs
        // for every line rather than once; that is pinned behaviourally in
        // one-transfer-across-two-instalments.test.ts.
        const guard = submit.indexOf('if (installmentData.loanId !== data.loanId)');
        const credit = submit.indexOf('paidAmount: FieldValue.increment(line.amount)');

        expect(guard).toBeGreaterThan(-1);
        expect(credit).toBeGreaterThan(guard);
    });

    it('and an empty schedule no longer reads as fully repaid', () => {
        // `[].every()` is true. A loan with no instalments was marked "repaid"
        // by one payment against an unrelated instalment.
        expect(submit).toContain('!allInstallmentsSnapshot.empty');
        expect(submit).not.toMatch(/const allPaid = allInstallmentsSnapshot\.docs\.every/);
    });

    it('which is a reachable state, not a hypothetical one', () => {
        // Vacuity guard: the schedule builder deliberately refuses to generate
        // instalments for a loan missing its terms, so loans with none exist.
        const schedule = fn(REPAYMENTS, '_getRepaymentScheduleAction');

        expect(schedule).toContain('no interest rate or repayment period recorded');
    });
});

describe('repayment history', () => {
    const history = fn(REPAYMENTS, 'getRepaymentHistoryAction');

    it('fails closed when the loan cannot be found', () => {
        // THE test. `if (loanDoc.exists)` skipped the ownership check entirely
        // for any loan this reader could not see — which was every
        // cooperative_loans loan.
        expect(history).toContain('if (!resolvedLoan)');
        expect(history).toContain('Loan not found');
        expect(history).not.toContain('if (loanDoc.exists)');
    });

    it('and compares the borrower through the shared normalisation', () => {
        // cooperative_loans keys the borrower as memberId; a raw `.userId` is
        // undefined there, which would refuse the borrower their own history.
        expect(history).toContain('normaliseLoanApplication(');
        expect(history).toContain('loanOwner !== session.user.id');
    });

    it('before it reads a single payment row', () => {
        const guard = history.indexOf('loanOwner !== session.user.id');
        const read = history.indexOf('COLLECTIONS.LOAN_PAYMENTS');

        expect(guard).toBeGreaterThan(-1);
        expect(read).toBeGreaterThan(guard);
    });
});

describe("the member's own view of their own applications", () => {
    // The admin queue was taught to merge both collections. The two readers a
    // MEMBER sees were not, and they are the more visible half: a member filed
    // an application on /cooperatives/loans, which submits into
    // cooperative_loans, and then watched the list underneath that very form
    // stay empty. Their loan history on /cooperatives/my-loans was empty too,
    // while the loan itself was live.
    const MEMBER_ROUTE = 'src/app/api/cooperative/my-loan-applications/route.ts';

    it('the applications list covers both collections', () => {
        // THE test.
        const route = code(MEMBER_ROUTE);

        expect(route).toContain('db.collection(COLLECTIONS.COOPERATIVE_LOANS)');
        expect(route).toContain('.where("memberId", "==", userId)');
        expect(route).toContain('normaliseLoanApplication(');
    });

    it('and so does the loan history action beside it', () => {
        const history = fn(APPLICATIONS, 'getUserLoanApplicationsAction');

        expect(history).toContain('db.collection(COLLECTIONS.COOPERATIVE_LOANS).where("memberId", "==", userId)');
        expect(history).toContain('normaliseLoanApplication(');
    });

    it('each using the borrower key its own collection carries', () => {
        // Vacuity guard: querying cooperative_loans by `userId` would return
        // nothing and look exactly like a fix.
        const route = code(MEMBER_ROUTE);
        const history = fn(APPLICATIONS, 'getUserLoanApplicationsAction');

        // Whitespace-collapsed: the route writes its two queries across lines.
        const flat = (s: string) => s.replace(/\s+/g, ' ');

        for (const src of [flat(route), flat(history)]) {
            expect(src).toMatch(/COLLECTIONS\.LOAN_APPLICATIONS\)\s*\.where\("userId", "==", userId\)/);
            expect(src).toMatch(/COLLECTIONS\.COOPERATIVE_LOANS\)\s*\.where\("memberId", "==", userId\)/);
        }
    });

    it('and the page really does submit into the collection they were missing', () => {
        // Vacuity guard, and the whole reason this is a live defect.
        const page = readFileSync(join(process.cwd(), 'src/app/cooperatives/(member)/loans/page.tsx'), 'utf-8');

        expect(page).toContain('/api/cooperative/my-loan-applications');
        expect(page).toContain('applyForLoanAction');
        expect(fn(COOP_MONEY, '_applyForLoanAction')).toContain('table: "cooperative_loans"');
    });

    it('with the newest application first', () => {
        const route = code(MEMBER_ROUTE);

        expect(route).toContain('new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()');
    });
});
