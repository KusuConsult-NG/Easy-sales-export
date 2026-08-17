/**
 * @jest-environment node
 */

/**
 * Either party could strand a funded escrow's money for good.
 *
 * THE DEFECT
 * ----------
 * _updateEscrowStatus carried its own transition table — a sixth hand-written
 * escrow transition map in this codebase — and its `funded` row was:
 *
 *     funded: ["in_transit", "disputed", "cancelled"]
 *
 * "cancelled" is a SETTLED status. It is not in ESCROW_RELEASABLE_FROM, not in
 * ESCROW_REFUNDABLE_FROM, and not in ESCROW_ACTIVE_STATUSES. So once a buyer or
 * seller cancelled a FUNDED escrow:
 *
 *   - the seller could never be paid       (release refuses to claim it)
 *   - the buyer could never be refunded    (refund refuses to claim it)
 *   - a dispute could not even find it     (the lookup skips settled rows)
 *
 * Real money, unreachable, from one call by either side. `cancelled` is now
 * reachable from `pending` alone — a pending escrow holds nothing, so cancelling
 * it costs nobody anything.
 *
 * NOT LIVE, BUT REACHABLE. src/app/escrow/page.tsx imports updateEscrowStatus
 * and never calls it, so the UI never offered this. It is an exported server
 * action, which is a reachable HTTP endpoint regardless of what the UI does.
 *
 * AND IT WAS CHECK-THEN-WRITE
 * ---------------------------
 * The participant check, the transition check, the admin check and the write all
 * sat inside runTransaction — which takes NO lock in this adapter — so two
 * callers passed every check and both wrote. Every other escrow path was moved
 * onto claimStatusTransition; this one was missed.
 *
 * A NINTH STATUS NOTHING WRITES
 * -----------------------------
 * packages/marketplace/src/types.ts declared EscrowStatus with a ninth member,
 * "completed", which no writer sets and escrowStatusSchema rejects. Because the
 * parameter type allowed it, the compiler accepted a transition table naming it
 * as the target from both `delivered` and `disputed` — two rows of dead code
 * that read as though settling an escrow were supported.
 *
 * Removing it surfaced two more live consequences:
 *
 *   src/app/escrow/page.tsx        getStepIndex had `case "completed": return 3`
 *                                  and no case for `released` or `refunded`, so a
 *                                  RELEASED escrow fell to `default: return 0`
 *                                  and displayed as step 0, "Payment Pending".
 *                                  A transaction whose funds had been paid out
 *                                  showed as awaiting payment.
 *
 *   admin/marketplace/escrow       a "Completed" filter option that could only
 *                                  ever return an empty list.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ESCROW_STATUSES,
    ESCROW_PARTICIPANT_TRANSITIONS,
    ESCROW_RELEASABLE_FROM,
    ESCROW_REFUNDABLE_FROM,
    ESCROW_SETTLED_STATUSES,
    participantSourcesFor,
} from '@/lib/escrow-status';

const ACTIONS = 'src/app/actions/marketplace/_escrow_actions.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('a funded escrow cannot be cancelled by a party', () => {
    it('cancelled is not reachable from funded', () => {
        // THE test. This is the transition that stranded the money.
        expect(ESCROW_PARTICIPANT_TRANSITIONS.funded).not.toContain('cancelled');
    });

    it('nor from in_transit or delivered — the money is just as real', () => {
        expect(ESCROW_PARTICIPANT_TRANSITIONS.in_transit).not.toContain('cancelled');
        expect(ESCROW_PARTICIPANT_TRANSITIONS.delivered).not.toContain('cancelled');
    });

    it('but IS reachable from pending, which holds nothing', () => {
        // Vacuity guard: forbidding it everywhere would leave an unfunded escrow
        // with no way to close, which is a different defect.
        expect(ESCROW_PARTICIPANT_TRANSITIONS.pending).toContain('cancelled');
        expect(participantSourcesFor('cancelled')).toEqual(['pending']);
    });

    it('and every status a party CAN cancel from is one with no money in it', () => {
        // The property, rather than the specific list: cancelling must never be
        // possible from a state a release or refund could have paid out of.
        for (const from of participantSourcesFor('cancelled')) {
            expect(ESCROW_RELEASABLE_FROM).not.toContain(from);
            expect(ESCROW_REFUNDABLE_FROM).not.toContain(from);
        }
    });
});

describe('the table cannot reach a settled state by hand', () => {
    it('no row targets released or refunded', () => {
        // They move money and belong to releaseEscrowFunds / refundEscrowToBuyer,
        // which claim their own transitions and write the ledger.
        for (const from of ESCROW_STATUSES) {
            expect(ESCROW_PARTICIPANT_TRANSITIONS[from]).not.toContain('released');
            expect(ESCROW_PARTICIPANT_TRANSITIONS[from]).not.toContain('refunded');
        }
    });

    it('and no settled status has any outgoing transition', () => {
        for (const settled of ESCROW_SETTLED_STATUSES) {
            expect(ESCROW_PARTICIPANT_TRANSITIONS[settled]).toEqual([]);
        }
    });

    it('leaving a dispute is not a participant transition at all', () => {
        expect(ESCROW_PARTICIPANT_TRANSITIONS.disputed).toEqual([]);
    });

    it('every target named is a real status', () => {
        for (const from of ESCROW_STATUSES) {
            for (const to of ESCROW_PARTICIPANT_TRANSITIONS[from]) {
                expect(ESCROW_STATUSES).toContain(to);
            }
        }
    });

    it('and "completed" appears nowhere', () => {
        // The ninth member that nothing writes. Two rows of the old table pointed
        // at it, and the compiler agreed because the parameter type allowed it.
        expect(JSON.stringify(ESCROW_PARTICIPANT_TRANSITIONS)).not.toContain('completed');
        expect(ESCROW_STATUSES as readonly string[]).not.toContain('completed');
    });
});

describe('the action claims rather than checking then writing', () => {
    it('uses claimStatusTransitionFromAny', () => {
        const src = code(ACTIONS);
        const fn = src.slice(src.indexOf('async function _updateEscrowStatus'));
        const body = fn.slice(0, fn.indexOf('export const updateEscrowStatus'));

        expect(body).toContain('claimStatusTransitionFromAny({');
        expect(body).toContain('participantSourcesFor(status)');
    });

    it('and no longer writes inside runTransaction', () => {
        const src = code(ACTIONS);
        const fn = src.slice(src.indexOf('async function _updateEscrowStatus'));
        const body = fn.slice(0, fn.indexOf('export const updateEscrowStatus'));

        expect(body).not.toContain('tx.update(txRef, {');
        expect(body).not.toContain('db.runTransaction');
    });

    it('carries no hand-written transition table', () => {
        const src = code(ACTIONS);

        expect(src).not.toContain('const validTransitions');
        expect(src).not.toContain('funded: ["in_transit", "disputed", "cancelled"]');
    });

    it('still refuses a non-participant, and still gates leaving a dispute', () => {
        // Both guards had to survive the move out of runTransaction — the claim
        // cannot express "and the caller is one of these two parties".
        const src = code(ACTIONS);
        const fn = src.slice(src.indexOf('async function _updateEscrowStatus'));
        const body = fn.slice(0, fn.indexOf('export const updateEscrowStatus'));

        expect(body).toContain('preData.buyerId !== userId && preData.sellerId !== userId');
        expect(body).toContain('preData.status === "disputed" && !isAdmin(session.user.roles)');
    });

    it('and says so plainly when asked to move money', () => {
        const src = code(ACTIONS);

        expect(src).toContain('status === "released" || status === "refunded"');
        expect(src).toContain('it moves money and writes the ledger');
    });
});

describe('the escrow stepper shows a released escrow as finished', () => {
    const PAGE = 'src/app/escrow/page.tsx';

    it('the final step is keyed on released, not completed', () => {
        const src = code(PAGE);

        expect(src).toContain('key: "released" as EscrowStatus');
        expect(src).not.toContain('key: "completed" as EscrowStatus');
    });

    it('and getStepIndex handles both terminal states', () => {
        // A released escrow used to fall through to `default: return 0` and
        // display as "Payment Pending" — a transaction whose funds had been paid
        // out shown as awaiting payment.
        const src = code(PAGE);

        expect(src).toContain('case "released": return 3');
        expect(src).toContain('case "refunded": return -1');
        expect(src).not.toContain('case "completed": return 3');
    });

    it('the admin filter drops the option that could never match', () => {
        const src = code('src/app/admin/marketplace/escrow/page.tsx');

        expect(src).not.toContain('{ value: "completed", label: "Completed" }');
        expect(src).toContain('{ value: "released", label: "Released" }');
    });
});
