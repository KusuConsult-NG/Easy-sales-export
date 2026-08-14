/**
 * @jest-environment node
 */

/**
 * A signed-in account could look up any Nigerian company or taxpayer record.
 *
 * THE BUG
 * -------
 * /api/kyc/verify-business ended with:
 *
 *     return NextResponse.json(result);
 *
 * and both services it calls end with:
 *
 *     return { success: true, isMatch: resolveMatch(result.data), details: result.data };
 *
 * where `details` is QoreID's raw payload for whatever RC number or TIN the
 * caller typed. So the route was a lookup oracle: POST an arbitrary number,
 * read back the record it resolves to. Nothing establishes that the caller has
 * any connection to the company they are asking about.
 *
 * The TIN path is the more open of the two. CAC takes a `companyName` and
 * QoreID matches against it, so it confirms rather than discovers; TIN takes no
 * name at all — `verifyTIN(number)` — so a bare number is enough.
 *
 * NOTHING CALLS THIS ROUTE
 * ------------------------
 * Searched the whole repository: the only references are comments in
 * verify-bvn and verify-nin, and kyc-route-bypass.test.ts, which cites it as
 * the evidence that the QoreID integration is real. No component, action or
 * script posts to it. So narrowing the response costs nothing that exists.
 *
 * WHY NOT DELETE IT
 * -----------------
 * Because of what it is evidence FOR. #184 corrected the record on BVN and NIN:
 * the reason those two were left bypassed was that no identity verifier existed
 * in the repository, and that had stopped being true — verify-business calls
 * verifyCAC and verifyTIN for real, and shows the shape of failing closed when
 * credentials are absent. Deleting the route would take that argument with it,
 * and kyc-route-bypass.test.ts reads this file to make it.
 *
 * WHAT IS STILL TRUE AFTER THIS
 * -----------------------------
 * `isMatch` on the TIN path remains a presence signal: it says whether a number
 * resolves to a known entity. That is a yes/no rather than a record, and
 * removing it would leave the endpoint unable to answer the question it exists
 * to answer. Tying the lookup to a business the caller owns would be the real
 * fix, and there is no such linkage in the product to tie it to — no caller,
 * no stored company for the user. That is a product decision, recorded rather
 * than invented here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const requireSession = jest.fn<any>();
const verifyCAC = jest.fn<any>();
const verifyTIN = jest.fn<any>();

jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => requireSession(...a),
}));

jest.mock('@/lib/qoreid', () => ({
    qoreIdService: {
        verifyCAC: (...a: any[]) => verifyCAC(...a),
        verifyTIN: (...a: any[]) => verifyTIN(...a),
    },
}));

jest.mock('@/lib/rate-limit', () => ({
    withRateLimit: (handler: any) => handler,
}));

const USER = { session: { user: { id: 'u1', roles: ['general_user'] } }, error: null };

/** What QoreID actually hands back, and what used to be forwarded verbatim. */
const RAW_RECORD = {
    status: { state: 'complete', status: 'exact_match' },
    cac: {
        companyName: 'Some Real Company Ltd',
        rcNumber: 'RC123456',
        address: '12 Real Street, Lagos',
        directors: [{ name: 'A Real Person', address: '3 Home Road, Abuja' }],
        registrationDate: '2011-04-02',
    },
};

function request(body: any) {
    return { json: async () => body } as any;
}

beforeEach(() => {
    jest.resetModules();
    requireSession.mockReset();
    verifyCAC.mockReset();
    verifyTIN.mockReset();
    requireSession.mockResolvedValue(USER);
    process.env.QOREID_CLIENT_ID = 'id';
    process.env.QOREID_SECRET_KEY = 'secret';
});

describe('the verdict is returned, the record is not', () => {
    it('a CAC lookup does not hand back the company record', async () => {
        // THE test. Every one of these fields used to reach the caller.
        verifyCAC.mockResolvedValue({ success: true, isMatch: true, details: RAW_RECORD });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'cac', number: 'RC123456', companyName: 'Some Real Company Ltd' }));
        const body = await res.json();

        expect(body).toEqual({ success: true, isMatch: true });
        expect(JSON.stringify(body)).not.toContain('A Real Person');
        expect(JSON.stringify(body)).not.toContain('12 Real Street');
    });

    it('nor does a TIN lookup, which needs no name at all', async () => {
        // The more open of the two: verifyTIN(number), nothing to match against.
        verifyTIN.mockResolvedValue({
            success: true,
            isMatch: true,
            details: { taxpayerName: 'A Real Taxpayer', address: '9 Somewhere', phone: '080...' },
        });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'tin', number: '12345678-0001' }));
        const body = await res.json();

        expect(body).toEqual({ success: true, isMatch: true });
    });

    it('carries no `details` key at all, under any name', async () => {
        verifyCAC.mockResolvedValue({ success: true, isMatch: false, details: RAW_RECORD });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'cac', number: 'RC1', companyName: 'X' }));
        const body = await res.json();

        expect(Object.keys(body).sort()).toEqual(['isMatch', 'success']);
    });

    it('a non-match is still reported as a non-match', async () => {
        // Vacuity guard: a route that always says true would pass a careless
        // reading of the assertions above and make the check worthless.
        verifyCAC.mockResolvedValue({ success: true, isMatch: false, details: RAW_RECORD });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'cac', number: 'RC1', companyName: 'X' }));
        const body = await res.json();

        expect(body.isMatch).toBe(false);
    });

    it('and a service failure still reaches the caller as an error', async () => {
        // qoreIdFetch's failure paths carry a message and never a payload, so
        // this shape passes through unchanged.
        verifyTIN.mockResolvedValue({ success: false, error: 'Verification service timed out. Please try again.' });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'tin', number: '1' }));
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.error).toMatch(/timed out/i);
    });
});

describe('the guards around it are unchanged', () => {
    it('an anonymous caller is refused before any lookup', async () => {
        requireSession.mockResolvedValue({ session: null, error: { error: 'no' } });
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'tin', number: '1' }));

        expect(res.status).toBe(401);
        expect(verifyTIN).not.toHaveBeenCalled();
    });

    it('missing credentials still fail closed with 503', async () => {
        delete process.env.QOREID_CLIENT_ID;
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'tin', number: '1' }));

        expect(res.status).toBe(503);
        expect(verifyTIN).not.toHaveBeenCalled();
    });

    it('a CAC request without a company name is refused', async () => {
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'cac', number: 'RC1' }));

        expect(res.status).toBe(400);
        expect(verifyCAC).not.toHaveBeenCalled();
    });

    it('an unknown type is refused', async () => {
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'passport', number: 'A1' }));

        expect(res.status).toBe(400);
    });
});

describe('the evidence #184 rests on is still here', () => {
    it('the route still calls both real verifiers', async () => {
        // kyc-route-bypass.test.ts reads this file to argue that QoreID is
        // genuinely wired, which is why this route was narrowed and not deleted.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src: string = readFileSync(
            join(process.cwd(), 'src/app/api/kyc/verify-business/route.ts'),
            'utf-8'
        );

        expect(src).toContain('qoreIdService.verifyCAC(');
        expect(src).toContain('qoreIdService.verifyTIN(');
        expect(src).toContain('Verification service currently unavailable');
    });
});
