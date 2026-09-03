/**
 * @jest-environment node
 */

/**
 * Academy's course-payment path, and the revenue figure that was always zero.
 *
 * 1. COURSE REVENUE WAS ALWAYS ₦0
 *
 *    getAcademyStatsAction queried processed_payments for
 *    `type == "academy_course_purchase"`. That string appears in exactly two
 *    places in the whole codebase: written here as the query value, and written
 *    by _ac_course_payment.ts as the claim's `source`. Nothing has ever written
 *    it as a `type`.
 *
 *    So the query matched nothing. totalCourseRevenue was 0, which made
 *    monthlyRevenue 0, previousMonthRevenue 0 and — through the division guard —
 *    revenueGrowth 0. The Academy stats screen reported no course revenue and no
 *    growth no matter how much was sold.
 *
 * 2. THE PER-PLAN BREAKDOWN HAD NOBODY IN ANY PLAN
 *
 *    getAcademyMetrics bucketed by `(app.plan || "foundation").toLowerCase()`
 *    and created a new bucket for anything it did not recognise.
 *    _submitAcademyApplicationAction wrote `plan: "registration"` on every
 *    application ever created, so every paying learner landed in a bucket called
 *    "registration" while foundation, standard, elite and advanced all sat at
 *    zero.
 *
 * 3. UNDERPAYMENT OF UP TO ₦50 WAS ACCEPTED
 *
 *    verifyEnrollmentPaymentAction nested its refusal:
 *
 *        if (Math.abs(paid - expected) > 50) {
 *            if (paid < expected) { reject }
 *        }
 *
 *    so the reject was unreachable for any shortfall of ₦50 or less. The comment
 *    beside it argues with itself — "50 Naira margin for safety/fees? No, should
 *    be exact" — and leaves the 50 in.
 *
 * 4. ONE ENROLMENT, TWO COLLECTIONS
 *
 *    Its duplicate branch wrote ACADEMY_ENROLLMENTS while its primary branch
 *    updated ENROLLMENTS. The admin enrolments report and the platform metrics
 *    both read ACADEMY_ENROLLMENTS — so the only enrolments they could see were
 *    the ones produced by a DUPLICATE delivery.
 *
 * 5. TWO CALLBACKS POINTED AT PAGES THAT DO NOT EXIST
 *
 *    /academy/verify-payment has no page, and /academy/verify only looks like
 *    one — the sole route beneath it is /academy/verify/[certificateId]. Paying
 *    through either of those two initiators charged the learner and landed them
 *    on a 404, with no `academy_enrollment` webhook case to fulfil them either.
 *
 * 6. THE COURSE VERIFIER TOOK ITS BUYER FROM THE METADATA
 *
 *    `const userId = metadata.userId`, with the session checked only for
 *    existence — while its sibling refuses on a mismatch. And it reported an
 *    already-processed payment as a FAILURE, telling someone who had been
 *    charged that verification failed.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPORTS = 'src/app/actions/academy/_ac_admin_reports.ts';
const METRICS = 'src/services/userMetrics.service.ts';
const PAYMENT = 'src/app/actions/academy/_payment.ts';
const COURSE_PAY = 'src/app/actions/academy/_ac_course_payment.ts';
const CALLBACK = 'src/app/academy/payment/callback/page.tsx';

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

describe('course revenue', () => {
    it('is queried by a type something actually writes', () => {
        // THE test.
        const src = code(REPORTS);

        expect(src).not.toContain('"type", "==", "academy_course_purchase"');
        expect(src).toContain('"type", "==", "academy_enrollment"');
    });

    it('and "academy_course_purchase" now appears only as a source', () => {
        // It was the query value AND a claim source; the pair is what made the
        // filter look plausible.
        const pay = code(COURSE_PAY);

        expect(pay).toContain('source: "academy_course_purchase"');
        expect(code(REPORTS)).not.toContain('academy_course_purchase');
    });

    it('which is the type both paid-course paths claim under', () => {
        // Vacuity guard: the new filter has to match the writers.
        expect(code(COURSE_PAY)).toContain('type: "academy_enrollment"');
        expect(code(PAYMENT)).toContain('type: "academy_enrollment"');
    });

    it('and academy REGISTRATION is a different type, counted separately', () => {
        // Otherwise the fix would double-count registrations into course
        // revenue, which is added to totalRegistrationRevenue right below.
        expect(code('src/infrastructure/payments/service.ts')).toContain('type: "academy_registration"');
        expect(code(REPORTS)).toContain('totalRegistrationRevenue');
    });
});

describe('the per-plan breakdown', () => {
    it('buckets by a normalised plan, not by whatever string was stored', () => {
        const src = code(METRICS);

        expect(src).not.toContain('(app.plan || "foundation").toLowerCase()');
        expect(src).toContain('normaliseAcademyPlan(app.plan)');
    });

    it('and puts an unresolvable plan in "unknown", not in foundation', () => {
        // Guessing the cheapest plan moves real revenue between products.
        const src = code(METRICS);

        expect(src).toContain('?? "unknown"');
    });

    it('so it can no longer invent a bucket named after a non-product', () => {
        // The old else-branch created `registrationStats[plan] = {...}` for any
        // unknown string, which is how every learner ended up under
        // "registration".
        const src = code(METRICS);

        expect(src).not.toContain('registrationStats[plan] = { count: 1, revenue: amount }');
    });
});

describe('the enrolment amount rule', () => {
    it('uses the shared check instead of the nested one', () => {
        const src = code(PAYMENT);

        expect(src).not.toContain('Math.abs(amountInNaira - expectedPrice) > 50');
        expect(src).toContain('checkOrderPaymentAmount(amountInNaira, expectedPrice)');
    });

    it('and the course purchase uses it too, rather than a bare <', () => {
        const src = code(COURSE_PAY);

        expect(src).not.toContain('if (amountPaid < course.price)');
        expect(src).toContain('checkOrderPaymentAmount(amountPaid, course.price)');
    });

    it('which refuses a ₦50 shortfall — the size the old guard let through', async () => {
        const { checkOrderPaymentAmount, ORDER_AMOUNT_TOLERANCE } =
            await import('@/lib/order-payment-amount');

        // The old nested guard accepted anything within ₦50.
        expect(checkOrderPaymentAmount(9950, 10000).ok).toBe(false);

        // The slack that remains is one naira of rounding, and not a penny more.
        // Asserted against the exported constant rather than a number chosen
        // here, so the two cannot drift apart.
        expect(ORDER_AMOUNT_TOLERANCE).toBe(1);
        expect(checkOrderPaymentAmount(10000 - ORDER_AMOUNT_TOLERANCE, 10000).ok).toBe(true);
        expect(checkOrderPaymentAmount(10000 - ORDER_AMOUNT_TOLERANCE - 1, 10000).ok).toBe(false);

        // And overpayment is still accepted, not stranded.
        expect(checkOrderPaymentAmount(10000, 10000).ok).toBe(true);
        expect(checkOrderPaymentAmount(10500, 10000).ok).toBe(true);
    });
});

describe('the enrolment record', () => {
    it('both branches write ENROLLMENTS, which is what the flow created', () => {
        const src = code(PAYMENT);
        const fn = src.slice(src.indexOf('export async function verifyEnrollmentPaymentAction'));

        const writes = fn.match(/COLLECTIONS\.ENROLLMENTS/g) || [];
        expect(writes.length).toBeGreaterThanOrEqual(2);
    });

    it('and both mirror it where the admin actually looks', () => {
        const src = code(PAYMENT);
        const fn = src.slice(src.indexOf('export async function verifyEnrollmentPaymentAction'));

        expect(fn).toContain('const mirrorEnrolmentForAdmin =');
        const calls = fn.match(/await mirrorEnrolmentForAdmin\(\)/g) || [];
        expect(calls.length).toBe(2);
    });

    it('because the admin report and the platform metrics read that mirror', () => {
        // Vacuity guard: without these two readers the mirror is pointless.
        expect(code(REPORTS)).toContain('COLLECTIONS.ACADEMY_ENROLLMENTS');
        expect(code(METRICS)).toContain('COLLECTIONS.ACADEMY_ENROLLMENTS');
    });

    it('and the duplicate branch no longer writes only the mirror', () => {
        const src = code(PAYMENT);

        expect(src).not.toContain('COLLECTIONS.ACADEMY_ENROLLMENTS ?? "academy_enrollments"');
    });
});

describe('the payment callbacks', () => {
    it('the pages the old callbacks named really are missing', () => {
        // The premise, checked against the filesystem rather than asserted.
        expect(existsSync(join(process.cwd(), 'src/app/academy/verify/page.tsx'))).toBe(false);
        expect(existsSync(join(process.cwd(), 'src/app/academy/verify-payment/page.tsx'))).toBe(false);
        // …while the one they now point at exists.
        expect(existsSync(join(process.cwd(), CALLBACK))).toBe(true);
        // /academy/verify is a directory holding only a dynamic child.
        expect(existsSync(join(process.cwd(), 'src/app/academy/verify/[certificateId]/page.tsx'))).toBe(true);
    });

    it('both initiators now return to that page, with their flow named', () => {
        expect(code(COURSE_PAY)).toContain('/academy/payment/callback?flow=course');
        expect(code(PAYMENT)).toContain('/academy/payment/callback?flow=enrollment');
    });

    it('and neither reads NEXT_PUBLIC_APP_URL bare any more', () => {
        // Unset, that produced the literal string "undefined/academy/verify".
        expect(code(COURSE_PAY)).not.toContain('process.env.NEXT_PUBLIC_APP_URL');
        expect(code(COURSE_PAY)).toContain('await getBaseUrl()');
    });

    it('the callback page dispatches to the matching verifier', () => {
        const src = code(CALLBACK);

        expect(src).toContain('verifyCoursePaymentAction(reference)');
        expect(src).toContain('verifyEnrollmentPaymentAction(reference)');
        expect(src).toContain('verifyAcademyPaymentAction(reference)');
    });

    it('and an absent flow still means registration — the live path is unchanged', () => {
        const src = code(CALLBACK);

        expect(src).toContain('raw === "enrollment" || raw === "course" ? raw : "registration"');
    });

    it('which matters because the registration verifier refuses other types', () => {
        // Sending a course payer to the default verifier would have shown them
        // "Payment Verification Failed", which reads worse than the 404 did.
        const src = code(PAYMENT);

        expect(src).toContain('if (type !== "academy_registration")');
    });
});

describe('the course verifier', () => {
    it('takes its buyer from the session, not the metadata', () => {
        const src = code(COURSE_PAY);

        expect(src).not.toContain('const userId = metadata.userId;');
        expect(src).toContain('const userId = session.user.id;');
        expect(src).toContain('metadata.userId !== userId');
    });

    it('and reports an already-claimed payment as SUCCESS', () => {
        // This read the first 400 characters of the branch looking for the
        // literal `success: true`, and broke when #258 removed the early return
        // — the branch now FALLS THROUGH to the enrolment rather than answering
        // on the spot, because "the learner paid and is enrolled" was an
        // assumption that failed whenever the enrolment write had died.
        //
        // A character window is not a fact about behaviour. The executed
        // version of this claim lives in
        // academy-course-enrolment-completes.test.ts ("THE RETRY ENROLS THE
        // LEARNER RATHER THAN ASSUMING IT ALREADY HAPPENED"), which drives the
        // action with a claimed reference and asserts both success and the
        // enrolment. What remains here is the part that is genuinely about the
        // source: the failure return that used to be there is gone.
        const src = code(COURSE_PAY);
        const branch = src.slice(src.indexOf('if (!claim.claimed)'));

        expect(branch).not.toContain('error: "Payment already processed"');
        expect(branch.slice(0, 400)).not.toContain('success: false');
    });

    it('with the pre-claim check-then-write read removed', () => {
        // It took no lock and settled nothing, and it was the thing returning
        // the failure above.
        const src = code(COURSE_PAY);

        expect(src).not.toContain('if (existingDoc.exists)');
    });
});
