/**
 * @jest-environment node
 */

/**
 *   #779 THE ADMIN WAS SHOWN A SHA-256 DIGEST AND TOLD IT WAS THE MEMBER'S NIN,
 *        AND THE CSV'S "BVN" COLUMN CONTAINED THE WORD "Provided".
 *
 *   Reported by the owner: "when admin is viewing the forms, the BVN and NIN
 *   are reported as a long line of numbers and characters not the Users inputs
 *   and when users are CSV files are exported no BVN and NIN and Voter's card
 *   numbers that users inputed."
 *
 *   Both halves are right, with different causes.
 *
 * ── THE LONG LINE OF CHARACTERS IS A HASH, AND IT IS NOT REVERSIBLE ─────────
 *
 *   The WAVE submit path writes `nin: hashData(applicantNin)`, and hashData is
 *   `crypto.createHash('sha256')`. The detail modal renders whatever is on the
 *   row, so it renders sixty-four hex characters.
 *
 *   STATED PLAINLY, BECAUSE NO CODE CAN FIX IT: for every application ALREADY
 *   SUBMITTED, the member's real NIN and BVN are gone. A digest is one-way.
 *   This finding does not recover them and nothing will. What it does is stop
 *   presenting a digest as though it were the number, store a readable copy
 *   from now on, and say which of the two cases a given row is in.
 *
 * ── THE HASH STAYS, BECAUSE IT IS LOAD-BEARING ──────────────────────────────
 *
 *   findConflictingApplication runs `.where("nin", "==", hashData(nin))` to
 *   refuse a second application on one identity. That is a legitimate use of a
 *   hash — an equality test that never needs the original — and it is the
 *   platform's duplicate-identity guard. So `nin` and `bvn` keep holding
 *   exactly what they held. The readable copy is a NEW field beside them, and
 *   the tests below check that nothing overwrote the old one, because doing so
 *   would silently disable duplicate detection.
 *
 * ── THE CSV NEVER HELD A NUMBER AT ALL ──────────────────────────────────────
 *
 *   Its "BVN" and "NIN" columns were `data.bvn ? "Provided" : "No"` — the
 *   literal word, never a value — and the voter's card had no column. That one
 *   is not a cryptography problem: the voter's card was never hashed, so it has
 *   been readable the whole time and simply was not exported.
 *
 * ── FAILING SAFE IS THE WHOLE RISK IN THIS CHANGE ───────────────────────────
 *
 *   Encryption needs a key. Without KYC_ENCRYPTION_KEY the module stores no
 *   ciphertext, reports `no-key`, and does NOT fall back to plaintext and does
 *   NOT throw — a submission behaves exactly as it does today. Refusing
 *   submissions over a missing environment variable would close WAVE
 *   registration, which is far worse than the defect being fixed.
 *
 * ── AND THE NUMBERS ARE GATED LIKE THE BANK DETAILS ─────────────────────────
 *
 *   Decryption happens on the SERVER, behind the same mayRevealMemberPii gate
 *   that withholds account numbers (#535) — resolved against LIVE roles, not
 *   the token's copy. Sending ciphertext to the browser and decrypting there
 *   would put the key in a bundle.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the readable copy written over `nin` instead of beside it     KILLED
 *     storeKycNumber falling back to plaintext with no key          KILLED
 *     a blank number hashed to sha256("") instead of null           KILLED
 *     revealKycNumber reporting a legacy row as "not provided"      KILLED
 *     the CSV reverted to the word "Provided"                       KILLED
 *     the PII gate dropped from the CSV columns                     KILLED
 *     the readable copy dropped from the resubmit path              KILLED
 *     reword this header                                  SURVIVED, intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { hashData } from '@/lib/security';
import {
    storeKycNumber, kycReadableField, revealKycNumber, revealedIdentityFields,
    maskKycNumber, kycEncryptionKey, ENCRYPTED_SUFFIX,
} from '@/lib/kyc-identity-store';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const NIN = '22107458391';
const KEY = 'a-test-key-that-is-long-enough-000000';

let savedKey: string | undefined;
beforeEach(() => { savedKey = process.env.KYC_ENCRYPTION_KEY; });
afterEach(() => {
    if (savedKey === undefined) delete process.env.KYC_ENCRYPTION_KEY;
    else process.env.KYC_ENCRYPTION_KEY = savedKey;
});

const withKey = () => { process.env.KYC_ENCRYPTION_KEY = KEY; };
const withoutKey = () => { delete process.env.KYC_ENCRYPTION_KEY; };

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — the number can be read back', () => {
    it('A STORED NUMBER COMES BACK AS THE MEMBER TYPED IT', () => {
        //   THE test. Before this, the only stored form was a digest.
        withKey();
        const row = { nin: hashData(NIN), ...kycReadableField('nin', NIN) };

        const out = revealKycNumber(row, 'nin');
        expect(out.state).toBe('readable');
        expect(out.value).toBe(NIN);
        expect(out.label).toBe(NIN);
    });

    it('AND THE HASH IS STILL THERE, UNCHANGED', () => {
        /*
         *   findConflictingApplication queries `.where("nin", "==",
         *   hashData(nin))`. If the readable copy had been written over `nin`,
         *   duplicate detection would stop matching anything — silently, and in
         *   the permissive direction, which is the dangerous one.
         */
        withKey();
        const row = { nin: hashData(NIN), ...kycReadableField('nin', NIN) };

        expect(row.nin).toBe(hashData(NIN));
        expect(row.nin).toHaveLength(64);
        //   the readable copy lives under its own key
        expect(row[`nin${ENCRYPTED_SUFFIX}` as keyof typeof row]).toBeDefined();
        expect(row[`nin${ENCRYPTED_SUFFIX}` as keyof typeof row]).not.toBe(NIN);
    });

    it('AND THE CIPHERTEXT IS NOT THE NUMBER IN DISGUISE', () => {
        //   A "readable copy" that is just the number would be plaintext PII in
        //   the database, which is worse than what it replaces.
        withKey();
        const { encrypted } = storeKycNumber(NIN);

        expect(encrypted).not.toBeNull();
        expect(encrypted).not.toContain(NIN);
    });

    it('two encryptions of one number differ, so the field is not a lookup table', () => {
        //   AES-GCM with a random IV. Identical ciphertext for identical input
        //   would let anyone with read access confirm a guessed NIN by
        //   comparing, which is the property hashing has and encryption
        //   should not.
        withKey();
        expect(storeKycNumber(NIN).encrypted).not.toBe(storeKycNumber(NIN).encrypted);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — it fails safe, in both directions', () => {
    it('WITH NO KEY, NOTHING IS STORED — and nothing is stored in the clear', () => {
        withoutKey();
        const fields = kycReadableField('nin', NIN);

        expect(kycEncryptionKey()).toBeNull();
        expect(fields).toEqual({});
        //   the vital half: no plaintext fallback
        expect(JSON.stringify(fields)).not.toContain(NIN);
    });

    it('AND THE SUBMISSION IS NOT REFUSED', () => {
        //   A throw here would close WAVE registration over a missing
        //   environment variable. The hash is still produced, so the write and
        //   the duplicate check behave exactly as they do today.
        withoutKey();
        expect(() => storeKycNumber(NIN)).not.toThrow();
        expect(storeKycNumber(NIN).hash).toBe(hashData(NIN));
    });

    it('A BLANK NUMBER IS NULL, NOT THE HASH OF THE EMPTY STRING', () => {
        /*
         *   sha256("") is one constant. Storing it would make every applicant
         *   who gave no number a duplicate of every other, and the duplicate
         *   check would refuse them all. The existing writers were careful
         *   about this and so is the helper.
         */
        withKey();
        for (const blank of ['', '   ', null, undefined]) {
            const { hash, encrypted } = storeKycNumber(blank as any);
            expect(hash).toBeNull();
            expect(encrypted).toBeNull();
        }
    });

    it('a row stored with the key cannot be read without it, and says so', () => {
        withKey();
        const row = { nin: hashData(NIN), ...kycReadableField('nin', NIN) };

        withoutKey();
        const out = revealKycNumber(row, 'nin');
        expect(out.state).toBe('no-key');
        expect(out.value).toBeNull();
        expect(out.label).toMatch(/KYC_ENCRYPTION_KEY/);
    });

    it('and a ciphertext from a DIFFERENT key is reported, not thrown', () => {
        withKey();
        const row = { nin: hashData(NIN), ...kycReadableField('nin', NIN) };

        process.env.KYC_ENCRYPTION_KEY = 'a-completely-different-key-0000000000';
        const out = revealKycNumber(row, 'nin');
        expect(out.state).toBe('unreadable');
        expect(out.value).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — a legacy row is told apart from an empty one', () => {
    it('A HASH WITH NO READABLE COPY IS "legacy-hash-only", NOT "not-provided"', () => {
        /*
         *   The distinction the reviewer needs. "Not provided" would say the
         *   member skipped the field; what actually happened is that she gave a
         *   number and the platform kept only a digest of it. Collapsing the
         *   two would misreport a KYC record.
         */
        withKey();
        const out = revealKycNumber({ nin: hashData(NIN) }, 'nin');

        expect(out.state).toBe('legacy-hash-only');
        expect(out.value).toBeNull();
        //   and the message says it is permanent, so nobody hunts for a decoder
        expect(out.label).toMatch(/cannot be displayed/i);
    });

    it('AND AN ABSENT NUMBER IS "not-provided"', () => {
        withKey();
        expect(revealKycNumber({}, 'nin').state).toBe('not-provided');
        expect(revealKycNumber({ nin: null }, 'nin').state).toBe('not-provided');
        expect(revealKycNumber({ nin: '' }, 'nin').state).toBe('not-provided');
    });

    it('THE DIGEST IS NEVER OFFERED AS THE VALUE', () => {
        //   The defect itself, asserted directly: whatever comes back for a
        //   legacy row, it is not sixty-four hex characters presented as a NIN.
        withKey();
        const digest = hashData(NIN);
        const out = revealKycNumber({ nin: digest }, 'nin');

        expect(out.value).not.toBe(digest);
        expect(out.label).not.toBe(digest);
        expect(out.label).not.toMatch(/^[0-9a-f]{64}$/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — the voter\'s card was never hashed and needs no key', () => {
    it('IT IS READABLE WITH NO KEY CONFIGURED AT ALL', () => {
        withoutKey();
        const out = revealedIdentityFields({ votersCardNumber: '90F5B123456789012345' });

        expect(out.votersCardNumberDisplay).toBe('90F5B123456789012345');
    });

    it('and both of its stored spellings are read', () => {
        //   The WAVE row calls it votersCardNumber; the KYC record calls it
        //   votersCard. A reader that knows one of them reports the other as
        //   missing, which is how a field that was always there looks absent.
        withoutKey();
        expect(revealedIdentityFields({ votersCard: 'VIN123456789' }).votersCardNumberDisplay)
            .toBe('VIN123456789');
    });

    it('and the display keys do not collide with the hashed ones', () => {
        //   `ninNumber`, not `nin` — overwriting `nin` on the way to the screen
        //   would make the row mean two different things depending on where it
        //   is read.
        withKey();
        const out = revealedIdentityFields({ nin: hashData(NIN), ...kycReadableField('nin', NIN) });

        expect(out.ninNumber).toBe(NIN);
        expect(Object.keys(out)).not.toContain('nin');
        expect(Object.keys(out)).not.toContain('bvn');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — the masked form', () => {
    it('keeps the ends and hides the middle', () => {
        expect(maskKycNumber(NIN)).toBe('2210****391');
        expect(maskKycNumber(NIN)).toHaveLength(NIN.length);
    });

    it('and returns a too-short value unchanged rather than inventing characters', () => {
        expect(maskKycNumber('123')).toBe('123');
        expect(maskKycNumber('')).toBe('');
        expect(maskKycNumber(null)).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — every write site carries the readable copy', () => {
    const wave = () => stripComments(read('src/app/actions/wave/_wv_applications.ts'));

    it('ALL FOUR OF THEM, submit and resubmit, application row and user record', () => {
        /*
         *   Four sites write these two numbers. A readable copy on three of
         *   them is this audit's most repeated finding — a correct rule applied
         *   to some of the places it names — and the one that would be missed
         *   is the resubmit path, which is how a member CORRECTS a number.
         */
        const src = wave();
        const bvn = (src.match(/kycReadableField\('bvn'/g) ?? []).length;
        const nin = (src.match(/kycReadableField\('nin'/g) ?? []).length;

        expect(bvn).toBe(4);
        expect(nin).toBe(4);
    });

    it('AND THE HASH WRITES ARE UNTOUCHED', () => {
        //   The vacuity guard, and the safety one: this finding adds a field
        //   and changes none. Twelve hash writes existed before it.
        const src = wave();
        const hashes = (src.match(/hashData\(applicant(Nin|Bvn)\)/g) ?? []).length;

        expect(hashes).toBeGreaterThanOrEqual(12);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — the CSV carries numbers, behind the PII gate', () => {
    const csv = () => stripComments(read('src/app/api/admin/export/users/route.ts'));

    it('THE COLUMNS NO LONGER CONTAIN THE WORD "Provided"', () => {
        const src = csv();

        expect(src).not.toMatch(/data\.bvn \? "Provided"/);
        expect(src).not.toMatch(/\(data\.kyc\?\.nin \|\| data\.nin\) \? "Provided"/);
        expect(src).toMatch(/identity\.ninNumber/);
        expect(src).toMatch(/identity\.bvnNumber/);
    });

    it('AND THE VOTER\'S CARD HAS A COLUMN AT ALL', () => {
        const src = csv();

        expect(src).toMatch(/Voter's Card/);
        expect(src).toMatch(/identity\.votersCardNumberDisplay/);
    });

    it('AND THE NUMBERS ARE GATED ON LIVE ROLES, like the bank details', () => {
        /*
         *   #535's rule. The route's own gate reads the TOKEN's roles, which
         *   outlive a revocation; this file now carries real identity numbers,
         *   so it asks the same question the bank-detail lists ask.
         */
        const src = csv();

        expect(src).toMatch(/mayRevealMemberPii\("users:export"\)/);
        expect(src).toMatch(/mayRevealIdentity\s*\n?\s*\?/);
        expect(src).toMatch(/WITHHELD_IDENTITY/);
    });

    it('and the header count still matches the row count', () => {
        //   A column added to one and not the other shifts every value right of
        //   it — so the "NIN" column would print a state code and nobody would
        //   necessarily notice.
        /*
         *   COMMENTS STRIPPED FIRST. The first draft counted quotes in the raw
         *   file and reported 26 columns, because the comment explaining this
         *   finding sits beside the array and itself quotes the word "BVN".
         *   The #741 trap again — an assertion reading the prose rather than
         *   the code.
         */
        const src = stripComments(read('src/app/api/admin/export/users/route.ts'));
        const headers = src.split('const headers = [')[1].split('];')[0];
        const headerNames = [...headers.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);

        expect(headerNames).toHaveLength(20);
        //   and the three the owner named are among them, in the right order
        expect(headerNames.slice(7, 12)).toEqual([
            'BVN', 'BVN Verified', 'NIN', 'NIN Verified', "Voter's Card",
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#779 — the key never reaches the browser', () => {
    it('THE ADMIN LIST DECRYPTS ON THE SERVER, BEHIND THE SAME GATE AS BANK DETAILS', () => {
        const src = stripComments(read('src/app/actions/wave/_wv_admin_applications.ts'));

        expect(src).toMatch(/revealedIdentityFields\(app\)/);
        //   gated, not unconditional
        expect(src).toMatch(/maySeeBankDetails \? revealedIdentityFields\(app\) : \{\}/);
    });

    it('AND THE DIGEST IS NO LONGER RENDERED AT ALL', () => {
        /*
         *   The modal iterates the row generically, so adding the readable
         *   number puts it BESIDE the hash rather than in place of it — the
         *   admin would then see the number and, underneath, the same sixty-four
         *   characters that prompted the report. The hashed and encrypted forms
         *   are excluded from display; they stay on the row, because the
         *   duplicate check reads them.
         */
        const src = stripComments(read('src/components/admin/DynamicDetailModal.tsx'));
        const exclude = src.split('const defaultExclude = [')[1].split('];')[0];

        for (const hidden of ['"nin"', '"bvn"', '"ninEncrypted"', '"bvnEncrypted"']) {
            expect(exclude).toContain(hidden);
        }
    });

    it('AND NO CLIENT COMPONENT READS THE KEY OR DECRYPTS', () => {
        //   Doing either in a "use client" file would ship the key, or the
        //   means to use it, to every visitor.
        for (const p of [
            'src/components/admin/DynamicDetailModal.tsx',
            'src/app/admin/wave/applications/page.tsx',
        ]) {
            const src = read(p);
            expect(src).not.toMatch(/KYC_ENCRYPTION_KEY/);
            expect(src).not.toMatch(/decryptData|revealKycNumber\(/);
        }
    });
});
