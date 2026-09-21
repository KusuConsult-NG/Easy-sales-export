/**
 * @jest-environment node
 */

/**
 *   #812 THE ESCROW CHAT'S OWN INPUT ENFORCED THE RULE. THE SERVER DID NOT.
 *
 *        EscrowChatClient.tsx says exactly what the rule is:
 *
 *            438   maxLength={1000}
 *            168   if (!newMessage.trim() || !session?.user) return;
 *            180   message: newMessage.trim(),
 *
 *        `_sendEscrowMessageAction` applied none of it. A server action is a
 *        PUBLIC HTTP ENDPOINT — `maxLength` on an input is a courtesy to the
 *        honest user, not a control — so an empty message, a whitespace-only
 *        one, or one of any size at all went straight into the thread.
 *
 *        The empty one is the visible half: a blank bubble from a named
 *        participant, in the chat where a disputed order is argued. The
 *        unbounded one is the expensive half — stored once, re-read by every
 *        poll of that thread, re-rendered every time.
 *
 *        MARKETPLACE REVIEW COMMENTS HAD THE SAME GAP, with no client cap
 *        either: `comment: data.comment || null`, whatever arrived.
 *
 *        AND THE MODULE ALREADY KNEW BETTER. `_quote_offers.ts` caps its own
 *        free text server-side, in one expression:
 *
 *            response.message.trim().slice(0, 2000)
 *
 *        So this is the shape this audit keeps finding: a rule applied to one
 *        path in a module and not to its siblings.
 *
 * ── WHY IT REFUSES RATHER THAN TRUNCATES ────────────────────────────────────
 *
 *   `slice` silently changes what somebody said. On a message in a disputed
 *   order that is the wrong failure — the sender believes they sent a sentence,
 *   the recipient reads two thirds of one, and nothing on either screen says
 *   so. The client already prevents it, so an honest caller never sees the
 *   refusal.
 *
 *   `_quote_offers` is deliberately left truncating. That is shipped behaviour
 *   on a working path with a generous cap, and changing it is wider than this
 *   finding warrants. It is asserted below so the difference is recorded rather
 *   than forgotten.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    requiredFreeText,
    optionalFreeText,
    MESSAGE_MAX_LENGTH,
    COMMENT_MAX_LENGTH,
} from '@/lib/free-text';

// ─────────────────────────────────────────────────────────────────────────────
describe('#812 — the rule', () => {
    it('AN EMPTY MESSAGE IS REFUSED — the blank bubble', () => {
        for (const empty of ['', '   ', '\n\t  \n']) {
            const v = requiredFreeText(empty);
            expect(v.ok).toBe(false);
            expect(!v.ok && v.reason).toBe('empty');
        }
    });

    it('AND SO IS ANYTHING THAT IS NOT A STRING', () => {
        //   `String(42)` would make "42" a valid chat message, and an object
        //   would arrive in somebody's thread as "[object Object]".
        for (const junk of [undefined, null, 42, {}, [], true]) {
            const v = requiredFreeText(junk);
            expect(v.ok).toBe(false);
            expect(!v.ok && v.reason).toBe('empty');
        }
    });

    it('AND ONE OVER THE CAP IS REFUSED, NOT TRUNCATED', () => {
        const v = requiredFreeText('x'.repeat(MESSAGE_MAX_LENGTH + 1));

        expect(v.ok).toBe(false);
        expect(!v.ok && v.reason).toBe('too_long');
        //   The refusal names both numbers, so the sender can see by how much.
        expect(!v.ok && v.message).toContain(String(MESSAGE_MAX_LENGTH));
    });

    it('THE CAP IS THE ONE THE INPUT ALREADY ENFORCED', () => {
        //   Not a number invented here: EscrowChatClient has always said 1000.
        expect(MESSAGE_MAX_LENGTH).toBe(1000);

        const client = readFileSync(
            join(process.cwd(), 'src/app/escrow/[id]/chat/EscrowChatClient.tsx'), 'utf8');
        expect(client).toContain(`maxLength={${MESSAGE_MAX_LENGTH}}`);
    });

    it('POSITIVE CONTROL: AN ORDINARY MESSAGE PASSES, TRIMMED', () => {
        //   Without this, every assertion above could be measuring a rule that
        //   refuses everything — which would silence the escrow chat entirely.
        const v = requiredFreeText('  Is the borehole working?  ');

        expect(v.ok).toBe(true);
        expect(v.ok && v.text).toBe('Is the borehole working?');
    });

    it('and exactly the cap is allowed — the boundary, not one inside it', () => {
        expect(requiredFreeText('x'.repeat(MESSAGE_MAX_LENGTH)).ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#812 — and the optional half, for a review comment', () => {
    it('AN ABSENT COMMENT IS null, NOT AN ERROR — a rating alone is a review', () => {
        for (const none of [undefined, null, '', '   ']) {
            const v = optionalFreeText(none);
            expect(v.ok).toBe(true);
            expect(v.ok && v.text).toBeNull();
        }
    });

    it('A COMMENT IS TRIMMED AND KEPT', () => {
        const v = optionalFreeText('  Arrived early, well packed. ');
        expect(v.ok).toBe(true);
        expect(v.ok && v.text).toBe('Arrived early, well packed.');
    });

    it('AND AN OVER-LONG ONE IS REFUSED rather than silently shortened', () => {
        //   A review whose last paragraph vanished is a review the buyer did
        //   not write.
        const v = optionalFreeText('x'.repeat(COMMENT_MAX_LENGTH + 1));
        expect(v.ok).toBe(false);
        expect(!v.ok && v.reason).toBe('too_long');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#812 — every free-text write in the module goes through it', () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

    it('THE ESCROW MESSAGE IS CHECKED, AND THE CHECKED TEXT IS WHAT IS STORED', () => {
        const src = read('src/app/actions/marketplace/_escrow_messages.ts');

        expect(src).toContain('requiredFreeText(data.message, MESSAGE_MAX_LENGTH');
        //   The stored value is the TRIMMED one. Validating `data.message` and
        //   then storing `data.message` would pass every test above and still
        //   write the untrimmed string.
        expect(src).toContain('message: body.text,');
        expect(src).not.toContain('message: data.message,');
    });

    it('AND BOTH REVIEW COMMENTS ARE — product and seller', () => {
        const src = read('src/app/actions/marketplace/_reviews.ts');

        expect(src).toContain('optionalFreeText(data.comment, COMMENT_MAX_LENGTH');
        expect(src).not.toContain('comment: data.comment || null,');
        //   Two review actions, two writes.
        expect(src.split('comment: body.text,').length - 1).toBe(2);
    });

    it('AND THE QUOTE PATH IS RECORDED AS IT IS — truncating, deliberately', () => {
        //   Not changed, and not quietly ignored either. A seller's 2,500
        //   character counter still loses its last 500 without being told, and
        //   this assertion is where that fact lives until somebody decides
        //   otherwise.
        const src = read('src/app/actions/marketplace/_quote_offers.ts');
        expect(src).toContain('.trim().slice(0, 2000)');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/free-text.ts and the two call sites, this suite re-run
 *   each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop the empty check — the defect           2   "AN EMPTY MESSAGE IS
 *                                                   REFUSED"
 *
 *   coerce with String(value) instead of        1   "AND SO IS ANYTHING THAT IS
 *   treating a non-string as empty                  NOT A STRING"
 *
 *   truncate instead of refusing                1   "AND ONE OVER THE CAP IS
 *                                                   REFUSED, NOT TRUNCATED"
 *
 *   `>` becomes `>=` on the cap                 1   "and exactly the cap is
 *                                                   allowed"
 *
 *   store data.message rather than body.text    1   "THE ESCROW MESSAGE IS
 *                                                   CHECKED, AND THE CHECKED
 *                                                   TEXT IS WHAT IS STORED"
 *
 *   optionalFreeText refuses an absent          1   "AN ABSENT COMMENT IS null"
 *   comment
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the header comment in free-text      0   SURVIVED ✓
 *
 *   THE FIFTH IS THE ONE THAT NEEDED WRITING DOWN. Validating `data.message`
 *   and then STORING `data.message` passes every assertion about the rule and
 *   still writes the untrimmed string — the check becomes decoration. It dies
 *   only against an assertion about what is stored.
 */
