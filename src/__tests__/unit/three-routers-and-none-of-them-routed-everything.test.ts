/**
 * @jest-environment node
 */

/**
 *   #531 EIGHT PROCESSORS, TEN TYPE SPELLINGS, THREE ROUTERS — AND NOT ONE OF
 *        THEM DISPATCHED ALL OF THEM. TWO OF THE THREE RECORDED WHAT THEY
 *        COULD NOT ROUTE AS DONE.
 *
 *   infrastructure/payments/service.ts exports EIGHT fulfilment processors,
 *   reached by ten type spellings. Three places route a Paystack payment to
 *   them, each written by hand. Measured from the three dispatch chains — and
 *   the count is eight because the test below derives it from the module rather
 *   than from my reading of it, which said nine:
 *
 *                                          webhook   cron    admin sync
 *     marketplace_order                       Y        Y         Y
 *     export_investment                       Y        Y         Y
 *     cooperative_membership_registration     Y        Y         Y
 *     academy_registration                    Y        Y         Y
 *     wallet_funding                          Y        Y         Y
 *     contribution                            Y        Y         .
 *     farm_nation_registration                .        .         Y
 *     farm_nation_subscription                .        .         Y
 *     wave_registration                       .        .         Y
 *     wave_application                        .        .         Y
 *
 * ── WHAT EACH DID WITH A TYPE IT COULD NOT ROUTE ────────────────────────────
 *
 *   THE WEBHOOK GOT IT RIGHT, and its own comment is the rule the other two
 *   needed: "A type this route does not handle still needs a record, or an
 *   unknown payment vanishes silently. It is claimed explicitly, with a status
 *   that is NOT 'completed' so it is not summed as revenue, and logged loudly
 *   enough to be found."
 *
 *   THE CRON COUNTED IT AS HEALED. Its chain has no else, and the three lines
 *   after it ran unconditionally under the comment "Successfully processed":
 *   `results.firebaseTotal++; firebaseRefs.add(tx.reference); continue;`. The
 *   `continue` skips the `missingInFirebase.push` at the foot of the loop, so
 *   the job whose entire purpose is to surface payments the platform missed was
 *   deleting them from its own discrepancy list — and the health dashboard read
 *   "0 discrepancies, ok".
 *
 *   THE ADMIN SYNC WROTE IT AS COMPLETED. Four readers sum PROCESSED_PAYMENTS
 *   where status is "completed" as revenue (analytics.service twice,
 *   finance.service, the academy course report), and the sync skips any
 *   reference already marked completed. So an unfulfillable payment entered the
 *   revenue figure with nobody credited AND could never be healed on a later
 *   run.
 *
 *   THIS IS THE SHAPE OF THE TWELVE GHOST PAYMENTS. The twelve ₦10,000 payments
 *   of 14–17 May 2026 carry bare Paystack references and no application
 *   metadata, so `metadata.type || metadata.purpose` is null and they take
 *   exactly these two paths — every time either job runs.
 *
 * ── AND TWO SMALLER ONES IN THE SAME BLOCK ──────────────────────────────────
 *
 *   THE SYNC DID NOT WALK THE LEGACY IDENTITY CHAIN. It read
 *   `metadata.userId ?? null` while the webhook and the cron both call
 *   resolveActiveUserId — #449: "on a twice-migrated member the session said one
 *   account and this credited another". This is the MANUAL repair tool, reached
 *   precisely when a payment did not land, so it is the worst of the three
 *   places for that gap to have been.
 *
 *   AND "Already processed" WAS TREATED AS A FAILURE BY TWO OF THREE.
 *   confirmWalletFundingAction returns it from a branch whose own comment says
 *   "A duplicate delivery of a payment already credited. Not an error."
 *   processWalletFunding threw on it, so the cron recorded a discrepancy and the
 *   sync an error, on money that had already reached the member. Only the
 *   webhook special-cased it — and it had to, because Paystack retries a
 *   delivery that answers 500.
 *
 * ── WHY A TABLE AND NOT THREE CORRECTED CHAINS ──────────────────────────────
 *
 *   Three corrected chains is what the last person wrote. payment-router holds
 *   the table; all three ask it; the sweep at the foot of this file asserts that
 *   none of them dispatches by hand any more, so a tenth processor reaches every
 *   door at once.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   THE MISSING TYPES ARE NOT PROOF OF LOST MONEY. academy_enrollment,
 *   property_purchase, fixed_savings_funding and the export order types are
 *   fulfilled by their own verify-on-return actions, not by these routers — I
 *   checked each initiator before writing this, because the first version of
 *   this finding was going to claim the webhook could not fulfil an academy
 *   purchase, and that would have been wrong. What the routers are is the
 *   BACKSTOP for a member who never came back from Paystack, and a backstop that
 *   silently drops what it cannot route is the defect, whatever else also
 *   fulfils it.
 *
 *   NO DRY RUN WAS ADDED to the admin sync. It still fulfils on every press with
 *   no preview, which is why the owner was told not to run it as a diagnostic.
 *   That is a feature with its own design questions, not this fix.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the cron marking an unroutable payment healed     KILLED
 *     the sync writing "completed" again                KILLED
 *     the legacy id walk removed from the sync          KILLED
 *     a type dropped from the shared table              KILLED
 *     the dispatcher returning true for anything        KILLED
 *     "Already processed" treated as a failure again    KILLED
 *     reword this header                                SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

/**
 * payment-router is loaded LAZILY, inside the tests.
 *
 * A static `import` of it at the top of this file pulls in the real
 * payments/service before the jest.mock factory below has taken effect — which
 * it did, and the first run executed processMarketplaceOrder for real against
 * an absent database ("Cannot read properties of undefined (reading 'empty')").
 * That reads exactly like a defect in the router and is a harness ordering
 * problem, so the import is deferred rather than the failure interpreted.
 */
const router = () => import('@/infrastructure/payments/payment-router');

/**
 * The processors, mocked at the module.
 *
 * payment-router imports them statically, and jest.spyOn cannot redefine a
 * non-configurable export under this transform, so a spy set after the fact
 * never reaches the reference the router holds.
 */
jest.mock('@/infrastructure/payments/service', () => ({
    processMarketplaceOrder: jest.fn(async () => undefined),
    processExportInvestment: jest.fn(async () => undefined),
    processCooperativeRegistration: jest.fn(async () => undefined),
    processAcademyRegistration: jest.fn(async () => undefined),
    processCooperativeContribution: jest.fn(async () => undefined),
    processFarmNationRegistration: jest.fn(async () => undefined),
    processWaveRegistration: jest.fn(async () => undefined),
    processWalletFunding: jest.fn(async () => undefined),
    // Real behaviour: the export row passes its result straight to a processor,
    // so a stub returning undefined would hide a wrong argument.
    exportWindowIdFromMetadata: (m: any) => m?.windowId ?? m?.exportId ?? null,
}));

 
const mockProcessors = jest.requireMock('@/infrastructure/payments/service') as Record<string, jest.Mock<any>>;

beforeEach(() => {
    for (const fn of Object.values(mockProcessors)) {
        if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
    }
});

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const WEBHOOK = 'src/app/api/webhooks/paystack/route.ts';
const CRON = 'src/app/api/cron/reconcile-paystack/route.ts';
const SYNC = 'src/app/api/admin/finance/paystack-sync/route.ts';
const ROUTERS = [WEBHOOK, CRON, SYNC];

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — one table, and every type on it', () => {
    it('EVERY TYPE ANY OF THE THREE USED TO ROUTE IS ON IT', async () => {
        const { HANDLED_PAYMENT_TYPES: HANDLED } = await router();
        //   THE test. The union of what the three chains covered, so the
        //   consolidation cannot have quietly dropped one of them.
        for (const type of [
            'marketplace_order', 'export_investment', 'cooperative_membership_registration',
            'academy_registration', 'contribution', 'wallet_funding',
            'farm_nation_registration', 'farm_nation_subscription',
            'wave_registration', 'wave_application',
        ]) {
            expect({ type, handled: HANDLED.has(type) })
                .toEqual({ type, handled: true });
        }
    });

    it('AND EVERY PROCESSOR service.ts EXPORTS IS REACHED BY ONE', () => {
        //   Derived from the module rather than listed: a tenth processor added
        //   to service.ts and forgotten here fails this.
        const service = code('src/infrastructure/payments/service.ts');
        const exported = [...service.matchAll(/export async function (process\w+)\(/g)].map((m) => m[1]);
        const routed = code('src/infrastructure/payments/payment-router.ts');

        //   EIGHT, measured. My reading of the module said nine; deriving it
        //   rather than restating it is what corrected the header above.
        expect(exported.length).toBe(8);
        for (const fn of exported) {
            expect({ fn, reached: routed.includes(fn) }).toEqual({ fn, reached: true });
        }
    });

    it('and the table is not empty or trivially satisfied', async () => {
        //   #484's shape — a control that reads as present and is none.
        const { PAYMENT_ROUTES, HANDLED_PAYMENT_TYPES } = await router();

        expect(PAYMENT_ROUTES.length).toBeGreaterThanOrEqual(8);
        expect(HANDLED_PAYMENT_TYPES.size).toBeGreaterThanOrEqual(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — the dispatcher says whether it did anything', () => {
    const ctx = {
        reference: 'ref-1', amount: 1000, userId: 'u-1',
        metadata: {}, paidAt: undefined,
    };

    const dispatchPaystackPayment = async (type: any, c: any) =>
        (await router()).dispatchPaystackPayment(type, c);

    it('AN UNKNOWN TYPE RETURNS false RATHER THAN LOOKING LIKE SUCCESS', async () => {
        expect(await dispatchPaystackPayment('something_nobody_wrote', ctx)).toBe(false);
    });

    it('AND SO DOES A MISSING ONE — which is what a payment link produces', async () => {
        //   The twelve ghost payments have no application metadata at all, so
        //   `metadata.type || metadata.purpose` is null.
        expect(await dispatchPaystackPayment(null, ctx)).toBe(false);
        expect(await dispatchPaystackPayment(undefined, ctx)).toBe(false);
        expect(await dispatchPaystackPayment('', ctx)).toBe(false);
    });

    it('AND A KNOWN TYPE RUNS ITS PROCESSOR AND RETURNS true', async () => {
        //   The vacuity guard: a dispatcher that returned false for everything
        //   would satisfy both assertions above and fulfil nothing.
        //
        //   jest.spyOn does not work here — the exports are non-configurable
        //   under this transform ("Cannot redefine property"), and the router
        //   binds them at import time anyway — so the module is mocked at the
        //   top of this file instead.
        expect(await dispatchPaystackPayment('marketplace_order', ctx)).toBe(true);
        expect(mockProcessors.processMarketplaceOrder)
            .toHaveBeenCalledWith('ref-1', 1000, 'u-1', undefined);
    });

    it('AND EACH ROW REACHES THE PROCESSOR IT NAMES, NOT SOME OTHER ONE', async () => {
        //   A table is a mapping, and a mapping can be wrong in a way a
        //   handled/not-handled assertion cannot see.
        await dispatchPaystackPayment('contribution', ctx);
        expect(mockProcessors.processCooperativeContribution).toHaveBeenCalled();

        await dispatchPaystackPayment('wave_application', ctx);
        expect(mockProcessors.processWaveRegistration).toHaveBeenCalled();

        await dispatchPaystackPayment('farm_nation_subscription', ctx);
        expect(mockProcessors.processFarmNationRegistration).toHaveBeenCalled();
    });

    it('AND A PROCESSOR THAT REFUSES THROWS — it does not report false', async () => {
        //   The distinction the whole finding turns on. "No processor for this
        //   type" and "the processor refused" need different bookkeeping: one is
        //   a payment nobody can route, the other is one that failed to credit.
        mockProcessors.processMarketplaceOrder.mockImplementationOnce(
            async () => { throw new Error('wallet locked'); },
        );

        await expect(dispatchPaystackPayment('marketplace_order', ctx))
            .rejects.toThrow('wallet locked');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — the cron no longer files an unroutable payment as healed', () => {
    const body = () => code(CRON);

    it('THE HEAL COUNTERS ARE GUARDED BY WHETHER ANYTHING RAN', () => {
        //   They used to run unconditionally after a chain with no else, under
        //   the comment "Successfully processed".
        const src = body();

        expect(src).toContain('const healed = await dispatchPaystackPayment(');
        expect(src).toContain('if (healed) {');
    });

    it('AND THE HEAL COUNTER IS INSIDE THAT GUARD, NOT AFTER IT', () => {
        //   Position, not presence: an `if (healed)` written above three lines
        //   that still run regardless would read as a fix and be none.
        const src = body();
        const guard = src.indexOf('if (healed) {');
        const counter = src.indexOf('results.firebaseTotal++', guard);
        const closeBrace = src.indexOf('continue;', guard);

        expect(guard).toBeGreaterThan(-1);
        expect(counter).toBeGreaterThan(guard);
        expect(counter).toBeLessThan(closeBrace);
    });

    it('AND IT DISPATCHES BY HAND NOWHERE', () => {
        expect(body()).not.toMatch(/type === "marketplace_order"/);
    });

    it('and it still reports a discrepancy at the foot of the loop', () => {
        //   The vacuity guard from the other side: if the push were removed,
        //   nothing would be reported either way.
        expect(body()).toContain('results.missingInFirebase.push(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — the sync no longer calls an unroutable payment revenue', () => {
    const body = () => code(SYNC);

    it('IT WRITES THE WEBHOOK\'S STATUS, NOT "completed"', () => {
        //   THE test for this door. Four readers sum completed payments as
        //   revenue, and this route skips a completed reference for ever after.
        const src = body();

        expect(src).toContain('status: UNHANDLED_PAYMENT_STATUS');
        expect(src).not.toMatch(/status: "completed"/);
    });

    it('AND THAT STATUS IS NOT ONE THE REVENUE READERS COUNT', async () => {
        //   Measured against the readers rather than asserted about the writer.
        const { UNHANDLED_PAYMENT_STATUS } = await router();

        expect(UNHANDLED_PAYMENT_STATUS).not.toBe('completed');
        for (const reader of [
            'src/services/analytics.service.ts',
            'src/services/finance.service.ts',
        ]) {
            expect(code(reader)).not.toContain(UNHANDLED_PAYMENT_STATUS);
        }
    });

    it('AND AN UNROUTABLE PAYMENT IS NOT COUNTED AS SYNCED', () => {
        const src = body();

        expect(src).toContain('unhandled++');
        expect(src).toContain('unhandledReferences.push(reference)');
    });

    it('AND THE ADMIN IS TOLD ABOUT THEM', () => {
        //   These are payments a person made that nothing on this platform knows
        //   how to fulfil. That is the one result of this job needing a human.
        expect(body()).toContain('unhandledReferences: unhandledReferences.slice(0, 50)');
    });

    it('AND IT WALKS THE LEGACY IDENTITY CHAIN LIKE THE OTHER TWO', () => {
        //   #449. This route read metadata.userId raw while both siblings
        //   resolved it — on the manual repair tool.
        expect(body()).toContain('resolveActiveUserId(rawUserId');
    });

    it('and the audit row says what the run DID, not just what it read', () => {
        //   It recorded `{ total }` alone on an operation that grants roles,
        //   activates memberships and credits wallets.
        const src = body();
        const meta = src.slice(src.indexOf("action: 'paystack_sync_run'"));

        expect(meta.slice(0, 400)).toContain('synced');
        expect(meta.slice(0, 400)).toContain('unhandled');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — "Already processed" is not a failure', () => {
    it('THE PROCESSOR RETURNS RATHER THAN THROWING', () => {
        //   confirmWalletFundingAction's own comment: "A duplicate delivery of a
        //   payment already credited. Not an error." Two of the three callers
        //   recorded it as one, on money the member already had.
        const src = code('src/infrastructure/payments/service.ts');
        const fn = src.slice(src.indexOf('export async function processWalletFunding'));

        expect(fn.slice(0, 900)).toContain('if (reason === "Already processed")');
    });

    it('AND A REAL REFUSAL STILL THROWS', () => {
        //   #298's rule, which must survive: a wallet credit that did not happen
        //   is never counted as fulfilled.
        const src = code('src/infrastructure/payments/service.ts');
        const fn = src.slice(src.indexOf('export async function processWalletFunding'));

        expect(fn.slice(0, 900)).toContain('throw new Error(reason)');
    });

    it('and the webhook no longer carries its own copy of that tolerance', () => {
        //   It special-cased the string inline. One rule, in the processor.
        expect(code(WEBHOOK)).not.toContain('res.error !== "Already processed"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#531 — the ratchet: no door dispatches by hand', () => {
    it('ALL THREE ASK THE SHARED DISPATCHER', () => {
        for (const r of ROUTERS) {
            expect({ r, uses: code(r).includes('dispatchPaystackPayment(') })
                .toEqual({ r, uses: true });
        }
    });

    it('AND NONE OF THEM COMPARES A PAYMENT TYPE ITSELF', () => {
        //   The ratchet. A fourth router, or a new branch bolted onto one of
        //   these, is how the three came to disagree in the first place.
        for (const r of ROUTERS) {
            const offenders = [...code(r).matchAll(/type === "(\w+)"/g)].map((m) => m[1]);
            expect({ r, offenders }).toEqual({ r, offenders: [] });
        }
    });

    it('AND THE SWEEP READ REAL FILES', () => {
        //   #484's shape again — an empty or mistyped path list makes both
        //   assertions above pass for ever.
        for (const r of ROUTERS) {
            const src = code(r);
            expect(src.length).toBeGreaterThan(1500);
            expect(src).toContain('payment-router');
        }
    });

    it('and nothing outside the table imports a processor directly', () => {
        //   Not a ban on service.ts — the verify-on-return actions legitimately
        //   call their own processors. This is about the three RECONCILIATION
        //   doors, which must all go through one table.
        for (const r of ROUTERS) {
            expect(code(r)).not.toMatch(/from "@\/infrastructure\/payments\/service"/);
        }
    });
});
