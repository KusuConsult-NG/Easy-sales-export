/**
 * @jest-environment node
 */

/**
 *   #679 TWO CALLERS PROMISED ATOMICITY THE WRITE BATCH CANNOT DELIVER.
 *
 *   `SupabaseWriteBatch.commit()` is a `for` loop that awaits each operation in
 *   turn. There is no transaction around it and no rollback, so a failure
 *   partway through leaves every earlier write applied and every later one not,
 *   and the caller gets a rejected promise with no way to know how far it got.
 *
 *   THE CLASS CARRIED NO NOTE SAYING SO. `runTransaction` in the same file does
 *   — twice — and this codebase has three separate findings where a comment
 *   promised atomicity the code could not deliver: the sync engine, the
 *   WhatsApp invite, and order management. The batch was the more dangerous of
 *   the two, because it carries a name from an API where the guarantee IS real:
 *   Firestore's WriteBatch commits or does not.
 *
 *   AND TWO CALLERS HAD ALREADY BELIEVED IT.
 *
 *     cooperative/_coop_registration.ts
 *       "Atomic batch: all 3-4 writes committed together so no partial state
 *        on crash."
 *       Not atomic; and there are TWO writes, not three or four. The partial
 *       state it promises to prevent is harmless anyway — the second write
 *       increments `cooperatives.memberCount`, which the note six lines below
 *       it records as having one writer and NO READER. Protection against a
 *       consequence that does not exist, by a mechanism that does not work.
 *
 *     actions/kyc.ts
 *       "We use a Firestore batch for atomicity and efficiency."
 *       A cross-module PII sync. A failure partway leaves the member's new
 *       phone number in the collections written so far and the old one in the
 *       rest — the exact inconsistency the sentence above it says the block
 *       exists to prevent. Bounded and recoverable (the root user document is
 *       written first, by atomicUpdateUser, and a later KYC save re-runs the
 *       whole sync), which is why the mechanism is left alone.
 *
 *   NEITHER MECHANISM IS CHANGED. Today's writes are independent and a
 *   half-applied result is survivable in both. What is removed is the false
 *   assurance, because the danger was never the writes that are there — it is
 *   the one somebody adds tomorrow while trusting the sentence.
 *
 * ── AND A SWEEP THAT WAS BUILT AND NOT SHIPPED, FOR THE SECOND TIME ─────────
 *
 *   The obvious ratchet is "no comment near `.batch()` may claim atomicity".
 *   Run over this repository it returns three hits, and only one is a claim:
 *
 *     kyc.ts                 a real claim                       TRUE
 *     chatbot-db.ts          a comment DESCRIBING a past defect
 *                            and its fix — "all-or-nothing so a
 *                            failure purged nothing at all"     FALSE
 *     _coop_registration.ts  the CORRECTION written above, which
 *                            necessarily contains the word      FALSE
 *
 *   A regex cannot tell a claim from a denial or from a post-mortem, and a
 *   ratchet that flags its own fix teaches people to delete the explanation.
 *   #678 reached the same conclusion about a different sweep an hour earlier;
 *   recording it twice is cheaper than building it a third time.
 *
 *   What is asserted instead is narrow and sound: the authoritative statement
 *   exists on the class, and the two corrected callers no longer claim
 *   otherwise.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const ADAPTER = 'src/lib/supabase-db.ts';
const COOP = 'src/app/actions/cooperative/_coop_registration.ts';
const KYC = 'src/app/actions/kyc.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#679 — the batch says what it actually does', () => {
    it('THE COMMIT IS STILL A SEQUENTIAL LOOP, WHICH IS THE FACT EVERYTHING ELSE RESTS ON', () => {
        /*
         *   Asserted against the CODE, comments stripped, because every other
         *   assertion in this file is about a comment describing this. If the
         *   implementation ever became genuinely atomic, these notes would
         *   become wrong in the opposite direction and this is what would say
         *   so.
         */
        const code = stripComments(raw(ADAPTER), { label: ADAPTER });
        const at = code.indexOf('export class SupabaseWriteBatch');
        expect(at).toBeGreaterThan(-1);

        const body = code.slice(at, code.indexOf('\n}', at));
        expect(body).toContain('async commit()');
        expect(body).toContain('for (const op of this._operations)');
        //   No transaction, no rollback — the two words that would mean the
        //   note on the class had gone stale.
        expect(body).not.toMatch(/\b(BEGIN|rollback|transaction)\b/i);
    });

    it('AND THE CLASS CARRIES THE WARNING, WHERE SOMEBODY REACHING FOR IT WILL SEE IT', () => {
        /*
         *   THE repair. `runTransaction` has had this note for some time; the
         *   batch had none, and it is the one with a name borrowed from an API
         *   where the guarantee is real.
         *
         *   Asserted against the RAW file — the mirror of the comment-stripping
         *   rule. Documentation legitimately lives in a comment, so asserting
         *   it against stripped source fails on a file that says it perfectly
         *   well (#666).
         */
        const src = raw(ADAPTER);
        const at = src.indexOf('export class SupabaseWriteBatch');
        const preamble = src.slice(Math.max(0, at - 2000), at);

        expect(preamble).toContain('NOT ATOMICALLY');
        expect(preamble).toContain('no rollback');
        //   And it names what to use instead, or it is a warning with no exit.
        expect(preamble).toContain('claim_status_transition');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#679 — and neither caller claims otherwise any more', () => {
    /**
     * Does the old claim survive anywhere except as a QUOTATION of itself?
     *
     *   A plain `not.toContain` cannot ask this, and the first version tried:
     *   both corrections quote the sentence they replace — that is the point of
     *   them — so the string is still in the file and the assertion failed
     *   against source that had been fixed correctly.
     *
     *   It is the same trap as #651, #654, #655 and #666, in its fifth form: an
     *   assertion about ABSENCE, defeated by prose that names the thing. The
     *   question that was actually meant is whether the sentence still stands
     *   as a statement, so that is what is asked — every occurrence must sit
     *   inside the block that repudiates it.
     */
    const onlyQuoted = (file: string, claim: string): boolean => {
        const src = raw(file);
        let from = 0;
        for (;;) {
            const at = src.indexOf(claim, from);
            if (at < 0) return true;
            const preamble = src.slice(Math.max(0, at - 400), at);
            if (!/#679[\s\S]*THIS SAID/.test(preamble)) return false;
            from = at + claim.length;
        }
    };

    it('THE COOPERATIVE REGISTRATION NO LONGER CALLS IT AN ATOMIC BATCH', () => {
        //   THE defect, in the words it was written in.
        const claim = 'Atomic batch: all 3-4 writes committed together';
        expect(raw(COOP)).toContain(claim);          // still quoted, on purpose
        expect(onlyQuoted(COOP, claim)).toBe(true);  // and only as a quotation
    });

    it('AND THE KYC SYNC NO LONGER CLAIMS ATOMICITY FOR IT', () => {
        const claim = 'We use a Firestore batch for atomicity';
        expect(raw(KYC)).toContain(claim);
        expect(onlyQuoted(KYC, claim)).toBe(true);
    });

    it('AND BOTH SAY WHAT IS TRUE INSTEAD, RATHER THAN SAYING NOTHING', () => {
        /*
         *   THE control, and the one that matters most here. Deleting the
         *   sentence satisfies both assertions above and leaves the next reader
         *   with a bare `db.batch()` that still LOOKS like Firestore's — which
         *   is the state that produced this finding in the first place.
         */
        expect(raw(COOP)).toContain('IT IS NOT ATOMIC');
        expect(raw(KYC)).toContain('THE BATCH IS NOT ATOMIC');
    });

    it('AND NEITHER MECHANISM WAS CHANGED, WHICH IS WHAT MAKES THIS SAFE', () => {
        /*
         *   The second control. "Fix the comment" is only the right repair
         *   while the writes really are independent; quietly swapping either
         *   call site for something else would be a behaviour change smuggled
         *   in under a documentation finding.
         */
        const coop = stripComments(raw(COOP), { label: COOP });
        expect(coop).toContain('const batch = db.batch();');
        expect(coop).toContain('await batch.commit();');

        const kyc = stripComments(raw(KYC), { label: KYC });
        expect(kyc).toContain('const batch = db.batch();');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the cooperative comment is restored                 KILLED
 *     the kyc claim is restored                                       KILLED
 *     the cooperative correction is deleted rather than corrected     KILLED
 *     the kyc correction is deleted rather than corrected             KILLED
 *     the warning is removed from the class                           KILLED
 *     the warning stops naming what to use instead                    KILLED
 *     commit() is described as looping when it no longer does         KILLED
 *     the cooperative call site stops using a batch at all            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   Every `db.batch()` call site in the application was listed — fourteen files
 *   — and each was read for a nearby claim about atomicity. Three matched a
 *   regex; one was a claim, one was a post-mortem of a past defect that had
 *   already been fixed by chunking, and one was the correction written for this
 *   finding. The two real ones are the two corrected here.
 */
