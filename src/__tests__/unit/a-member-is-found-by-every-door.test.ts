/**
 * @jest-environment node
 */

/**
 *   #488 A MEMBER WHOSE ROW IS NOT KEYED BY THEIR USER ID IS TOLD THEY ARE NOT
 *        A MEMBER — BY EIGHT DOORS, THREE OF WHICH MOVE MONEY.
 *
 *   Followed from the owner's forensic report: "2 cooperative members with no
 *   membership record". Two looked like stray data. It is not stray data, and
 *   the number is not two.
 *
 * ── THE RULE ALREADY EXISTS, AND SAYS WHY THIS MATTERS ──────────────────────
 *
 *   lib/cooperative-member-lookup.ts was written for exactly this. Its own
 *   header:
 *
 *       "COOPERATIVE_MEMBERS is keyed by the user id by MOST writers … that is
 *        not the whole story: joinCooperativeAction creates its row with an
 *        AUTO-GENERATED document id, and the email and paymentReference claim
 *        paths return whatever document they matched. Those rows carry `userId`
 *        as a FIELD and are invisible to a doc-id read.
 *
 *        A doc-id read that misses is indistinguishable from having no
 *        membership, so the caller says 'you must be a cooperative member' to
 *        somebody who is one."
 *
 *   THREE CALL SITES ADOPTED IT: both loan doors and one money path. Swept, the
 *   reads that still do `.doc(userId).get()` and treat a miss as absence:
 *
 *     actions/cooperative/_withdrawal.ts       throws "You are not a member of
 *                                              any cooperative"
 *     api/cooperative/withdraw                 403 "You must be a cooperative
 *                                              member to request withdrawal"
 *     api/cooperative/check-membership         the route whose entire job is
 *                                              this question
 *     api/cooperative/create-fixed-savings     refuses the plan
 *     actions/platform.ts                      throws "You are not a member of
 *                                              any cooperative"
 *     _coop_membership.ts getUserTier          returns tier null, contributions 0
 *     _coop_admin_money.ts            (×2)     SILENTLY skips the balance move
 *     actions/forensics.ts                     reports "no membership record"
 *
 *   So the same member reads their dashboard, their savings and their ID card —
 *   those use the full lookup — and is refused when they try to withdraw. That
 *   is the owner's standing complaint in its exact words: "account not found
 *   even when they are fully registered".
 *
 * ── THE TWO WORST ARE THE TWO THAT SAY NOTHING ──────────────────────────────
 *
 *   _coop_admin_money.ts approves and rejects withdrawals. Both read
 *   `doc(userId)`, and on a miss neither refuses — they fall through to a
 *   nested collection and, failing that, carry on. So `lockedBalance` is never
 *   decremented: on an APPROVAL the money stays locked after it has been paid
 *   out, and on a REJECTION it is never returned to the member's savings. No
 *   error, no log, and a member whose balance is quietly wrong.
 *
 *   AND THE WITHDRAWAL ROUTE WRITES TO THE ID IT FAILED TO READ. It locks funds
 *   with `db.collection(COOPERATIVE_MEMBERS).doc(userId).update(...)`. Fixing
 *   only the READ would move the refusal and leave the write pointed at a
 *   document that does not exist — creating a second, phantom membership row
 *   holding a lockedBalance and nothing else. Every door here is fixed on both
 *   sides, and the test asserts the write target as well as the read.
 *
 * ── AND THE FORENSIC FINDING IS THE SCAN REPORTING ITS OWN NARROW READ ──────
 *
 *   The two records are not missing. They are where the other readers find
 *   them. The scan is corrected to use the shared lookup, so it stops reporting
 *   members as absent — and starts being able to report one that genuinely is.
 *
 *   The scan does NOT heal what it finds. Its screen tells the operator it
 *   "only reads", and a scan that repairs what it measures gives a different
 *   answer the second time it runs.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the withdrawal action reverted                 KILLED
 *     the withdraw route locking the raw id          KILLED
 *     check-membership reverted                      KILLED
 *     fixed savings debiting the raw id              KILLED
 *     the admin approval path reverted               KILLED
 *     the forensic scan reverted                     KILLED
 *     the resolver's userId-field branch removed     KILLED
 *     the compensation keyed to the raw user id      KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

/**
 * Every file that decides whether somebody IS a member, or moves their money.
 *
 * Deliberately not "every file mentioning the collection": a WRITER keying a
 * new row by the user id is correct and is what makes the doc-id strategy work
 * at all. What must not happen is a READ treating a doc-id miss as absence.
 */
const DOORS = [
    'src/app/actions/cooperative/_withdrawal.ts',
    'src/app/api/cooperative/withdraw/route.ts',
    //   #564 The check-membership handler's body moved to
    //   lib/cooperative-readers, so the member screens could read it on the
    //   server instead of fetching the route from the browser. The DOOR is the
    //   reader now — and it is a door with more callers than the handler had,
    //   so this covers more than it did. The route is checked separately below
    //   for having kept no second, narrower lookup.
    'src/lib/cooperative-readers.ts',
    'src/app/api/cooperative/create-fixed-savings/route.ts',
    'src/app/actions/platform.ts',
    'src/app/actions/cooperative/_coop_membership.ts',
    'src/app/actions/cooperative/_coop_admin_money.ts',
    'src/app/actions/forensics.ts',
];

/** The doors that already used the shared rule, kept so they cannot regress. */
const ALREADY_ADOPTED = [
    'src/app/actions/cooperative/_coop_money.ts',
    'src/app/actions/cooperative/_loans_applications.ts',
    'src/app/api/cooperative/apply-loan/route.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#488 — every door that asks "are you a member" asks it the same way', () => {
    it.each([...DOORS, ...ALREADY_ADOPTED])('%s uses the shared lookup', (rel) => {
        //   THE test. Eleven doors, one question, and eight of them were asking
        //   a narrower version that refuses real members.
        expect(code(rel)).toContain('findCooperativeMemberRow');
    });

    it('and the check-membership route delegates rather than looking up itself', () => {
        //   #564's extraction, checked where it could fail: a handler still
        //   doing its own doc-id read would restore the exact defect #488 is
        //   about, in a file this ratchet would no longer be looking at.
        const handler = code('src/app/api/cooperative/check-membership/route.ts');

        expect(handler).toContain('readCooperativeMembership');
        expect(handler).not.toContain('COOPERATIVE_MEMBERS');
    });

    it('AND NONE OF THEM STILL TREATS A DOC-ID MISS AS ABSENCE', () => {
        //   Importing the helper is not using it. This is the shape that was
        //   wrong: read the collection by document id, then branch on `exists`.
        const offenders = [...DOORS, ...ALREADY_ADOPTED].filter((rel) =>
            /COOPERATIVE_MEMBERS\)\s*\n?\s*\.doc\([^)]*\)\s*\n?\s*\.get\(\)/.test(code(rel)),
        );

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('POSITIVE CONTROL: that pattern really does match the shape it is banning', () => {
        //   Without this, "no offenders" could mean the regex matches nothing
        //   at all — the vacuity that makes a `not.toMatch` sweep worthless.
        const sample = 'const d = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();';

        expect(/COOPERATIVE_MEMBERS\)\s*\n?\s*\.doc\([^)]*\)\s*\n?\s*\.get\(\)/.test(sample)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#488 — and the money is written where the member actually is', () => {
    /**
     * The half a read-only fix would have missed. The withdrawal route locks
     * funds by writing to `doc(userId)`. Correcting only the read moves the
     * refusal and leaves the write pointed at a document that does not exist,
     * creating a phantom row holding a lockedBalance and nothing else.
     */
    it('THE WITHDRAWAL ROUTE LOCKS FUNDS ON THE ROW IT RESOLVED', () => {
        const route = code('src/app/api/cooperative/withdraw/route.ts');

        expect(route).toContain('memberRow.id');
        //   And the lock is on that ref, not a freshly derived one.
        const lock = route.slice(route.indexOf('lockedBalance: FieldValue.increment(amount)') - 400);
        expect(lock).not.toMatch(/\.doc\(userId\)/);
    });

    it('AND THE ADMIN APPROVE / REJECT PATHS MOVE THE LOCKED BALANCE', () => {
        //   The worst two, because they fail silently: on a miss neither
        //   refused, so an approval left the money locked after payout and a
        //   rejection never returned it to savings.
        //   CALL SITES, not mentions: the import line matches the name too, and
        //   counting mentions made this assert 3 for two correct call sites.
        const money = code('src/app/actions/cooperative/_coop_admin_money.ts');
        const uses = (money.match(/await findCooperativeMemberRow\(/g) ?? []).length;

        expect({ callSites: uses }).toEqual({ callSites: 2 });
        //   And both of them write the balance movement they resolved.
        expect((money.match(/\.doc\(memberRow\.id\)\.update\(/g) ?? []).length).toBe(2);
    });

    it('AND A FAILED WITHDRAWAL IS COMPENSATED ON THE ROW IT WAS DEBITED FROM', () => {
        //   The one that would have turned this fix into the loss it prevents.
        //   _coop_money's withdrawal debits savings, then records the request;
        //   if the record fails it compensates the debit. Debiting the resolved
        //   row and compensating the raw user id does not reverse anything — the
        //   member's savings stay reduced and a row that is not theirs is
        //   credited. And it only runs when something has already gone wrong,
        //   which is the hardest place to notice.
        const money = code('src/app/actions/cooperative/_coop_money.ts');
        const start = money.indexOf('compensateJsonbDebit({');
        const block = money.slice(start, start + 320);

        expect(start).toBeGreaterThan(-1);
        expect(block).toContain('id: memberRow.id');
        expect(block).not.toContain('id: userId');

        //   And the debit it reverses targets the same row.
        const debit = money.slice(money.indexOf('debitJsonbBalanceWithFloor({'));
        expect(debit.slice(0, 300)).toContain('id: memberRow.id');
    });

    it('AND THE REGISTRATION DOOR DOES NOT CHARGE A PAID MEMBER TWICE', () => {
        //   Its own comment warns that a wrong answer here "rewrites their
        //   membershipStatus to 'pending' and Paystack charges them the
        //   registration fee a second time". That was written about a legacy
        //   STATUS spelling; a legacy KEY produced the same outcome.
        const money = code('src/app/actions/cooperative/_coop_money.ts');

        expect(money).toContain('const existingRow = await findCooperativeMemberRow(');
        expect(money).toContain('.doc(existingRow?.id ?? userId)');
    });

    it('and the fixed-savings door writes to the resolved row too', () => {
        const route = code('src/app/api/cooperative/create-fixed-savings/route.ts');

        expect(route).toContain('findCooperativeMemberRow');
        expect(route).toContain('memberRow.id');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#488 — the forensic scan reads like the application, and still only reads', () => {
    it('IT RESOLVES THE MEMBER THE SAME WAY EVERY OTHER READER DOES', () => {
        //   The owner's "2 cooperative members with no membership record" is
        //   this scan reporting its own narrow read.
        const scan = code('src/app/actions/forensics.ts');
        const section = scan.slice(scan.indexOf('const coopMembersQuery'));

        expect(section).toContain('findCooperativeMemberRow');
    });

    it('AND IT DOES NOT WRITE — the screen says it only reads', () => {
        //   findCooperativeMemberRow takes no heal option and performs no
        //   write, which is why it is the right helper for a scan. Asserted so
        //   a future "helpful" repair inside the scan has to come past this.
        const lookup = code('src/lib/cooperative-member-lookup.ts');

        expect(lookup).not.toMatch(/\.update\(|\.set\(/);
    });

    it('and the check still reports a member who genuinely has no row', () => {
        //   Vacuity guard. A lookup that always finds something would make this
        //   check unable to fail, which is the defect #331 fixed twice.
        const scan = code('src/app/actions/forensics.ts');
        const section = scan.slice(scan.indexOf('const coopMembersQuery'));

        expect(section).toContain('unreadableMembers.push');
        expect(section).toContain('no membership record');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#488 — the shared rule itself still does what the doors now trust it for', () => {
    it('IT WALKS BOTH KEYS — document id, then the userId field', () => {
        const lookup = code('src/lib/cooperative-member-lookup.ts');

        expect(lookup).toContain('.doc(userId).get()');
        expect(lookup).toContain('.where("userId", "==", userId)');
    });

    it('AND RETURNS THE DOCUMENT ID, which is what a write needs', () => {
        //   Eight doors now write through this. A helper that returned only the
        //   data would have forced each of them to re-derive the ref, which is
        //   how the read and the write come to disagree.
        const lookup = code('src/lib/cooperative-member-lookup.ts');

        expect(lookup).toMatch(/id:\s*byId\.id/);
        expect(lookup).toMatch(/id:\s*doc\.id/);
    });

    it('and it still refuses to claim a row on an email match', () => {
        //   Its own recorded decision, and it is right: matching a membership
        //   on a free-text email is a CLAIM — that is how one account takes
        //   over another's savings — and belongs behind
        //   mayClaimMembershipByEmail, not inside a balance read.
        const lookup = code('src/lib/cooperative-member-lookup.ts');

        expect(lookup).not.toContain('"email"');
    });
});
