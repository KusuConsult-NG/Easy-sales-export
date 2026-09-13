/**
 * @jest-environment node
 */

/**
 *   #704 A RATCHET THAT SAID "IF A FOURTH APPEARS, IT SHOULD FAIL THIS" AND
 *        COULD NOT SEE A FOURTH. ONE ALREADY EXISTED.
 *
 *   admin-deletion-uses-the-shared-scrub.test.ts carries this, verbatim:
 *
 *       it('ALL THREE deletion paths now build their patch from lib/user-erasure', ...)
 *       // The member's own path, and the two admin doors through the shared
 *       // operation. If a fourth appears, it should fail this rather than grow
 *       // a second implementation.
 *
 *   The body names three files and asserts each calls the shared helper. That
 *   is a fine thing to assert and it is NOT what the comment promises. A fourth
 *   door does not appear in a list it was never added to, so the test passes
 *   whatever a fourth door does.
 *
 *   AND A FOURTH ALREADY EXISTS. api/cron/gdpr-purge/route.ts writes
 *   `deleted: true` onto the user row. It is correct — it applies
 *   userErasurePatch, and #300's scrub-don't-destroy rule — but it is not in
 *   the list, so the ratchet's claim was already untrue when it was written.
 *
 * ── WHY THIS IS WORTH A FINDING WHEN NOTHING IS CURRENTLY BROKEN ────────────
 *
 *   Because a whole category of live safety rests on the coupling this was
 *   meant to hold, and rests on it INVISIBLY.
 *
 *   sms-broadcast.ts has twenty-two audience branches feeding one `add()`, and
 *   #697 put the erased-account check on TWO of them. The other twenty never
 *   ask. They are safe anyway, and the file says why:
 *
 *       "`phone` and `phoneNumber` are in ERASED_FIELDS and deleted outright,
 *        and #376 scrubs the same numbers off all eight module rows — which is
 *        where the supplements below read most of their numbers. An erased
 *        member has no number left to reach. It is safe by two accidents."
 *
 *   That is true today, and it is a property of a DIFFERENT MODULE. The twenty
 *   unguarded branches are safe only for as long as every path that marks an
 *   account deleted also takes the number away. The moment one does not, the
 *   platform starts texting people who asked to be erased — and, measured
 *   rather than assumed, NOTHING FAILS: removing `deleted` from the SMS
 *   audience's projection passes all 13,321 tests in this suite.
 *
 *   So this file does not add a runtime check. It makes the ratchet's existing
 *   claim TRUE, by deriving the list of doors from the source instead of
 *   hand-writing it.
 *
 * ── WHAT WAS DELIBERATELY NOT DONE ──────────────────────────────────────────
 *
 *   A phone-number block list, loaded once and consulted in `add()`, was
 *   written first and then removed. It would have covered all twenty-two
 *   branches in one line, and it would have been a query per broadcast over a
 *   set that is ALWAYS EMPTY: both writers of `deleted: true` on a user row
 *   apply userErasurePatch, which deletes `phone` and `phoneNumber`, so there
 *   is no number left to put in it. #699 — a dashboard that swept an external
 *   API before it would render — is too recent a lesson to add a scan that
 *   buys nothing.
 *
 *   It would also have been WRONG IN ONE DIRECTION IF EXTENDED THE OBVIOUS WAY.
 *   Blocking superseded rows by number too would take the live member out with
 *   the tombstone, because a superseded row is the same person and usually the
 *   same number (#490). Blocking by uid is safe there; blocking by number is
 *   not. Recorded because the obvious extension of the obvious fix silences
 *   the person it was written to protect.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { userErasurePatch } from '@/lib/user-erasure';

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

const parse = (rel: string) =>
    ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);

/**
 * Does this file WRITE the deleted marker, as opposed to discussing it?
 *
 *   ASKED OF THE SYNTAX TREE, which is the reason no comment-stripping pass
 *   appears in this file. Several of the candidates below explain
 *   `deleted: true` in prose without writing it — including two WAVE resource
 *   files this sweep must not pick up — and a text match would read the
 *   explanation as the thing explained. That trap has its own entry in this
 *   audit; the parser is simply immune to it.
 */
function marksDeleted(rel: string): boolean {
    let found = false;
    const walk = (node: ts.Node): void => {
        if (!found && ts.isObjectLiteralExpression(node) && hasDeletedTrue(node)) found = true;
        if (!found) ts.forEachChild(node, walk);
    };
    walk(parse(rel));
    return found;
}

/** `deleted: true` as an own property of this object literal. */
function hasDeletedTrue(node: ts.ObjectLiteralExpression): boolean {
    return node.properties.some(
        (p) => ts.isPropertyAssignment(p)
            && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
            && p.name.text === 'deleted'
            && p.initializer.kind === ts.SyntaxKind.TrueKeyword,
    );
}

/**
 * The user-row writes that mark an account deleted WITHOUT scrubbing it, named.
 *
 *   BOUND TO THE WRITE, NOT TO THE FILE. Asking "does this file mention
 *   userErasurePatch anywhere" is not the same question and passes when it
 *   should not: gdpr-purge applies the scrub to the cooperative membership row
 *   as well, so deleting it from the USER update leaves the file still
 *   matching. A mutant that did exactly that survived the first version of
 *   this suite.
 *
 *   So the unit is the object literal that carries `deleted: true`, and the
 *   scrub has to be spread into that same literal.
 */
function unscrubbedDeletions(rel: string): string[] {
    const sf = parse(rel);
    const offenders: string[] = [];

    const walk = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            if (hasDeletedTrue(node)) {
                const scrubbed = node.properties.some(
                    (p) => ts.isSpreadAssignment(p)
                        && ts.isCallExpression(p.expression)
                        && ts.isIdentifier(p.expression.expression)
                        && p.expression.expression.text === 'userErasurePatch',
                );
                if (!scrubbed) {
                    offenders.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
                }
            }
        }
        ts.forEachChild(node, walk);
    };
    walk(sf);

    return offenders;
}

/**
 * Every source file that marks a USER ROW deleted.
 *
 * DERIVED, NOT LISTED — that is the entire point of this finding. The
 * `COLLECTIONS.USERS` clause is what separates a user deletion from the WAVE
 * resource withdrawal, which uses the same `deleted: true` marker on a
 * different collection and must not be swept in.
 */
function userDeletionDoors(): string[] {
    const candidates = execSync(
        'grep -rl "deleted: true" src --include=*.ts --include=*.tsx'
        + ' | grep -v __tests__ | grep -v "lib/testing/"',
        { cwd: ROOT, encoding: 'utf-8' },
    ).trim().split('\n').filter(Boolean);

    return candidates.filter((rel) => marksDeleted(rel) && /COLLECTIONS\.USERS/.test(read(rel)));
}

describe('#704 — the list of deletion doors is derived, not remembered', () => {
    it('THE SWEEP IS READING THE SOURCE', () => {
        //   THE control. Every assertion below is "for each door, ...", and an
        //   empty list satisfies all of them vacuously — which is precisely the
        //   failure mode of the ratchet this replaces.
        const doors = userDeletionDoors();
        expect(doors.length).toBeGreaterThanOrEqual(3);
        expect(doors).toContain('src/app/actions/user.ts');
        expect(doors).toContain('src/lib/user-soft-delete.ts');
    });

    it('AND IT SEES THE FOURTH DOOR THE OLD LIST NEVER NAMED', () => {
        /*
         *   The specific gap. gdpr-purge marks a user row deleted and was not
         *   one of the "ALL THREE" — so the older ratchet passed while the
         *   thing it claimed to guarantee was already untrue.
         */
        expect(userDeletionDoors()).toContain('src/app/api/cron/gdpr-purge/route.ts');
    });

    it('AND IT DOES NOT SWEEP IN THE WAVE RESOURCE WITHDRAWAL', () => {
        /*
         *   The discriminator, asserted rather than assumed. `deleted: true` is
         *   also how a WAVE resource is withdrawn; if the sweep matched on the
         *   marker alone it would demand a PII scrub from a file that deletes
         *   no person, and the obvious repair would be to loosen the rule.
         *
         *   Checked positively too: the file really does write the marker, so
         *   this is exclusion by the users clause, not by the file happening
         *   not to match at all.
         */
        expect(marksDeleted('src/lib/wave-resource-visibility.ts')).toBe(true);
        expect(userDeletionDoors()).not.toContain('src/lib/wave-resource-visibility.ts');
    });

    it('EVERY DOOR THAT MARKS A USER DELETED ALSO APPLIES THE SHARED SCRUB', () => {
        /*
         *   THE assertion. Reported as a list of file:line rather than one
         *   expect per file, so a failure names the WRITE that skipped the
         *   scrub instead of saying `false !== true`.
         */
        const offenders = userDeletionDoors().flatMap(unscrubbedDeletions);
        expect(offenders).toEqual([]);
    });

    it('AND THE SCRUB IT APPLIES REALLY DOES TAKE THE PHONE NUMBER AWAY', () => {
        /*
         *   The other half of the coupling, and the half the SMS audiences
         *   actually depend on. `userErasurePatch` is only worth demanding if
         *   it removes the thing that would be texted. Asserted by RUNNING it,
         *   not by reading the field list — #371's ratchet already pins the
         *   spellings, but nothing tied that to why the broadcast is safe.
         */
        const patch = userErasurePatch('some-uid') as unknown as Record<string, unknown>;

        for (const field of ['phone', 'phoneNumber']) {
            expect({ field, present: field in patch }).toEqual({ field, present: true });
            //   Deleted outright, not overwritten with something sendable.
            expect({ field, value: patch[field] }).not.toEqual({ field, value: expect.any(String) });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (5/5). Each mutant proved its edit landed with a
 *   unique string before its result was believed, and the harness restores by
 *   copying snapshots — including deleting the NEW file M1 and M6 create,
 *   which `git checkout` could not have removed.
 *
 *   M1  a NEW door marking a user deleted, never scrubbing      KILLED
 *   M2  the existing fourth door stops scrubbing                KILLED
 *   M3  userErasurePatch stops removing the phone number        KILLED
 *   M4  the sweep drops the COLLECTIONS.USERS discriminator     KILLED
 *   M5  the scrub accepted from anywhere in the file          SURVIVED
 *   M6  a new file whose `deleted: true` is only in a comment SURVIVED
 *   CONTROL  a comment reworded inside a real door           SURVIVED
 *
 *   M1 IS THE ONE THAT MATTERS: it is the scenario the older ratchet's comment
 *   promised to catch and could not. M6 is its mirror — a file that only talks
 *   about the marker must not be dragged in, which is what makes M1's failure
 *   a real signal rather than a tripwire on the word "deleted".
 *
 *   M5 SURVIVES BY DESIGN AND IS RECORDED, NOT HIDDEN. It weakens this suite
 *   back to asking whether the FILE mentions userErasurePatch anywhere, and the
 *   baseline still passes — because today every door does scrub. So the green
 *   baseline cannot tell the two instruments apart; only M2 can, and M2 is why
 *   the check is bound to the object literal instead of the file.
 *
 * ── WHAT THE FIRST SWEEP CAUGHT IN THIS SUITE ITSELF ────────────────────────
 *
 *   M2 SURVIVED the first version. The check asked whether the file mentioned
 *   `userErasurePatch`, and gdpr-purge applies it to the cooperative membership
 *   row as well — so removing it from the USER update left the file matching
 *   and the test green. The scrub is now required in the same object literal
 *   that carries the marker.
 *
 *   A second finding came out of the fix: once the check was on the syntax
 *   tree, the comment-stripping pass this file used to carry stopped being
 *   load-bearing, and its comment saying otherwise had become untrue. It was
 *   removed rather than left as a false claim about a test whose subject is
 *   false claims.
 */
