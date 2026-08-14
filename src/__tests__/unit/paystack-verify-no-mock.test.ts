/**
 * @jest-environment node
 */

/**
 * verifyPaystackPayment fabricated a successful ₦50,000 payment for any
 * reference beginning with the letter T.
 *
 * THE BUG
 * -------
 *     const isTestRef = reference.startsWith('TEST_E2E_REF_') ||
 *                       reference.startsWith('T') ||
 *                       reference.startsWith('E2E_') ||
 *                       reference === 'INVALID_REF' ||
 *                       process.env.NODE_ENV === 'test' ||
 *                       process.env.PLAYWRIGHT_TEST === 'true';
 *
 *     if (isTestRef) { ...return a fabricated successful payment... }
 *
 * `startsWith('T')` is not a test-only shape. Paystack issues references of the
 * form T + fifteen digits, and production records carry them:
 *
 *     T457550806738035   T232223621495674   T750250345181632
 *
 * — all three on cooperative membership records, alongside card-checkout
 * references in Paystack's other form (583fq11y9g, 9bvszibs1d, …). Which form a
 * payment gets is Paystack's to decide, so no caller could know whether its
 * reference would be verified or invented.
 *
 * WHAT THE MOCK RETURNED
 * ----------------------
 *     status: 'success'
 *     amount: 5000000 kobo (₦50,000)
 *     metadata: { userId: <the caller's OWN session id>, type: 'academy_registration', amount: 50000 }
 *
 * Wrong in both directions. A member who paid ₦10,000 was verified as having
 * paid ₦50,000. A caller who paid nothing got the same answer: invent a string
 * beginning with T, hand it to any of the dozen verify paths — cooperative
 * contribution and registration, academy enrolment, marketplace escrow,
 * farm-nation purchase, export investment — and the platform recorded a
 * successful ₦50,000 payment and fulfilled against it.
 *
 * WHY THE EXISTING CHECKS DID NOT CATCH IT
 * ----------------------------------------
 * They are real checks against a real response. verifyContributionPaymentAction
 * compares metadata.userId to the session, bounds the amount, and compares the
 * charge to metadata.amount. The mock read the session and echoed the id back,
 * so the identity check compared the caller to themselves; and it set
 * data.amount to 5000000 kobo and metadata.amount to 50000, so the amount check
 * agreed with itself. A stub that answers every question consistently passes
 * every consistency check.
 *
 * REMOVED, NOT NARROWED
 * ---------------------
 * Nothing used it. PLAYWRIGHT_TEST appeared exactly once in the repository — in
 * that condition. No e2e spec sends a TEST_E2E_REF_, E2E_ or INVALID_REF
 * reference; the only payment assertion in e2e/ checks the redirect to
 * Paystack's own domain. Every unit test that touches a payment path already
 * does jest.mock('@/lib/paystack-server'). Same argument #154 made for deleting
 * ADMIN_OVERRIDE: it cost a guard on the money paths and bought nothing.
 *
 * These tests deliberately do NOT mock @/lib/paystack-server — they exercise the
 * real module, with fetch stubbed, which is the only way to see the branch that
 * used to skip fetch entirely.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { verifyPaystackPayment } from '@/lib/paystack-server';

/** Real Paystack references from production records. */
const PRODUCTION_REFS = ['T457550806738035', 'T232223621495674', 'T750250345181632'];

/** What the old mock returned, and what must never appear again. */
const FABRICATED_KOBO = 5000000;

const ORIGINAL_KEY = process.env.PAYSTACK_SECRET_KEY;
const ORIGINAL_PLAYWRIGHT = process.env.PLAYWRIGHT_TEST;

let fetchMock: jest.Mock<any>;

function paystackSays(body: any, ok = true) {
    fetchMock.mockResolvedValue({ ok, statusText: 'OK', json: async () => body });
}

function successFor(reference: string, koboAmount: number, userId: string) {
    return {
        status: true,
        message: 'Verification successful',
        data: {
            status: 'success',
            reference,
            amount: koboAmount,
            metadata: { userId, type: 'cooperative_contribution', amount: koboAmount / 100 },
        },
    };
}

beforeEach(() => {
    fetchMock = jest.fn<any>();
    (global as any).fetch = fetchMock;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_only_a_fixture';
    delete process.env.PLAYWRIGHT_TEST;
});

afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = ORIGINAL_KEY;
    if (ORIGINAL_PLAYWRIGHT === undefined) delete process.env.PLAYWRIGHT_TEST;
    else process.env.PLAYWRIGHT_TEST = ORIGINAL_PLAYWRIGHT;
});

describe('a T-prefixed reference is asked about, not assumed', () => {
    it.each(PRODUCTION_REFS)('%s reaches Paystack', async (reference) => {
        // THE test. Each of these is a real production reference, and each one
        // used to return a fabricated success without a single network call.
        paystackSays(successFor(reference, 1000000, 'member-1'));

        await verifyPaystackPayment(reference);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0]))
            .toBe(`https://api.paystack.co/transaction/verify/${reference}`);
    });

    it('and the amount reported is the amount Paystack charged', async () => {
        // ₦10,000 is what the production record above was for. The mock said
        // ₦50,000 for it, and every caller believed that number.
        paystackSays(successFor(PRODUCTION_REFS[0], 1000000, 'member-1'));

        const result = await verifyPaystackPayment(PRODUCTION_REFS[0]);

        expect(result.data.amount).toBe(1000000);
        expect(result.data.amount).not.toBe(FABRICATED_KOBO);
    });

    it('a reference a caller invented is refused when Paystack refuses it', async () => {
        // The free-money half: this string never existed, and used to verify.
        paystackSays({ status: false, message: 'Transaction reference not found' });

        await expect(verifyPaystackPayment('T000000000000001')).rejects.toThrow(/reference not found/i);
    });

    it('a failed payment stays failed', async () => {
        paystackSays({
            status: true,
            message: 'Verification successful',
            data: { status: 'failed', reference: 'T999999999999999', amount: 0, metadata: {} },
        });

        const result = await verifyPaystackPayment('T999999999999999');

        expect(result.data.status).toBe('failed');
    });
});

describe('the identity in the response is Paystack\'s, not the caller\'s', () => {
    it('metadata.userId comes from the transaction', async () => {
        // The mock read the session and echoed the caller's own id back, which
        // is what made every "did this payment belong to you?" check tautological.
        paystackSays(successFor(PRODUCTION_REFS[1], 1000000, 'somebody-else'));

        const result = await verifyPaystackPayment(PRODUCTION_REFS[1]);

        expect(result.data.metadata.userId).toBe('somebody-else');
    });

    it('the module does not read the session at all', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src: string = readFileSync(join(process.cwd(), 'src/lib/paystack-server.ts'), 'utf-8');
        const code = src
            .split('\n')
            .filter((l: string) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('@/lib/auth');
        expect(code).not.toContain('await auth()');
    });
});

describe('the other triggers are gone too', () => {
    it.each(['TEST_E2E_REF_1', 'E2E_abc', 'INVALID_REF'])(
        '%s is asked about like any other reference',
        async (reference) => {
            paystackSays(successFor(reference, 250000, 'u1'));

            await verifyPaystackPayment(reference);

            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    );

    it('PLAYWRIGHT_TEST no longer switches verification off', async () => {
        // An environment variable that nothing sets and that disabled payment
        // verification wherever it was set. Same shape as ADMIN_OVERRIDE (#154).
        process.env.PLAYWRIGHT_TEST = 'true';
        paystackSays(successFor('abcdefghij', 250000, 'u1'));

        const result = await verifyPaystackPayment('abcdefghij');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.data.amount).toBe(250000);
    });

    it('running under NODE_ENV=test does not fabricate one either', async () => {
        // This suite runs with NODE_ENV=test, so the assertions above already
        // prove it. Stated separately because it is the condition that made the
        // block look defensible.
        expect(process.env.NODE_ENV).toBe('test');

        paystackSays(successFor('abcdefghij', 250000, 'u1'));
        const result = await verifyPaystackPayment('abcdefghij');

        expect(result.data.metadata.type).toBe('cooperative_contribution');
        expect(result.data.metadata.type).not.toBe('academy_registration');
    });
});

describe('it fails closed', () => {
    it('throws when no secret key is configured', async () => {
        // Rather than returning a success nobody paid for.
        delete process.env.PAYSTACK_SECRET_KEY;

        await expect(verifyPaystackPayment(PRODUCTION_REFS[2])).rejects.toThrow(/not configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when Paystack answers with an error status', async () => {
        paystackSays({}, false);

        await expect(verifyPaystackPayment('abcdefghij')).rejects.toThrow(/Failed to verify payment/i);
    });
});
