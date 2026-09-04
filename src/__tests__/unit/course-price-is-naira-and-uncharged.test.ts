/**
 * @jest-environment node
 */

/**
 *   #368 A COURSE PRICE CHARGED AS NAIRA AND SHOWN AS DOLLARS, BY TWO PAYMENT
 *        INITIATORS NO LEARNER CAN REACH.
 *
 *        THE DISPLAY DEFECT, WHICH IS THE PROVABLE HALF
 *        ----------------------------------------------
 *        The learner course catalogue rendered
 *
 *            ${course.price} Value
 *
 *        — a literal dollar sign in front of a number this platform charges
 *        as Naira. _ac_course_payment.ts sends `Math.round(course.price * 100)`
 *        to Paystack as KOBO, so the same figure is billed in ₦ and shown in $.
 *
 *        The export module's dollar signs are NOT this bug: export is a
 *        commodity business quoted in USD, its fields are named pricePerMT and
 *        totalUSD, and export-payment.ts converts at usdToNgn before charging.
 *        Academy has no conversion anywhere, and its own application page
 *        already writes plan fees as `₦`. So the academy catalogue was the one
 *        screen naming the wrong currency. It uses formatCurrency now, which
 *        reads CURRENCY_CONFIG like every other money display.
 *
 *        THE STRUCTURAL HALF, RECORDED
 *        -----------------------------
 *        There are TWO per-course payment initiators and NEITHER is reachable
 *        from any component:
 *
 *          _payment.ts             initializeEnrollmentPaymentAction
 *                                  (courseId, courseTitle, amount, ...) — the
 *                                  AMOUNT COMES FROM THE BROWSER, validated
 *                                  only as >= 1000. The real price is checked
 *                                  at verification, after the charge.
 *          _ac_course_payment.ts   initializeCoursePaymentAction(courseId) —
 *                                  derives the price server-side, the right
 *                                  shape.
 *
 *        Both VERIFIERS are reachable: verifyEnrollmentPaymentAction from
 *        /api/academy/verify-payment and verifyCoursePaymentAction from
 *        /academy/payment/callback. Two doors stand open to verify a payment
 *        nothing in the product can start.
 *
 *        And the live enrolment path, enrollInCourseAction, never reads
 *        `course.price` at all: access comes from the learner's academy PLAN
 *        measured against the course TIER. So an academy admin who sets a
 *        price on a course changes exactly one thing — a number on a card.
 *
 *        OWNER DECISION: wire ONE initiator to the course page and retire the
 *        other, or retire the pair and the price field with them. Recorded
 *        rather than guessed at, because choosing between plan-tier access and
 *        per-course purchase is the product's call.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { formatCurrency } from '@/lib/utils';
import { CURRENCY_CONFIG } from '@/lib/constants';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

const COURSES_PAGE = 'src/app/academy/(learner)/courses/page.tsx';

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const COMPONENTS = [...walk('src/app'), ...walk('src/components')];

/**
 * Components that actually call an action, ignoring any that only name it in prose.
 *
 * TWO GUARDS, ONE OF THEM CURRENTLY REDUNDANT. The `\(` requires a call rather
 * than a mention, and `code()` removes comments. Mutation M14 dropped the
 * comment-stripping and every test still passed: the payment callback page
 * names both initiators in a comment, but without a following parenthesis, so
 * the paren alone is enough today. An EQUIVALENT MUTANT, recorded rather than
 * chased — the same disposition as #367's M16, and for the same reason. The
 * tombstone trap has fired nine times in this audit; a guard that is redundant
 * this week is cheaper than the tenth.
 */
function componentCallers(action: string): string[] {
    const call = new RegExp(`\\b${action}\\s*\\(`);
    return COMPONENTS.filter((f) => call.test(code(f)));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#368 — the course price is shown in the currency it is charged in', () => {
    it('THE CATALOGUE NO LONGER PREFIXES A NAIRA FIGURE WITH A DOLLAR SIGN', () => {
        const page = code(COURSES_PAGE);

        expect(page).toContain('{formatCurrency(course.price)} Value');
        expect(page).not.toContain('${course.price}');
    });

    it('and formatCurrency really is Naira, so the fix is not cosmetic', () => {
        expect(CURRENCY_CONFIG.code).toBe('NGN');
        expect(formatCurrency(1500)).toContain('₦');
        expect(formatCurrency(1500)).not.toContain('$');
    });

    it('the charge treats the same number as Naira — which is why $ was wrong', () => {
        // Math.round(course.price * 100) is kobo. If price were USD this would
        // bill a hundred times the dollar figure in Naira.
        expect(code('src/app/actions/academy/_ac_course_payment.ts'))
            .toContain('Math.round(course.price * 100)');
    });

    it("and academy's own application page already wrote plan fees in Naira", () => {
        // The inconsistency was inside one module, not between the platform and
        // a deliberate USD surface.
        expect(readFileSync(join(ROOT, 'src/app/academy/application/page.tsx'), 'utf-8'))
            .toContain('Pay ₦');
    });

    it('EXPORT keeps its dollar signs, because export is genuinely priced in USD', () => {
        // Vacuity guard in the other direction: a sweep that "fixed" every $ in
        // the app would have broken the one module where it is correct.
        const buyer = code('src/app/export/buyer/page.tsx');

        expect(buyer).toContain('${product.pricePerMT.toLocaleString()}');
        // And it is converted before anybody is charged.
        expect(code('src/app/actions/export-payment.ts')).toContain('exchangeRate: usdToNgn');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#368 — per-course purchase is half-built', () => {
    it('NEITHER INITIATOR IS REACHABLE FROM ANY COMPONENT', () => {
        expect(componentCallers('initializeEnrollmentPaymentAction')).toEqual([]);
        expect(componentCallers('initializeCoursePaymentAction')).toEqual([]);
    });

    it('while BOTH verifiers are', () => {
        // Which is the asymmetry: the product can confirm a per-course payment
        // and cannot begin one.
        expect(componentCallers('verifyCoursePaymentAction'))
            .toContain('src/app/academy/payment/callback/page.tsx');
        expect(code('src/app/api/academy/verify-payment/route.ts'))
            .toContain('verifyEnrollmentPaymentAction');
    });

    it('and the caller-named amount is checked only AFTER the charge', () => {
        const payment = code('src/app/actions/academy/_payment.ts');

        // The initiator validates a floor and nothing else.
        expect(payment).toContain('if (amount < 1000)');
        // The real price is read in the verifier, which runs post-Paystack.
        const verifier = payment.slice(payment.indexOf('verifyEnrollmentPaymentAction'));
        expect(verifier).toContain('courseData?.price');
    });

    it('the sibling initiator derives the price instead, which is the right shape', () => {
        const src = code('src/app/actions/academy/_ac_course_payment.ts');

        expect(src).toContain('_initializeCoursePaymentAction(courseId: string)');
        expect(src).toContain('course.price');
    });

    it('THE LIVE ENROLMENT PATH NEVER READS course.price', () => {
        // Access is plan-tier against course-tier. So a price an academy admin
        // sets changes one number on a card and nothing else.
        const enrolment = code('src/app/actions/academy/_ac_enrollment.ts');

        expect(enrolment).toContain('checkCourseAccess(userPlan, courseTier)');
        expect(enrolment).not.toContain('.price');
    });

    it('and enrollInCourseAction IS the reachable one, so the contrast is real', () => {
        expect(componentCallers('enrollInCourseAction').length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#368 — the reachability sweep is not vacuous', () => {
    it('finds the components', () => {
        expect(COMPONENTS.length).toBeGreaterThan(150);
    });

    it('and is measured on code, not on prose', () => {
        // Both initiators are NAMED in a comment in the payment callback page.
        // A raw-text sweep would report them as reachable — the tombstone trap,
        // for the ninth time in this audit.
        const raw = readFileSync(join(ROOT, 'src/app/academy/payment/callback/page.tsx'), 'utf-8');

        expect(raw).toContain('initializeEnrollmentPaymentAction');
        expect(code('src/app/academy/payment/callback/page.tsx'))
            .not.toContain('initializeEnrollmentPaymentAction');
    });
});
