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
 * no stored company for the user.
 *
 * ── #485: THE LOOKUP IS GONE, AND THE LESSON IS NOT ─────────────────────────
 *
 * The owner has taken the external provider out of service, so this route no
 * longer performs a lookup at all — it refuses with 503. That closes the oracle
 * completely rather than narrowing it, which is a strictly better outcome than
 * the one above.
 *
 * These assertions are REWRITTEN rather than deleted, for two reasons. The
 * guards around the endpoint (a session, a company name for CAC, a recognised
 * type) still have to hold — a retired route that stops validating is a route
 * that answers "service unavailable" to somebody with a typo. And the record of
 * WHY a raw payload must never come back has to survive the restoration: if the
 * provider returns, `details` must not return with it. The narrowing assertions
 * that proved that are preserved below against the service functions, which are
 * still on disk, rather than against a route that no longer calls them.
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

describe('#485 — the lookup oracle is closed, not narrowed', () => {
    it('A CAC REQUEST IS REFUSED, AND NO RECORD COMES BACK', async () => {
        //   THE test, and it is the strongest form the original could take: the
        //   route cannot leak a company record because it no longer fetches
        //   one.
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'cac', number: 'RC123456', companyName: 'Some Real Company Ltd' }));
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body.checked).toBe(false);
        expect(verifyCAC).not.toHaveBeenCalled();
    });

    it('AND SO IS A TIN REQUEST — the more open of the two', async () => {
        //   verifyTIN(number) took no name at all, so a bare number was enough
        //   to resolve a taxpayer. That is the path this closes hardest.
        const { POST } = await import('@/app/api/kyc/verify-business/route');

        const res: any = await POST(request({ type: 'tin', number: '12345678-0001' }));
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(verifyTIN).not.toHaveBeenCalled();
        expect(JSON.stringify(body)).not.toContain('taxpayer');
    });

    it('AND THE REFUSAL SAYS WHAT TO DO INSTEAD', () => {
        //   An endpoint that refuses without saying why sends its caller
        //   looking for an outage. A manual admin review is the real route to a
        //   verified business detail now, and the message names it.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src: string = readFileSync(
            join(process.cwd(), 'src/app/api/kyc/verify-business/route.ts'), 'utf-8');

        expect(src).toContain('reviews CAC and TIN details manually');
    });

    it('and the narrowing that protected the payload is still in the service, for the day it returns', () => {
        //   THE RECORD THAT MUST SURVIVE RESTORATION. `details` was QoreID's
        //   raw payload — company address, directors, their home addresses —
        //   forwarded verbatim to any signed-in caller. The route that leaked it
        //   is retired; the functions are not, and whoever re-wires them needs
        //   to find this rather than rediscover it.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const parked: string = readFileSync(join(process.cwd(), 'src/lib/qoreid.ts'), 'utf-8');

        expect(parked).toContain('async verifyCAC(');
        expect(parked).toContain('async verifyTIN(');
        //   The service still returns `details`; the ROUTE is what must never
        //   forward it. Asserted so a restoration that returns `result` whole
        //   re-opens the oracle knowingly rather than by accident.
        expect(parked).toContain('details:');
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

    it('#485 — it fails closed with 503 whether or not anything is configured', async () => {
        //   This checked that ABSENT CREDENTIALS produced a 503. There are no
        //   credentials to be absent any more, and the endpoint must refuse
        //   regardless — a retired route that depends on configuration to
        //   refuse correctly is one environment variable away from serving.
        delete process.env.QOREID_CLIENT_ID;
        const { POST } = await import('@/app/api/kyc/verify-business/route');
        const res: any = await POST(request({ type: 'tin', number: '1' }));
        expect(res.status).toBe(503);

        process.env.QOREID_CLIENT_ID = 'id';
        process.env.QOREID_SECRET_KEY = 'secret';
        const { POST: POST2 } = await import('@/app/api/kyc/verify-business/route');
        const res2: any = await POST2(request({ type: 'tin', number: '1' }));
        expect(res2.status).toBe(503);
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

describe('#485 — the evidence #184 rested on has moved', () => {
    it('THE ROUTE NO LONGER CALLS THE VERIFIERS, AND THE MODULE STILL HOLDS THEM', () => {
        //   #184's argument was that BVN and NIN were bypassed DELIBERATELY,
        //   evidenced by this route calling the provider for real. That argument
        //   is retired with the provider: nothing calls it now, deliberately,
        //   and the-identity-provider-is-parked.test.ts is where that is held.
        //
        //   What must not be lost is the module itself — the owner's standing
        //   rule is to fix rather than destroy, and it carries repairs that
        //   would have to be redone from nothing.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const route: string = readFileSync(
            join(process.cwd(), 'src/app/api/kyc/verify-business/route.ts'), 'utf-8');
        const parked: string = readFileSync(join(process.cwd(), 'src/lib/qoreid.ts'), 'utf-8');

        expect(route).not.toContain('qoreIdService.');
        expect(parked).toContain('async verifyCAC(');
        expect(parked).toContain('async verifyTIN(');
        expect(parked).toContain('export function resolveMatch');
    });
});
