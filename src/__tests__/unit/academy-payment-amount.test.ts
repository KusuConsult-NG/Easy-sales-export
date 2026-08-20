/**
 * @jest-environment node
 */

/**
 * One amount rule for an academy registration, applied by both fulfilment paths.
 *
 * TWO PATHS, ONE CHECK
 * --------------------
 *   processAcademyRegistration      the Paystack WEBHOOK. Derived the expected
 *   (infrastructure/payments)       fee from the plan and threw on underpayment.
 *
 *   _verifyAcademyPaymentAction     the INTERACTIVE path, wired to
 *   (actions/academy/_payment.ts)   /academy/payment/callback. NO amount
 *                                   validation whatsoever.
 *
 * The interactive path read `verify.data.amount`, wrote it as `paymentAmount`,
 * marked `paymentStatus: "completed"`, granted `academy_participant` and
 * `isVerified: true`, auto-approved the application with
 * `reviewedBy: "paystack_auto_approval"` and wrote a completed ledger row —
 * without once comparing what was paid against what the plan costs.
 *
 * The two race by design: the webhook usually finishes before the user is
 * redirected back. So which one reached a payment first decided whether an
 * underpaid registration was accepted. Same shape as the marketplace order
 * defect (#41), with the permissive path on the other side.
 *
 * A PLAN NOBODY SELLS
 * -------------------
 * The interactive path stored `metadata.plan || "registration"`. Three plans are
 * sold — foundation, standard, elite — and "registration" is not one of them, so
 * a record carrying it matches no fee lookup afterwards.
 *
 * AND THE INITIATION SIDE COULD DISAGREE WITH BOTH
 * ------------------------------------------------
 * initiateAcademyPaymentAction is a "use server" export, so its `plan` argument
 * is whatever the caller sent regardless of its declared type. Its if/else chain
 * fell through to the Foundation FEE for an unrecognised plan while storing the
 * unrecognised STRING in the Paystack metadata — charged ₦45,000, carrying a plan
 * no lookup answers.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    checkAcademyPayment,
    normaliseAcademyPlan,
    academyPlanFee,
    ACADEMY_PLANS,
    DEFAULT_ACADEMY_PLAN,
    ACADEMY_AMOUNT_TOLERANCE,
} from '@/lib/academy-plan';
import { ACADEMY_CONFIG } from '@/lib/constants';

const INTERACTIVE = 'src/app/actions/academy/_payment.ts';
const WEBHOOK = 'src/infrastructure/payments/service.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** The body of one function, from its name to the next top-level declaration. */
function fn(src: string, name: string): string {
    const start = src.indexOf(name);
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start);
    const end = after.indexOf('\nexport const ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('the plan vocabulary', () => {
    it('is the three plans that are actually sold', () => {
        expect([...ACADEMY_PLANS]).toEqual(['foundation', 'standard', 'elite']);
        // Not a guess — every one has a fee in the config the checkout charges.
        for (const plan of ACADEMY_PLANS) {
            expect(typeof ACADEMY_CONFIG.plans[plan].fee).toBe('number');
        }
    });

    it('maps "advanced" onto standard, which both paths already did by hand', () => {
        expect(normaliseAcademyPlan('advanced')).toBe('standard');
        expect(academyPlanFee('advanced')).toBe(ACADEMY_CONFIG.plans.standard.fee);
    });

    it('is case- and whitespace-insensitive about what was stored', () => {
        expect(normaliseAcademyPlan('  Elite ')).toBe('elite');
    });

    it('returns null for a plan nobody sells rather than guessing', () => {
        // THE test for the stored literal. "registration" is not a plan.
        expect(normaliseAcademyPlan('registration')).toBeNull();
        expect(normaliseAcademyPlan('')).toBeNull();
        expect(normaliseAcademyPlan(undefined)).toBeNull();
    });

    it('and the fee fallback for one is the CHEAPEST plan, not the dearest', () => {
        // Falling back to elite would refuse a legitimate foundation payment;
        // falling back to foundation refuses nothing that was genuinely paid.
        expect(DEFAULT_ACADEMY_PLAN).toBe('foundation');
        const fees = ACADEMY_PLANS.map((p) => ACADEMY_CONFIG.plans[p].fee);
        expect(ACADEMY_CONFIG.plans[DEFAULT_ACADEMY_PLAN].fee).toBe(Math.min(...fees));
        expect(academyPlanFee('registration')).toBe(ACADEMY_CONFIG.plans.foundation.fee);
    });
});

describe('the amount rule', () => {
    it('accepts an exact payment for every plan', () => {
        for (const plan of ACADEMY_PLANS) {
            const v = checkAcademyPayment(ACADEMY_CONFIG.plans[plan].fee, plan);
            expect(v).toEqual({ ok: true, plan, fee: ACADEMY_CONFIG.plans[plan].fee, overpaidBy: 0 });
        }
    });

    it('REFUSES underpayment, and says by how much', () => {
        // THE test. ₦1,000 buys an elite registration if nobody checks.
        const v = checkAcademyPayment(1000, 'elite');

        expect(v.ok).toBe(false);
        expect(v).toMatchObject({
            reason: 'underpaid',
            plan: 'elite',
            fee: ACADEMY_CONFIG.plans.elite.fee,
            shortfall: ACADEMY_CONFIG.plans.elite.fee - 1000,
        });
    });

    it('refuses a foundation-priced payment claiming an elite plan', () => {
        // The realistic attack: pay the cheapest fee, name the dearest plan.
        const v = checkAcademyPayment(ACADEMY_CONFIG.plans.foundation.fee, 'elite');

        expect(v.ok).toBe(false);
    });

    it('ACCEPTS overpayment and reports it rather than refusing', () => {
        // Refusing leaves a learner charged with no registration and an error —
        // the outcome this codebase treats as the worst one everywhere else.
        const v = checkAcademyPayment(ACADEMY_CONFIG.plans.standard.fee + 5000, 'standard');

        expect(v).toMatchObject({ ok: true, plan: 'standard', overpaidBy: 5000 });
    });

    it('allows the one naira of rounding slack the webhook already allowed', () => {
        expect(ACADEMY_AMOUNT_TOLERANCE).toBe(1);
        const fee = ACADEMY_CONFIG.plans.foundation.fee;

        expect(checkAcademyPayment(fee - 1, 'foundation').ok).toBe(true);
        expect(checkAcademyPayment(fee - 2, 'foundation').ok).toBe(false);
    });

    it('refuses an amount it cannot read instead of treating it as zero-and-fine', () => {
        for (const bad of [undefined, null, '', 'NGN45000', NaN, 0, -1]) {
            const v = checkAcademyPayment(bad, 'foundation');
            expect(v.ok).toBe(false);
        }
        expect(checkAcademyPayment(undefined, 'foundation')).toMatchObject({
            reason: 'unreadable_amount',
        });
    });

    it('prices an unrecognised plan at the foundation fee, not at nothing', () => {
        // The legacy "registration" records. Charging them nothing would accept
        // any payment at all for one.
        const v = checkAcademyPayment(1, 'registration');

        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ plan: 'foundation', fee: ACADEMY_CONFIG.plans.foundation.fee });
    });

    it('and reads a numeric string, which is what a JSONB round-trip returns', () => {
        expect(checkAcademyPayment(String(ACADEMY_CONFIG.plans.elite.fee), 'elite').ok).toBe(true);
    });
});

describe('both fulfilment paths apply it', () => {
    it.each([
        ['the interactive callback', INTERACTIVE],
        ['the Paystack webhook', WEBHOOK],
    ])('%s calls checkAcademyPayment', (_label: string, rel: string) => {
        expect(code(rel)).toContain('checkAcademyPayment(');
    });

    it('the interactive path refuses BEFORE it grants anything', () => {
        // Ordering is the whole point: the role grant, the auto-approval and the
        // ledger row all sit after the refusal.
        const src = code(INTERACTIVE);
        const body = fn(src, 'async function _verifyAcademyPaymentAction');

        const check = body.indexOf('checkAcademyPayment(');
        const refuse = body.indexOf('if (!amountVerdict.ok)');
        const grant = body.indexOf('academy_participant');
        const approve = body.indexOf('paystack_auto_approval');
        const claim = body.indexOf('claimPaymentOnce(');

        expect(check).toBeGreaterThan(-1);
        expect(refuse).toBeGreaterThan(check);
        for (const later of [grant, approve, claim]) {
            expect(later).toBeGreaterThan(refuse);
        }
    });

    it('and the webhook still throws rather than fulfilling', () => {
        // A thrown error is what leaves the payment unclaimed and reconcilable;
        // returning quietly would look like success to the webhook route.
        const body = fn(code(WEBHOOK), 'export async function processAcademyRegistration');

        expect(body).toContain('checkAcademyPayment(');
        expect(body).toContain('throw new Error("Insufficient payment amount")');
    });

    it('and neither path still carries its own fee table', () => {
        // Four copies of one rule is how they drifted in the first place.
        for (const rel of [INTERACTIVE, WEBHOOK]) {
            const src = code(rel);
            expect(src).not.toContain('ACADEMY_CONFIG.plans[');
            expect(src).not.toContain('ACADEMY_CONFIG.plans.standard.fee');
            expect(src).not.toContain('ACADEMY_CONFIG.plans.elite.fee');
        }
    });
});

describe('the plan that gets stored', () => {
    it('is never the string "registration"', () => {
        const src = code(INTERACTIVE);

        expect(src).not.toContain('|| "registration"');
        expect(src).toContain('"serviceRegistrations.academy.plan": resolvedPlan');
    });

    it('is the verdict\'s plan everywhere the interactive path writes one', () => {
        const body = fn(code(INTERACTIVE), 'async function _verifyAcademyPaymentAction');

        // The user doc, the claim metadata and the application row.
        expect(body).toContain('plan: resolvedPlan');
        expect(body).toContain('metadata: { plan: resolvedPlan }');
        expect(body).toContain('const resolvedPlan = amountVerdict.plan');
    });

    it('and the early-return branch writes the amount it verified, not a re-read', () => {
        // `processedData?.amount` was undefined for a dedicated-table row and
        // wrote null over a registration that had a real amount.
        const body = fn(code(INTERACTIVE), 'async function _verifyAcademyPaymentAction');
        const branch = body.slice(body.indexOf('already processed by webhook'));

        expect(branch.slice(0, 900)).toContain('paymentAmount: paidAmount');
        expect(branch.slice(0, 900)).toContain('plan: resolvedPlan');
        expect(branch.slice(0, 900)).not.toContain('processedData?.plan');
    });
});

describe('what the checkout charges agrees with what is verified', () => {
    it('initiation normalises the plan instead of falling through to a default fee', () => {
        // It stored the unrecognised string while charging the foundation fee.
        const body = fn(code(INTERACTIVE), 'async function _initiateAcademyPaymentAction');

        expect(body).toContain('normaliseAcademyPlan(plan)');
        expect(body).toContain('academyPlanFee(planToStore)');
        expect(body).not.toContain('(plan as string) === "advanced"');
    });

    it('so the amount charged for any plan is the amount later verified', () => {
        for (const sent of ['foundation', 'standard', 'elite', 'advanced', 'registration', '', 'ELITE']) {
            const stored = normaliseAcademyPlan(sent) ?? DEFAULT_ACADEMY_PLAN;
            const charged = academyPlanFee(stored);

            // What checkout takes must pass the check the fulfilment paths run.
            expect(checkAcademyPayment(charged, stored).ok).toBe(true);
        }
    });
});
