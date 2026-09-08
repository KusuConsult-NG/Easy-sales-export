/**
 * @jest-environment node
 */

/**
 *   #525 THE THIRD IDENTITY DOCUMENT HAD NO RULE AT ALL.
 *
 *   KYCForm collects three: BVN, NIN and the voter's card. The first two are
 *   thoroughly guarded — #285 stopped typing a number from marking it verified,
 *   #349 rendered the confirm-digits checkboxes that existed with nothing
 *   showing them, #357 wired isObviouslyFakeId in — and each handler checks a
 *   length, requires a confirmation, and calls the fake-ID rule.
 *
 *   THE VOTER'S CARD HANDLER ASKED WHETHER THE FIELD WAS EMPTY. That was all.
 *   And so did the server:
 *
 *       if (!votersCardNumber) { return ... "required" }
 *       if (!firstName || !lastName) { return ... }
 *       // then:
 *       atomicUpdateUser(userId, { 'kyc.votersCardVerified': true, ... })
 *
 *   So typing a single character and pressing Verify wrote a verified identity
 *   document to the member's profile.
 *
 * ── WHY THE EXISTING RULE COULD NOT COVER IT ────────────────────────────────
 *
 *   looksLikeFakeId opens with
 *
 *       if (!/^\d{11}$/.test(digits)) return false;
 *
 *   and says why: "anything malformed is not its business" — it recognises
 *   NIN/BVN placeholders and nothing else. So the voter's card was outside every
 *   check in kyc-validators, and calling the existing helper on it would have
 *   answered "not fake" for "1". This needed its own rule, not a reused one, and
 *   noticing that is the whole of the work.
 *
 ── THE CEILING I WROTE FIRST, AND WHY IT IS GONE ───────────────────────────
 *
 *   I bounded the rule at nineteen characters, from CivicStatusStep's
 *   `maxLength={19}` — the only place this platform states a length. Writing the
 *   test found that KYCForm's own placeholder is
 *
 *       90F5B123456789012345
 *
 *   TWENTY characters. The form truncates its own example, so the platform does
 *   not agree with itself about how long a voter's card is. With no live
 *   database to settle it and #485's constraint that onboarding must not stop, a
 *   ceiling would have refused real members on contradictory evidence. The floor
 *   of nine, the alphanumeric requirement and the repeated-character rule remove
 *   the defect — "1", "abc", "0000000000" — without that risk. Where to add a
 *   ceiling, if the owner establishes the real length, is in kyc-validators.
 *
 *   My own test data caught that. It is the reason the fixture is the
 *   placeholder verbatim rather than a number I made up to fit the rule.
 *
 * ── AND THE GUARD I ADDED WOULD HAVE BROKEN THE FIELD ───────────────────────
 *
 *   #349 found setNinConfirmed and setBvnConfirmed existed with nothing
 *   rendering them, so those handlers "would have refused every time". Adding
 *   the same guard to the voter's card without rendering its checkbox would have
 *   reproduced that exact defect on the field I was fixing. The checkbox is
 *   rendered, and handleChange clears it on edit like the other two.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the server check removed                        KILLED
 *     the length floor dropped                        KILLED
 *     the repeated-character rule dropped             KILLED
 *     the client confirm guard removed                KILLED
 *     the confirm checkbox un-rendered                KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { looksLikeFakeVotersCard, looksLikeFakeId } from '@/lib/kyc-validators';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;
const MEMBER = 'member-1';
//   The placeholder KYCForm itself shows a member. It is TWENTY characters
//   while the same input sets maxLength={19} — see kyc-validators for what
//   that contradiction cost this rule.
const REAL_VIN = '90F5B123456789012345';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: MEMBER, roles: ['general_user'], email: 'ada@example.com' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, MEMBER, { firstName: 'Ada', lastName: 'Obi' });
});

const verify = async (votersCardNumber: string) => {
    const { verifyVotersCardAction } = await import('@/app/actions/kyc');
    return (await verifyVotersCardAction({
        votersCardNumber, firstName: 'Ada', lastName: 'Obi',
    })) as any;
};

const member = () => store.get(COLLECTIONS.USERS, MEMBER) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#525 — the server will not verify a character', () => {
    it('A SINGLE CHARACTER IS REFUSED', async () => {
        //   THE test. `if (!votersCardNumber)` passed this, and the next thing
        //   the function did was write votersCardVerified: true.
        const res = await verify('1');

        expect(res.success).toBe(false);
        expect(member()?.kyc?.votersCardVerified).toBeUndefined();
    });

    it('AND SO IS A REPEATED CHARACTER', async () => {
        expect((await verify('0000000000')).success).toBe(false);
        expect((await verify('AAAAAAAAAAAAAAAAAAA')).success).toBe(false);
    });

    it('AND SO IS ONE WITH PUNCTUATION IN IT', async () => {
        expect((await verify('90F5B-1234-5678')).success).toBe(false);
    });

    it('AND A REAL-LOOKING CARD IS STILL ACCEPTED AND RECORDED', async () => {
        //   The vacuity guard, and #485's constraint: onboarding must not stop.
        const res = await verify(REAL_VIN);

        expect(res.success).toBe(true);
        expect(member().kyc.votersCardVerified).toBe(true);
    });

    it('and it is still recorded as self-declared, not as a check', async () => {
        //   #485's provenance, which this must not disturb — nothing verified
        //   this card, and the record says so.
        await verify(REAL_VIN);

        expect(member().kyc.votersCardVerificationMethod).toBe('self_declared');
        expect(member().kyc.votersCardStatus).toBe('self_declared');
    });

    it('and a missing name is still refused before the card is looked at', async () => {
        const { verifyVotersCardAction } = await import('@/app/actions/kyc');
        const res = (await verifyVotersCardAction({
            votersCardNumber: REAL_VIN, firstName: '', lastName: '',
        })) as any;

        expect(res.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#525 — the rule, and why it had to be a new one', () => {
    it('THE NIN/BVN RULE ANSWERS "NOT FAKE" FOR A SINGLE CHARACTER', () => {
        //   The reason this finding exists rather than a one-line reuse:
        //   looksLikeFakeId returns false for anything that is not eleven
        //   digits, by design.
        expect(looksLikeFakeId('1')).toBe(false);
        expect(looksLikeFakeVotersCard('1')).toBe(true);
    });

    it('AND THE NEW RULE ACCEPTS A REAL CARD', () => {
        expect(looksLikeFakeVotersCard(REAL_VIN)).toBe(false);
    });

    it('and it tolerates spaces and lower case, which a member will type', () => {
        //   Permissive on purpose: refusing a real member is worse than the
        //   defect. Normalisation happens before the rule runs.
        expect(looksLikeFakeVotersCard('90f5b 1234 5678 9012 345')).toBe(false);
    });

    it('and it does NOT refuse a long one, deliberately', () => {
        //   The form's own placeholder is twenty characters and its maxLength is
        //   nineteen, so this platform does not agree with itself about the
        //   length. A ceiling would refuse real members on evidence that
        //   contradicts itself; the floor is what removes the defect.
        expect(looksLikeFakeVotersCard('90F5B1234567890123456789')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#525 — the form has the guard AND the control for it', () => {
    const form = () => stripComments(
        readFileSync(join(process.cwd(), 'src/components/onboarding/KYCForm.tsx'), 'utf-8'),
        { label: 'KYCForm.tsx' },
    );

    it('THE CONFIRM CHECKBOX IS RENDERED, NOT JUST CHECKED', () => {
        //   #349's exact defect: setNinConfirmed and setBvnConfirmed existed
        //   with nothing rendering them, so the handlers "would have refused
        //   every time". Adding the guard without the control would have
        //   reproduced it on the field this finding is about.
        const src = form();

        expect(src).toContain('if (!votersCardConfirmed)');
        expect(src).toContain('setVotersCardConfirmed(e.target.checked)');
        expect(src).toContain('checked={votersCardConfirmed}');
    });

    it('AND EDITING THE NUMBER CLEARS IT, LIKE THE OTHER TWO', () => {
        const src = form();
        const clearBlock = src.slice(src.indexOf("if (field === 'votersCard')"));

        expect(clearBlock.slice(0, 240)).toContain('setVotersCardConfirmed(false)');
    });

    it('and the client checks the format before spending a round trip', () => {
        expect(form()).toContain('looksLikeFakeVotersCard(votersCard)');
    });

    it('and all three documents now have the same three guards', () => {
        //   The shape, not just this instance: a fourth document added to this
        //   form should read like the three above it.
        const src = form();
        for (const guard of ['bvnConfirmed', 'ninConfirmed', 'votersCardConfirmed']) {
            expect(src).toContain(`if (!${guard})`);
        }
    });
});
