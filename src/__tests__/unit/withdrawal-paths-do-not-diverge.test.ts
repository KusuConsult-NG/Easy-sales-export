/**
 * @jest-environment node
 */

/**
 * One withdrawal, two admin screens, two different outcomes — and which one a
 * member got depended on which screen an admin happened to open.
 *
 * admin/_withdrawals.ts processWithdrawalAction looked the withdrawal up in
 * three collections in turn:
 *
 *     WITHDRAWALS → COOPERATIVE_WITHDRAWALS → WAVE_WITHDRAWALS
 *
 * and then treated whatever it found identically: claim `pending`, fire a
 * Paystack transfer, write a row to the global TRANSACTIONS ledger. That is
 * right for a wallet withdrawal. For the other two it is a strictly smaller
 * job than the action those modules already have.
 *
 * COOPERATIVE — WHAT WAS LOST
 * ---------------------------
 * cooperative/_coop_admin_money.ts approveWithdrawalAction does four things
 * this action does not:
 *
 *   1. a 24-hour pending hold
 *   2. a cooperative-scope check on the admin (an IDOR guard with no
 *      equivalent here — a cooperative_admin scoped to one cooperative could
 *      process another's request through the generic screen)
 *   3. lockedBalance -= amount on the member record
 *   4. the `withdrawal` row in COOPERATIVE_TRANSACTIONS
 *
 * Processed through the generic path, the money left and lockedBalance was
 * never released — the amount stayed locked out of the member's savings
 * permanently, forensics.ts kept counting it as held, getCooperativeStats kept
 * reporting the cooperative was holding money it had paid out, and the member's
 * withdrawal history stayed empty.
 *
 * It also pays the WRONG WAY. The cooperative settlement process is manual:
 * mark-withdrawal-completed's own comment records the flow as "pending →
 * approved, with the payout made by hand", then marked completed once the bank
 * transfer is done. Firing a Paystack transfer at a withdrawal that a human is
 * also going to pay by hand is how the same money goes out twice.
 *
 * WAVE — WHAT WAS LOST
 * --------------------
 * wave/_wv_admin_withdrawals.ts pays through Paystack too, but returns the
 * request to `pending` when the transfer fails — the rollback added after a
 * failed payout could be retried into a double payout. The generic path has no
 * rollback; a failed transfer parks the row at approved_pending_payout.
 *
 * THE FIX, AND WHY IT IS THE SAFE DIRECTION
 * -----------------------------------------
 * The generic action owns WITHDRAWALS alone and refuses the other two.
 *
 * Converging these two paths means one of them changes behaviour, and the only
 * question is which. Making the cooperative path pay automatically would
 * introduce a Paystack transfer into a flow that is settled by hand — new money
 * movement, and the double-payment risk above. Making the generic path do the
 * cooperative's accounting would rebuild, in the wrong module, four rules that
 * already exist correctly one file away.
 *
 * Withdrawing the narrower path adds no money movement anywhere. Nothing in the
 * UI calls this action — it is re-exported from admin/index.ts and reachable as
 * a server action, which is exactly why leaving it able to act on cooperative
 * rows was a live hazard rather than dead code.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COLLECTIONS } from '@/lib/types/firestore';

const ROOT = process.cwd();

const GENERIC = 'src/app/actions/admin/_withdrawals.ts';
const COOP = 'src/app/actions/cooperative/_coop_admin_money.ts';
const WAVE = 'src/app/actions/wave/_wv_admin_withdrawals.ts';
const MARK_COMPLETE = 'src/app/api/admin/cooperative/mark-withdrawal-completed/route.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * The gate the generic action applies, lifted out so it can be exercised.
 * Pinned to the original by "the rule the action actually runs" below.
 */
function genericPathAccepts(collection: string): boolean {
    return collection === COLLECTIONS.WITHDRAWALS;
}

describe('the generic admin path owns wallet withdrawals and nothing else', () => {
    it('accepts a wallet withdrawal', () => {
        expect(genericPathAccepts(COLLECTIONS.WITHDRAWALS)).toBe(true);
    });

    it('refuses a cooperative withdrawal — THE test', () => {
        expect(genericPathAccepts(COLLECTIONS.COOPERATIVE_WITHDRAWALS)).toBe(false);
    });

    it('and refuses a WAVE withdrawal', () => {
        expect(genericPathAccepts(COLLECTIONS.WAVE_WITHDRAWALS)).toBe(false);
    });

    it('the three collections being genuinely distinct', () => {
        // Vacuity guard: if two of these were the same string the gate would be
        // refusing something it also accepts.
        const all = [COLLECTIONS.WITHDRAWALS, COLLECTIONS.COOPERATIVE_WITHDRAWALS, COLLECTIONS.WAVE_WITHDRAWALS];
        expect(new Set(all).size).toBe(3);
    });
});

describe('the rule the action actually runs', () => {
    const generic = code(GENERIC);

    it('is the one exercised above', () => {
        expect(generic).toContain('if (withdrawalCollection !== COLLECTIONS.WITHDRAWALS) {');
        expect(generic).toContain('success: false as const,');
    });

    it('and it refuses BEFORE the status is claimed', () => {
        // A claim that has already moved the row cannot be undone by a later
        // refusal — the same ordering rule the loan guard follows.
        const guardAt = generic.indexOf('if (withdrawalCollection !== COLLECTIONS.WITHDRAWALS) {');
        const claimAt = generic.indexOf('const claim = await claimStatusTransition({');

        expect(guardAt).toBeGreaterThan(-1);
        expect(claimAt).toBeGreaterThan(guardAt);
    });

    it('and before the Paystack transfer, which is the irreversible part', () => {
        const guardAt = generic.indexOf('if (withdrawalCollection !== COLLECTIONS.WITHDRAWALS) {');
        const payAt = generic.indexOf('paystackPayout');

        expect(payAt).toBeGreaterThan(guardAt);
    });

    it('naming the screen that should be used instead', () => {
        // An error that only says "no" sends the admin back to the same button.
        expect(generic).toContain('This is not a wallet withdrawal. Process it from');
        expect(source(GENERIC)).toContain('releases the member\'s locked balance');
    });

    it('while still looking the withdrawal up in all three, so the message is accurate', () => {
        // It has to FIND the row to know which module owns it. Dropping the
        // lookups would turn a precise refusal into "not found".
        expect(generic).toContain('COLLECTIONS.COOPERATIVE_WITHDRAWALS');
        expect(generic).toContain('COLLECTIONS.WAVE_WITHDRAWALS');
    });
});

describe('what the cooperative path does that the generic one never did', () => {
    const coop = code(COOP);

    it('releases the member\'s locked balance', () => {
        // THE money defect. Without this the amount is locked out of the
        // member's savings for ever.
        expect(coop).toContain('lockedBalance: FieldValue.increment(-amount),');
        expect(code(GENERIC)).not.toContain('lockedBalance');
    });

    it('writes the ledger row three separate readers depend on', () => {
        expect(coop).toContain('COLLECTIONS.COOPERATIVE_TRANSACTIONS');
        expect(coop).toContain('type: "withdrawal",');
        expect(code(GENERIC)).not.toContain('COLLECTIONS.COOPERATIVE_TRANSACTIONS');
    });

    it('applies a 24-hour pending hold', () => {
        expect(coop).toContain('Withdrawals require a 24-hour pending hold');
        expect(code(GENERIC)).not.toContain('24-hour');
    });

    it('and checks the admin\'s cooperative scope', () => {
        // The IDOR guard with no equivalent in the generic action.
        expect(coop).toContain('Cannot approve withdrawal for another cooperative');
        expect(code(GENERIC)).not.toContain('adminScope');
    });

    it('the forensics reader that depends on that row being real', () => {
        // Vacuity guard on "three readers depend on it". forensics reconciles
        // savingsBalance + lockedBalance against the ledger, counting
        // `withdrawal` as a debit — so releasing the lock without writing the
        // row makes every completed withdrawal a permanent mismatch.
        const forensics = source('src/app/actions/forensics.ts');
        expect(forensics).toContain('const DEBIT_TYPES = ["withdrawal", "fixed_savings_lock"];');
        expect(forensics).toContain('lockedBalance');
    });
});

describe('the cooperative payout is made by hand, which is why paying here was worse than incomplete', () => {
    it('the completion route accepts the cooperative path\'s terminal status', () => {
        expect(code(MARK_COMPLETE)).toContain('fromAny: ["approved_pending_payout", "approved"]');
    });

    it('and it exists to record a transfer an admin performed', () => {
        expect(source(MARK_COMPLETE)).toContain('Used when the admin has manually processed the bank transfer.');
        expect(source(MARK_COMPLETE)).toContain('with the payout made by hand');
    });
});

describe('what the WAVE path does that the generic one never did', () => {
    it('returns the request to pending when the transfer fails', () => {
        const wave = code(WAVE);
        expect(wave).toContain('async function returnWithdrawalToPending(');
        expect(wave).toContain('to: "pending",');
        expect(wave).toContain('paystackPayout');
    });

    it('where the generic path parks it instead, with no way back', () => {
        expect(code(GENERIC)).toContain('approved_pending_payout');
        expect(code(GENERIC)).not.toContain('returnWithdrawalToPending');
    });
});

describe('both paths claimed the same status, which is what made it a race', () => {
    it('the generic one from pending', () => {
        expect(code(GENERIC)).toContain('from: "pending"');
    });

    it('and the cooperative one from pending too', () => {
        // The premise. Two claims on one field means the first admin to press a
        // button decides which of two different behaviours the member gets.
        expect(code(COOP)).toContain('from: "pending"');
        expect(code(COOP)).toContain('to: "approved"');
    });

    it('to different destinations, which is how the divergence was visible', () => {
        expect(code(GENERIC)).toContain('to: "payout_initiated"');
    });
});

describe('nothing in the UI loses a button', () => {
    it('because no component calls the generic action', () => {
        // It is re-exported from admin/index.ts and reachable as a server
        // action, which is why the refusal matters — but no screen breaks.
        const barrel = source('src/app/actions/admin/index.ts');
        expect(barrel).toContain('processWithdrawalAction');
    });

    it('and each module keeps its own', () => {
        expect(source('src/app/actions/cooperative/index.ts')).toContain('approveWithdrawalAction');
        expect(code(WAVE)).toContain('_processWaveWithdrawalAction');
    });
});
