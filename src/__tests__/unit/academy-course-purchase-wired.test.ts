/**
 * @jest-environment node
 */

/**
 *   #378 THE PER-COURSE PURCHASE IS WIRED — AND WIRING IT ALONE WOULD HAVE
 *        SOLD NOTHING.
 *
 *        #368 measured that `course.price` was "charged by nothing a learner
 *        can reach": two initiators, neither called by any component, both
 *        verifiers live. It asked for a decision — wire ONE and retire the
 *        other, or retire the pair.
 *
 *        WIRED: initializeCoursePaymentAction, from academy/[courseId]/page.tsx.
 *        Chosen over its sibling for the reason #368 recorded: it takes only a
 *        courseId and reads the price from the course document, so nothing the
 *        browser sends decides what a learner is charged. The sibling's
 *        `amount` is a parameter validated as `>= 1000` and compared to the
 *        real price only AFTER the charge — "charge whatever the browser said,
 *        then decline to enrol if it was wrong". It is superseded and KEPT, not
 *        deleted: its verifier is the only reader of the ENROLLMENTS rows
 *        already in production.
 *
 *        THREE THINGS HAD TO FOLLOW, and each is a defect in its own right if
 *        left out.
 *
 *        1. THE ACCESS RULE HAD TO LEARN ABOUT PURCHASES. checkCourseAccess
 *           decides from the learner's PLAN against the course TIER, and the
 *           course page runs it BEFORE the progress row is consulted. A learner
 *           who bought one elite course on a foundation plan would have been
 *           charged, enrolled, and then redirected off that course's own page
 *           on their next visit. The verifier stamps `purchased` on the
 *           progress row and the rule takes it as a third input.
 *
 *           The flag is written explicitly rather than inferred from the
 *           progress row existing, because enrollInCourseAction writes the same
 *           row for plan-granted access — inferring would open every course a
 *           learner had ever been enrolled on, including after a downgrade.
 *
 *        2. THE PAGE HAD TO OFFER THE PURCHASE INSTEAD OF EJECTING. It
 *           redirected everyone whose plan did not cover the tier to the
 *           whole-plan upgrade, and the catalogue FILTERED such courses out of
 *           the list entirely — so nothing on either screen could lead a
 *           learner to a purchase they were entitled to make.
 *
 *        3. THE PAYMENT HAD TO SAY WHICH FULFILMENT IT IS. Both verifiers
 *           accept `type: "academy_enrollment"` and write different records —
 *           the progress row that grants ACCESS, and the ENROLLMENTS row the
 *           admin report reads — and claimPaymentOnce lets only one of them run
 *           per reference. While both initiators were unreachable that was
 *           harmless; with one live it means a course purchase verified through
 *           /api/academy/verify-payment leaves the learner listed as enrolled
 *           and locked out, permanently.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { checkCourseAccess, isPurchasedCourse, ACADEMY_TIERS_OPENED } from '@/lib/academy-plan';
import {
    COURSE_PURCHASE_FLOW,
    ENROLLMENT_FLOW,
    isForeignPaymentFlow,
    coursePurchaseStamp,
} from '@/lib/academy-purchase-flow';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));
const raw = (rel: string) => readFileSync(rel, 'utf-8');

const COURSE_PAGE = 'src/app/academy/[courseId]/page.tsx';
const CATALOGUE = 'src/app/academy/(learner)/courses/page.tsx';
const COURSE_PAY = 'src/app/actions/academy/_ac_course_payment.ts';
const ENROL_PAY = 'src/app/actions/academy/_payment.ts';
const FLOW = 'src/lib/academy-purchase-flow.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#378 — buying one course opens that course', () => {
    it('A PURCHASE OPENS A TIER THE PLAN DOES NOT', () => {
        // The whole point. foundation does not open elite.
        expect(checkCourseAccess('foundation', 'elite')).toBe(false);
        expect(checkCourseAccess('foundation', 'elite', true)).toBe(true);
    });

    it('and it opens the course for somebody with no plan at all', () => {
        // "Registered, no tier bought" is a real state, and a purchase is the
        // one thing that should open a paid course from it.
        expect(checkCourseAccess(null, 'standard')).toBe(false);
        expect(checkCourseAccess(null, 'standard', true)).toBe(true);
        expect(checkCourseAccess('', 'standard', true)).toBe(true);
    });

    it('ONLY A LITERAL true OPENS IT', () => {
        // A progress row is JSON from the database. A stray truthy value under
        // this key must not open a paid course — the flag is a fact somebody
        // paid for, not a hint.
        for (const notTrue of ['true', 1, {}, [], 'yes', 'purchased']) {
            expect({ notTrue, opens: checkCourseAccess('foundation', 'elite', notTrue) })
                .toEqual({ notTrue, opens: false });
        }
        for (const falsy of [false, 0, null, undefined, '']) {
            expect({ falsy, opens: checkCourseAccess('foundation', 'elite', falsy) })
                .toEqual({ falsy, opens: false });
        }
    });

    it('the default is unchanged, so every existing caller behaves as before', () => {
        // Two arguments, as the other call sites still pass.
        expect(checkCourseAccess('elite', 'elite')).toBe(true);
        expect(checkCourseAccess('standard', 'elite')).toBe(false);
        expect(checkCourseAccess('foundation', 'foundation')).toBe(true);
        expect(checkCourseAccess('foundation', 'free')).toBe(true);
        // And the plan table itself is untouched.
        expect([...ACADEMY_TIERS_OPENED.foundation]).toEqual(['foundation']);
        expect([...ACADEMY_TIERS_OPENED.elite]).toEqual(['foundation', 'standard', 'elite']);
    });

    it('isPurchasedCourse reads the flag the verifier writes, and only that', () => {
        expect(isPurchasedCourse({ purchased: true })).toBe(true);
        expect(isPurchasedCourse({ purchased: false })).toBe(false);
        expect(isPurchasedCourse({})).toBe(false);
        expect(isPurchasedCourse(null)).toBe(false);
        expect(isPurchasedCourse(undefined)).toBe(false);
        expect(isPurchasedCourse({ purchased: 'true' } as any)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#378 — the verifier records the purchase where the rule can see it', () => {
    it('THE STAMP CARRIES THE FLAG, THE REFERENCE AND THE AMOUNT', () => {
        const stamp = coursePurchaseStamp('ref-1', 5000);

        expect(stamp.purchased).toBe(true);
        expect(stamp.purchaseReference).toBe('ref-1');
        expect(stamp.purchaseAmount).toBe(5000);
        expect(typeof stamp.purchasedAt).toBe('string');
        // And the rule accepts what the stamp produces, rather than a shape
        // this test invented.
        expect(isPurchasedCourse(stamp as any)).toBe(true);
    });

    it('the verifier stamps a NEW progress row', () => {
        expect(code(COURSE_PAY)).toMatch(/coursePurchaseStamp\(reference,\s*amountPaid\)/);
        expect(code(COURSE_PAY)).toMatch(/t\.set\(progressRef,\s*\{\s*\.\.\.progress,\s*\.\.\.coursePurchaseStamp/);
    });

    it('AND AN EXISTING ONE THAT DOES NOT YET SAY IT WAS BOUGHT', () => {
        // Two ways to arrive: a learner already enrolled on their plan who buys
        // the course outright, and #258's repair path, where the payment was
        // claimed and the enrolment write failed. Without this, the retry
        // confirms an enrolment that still cannot be opened.
        const body = code(COURSE_PAY);

        expect(body).toMatch(/else if \(tProgressDoc\.data\(\)\?\.purchased !== true\)/);
        // A merge: the learner's progress is not touched.
        expect(body).toMatch(/t\.set\(progressRef,\s*coursePurchaseStamp\(reference,\s*amountPaid\),\s*\{\s*merge:\s*true\s*\}\)/);
    });

    it('and the amount stamped is the one Paystack reported, not the caller`s', () => {
        const body = code(COURSE_PAY);

        expect(body).toContain('const amountPaid = verify.data.amount / 100;');
        // Still checked against the live course price before anything is claimed.
        expect(body).toContain('checkOrderPaymentAmount(amountPaid, course.price)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#378 — the payment says which fulfilment it is', () => {
    it('THE TWO FLOWS ARE DIFFERENT STRINGS', () => {
        expect(COURSE_PURCHASE_FLOW).not.toBe(ENROLLMENT_FLOW);
        expect(COURSE_PURCHASE_FLOW.length).toBeGreaterThan(0);
        expect(ENROLLMENT_FLOW.length).toBeGreaterThan(0);
    });

    it('each verifier refuses the other`s payment', () => {
        expect(isForeignPaymentFlow(ENROLLMENT_FLOW, COURSE_PURCHASE_FLOW)).toBe(true);
        expect(isForeignPaymentFlow(COURSE_PURCHASE_FLOW, ENROLLMENT_FLOW)).toBe(true);
    });

    it('and accepts its own', () => {
        expect(isForeignPaymentFlow(COURSE_PURCHASE_FLOW, COURSE_PURCHASE_FLOW)).toBe(false);
        expect(isForeignPaymentFlow(ENROLLMENT_FLOW, ENROLLMENT_FLOW)).toBe(false);
    });

    it('AN UNMARKED PAYMENT IS ACCEPTED BY BOTH, SO NOTHING IN FLIGHT IS STRANDED', () => {
        // References created before #378 carry no marker. Refusing them would
        // strand a learner who has been charged — the outcome this codebase
        // treats as the worst one everywhere it appears.
        for (const absent of [undefined, null, '', '   ']) {
            expect({ absent, foreign: isForeignPaymentFlow(absent, COURSE_PURCHASE_FLOW) })
                .toEqual({ absent, foreign: false });
            expect({ absent, foreign: isForeignPaymentFlow(absent, ENROLLMENT_FLOW) })
                .toEqual({ absent, foreign: false });
        }
    });

    it('the initiator stamps the marker onto the payment', () => {
        expect(code(COURSE_PAY)).toMatch(/flow:\s*COURSE_PURCHASE_FLOW/);
    });

    it('BOTH VERIFIERS CHECK IT, EACH FOR ITS OWN FLOW', () => {
        // Counted per file rather than sampled: one door checking is how the
        // wrong-record fulfilment survives.
        expect(code(COURSE_PAY)).toMatch(/isForeignPaymentFlow\(metadata\.flow,\s*COURSE_PURCHASE_FLOW\)/);
        expect(code(ENROL_PAY)).toMatch(/isForeignPaymentFlow\(metadata\.flow,\s*ENROLLMENT_FLOW\)/);
    });

    it('and the check runs BEFORE the payment is claimed', () => {
        // After the claim it would be too late: the reference is spent and no
        // later call can fulfil it correctly.
        for (const file of [COURSE_PAY, ENROL_PAY]) {
            const src = code(file);
            const flowAt = src.indexOf('isForeignPaymentFlow');
            const claimAt = src.indexOf('claimPaymentOnce(');

            expect({ file, found: flowAt > -1 && claimAt > -1 }).toEqual({ file, found: true });
            expect({ file, before: flowAt < claimAt }).toEqual({ file, before: true });
        }
    });

    it('the marker lives in one module, not one copy per door', () => {
        for (const file of [COURSE_PAY, ENROL_PAY]) {
            expect({ file, imports: /from\s*"@\/lib\/academy-purchase-flow"/.test(code(file)) })
                .toEqual({ file, imports: true });
        }
        // Nobody restates the string.
        expect(code(COURSE_PAY)).not.toContain('"course_purchase"');
        expect(code(ENROL_PAY)).not.toContain('"course_purchase"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#378 — the screens offer the purchase instead of ejecting', () => {
    it('THE COURSE PAGE CALLS THE INITIATOR THAT DERIVES THE PRICE', () => {
        const page = code(COURSE_PAGE);

        expect(page).toMatch(/\binitializeCoursePaymentAction\(courseId\)/);
        expect(page).not.toContain('initializeEnrollmentPaymentAction');
    });

    it('and sends the learner to the authorization url it returns', () => {
        const page = code(COURSE_PAGE);

        expect(page).toMatch(/authorizationUrl/);
        expect(page).toMatch(/window\.location\.href = authorizationUrl/);
    });

    it('A REFUSAL IS SHOWN, NOT SWALLOWED', () => {
        // #315's class: a learner left on a button that did nothing cannot tell
        // a refusal from a dead control.
        const page = code(COURSE_PAGE);
        const fn = page.slice(page.indexOf('async function handlePurchase'));

        expect(fn.slice(0, 1200)).toMatch(/showToast\(result\.error \|\|/);
        expect(fn.slice(0, 1200)).toMatch(/catch\s*\{[\s\S]*showToast\(/);
    });

    it('THE PRICED COURSE IS NO LONGER A REDIRECT', () => {
        const page = code(COURSE_PAGE);

        // The offer, and the redirect kept for the case with nothing to offer.
        expect(page).toMatch(/if \(price > 0\) \{/);
        expect(page).toMatch(/setMustPurchase\(true\)/);
        expect(page).toContain('router.push("/academy/application")');
    });

    it('and the page reads the purchase off the progress row it already loads', () => {
        const page = code(COURSE_PAGE);

        expect(page).toMatch(/const purchased = isPurchasedCourse\(progressReq\.data\)/);
        expect(page).toMatch(/checkCourseAccess\(userPlan, courseReq\.data\.tier \|\| "free", purchased\)/);
    });

    it('THE CATALOGUE STOPS HIDING A COURSE IT COULD SELL', () => {
        const cat = code(CATALOGUE);

        expect(cat).toMatch(/const purchasable = Number\(course\.price \?\? 0\) > 0/);
        expect(cat).toMatch(/const visible = hasAccess \|\| isEnrolled \|\| purchasable/);
        expect(cat).toMatch(/matchesSearch && matchesLevel && matchesTier && visible/);
    });

    it('and an enrolled course stays listed whatever the plan says', () => {
        // Which is what keeps a course bought outright visible afterwards, and
        // stops a downgrade erasing a learner's own courses from their list.
        expect(code(CATALOGUE)).toMatch(/const isEnrolled = enrolledIds\.has\(course\.id!\)/);
    });

    it('a locked-but-buyable card leads to the course, not the plan upgrade', () => {
        const cat = code(CATALOGUE);
        const at = cat.indexOf(') : purchasable ? (');

        // A missing anchor slices to nothing and every assertion below passes
        // vacuously — the mistake that reported a false 100% in #372.
        expect({ anchor: ') : purchasable ? (', found: at > -1 })
            .toEqual({ anchor: ') : purchasable ? (', found: true });

        const cta = cat.slice(at, at + 400);
        expect(cta).toMatch(/href=\{`\/academy\/\$\{id\}`\}/);
        // And the unbuyable lock still goes where it always did.
        expect(cat).toContain('href="/academy/application"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#378 — the superseded initiator is kept, and stays unreachable', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) {
                if (e.name === '__tests__') continue;
                walk(rel, out);
            } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
        }
        return out;
    }
    const COMPONENTS = [...walk('src/app'), ...walk('src/components')]
        .filter((f) => f !== ENROL_PAY && f !== COURSE_PAY);

    it('IT IS STILL EXPORTED — nothing was deleted', () => {
        expect(code(ENROL_PAY)).toContain('export async function initializeEnrollmentPaymentAction');
    });

    it('AND STILL CALLED BY NO SCREEN', () => {
        const callers = COMPONENTS.filter((f) =>
            /\binitializeEnrollmentPaymentAction\s*\(/.test(code(f)));

        expect(callers).toEqual([]);
    });

    it('while the wired one has exactly one screen calling it', () => {
        const callers = COMPONENTS.filter((f) =>
            /\binitializeCoursePaymentAction\s*\(/.test(code(f)));

        expect(callers).toEqual([COURSE_PAGE]);
        // Not vacuous: the sweep really covers the screens.
        expect(COMPONENTS.length).toBeGreaterThan(150);
    });

    it('the decision is recorded in both files, and measured on code not prose', () => {
        for (const file of [ENROL_PAY, COURSE_PAY, FLOW]) {
            expect({ file, labelled: raw(file).includes('#378') }).toEqual({ file, labelled: true });
        }
        expect(raw(ENROL_PAY)).toContain('SUPERSEDED, NOT DELETED');
        // The tombstone trap: both initiators are NAMED in each other's notes.
        expect(code(ENROL_PAY)).not.toContain('SUPERSEDED, NOT DELETED');
    });
});
