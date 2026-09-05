/**
 * @jest-environment node
 */

/**
 *   #400 A WALLET CHECKOUT THAT TAKES THE MONEY AND LEAVES THE ORDER UNPAID.
 *
 *   From #399's pending list, which called out the money paths by name. This is
 *   the one among them that is not merely unwired but dangerous.
 *
 *   THE HALF IT IMPLEMENTS IS CAREFUL
 *   ----------------------------------
 *   #91 replaced the caller-controlled amount with the order's own totalAmount
 *   — in the debit AND in both ledger rows, the half-applied fix being the
 *   original defect. The debit goes through debitWalletOnce keyed on
 *   `order:<id>`, so a double submit charges once. Ownership is checked before
 *   money moves.
 *
 *   THE HALF IT DOES NOT IMPLEMENT IS THE REST OF A PURCHASE
 *   --------------------------------------------------------
 *   No order status write. No escrow rows. No platform fee (#271). No
 *   notification. A buyer paying this way is charged, two ledger rows record
 *   `status: "completed"`, and the order sits unpaid with nothing behind it for
 *   the seller to be paid from. Reconciliation reads exactly those rows to
 *   decide whether a payment produced what it should have, so the loss is
 *   recorded as a success — the shape of #102 and #337, with real money.
 *
 *   AND IT IS NOT A MISSING BUTTON. /marketplace/checkout offers one method,
 *   and its own state says so: `useState<"paystack">("paystack")`, a type with a
 *   single member. Payment goes to Paystack; _payment_verify.ts then creates the
 *   escrow rows per seller, with the fee split and the deterministic escrowIdFor
 *   id, and moves the order. Wallet payment is a feature whose fulfilment half
 *   was never written, so adding the button on top of this action is the
 *   shortest route to taking a customer's money and giving them nothing.
 *
 *   WHAT ELSE THE MONEY SWEEP FOUND, AND WHY IT WAS LEFT ALONE
 *   -----------------------------------------------------------
 *   processLoanRepaymentAction is the counter-example that makes the rule
 *   legible. It is also unreached, also moves money — and it is COMPLETE:
 *   debitWalletLocked, ownership and state checked first, the loan updated,
 *   completion measured against everything repaid so far (#212, #286). It does
 *   what it says. Being unwired is a gap in the product, not a defect in the
 *   code, so it keeps its verdict and no flag. Retiring is only a fix when the
 *   thing retired is wrong — #384, cutting the other way.
 *
 *   The two alternate order creators in _payment_orders.ts turned out to be
 *   #379's offline checkouts, already retired behind MARKETPLACE_OFFLINE_CHECKOUT.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the refusal is dropped                        KILLED
 *     the refusal moves below the debit              KILLED
 *     the flag accepts any truthy value              KILLED
 *     the refusal stops naming the missing half      KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    MARKETPLACE_WALLET_CHECKOUT_ENV,
    MARKETPLACE_WALLET_CHECKOUT_ENABLED_VALUE,
    MARKETPLACE_WALLET_CHECKOUT_REFUSAL,
    isMarketplaceWalletCheckoutEnabled,
} from '@/lib/marketplace-wallet-checkout';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

const WALLET = join(SRC, 'app/actions/wallet.ts');
const CHECKOUT = join(SRC, 'app/marketplace/checkout/page.tsx');
const LOANS = join(SRC, 'app/actions/loan-actions.ts');

/**
 * The body of a named function, comments stripped, bounded by an END MARKER.
 *
 * A fixed character span was the first draft and it was wrong: the negative
 * assertions below overran the end of _walletCheckoutAction into the wallet
 * funding action next to it, which legitimately writes `amount: amountNGN`. An
 * assertion that a function does NOT do something has to stop where the
 * function does — the same mistake #397's patch assertion made against the
 * audit metadata a few lines past its write.
 */
function body(file: string, fn: string, end: string): string {
    const src = code(file);
    const at = src.indexOf(`function ${fn}(`);
    expect({ fn, found: at > -1 }).toEqual({ fn, found: true });
    const stop = src.indexOf(end, at);
    expect({ fn, bounded: stop > at }).toEqual({ fn, bounded: true });
    return src.slice(at, stop);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#400 — the finding: it charges and does not fulfil', () => {
    it('IT DEBITS THE WALLET', () => {
        const fn = body(WALLET, '_walletCheckoutAction', 'export const walletCheckoutAction');
        expect(fn).toContain('debitWalletOnce(');
        expect(fn).toContain('purpose: "marketplace_checkout"');
    });

    it('and it writes NO order status, NO escrow, NO fee, NO notification', () => {
        /**
         * The absences are the finding, so they are asserted directly. Scoped to
         * this function rather than the file — wallet.ts does plenty of other
         * things, and a file-wide scan would find them and prove nothing.
         */
        const fn = body(WALLET, '_walletCheckoutAction', 'export const walletCheckoutAction');
        expect(fn).not.toMatch(/MARKETPLACE_ORDERS\)\.doc\([^)]*\)\.update\(/);
        expect(fn).not.toContain('ESCROW_TRANSACTIONS');
        expect(fn).not.toContain('platformFeeFor');
        expect(fn).not.toMatch(/notify[A-Z]/);

        // Control for the four negatives: the function IS found and IS the one
        // that moves money, so "not present" means absent rather than mislocated.
        expect(fn).toContain('MARKETPLACE_ORDERS');
        expect(fn.length).toBeGreaterThan(500);
    });

    it('and the live checkout offers one method, which is not the wallet', () => {
        const page = code(CHECKOUT);
        // The type has a single member — the screen cannot offer anything else.
        expect(page).toContain('useState<"paystack">("paystack")');
        expect(page).not.toContain('walletCheckoutAction');
    });

    it('and the live path DOES create escrow with the deterministic id', () => {
        // What fulfilment looks like when it is written, for contrast.
        const verify = code(join(SRC, 'app/actions/marketplace/_payment_verify.ts'));
        expect(verify).toContain('escrowIdFor(');
        expect(verify).toContain('COLLECTIONS.ESCROW_TRANSACTIONS');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#400 — retired at the door, kept behind a flag', () => {
    it('THE REFUSAL COMES BEFORE THE SCHEMA PARSE AND THE DEBIT', () => {
        const fn = body(WALLET, '_walletCheckoutAction', 'export const walletCheckoutAction');
        const refusalAt = fn.indexOf('isMarketplaceWalletCheckoutEnabled()');
        const parseAt = fn.indexOf('WalletCheckoutSchema.parse(');
        const debitAt = fn.indexOf('debitWalletOnce(');

        expect(refusalAt).toBeGreaterThan(-1);
        expect({ beforeParse: refusalAt < parseAt }).toEqual({ beforeParse: true });
        expect({ beforeDebit: refusalAt < debitAt }).toEqual({ beforeDebit: true });
    });

    it('and the flag takes one exact word, not any truthy value', () => {
        const original = process.env[MARKETPLACE_WALLET_CHECKOUT_ENV];
        try {
            for (const value of ['1', 'true', 'yes', 'ENABLED', 'enabled ', '']) {
                process.env[MARKETPLACE_WALLET_CHECKOUT_ENV] = value;
                expect({ value, on: isMarketplaceWalletCheckoutEnabled() })
                    .toEqual({ value, on: false });
            }
            delete process.env[MARKETPLACE_WALLET_CHECKOUT_ENV];
            expect(isMarketplaceWalletCheckoutEnabled()).toBe(false);

            process.env[MARKETPLACE_WALLET_CHECKOUT_ENV] = MARKETPLACE_WALLET_CHECKOUT_ENABLED_VALUE;
            expect(isMarketplaceWalletCheckoutEnabled()).toBe(true);
        } finally {
            if (original === undefined) delete process.env[MARKETPLACE_WALLET_CHECKOUT_ENV];
            else process.env[MARKETPLACE_WALLET_CHECKOUT_ENV] = original;
        }
    });

    it('and the refusal names the missing half, not just "no"', () => {
        // Whoever meets this must not have to discover by experiment that the
        // debit works and the fulfilment does not. #322.
        expect(MARKETPLACE_WALLET_CHECKOUT_REFUSAL).toMatch(/never completes the order/i);
        expect(MARKETPLACE_WALLET_CHECKOUT_REFUSAL).toMatch(/no escrow|creates no escrow/i);
        expect(MARKETPLACE_WALLET_CHECKOUT_REFUSAL).toMatch(/Paystack/);
        expect(MARKETPLACE_WALLET_CHECKOUT_REFUSAL).toMatch(/fulfilment half/i);
    });

    it('and #91\'s repair is KEPT, not deleted', () => {
        // The order's own total, in the debit and in BOTH ledger rows — the
        // half-applied version of this fix was the original defect.
        const fn = body(WALLET, '_walletCheckoutAction', 'export const walletCheckoutAction');
        expect(fn).toContain('amount: orderTotal');
        expect((fn.match(/-orderTotal/g) ?? []).length).toBe(2);
        expect(fn).not.toMatch(/amount:\s*amountNGN/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#400 — the counter-example that was NOT retired', () => {
    it('processLoanRepaymentAction MOVES MONEY AND ALSO COMPLETES ITS JOB', () => {
        /**
         * Also unreached, also a wallet debit — and complete, so it keeps a
         * verdict rather than a flag. Asserting this is what stops "unreached
         * money path" from being read as "retire it".
         */
        const fn = body(LOANS, 'processLoanRepaymentAction', 'repaidAmount: FieldValue.increment');
        expect(fn).toContain('debitWalletLocked(');
        // It updates the loan it was paid against, which is the half wallet
        // checkout is missing.
        expect(fn).toContain('loanRef.update(');
        expect(fn).toContain('repaidAmount');
        // And it is NOT gated.
        expect(fn).not.toContain('isMarketplaceWalletCheckoutEnabled');
    });
});
