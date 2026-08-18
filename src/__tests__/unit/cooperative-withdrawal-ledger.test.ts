/**
 * @jest-environment node
 */

/**
 * The money left and the ledger never recorded it.
 *
 * NOTHING in this codebase wrote a `withdrawal` row to cooperative_transactions.
 * Every writer of that collection produced one of four types — contribution,
 * membership_registration, fixed_savings_lock, deposit — and three separate
 * readers depended on a withdrawal row that was never there:
 *
 *   forensics.ts          DEBIT_TYPES = ["withdrawal", "fixed_savings_lock"].
 *                         It reconciles cooperative_members.savingsBalance +
 *                         lockedBalance against completed ledger rows. At
 *                         REQUEST time the debit moves savings into
 *                         lockedBalance, so the sum is unchanged and
 *                         reconciliation holds. On APPROVAL lockedBalance drops
 *                         with nothing accounting for it — so every member who
 *                         completed a withdrawal reported a permanent balance
 *                         mismatch, and reported it correctly, because the
 *                         ledger genuinely did not account for the money.
 *
 *   getCooperativeStats   `else if (t.type === "withdrawal") totalSavings -=
 *                         amount` — a branch that never fired, so the admin
 *                         dashboard reported the cooperative still holding money
 *                         it had already paid out.
 *
 *   the member history    its "Withdrawals" filter matched nothing.
 *
 * This is the same defect the fixed-savings pass fixed for its own rows, under
 * the same reasoning: "a reconciliation check that always fails for a whole
 * class of member is a check nobody reads".
 *
 * The row is written on APPROVAL, which is the point the money actually leaves:
 * a rejection puts it back, and a pending request is still the member's.
 *
 * AND THE ADMIN FILTER NAMED A TYPE NOTHING WRITES
 * ------------------------------------------------
 * getAdminTransactionsAction filtered `type in [..., "fixed_savings"]`. The row
 * is `fixed_savings_lock` — which is also what forensics.ts reconciles against
 * — so every fixed savings plan was excluded from the admin transactions list
 * by a filter that looked like it included them.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ADMIN_MONEY = 'src/app/actions/cooperative/_coop_admin_money.ts';
const REPORTS = 'src/app/actions/cooperative/_coop_admin_reports.ts';
const FORENSICS = 'src/app/actions/forensics.ts';
const CREATE_SAVINGS = 'src/app/api/cooperative/create-fixed-savings/route.ts';
const HISTORY_PAGE = 'src/app/cooperatives/(member)/history/page.tsx';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

describe('the readers that expected a withdrawal row', () => {
    it('reconciliation counts it as a debit', () => {
        // THE premise, and the reason this is a correctness defect rather than
        // a reporting nicety.
        expect(code(FORENSICS)).toContain('const DEBIT_TYPES = ["withdrawal", "fixed_savings_lock"];');
        expect(code(FORENSICS)).toContain('calculatedBalance -= amount;');
    });

    it('and it reconciles against savingsBalance PLUS lockedBalance', () => {
        // Which is why the row belongs at approval, not at request: the request
        // moves money between those two fields and leaves the sum alone.
        expect(code(FORENSICS)).toContain('lockedBalance');
    });

    it('and the admin dashboard subtracts it from the cooperative total', () => {
        expect(code(REPORTS)).toContain('} else if (t.type === "withdrawal") {');
        expect(code(REPORTS)).toContain('totalSavings -= amount;');
    });

    it('and the member history offers it as a filter', () => {
        expect(readFileSync(join(process.cwd(), HISTORY_PAGE), 'utf-8'))
            .toContain('<option value="withdrawal">Withdrawals</option>');
    });
});

describe('approving a withdrawal writes the ledger row', () => {
    const approve = fn(ADMIN_MONEY, 'approveWithdrawalAction');

    it('of the type every reader was looking for', () => {
        // THE test.
        expect(approve).toContain('COLLECTIONS.COOPERATIVE_TRANSACTIONS');
        expect(approve).toContain('type: "withdrawal",');
        expect(approve).toContain('status: "completed",');
    });

    it('keyed on the withdrawal, so a retry overwrites rather than duplicates', () => {
        expect(approve).toContain('const ledgerReference = `coopwd_${withdrawalId}`;');
        expect(approve).toContain('.doc(ledgerReference).set({');
    });

    it('for the amount that actually left', () => {
        expect(approve).toContain('amount,');
        expect(approve).toContain('userId,');
    });

    it('after the lockedBalance it accounts for has moved', () => {
        const drop = approve.indexOf('lockedBalance: FieldValue.increment(-amount)');
        const ledger = approve.indexOf('type: "withdrawal",');

        expect(drop).toBeGreaterThan(-1);
        expect(ledger).toBeGreaterThan(drop);
    });

    it('and the rejection path writes none, because nothing left', () => {
        // Vacuity guard: a reject restores savingsBalance and clears
        // lockedBalance, so the sum is unchanged and a debit row would make the
        // reconciliation wrong in the other direction.
        const reject = fn(ADMIN_MONEY, 'rejectWithdrawalAction');

        expect(reject).toContain('savingsBalance: FieldValue.increment(amount)');
        expect(reject).not.toContain('type: "withdrawal",');
    });
});

describe('the admin transactions filter', () => {
    it('names the fixed-savings type that is actually written', () => {
        const admin = code(ADMIN_MONEY);

        expect(admin).toContain('["contribution", "withdrawal", "loan", "fixed_savings_lock"]');
        expect(admin).not.toContain('"loan", "fixed_savings"]');
    });

    it('which is the type the writer produces and reconciliation reads', () => {
        // Vacuity guard on both ends.
        expect(code(CREATE_SAVINGS)).toContain('type: "fixed_savings_lock",');
        expect(code(FORENSICS)).toContain('"fixed_savings_lock"');
    });
});
