/**
 * @jest-environment node
 */

/**
 *   #523 REFUSING A MEMBER'S LOAN NEEDED ONLY A READ PERMISSION.
 *
 *   admin/_loans.ts gates its three functions like this:
 *
 *     _getPendingLoanApplications   cooperatives:approve_loans
 *     _approveLoanApplication       cooperatives:approve_loans
 *     _rejectLoanApplication        finance:read
 *
 *   MEASURED, from the permission matrix rather than assumed:
 *
 *     cooperatives:approve_loans   super_admin, admin, cooperative_admin
 *     finance:read                 super_admin, admin, cooperative_admin,
 *                                  support, marketplace_admin
 *
 *   So `support` and `marketplace_admin` could refuse a loan application — a
 *   decision that denies somebody money, writes `status: "rejected"` with their
 *   name in `reviewedBy`, and emails the member to say the platform is "unable
 *   to approve your loan application at this time" — while being unable to
 *   approve one, and unable even to LIST the pending queue, which is gated on
 *   the stronger permission.
 *
 *   A WRITE MORE PERMISSIVE THAN THE READ OF THE SAME RESOURCE. #510 found this
 *   shape the other way round — a read open to every admin role while the write
 *   was not — and recorded that the read "is the one that hands the data over".
 *   Here the asymmetry is inverted and worse: the more dangerous half is the
 *   open one.
 *
 * ── "NO PAGE CALLS IT" IS NOT A MITIGATION ──────────────────────────────────
 *
 *   Nothing imports this function outside its own barrel. That is not a defence:
 *   Next.js server actions are POST endpoints invocable by any authenticated
 *   client. It is the reason nobody noticed, not the reason it was safe.
 *
 * ── THE OUTLIER IS ONE OF EIGHT ─────────────────────────────────────────────
 *
 *   Every loan decision on this platform asks for cooperatives:approve_loans —
 *   in cooperative/_loans_decisions.ts (approve, reject, and one more),
 *   loan-actions.ts (the queue, approve/reject, disburse, statistics) and this
 *   file's own approve and listing. Eight gates, one disagreement. The ratchet
 *   below asserts the agreement across all three files rather than pinning the
 *   one line, because the next loan action will be written in whichever file is
 *   nearest.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the reject gate back to finance:read            KILLED
 *     the approve gate weakened to finance:read       KILLED
 *     a decision gate weakened in the live coop path  KILLED
 *     the ratchet's own file list emptied             KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { hasAdminPermission } from '@/lib/admin-permissions';

const ROOT = process.cwd();

/** Every file that decides a loan. */
const LOAN_DECISION_FILES = [
    'src/app/actions/admin/_loans.ts',
    'src/app/actions/loan-actions.ts',
    'src/app/actions/cooperative/_loans_decisions.ts',
];

const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

// ─────────────────────────────────────────────────────────────────────────────
describe('#523 — the roles, measured', () => {
    it('support CANNOT APPROVE A LOAN', () => {
        //   The baseline the finding rests on. If this ever became true the
        //   asymmetry would be gone and so would the finding.
        expect(hasAdminPermission(['support'], 'cooperatives:approve_loans')).toBe(false);
    });

    it('AND support COULD READ FINANCE — WHICH IS WHY THE OLD GATE LET THEM THROUGH', () => {
        expect(hasAdminPermission(['support'], 'finance:read')).toBe(true);
    });

    it('AND SO COULD marketplace_admin', () => {
        expect(hasAdminPermission(['marketplace_admin'], 'finance:read')).toBe(true);
        expect(hasAdminPermission(['marketplace_admin'], 'cooperatives:approve_loans')).toBe(false);
    });

    it('and a cooperative_admin can still decide loans', () => {
        //   The vacuity guard: a fix that locked everyone out would satisfy the
        //   assertions above and break the queue.
        expect(hasAdminPermission(['cooperative_admin'], 'cooperatives:approve_loans')).toBe(true);
        expect(hasAdminPermission(['super_admin'], 'cooperatives:approve_loans')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#523 — every loan decision asks the same question', () => {
    it('NO LOAN-DECISION FILE GATES ANYTHING ON finance:read', () => {
        //   THE test. Comments stripped, because the fix's own header quotes the
        //   old permission in order to explain it — #493's trap, met eight times
        //   in this audit now.
        const offenders = LOAN_DECISION_FILES.filter((p) => code(p).includes('"finance:read"'));

        expect(offenders).toEqual([]);
    });

    it('AND EVERY GATE IN THEM IS cooperatives:approve_loans', () => {
        //   Stronger than banning one string: whatever permission these files
        //   ask for, it has to be that one.
        const seen = new Set<string>();
        for (const p of LOAN_DECISION_FILES) {
            for (const m of code(p).matchAll(/hasAdminPermission\([^,]+,\s*"([^"]+)"\)/g)) {
                seen.add(m[1]);
            }
        }

        expect([...seen].sort()).toEqual(['cooperatives:approve_loans']);
    });

    it('AND THE SWEEP ACTUALLY READ THE FILES', () => {
        //   #484's shape — a control that reads as present and is none. An empty
        //   or mistyped file list makes both assertions above pass for ever.
        for (const p of LOAN_DECISION_FILES) {
            const body = code(p);
            expect(body.length).toBeGreaterThan(1000);
            expect(body).toContain('hasAdminPermission(');
        }

        const gateCount = LOAN_DECISION_FILES
            .map((p) => [...code(p).matchAll(/hasAdminPermission\(/g)].length)
            .reduce((a, b) => a + b, 0);
        expect(gateCount).toBeGreaterThanOrEqual(8);
    });

    it('and the reject path specifically names the stronger permission', () => {
        //   The one line the finding is about, pinned as well as the rule — a
        //   sweep that counted gates could be satisfied by deleting one.
        const body = code('src/app/actions/admin/_loans.ts');

        expect(body).toContain('Unauthorized: Permission required - cooperatives:approve_loans');
        expect(body).not.toContain('Permission required - finance:read');
    });
});
