/**
 * @jest-environment node
 */

/**
 *   #522 THE BUTTON LABELLED "VERIFY" ACCEPTED ANYTHING, AND SAID SO OUT LOUD.
 *
 *   Auditing the onboarding step components — a dozen files no test imports —
 *   led to the one with a KYC control on it. wave/application/steps/FinancialStep
 *   collects a BVN, and this is the whole chain:
 *
 *     1. handleVerifyBvn checks `if (!data.bvn)` and nothing else.
 *     2. It posts to /api/kyc/verify-bvn.
 *     3. That route checks `if (!bvn || !firstName || !lastName)` and nothing
 *        else, then answers `isMatch: true`.
 *     4. The step sets bvnVerified and shows a toast:
 *
 *            "BVN Verified Successfully!"
 *
 *   So a member typing "1" was told their BVN was verified, and the form then
 *   let them continue because `validateForm` gates on `bvnVerified`.
 *
 * ── THE OWNER'S RULE EXISTS AND REACHED FIVE OTHER DOORS ────────────────────
 *
 *   The instruction is explicit and predates this: an ID must be eleven digits
 *   and must not be 11111111111 or a similar combination. #501 built
 *   nationalIdField and isObviouslyFakeId for exactly that and wired them into
 *   five submission paths — schemas.ts, validations/marketplace,
 *   validations/cooperative, types/export-actions, _wv_applications and both
 *   _coop_registration doors.
 *
 *   THE DOOR WITH THE VERIFY BUTTON ON IT WAS NOT ONE OF THEM. It is the one
 *   place a member is given an explicit yes/no about their ID, and it was the
 *   one place the rule was not applied.
 *
 *   AND THE ROUTE'S OWN COMMENT CLAIMED OTHERWISE. #485 rewrote its answer to
 *   say what it could honestly say — "the member supplied a WELL-FORMED BVN and
 *   the platform has recorded it, unchecked" — and nothing in it checked
 *   well-formedness. A comment asserting a property the code does not enforce is
 *   worse than no comment: the next reader believes it.
 *
 * ── #485's FIX REACHED THE ROUTE AND NEITHER SCREEN ─────────────────────────
 *
 *   #485 found that this endpoint "answered 'the name matches' without asking
 *   anyone", made it return `checked: false` and `method: 'self_declared'`, and
 *   wrote that "the screens render those rather than a green tick".
 *
 *   Both callers ignore both fields. FinancialStep reads only `isMatch` and
 *   shows "BVN Verified Successfully!". components/onboarding/
 *   BankAccountVerification reads only `isMatch`, renders "BVN Verified against
 *   account name successfully", and calls onVerified({ bvnVerified: true }) —
 *   storing the claim. The signature shape of this audit, on the fix that was
 *   written to stop exactly this kind of overstatement.
 *
 *   The step still advances and `bvnVerified` is still written: #485 argued that
 *   deliberately — the owner cannot afford onboarding to stop, and
 *   lib/identity-verification.ts is where the stored boolean is discussed. What
 *   changes is that a malformed ID is refused, and a member is told what
 *   actually happened to a well-formed one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the BVN route back to a presence check          KILLED
 *     the NIN route back to a presence check          KILLED
 *     an obviously fake ID accepted again             KILLED
 *     the screens announcing success unconditionally  KILLED
 *     reword this header                              SURVIVED, as intended
 *
 *   THE SCREEN MUTANT SURVIVED THE FIRST RUN. My assertion matched the inline
 *   JSX, and the mutant reverted only the TOAST — the same claim is made in two
 *   places on that screen, and pinning one is not pinning both. The toast is
 *   asserted directly now. Recorded because a mutant that survives is telling
 *   you what your check is actually asking.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isObviouslyFakeId } from '@/lib/kyc-validators';

jest.mock('@/lib/rate-limit', () => ({
    withRateLimit: (handler: any) => handler,
}));

jest.mock('@/lib/identity-verification', () => ({
    IDENTITY_PROVIDER: 'none',
}));

beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'member-1', roles: ['general_user'], email: 'a@b.co' } },
        error: null,
    }));
});

const post = async (which: 'bvn' | 'nin', body: unknown) => {
    const mod = await import(`@/app/api/kyc/verify-${which}/route`);
    const res = await mod.POST(new Request(`https://example.com/api/kyc/verify-${which}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }) as never);
    return { status: res.status, body: (await res.json()) as any };
};

const NAMES = { firstName: 'Ada', lastName: 'Obi' };
const REAL_BVN = '22107458391';

// ─────────────────────────────────────────────────────────────────────────────
describe('#522 — the verify endpoint applies the owner\'s rule', () => {
    it('A SINGLE DIGIT IS REFUSED', async () => {
        //   THE test. `if (!bvn)` passed this, and the answer was isMatch: true.
        const res = await post('bvn', { bvn: '1', ...NAMES });

        expect(res.status).toBe(400);
        expect(res.body.isMatch).toBeUndefined();
    });

    it('AND SO IS 11111111111', async () => {
        //   The owner's instruction, word for word: "do not accept this:
        //   11111111111 or similar combination".
        const res = await post('bvn', { bvn: '11111111111', ...NAMES });

        expect(res.status).toBe(400);
    });

    it('AND SO IS A TEN-DIGIT NEAR MISS', async () => {
        expect((await post('bvn', { bvn: '2210745839', ...NAMES })).status).toBe(400);
    });

    it('AND A REAL-LOOKING BVN IS STILL ACCEPTED', async () => {
        //   The vacuity guard, and the reason the endpoint exists. A fix that
        //   refused everything would satisfy every assertion above and stop
        //   onboarding, which #485 explicitly ruled out.
        const res = await post('bvn', { bvn: REAL_BVN, ...NAMES });

        expect(res.status).toBe(200);
        expect(res.body.isMatch).toBe(true);
    });

    it('and the NIN endpoint applies the same rule', async () => {
        //   It has no callers today, which is exactly why it must not be left
        //   as the loaded gun — #513's reasoning.
        expect((await post('nin', { nin: '11111111111', ...NAMES })).status).toBe(400);
        expect((await post('nin', { nin: REAL_BVN, ...NAMES })).status).toBe(200);
    });

    it('and a missing name is still refused before the ID is looked at', async () => {
        //   #485's own repair, which this must not disturb: answering "the name
        //   matches" to a request containing no name.
        expect((await post('bvn', { bvn: REAL_BVN })).status).toBe(400);
    });

    it('and the shared rule is what says so', () => {
        //   Asserted through lib/kyc-validators rather than restated, so a
        //   change to what "obviously fake" means reaches this door too.
        expect(isObviouslyFakeId('11111111111')).toBe(true);
        expect(isObviouslyFakeId(REAL_BVN)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#522 — the screens say what actually happened', () => {
    const code = (p: string) => stripComments(
        readFileSync(join(process.cwd(), p), 'utf-8'), { label: p },
    );

    const STEP = 'src/app/wave/application/steps/FinancialStep.tsx';
    const COMPONENT = 'src/components/onboarding/BankAccountVerification.tsx';

    it('THE WAVE STEP NO LONGER CLAIMS SUCCESS UNCONDITIONALLY', () => {
        //   Pinned on source, and the reason stated: these are client components
        //   driven by a fetch, so rendering them here would assert on the fetch
        //   mock. The behaviour that matters — what the route answers — is
        //   asserted above; this pins that the screen reads the field the route
        //   has been sending since #485 and both callers ignored.
        const src = code(STEP);

        expect(src).toContain('setBvnChecked(result.checked === true)');
        expect(src).toMatch(/our team will confirm it during review/);

        //   THE TOAST SPECIFICALLY. My first version of this assertion matched
        //   the inline JSX and a mutant that reverted only the toast to the
        //   unconditional "BVN Verified Successfully!" SURVIVED — the two say
        //   the same thing in two places, and pinning one is not pinning both.
        expect(src).not.toMatch(/showToast\(\s*"BVN Verified Successfully!"/);
        expect(src).toMatch(/showToast\(\s*result\.checked/);
    });

    it('AND NEITHER DOES THE SHARED BANK COMPONENT', () => {
        const src = code(COMPONENT);

        expect(src).toContain('setBvnChecked(result.checked === true)');
        expect(src).toContain('bvnCheckedByProvider: result.checked === true');
        expect(src).toMatch(/our team will confirm it during review/);
    });

    it('and the success wording still exists for the day a provider is wired', () => {
        //   The control. Deleting the claim outright would satisfy the two
        //   assertions above and leave nothing to say when a check does run.
        expect(code(STEP)).toContain('BVN verified successfully');
        expect(code(COMPONENT)).toContain('BVN Verified against account name successfully');
    });

    it('and bvnVerified is still written, deliberately', () => {
        //   #485 kept isMatch true because the callers gate progress on it and
        //   onboarding cannot stop. Changing that here would be a different
        //   decision wearing this finding's clothes.
        expect(code(COMPONENT)).toContain('bvnVerified: true');
    });
});
