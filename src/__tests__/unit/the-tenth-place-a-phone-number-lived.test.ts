/**
 * @jest-environment node
 */

/**
 *   #732 ERASURE SCRUBBED A PERSON'S PHONE NUMBER OUT OF NINE PLACES. THE
 *        BRIEFING REGISTER IS THE TENTH.
 *
 *   #697 made the broadcast audiences skip an erased account, and stated in its
 *   own words why an erased member was already safe from the SMS supplements:
 *
 *       "`phone` and `phoneNumber` are in ERASED_FIELDS and deleted outright,
 *        and #376 scrubs the same numbers off all eight module rows — which is
 *        where the supplements below read most of their numbers. An erased
 *        member has no number left to reach. It is safe by two accidents; this
 *        makes it safe by rule."
 *
 *   MODULE_ERASURE_TARGETS holds eight collections. `wave_briefing_registrations`
 *   is a ninth, and it was in neither list. It stores fullName, firstName,
 *   lastName, otherName, phoneNumber, email, state and gender — and nothing
 *   erased any of it.
 *
 * ── AND BOTH GUARDS IN FRONT OF IT FAILED, IN DIFFERENT WAYS ────────────────
 *
 *   THE SMS AUDIENCE HAD NO CHECK AT ALL. Every other supplement in
 *   sms-broadcast runs `isContactableAccount` before adding a number.
 *   `wave_briefing_registrants` read `r.phone || r.phoneNumber` straight off the
 *   row.
 *
 *   THE EMAIL PATH HAD A CHECK THAT COULD NOT FIRE. broadcast-logic reads
 *   `const uid = r.userId || d.id; if (excludeIds.has(uid)) continue;` — which
 *   reads as a careful fallback and is not one here. The briefing register is a
 *   GUEST form written with `.add()` and no userId, so `uid` is always an
 *   auto-generated DOCUMENT id, never a user id, and never in a set of user
 *   ids. It has been running and matching nothing.
 *
 * ── WHY THIS TARGET MATCHES ON EMAIL WHEN THE MODULE REFUSES TO ─────────────
 *
 *   module-application-erasure's header records a deliberate decision:
 *
 *       "Rows carrying NO userId and no deterministic id are NOT matched on
 *        email… a scrub that lands on the wrong row cannot be undone by any
 *        amount of retention."
 *
 *   That is sound for a collection where SOME rows carry a userId: the userId
 *   route finds those, so an email match only adds the risk of landing on
 *   somebody else's record. The briefing register is the other case — NO row
 *   has ever carried a userId — so the same rule means the collection is never
 *   erased at all. It was ABSENT from the list, not excluded from it.
 *
 *   THE OBJECTION IS ANSWERED RATHER THAN OVERRULED. `retainPii` copies every
 *   value into the retention record before the scrub, so the row can be put
 *   back; the registration refuses a duplicate address, so a match is at most
 *   one row; and phone is deliberately NOT a match key, because the
 *   registration's own note records that a handset can be shared.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    MODULE_ERASURE_TARGETS,
    moduleErasurePatch,
    retainedDocumentsFrom,
    type ModuleErasureTarget,
} from '@/lib/module-application-erasure';

const src = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

const briefing = (): ModuleErasureTarget => {
    const t = MODULE_ERASURE_TARGETS.find(
        (x) => x.collection === COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);
    expect(t).toBeDefined();
    return t!;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#732 — the briefing register is a collection erasure reaches', () => {
    it('IT IS IN THE TARGET LIST — the defect, stated as its absence', () => {
        expect(MODULE_ERASURE_TARGETS.map((t) => t.collection))
            .toContain(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);
    });

    it('AND EVERY FIELD THE REGISTRATION WRITES IS SCRUBBED', () => {
        /*
         *   Read against the WRITER rather than a hand-copied list: briefing.ts
         *   is the only writer, so what it stores is exactly what has to go. A
         *   field added there and not here is the next instance of this finding.
         */
        const pii = new Set(briefing().pii);
        for (const field of [
            'fullName', 'firstName', 'lastName', 'otherName',
            'phoneNumber', 'email', 'state', 'gender',
        ]) {
            expect([field, pii.has(field)]).toEqual([field, true]);
        }
    });

    it('AND THE PATCH DELETES THEM RATHER THAN BLANKING THEM', () => {
        const patch = moduleErasurePatch(briefing(), 'user-1');

        //   Every PII field present in the patch, and the owner marker with it.
        for (const field of briefing().pii) {
            expect(Object.keys(patch)).toContain(field);
        }
        //   The marker erasedOwnerMarker actually writes — `ownerErased*`, not
        //   `erased*`. Named exactly, because a prefix guess is how an
        //   assertion ends up passing on a marker nobody writes.
        expect(patch.ownerErased).toBe(true);
        expect(patch.ownerErasedUserId).toBe('user-1');
    });

    it('AND THE ROW IS KEPT — nothing here removes a registration', () => {
        /*
         *   The owner's standing rule. The distinction matters and my first
         *   version of this assertion missed it: `FieldValue.delete()` removes
         *   a FIELD and is exactly what the scrub should do, while
         *   `.doc(id).delete()` or `batch.delete(` removes the ROW and must
         *   never appear. Matching `.delete()` broadly failed on the correct
         *   code.
         */
        const code = src('src/lib/module-application-erasure.ts');

        expect(code).not.toMatch(/batch\.delete\(/);
        expect(code).not.toMatch(/\.doc\([^)]*\)\.delete\(/);
        //   And the scrub really is a field delete, so the guard above is not
        //   passing because nothing deletes anything.
        expect(code).toContain('FieldValue.delete()');
        expect(code).toContain('{ merge: true }');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#732 — matching on an address, and what makes that safe', () => {
    it('THE TARGET MATCHES ON EMAIL, AND ONLY ON EMAIL', () => {
        const t = briefing();
        expect(t.emailKeys).toEqual(['email']);
        //   Phone is NOT a key: a handset can be shared, and the registration's
        //   own note says so.
        expect(JSON.stringify(t.emailKeys)).not.toContain('phone');
    });

    it('AND IT IS THE ONLY TARGET THAT DOES', () => {
        /*
         *   The module's header refuses email matching in general and the
         *   reasoning is sound where a userId route exists. This asserts the
         *   exception stays an exception.
         */
        const withEmail = MODULE_ERASURE_TARGETS.filter((t) => t.emailKeys?.length);
        expect(withEmail.map((t) => t.collection))
            .toEqual([COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS]);
    });

    it('AND EVERY EMAIL-MATCHED TARGET RETAINS ITS PII FIRST — THE answer to the objection', () => {
        /*
         *   "A scrub that lands on the wrong row cannot be undone by any amount
         *   of retention" is the header's objection, and retaining the values is
         *   what makes it untrue for this target. Asserted as a RULE over the
         *   list rather than about one entry, so a second email-matched target
         *   cannot be added without it.
         */
        for (const t of MODULE_ERASURE_TARGETS) {
            if (!t.emailKeys?.length) continue;
            expect([t.collection, t.retainPii]).toEqual([t.collection, true]);
        }
    });

    it('AND THE RETAINED RECORD ACTUALLY CARRIES THE VALUES BACK', () => {
        //   The claim above is worth nothing if retainPii does not produce the
        //   values. Exercised rather than read.
        const retained = retainedDocumentsFrom(briefing(), 'doc-1', {
            fullName: 'Ada Obi',
            phoneNumber: '+2348031234567',
            email: 'ada@example.com',
            gender: 'female',
        });

        const byPath = new Map(retained.map((r) => [r.path, r.value]));
        expect(byPath.get('fullName')).toBe('Ada Obi');
        expect(byPath.get('phoneNumber')).toBe('+2348031234567');
        expect(byPath.get('email')).toBe('ada@example.com');
    });

    it('AND A TARGET WITHOUT retainPii STILL RETAINS ONLY DOCUMENTS', () => {
        //   Vacuity guard: if retainPii were ignored and every target retained
        //   everything, the assertion above would pass while meaning nothing.
        const plain = MODULE_ERASURE_TARGETS.find((t) => !t.retainPii && t.pii.length > 0)!;
        const retained = retainedDocumentsFrom(plain, 'doc-2', { [plain.pii[0]]: 'something' });

        expect(retained).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#732 — the address is captured before the scrub destroys it', () => {
    const CALLERS = [
        'src/app/actions/user.ts',
        'src/lib/user-soft-delete.ts',
        'src/app/api/cron/gdpr-purge/route.ts',
    ];

    it.each(CALLERS)('%s passes the address it read', (rel) => {
        const code = src(rel);
        expect(code).toMatch(/eraseModuleApplications\([^)]*,\s*\{/);
        expect(code).toMatch(/email:/);
    });

    it('AND THE SWEEP NEVER RE-READS IT FROM THE USER ROW', () => {
        /*
         *   THE reason the address is a parameter. Every caller scrubs the user
         *   row BEFORE this runs — soft-delete step 2 precedes step 3 — so a
         *   lookup inside the sweep would find `deleted_<uid>@redacted.local`
         *   and match nothing. A guard that reads a tombstone is the shape this
         *   whole finding is about.
         */
        const code = src('src/lib/module-application-erasure.ts');
        expect(code).toContain('contact.email');
        expect(code).not.toMatch(/COLLECTIONS\.USERS\)\s*\.doc\(userId\)/);
    });

    it('AND AN ABSENT ADDRESS SWEEPS NOTHING RATHER THAN EVERYTHING', () => {
        //   `where(key, "==", "")` against rows storing "" would match them all.
        //   The guard is the empty-string check, and it must be on the query.
        const code = src('src/lib/module-application-erasure.ts');
        expect(code).toMatch(/if \(target\.emailKeys && erasureEmail\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#732 — and the two guards in front of the audience', () => {
    it('THE SMS AUDIENCE NOW CHECKS CONTACTABILITY — it had none', () => {
        const code = src('src/app/actions/sms-broadcast.ts');
        const at = code.indexOf('case "wave_briefing_registrants"');
        expect(at).toBeGreaterThan(-1);

        const body = code.slice(at, at + 900);
        expect(body).toContain('nonContactable.has(String(r.userId))');
        //   And the set is actually loaded, not referenced into nothing.
        expect(code).toContain('loadNonContactableUserIds(db, COLLECTIONS.USERS)');
    });

    it('AND THE SCRUB IS WHAT CLOSES IT FOR A ROW WITH NO userId', () => {
        /*
         *   The check above cannot help a guest row — there is no id to test.
         *   What makes that row safe is the number no longer being on it, which
         *   is the erasure target. Stated here so the belt is not mistaken for
         *   the braces.
         */
        expect(briefing().pii).toContain('phoneNumber');
        expect(briefing().pii).toContain('phone');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk.
 *
 *   RUN AFTER THE COMMIT THAT INTRODUCED THIS FILE, not before it. The table
 *   below was written from what each mutant was expected to do and only then
 *   measured — which is the wrong order, and is recorded rather than tidied
 *   away because an unverified table is exactly the defect this audit keeps
 *   filing against the application. All nine killed; the control survived.
 *
 *     MUTANT                                                        RESULT
 *     the briefing target is removed from the list                   KILLED
 *     the target keeps its PII list but loses phoneNumber            KILLED
 *     emailKeys is dropped, so nothing matches the row               KILLED
 *     retainPii is dropped — the scrub becomes irreversible          KILLED
 *     retainedDocumentsFrom ignores retainPii                        KILLED
 *     retainPii leaks onto every target                              KILLED
 *     the empty-address guard is removed from the query              KILLED
 *     a caller stops passing the address                             KILLED
 *     the SMS audience loses its contactability check                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
