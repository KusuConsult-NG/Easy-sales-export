/**
 * @jest-environment node
 */

/**
 *   #737 THE TRANSACTIONAL SENDER REFUSED AN ADDRESS THAT HAD BOUNCED, AND SENT
 *        TO THE ONE GUARANTEED TO.
 *
 *   #694 put a bounce check on `sendEmailNotification` — the ONE path every
 *   transactional email takes — and argued for it in the file's own words:
 *   "sender reputation matters here", and "'we told the member' was false" for
 *   an address that cannot receive.
 *
 *   Erasure rewrites BOTH the user row and the Auth identity to
 *   `deleted_<uid>@redacted.local`. That domain does not resolve. So anything
 *   still firing a notice at an erased account — an admin working a queue, a
 *   cron closing something out — sent mail that could only bounce.
 *
 * ── AND THE GUARD THAT EXISTED COULD ONLY HELP AFTERWARDS ───────────────────
 *
 *   BOUNCED_EMAILS is populated BY bounces. So the first send to every erased
 *   account was always going to happen: it damaged the sending reputation #694
 *   exists to protect, and was then recorded as a bounce against the platform's
 *   own tombstone. The suppression list would slowly fill with addresses the
 *   platform itself minted.
 *
 *   A rule that only catches the second occurrence of something the platform
 *   creates deliberately is not much of a rule.
 *
 * ── CHECKED FIRST, AND WHY THAT IS NOT MERELY TIDY ──────────────────────────
 *
 *   `isErasedAddress` is a string test; `isUndeliverable` is a database read
 *   that fails open on error. Putting the tombstone first means a tombstoned
 *   address costs no lookup, and cannot be sent to because a read happened to
 *   fail at that moment.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run before
 *   the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { isErasedAddress } from '@/lib/contactable-account';
import { erasedEmailFor } from '@/lib/user-erasure';

const SENDER = 'src/lib/email-notifications.ts';
const code = () => stripComments(readFileSync(SENDER, 'utf-8'), { label: SENDER });

// ─────────────────────────────────────────────────────────────────────────────
describe('#737 — the address erasure leaves behind', () => {
    it('IS WHAT erasedEmailFor MINTS, AND isErasedAddress RECOGNISES IT', () => {
        /*
         *   The two ends of the same fact, asserted against each other rather
         *   than against a hand-typed string. A change to the minted shape that
         *   left the recogniser behind is exactly how this guard would stop
         *   working silently.
         */
        const minted = erasedEmailFor('abc123');

        expect(minted).toContain('@redacted.local');
        expect(isErasedAddress(minted)).toBe(true);
    });

    it('AND A REAL MEMBER IS UNAFFECTED', () => {
        //   The direction that must not move: this must not stop a loan
        //   decision reaching somebody.
        expect(isErasedAddress('ada@example.com')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#737 — the one transactional path refuses it', () => {
    it('IT CHECKS THE TOMBSTONE — the defect, stated as its absence', () => {
        expect(code()).toContain('isErasedAddress(data.to)');
    });

    it('AND BEFORE THE BOUNCE LOOKUP, NOT AFTER', () => {
        /*
         *   Not merely tidy. isUndeliverable reads the database and FAILS OPEN
         *   on error — deliberately, because a read fault must not silence every
         *   transactional email. Behind that, a tombstoned address would be sent
         *   to whenever the read happened to fail.
         */
        const src = code();
        const tombstoneAt = src.indexOf('isErasedAddress(data.to)');
        const bounceAt = src.indexOf('isUndeliverable(data.to)');

        expect(tombstoneAt).toBeGreaterThan(-1);
        expect(bounceAt).toBeGreaterThan(tombstoneAt);
    });

    it('AND BEFORE THE MESSAGE IS HANDED TO RESEND', () => {
        //   A refusal after the send is not a refusal.
        const src = code();
        const tombstoneAt = src.indexOf('isErasedAddress(data.to)');
        const sendAt = src.indexOf('resend.emails.send(');

        expect(sendAt).toBeGreaterThan(tombstoneAt);
    });

    it('AND REFUSES RATHER THAN THROWS, AS THE BOUNCE CHECK DOES', () => {
        /*
         *   #694 established the shape: callers read this result and treat email
         *   as non-fatal. Throwing here would turn a tombstoned recipient into a
         *   failed admin action.
         */
        const src = code();
        const at = src.indexOf('isErasedAddress(data.to)');
        const block = src.slice(at, at + 320);

        expect(block).toContain('return { success: false');
        expect(block).not.toContain('throw');
    });

    it('AND SAYS WHICH RULE REFUSED IT', () => {
        //   An operator reading the log needs to tell "this address bounced"
        //   from "this account no longer exists" — different situations with
        //   different answers.
        const src = code();
        const at = src.indexOf('isErasedAddress(data.to)');
        const block = src.slice(at, at + 320);

        expect(block).toContain('has been erased');
        expect(src).toContain('this address has hard-bounced');
    });

    it('AND DOES NOT LOG THE ADDRESS ITSELF', () => {
        /*
         *   The bounce branch logs `to` because a real address an operator can
         *   act on is the point. A tombstone is `deleted_<uid>@redacted.local` —
         *   the uid of somebody who asked to be forgotten. Nothing is gained by
         *   putting it in a log line.
         */
        const src = code();
        const at = src.indexOf('isErasedAddress(data.to)');
        const block = src.slice(at, at + 320);

        expect(block).not.toContain('to: data.to');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run before
 *   this table was written.
 *
 *     MUTANT                                                        RESULT
 *     the tombstone check is removed                                 KILLED
 *     it is moved below the bounce lookup                            KILLED
 *     it is moved below the send                                     KILLED
 *     it throws instead of refusing                                  KILLED
 *     it logs the tombstoned address                                 KILLED
 *     erasedEmailFor mints a domain the recogniser misses            KILLED
 *     isErasedAddress refuses everything                             KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
