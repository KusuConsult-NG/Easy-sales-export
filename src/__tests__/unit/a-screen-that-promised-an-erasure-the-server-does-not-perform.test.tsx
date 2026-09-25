/**
 * @jest-environment jsdom
 */

/**
 *   #916 THE DELETE-MY-ACCOUNT SCREEN PROMISED AN ERASURE THE SERVER DOES NOT
 *   PERFORM.
 *
 *   Found auditing src/components/profile/DeleteAccountSection.tsx, one of the
 *   files no test had named. It is a careful component — the server decides
 *   everything, the blocking reason is shown verbatim rather than invented, the
 *   confirmation is typed. What it said to the person was wrong.
 *
 *   IT TOLD THEM, VERBATIM:
 *
 *       "This permanently removes your name, email, phone number, address, bank
 *        details and identity documents. It cannot be undone, and support cannot
 *        restore them afterwards."
 *
 *   WHAT ACTUALLY HAPPENS, and both halves are deliberate owner decisions
 *   recorded in lib/user-erasure:
 *
 *     #530  "the users profile should still be saved even after they delete
 *            their profile so admin can use it for audit incase of fraud etc."
 *            — the owner's words. A full profile copy, credentials stripped, is
 *            written to COLLECTIONS.ERASURE_RETENTION with
 *            `basis: "fraud_prevention"`. The action does it at user.ts:247.
 *
 *     #292  Nothing is deleted on Cloudinary or anywhere else. Measured, and
 *            asserted below: no destroy call exists in this codebase. So the ID
 *            scan, passport photo and proof of address survive untouched and,
 *            per #280, publicly readable with no expiry — and the retention
 *            record keeps the links to them.
 *
 *   So of the screen's two sentences: "permanently" was wrong, "identity
 *   documents" was wrong, and "support cannot restore them afterwards" was the
 *   exact opposite of the truth, since the copy is kept so that somebody CAN
 *   consult it.
 *
 * ── WHY THE FIX IS THE WORDING AND NOT THE RETENTION ────────────────────────
 *
 *   The retention is defensible: a named lawful basis, a stated scope, a
 *   server-only collection under RLS with no policies, and credentials excluded
 *   by stripSecrets — user-erasure's header argues all of it and says the
 *   exclusion "is not the owner's to waive by implication". Telling the data
 *   subject the opposite of it is not defensible, and it is the part that costs
 *   nothing to put right.
 *
 *   So the retention stays exactly as the owner set it, nothing starts being
 *   deleted, and the screen says what is true: the details leave the account and
 *   the person disappears from the platform; a private copy is kept for fraud
 *   review; already-uploaded files are not deleted from the service that stores
 *   them; passwords and second factors are never kept; and here is an address to
 *   ask at.
 *
 *   The component's own HEADER was stale in the same direction and by the same
 *   mechanism — it said the action "deletes … the wallet", which #300 changed to
 *   marked-never-dropped. Corrected with it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ERASED_FIELDS, userErasurePatch } from '@/lib/user-erasure';

const ROOT = process.cwd();
const SCREEN = 'src/components/profile/DeleteAccountSection.tsx';

const source = () => readFileSync(join(ROOT, SCREEN), 'utf8');
const code = () => stripComments(source(), { label: SCREEN, minRetainedRatio: 0.2 });

/** The prose the person actually reads, comments and class names aside. */
function visibleCopy(): string {
    return code()
        //   JSX text only: drop attributes, so a className containing "red" or a
        //   route in an href cannot satisfy a claim about the wording.
        .replace(/className="[^"]*"/g, '')
        .replace(/\s+/g, ' ');
}

describe('#916 — the screen no longer promises what the server does not do', () => {
    it('THE CONTROL: the copy is still there to be read', () => {
        //   First. Every assertion below is about prose, and several are
        //   `not.toContain` — which pass on an empty string.
        const copy = visibleCopy();

        expect(copy).toContain('Delete my account');
        expect(copy).toContain('bank details');
        expect(copy.length).toBeGreaterThan(1_500);
    });

    it('IT DOES NOT CLAIM THE DELETION IS PERMANENT OR UNRESTORABLE', () => {
        //   The three false claims, each gone. Comments stripped first: the
        //   header above quotes the old sentence in full to explain the finding,
        //   and an unstripped read finds that quotation and reports the defect
        //   as still present. Sixth time in this audit.
        const copy = visibleCopy();

        expect(copy).not.toMatch(/permanently removes/i);
        expect(copy).not.toMatch(/support cannot restore/i);
        expect(copy).not.toMatch(/cannot be undone/i);
    });

    it('AND IT DISCLOSES THE RETAINED COPY AND ITS PURPOSE', () => {
        const copy = visibleCopy();

        expect(copy).toMatch(/a copy of your profile is held/i);
        //   Why it is kept. A retention disclosed without its purpose is the
        //   thing a regulator objects to — user-erasure's own argument, applied
        //   to the sentence the person reads rather than only to the record.
        expect(copy).toMatch(/fraud/i);
    });

    it('AND THAT UPLOADED FILES ARE NOT DELETED FROM STORAGE', () => {
        const copy = visibleCopy();

        expect(copy).toMatch(/are not deleted/i);
        expect(copy).toMatch(/ID scan|passport photograph/i);
    });

    it('and that credentials are never retained', () => {
        //   stripSecrets guarantees it and the retention test asserts it. Worth
        //   saying to the person, because "a copy of your profile is kept" reads
        //   worse than it is if they assume it includes their password.
        expect(visibleCopy()).toMatch(/password and any two-factor codes are never kept/i);
    });

    it('and it gives them somewhere to ask', () => {
        //   A disclosure with no address is a notice, not a right.
        expect(visibleCopy()).toMatch(/info@easysalesexport\.com/);
    });

    it('it still says what IS true — the details leave the account', () => {
        //   The fix must not have softened the screen into saying nothing. The
        //   scrub is real: userErasurePatch empties every field in ERASED_FIELDS
        //   and the person vanishes from every screen and export.
        const copy = visibleCopy();

        expect(copy).toMatch(/are removed from your account/i);
        expect(copy).toMatch(/no longer appear on any/i);
        expect(copy).toMatch(/cannot undo this yourself/i);
    });

    it('and every field it names by hand is one the PATCH really acts on', () => {
        /*
         *   The other way this copy could lie: naming a field the erasure does
         *   not touch.
         *
         *   Checked against userErasurePatch — what the action actually applies —
         *   and NOT against ERASED_FIELDS alone. The first draft of this test did
         *   the latter and failed on `email`, correctly: `email` is not in the
         *   delete list because user-erasure REPLACES it rather than dropping it
         *   ("several screens read them unconditionally and would render
         *   'undefined'"). The patch is the honest denominator; the list is one
         *   half of it.
         */
        const patch = userErasurePatch('uid-under-test');
        const named: Record<string, string> = {
            name: 'firstName',
            email: 'email',
            'phone number': 'phone',
            address: 'address',
            'bank details': 'bankDetails',
            'identity numbers': 'nin',
        };

        const copy = visibleCopy();
        for (const [phrase, field] of Object.entries(named)) {
            expect({ phrase, inCopy: copy.toLowerCase().includes(phrase) }).toEqual({ phrase, inCopy: true });
            expect({ field, inPatch: Object.prototype.hasOwnProperty.call(patch, field) })
                .toEqual({ field, inPatch: true });
        }
    });

    it('and the two that are REPLACED rather than deleted really are', () => {
        //   The nuance the failure above surfaced, asserted rather than papered
        //   over: a screen reading `email` unconditionally gets a placeholder,
        //   not undefined — which is why the copy says "removed from your
        //   account" rather than claiming the row no longer has the key.
        const patch = userErasurePatch('uid-under-test');

        expect(ERASED_FIELDS as readonly string[]).not.toContain('email');
        expect(ERASED_FIELDS as readonly string[]).not.toContain('fullName');
        expect(typeof patch.email).toBe('string');
        expect(String(patch.email)).not.toContain('uid-under-test@real');
        expect(patch.fullName).toBeDefined();

        //   And a field that IS on the delete list is emptied rather than
        //   replaced with a placeholder somebody could mistake for data.
        expect(ERASED_FIELDS as readonly string[]).toContain('bankAccountNumber');
    });
});

describe('#916 — the premise the new copy rests on', () => {
    it('NOTHING IN THIS CODEBASE DESTROYS A STORED ASSET', () => {
        /*
         *   The screen now tells people their uploaded files are not deleted. If
         *   that ever stops being true the sentence becomes a different kind of
         *   wrong, so the premise is pinned here rather than trusted.
         *
         *   Comments are stripped because the codebase is full of notes SAYING
         *   nothing is destroyed — MasterUploader, _legacy, this component's own
         *   header. A raw scan finds those and reports a destroy call that does
         *   not exist.
         */
        const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');

        function walk(dir: string, out: string[] = []): string[] {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'node_modules') walk(full, out);
                } else if (/\.tsx?$/.test(full)) {
                    out.push(full);
                }
            }
            return out;
        }

        const offenders: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = file.slice(ROOT.length + 1);
            if (/__tests__|\.test\./.test(rel)) continue;

            const src = stripComments(readFileSync(file, 'utf8'), { label: rel });
            //   A Cloudinary delete is `/destroy` on the upload API, or the
            //   SDK's uploader.destroy(). Either would make the copy wrong.
            if (/cloudinary[^\n]*\/destroy|uploader\.destroy\s*\(|\.destroy\s*\(\s*['"][^'"]*public_id/i.test(src)) {
                offenders.push(rel);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL: that pattern matches a real destroy call', () => {
        const pattern = /cloudinary[^\n]*\/destroy|uploader\.destroy\s*\(/i;

        expect(pattern.test('await fetch(`https://api.cloudinary.com/v1_1/x/image/destroy`)')).toBe(true);
        expect(pattern.test('await cloudinary.uploader.destroy(publicId)')).toBe(true);
        //   And does not match an upload, which is all this codebase has.
        expect(pattern.test('await fetch(`https://api.cloudinary.com/v1_1/x/image/upload`)')).toBe(false);
    });

    it('AND THE ACTION REALLY WRITES THE RETENTION RECORD', () => {
        //   The other premise: the copy says a profile copy is kept. It is, at
        //   actions/user.ts, into a collection whose name says what it is.
        const action = stripComments(readFileSync(join(ROOT, 'src/app/actions/user.ts'), 'utf8'), {
            label: 'actions/user.ts',
            minRetainedRatio: 0.2,
        });

        expect(action).toContain('COLLECTIONS.ERASURE_RETENTION');
        expect(action).toContain('erasureRetentionRecord(');
    });

    it('and the wallet is marked rather than dropped, as the header now says', () => {
        //   The stale header claim, pinned the right way round. #300's change is
        //   what makes "deletes … the wallet" wrong.
        const action = stripComments(readFileSync(join(ROOT, 'src/app/actions/user.ts'), 'utf8'), {
            label: 'actions/user.ts',
            minRetainedRatio: 0.2,
        });

        expect(action).not.toMatch(/WALLETS\)\.doc\([^)]*\)\.delete\(\)/);
        expect(code()).not.toMatch(/deletes KYC records, seller verification and the\s*\*?\s*wallet/);
    });
});
