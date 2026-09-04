/**
 * @jest-environment node
 */

/**
 *   #371 RIGHT-TO-ERASURE STILL LEFT THE PERSON'S NAME, PHONE NUMBER AND WHOLE
 *        IDENTITY PROFILE ON THE ROW — BECAUSE #283 FIXED THE DUPLICATES IT
 *        COULD SEE, AND A NORMALISER MAKES MORE OF THEM ON EVERY WRITE.
 *
 *        #283's headline was: "on the fields the codebase stores twice, erasure
 *        removed the copy somebody thought of and left the copy added later."
 *        It found three such pairs by reading `interface User`. That was the
 *        wrong instrument, twice over.
 *
 *        (1) THE DUPLICATES ARE MANUFACTURED, NOT ACCIDENTAL. Every write to
 *            the user document goes through atomicUpdateUser, which calls
 *            normalizeUserUpdate. Three of that function's four rules are
 *            aliases — verified by running it, in the first describe below:
 *
 *                { phone }        ->  { phone, phoneNumber }
 *                { fullName }     ->  { fullName, name }
 *                { displayName }  ->  { displayName, name, fullName }
 *
 *            ERASED_FIELDS named `phone` and the patch replaced `fullName`.
 *            Neither `phoneNumber` nor `name` nor `displayName` appeared
 *            anywhere. So a completed erasure set fullName to "Redacted User"
 *            while `name` still held the person's real name, and deleted
 *            `phone` while `phoneNumber` still held their number — not through
 *            drift, but because a module whose entire job is "both keys always
 *            agree" had guaranteed the second copy was there.
 *
 *        (2) THE ROW CARRIES ROOTS THE TYPE DOES NOT DECLARE. saveKYCProfileAction
 *            fans one onboarding form into several nested roots by dot-path,
 *            and the three verify actions add the identity numbers:
 *
 *              kyc                  firstName, lastName, otherNames, fullName,
 *                                   dateOfBirth, phoneNumber, address, city,
 *                                   state, idType, idNumber — plus nin and bvn
 *                                   (hashed) and votersCard, which is stored in
 *                                   PLAINTEXT while its two siblings are hashed
 *              verificationProfile  firstName, lastName, fullName, dob, phone
 *              farmNation           farmNation.profile — profile and full name
 *              city                 a top-level field, written beside the flat
 *                                   residentialAddress that WAS erased
 *
 *            `interface User` declares none of them, so #283's ratchet —
 *            "every field on the User type is erased or deliberately kept" —
 *            was structurally incapable of raising any of it.
 *
 *        WHAT THIS FILE RATCHETS, AND WHY IT IS NOT ANOTHER LIST
 *        ------------------------------------------------------
 *        Two sweeps, each aimed at one of the two blind spots above:
 *
 *          - ALIAS CLOSURE. Every field the patch erases or replaces is fed
 *            through normalizeUserUpdate, and every key that comes back must
 *            also be erased or replaced. Adding an alias rule to the normaliser
 *            without telling erasure about it now fails here.
 *
 *          - DOTTED ROOTS. Every quoted `'root.sub':` write key in a file that
 *            writes to the user document must have its root either erased or
 *            named below as belonging elsewhere. A new nested root on the user
 *            row forces the decision instead of arriving silently.
 *
 *        RECORDED, NOT CHANGED
 *        ---------------------
 *        saveKYCProfileAction also copies the member's name, phone, state and
 *        address into academy_applications, cooperative_members,
 *        wave_applications, seller_verifications and
 *        export_onboarding_applications. userErasurePatch is a user-row patch
 *        and reaches none of them, and #300 settled that related rows are
 *        MARKED rather than scrubbed — but it applied that marking to three
 *        collections, and these five are not among them.
 *
 *        OWNER DECISION: what an erasure request should do to a module
 *        application row that holds a copy of the member's contact details —
 *        scrub it, mark it as #300 marks the other three, or leave it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ERASED_FIELDS, userErasurePatch } from '@/lib/user-erasure';
import { normalizeUserUpdate } from '@/lib/schema-normalizer';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

const KYC_ACTIONS = 'src/app/actions/kyc.ts';
const FN_ONBOARDING = 'src/app/actions/farm-nation/_fn_onboarding.ts';
const USER_SERVICE = 'src/lib/services/userService.ts';

const PATCH = userErasurePatch('u-1');

/** Erased outright, or replaced with a placeholder — either counts as handled. */
function handled(field: string): boolean {
    return field in PATCH;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#371 — handled() answers no as well as yes', () => {
    it('THE PREDICATE IS NOT A CONSTANT', () => {
        // Every other assertion in this file asks handled() for a `true`, so a
        // predicate stuck on `true` would satisfy all of them — mutant M24
        // walked straight through the first draft. `uid` and `roles` are the
        // documented keeps, so they are the pair that must answer false.
        expect(handled('uid')).toBe(false);
        expect(handled('roles')).toBe(false);
        expect(handled('nin')).toBe(true);
    });
});

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC = walk('src');

// ─────────────────────────────────────────────────────────────────────────────
describe('#371 — the normaliser makes the second copy, so erasure must name both', () => {
    it('THE ALIASES ARE REAL — measured by running normalizeUserUpdate', () => {
        // Not read off a comment. This is what the function actually returns,
        // and it is why `phoneNumber` and `name` were on every erased row.
        expect(Object.keys(normalizeUserUpdate({ phone: '0800' })).sort())
            .toEqual(['phone', 'phoneNumber']);
        expect(Object.keys(normalizeUserUpdate({ fullName: 'A B' })).sort())
            .toEqual(['fullName', 'name']);
        expect(Object.keys(normalizeUserUpdate({ displayName: 'A B' })).sort())
            .toEqual(['displayName', 'fullName', 'name']);
    });

    it('and every user write goes through it', () => {
        // The alias rules would be harmless if some other path wrote the row.
        const svc = code(USER_SERVICE);

        expect(svc).toMatch(/normalizeUserUpdate\(updates\)/);
        expect(svc).toMatch(/COLLECTIONS\.USERS/);
    });

    it('THE PHONE NUMBER IS ERASED UNDER BOTH SPELLINGS', () => {
        expect({ phone: handled('phone'), phoneNumber: handled('phoneNumber') })
            .toEqual({ phone: true, phoneNumber: true });
    });

    it('AND THE NAME IS REDACTED UNDER ALL THREE', () => {
        // fullName alone was redacted before, which left the real name on the
        // row under `name` — #283's own example of the defect, unfixed.
        expect(PATCH.fullName).toBe('Redacted User');
        expect(PATCH.name).toBe('Redacted User');
        expect(PATCH.displayName).toBe('Redacted User');
    });

    it('ALIAS CLOSURE: no erased field has an unhandled twin', () => {
        // The general form, so a new rule in normalizeUserUpdate cannot open
        // this hole again. Every key the normaliser derives from a handled
        // field must itself be handled.
        const leaks: Array<{ from: string; twin: string }> = [];

        for (const field of Object.keys(PATCH)) {
            for (const twin of Object.keys(normalizeUserUpdate({ [field]: 'x' }))) {
                if (!handled(twin)) leaks.push({ from: field, twin });
            }
        }

        expect(leaks).toEqual([]);
    });

    it('and the closure check is not vacuous — it sees the aliases', () => {
        // Guard from the other side: if normalizeUserUpdate were a no-op the
        // check above would pass for the wrong reason.
        const derived = Object.keys(normalizeUserUpdate({ phone: 'x' }));

        expect(derived.length).toBeGreaterThan(1);
        expect(derived).toContain('phoneNumber');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#371 — the nested roots the User type never declared', () => {
    it('THE WHOLE kyc OBJECT IS ERASED', () => {
        expect(handled('kyc')).toBe(true);
    });

    it('and so are verificationProfile, farmNation and the top-level city', () => {
        for (const f of ['verificationProfile', 'farmNation', 'city']) {
            expect({ f, erased: handled(f) }).toEqual({ f, erased: true });
        }
    });

    it('the kyc object really does hold a second identity profile', () => {
        // What made this worth erasing rather than tidying: the same personal
        // fields the flat list already removed, written again under a root the
        // list did not mention.
        const kyc = code(KYC_ACTIONS);

        for (const key of [
            "'kyc.firstName'", "'kyc.lastName'", "'kyc.dateOfBirth'",
            "'kyc.phoneNumber'", "'kyc.address'", "'kyc.idNumber'",
            "'kyc.nin'", "'kyc.bvn'", "'kyc.votersCard'",
        ]) {
            expect({ key, written: kyc.includes(key) }).toEqual({ key, written: true });
        }
    });

    it('RECORDED: the voter\'s card is stored in plaintext, its two siblings hashed', () => {
        // Not changed here — hashing it would break the manual review this
        // action explicitly defers to. Stated so the asymmetry is on the record.
        const kyc = code(KYC_ACTIONS);

        expect(kyc).toMatch(/'kyc\.nin':\s*nin\s*\?\s*hashData\(nin\)/);
        expect(kyc).toMatch(/'kyc\.bvn':\s*bvn\s*\?\s*hashData\(bvn\)/);
        expect(kyc).toMatch(/'kyc\.votersCard':\s*votersCardNumber/);
    });

    it('and farmNation.profile carries the member\'s name', () => {
        expect(code(FN_ONBOARDING)).toContain('"farmNation.profile"');
    });

    it('deleting the roots is safe: no reader dereferences kyc unguarded', () => {
        /**
         * `data.kyc?.bvnVerified` and friends. A bare `x.kyc.y` on a user row
         * would throw once the object is gone, which is the one way this fix
         * could hurt — so the claim is checked rather than assumed.
         *
         * Two shapes are legitimate and are not the hazard:
         *
         *   `u.kyc && u.kyc.phoneNumber`   guarded, just not with `?.`
         *   `finalData.kyc.documents…`     the EXPORT WIZARD'S OWN draft, a
         *                                  local object whose `kyc` key comes
         *                                  from KYCVerificationStep's onNext.
         *                                  Nothing on a user row, and nothing
         *                                  this patch touches.
         *
         * Every other bare dereference fails here.
         */
        const unguarded: string[] = [];

        for (const f of SRC) {
            const src = code(f);
            for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\.kyc\.[A-Za-z]/g)) {
                if (m[1] === 'finalData') continue;
                const line = src.slice(src.lastIndexOf('\n', m.index!) + 1,
                                       src.indexOf('\n', m.index!));
                if (line.includes(`${m[1]}.kyc &&`) || line.includes('.kyc?.')) continue;
                unguarded.push(`${f}: ${line.trim()}`);
            }
        }

        expect(unguarded).toEqual([]);
    });

    it('and the two exempted shapes really are the shapes claimed', () => {
        // Vacuity guard on the exemptions above: if either disappeared, the
        // exemption would be silently excusing something else.
        expect(code('src/app/actions/sms-broadcast.ts')).toContain('u.kyc && u.kyc.phoneNumber');
        expect(code('src/app/export/onboarding/page.tsx')).toContain('finalData.kyc.documents');
        // And finalData is the wizard's draft, not a user document.
        expect(code('src/app/export/onboarding/steps/KYCVerificationStep.tsx'))
            .toMatch(/onNext\(\{\s*kyc:/);
    });

    it('THE #283 RATCHET COULD NOT HAVE SEEN ANY OF THIS', () => {
        // The reason the finding survived a fix aimed at exactly its shape:
        // that ratchet enumerates `interface User`, and the User interface
        // declares none of the roots or aliases involved.
        const src = readFileSync(join(ROOT, 'src/lib/types/shared.ts'), 'utf-8');
        const start = src.indexOf('export interface User {');
        const body = src.slice(start, src.indexOf('\n}', start));

        expect(start).toBeGreaterThan(-1);
        for (const missing of [
            'kyc', 'verificationProfile', 'farmNation', 'city', 'phoneNumber', 'displayName',
        ]) {
            expect({ missing, onTheType: new RegExp(`^\\s{4}${missing}\\??\\s*:`, 'm').test(body) })
                .toEqual({ missing, onTheType: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#371 — DOTTED ROOTS: a new nested root cannot arrive unnoticed', () => {
    /**
     * Roots that belong to a DIFFERENT collection, written in a file that also
     * writes the user row. Listed rather than filtered out, because "which
     * document does this key land on" is the question the sweep exists to force.
     */
    const OTHER_COLLECTIONS: Record<string, string> = {
        personalInfo: 'academy_applications',
        profile: 'export_onboarding_applications',
    };

    function dottedRoots(): Map<string, string[]> {
        const roots = new Map<string, string[]>();

        for (const f of SRC) {
            const src = code(f);
            if (!src.includes('atomicUpdateUser') && !src.includes('COLLECTIONS.USERS')) continue;

            for (const m of src.matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z0-9_.]+['"]\s*:/g)) {
                const list = roots.get(m[1]) ?? [];
                if (!list.includes(f)) list.push(f);
                roots.set(m[1], list);
            }
        }

        return roots;
    }

    it('the sweep finds the dotted writes, so it is not vacuous', () => {
        const roots = dottedRoots();

        expect(roots.size).toBeGreaterThan(4);
        expect(roots.get('kyc')).toContain(KYC_ACTIONS);
        expect(roots.get('farmNation')).toContain(FN_ONBOARDING);
    });

    it('EVERY DOTTED ROOT IS ERASED OR ACCOUNTED FOR', () => {
        const unaccounted = [...dottedRoots().keys()]
            .filter((r) => !handled(r))
            .filter((r) => !(r in OTHER_COLLECTIONS));

        // If this fails, somebody started writing a new nested root beside a
        // user write. Say whether it is on the user row — in which case it is
        // erasable PII until argued otherwise — or on another collection.
        expect(unaccounted).toEqual([]);
    });

    it('and it is measured on code, not on prose', () => {
        // The #371 notes above and in lib/user-erasure.ts quote these very
        // paths. A raw-text sweep would attribute them to whichever file
        // happened to mention them — the tombstone trap, twelve times now.
        const raw = readFileSync(join(ROOT, 'src/lib/user-erasure.ts'), 'utf-8');

        expect(raw).toContain('farmNation.profile');
        expect(code('src/lib/user-erasure.ts')).not.toContain('farmNation.profile');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#371 — RECORDED: the module application rows are not reached', () => {
    it('saveKYCProfileAction copies the contact details into five collections', () => {
        const kyc = code(KYC_ACTIONS);

        // WORD-ANCHORED: `toContain` cannot tell WAVE_APPLICATIONS from
        // WAVE_APPLICATIONSX, and mutant M17 walked through the first draft.
        for (const collection of [
            'COLLECTIONS.ACADEMY_APPLICATIONS',
            'COLLECTIONS.COOPERATIVE_MEMBERS',
            'COLLECTIONS.WAVE_APPLICATIONS',
            'COLLECTIONS.SELLER_VERIFICATIONS',
            'COLLECTIONS.EXPORT_APPLICATIONS',
        ]) {
            expect({ collection, synced: new RegExp(`\\b${collection.replace('.', '\\.')}\\b`).test(kyc) })
                .toEqual({ collection, synced: true });
        }
    });

    it('and #300 marks only three rows, none of them an application', () => {
        // The gap, stated as the owner sees it. deleteAccountAction marks the
        // KYC verifications, the seller verification and the wallet; the five
        // above get neither a scrub nor a marker.
        const user = code('src/app/actions/user.ts');

        expect(user).toContain('COLLECTIONS.KYC_VERIFICATIONS');
        expect(user).toContain('COLLECTIONS.WALLETS');
        expect(user).not.toContain('COLLECTIONS.ACADEMY_APPLICATIONS');
        expect(user).not.toContain('COLLECTIONS.WAVE_APPLICATIONS');
    });

    it('the erasure module says so, so "not reached" is not read as "not there"', () => {
        expect(readFileSync(join(ROOT, 'src/lib/user-erasure.ts'), 'utf-8'))
            .toContain('#371');
    });
});
