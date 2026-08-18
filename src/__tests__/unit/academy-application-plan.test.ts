/**
 * @jest-environment node
 */

/**
 * The tier a learner bought, and the one screen that reported it.
 *
 * THE DEFECT
 * ----------
 * _submitAcademyApplicationAction wrote `plan: "registration"` on every academy
 * application it created — a literal, unconditionally, for everybody.
 *
 * The application form pays FIRST. /academy/application step 5 renders the pay
 * button while `paymentStatus === "unpaid"` and only renders Submit once
 * `paymentStatus === "paid"`, so by the time the application row is written the
 * learner has already been charged for foundation, standard or elite.
 *
 * And because no application document existed at payment time, BOTH fulfilment
 * paths skipped the update that would have recorded the real plan — each of them
 * guards it with `if (appDoc)`. Nothing ever corrected the literal.
 *
 * WHAT IT COST
 * ------------
 * /admin/academy/applications renders `planBadge(app.plan)` and exports
 * `app.plan` to CSV. Both said "Registration" for every learner in the system,
 * including everyone who paid the ₦270,000 elite fee — with the correct
 * paymentAmount displayed in the column beside it, disagreeing.
 *
 * The badge even has a dedicated grey colour for `registration`, so the screen
 * presented "we do not know which plan this is" as though it were a product.
 *
 * AND THE PLAN IS THE ACCESS KEY
 * ------------------------------
 * `serviceRegistrations.academy.plan` is the single field checkCourseAccess
 * reads to decide which course tiers a learner may enrol in, and it
 * default-denied anything it did not recognise literally. So the admin payment
 * form — whose Plan dropdown offers "Registration Only", and which took an
 * unvalidated string straight into that field — could silently revoke every
 * paid course while looking like a bookkeeping edit.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveApplicationPlan, normaliseAcademyPlan } from '@/lib/academy-plan';

const SUBMIT = 'src/app/actions/academy/_ac_applications.ts';
const ADMIN_LIST = 'src/app/actions/academy/_ac_admin_applications.ts';
const ADMIN_REVIEW = 'src/app/actions/academy/_ac_admin_review.ts';
const ENROLMENT = 'src/app/actions/academy/_ac_enrollment.ts';
const FORM = 'src/app/academy/application/page.tsx';

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

describe('resolving an application\'s plan', () => {
    it('uses the application\'s own plan when it has a real one', () => {
        expect(resolveApplicationPlan('elite', 'foundation')).toBe('elite');
    });

    it('falls back to the learner\'s plan for the rows already written', () => {
        // THE test. Every application in production carries this literal.
        expect(resolveApplicationPlan('registration', 'elite')).toBe('elite');
    });

    it('and for a row with no plan at all', () => {
        expect(resolveApplicationPlan(null, 'standard')).toBe('standard');
        expect(resolveApplicationPlan(undefined, 'foundation')).toBe('foundation');
    });

    it('maps the legacy spelling on both sides', () => {
        expect(resolveApplicationPlan('advanced', null)).toBe('standard');
        expect(resolveApplicationPlan('registration', 'advanced')).toBe('standard');
    });

    it('returns null — not a placeholder — when there is genuinely no tier', () => {
        // Registration is free (ACADEMY_REGISTRATION_FEE = 0), so "applied
        // without buying a tier" is a real state, not a missing value.
        expect(resolveApplicationPlan('registration', null)).toBeNull();
        expect(resolveApplicationPlan(undefined, undefined)).toBeNull();
    });

    it('never returns the literal that caused this', () => {
        for (const stored of ['registration', 'REGISTRATION', ' registration ']) {
            expect(resolveApplicationPlan(stored, null)).not.toBe('registration');
        }
    });
});

describe('the application row records what was paid for', () => {
    it('submit no longer hardcodes the literal', () => {
        // THE test.
        const src = code(SUBMIT);

        expect(src).not.toContain('plan: "registration"');
        expect(src).toContain('plan: existingPlan');
    });

    it('and takes it from the learner\'s academy registration, normalised', () => {
        const src = code(SUBMIT);

        expect(src).toContain('const existingPlan = normaliseAcademyPlan(');
        expect(src).toContain('serviceRegistrations?.academy?.plan');
    });

    it('which is the field the fulfilment paths write the verified plan to', () => {
        // Not a guess about where the truth lives — this is the same field both
        // paths write after checkAcademyPayment accepts the amount.
        // The interactive path writes it with a dotted field name.
        expect(code('src/app/actions/academy/_payment.ts'))
            .toContain('"serviceRegistrations.academy.plan": resolvedPlan');

        // The webhook writes the same field as a nested object.
        // Anchored inside processAcademyRegistration — the first
        // `serviceRegistrations: {` in that file belongs to the cooperative
        // handler, and matching it would have proved nothing about academy.
        const webhook = code('src/infrastructure/payments/service.ts');
        const fn = webhook.slice(webhook.indexOf('export async function processAcademyRegistration'));
        const reg = fn.slice(fn.indexOf('serviceRegistrations: {'));

        expect(reg.slice(0, 400)).toContain('academy: {');
        expect(reg.slice(0, 400)).toContain('plan: planToStore');
    });
});

describe('the form really does pay before it submits', () => {
    // The whole defect rests on this ordering: if Submit came first, the
    // fulfilment paths would have found an application and recorded the plan.
    it('step 5 offers payment while unpaid and Submit only once paid', () => {
        const src = source(FORM);

        expect(src).toContain('currentStep === 5 && paymentStatus === "unpaid"');
        expect(src).toContain('currentStep === 5 && paymentStatus === "paid"');

        const payGate = src.indexOf('currentStep === 5 && paymentStatus === "unpaid"');
        const submitGate = src.indexOf('currentStep === 5 && paymentStatus === "paid"');
        expect(payGate).toBeLessThan(submitGate);
    });

    it('and both fulfilment paths only touch an application that already exists', () => {
        // Which is why nothing corrected the literal afterwards.
        expect(code('src/app/actions/academy/_payment.ts')).toContain('if (hasApp && appDoc)');
        expect(code('src/infrastructure/payments/service.ts')).toContain('if (appDoc) {');
    });
});

describe('the admin screen repairs the rows already written', () => {
    it('both hydration branches resolve the plan instead of passing it through', () => {
        const src = code(ADMIN_LIST);
        const matches = src.match(/resolveApplicationPlan\(/g) || [];

        // Two branches: the gender-sorted one and the default one. Missing
        // either leaves one sort order still showing "Registration".
        expect(matches.length).toBe(2);
    });

    it('and resolves it against the user document, not against the row alone', () => {
        const src = code(ADMIN_LIST);

        expect(src).toContain('uData?.serviceRegistrations?.academy?.plan');
    });

    it('after the spread, so it wins over the stored literal', () => {
        // `...app` carries plan: "registration"; a key placed before it would be
        // overwritten and the fix would be invisible.
        const src = code(ADMIN_LIST);
        const branch = src.slice(src.indexOf('const mergedData = {'));
        const spread = branch.indexOf('...app,');
        const resolved = branch.indexOf('plan: resolveApplicationPlan(');

        expect(spread).toBeGreaterThan(-1);
        expect(resolved).toBeGreaterThan(spread);
    });
});

describe('the plan is an access key, so it is normalised before storage', () => {
    it('the admin payment edit stores a normalised plan, not the raw string', () => {
        const src = code(ADMIN_REVIEW);

        expect(src).toContain('const normalisedPlan = normaliseAcademyPlan(plan)');
        expect(src).toContain('"serviceRegistrations.academy.plan": normalisedPlan');
        expect(src).not.toContain('"serviceRegistrations.academy.plan": plan');
    });

    it('and the application row it writes agrees with it', () => {
        const src = code(ADMIN_REVIEW);
        expect(src).toContain('plan: normalisedPlan');
    });

    it('so the form\'s "Registration Only" option clears the tier rather than faking one', () => {
        // Behaviourally identical — checkCourseAccess denied "registration" and
        // denies null — but the field now carries one vocabulary.
        expect(normaliseAcademyPlan('registration')).toBeNull();
    });
});

describe('course access reads the shared vocabulary', () => {
    it('checkCourseAccess no longer compares plan strings literally', () => {
        const src = code(ENROLMENT);
        const fn = src.slice(src.indexOf('function checkCourseAccess'));
        const body = fn.slice(0, fn.indexOf('\n}\n'));

        expect(body).toContain('normaliseAcademyPlan(userPlan)');
        expect(body).not.toContain('userPlan === "elite"');
        expect(body).not.toContain('userPlan === "advanced"');
    });

    it('and the refusal distinguishes "wrong tier" from "no tier at all"', () => {
        // It used to say `Your current package (free) does not grant access` to
        // someone who had never chosen a package.
        const src = code(ENROLMENT);

        expect(src).not.toContain('Your current package (${userPlan})');
        expect(src).toContain('does not include a course package yet');
    });
});
