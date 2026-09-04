/**
 * @jest-environment node
 */

/**
 * Money debited under a lock, then lost when the next write failed.
 *
 * THE WINDOW
 * ----------
 * debitJsonbBalance and debitJsonbBalanceWithFloor take the money under a row
 * lock, and that part is sound — several earlier passes fixed the read-then-write
 * races that used to sit there.
 *
 * What follows a debit is not one operation but several separate round trips:
 * move the amount into lockedBalance, write the request row, write the ledger
 * entries, write the audit log. The Firestore-compat adapter flushes them one at
 * a time — the comment in cooperative/_coop_money.ts says so outright: "the
 * adapter flushes them one by one regardless" — and there is no transaction
 * spanning the RPC and the adapter.
 *
 * So a timeout or dropped connection after the debit left the member's savings
 * reduced with nothing to show for it: no locked balance, no pending request,
 * nothing for an admin to approve or reject, and the member told only "Failed to
 * submit withdrawal request". The money was simply gone from their balance.
 *
 * ALL NINE DEBIT SITES had a bare `catch` that logged and returned. Not one put
 * the money back.
 *
 * WHY A COMPENSATING CREDIT
 * -------------------------
 * The writes span the RPC and the adapter, which share no transaction, so there
 * is nothing to roll back. A credit is what is available, and it is safe
 * wherever the post-debit work is purely local writes with no external effect
 * and nothing claimed.
 *
 * THE ONE SITE DELIBERATELY LEFT ALONE
 * ------------------------------------
 * repayLoanFromSavingsAction debits savings and then calls
 * submitRepaymentAction, which claims the reference through claimPaymentOnce.
 * A failure there may have come AFTER the claim landed, so crediting the savings
 * back would leave the member with their money AND a claimed repayment reference
 * that reconciliation can later treat as paid. That is the same double-credit
 * hazard that made the WAVE payout rollback a defect (#34), so it stays a manual
 * settlement with a log that carries everything needed for one.
 *
 * THE SECOND SITE, ADDED BY #380, WHICH IS NOT MONEY AT ALL
 * ---------------------------------------------------------
 * decideExportBookingAction (actions/export-booking.ts) calls the same helper,
 * but the field is `currentVolume` on an export window — kilograms of capacity,
 * not a member's balance — and the call IS ITSELF THE COMPENSATION. The booking
 * reserved that volume through incrementWithinCeiling in the same file; the
 * cancel gives it back.
 *
 * Compensating it would re-reserve capacity for a booking that has just been
 * cancelled, which is the defect #380 was written to fix, not a safeguard. So
 * the exclusion here rests on a different fact from the repayment one, and the
 * tests below check that fact rather than accepting the file name.
 *
 * This suite scans for the rule rather than listing the sites, so a tenth debit
 * added later cannot quietly skip it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['src/app/actions', 'src/app/api'];
const DEBITS = ['debitJsonbBalance(', 'debitJsonbBalanceWithFloor('];

/** The one MONEY site where compensation would be wrong, and why. */
const DELIBERATELY_MANUAL = 'src/app/actions/cooperative/_loans_repayments.ts';

/** #380 — not money: the debit gives capacity back, so it IS the compensation. */
const IS_ITSELF_A_COMPENSATION = 'src/app/actions/export-booking.ts';

/** Both exclusions, in the order the scan finds them. */
const NOT_COMPENSATED = [DELIBERATELY_MANUAL, IS_ITSELF_A_COMPENSATION].sort();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** Every file that debits a JSONB balance, and whether it compensates. */
function debitSites(): Array<{ file: string; compensates: boolean }> {
    const found: Array<{ file: string; compensates: boolean }> = [];

    for (const root of ROOTS) {
        for (const file of walk(join(process.cwd(), root))) {
            const src = stripComments(readFileSync(file, 'utf-8'));
            if (!DEBITS.some((d) => src.includes(d))) continue;

            found.push({
                file: relative(process.cwd(), file),
                compensates: src.includes('compensateJsonbDebit({'),
            });
        }
    }

    return found;
}

describe('the compensation helper', () => {
    const helper = stripComments(
        readFileSync(join(process.cwd(), 'src/lib/wallet-ledger.ts'), 'utf-8')
    );

    it('exists', () => {
        expect(helper).toContain('export async function compensateJsonbDebit(');
    });

    it('credits through the same mechanism a reject already uses', () => {
        // FieldValue.increment, applied in SQL by migration 010 — not a second,
        // parallel way to move the same number.
        const fn = helper.slice(helper.indexOf('export async function compensateJsonbDebit('));

        expect(fn).toContain('FieldValue.increment(amount)');
        expect(fn).toContain('await import("./supabase-db")');
    });

    it('can reverse a partial reservation as well as the debit', () => {
        // `locked` at the call sites decides whether lockedBalance moved; a
        // blanket reversal would take a counter that was never raised.
        const fn = helper.slice(helper.indexOf('export async function compensateJsonbDebit('));

        expect(fn).toContain('also?: Record<string, number>');
        expect(fn).toContain('FieldValue.increment(delta)');
    });

    it('does not throw when the compensation itself fails', () => {
        // The caller is already handling a failure; masking it with a second
        // one helps nobody. It logs at error with everything needed by hand.
        const fn = helper.slice(helper.indexOf('export async function compensateJsonbDebit('));

        expect(fn).toContain('COMPENSATION FAILED');
        expect(fn).toContain('Needs manual reconciliation');

        // The whole catch block, not a fixed-width window after it — the log
        // call inside is longer than any window I first guessed at, so the
        // original assertion passed against a re-added `throw`.
        const body = fn.slice(fn.indexOf('} catch (err) {'));
        const catchBlock = body.slice(0, body.indexOf('\n}'));
        expect(catchBlock).not.toContain('throw');
    });
});

describe('every debit site', () => {
    const sites = debitSites();

    it('is found at all — the scan is not vacuous', () => {
        expect(sites.length).toBeGreaterThanOrEqual(7);
    });

    it('either compensates, or is one of the two that deliberately do not', () => {
        // THE test.
        const uncompensated = sites.filter((s) => !s.compensates).map((s) => s.file).sort();

        expect(uncompensated).toEqual(NOT_COMPENSATED);
    });

    it('and the repayment one says why, so it is not "fixed" later', () => {
        const src = readFileSync(join(process.cwd(), DELIBERATELY_MANUAL), 'utf-8');

        expect(src).toContain('DELIBERATELY NOT COMPENSATED');
        expect(src).toContain('claimPaymentOnce');
        expect(src).toContain('double-credit');
    });

    it('which is a real distinction, not an excuse', () => {
        // Vacuity guard: the excluded site really does call an action that
        // claims a payment reference, and the compensated ones really do not.
        const excluded = stripComments(readFileSync(join(process.cwd(), DELIBERATELY_MANUAL), 'utf-8'));
        expect(excluded).toContain('submitRepaymentAction({');

        for (const site of sites.filter((s) => s.compensates)) {
            const src = stripComments(readFileSync(join(process.cwd(), site.file), 'utf-8'));
            expect(src).not.toContain('claimPaymentOnce(');
        }
    });

    it('and the export one says why, on its own separate ground', () => {
        // Two exclusions with one shared excuse would be a rule with a hole in
        // it. This one's reason is stated in its own words, and #380 names it.
        const src = readFileSync(join(process.cwd(), IS_ITSELF_A_COMPENSATION), 'utf-8');

        expect(src).toContain('THIS DEBIT IS THE COMPENSATION');
        expect(src).toContain('#380');
    });

    it('which is true of it: the debit is the reverse of a reservation in the same file', () => {
        // THE vacuity guard on that exclusion. The claim is that the release
        // undoes incrementWithinCeiling on the same collection and field, so
        // both halves have to be here, on `currentVolume`, and the balance
        // helpers that move a member's money must not be.
        const src = stripComments(readFileSync(join(process.cwd(), IS_ITSELF_A_COMPENSATION), 'utf-8'));

        expect(src).toContain('incrementWithinCeiling({');
        expect(src).toContain('debitJsonbBalanceWithFloor({');
        expect((src.match(/field: "currentVolume"/g) ?? []).length).toBe(2);

        // Not a wallet, not a savings balance — nothing a member is owed.
        expect(src).not.toContain('creditWalletOnce(');
        expect(src).not.toContain('claimPaymentOnce(');
        expect(src).not.toContain('lockedBalance');
    });

    it('and it is floored, because a hand-repaired window must not go negative', () => {
        const src = stripComments(readFileSync(join(process.cwd(), IS_ITSELF_A_COMPENSATION), 'utf-8'));

        // WithFloor, not the unfloored debit — the distinction is the point.
        expect(src).toContain('floor: 0,');
        expect(src).not.toContain('debitJsonbBalance({');
    });
});

describe('the three withdrawal doors', () => {
    // The comment in cooperative/_withdrawal.ts calls these "the third door onto
    // the same balance". All three had the same gap.
    const DOORS = [
        'src/app/actions/cooperative/_withdrawal.ts',
        'src/app/actions/cooperative/_coop_money.ts',
        'src/app/actions/platform.ts',
        'src/app/api/cooperative/withdraw/route.ts',
    ];

    it.each(DOORS)('%s reverses the lockedBalance it raised', (rel: string) => {
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));

        expect(src).toContain('locked ? { also: { lockedBalance:');
    });

    it.each(DOORS)('%s tracks how far it got before compensating', (rel: string) => {
        // Reversing lockedBalance that was never raised drives it negative —
        // the exact defect an earlier pass fixed on the admin side.
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));

        expect(src).toContain('let locked = false;');
        expect(src).toContain('locked = true;');
    });
});
