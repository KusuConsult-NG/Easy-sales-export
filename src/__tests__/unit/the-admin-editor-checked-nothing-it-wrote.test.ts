/**
 * @jest-environment node
 */

/**
 *   #524 THE ADMIN APPLICATION EDITOR VALIDATED NOTHING IT WROTE, AND WROTE TO
 *        SEVEN DOCUMENTS AT ONCE.
 *
 *   editApplicationAction sanitises its input like this:
 *
 *       for (const key of Object.keys(fields)) {
 *           if (ALLOWED_EDIT_FIELDS.includes(key) && fields[key] !== undefined) {
 *               sanitized[key] = fields[key].trim();
 *           }
 *       }
 *
 *   That is a KEY whitelist. There was no VALUE check anywhere in the function.
 *   ALLOWED_EDIT_FIELDS includes `bvn`, `nin`, `cacNumber`, `email`,
 *   `accountNumber` and both dotted spellings of the account number.
 *
 *   SO AN ADMIN COULD WRITE `bvn: "1"`. The owner's rule is explicit and
 *   predates all of this: eleven digits, and not 11111111111 or a similar
 *   combination. #501 built nationalIdField for it and wired it into five
 *   submission paths. #522 added the two verify endpoints. THIS path — the one
 *   whose value sticks on the profile, entered by the person with the authority
 *   to correct it — had none of it.
 *
 *   AND `accountNumber: "x"`, WHICH IS A PAYOUT DESTINATION. The member-facing
 *   form requires ten digits (FinancialStep validates it); the admin editor did
 *   not. Cooperative withdrawals and WAVE earnings pay to this field.
 *
 *   THE BLAST RADIUS IS THE POINT. The sync block fans each edited value out to
 *   as many as seven documents — the user profile, the cooperative member row,
 *   the seller verification, and the wave, export, academy and farm-nation
 *   applications. One unchecked keystroke propagates across the platform, and
 *   the audit entry records it as a legitimate admin edit.
 *
 * ── AND #485 REACHED TWO OF THE THREE KYC FIELDS ────────────────────────────
 *
 *   #485 established that an admin typing a number is not an identity check,
 *   and recorded provenance for it:
 *
 *       userUpdate.bvnVerificationMethod = val("bvn") ? 'self_declared' : null;
 *       userUpdate.ninVerificationMethod = val("nin") ? 'self_declared' : null;
 *
 *   `cacVerified` is set three lines below those two, from the same shape, with
 *   no method recorded. The fix reached two of three fields inside one block —
 *   this audit's most repeated finding, at its smallest scale yet.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   The ten-digit rule is written three times and they DISAGREE: schemas.ts and
 *   validations/marketplace require digits, while validations/shared's
 *   bankAccountSchema asks only `min(10).max(10)`, which accepts "abcdefghij".
 *   That looked like a live hole and is not: paystack-transfer imports it for
 *   its TYPE only (`infer<typeof bankAccountSchema>`) and never parses with it.
 *   The two live copies are correct. A shared `nubanAccountNumber` now exists so
 *   this finding did not add a fourth spelling, and the existing three are left
 *   alone deliberately — converting correct, live submission schemas is a
 *   separate decision from fixing an unvalidated one.
 *
 *   Names, addresses and occupations stay free text. Inventing formats for them
 *   would be a different change wearing this one's clothes.
 *
 *   TWO EXISTING RATCHETS CAUGHT THIS CHANGE, BOTH CORRECTLY. #371's erasure
 *   sweep matches a quoted dotted key followed by a colon in any file that
 *   touches COLLECTIONS.USERS — which is what a nested user write looks like —
 *   and my rule table was an object literal of exactly that shape, so it
 *   registered `bankAccount` as a new un-erased PII root. The table is an array
 *   of pairs now: teaching that ratchet to ignore the shape would have been the
 *   wrong repair. And #485's counts pin the number of VerificationMethod writes
 *   per file, so the third one raised _applications.ts from 2 to 3 — the count
 *   is a weak instrument in the other direction, and the note in that file
 *   records an attempt to strengthen it that was withdrawn after three false
 *   positives.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the value rules removed entirely                KILLED
 *     the BVN rule dropped from the table             KILLED
 *     the account-number rule dropped                 KILLED
 *     the cac provenance dropped again                KILLED
 *     an empty value treated as invalid               KILLED
 *     reword this header                              SURVIVED, as intended
 *
 *   THE EMPTY-VALUE MUTANT SURVIVED THE FIRST RUN. Nothing covered CLEARING a
 *   field, and that skip is load-bearing: an admin whose job is correcting
 *   records has to be able to erase a wrong account number, and the NUBAN rule
 *   rejects "". The case is covered now and the mutant dies.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const REAL_BVN = '22107458391';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'admin@example.com' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'] });
    store.seed(COLLECTIONS.USERS, MEMBER, { fullName: 'Ada Obi', email: 'ada@example.com' });
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, { userId: MEMBER, membershipStatus: 'active' });
});

const edit = async (fields: Record<string, unknown>) => {
    const { editApplicationAction } = await import('@/app/actions/admin/_applications');
    return (await editApplicationAction({
        collection: COLLECTIONS.COOPERATIVE_MEMBERS,
        docId: MEMBER,
        fields: fields as any,
    })) as any;
};

const member = () => store.get(COLLECTIONS.USERS, MEMBER) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#524 — the owner\'s ID rule reaches the admin editor', () => {
    it('A ONE-DIGIT BVN IS REFUSED', async () => {
        //   THE test. `sanitized[key] = fields[key].trim()` was the whole of the
        //   checking, so this wrote bvn: "1" onto the profile and fanned it out.
        const res = await edit({ bvn: '1' });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/bvn/i);
        expect(member().bvn).toBeUndefined();
    });

    it('AND SO IS 11111111111', async () => {
        //   The owner's instruction, word for word.
        expect((await edit({ bvn: '11111111111' })).success).toBe(false);
    });

    it('AND SO IS A MALFORMED NIN', async () => {
        expect((await edit({ nin: '123' })).success).toBe(false);
    });

    it('AND A REAL-LOOKING BVN IS STILL WRITTEN', async () => {
        //   The vacuity guard, and the reason the editor exists: an admin
        //   correcting a member's record must still be able to.
        const res = await edit({ bvn: REAL_BVN });

        expect(res.success).toBe(true);
        expect(member().bvn).toBe(REAL_BVN);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#524 — a payout destination is checked', () => {
    it('A NON-NUMERIC ACCOUNT NUMBER IS REFUSED', async () => {
        //   Cooperative withdrawals and WAVE earnings pay to this field, and the
        //   member-facing form already requires ten digits.
        expect((await edit({ accountNumber: 'abcdefghij' })).success).toBe(false);
    });

    it('AND A NINE-DIGIT ONE IS REFUSED', async () => {
        expect((await edit({ accountNumber: '012345678' })).success).toBe(false);
    });

    it('AND A REAL ONE IS WRITTEN', async () => {
        const res = await edit({ accountNumber: '0123456789' });

        expect(res.success).toBe(true);
        expect(member().bankAccountNumber).toBe('0123456789');
    });

    it('and the dotted spellings are checked too', async () => {
        //   ALLOWED_EDIT_FIELDS carries three spellings of the same field, and a
        //   rule on one of them is a rule on none.
        expect((await edit({ 'bankDetails.accountNumber': 'xxxxxxxxxx' })).success).toBe(false);
        expect((await edit({ 'bankAccount.accountNumber': 'xxxxxxxxxx' })).success).toBe(false);
    });

    it('and a malformed email is refused', async () => {
        expect((await edit({ email: 'not-an-email' })).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#524 — free text stays free text', () => {
    it('A NAME WITH PUNCTUATION IS STILL ACCEPTED', async () => {
        //   The control. A fix that started validating everything would satisfy
        //   the refusals above and break ordinary Nigerian names and addresses —
        //   "Smith & Sons <Nigeria> Ltd" is the example #512 recorded.
        const res = await edit({ fullName: "Ada N'Obi-Smith", occupation: 'Farmer / Trader' });

        expect(res.success).toBe(true);
        expect(member().fullName).toBe("Ada N'Obi-Smith");
    });

    it('AND CLEARING A WRONG VALUE IS STILL ALLOWED', async () => {
        //   The `=== ""` skip in the rule loop is load-bearing, and a mutant
        //   that removed it SURVIVED the first run because nothing covered
        //   this. An admin whose job is correcting records has to be able to
        //   ERASE a wrong account number, and nubanAccountNumber rejects "".
        await edit({ accountNumber: '0123456789' });
        expect(member().bankAccountNumber).toBe('0123456789');

        const res = await edit({ accountNumber: '', bvn: '' });
        expect(res.success).toBe(true);
    });

    it('and an unknown field is still ignored rather than written', async () => {
        //   The key whitelist was always right; it just was not enough.
        const res = await edit({ fullName: 'Ada Obi', roles: ['super_admin'] } as any);

        expect(res.success).toBe(true);
        expect(member().roles).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#524 — the third KYC field records its provenance', () => {
    it('cacVerified TRAVELS WITH A VERIFICATION METHOD, LIKE bvn AND nin', async () => {
        //   #485 recorded 'self_declared' for bvn and nin and did not reach cac,
        //   three lines below them in the same block.
        const res = await edit({ cacNumber: 'RC1234567' });

        expect(res.success).toBe(true);
        expect(member().cacVerified).toBe(true);
        expect(member().cacVerificationMethod).toBe('self_declared');
    });

    it('AND SO DO THE OTHER TWO, UNCHANGED', async () => {
        await edit({ bvn: REAL_BVN });

        expect(member().bvnVerified).toBe(true);
        expect(member().bvnVerificationMethod).toBe('self_declared');
    });

    it('and all three record it the same way', () => {
        //   Pinned as a shape as well as a value: the next KYC field added to
        //   this block should read like the three above it.
        const body = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/admin/_applications.ts'), 'utf-8'),
            { label: '_applications.ts' },
        );
        const methods = [...body.matchAll(/(\w+)VerificationMethod = val\(/g)].map((m) => m[1]);

        expect(methods.sort()).toEqual(['bvn', 'cac', 'nin']);
    });
});
