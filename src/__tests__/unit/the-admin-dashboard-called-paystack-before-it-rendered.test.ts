/**
 * @jest-environment node
 */

/**
 *   #699 THE ADMIN DASHBOARD SWEPT AN EXTERNAL PAYMENT API, SEQUENTIALLY,
 *        BEFORE IT WOULD RENDER.
 *
 *   Reported by the owner: the admin portal takes more than ten seconds to
 *   load. #696 had narrowed the reads and claimed the cause was payload size.
 *   That claim was wrong about this page, and this finding is the correction.
 *
 *   DashboardClient blocks the whole screen on one call:
 *
 *       if (loading) return <full-screen spinner>
 *
 *   so the page's load time IS getDashboardStats. And inside it, three separate
 *   sweeps of Paystack's HTTP API sit on the critical path:
 *
 *     getPlatformMetrics        eachPaystackSuccess, NO maxPages
 *     getDashboardStats         eachPaystackSuccess, maxPages 5, timeout 3000
 *     getFinancialOverview      eachPaystackSuccess, NO maxPages, timeout 3000
 *
 *   lib/paystack-sweep pages SEQUENTIALLY — `while (page <= maxPages)`, one
 *   awaited fetch each — with MAX_REVENUE_PAGES = 100 and a default timeout of
 *   6000 ms. So /admin runs two sweeps and /admin/finance a third, each walking
 *   Paystack 100 transactions at a time, one round trip after another, before
 *   anything is drawn.
 *
 *   THE COST IS LINEAR IN TRANSACTIONS AND GROWS FOREVER. A few thousand
 *   payments is dozens of serial HTTPS calls to a third party on every cold
 *   load. The dashboard's own comment had already priced it:
 *
 *       "Raising the cap costs 3s per extra page on a dashboard load; summing
 *        from processed_payments instead would be exact and fast. That is a
 *        product call, so it is reported rather than taken."
 *
 *   The product call has now been made, by the owner, in the form of a
 *   ten-second page.
 *
 * ── THE DATABASE PATH WAS ALREADY WRITTEN, AND IS THE BETTER ONE ────────────
 *
 *   Every one of the three already had a complete `if (!paystackSuccess)`
 *   fallback reading `processed_payments` with server-side aggregates — and
 *   the fallback is not a degraded answer, it is a better one. getPlatformMetrics
 *   says so itself:
 *
 *       "The aggregate below is computed by the database over the whole table,
 *        so the fallback figure is never a partial one."
 *
 *   The Paystack path is CAPPED and reports `revenueIsPartial` when it truncates.
 *   The database path is exact, one query, and #455 already made it read the
 *   native `amount` column. The slow source was also the less accurate one.
 *
 * ── WHY READING THE LEDGER IS CORRECT, NOT A SHORTCUT ───────────────────────
 *
 *   The obvious objection is that Paystack is the real money and the database is
 *   this platform's opinion of it. That is exactly what reconciliation is for,
 *   and it already exists: cron/reconcile-paystack sweeps Paystack and compares
 *   it against processed_payments, and #677 made it return 409 when it finds
 *   money missing rather than reporting success. #531 made all three dispatch
 *   doors agree.
 *
 *   So the division of labour is: the LEDGER is what the dashboard reads, and
 *   RECONCILIATION is what proves the ledger matches Paystack. Putting a live
 *   API sweep on a page render does not make the number more true — it makes it
 *   slower, capped, and dependent on a third party being up. If the two diverge,
 *   the reconciler is the thing that must say so, and it does.
 *
 *   THE SWEEPS ARE NOT DELETED. lib/paystack-sweep keeps every caller whose job
 *   is genuinely to compare against Paystack:
 *
 *       api/cron/reconcile-paystack      the scheduled reconciliation
 *       api/admin/finance/reconcile      the admin's on-demand comparison
 *
 *   Neither renders a page.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join } from 'path';

const ROOT = process.cwd();
const ADMIN = 'admin-1';

function setSession(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null,
    }));
}

/** Answers every database read with an empty-but-well-formed result. */
function quietDb() {
    const empty = {
        exists: false, empty: true, size: 0, docs: [],
        data: () => ({ count: 0, total: 0, totalRevenue: 0, totalTransactions: 0 }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(empty));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(empty));
}

describe('#699 — rendering an admin page makes no call to Paystack', () => {
    const realFetch = (global as any).fetch;
    const realKey = process.env.PAYSTACK_SECRET_KEY;
    let calls: string[];

    beforeEach(() => {
        jest.clearAllMocks();
        //   THE precondition. With no secret the sweeps are skipped anyway, so a
        //   test that forgot to set this would pass against the defect.
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_699';
        quietDb();
        setSession(ADMIN, ['admin']);

        calls = [];
        (global as any).fetch = jest.fn(async (url: any) => {
            calls.push(String(url));
            return { ok: true, json: async () => ({ status: true, meta: {}, data: [] }) };
        });
    });

    afterEach(() => {
        (global as any).fetch = realFetch;
        if (realKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = realKey;
    });

    const paystackCalls = () => calls.filter((u) => u.includes('api.paystack.co'));

    it('THE DASHBOARD DOES NOT SWEEP PAYSTACK', async () => {
        const { getDashboardStatsAction } = await import('@/app/actions/admin-analytics');
        await getDashboardStatsAction();

        //   Named, not counted: a failure should say which endpoint was called.
        expect({ paystack: paystackCalls() }).toEqual({ paystack: [] });
    });

    it('AND NEITHER DOES THE FINANCIAL OVERVIEW', async () => {
        const { getFinancialOverviewAction } = await import('@/app/actions/admin-analytics');
        await getFinancialOverviewAction();

        expect({ paystack: paystackCalls() }).toEqual({ paystack: [] });
    });

    it('AND THE SECRET WAS SET, SO THE SWEEPS WERE NOT MERELY SKIPPED', () => {
        //   THE control on the two assertions above. Both are satisfied by a
        //   deployment with no Paystack key at all, which is the one situation
        //   in which the defect could never have shown.
        expect(process.env.PAYSTACK_SECRET_KEY).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#699 — and the sweep survives where it belongs', () => {
    const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

    it('THE PAGE-RENDER SERVICE NO LONGER IMPORTS THE SWEEP', () => {
        /*
         *   The behavioural tests above prove the calls are gone for the two
         *   entry points they drive. This says the capability is gone from the
         *   whole file, so a third page cannot quietly acquire it.
         *
         *   READ WITH COMMENTS STRIPPED, because the first version of this
         *   assertion failed against the finding's OWN HEADER — three of the
         *   comments explaining why the sweep was removed name it. This audit
         *   has a standing entry for that trap and I walked into it again; the
         *   cure is the recorded one.
         */
        const src = stripComments(read('src/services/analytics.service.ts'), {
            label: 'analytics.service.ts',
        });
        expect(src).not.toContain('eachPaystackSuccess');
        //   The import too, which is what would let it come back by accident.
        expect(src).not.toContain('paystack-sweep');
    });

    it('AND RECONCILIATION STILL HAS IT — this is not a deletion', () => {
        /*
         *   THE other control. "No page calls Paystack" is trivially satisfied
         *   by removing the sweep from the codebase, which would blind the one
         *   job whose entire purpose is comparing the ledger against Paystack.
         */
        //   ANCHORED ON THE IMPORT, NOT THE IDENTIFIER. The first version asked
        //   each file to contain `eachPaystackSuccess`, and a mutant that
        //   replaced the import with a local stub of the same name SURVIVED it —
        //   the assertion was satisfied by the stub's own declaration. What
        //   matters is the dependency on the real helper, so that is what is
        //   asserted.
        for (const route of [
            'src/app/api/cron/reconcile-paystack/route.ts',
            'src/app/api/admin/finance/reconcile/route.ts',
        ]) {
            const src = read(route);
            expect({ route, sweeps: /eachPaystackSuccess/.test(src) }).toEqual({ route, sweeps: true });
            expect({ route, fromHelper: src.includes('@/lib/paystack-sweep') })
                .toEqual({ route, fromHelper: true });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     the dashboard sweeps Paystack again                             KILLED
 *     the suite stops setting PAYSTACK_SECRET_KEY                      KILLED
 *     the reconciler loses its import of the sweep helper              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the header                                            SURVIVED ✓
 *
 *   THE THIRD MUTANT SURVIVED FIRST, AND THE TEST WAS WRONG. "Reconciliation
 *   still sweeps" asked each route to CONTAIN `eachPaystackSuccess`, so a mutant
 *   that deleted the import and declared a local stub of the same name passed
 *   it — the assertion was satisfied by the stub's own declaration rather than
 *   by the dependency it exists to protect. This audit's recurring shape, in my
 *   own control. Anchored on the import from `@/lib/paystack-sweep` instead, it
 *   is killed.
 *
 *   That control matters more than it looks: "no admin page calls Paystack" is
 *   trivially satisfied by deleting the sweep from the codebase, which would
 *   blind the one job whose entire purpose is comparing the ledger against
 *   Paystack.
 */
