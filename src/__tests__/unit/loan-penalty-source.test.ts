/**
 * @jest-environment node
 */

/**
 * A test file covering a copy of the function, while the original ran.
 *
 * THE FINDING
 * -----------
 * `src/lib/calculatePenalty.ts` carries the header
 *
 *     Extracted from loans.ts for testing
 *
 * and `src/__tests__/lib/penalty.test.ts` covers it thoroughly — grace period
 * boundaries, rounding, zero amounts, large amounts, ten assertions.
 *
 * The extraction happened. The original was never replaced with an import.
 * cooperative/_loans.ts kept its own private, identical `calculatePenalty` and
 * called that one, so **every assertion in that suite covered a function no
 * production path invoked**.
 *
 * Nothing was WRONG, because the two were byte-identical in behaviour. That is
 * the point. This is the state a duplicate sits in right up until somebody
 * changes one of them — and the one with the tests is the one a person editing
 * penalty logic would naturally find and trust.
 *
 * The vacuity here is a level up from the usual: not an assertion that cannot
 * fail, but a whole suite pointed at the wrong function. Nothing in the suite
 * could have revealed it, because everything it says about the lib copy is true.
 *
 * WHY IT MATTERS THAT THIS IS MONEY
 * ---------------------------------
 * The penalty is not decorative. submitRepaymentAction computes
 *
 *     totalDue = installment.totalAmount + penalty
 *
 * and an instalment is not marked `paid` until `paidAmount` covers that. So the
 * function decides when a borrower has finished paying.
 *
 * UNCAPPED, AND REPORTED RATHER THAN INVENTED
 * -------------------------------------------
 * 0.1% of the instalment per day after a seven-day grace period, with no
 * ceiling:
 *
 *     1,000 days overdue  =  100% of the instalment, on top of the instalment
 *     2,000 days overdue  =  200%
 *
 * It simply keeps going. Whether a cap exists, and where, is a lending policy
 * decision — the same reason loan-terms.ts records who confirmed the business
 * loan rate and on what date. The arithmetic is pinned below so the shape of
 * the exposure is visible; the number is left to whoever owns the policy.
 *
 * ALSO: AN EXPORT THAT DID NOT SAY IT WAS PARTIAL
 * -----------------------------------------------
 * getAdminLoanApplicationsExportAction caps both its query paths at 5,000 rows
 * and said nothing about it, so an export that hit the cap looked complete —
 * the same shape as the audit-log export in #150, which was silently the last
 * fifty. The cap is left where it is; what was missing is the caller being able
 * to tell.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calculatePenalty } from '@/lib/calculatePenalty';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

describe('the tested penalty function is the one that runs', () => {
    const loans = source('src/app/actions/cooperative/_loans_repayments.ts');

    it('imports it rather than redefining it', () => {
        // THE test. Both statements were true at once before: the lib exported
        // it, and _loans.ts declared its own.
        expect(loans).toContain('from "@/lib/calculatePenalty"');
    });

    it('declares no local copy', () => {
        // Comment lines stripped: the explanation of the defect names the
        // function repeatedly, and a check for what the code DECLARES has to
        // read the code.
        const code = loans
            .split('\n')
            .filter((l) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toMatch(/function calculatePenalty\s*\(/);
    });

    it('still calls it where the money is decided', () => {
        // Vacuity guard: deleting the local copy without wiring the import
        // would satisfy both assertions above and break repayment.
        expect(loans).toContain('calculatePenalty(dueDate, installmentData.totalAmount)');
    });

    it('the penalty reaches totalDue, so this is money', () => {
        // Pinning WHY the previous assertions matter. If this ever stops being
        // true the function is decorative and the duplication would not.
        expect(loans).toContain('installmentData.totalAmount + penalty');
    });
});

describe('the penalty arithmetic, pinned so the exposure is visible', () => {
    function overdueBy(days: number): Date {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
    }

    it('charges nothing inside the grace period', () => {
        expect(calculatePenalty(overdueBy(7), 100_000).penalty).toBe(0);
    });

    it('charges 0.1% of the instalment per day after it', () => {
        // 30 days past the grace period on a ₦100,000 instalment.
        const result = calculatePenalty(overdueBy(37), 100_000);

        expect(result.daysOverdue).toBe(30);
        expect(result.penalty).toBe(3_000);
    });

    it('reaches the whole instalment at about 1,000 days and does not stop', () => {
        // THE exposure, stated as arithmetic rather than as an opinion. This is
        // not asserting the behaviour is wrong — it is making the shape of it
        // impossible to miss, so a cap is a decision somebody takes rather than
        // one nobody knew they were making.
        const instalment = 100_000;

        expect(calculatePenalty(overdueBy(1_007), instalment).penalty).toBe(instalment);
        expect(calculatePenalty(overdueBy(2_007), instalment).penalty).toBe(instalment * 2);
        expect(calculatePenalty(overdueBy(10_007), instalment).penalty).toBe(instalment * 10);
    });

    it('charges nothing on an instalment not yet due', () => {
        const future = new Date();
        future.setDate(future.getDate() + 30);

        expect(calculatePenalty(future, 100_000).penalty).toBe(0);
    });
});

describe('the loan export says when it is a portion', () => {
    const loans = source('src/app/actions/cooperative/_loans_applications.ts');

    it('reports truncation to the caller', () => {
        // Not only to a log line the person downloading the file never sees.
        expect(loans).toContain('truncated');
        expect(loans).toContain('rowCap: EXPORT_ROW_CAP');
    });

    it('uses one named cap for both of ITS query paths', () => {
        // The export has two: the indexed query and the in-memory fallback. They
        // held the same magic number twice, which is how two paths drift.
        //
        // Scoped to this function. getAdminLoanApplicationsAction — the
        // paginated LIST, a different function — also caps its fallback at
        // 5,000, and that is its own concern: it slices the result for
        // pagination rather than handing the whole thing over as a file. The
        // first version of this assertion scanned the file and failed on it.
        expect(loans).toMatch(/EXPORT_ROW_CAP\s*=\s*\d+/);

        const start = loans.indexOf('export async function getAdminLoanApplicationsExportAction');
        const end = loans.indexOf('export async function getAdminLoanStatsAction');
        const exportFn = loans.slice(start, end);

        expect(exportFn).not.toContain('.limit(5000)');
        expect((exportFn.match(/EXPORT_ROW_CAP/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });
});
