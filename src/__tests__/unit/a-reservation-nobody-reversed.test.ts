/**
 *   #613 A RESERVATION IS A DEBIT, AND TWO CHECKOUT PATHS NEVER PUT IT BACK.
 *
 *   #612 asked whether a single write landed. This asks the harder question:
 *   what is left behind when the second of two writes fails.
 *
 *   `decrementManyOrFail` takes units out of `availableQuantity` BEFORE the
 *   order rows are written. That ordering is correct — reserving after writing
 *   oversells — and /marketplace's checkout says so:
 *
 *       // Reserved BEFORE the order rows are written, so a failure here
 *       // creates nothing.
 *
 *   True of the ORDER, and silent about the STOCK. The transaction that follows
 *   throws on "Product not found", on "OUT OF STOCK", on a timeout — and nothing
 *   put the units back. No order existed and the goods were gone from the shelf.
 *
 *   IT ACCUMULATES, which is what raises it above a tidy-up. A product loses a
 *   unit of availability on every failed checkout, permanently, until it reads
 *   zero and cannot be bought while sitting in the seller's warehouse. No screen
 *   would explain why, because every screen is reading the number correctly.
 *
 * ── AND THE LEDGER ROW THE RETRY GUARANTEED WOULD NEVER BE WRITTEN ──────────
 *
 *   /wallet checkout debits with `debit_wallet_once` and then writes two ledger
 *   rows as separate round trips. A failure between them left the wallet charged
 *   with no purchase row — and the idempotent retry returned early on
 *   `already_processed`, BEFORE those writes, so every retry stepped over the
 *   gap instead of closing it. The gap was permanent by construction.
 *
 *   That early return is right about the money and wrong about the record. The
 *   money must not move twice; the row must exist exactly once. Both are now
 *   true: the rows carry an id derived from the order, so writing them again is
 *   a no-op, and `already_processed` falls through to ensure they are there.
 *
 * ── WHAT WAS EXAMINED AND LEFT ALONE ────────────────────────────────────────
 *
 *   Eleven debit sites looked uncompensated at first. Widening the search from a
 *   fixed character window to the enclosing FUNCTION took it to four, and two of
 *   those four are deliberate:
 *
 *     processLoanRepaymentAction writes its ledger row last on purpose, and says
 *     why — "a crash here leaves money moved and the loan credited, with a
 *     missing receipt — recoverable. Writing it first would leave a receipt for a
 *     repayment that never happened." The money and the loan agree; only the
 *     global receipt is missing. That is a stated trade, not an oversight, and
 *     relabelling it a defect would be dishonest.
 *
 *     _withdrawFromWalletAction already reverses its debit — the search missed it
 *     because the code says "reversal" and the pattern looked for "compensate".
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function bodyOf(src: string, fn: string): string {
    const start = src.indexOf(`async function ${fn}`);
    if (start === -1) throw new Error(`no ${fn}`);
    const after = src.slice(start + 10);
    const next = after.search(/\n(export )?async function /);
    return src.slice(start, next === -1 ? undefined : start + 10 + next);
}

describe('#613 — a reservation that fails is a reservation put back', () => {
    const ledger = read('src/lib/wallet-ledger.ts');

    it('THERE IS A WAY TO PUT RESERVED STOCK BACK', () => {
        expect(ledger).toContain('export async function restoreReservedStock(');
        //   Through the same mechanism every other counter moves by. A second,
        //   parallel way to move one number is how two paths come to disagree —
        //   compensateJsonbDebit says so directly above it.
        expect(bodyOf(ledger, 'restoreReservedStock')).toContain('FieldValue.increment(item.amount)');
    });

    it('AND IT NEVER REPLACES THE FAILURE THAT CAUSED IT', () => {
        const body = bodyOf(ledger, 'restoreReservedStock');
        //   It runs on a path that is already failing. Throwing here would hide
        //   the original error behind a worse one — the contract
        //   compensateJsonbDebit states and this one keeps.
        expect(body).toContain('catch');
        expect(body).not.toMatch(/\bthrow\b/);
        //   But the units really are still gone, so a silent failure is not
        //   acceptable either.
        expect(body).toContain('COULD NOT RESTORE STOCK');
    });

    it.each([
        ['src/app/actions/orders.ts', '_createOrderAction'],
        ['src/app/actions/marketplace/_payment_orders.ts', '_createPaymentOnDeliveryOrderAction'],
    ])('%s restores what it reserved when the rest fails', (file, fn) => {
        const body = bodyOf(read(file), fn);
        expect(body).toContain('decrementManyOrFail');
        expect(body).toContain('restoreReservedStock(reserved');
        //   In the CATCH, not on the happy path — restoring after a success
        //   would hand back stock that a real order is holding.
        const catchAt = body.indexOf('catch');
        expect(body.indexOf('restoreReservedStock(reserved')).toBeGreaterThan(catchAt);
    });

    it('AND A REFUSED RESERVATION HAS NOTHING TO RESTORE', () => {
        //   `decrement_many_or_fail` is all-or-nothing (migration 015), so a
        //   refusal decremented nothing and handing units back would CREATE
        //   stock. The same fix in the other direction is still a defect.
        const body = bodyOf(read('src/app/actions/marketplace/_payment_orders.ts'),
            '_createPaymentOnDeliveryOrderAction');
        expect(body).toMatch(/if \(!stock\.ok\) \{[\s\S]*?reserved = \[\];/);
    });
});

describe('#613 — the wallet ledger row a retry used to step over', () => {
    const wallet = read('src/app/actions/wallet.ts');
    const body = bodyOf(wallet, '_walletCheckoutAction');

    it('THE LEDGER ROWS CARRY AN ID DERIVED FROM THE ORDER, NOT A RANDOM ONE', () => {
        //   A random id makes every retry a NEW row, so repairing the gap would
        //   have created duplicates instead of closing it.
        expect(body).toContain('doc(`checkout-${orderId}`)');
        expect(body).not.toMatch(/const txnRef = db\.collection\(TXN_COLLECTION\)\.doc\(\);/);
    });

    it('AND `already_processed` NO LONGER RETURNS BEFORE THEM', () => {
        //   The money must not move twice and the row must exist exactly once.
        //   The early return got the first right by giving up on the second.
        expect(body).not.toMatch(/already_processed[\s\S]{0,200}?return \{ error: null, success: true/);
        expect(body).toContain('ensuring the ledger rows exist');
        //   And it still refuses a genuine shortfall, which is the other
        //   direction the same edit could have broken.
        expect(body).toContain('Insufficient wallet balance');
    });

    it('AND BOTH ROWS ARE WRITTEN WITH merge, SO A SECOND RUN IS A NO-OP', () => {
        expect(body.match(/\{ merge: true \}/g) ?? []).toHaveLength(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     createOrderAction: delete the restore                          KILLED
 *     createPaymentOnDeliveryOrderAction: delete the restore         KILLED
 *     restore even when the reservation was REFUSED                  KILLED
 *     restoreReservedStock: increment by -amount (debit again)       KILLED
 *     restoreReservedStock: rethrow, hiding the original failure     KILLED
 *     wallet checkout: back to a random ledger id                    KILLED
 *     wallet checkout: restore the early `already_processed` return  KILLED
 *     wallet checkout: drop one `{ merge: true }`                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   No mutant survived. Two are worth naming because they are the same fix in
 *   the wrong direction, which is the failure mode a compensation invites:
 *   restoring after a REFUSED reservation would create stock that nobody had,
 *   and incrementing by a negative would debit twice under a reassuring name.
 */
