/**
 * @jest-environment node
 */

/**
 *   #370 THE COOPERATIVE LOAN PRODUCT IS COMPLETE EXCEPT FOR THE WAY IN.
 *
 *        submitLoanApplicationAction in
 *        app/actions/cooperative/_loans_applications.ts is the entire
 *        cooperative loan policy. It recomputes the member's tier from their
 *        RECORDED savings and refuses a submitted tier that does not match,
 *        caps the amount at savings × the tier multiplier, checks the duration
 *        against the tier maximum, applies the tier interest rate, and builds
 *        the amortisation schedule in kobo.
 *
 *        ITS ONLY CALLER IS components/LoanApplicationWizard.tsx, WHICH
 *        NOTHING IMPORTS.
 *
 *        #287 noticed the wizard had no importer — in passing, while explaining
 *        that the UNREFERENCED copy handled a refusal better than the wired
 *        one. It did not follow through to the consequence, which is that every
 *        rule listed above is applied by nothing.
 *
 *        WHAT /loans/apply ACTUALLY DOES. LoanWizard's own header calls it "the
 *        only loan application page in the product". It submits through
 *        submitLoanApplication in loan-actions.ts — the BUSINESS loan: a
 *        monthly rate and a term, no tier, no savings multiplier. That is the
 *        other of the two products #70 recorded sharing LOAN_APPLICATIONS.
 *
 *        AND EVERYTHING DOWNSTREAM IS LIVE:
 *
 *          /cooperatives/my-loans          reads the applications and their
 *                                          schedules, offers RepayFromSavingsModal
 *          RecordRepaymentModal            admin records a repayment
 *          RepaymentSchedule               renders the instalments
 *          /admin/cooperatives/loans       the approval queue
 *          /admin/cooperatives/loan-products  wired into the sidebar by #362
 *
 *        Members can repay, and admins can approve, cooperative loans that
 *        nothing in the product can create.
 *
 *        NOT WIRED UP, DELIBERATELY. #362's rule was to connect a built screen
 *        where its placement is not a product question. Here it is: the
 *        cooperative application belongs either at /loans/apply — which today
 *        means business loans — or at /cooperative/loans/apply/[id], which #362
 *        recorded as one of the ten orphaned screens. Whether the two products
 *        share one entrance is the owner's call, and guessing would either
 *        merge two different rule sets behind one button or build a second
 *        entrance nobody asked for.
 *
 *        OWNER DECISION: give the cooperative loan an application path, or
 *        retire the application half and say so on the member screens that
 *        currently imply it exists.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC = walk('src');

function resolveSpec(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
    }
    return null;
}

function importersOf(target: string): string[] {
    const out: string[] = [];
    for (const f of SRC) {
        if (f === target) continue;
        for (const m of code(f).matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
            if (resolveSpec(f, m[1]) === target) { out.push(f); break; }
        }
    }
    return out;
}

/** Files that CALL a function, ignoring prose and re-export barrels. */
function callersOf(fn: string): string[] {
    const call = new RegExp(`\\b${fn}\\s*\\(`);
    return SRC.filter((f) => call.test(code(f)));
}

const WIZARD = 'src/components/LoanApplicationWizard.tsx';
const COOP_ACTION = 'src/app/actions/cooperative/_loans_applications.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#370 — the cooperative loan application has no way in', () => {
    it('NOTHING IMPORTS LoanApplicationWizard', () => {
        expect(importersOf(WIZARD)).toEqual([]);
    });

    it('AND IT IS THE ONLY CALLER OF submitLoanApplicationAction', () => {
        // The action file itself declares it; the wizard calls it. Nobody else.
        expect(callersOf('submitLoanApplicationAction').sort())
            .toEqual([COOP_ACTION, WIZARD].sort());
    });

    it('so no reachable code can create a cooperative loan application', () => {
        // The two facts together. Stated as one assertion because either alone
        // is only half the finding.
        const callers = callersOf('submitLoanApplicationAction')
            .filter((f) => f !== COOP_ACTION);

        expect(callers).toEqual([WIZARD]);
        expect(importersOf(WIZARD)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#370 — what the live application page does instead', () => {
    it('/loans/apply submits the BUSINESS loan action', () => {
        const page = code('src/app/loans/apply/page.tsx');

        // WORD-ANCHORED, and the module specifier anchored on its quotes.
        // `toContain` cannot tell submitLoanApplication from
        // submitLoanApplicationAction, nor loan-actions from loan-actionsX:
        // mutants M4 and M5 both walked through the first draft of this test.
        expect(page).toMatch(/\bsubmitLoanApplication\b/);
        expect(page).toMatch(/["']@\/app\/actions\/loan-actions["']/);
        expect(page).not.toContain('submitLoanApplicationAction');
    });

    it('and LoanWizard says it is the only loan application page there is', () => {
        expect(readFileSync(join(ROOT, 'src/components/loans/LoanWizard.tsx'), 'utf-8'))
            .toContain('the only loan application page in the product');
    });

    it('the two apply different rules, so one cannot stand in for the other', () => {
        const coop = code(COOP_ACTION);
        const business = code('src/app/actions/loan-actions.ts');

        // The cooperative rules: tier from recorded savings, savings multiplier,
        // tier duration, tier interest. Each name is WORD-ANCHORED — renaming
        // calculateUserTier to calculateUserTierX still satisfies `toContain`,
        // which is how mutants M7 through M10 survived the first draft.
        for (const name of [
            'calculateUserTier', 'maxLoanMultiplier', 'getTierMaxDuration', 'getTierInterestRate',
        ]) {
            expect({ name, present: new RegExp(`\\b${name}\\b`).test(coop) })
                .toEqual({ name, present: true });
        }

        // The business loan has none of them.
        expect(business).not.toMatch(/\bmaxLoanMultiplier\b/);
        expect(business).not.toMatch(/\bcalculateUserTier\b/);
    });

    it('and only the cooperative writer applies the tier machinery', () => {
        // Vacuity guard on the claim above: if a second writer existed, the
        // product would have an application path after all.
        const writers = SRC.filter((f) => {
            const c = code(f);
            return /LOAN_APPLICATIONS/.test(c)
                && /\.(set|add)\(/.test(c)
                && /maxLoanMultiplier|calculateUserTier|getTierInterestRate/.test(c);
        });

        expect(writers).toEqual([COOP_ACTION]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#370 — everything downstream of the application IS live', () => {
    /**
     * This is what makes the gap a defect rather than an unused module: the
     * product presents the second half of a flow whose first half is missing.
     */
    const DOWNSTREAM: Array<[string, string]> = [
        ['src/app/cooperatives/(member)/my-loans/page.tsx', 'getUserLoanApplicationsAction'],
        ['src/app/cooperatives/(member)/my-loans/page.tsx', 'getRepaymentScheduleAction'],
        ['src/components/loans/RepayFromSavingsModal.tsx', 'repayLoanFromSavingsAction'],
        ['src/components/loans/RepaymentSchedule.tsx', 'getRepaymentScheduleAction'],
        ['src/components/admin/RecordRepaymentModal.tsx', 'submitRepaymentAction'],
    ];

    for (const [file, action] of DOWNSTREAM) {
        it(`${file} calls ${action}`, () => {
            expect(new RegExp(`\\b${action}\\s*\\(`).test(code(file))).toBe(true);
        });
    }

    it('and the member screen that offers repayment is itself reachable', () => {
        // A screen behind the hub guard, linked from the cooperative area —
        // not another orphan.
        expect(existsSync(join(ROOT, 'src/app/cooperatives/(member)/my-loans/page.tsx'))).toBe(true);
        expect(importersOf('src/components/loans/RepayFromSavingsModal.tsx'))
            .toContain('src/app/cooperatives/(member)/my-loans/page.tsx');
    });

    it('and the admin repayment modal is reached from the admin loan queue', () => {
        expect(importersOf('src/components/admin/RecordRepaymentModal.tsx'))
            .toContain('src/app/admin/cooperatives/loans/page.tsx');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#370 — the sweeps are not vacuous', () => {
    it('finds the source files', () => {
        expect(SRC.length).toBeGreaterThan(400);
    });

    it('and report callers and importers where they exist', () => {
        expect(callersOf('getRepaymentScheduleAction').length).toBeGreaterThan(2);
        expect(importersOf('src/components/loans/LoanWizard.tsx'))
            .toEqual(['src/app/loans/apply/page.tsx']);
    });

    it('measured on code, not on prose', () => {
        // LoanWizard's header names LoanApplicationWizard, and the #370 notes
        // name the action. A raw-text sweep would call both reachable — the
        // tombstone trap, eleven times now.
        const raw = readFileSync(join(ROOT, 'src/components/loans/LoanWizard.tsx'), 'utf-8');

        expect(raw).toContain('LoanApplicationWizard');
        expect(code('src/components/loans/LoanWizard.tsx')).not.toContain('LoanApplicationWizard');
    });

    it('and both files carry the #370 note', () => {
        for (const file of [WIZARD, COOP_ACTION]) {
            expect({ file, labelled: readFileSync(join(ROOT, file), 'utf-8').includes('#370') })
                .toEqual({ file, labelled: true });
        }
    });
});
