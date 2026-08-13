/**
 * @jest-environment node
 */

/**
 * The reason the BVN and NIN bypass was left in place is no longer true.
 *
 * kyc-self-assertion.test.ts recorded the bypass on the ACTIONS path and gave
 * the reason it was recorded rather than fixed:
 *
 *     No QoreID call exists in the repository, and no other identity verifier
 *     does either.
 *
 *     That is deliberate — the log line names it — and reversing it needs
 *     QoreID credentials and a decision about whether an unverifiable
 *     applicant may proceed.
 *
 * Both halves have since stopped being accurate.
 *
 * src/lib/qoreid.ts implements verifyBVN, verifyNIN, verifyCAC, verifyTIN,
 * verifyDrivingLicense and verifyVotersCard — OAuth token exchange, real
 * requests, timeout handling, rate-limit handling, and a resolveMatch on the
 * response. /api/kyc/verify-business calls verifyCAC and verifyTIN today.
 * /api/kyc/verify-bank-account resolves against Paystack for real.
 *
 * So identity verification is wired on this platform. BVN and NIN are the two
 * that skip it, and their routes import qoreIdService without ever calling it —
 * which is the evidence that the call was removed rather than never written.
 *
 * THE ROUTE PATH WAS NOT COVERED
 * ------------------------------
 * kyc-self-assertion.test.ts covers kyc.ts and the actions. The live onboarding
 * path is the routes:
 *
 *     BankAccountVerification.tsx  → POST /api/kyc/verify-bvn
 *     wave/.../FinancialStep.tsx   → POST /api/kyc/verify-bvn
 *
 * and both do the same thing with the answer:
 *
 *     if (result.success && result.isMatch) { setBvnVerified(true); ... }
 *
 * so the constant this route returns is what sets bvnVerified on the user.
 *
 * WHAT WAS FIXED, AND WHAT WAS NOT
 * --------------------------------
 * Not fixed: the bypass itself. Restoring it is one line —
 * `await qoreIdService.verifyBVN(bvn, firstName, lastName)` — and
 * verify-business shows the shape of failing closed when credentials are
 * absent. The reason to leave it is operational rather than technical: if
 * QOREID_* is unset in production, every BVN and NIN check begins returning 503
 * and onboarding stops. That is a deployment decision and wants someone who can
 * see the production environment.
 *
 * Fixed: the routes never read the request body. Both callers send
 * { bvn, firstName, lastName } and the handler returned isMatch: true to any
 * caller, including one posting nothing. Whatever is decided about the bypass,
 * answering "the name matches" to a request containing no name is wrong on its
 * own terms — and those are the arguments the restored call needs.
 *
 * Also added: `checked: false` on the response, so the answer says what it is.
 *
 * These tests are written to FAIL when the QoreID call is restored, at which
 * point they should be replaced by tests of the verification.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const bvn = source('src/app/api/kyc/verify-bvn/route.ts');
const nin = source('src/app/api/kyc/verify-nin/route.ts');
const qoreid = source('src/lib/qoreid.ts');

describe('the integration exists, which is the correction', () => {
    it('qoreid.ts implements the two checks these routes skip', () => {
        // THE correction. The recorded reason for the bypass was that no
        // verifier existed.
        expect(qoreid).toContain('async verifyBVN(bvn: string, firstName: string, lastName: string)');
        expect(qoreid).toContain('async verifyNIN(nin: string, firstName: string, lastName: string)');
    });

    it('and it is a real client, not a stub', () => {
        expect(qoreid).toContain('await fetch(');
        expect(qoreid).toContain('/token');
        expect(qoreid).toContain('timed out');
        expect(qoreid).toContain('rate-limited');
    });

    it('another route calls it today', () => {
        const business = source('src/app/api/kyc/verify-business/route.ts');

        expect(business).toContain('qoreIdService.verifyCAC(');
        expect(business).toContain('qoreIdService.verifyTIN(');
    });

    it('and shows the shape of failing closed without credentials', () => {
        // Which is what restoring the BVN and NIN call would inherit, and the
        // operational risk that keeps it a deployment decision.
        expect(source('src/app/api/kyc/verify-business/route.ts'))
            .toContain('Verification service currently unavailable');
    });

    it('bank verification is real too', () => {
        const bank = source('src/app/api/kyc/verify-bank-account/route.ts');

        expect(bank).toContain('https://api.paystack.co/bank/resolve');
    });

    it('the stale premise is corrected where it was recorded', () => {
        const older = source('src/__tests__/unit/kyc-self-assertion.test.ts');

        // Asserted on the correction alone. The corrected paragraph quotes the
        // old sentence to say what was wrong with it, so `not.toContain` would
        // fail on the fix — the seventh assertion in this audit to meet that
        // trap. When both the claim and its correction are prose, pin the one
        // you want to be true.
        expect(older).toContain('CORRECTION, ADDED LATER');
        expect(older).toContain('identity verification IS wired on this platform');
    });
});

describe('the bypass, recorded on the route path', () => {
    it('both routes import the service and never call it', () => {
        for (const [name, src] of [['bvn', bvn], ['nin', nin]] as const) {
            expect(`${name} imports: ${src.includes("from '@/lib/qoreid'")}`).toBe(`${name} imports: true`);
            expect(`${name} calls: ${codeOnly(src).includes('qoreIdService.')}`).toBe(`${name} calls: false`);
        }
    });

    it('both return a constant match', () => {
        for (const src of [bvn, nin]) {
            expect(src).toContain('isMatch: true');
        }
    });

    it('the live onboarding screens use these routes, not the actions', () => {
        // Why covering the route path matters: this is the path a real user
        // goes through.
        for (const file of [
            'src/components/onboarding/BankAccountVerification.tsx',
            'src/app/wave/application/steps/FinancialStep.tsx',
        ]) {
            expect(source(file)).toContain("'/api/kyc/verify-bvn'");
        }
    });

    it('and set bvnVerified from the answer', () => {
        // So the constant returned above is what marks the user verified.
        expect(source('src/components/onboarding/BankAccountVerification.tsx'))
            .toContain('bvnVerified: true');
    });
});

describe('the answer says what it is, and needs a question', () => {
    it('the request body is read and required', () => {
        // It returned isMatch: true to a caller who posted nothing.
        for (const src of [bvn, nin]) {
            expect(src).toContain('await req.json().catch(() => ({}))');
            expect(src).toContain('first name and last name are required');
            expect(src).toContain('{ status: 400 }');
        }
    });

    it('checks the field each route is named for', () => {
        expect(bvn).toContain('const { bvn, firstName, lastName } = body ?? {}');
        expect(nin).toContain('const { nin, firstName, lastName } = body ?? {}');
    });

    it('the response admits nothing was checked', () => {
        for (const src of [bvn, nin]) {
            expect(src).toContain('checked: false');
        }
    });

    it('still answers the callers, which both depend on', () => {
        // Vacuity guard: making these fail closed is exactly the deployment
        // decision being left open, and doing it here would break onboarding
        // silently under cover of a validation fix.
        for (const src of [bvn, nin]) {
            expect(src).toContain('success: true, isMatch: true');
        }
    });

    it('a session is still required first', () => {
        for (const src of [bvn, nin]) {
            const guardAt = src.indexOf('requireSession()');
            const bodyAt = src.indexOf('await req.json()');

            expect(guardAt).toBeGreaterThan(-1);
            expect(bodyAt).toBeGreaterThan(guardAt);
        }
    });

    it('and both are rate-limited', () => {
        for (const src of [bvn, nin]) {
            expect(src).toContain('withRateLimit(');
        }
    });
});

describe('the one that is honest about being gone', () => {
    it('verify-id returns 410 and says why', () => {
        // Left as found, and worth pinning: this is what an endpoint that no
        // longer verifies should look like.
        const id = source('src/app/api/kyc/verify-id/route.ts');

        expect(id).toContain('410');
        expect(id).toContain('no longer available');
        expect(id).not.toContain('isMatch: true');
    });
});
