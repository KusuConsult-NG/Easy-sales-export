/**
 * @jest-environment node
 */

/**
 * Two initiators for one contribution. One of them could not be credited.
 *
 * A member's cooperative contribution can be started two ways:
 *
 *   initializeContributionPaymentAction   used by /cooperatives/contribute.
 *                                         Goes through initializePaystackPayment
 *                                         with `type: 'contribution'` and an
 *                                         `amount` in the metadata, and defaults
 *                                         its callback to
 *                                         /cooperatives/verify-payment.
 *
 *   POST /api/cooperative/contribute      the same operation, hand-rolled
 *                                         against Paystack directly.
 *
 * The route had three faults, any one of them fatal:
 *
 * 1. THE WRONG SPELLING OF THE EVENT. The webhook resolves
 *    `const type = metadata.type || metadata.purpose` and credits a member's
 *    savings on `type === "contribution"`. The route sent no `type` and a
 *    `purpose` of 'cooperative_contribution', so the fallback handed the
 *    dispatcher a value matching no branch and the payment fell through to the
 *    unknown-type path — recorded with a deliberately non-completed status,
 *    logged, and never fulfilled. The member paid and their savings did not
 *    move.
 *
 *    contribution vs cooperative_contribution is the SAME split an earlier pass
 *    fixed in CLAIM_TYPE — "the only claim type in the codebase with two
 *    spellings". It was settled in the claim layer and left standing in the
 *    layer that decides whether the money is credited at all.
 *
 * 2. NO `amount`. verifyContributionPaymentAction cross-checks the amount
 *    Paystack reports against the amount recorded in the metadata. With the
 *    field absent, `if (expectedAmount && ...)` is skipped — the one guard that
 *    catches a tampered payment page, disabled for every payment from here.
 *
 * 3. A CALLBACK URL WITH NO ROUTE. `/cooperatives/contribute/callback` has no
 *    `callback` segment under it, only the page itself. Paystack redirected the
 *    member there after they had paid, and they got a 404.
 *
 * The route is not referenced by any page today, which is the only reason this
 * was latent rather than live — but it is a live HTTP endpoint that takes
 * money, and the fix is to make the same operation produce the same payment.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROUTE = 'src/app/api/cooperative/contribute/route.ts';
const ACTION = 'src/app/actions/cooperative/_payment.ts';
const WEBHOOK = 'src/app/api/webhooks/paystack/route.ts';
const PAYSTACK = 'src/lib/paystack-server.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('what the webhook actually credits on', () => {
    it('the metadata `type`, and nothing else', () => {
        // THE premise. Without this, a missing type would be cosmetic.
        const webhook = code(WEBHOOK);

        expect(webhook).toContain('} else if (type === "contribution") {');
        expect(webhook).toContain('await processCooperativeContribution(reference, amountPaidv, userId, paidAtDate);');
    });

    it('falling back to `purpose`, which is what made the wrong spelling fatal', () => {
        // The route DID send something the dispatcher read. It read
        // "cooperative_contribution", which matches no branch — so the fallback
        // did not rescue it, it just made the failure quieter.
        const webhook = code(WEBHOOK);

        expect(webhook).toContain('const type = metadata.type || metadata.purpose || null;');
        expect(webhook).not.toContain('=== "cooperative_contribution"');
    });
});

describe('the contribute route', () => {
    const route = code(ROUTE);

    it('sends the type the webhook dispatches on', () => {
        // THE test.
        expect(route).toContain("type: 'contribution',");
    });

    it('and the amount the verifier cross-checks against', () => {
        // Pinned inside the metadata object, not anywhere in the file — the
        // handler destructures `const { amount, contributionType }` at the top,
        // so a bare `amount,` matches whether or not the metadata carries one.
        const metadata = route.slice(route.indexOf('metadata: {'), route.indexOf('callback_url'));

        expect(metadata).toContain('amount,');
        expect(metadata).toContain("type: 'contribution',");
    });

    it('and lands the member on a page that exists', () => {
        expect(route).toContain('callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/verify-payment`');
        expect(route).not.toContain('/cooperatives/contribute/callback');
    });

    it('rounding to whole kobo, as the action already does', () => {
        expect(route).toContain('Math.round(amount * 100)');
        expect(route).not.toContain('amount: amount * 100');
    });
});

describe('the routes it points at', () => {
    it('the new callback page is real and the old one was not', () => {
        // THE test for the third fault, against the filesystem rather than a
        // guess about the router.
        const app = join(process.cwd(), 'src/app');

        expect(existsSync(join(app, 'cooperatives/verify-payment/page.tsx'))).toBe(true);
        expect(existsSync(join(app, 'cooperatives/contribute/callback/page.tsx'))).toBe(false);
        expect(existsSync(join(app, 'cooperatives/(member)/contribute/callback/page.tsx'))).toBe(false);
    });

    it('and that page really does verify a contribution', () => {
        const page = readFileSync(
            join(process.cwd(), 'src/app/cooperatives/verify-payment/page.tsx'),
            'utf-8',
        );

        expect(page).toContain('verifyContributionPaymentAction');
    });

    it('which is the default the shared initializer already used', () => {
        // Vacuity guard: the destination is the platform's own answer, not one
        // chosen here.
        expect(code(PAYSTACK)).toContain('/cooperatives/verify-payment');
    });
});

describe('the verifier the fixed metadata feeds', () => {
    it('cross-checks the amount only when the metadata carries one', () => {
        const action = code(ACTION);

        expect(action).toContain('const expectedAmount = verification.data.metadata?.amount;');
        expect(action).toContain('if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1)');
    });

    it('and the sibling initiator has always sent both fields', () => {
        // Vacuity guard: this is what "the same operation, differently" means.
        const action = code(ACTION);

        expect(action).toContain("{ type: 'contribution',");
        expect(action).toContain('amount,');
    });
});
