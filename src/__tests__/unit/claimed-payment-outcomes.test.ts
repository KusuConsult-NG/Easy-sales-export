/**
 * @jest-environment node
 */

/**
 *   #259 THE EXPORT INVESTMENT VERIFIER WAS THE LAST PLACE THAT CALLED A
 *        DUPLICATE A FAILURE — AND THE ONLY CLAIM SITE WITH NO WAY TO RECORD A
 *        FULFILMENT THAT DIED.
 *
 * Two halves of one shape, in one file.
 *
 * HALF ONE — a duplicate is not an error.
 *
 *   Every payment path on this platform claims its Paystack reference with
 *   claimPaymentOnce, and a claim that loses means the payment was ALREADY
 *   APPLIED — by the webhook, or by an earlier delivery of the same callback.
 *   The money moved. Telling the payer "Payment already processed" as an ERROR
 *   after they have been charged is the outcome this codebase has fixed four
 *   times over:
 *
 *     academy/_payment.ts:287           syncs the enrolment, reports success
 *     academy/_payment.ts:554           "nothing to do", reports success
 *     api/cooperative/verify-payment    syncs the docs, reports success
 *     academy/_ac_course_payment.ts     repairs the enrolment (#258)
 *
 *   export/_ex_investments.ts was missed:
 *
 *       if (!claim.claimed) {
 *           return { success: false, error: "Payment already processed" };
 *       }
 *
 *   The same "the fix landed on one module and not its siblings" shape as #83.
 *
 * HALF TWO — a fulfilment that dies after the claim must be visible.
 *
 *   lib/wallet-ledger.ts exports markFulfilmentFailed for exactly this: the
 *   claim is taken BEFORE fulfilment (so a duplicate webhook cannot fulfil
 *   twice), which means a failure AFTER it leaves money collected and nothing
 *   delivered. Seven files import it. This one did not, and its catch logged
 *   and returned "Failed to verify investment" — so the payment sat in
 *   processed_payments marked "completed", invisible to reconciliation, with no
 *   investment behind it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

const verifyPaystackPayment = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
    initializePaystackPayment: jest.fn(async () => ({})),
}));

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
const markFulfilmentFailed = jest.fn(async (_r: string, _reason: string) => undefined);
const incrementWithinCeiling = jest.fn(async (_a: unknown) => ({ ok: true, applied: true }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    markFulfilmentFailed: (r: string, reason: string) => markFulfilmentFailed(r, reason),
    incrementWithinCeiling: (a: unknown) => incrementWithinCeiling(a),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    creditWalletOnce: jest.fn(async () => ({ claimed: true })),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const INVESTOR = 'investor-1';
const WINDOW = 'export-window-1';
const AMOUNT = 500_000;
const REF = 'PSK_EXPORT_1';

let store: FakeDbHandle;
const actions = async () => await import('@/app/actions/export/_ex_investments');

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();

    store.seed(COLLECTIONS.EXPORT_WINDOWS, WINDOW, {
        id: WINDOW, commodity: 'Sesame', fundingGoal: 10_000_000, fundedAmount: 0, status: 'open',
    });

    mockRequireSession.mockResolvedValue({
        session: { user: { id: INVESTOR, email: 'i@e.test', roles: ['export_participant'] } },
        error: null,
    });

    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    verifyPaystackPayment.mockResolvedValue({
        status: true,
        data: {
            status: 'success',
            amount: AMOUNT * 100,
            metadata: { type: 'export_investment', exportId: WINDOW, userId: INVESTOR, amount: AMOUNT },
        },
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#259 — an already-applied investment', () => {
    it('IS REPORTED AS SUCCESS, NOT AS "Payment already processed"', async () => {
        // The investor has been charged and the investment IS recorded — by the
        // webhook, or by an earlier delivery of this callback. Telling them it
        // failed is the outcome four sibling paths already fixed.
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await (await actions()).verifyExportInvestmentAction(REF) as any;

        expect(res.success).toBe(true);
        expect(String(res.error ?? '')).not.toMatch(/already processed/i);
    });

    it('and still refuses a payment whose amount does not match', async () => {
        // The duplicate branch must not become a way past the amount check —
        // the check runs before the claim, so it still bites.
        verifyPaystackPayment.mockResolvedValue({
            status: true,
            data: {
                status: 'success',
                amount: (AMOUNT - 100_000) * 100,
                metadata: { type: 'export_investment', exportId: WINDOW, userId: INVESTOR, amount: AMOUNT },
            },
        });
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await (await actions()).verifyExportInvestmentAction(REF) as any;
        expect(res.success).toBe(false);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('a genuine first investment still succeeds', async () => {
        // Vacuity guard: the assertions above must not be satisfied by a
        // function that reports success for everything.
        const res = await (await actions()).verifyExportInvestmentAction(REF) as any;
        expect(res.success).toBe(true);
        expect(claimPaymentOnce).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#259 — a fulfilment that dies after the claim', () => {
    it('IS RECORDED AS fulfilment_failed, NOT JUST LOGGED', async () => {
        // The claim is taken before fulfilment so a duplicate webhook cannot
        // fulfil twice. That makes a failure AFTER it "money collected, nothing
        // delivered" — which has to reach reconciliation.
        const { supabaseDb } = require('@/lib/supabase-db');
        const realCollection = supabaseDb.collection.bind(supabaseDb);
        jest.spyOn(supabaseDb, 'collection').mockImplementation((name: unknown) => {
            if (name === COLLECTIONS.EXPORT_SLOTS) {
                throw new Error('ECONNRESET: connection terminated unexpectedly');
            }
            return realCollection(name as string);
        });

        const res = await (await actions()).verifyExportInvestmentAction(REF) as any;

        expect(res.success).toBe(false);
        // Was: logged and returned, with the payment left marked "completed" and
        // no investment behind it.
        expect(markFulfilmentFailed).toHaveBeenCalledWith(REF, expect.any(String));
    });

    it('and does not mark one when fulfilment succeeded', async () => {
        await (await actions()).verifyExportInvestmentAction(REF);
        expect(markFulfilmentFailed).not.toHaveBeenCalled();
    });

    it('nor when the failure happened BEFORE the claim', async () => {
        // Nothing was collected in our name yet, so there is nothing to
        // reconcile — marking it would put noise in the queue a human works.
        verifyPaystackPayment.mockResolvedValue({
            status: true, data: { status: 'failed', amount: AMOUNT * 100, metadata: {} },
        });

        await (await actions()).verifyExportInvestmentAction(REF);
        expect(markFulfilmentFailed).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#259 — the rule, across every claim site', () => {
    /**
     * A ratchet rather than three pinned files: claimPaymentOnce is how every
     * payment on this platform is settled, and a new caller inheriting either
     * half of this defect is the way it comes back.
     */
    function sourceFiles(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry === '__tests__' || entry === 'testing') continue;
                sourceFiles(full, out);
            } else if (/\.tsx?$/.test(entry)) out.push(full);
        }
        return out;
    }

    /** Source with comments removed, so a docstring cannot satisfy or trip a check. */
    function codeOnly(src: string): string {
        return src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter(l => !l.trim().startsWith('//'))
            .map(l => l.replace(/\s\/\/.*$/, ''))
            .join('\n');
    }

    const claimSites = sourceFiles(join(process.cwd(), 'src'))
        .filter(f => !f.endsWith('wallet-ledger.ts'))
        .filter(f => /\bclaimPaymentOnce\s*\(/.test(readFileSync(f, 'utf-8')))
        // Comments stripped: every one of these files now DOCUMENTS the defect
        // it used to have, quoting the old code verbatim. Scanning the raw text
        // would match the explanation and report the fix as the bug — the trap
        // strip-comments.test.ts exists for.
        .map(f => ({ file: f.replace(process.cwd() + '/', ''), text: codeOnly(readFileSync(f, 'utf-8')) }));

    it('finds the claim sites, so the checks below are not vacuous', () => {
        expect(claimSites.length).toBeGreaterThan(5);
    });

    it('NONE REPORTS AN ALREADY-CLAIMED PAYMENT AS A FAILURE', () => {
        const offenders = claimSites.filter(({ text }) => {
            const idx = text.indexOf('if (!claim.claimed)');
            if (idx === -1) return false;
            const branch = text.slice(idx, idx + 600);
            return /error:\s*["'`]Payment already processed/.test(branch);
        }).map(c => c.file);

        // Was: ["src/app/actions/export/_ex_investments.ts"].
        expect(offenders).toEqual([]);
    });

    /**
     * The one claim site that legitimately does not need it, with the reason
     * recorded rather than the rule quietly weakened.
     *
     * api/webhooks/paystack/route.ts claims a reference ONLY for a payment type
     * it does not handle — a bookkeeping row with status "unhandled_type", where
     * no fulfilment is attempted, so none can fail. The types it DOES handle are
     * fulfilled by infrastructure/payments/service.ts, which claims and marks on
     * its own. And its catch returns HTTP 500 rather than swallowing, so
     * Paystack retries the delivery: the retry IS the recovery, and a
     * reconciliation row would be noise in a queue a person works by hand.
     */
    const NEEDS_NO_MARKER = new Set(['src/app/api/webhooks/paystack/route.ts']);

    it('AND EVERY ONE CAN RECORD A FULFILMENT THAT DIED', () => {
        // markFulfilmentFailed is the codebase's own answer to "claimed, then
        // the fulfilment threw". A claim site that cannot call it has no way to
        // tell reconciliation that money was taken and nothing delivered.
        const offenders = claimSites
            .filter(({ file }) => !NEEDS_NO_MARKER.has(file))
            .filter(({ text }) => !text.includes('markFulfilmentFailed'))
            .map(c => c.file);

        // Was: _ex_investments, both academy payment files, and the cooperative
        // verify route.
        expect(offenders).toEqual([]);
    });

    it('and the exemption is real — that file still exists and still claims', () => {
        // An allowlist entry for a file that has moved or stopped claiming is a
        // rule with a hole in it that nothing reports.
        for (const file of NEEDS_NO_MARKER) {
            expect(claimSites.map(c => c.file)).toContain(file);
        }
    });
});
