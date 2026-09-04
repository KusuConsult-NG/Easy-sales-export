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

    it('so no reachable code applies the TIER-based cooperative loan rules', () => {
        /**
         * #377 narrowed this claim. It used to read "no reachable code can
         * create a cooperative loan application", which was false —
         * /cooperatives/loans creates them through _applyForLoanAction. What
         * the two facts below actually establish is that this ACTION, and the
         * tier pricing it implements, are unreachable. See the #377 describe.
         */
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

// ─────────────────────────────────────────────────────────────────────────────
const LIVE_ACTION = 'src/app/actions/cooperative/_coop_money.ts';
const LIVE_PAGE = 'src/app/cooperatives/(member)/loans/page.tsx';

describe('#377 — the correction: the cooperative loan DOES have a way in', () => {
    /**
     *   #377 #370 CONCLUDED "MEMBERS CAN REPAY AND ADMINS CAN APPROVE
     *        COOPERATIVE LOANS THAT NOTHING IN THE PRODUCT CAN CREATE".
     *        THAT WAS WRONG, AND a recorded finding that is wrong is worse than
     *        no finding: the next sweep acts on it.
     *
     *        /cooperatives/loans is a live member screen. It submits through
     *        _applyForLoanAction, which files into COLLECTIONS.COOPERATIVE_LOANS
     *        — and lib/loan-application-location.ts, written BEFORE #370, states
     *        in its own header that this is "the ONLY path the member loan page
     *        at /cooperatives/loans submits through".
     *
     *        #370's MEASUREMENT holds: this component has no importer, and the
     *        tier-based action has no reachable caller. The CONCLUSION did not,
     *        because reachability was checked one level too low — it asked who
     *        calls the action rather than whether the product has an
     *        application path. The lesson is CHECK REACHABILITY OF THE FLOW,
     *        not of the function you happened to start from.
     */
    it('THE MEMBER LOAN PAGE SUBMITS A COOPERATIVE LOAN APPLICATION', () => {
        const page = code(LIVE_PAGE);

        expect(page).toMatch(/\bapplyForLoanAction\b/);
        expect(page).toMatch(/["']@\/app\/actions\/cooperative["']/);
        // Not the tier action, and not the business one.
        expect(page).not.toContain('submitLoanApplicationAction');
    });

    it('and it writes to the collection the readers resolve', () => {
        expect(code(LIVE_ACTION)).toMatch(/COLLECTIONS\.COOPERATIVE_LOANS\b/);
        expect(code('src/lib/loan-application-location.ts'))
            .toMatch(/COLLECTIONS\.COOPERATIVE_LOANS\b/);
    });

    it('THE TWO ARE DIFFERENT PRICING MODELS, WHICH IS WHY ONE ENTRANCE IS RIGHT', () => {
        // Tier-based here, product-based there. A second member entrance
        // offering "a cooperative loan" on other terms would collide with the
        // one-open-application claim, which spans both collections.
        const tier = code(COOP_ACTION);
        const product = code(LIVE_ACTION);

        expect(tier).toMatch(/\bcalculateUserTier\b/);
        expect(tier).toMatch(/\bgetTierInterestRate\b/);
        expect(product).toMatch(/\bLOAN_PRODUCTS\b/);
        expect(product).toMatch(/\bcalculateRepaymentTerms\b/);
        expect(product).not.toMatch(/\bcalculateUserTier\b/);

        // And the one-open-application rule really does span both collections,
        // so two member entrances would lock each other out. They enforce it
        // differently — the live door claims it under an advisory lock, the
        // tier door reads both collections — but both refuse with the same
        // sentence, which is what a member would see.
        expect(tier).toMatch(/\bONE_OPEN_LOAN_APPLICATION_MESSAGE\b/);
        expect(product).toMatch(/\bONE_OPEN_LOAN_APPLICATION_MESSAGE\b/);
        expect(tier).toMatch(/COLLECTIONS\.COOPERATIVE_LOANS\b/);
        expect(product).toMatch(/\bclaimSingleOpenLoanApplication\b/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#377 — the real residue: the guarantor, on the door members use', () => {
    /**
     * lib/loan-approval-policy.ts lists four writers of a loan application and
     * what each records. Three collect a guarantor and stamp
     * guarantorVerified: false. The fourth — _applyForLoanAction, the ONLY
     * member entrance — "collects no guarantor at all", so the policy's rule had
     * to be written around it: verification is required only where a guarantor
     * was recorded. Read the other way, the control was live on applications no
     * screen can create and absent on all the rest.
     */
    it('THE LIVE ACTION NOW RECORDS A GUARANTOR', () => {
        const action = code(LIVE_ACTION);

        for (const field of ['guarantorName', 'guarantorPhone', 'guarantorEmail',
                             'guarantorRelationship', 'guarantorVerified']) {
            expect({ field, present: new RegExp(`\\b${field}\\b`).test(action) })
                .toEqual({ field, present: true });
        }
        // Unverified on arrival, like the other three writers — not asserted true.
        expect(action).toMatch(/guarantorVerified:\s*false/);
        expect(action).not.toMatch(/guarantorVerified:\s*true/);
    });

    it('AND THE MEMBER FORM COLLECTS ONE, WITH THE SAME TWO REQUIRED', () => {
        const page = code(LIVE_PAGE);

        expect(page).toMatch(/name="guarantorName"/);
        expect(page).toMatch(/name="guarantorPhone"/);
        expect(page).toMatch(/name="guarantorEmail"/);
        expect(page).toMatch(/name="guarantorRelationship"/);
    });

    it('the schema demands the two the other writers demand', () => {
        const schema = code('src/lib/types/cooperative.ts');
        const start = schema.indexOf('export const loanApplicationSchema');
        const block = schema.slice(start, schema.indexOf('export type LoanApplicationFormData', start));

        expect({ found: start > -1 }).toEqual({ found: true });
        expect(block).toMatch(/guarantorName:\s*z\.string\(\)\.trim\(\)\.min\(/);
        expect(block).toMatch(/guarantorPhone:\s*z\.string\(\)\.trim\(\)\.min\(/);
        // Optional, as they are in the wizard and the API route.
        expect(block).toMatch(/guarantorEmail[^\n]*optional\(\)/);
        expect(block).toMatch(/guarantorRelationship[^\n]*optional\(\)/);
    });

    it('SO THE VERIFICATION CONTROL NOW REACHES THESE APPLICATIONS', () => {
        // The policy is unchanged — it did not need changing. What changed is
        // that the rows it asks about finally carry the field it asks for.
        const policy = code('src/lib/loan-approval-policy.ts');

        expect(policy).toMatch(/export function recordsAGuarantor\b/);
        expect(policy).toMatch(/export function guarantorBlocksApproval\b/);
        // The rule itself: recorded AND not verified is what blocks. Before
        // this fix the first half was false for every application a member
        // could file, so the second half never ran.
        expect(policy).toMatch(/recordsAGuarantor\(app\)\s*&&\s*app\?\.guarantorVerified\s*!==\s*true/);
        // And the admin side already resolved the member collection.
        expect(code('src/app/api/admin/cooperative/verify-guarantor/route.ts'))
            .toMatch(/\bresolveLoanApplication\b/);
    });

    it('and the correction is written where the next sweep will read it', () => {
        for (const file of [WIZARD, COOP_ACTION]) {
            const raw = readFileSync(join(ROOT, file), 'utf-8');
            expect({ file, corrected: raw.includes('#377') }).toEqual({ file, corrected: true });
        }
        expect(readFileSync(join(ROOT, WIZARD), 'utf-8'))
            .toContain('THAT WAS WRONG');
    });
});
