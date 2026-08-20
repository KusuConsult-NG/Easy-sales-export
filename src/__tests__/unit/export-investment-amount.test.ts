/**
 * @jest-environment node
 */

/**
 * Three paths fulfil one export investment. One of them never looked at what
 * was paid.
 *
 * THE AMOUNT
 * ----------
 *   processExportInvestment            the Paystack WEBHOOK. Handed
 *   (infrastructure/payments)          `data.amount / 100` by the route.
 *
 *   verifyInvestmentPaymentAction      reads `paymentData.data.amount / 100`,
 *   (export-payment.ts)                bounds-checks it, and refuses a mismatch
 *                                      against the metadata in EITHER direction.
 *
 *   verifyExportInvestmentAction       read `const amount = metadata.amount` —
 *   (export/_ex_investments.ts)        the figure the investor asked to invest
 *                                      when the payment was initialised.
 *
 * The third used that requested figure as the slot's amount, as the window's
 * funding increment, as the basis for expectedReturn and as the ledger row's
 * amount. What Paystack actually collected was never read and the two were
 * never compared. Same shape as the marketplace order (#41) and academy
 * registration (#53) defects, with the loose side here.
 *
 * THE WINDOW COUNTERS
 * -------------------
 * The same path also had two problems on the window it funds.
 *
 * Its increment carried no ceiling. The overfunding check above it is an
 * advisory READ — its own comment says two investments that each fit but
 * together exceed the goal can both pass — and a plain increment then pushes
 * fundedAmount past the goal anyway. The other two paths use
 * incrementWithinCeiling, which locks the row and checks the ceiling held on
 * that same record, so there the check IS the write.
 *
 * And it never touched `currentFunding`. Both other paths keep it in step with
 * fundedAmount, and it is the counter initializeInvestmentPaymentAction reads
 * to decide whether a window still has room. So money taken through this path
 * was invisible to that gate: the window kept admitting investors after its
 * goal was met, and each then hit the ceiling on fundedAmount and was refused
 * after being charged.
 *
 * THE CALLBACK
 * ------------
 * investInExportAction named `/dashboard/export/verify`. There is no
 * /dashboard/export route segment at all. An investor paying through it was
 * charged and landed on a 404, with nothing fulfilled.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOOSE = 'src/app/actions/export/_ex_investments.ts';
const STRICT = 'src/app/actions/export-payment.ts';
const WEBHOOK = 'src/infrastructure/payments/service.ts';
const CALLBACK = 'src/app/export/payment/callback/page.tsx';

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

/** One function's body, from its declaration to the next top-level export. */
function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.indexOf('\nexport async function ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('the amount that gets credited', () => {
    it('is the amount PAID, not the amount requested', () => {
        // THE test.
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).not.toContain('const amount = metadata.amount');
        expect(body).toContain('const paidAmount = verify.data.amount / 100');
        expect(body).toContain('const amount = paidAmount');
    });

    it('and it is compared against what was requested', () => {
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).toContain('checkOrderPaymentAmount(paidAmount, requestedAmount)');
        expect(body).toContain('if (!amountVerdict.ok)');
    });

    it('refusing before anything is claimed or written', () => {
        // A check after claimPaymentOnce has run has already spent the
        // reference, and after the slot write has already credited it.
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        const check = body.indexOf('checkOrderPaymentAmount(');
        const claim = body.indexOf('claimPaymentOnce(');
        const slot = body.indexOf('EXPORT_SLOTS');

        expect(check).toBeGreaterThan(-1);
        expect(claim).toBeGreaterThan(check);
        expect(slot).toBeGreaterThan(check);
    });

    it('which is what the other two paths already did', () => {
        // Vacuity guard: the rule being applied is the platform's own.
        expect(code(STRICT)).toContain('const amountInNaira = paymentData.data.amount / 100');
        // The webhook route divides before calling in.
        expect(code('src/app/api/webhooks/paystack/route.ts'))
            .toContain('const amountPaidv = data.amount / 100');
    });
});

describe('the window it funds', () => {
    it('increments under the ceiling, not past it', () => {
        // THE test for the second half.
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).toContain('incrementWithinCeiling({');
        expect(body).toContain('field: "fundedAmount"');
        expect(body).not.toContain('fundedAmount: FieldValue.increment(amount)');
    });

    it('choosing the ceiling field the window actually carries', () => {
        // Naming a field the record does not have leaves it UNBOUNDED —
        // incrementWithinCeiling treats a missing ceiling as uncapped.
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).toContain('exportWindow?.fundingGoal !== undefined ? "fundingGoal" : "goal"');
    });

    it('and records a charge that arrives after the goal is met', () => {
        // Refusing silently would leave an investor charged with nothing said.
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).toContain('if (!raised.ok)');
        expect(body).toContain('FAILED_PAYMENTS');
        expect(body).toContain('overfunded_review');
        expect(body).toContain('You have been charged and will be contacted');
    });

    it('now keeps currentFunding in step, as both other paths do', () => {
        const body = fn(LOOSE, 'verifyExportInvestmentAction');

        expect(body).toContain('currentFunding: FieldValue.increment(amount)');
    });

    it('which is the counter the other initiator gates on', () => {
        // Vacuity guard: without this reader, leaving currentFunding alone
        // would have cost nothing.
        const init = fn(STRICT, 'initializeInvestmentPaymentAction');

        expect(init).toContain('windowData.currentFunding || 0');
        expect(init).toContain('currentFunding + investmentAmount > fundingGoal');
    });

    it('and both other paths really do maintain both counters', () => {
        expect(code(WEBHOOK)).toContain('currentFunding: FieldValue.increment(amount)');
        expect(code(STRICT)).toContain('currentFunding: FieldValue.increment(amountInNaira)');
        expect(code(STRICT)).toContain('field: "fundedAmount"');
    });
});

describe('the callback it returns to', () => {
    it('/dashboard/export does not exist', () => {
        // The premise, checked against the filesystem.
        expect(existsSync(join(process.cwd(), 'src/app/dashboard/export'))).toBe(false);
        expect(existsSync(join(process.cwd(), CALLBACK))).toBe(true);
    });

    it('so the initiator now returns to the page that does', () => {
        const body = fn(LOOSE, 'investInExportAction');

        expect(body).not.toContain('/dashboard/export/verify');
        expect(body).toContain('/export/payment/callback?flow=window');
    });

    it('and resolves its base URL the way the other initiator does', () => {
        const body = fn(LOOSE, 'investInExportAction');

        expect(body).not.toContain('process.env.NEXT_PUBLIC_APP_URL');
        expect(body).toContain('await getBaseUrl()');
        expect(code(STRICT)).toContain('await getBaseUrl()');
    });

    it('naming its flow, because the default verifier would refuse it', () => {
        // verifyInvestmentPaymentAction looks up an EXPORT_INVESTMENTS record
        // created at initiation — one investInExportAction never creates.
        const strict = fn(STRICT, 'verifyInvestmentPaymentAction');
        expect(strict).toContain('Investment record not found');

        const init = fn(LOOSE, 'investInExportAction');
        expect(init).not.toContain('EXPORT_INVESTMENTS');
    });

    it('and the callback page dispatches on it', () => {
        const page = code(CALLBACK);

        expect(page).toContain("searchParams.get(\"flow\")");
        expect(page).toContain('verifyExportInvestmentAction(reference)');
        expect(page).toContain('verifyInvestmentPaymentAction(reference)');
    });

    it('defaulting to the pre-existing pair, so the live path is unchanged', () => {
        const page = code(CALLBACK);

        expect(page).toContain('flow === "window"');
    });
});
