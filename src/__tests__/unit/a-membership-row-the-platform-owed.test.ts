/**
 * @jest-environment node
 */

/**
 *   #726 THE LAST OF THE THREE FINDINGS THE FORENSIC REPORT COULD ONLY
 *   DESCRIBE — AND THE ONE WHERE WRITING THE MISSING RECORD IS CORRECT.
 *
 *   The reconciliation check settles the question of what this is, and it is
 *   worth quoting because it decides the whole shape of the repair:
 *
 *       "unlike an unrecorded gender, this is not a fact nobody collected. The
 *        role was granted. The row should exist. Somebody has to make it
 *        exist."
 *
 *   So this is NOT #725's case. There, writing the missing application would
 *   lie about a form nobody submitted, and that tool refuses to. Here the row
 *   is derived bookkeeping the platform OWES the member.
 *
 * ── THE REASON IT STAYED UNBUILT OVERSTATED THE PROBLEM ─────────────────────
 *
 *   From the backfill cron, recorded months ago:
 *
 *       "2 COOPERATIVE MEMBERS WITH NO MEMBERSHIP ROW would need a tier and
 *        balances invented to satisfy the check."
 *
 *   The tier, sometimes. THE BALANCE NEVER. Every completed cooperative
 *   transaction is already recorded and their sum IS the balance — the
 *   reconciliation check computes exactly that to verify every other member. A
 *   member with no transactions has ₦0, which is a fact rather than a guess.
 *
 *   Inventing a savings figure would be inventing money, and no repair in this
 *   audit may do that. So it is derived, from the SAME function the check
 *   verifies with — because a repair that derived by one rule while the check
 *   verified by another would create a row the check flags as mismatched the
 *   instant it was written.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    ledgerBalanceOf,
    balancesAgree,
    SAVINGS_CREDIT_TYPES,
    SAVINGS_DEBIT_TYPES,
} from '@/lib/cooperative-ledger-balance';
import {
    checkRepair,
    membershipRowFor,
    MEMBERSHIP_TIERS,
} from '@/lib/cooperative-membership-repair';

const REASON = 'Paid the registration fee in March; the payment reference is on their profile.';

// ─────────────────────────────────────────────────────────────────────────────
describe('#726 — the balance is derived, and by the rule the check verifies with', () => {
    it('CREDITS ADD AND DEBITS SUBTRACT', () => {
        expect(ledgerBalanceOf([
            { type: 'savings', amount: 10_000 },
            { type: 'contribution', amount: 5_000 },
            { type: 'withdrawal', amount: 2_000 },
        ])).toBe(13_000);
    });

    it('AND A MEMBER WITH NO TRANSACTIONS HAS ZERO, WHICH IS A FACT', () => {
        //   Not "unknown", not a blank to be filled in. Zero is what the ledger
        //   says, and it is what the reconciliation check will verify against.
        expect(ledgerBalanceOf([])).toBe(0);
    });

    it('AND A TYPE NOBODY HAS CLASSIFIED CONTRIBUTES NOTHING', () => {
        /*
         *   The direction that matters. Defaulting an unrecognised type to a
         *   CREDIT would inflate a member's savings on the strength of a
         *   spelling — the platform would owe money it has no record of
         *   receiving.
         */
        expect(ledgerBalanceOf([
            { type: 'something_nobody_wrote', amount: 999_999 },
            { type: 'savings', amount: 1_000 },
        ])).toBe(1_000);
    });

    it('AND A NON-NUMERIC AMOUNT DOES NOT POISON THE TOTAL', () => {
        //   NaN propagates through addition and would turn the whole balance
        //   into NaN, which then reads as a mismatch against every held figure.
        expect(ledgerBalanceOf([
            { type: 'savings', amount: 'not a number' },
            { type: 'savings', amount: 4_000 },
        ])).toBe(4_000);
    });

    it('AND THE TOLERANCE IS THE ONE THE CHECK ALREADY ALLOWED', () => {
        expect(balancesAgree(1_000, 1_000.5)).toBe(true);
        expect(balancesAgree(1_000, 1_002)).toBe(false);
    });

    it('AND THE TWO LISTS ARE THE ONES forensics.ts USED', () => {
        //   Carried over exactly. This finding is about where the rule LIVES,
        //   not about changing it — a quiet edit here would change what every
        //   member's balance is verified against.
        expect([...SAVINGS_CREDIT_TYPES].sort())
            .toEqual(['contribution', 'deposit', 'loan_repayment_excess', 'savings']);
        expect([...SAVINGS_DEBIT_TYPES].sort())
            .toEqual(['fixed_savings_lock', 'withdrawal']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#726 — a known tier is copied, not offered as a choice', () => {
    it('A MEMBER WITH A RECORDED TIER NEEDS NO DECISION', () => {
        expect(checkRepair({
            known: { knownTier: 'tier2', needsATier: false },
            reason: REASON,
        })).toEqual({ ok: true, tier: 'tier2' });
    });

    it('AND AN ADMIN MAY NOT TYPE OVER ONE THE MEMBER PAID FOR', () => {
        /*
         *   THE rule that keeps this a copy rather than a decision. The tier
         *   was written when they paid; overriding it here would make the row
         *   stop matching what they bought, and correcting a genuinely wrong
         *   tier is a different act with its own audit trail.
         */
        const verdict = checkRepair({
            known: { knownTier: 'tier1', needsATier: false },
            chosenTier: 'tier2',
            reason: REASON,
        });

        expect(verdict.ok).toBe(false);
        expect((verdict as any).reason).toContain('tier1');
    });

    it('AND A MEMBER WITH NO TIER MUST HAVE ONE CHOSEN', () => {
        expect(checkRepair({ known: { knownTier: null, needsATier: true }, reason: REASON }))
            .toMatchObject({ ok: false });
    });

    it('AND ONLY A TIER THE COOPERATIVE OFFERS', () => {
        expect(checkRepair({
            known: { knownTier: null, needsATier: true },
            chosenTier: 'tier9',
            reason: REASON,
        })).toMatchObject({ ok: false });

        for (const t of MEMBERSHIP_TIERS) {
            expect(checkRepair({
                known: { knownTier: null, needsATier: true },
                chosenTier: t,
                reason: REASON,
            })).toEqual({ ok: true, tier: t });
        }
    });

    it('AND A ONE-WORD NOTE IS REFUSED', () => {
        expect(checkRepair({ known: { knownTier: 'tier1', needsATier: false }, reason: 'ok' }))
            .toMatchObject({ ok: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#726 — what the created row says, and what it does not claim', () => {
    const row = membershipRowFor({
        userId: 'u-1',
        tier: 'tier1',
        ledgerBalance: 42_000,
        paymentReference: 'PSK-1',
        adminId: 'admin-1',
        reason: REASON,
    });

    it('IT CARRIES THE DERIVED BALANCE', () => {
        expect(row.savingsBalance).toBe(42_000);
    });

    it('AND IT IS CREATED pending, NOT active', () => {
        /*
         *   Creating the row is bookkeeping; ACTIVATING a membership is a
         *   grant. This tool does not know what the activation paths know —
         *   whether the member was suspended, never completed onboarding, or
         *   had a decision taken against them — so it creates the state that
         *   lets them decide rather than one that pre-empts them.
         */
        expect(row.membershipStatus).toBe('pending');
        expect(row.membershipStatus).not.toBe('active');
    });

    it('AND IT SAYS IT WAS WRITTEN BY A REPAIR, BY WHOM AND WHY', () => {
        //   A membership record with no history is the thing being repaired;
        //   writing another one would be an odd way to fix it.
        expect(row.createdByRepair).toBe(true);
        expect(row.createdByRepairAdmin).toBe('admin-1');
        expect(row.createdByRepairReason).toBe(REASON);
    });

    it('AND IT OMITS A PAYMENT REFERENCE IT DOES NOT HAVE, RATHER THAN WRITING EMPTY', () => {
        const bare = membershipRowFor({
            userId: 'u-2', tier: 'tier1', ledgerBalance: 0,
            paymentReference: null, adminId: 'admin-1', reason: REASON,
        });
        expect(bare).not.toHaveProperty('paymentReference');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#726 — and the action and the check read one rule', () => {
    const code = (rel: string) =>
        stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

    const ACTION = code('src/app/actions/admin/_cooperative_memberships.ts');
    const FORENSICS = code('src/app/actions/forensics.ts');

    it('BOTH DERIVE THE BALANCE THROUGH ledgerBalanceOf', () => {
        /*
         *   THE property this finding turns on. If the repair derived a balance
         *   by one rule and the reconciliation check verified it by another,
         *   the repair would create a row the check flags as mismatched the
         *   moment it was written — a fix that manufactures the next finding.
         */
        expect(ACTION).toContain('ledgerBalanceOf(');
        expect(FORENSICS).toContain('ledgerBalanceOf(');
        //   And the lists are no longer restated in forensics.
        expect(FORENSICS).not.toContain('["savings", "deposit", "contribution"');
    });

    it('AND THE MEMBER IS LOOKED UP BY BOTH KEYS, AS #488 ESTABLISHED', () => {
        //   The owner's "2 members with no membership record" was the scan
        //   asking a narrower question than the application. A tool that
        //   repeated that narrow read would create a SECOND row for a member
        //   who already has one, splitting their savings across two records.
        //
        //   THE CALL, NOT THE IDENTIFIER. Matching `findCooperativeMemberRow`
        //   over the whole file matches the IMPORT LINE, which survives intact
        //   when the call site is swapped for a one-key read — a mutant doing
        //   exactly that survived this assertion. The trailing paren binds the
        //   claim to the use.
        expect(ACTION).toContain('findCooperativeMemberRow(');

        /*
         *   And the narrow read is not present under another spelling. This is
         *   the claim that actually holds the line: reading the collection
         *   directly, by document id, IS the #488 defect, whatever helper
         *   happens to be imported alongside it.
         */
        const oneKeyReads = ACTION.split('\n')
            .filter((l) => l.includes('COOPERATIVE_MEMBERS'))
            .filter((l) => /\.get\(\)/.test(l));
        expect(oneKeyReads).toEqual([]);
    });

    it('AND IT RE-READS BEFORE WRITING, SO IT CANNOT CREATE A SECOND ROW', () => {
        const rebuildAt = ACTION.indexOf('const current = await buildCase(');
        const writeAt = ACTION.indexOf('membershipRowFor({');

        expect(rebuildAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(rebuildAt);
        //   And it merges, so a row appearing between the two is not flattened.
        expect(ACTION).toContain('{ merge: true }');
    });

    it('AND THE AUDIT ROW IS WRITTEN BEFORE THE EFFECT, RECORDING WHAT THE FIGURE CAME FROM', () => {
        //   THE CALL, not the identifier — an import line is always before
        //   every write, and #724 had a mutant survive on exactly that.
        const auditAt = ACTION.indexOf('await createAdminAuditLog({');
        const writeAt = ACTION.indexOf('membershipRowFor({');

        expect(auditAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(auditAt);
        //   The derivation is recorded, so the figure can be re-checked rather
        //   than taken on trust.
        expect(ACTION).toMatch(/ledgerRows/);
    });

    it('AND NOTHING IS DELETED, AND NO LEDGER ROW IS WRITTEN', () => {
        /*
         *   The balance is read FROM the ledger and never back INTO it. A
         *   repair that wrote transactions to make a balance come out right
         *   would be inventing money with extra steps.
         */
        expect(ACTION).not.toMatch(/\.delete\(\)/);
        const ledgerWrites = ACTION.split('\n')
            .filter((l) => l.includes('COOPERATIVE_TRANSACTIONS'))
            .filter((l) => /\.set\(|\.add\(|\.update\(/.test(l));
        expect(ledgerWrites).toEqual([]);
    });

    it('AND IT CLEARS THE CACHE ACCESS IS READ FROM', () => {
        //   #692. The membership row is what cooperative access is read from.
        expect(ACTION).toContain('invalidateUserCache(userId)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   rather than by checkout, each mutant proving its edit landed by a unique
 *   string on disk before the suite is run. 18 mutants and a control.
 *
 *     MUTANT                                                        RESULT
 *     an unclassified transaction type counts as a credit            KILLED
 *       — the one that invents money: a member's savings inflated
 *         on the strength of a spelling.
 *     a member with no transactions gets a blank rather than zero    KILLED
 *     a non-numeric amount poisons the total                         KILLED
 *     a debit is added instead of subtracted                         KILLED
 *     the tolerance is widened                                       KILLED
 *     an admin may type over a tier the member paid for              KILLED
 *     a tier the cooperative does not offer is accepted              KILLED
 *     a member with no tier is repaired without one                  KILLED
 *     the note requirement is dropped                                KILLED
 *     the row is created `active` instead of `pending`               KILLED
 *     the row stops recording who repaired it and why                KILLED
 *     the balance is written as 0 rather than derived                KILLED
 *     an absent payment reference is written as an empty string      KILLED
 *     forensics goes back to its own inline credit list              KILLED
 *     the action stops re-reading before writing                     KILLED
 *     the audit row is written after the effect                      KILLED
 *     the cache the row is read through is not cleared               KILLED
 *     the action looks the member up by document id only    SURVIVED, then KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this module's header                                    SURVIVED ✓
 *
 * ── THE ONE THAT SURVIVED, AND WHY IT MATTERS ───────────────────────────────
 *
 *   Replacing the two-key lookup with a direct `.doc(userId).get()` — the #488
 *   defect put back — passed this suite. The assertion read:
 *
 *       expect(ACTION).toContain('findCooperativeMemberRow');
 *
 *   which matches the IMPORT LINE. The import stays put when the call site is
 *   replaced, so the claim held vacuously against code that no longer did the
 *   thing claimed.
 *
 *   THIS IS THE FIFTH TIME IN THIS AUDIT A FILE-LEVEL MATCH HAS PASSED A
 *   USE-LEVEL CLAIM — #719, #723, #724 and #725 each lost a mutant to the same
 *   shape. It is worth naming as a rule: a source-level assertion must bind to
 *   the USE (a trailing paren, an ordering against another call, the absence of
 *   the rival spelling), never to an identifier that an import alone satisfies.
 *
 *   Fixed by binding to `findCooperativeMemberRow(` and, the claim that
 *   actually holds the line, asserting no line reads COOPERATIVE_MEMBERS with
 *   `.get()` at all. The mutant dies against both.
 */
