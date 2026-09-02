/**
 * @jest-environment node
 */

/**
 *   #332 THE WALLET STATEMENT LISTED MONEY THAT IS NOT IN THE WALLET, AS A ROW
 *        THAT DOES NOT SATISFY THE TYPE IT IS READ BACK AS.
 *
 *        order-management.ts credits a WAVE seller's commission:
 *
 *            await sellerRef.update({
 *                'serviceRegistrations.wave.waveEarningsBalance':
 *                    FieldValue.increment(earningsAmount), ... });
 *
 *            await txnRef.set({
 *                walletId: sellerId, userId: sellerId,
 *                type: "credit", module: "wave",
 *                amount: earningsAmount, status: "completed", ... });
 *
 *        The money goes to waveEarningsBalance — a separate pot, withdrawn
 *        through wave/_wv_admin_withdrawals.ts, never becoming wallet balance.
 *        The RECORD goes into wallet_transactions.
 *
 *        getWalletTransactionsAction selects on `userId` alone, with no module
 *        filter, so /dashboard/wallet renders that row beside fundings and
 *        purchases. `isDebit` is `txn.amount < 0`, so it shows as a green
 *        "+₦N" — while the balance card above it comes from the wallet, which
 *        never received it. A seller adding up the statement cannot reconcile
 *        it with the figure at the top of the page.
 *
 *        AND THE ROW IS OUTSIDE ITS OWN TYPE
 *
 *            type: "credit"          not a member of WalletTransactionType
 *            balanceBefore/After     declared REQUIRED, both absent
 *            module                  written, typed nowhere
 *
 *        serializeDocs<WalletTransaction>() casts, so the compiler never saw
 *        it — the shape of #256. The clearest evidence the type was wrong is
 *        in the UI itself: the wallet page has always guarded
 *        `balanceBefore !== undefined` before rendering the pair, so the code
 *        knew the field could be missing while the type said it never could.
 *
 * SEVERITY, STATED PLAINLY: presentational. No money is misdirected — WAVE
 * earnings are credited correctly and are withdrawable through the WAVE flow.
 * Both FinanceService functions that would have summed this ledger into a
 * balance (deriveUserBalance, deriveMarketplaceWalletBalance) have no callers,
 * so nothing decides money from the inflated total.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    walletLedgerMovesBalance,
    NON_WALLET_LEDGER_MODULES,
} from '@/lib/types/marketplace';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#332 — which rows moved the wallet balance', () => {
    it('A WAVE EARNINGS ROW DID NOT', () => {
        expect(walletLedgerMovesBalance({ module: 'wave' })).toBe(false);
    });

    it('and every ordinary wallet movement did', () => {
        // The twelve writers that do move the wallet write no module, or a
        // module that is not in the non-wallet list.
        expect(walletLedgerMovesBalance({ module: undefined })).toBe(true);
        expect(walletLedgerMovesBalance({})).toBe(true);
        expect(walletLedgerMovesBalance({ module: 'escrow' })).toBe(true);
        expect(walletLedgerMovesBalance({ module: 'marketplace' })).toBe(true);
    });

    it('VACUITY GUARD: the exclusion list is not empty', () => {
        // A predicate that answers true for everything would pass the test
        // above while restoring the defect.
        expect(NON_WALLET_LEDGER_MODULES.length).toBeGreaterThan(0);
        expect(NON_WALLET_LEDGER_MODULES).toContain('wave');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#332 — the row the WAVE credit actually writes', () => {
    const src = source('src/app/actions/order-management.ts');

    it('credits waveEarningsBalance — a pot that is NOT the wallet', () => {
        expect(src).toMatch(/serviceRegistrations\.wave\.waveEarningsBalance/);
        expect(src).toMatch(/FieldValue\.increment\(earningsAmount\)/);
    });

    it('and marks the ledger row so a reader can tell', () => {
        // The marker the predicate reads. It was already written; nothing
        // consumed it.
        expect(src).toMatch(/module:\s*"wave"/);
    });

    it('the pot it credits has its own withdrawal path, not the wallet', () => {
        // Couples the claim to the other end: WAVE earnings are withdrawn from
        // waveEarningsBalance directly, so they never become wallet money.
        const withdrawals = source('src/app/actions/wave/_wv_admin_withdrawals.ts');
        expect(withdrawals).toMatch(/serviceRegistrations\.wave\.waveEarningsBalance/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#332 — the type now admits what the writers produce', () => {
    const types = source('packages/marketplace/src/types.ts');

    it('"credit" IS A MEMBER OF WalletTransactionType', () => {
        const union = types.slice(
            types.indexOf('export type WalletTransactionType'),
            types.indexOf('export interface Wallet'),
        );
        expect(union).toMatch(/\|\s*"credit"/);
    });

    it('balanceBefore and balanceAfter are OPTIONAL, because they are', () => {
        const iface = types.slice(
            types.indexOf('export interface WalletTransaction {'),
            types.indexOf('export const NON_WALLET_LEDGER_MODULES'),
        );
        expect(iface).toMatch(/balanceBefore\?: number;/);
        expect(iface).toMatch(/balanceAfter\?: number;/);
        // The declaration that was wrong.
        expect(iface).not.toMatch(/balanceBefore: number;/);
        expect(iface).not.toMatch(/balanceAfter: number;/);
    });

    it('and `module` is typed rather than written into a shape that omits it', () => {
        const iface = types.slice(
            types.indexOf('export interface WalletTransaction {'),
            types.indexOf('export const NON_WALLET_LEDGER_MODULES'),
        );
        expect(iface).toMatch(/module\?: string;/);
    });

    it('POSITIVE CONTROL: those slices are real regions, not empty strings', () => {
        expect(types.indexOf('export type WalletTransactionType')).toBeGreaterThan(-1);
        expect(types.indexOf('export interface WalletTransaction {')).toBeGreaterThan(-1);
        expect(types.indexOf('export const NON_WALLET_LEDGER_MODULES')).toBeGreaterThan(-1);
        expect(types.indexOf('export interface WalletTransaction {'))
            .toBeLessThan(types.indexOf('export const NON_WALLET_LEDGER_MODULES'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#332 — the statement says which rows are not wallet money', () => {
    const page = source('src/app/dashboard/wallet/page.tsx');

    it('THE WALLET PAGE CONSULTS THE PREDICATE', () => {
        expect(page).toMatch(/walletLedgerMovesBalance\(txn\)/);
    });

    it('and tells the reader the amount is not in the balance above', () => {
        expect(page).toMatch(/not included in your wallet balance/);
    });

    it('the row is still shown — it is the seller\'s record of what they earned', () => {
        // The fix is a label, not a filter. Hiding the row would remove the
        // only place a WAVE seller sees the credit.
        expect(page).not.toMatch(/\.filter\([^)]*walletLedgerMovesBalance/);
    });

    it('the balance card still comes from the wallet, not from summing rows', () => {
        expect(page).toMatch(/wallet\?\.balance/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#332 — the totals that would have been wrong have no callers', () => {
    /**
     * Both FinanceService derivations sum every completed wallet_transactions
     * row for a user, which would include the WAVE credit. Neither is called
     * from anywhere, which is why this finding is presentational rather than a
     * money defect — and this test is what would tell a future reader if that
     * changed.
     */
    it('nothing INVOKES deriveUserBalance or deriveMarketplaceWalletBalance', () => {
        // Invocation, not mention. The names also appear in
        // packages/services/src/contracts.ts, which DECLARES them on
        // FinanceServiceContract — a signature, not a call — and in
        // finance.service.ts, which defines them. Matching `name(` with an
        // argument is what separates a caller from a declaration.
        const { execSync } = require('child_process');
        const hits = execSync(
            "grep -rn 'deriveUserBalance(\\|deriveMarketplaceWalletBalance(' src packages " +
            "--include=*.ts --include=*.tsx || true",
            { encoding: 'utf-8' },
        )
            .split('\n')
            .filter(Boolean)
            // The definitions and the interface signature, which take a typed
            // parameter rather than passing one.
            .filter((l: string) => !/\(userId: string\)/.test(l))
            .filter((l: string) => !l.includes('__tests__'))
            // finance.service.ts itself: the two instance methods delegate to
            // the statics. Internal plumbing, not a consumer — the claim is
            // that nothing OUTSIDE the service asks for these figures.
            .filter((l: string) => !l.startsWith('src/services/finance.service.ts:'));

        expect(hits).toEqual([]);
    });

    it('and they do sum the ledger, which is why that matters', () => {
        const svc = source('src/services/finance.service.ts');
        expect(svc).toMatch(/balance \+= \(data\.amount \|\| 0\)/);
    });
});
