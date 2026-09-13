/**
 * @jest-environment node
 */

/**
 * Total revenue could silently report the last hundred transactions — in three
 * separate places.
 *
 * `getFinancialOverview` sums every successful Paystack transaction by paging
 * the API, and decided when to stop like this:
 *
 *     const totalPages = json.meta?.pageCount ?? 1;
 *     if (page >= totalPages || data.length === 0) break;
 *
 * **If Paystack omits `meta.pageCount` for any reason, that defaults to ONE**
 * and the loop breaks after the first page. Total revenue then reports the sum
 * of the hundred most recent successful transactions and presents it as the
 * platform's lifetime figure, with nothing to indicate it stopped early.
 *
 * A quietly wrong number is worse than a slow one, and this is the number an
 * operator would use to decide whether the business is working.
 *
 * The page count was also unbounded in the other direction: on a platform with
 * 41,000 users this is potentially hundreds of sequential external calls on a
 * single admin dashboard load, every time the two-minute cache expires.
 *
 * THREE COPIES, WHICH IS THE REAL POINT
 * -------------------------------------
 * The first version of the test below asserted the old expression was gone from
 * the file and FAILED after the fix. I assumed I had matched my own explanatory
 * comment, as happened to the #105 ratchet one change earlier. I had not: there
 * were two more copies of the identical bug in the same file —
 * `getPlatformMetrics` (the shared helper behind the admin dashboard) and the
 * twelve-month revenue chart. I had fixed one and been about to ship it as done.
 *
 * `getPlatformMetrics` was the worse of the two. Beyond `?? 1`, it fetched pages
 * 2..pageCount with `Promise.all` and NO bound — a reported count of 500 meant
 * 499 concurrent requests to Paystack from one dashboard load.
 *
 * All three now share one `eachPaystackSuccess` helper. That is deliberate:
 * export-aggregation.ts says it plainly — "fixing one copy and leaving its
 * siblings is how this class keeps surviving" — and three copies of one stop
 * condition is how a fix to one of them means nothing.
 *
 * WHAT WAS NOT CHANGED
 * --------------------
 * The monthly chart caps itself at 5 pages, commented "to prevent slow API
 * response or timeouts" at 3s per page. That is a real latency decision somebody
 * took, so it is kept and only the stop condition is fixed — a missing pageCount
 * was cutting an already-capped chart from 500 transactions to 100.
 *
 * The cap itself is still a silent truncation: twelve months drawn from the most
 * recent 500 transactions makes early months read low. Raising it costs 3s per
 * page on a dashboard load, and summing from processed_payments would be both
 * exact and fast. That is a product call, so it is reported, flagged via
 * `monthlyRevenueIsPartial`, and left.
 *
 * WHAT IT DOES NOW
 * ----------------
 * A short page ends the loop, whatever the metadata says — that is the real
 * signal. `pageCount` is used when present and is no longer able to end the
 * loop by being ABSENT. A hard ceiling bounds the work, and reaching it sets
 * `revenueIsPartial` on the payload rather than returning a floor as a total —
 * the same choice supabase-db.ts makes when `.all()` hits its own ceiling.
 *
 * WHAT WAS CHECKED AND FOUND CORRECT
 * ----------------------------------
 * Two things that looked like the defects this audit keeps finding, and were
 * not:
 *
 *   The Firestore fallback queries
 *   `PROCESSED_PAYMENTS.where("status", "==", "completed")`, and
 *   claim_payment_once stores status inside `raw_data`, not as a column — so
 *   this looked like the "query a field nothing writes" class of #118, #132 and
 *   #139. It is not: supabase-db.ts maps any field outside the known column
 *   list to `raw_data->>'field'`, which is exactly what this needs.
 *
 *   `totalLoansDisbursed` sums `amount` on LOAN_APPLICATIONS, and loan-actions.ts
 *   does write `amount`. Also fine.
 *
 * Both verified rather than assumed, because assuming either way has been wrong
 * before in this audit.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Session expired' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

/** A Paystack page of `n` successful transactions of ₦100 each. */
function page(n: number, meta?: Record<string, any>) {
    return {
        ok: true,
        json: async () => ({
            status: true,
            data: Array.from({ length: n }, () => ({ amount: 10_000 })),
            ...(meta ? { meta } : {}),
        }),
    };
}

/**
 * Records the pages of the REVENUE SWEEP requested, answering each via `responder`.
 *
 * getFinancialOverview also fires three `perPage=1` probes to read the success,
 * failed and abandoned counts out of `meta.total`. Those are single-row requests,
 * not sweep pages, and counting them as pages made the assertions below off by
 * three — so only `perPage=100` requests are recorded.
 */
function mockPaystack(responder: (pageNum: number) => any) {
    const seen: number[] = [];
    (global as any).fetch = jest.fn(async (url: any) => {
        const u = String(url);
        if (!u.includes('api.paystack.co')) {
            return { ok: true, json: async () => ({ status: true, meta: {}, data: [] }) };
        }
        const params = new URL(u).searchParams;
        if (params.get('perPage') !== '100') {
            // A count probe: report zero so it cannot add to totalRevenue.
            return { ok: true, json: async () => ({ status: true, meta: { total: 0 }, data: [] }) };
        }
        const n = Number(params.get('page') ?? '1');
        seen.push(n);
        return responder(n);
    });
    return seen;
}

/** Answers every database read with an empty result. */
function quietDb() {
    const empty = { exists: false, empty: true, size: 0, docs: [], data: () => ({ count: 0, total: 0, totalRevenue: 0, totalTransactions: 0 }) };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(empty));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(empty));
}

describe('the revenue paging loop', () => {
    const realFetch = (global as any).fetch;
    const realKey = process.env.PAYSTACK_SECRET_KEY;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paging';
        quietDb();
        setSession(ADMIN, ['admin']);
    });

    afterEach(() => {
        (global as any).fetch = realFetch;
        if (realKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = realKey;
    });

    /**
     *   #699 — DRIVEN AT THE HELPER, NOT THROUGH THE DASHBOARD.
     *
     *   These four tests used to call getFinancialOverviewAction, because that
     *   is where the paging loop was reached from. #699 removed every Paystack
     *   sweep from the page-render paths — up to 100 sequential round trips to a
     *   third party, on a screen behind a full-screen spinner — so an admin
     *   action is no longer a route to this behaviour.
     *
     *   THE BEHAVIOUR STILL MATTERS and is still reached: cron/reconcile-paystack
     *   and api/admin/finance/reconcile both sweep, and both depend on every
     *   property below. #519's defect — `pageCount ?? 1` reading one page and
     *   calling it the platform's lifetime revenue — would be just as wrong in a
     *   reconciler as it was on a dashboard.
     *
     *   So they now test the unit that OWNS the loop. That is where they always
     *   belonged: a paging bug was being asserted through a finance screen, and
     *   the coupling is what made them break when the screen stopped paging.
     */
    async function sweep(opts: Record<string, unknown> = {}) {
        const { eachPaystackSuccess } = await import('@/lib/paystack-sweep');
        let totalRevenue = 0;
        const result = await eachPaystackSuccess(
            'sk_test_paging',
            { label: 'PagingTest', ...opts },
            (tx: any) => { totalRevenue += (tx.amount / 100); },
        );
        return { totalRevenue, revenueIsPartial: result.truncated, pagesRead: result.pagesRead };
    }

    it('keeps paging when the API sends no pageCount at all', async () => {
        // THE test. `?? 1` made "no metadata" indistinguishable from "one page",
        // and the difference between those two readings is the whole figure.
        // Page 1 is full and carries no meta, so the old code stopped here.
        const seen = mockPaystack((n) => (n === 1 ? page(100) : page(3)));

        const r = await sweep();

        expect(seen).toContain(2);
        // 100 full + 3 = 103 transactions at ₦100 each.
        expect(r.totalRevenue).toBe(10_300);
    });

    it('stops on a short page, which is the real end-of-data signal', async () => {
        const seen = mockPaystack(() => page(40, { pageCount: 999 }));

        const r = await sweep();

        // pageCount claims 999 pages; 40 rows says otherwise and wins.
        expect(seen).toEqual([1]);
        expect(r.totalRevenue).toBe(4_000);
    });

    it('still honours pageCount when the API does send it', async () => {
        // Ignoring it entirely would page to the ceiling on every single call.
        const seen = mockPaystack(() => page(100, { pageCount: 3 }));

        await sweep();

        expect(seen).toEqual([1, 2, 3]);
    });

    it('bounds the sweep and reports a capped total as partial', async () => {
        // Every page full, and pageCount never arrives: without a ceiling this
        // never terminates.
        const seen = mockPaystack(() => page(100));

        const r = await sweep();

        expect(seen.length).toBe(100);
        // The distinction the whole change is about: a floor is labelled a
        // floor rather than returned as the platform's lifetime revenue.
        expect(r.revenueIsPartial).toBe(true);
    });

    it('does not call a complete total partial', async () => {
        // Vacuity guard. A flag that is always true says nothing.
        mockPaystack(() => page(10, { pageCount: 1 }));

        const r = await sweep();

        expect(r.revenueIsPartial).toBe(false);
    });
});

describe('the same bug had two siblings in the same file', () => {
    it('has no copy of the old stop condition left in code', async () => {
        // Reading the file is what exposed the siblings: the behavioural test
        // above covers getFinancialOverview only, and passed while two more
        // copies sat in getPlatformMetrics and the monthly chart.
        //
        // Comment lines are stripped because the fix's own comments quote the
        // old expression to explain it — the same trap the #105 ratchet hit.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        //   #519 widened from one file to the tree, for the same reason as the
        //   assertion below it: the fourth copy of this expression was in a
        //   route, and a check that reads analytics.service.ts could not see it.
        const { readdirSync, statSync } = await import('fs');
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const p = join(dir, entry);
                if (statSync(p).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(p);
                } else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p);
            }
        };
        walk(join(process.cwd(), 'src'));

        const offenders = files.filter((file) => {
            const code = readFileSync(file, 'utf-8')
                .split('\n')
                .filter((line) => {
                    const t = line.trim();
                    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
                })
                .join('\n');
            return code.includes('pageCount ?? 1');
        });

        expect(offenders).toEqual([]);
    });

    it('routes every Paystack revenue sweep in the TREE through the one helper', async () => {
        //   #519 THIS ASSERTION USED TO READ ONE FILE, AND THAT IS WHY IT MISSED
        //   THE FOURTH COPY.
        //
        //   It said "If a fourth sweep is added later it has to come past this"
        //   — and then counted paged URLs in src/services/analytics.service.ts
        //   only. The fourth sweep was not added later; it was already sitting
        //   in src/app/api/admin/finance/reconcile/route.ts, ending on
        //   `json.meta?.pageCount ?? 1`, in the one route that diffs money
        //   against Paystack. A ratchet scoped to the file that happened to be
        //   fixed cannot see the sibling it was written to catch.
        //
        //   The helper is lib/paystack-sweep.ts now, and this sweeps src/.
        const { readFileSync, readdirSync, statSync } = await import('fs');
        const { join, relative } = await import('path');

        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const p = join(dir, entry);
                if (statSync(p).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(p);
                } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
                    files.push(p);
                }
            }
        };
        walk(join(process.cwd(), 'src'));

        // A paged sweep is a URL with a VARIABLE page number. Fixed
        // `perPage=1&page=1` count probes are single-row reads, not sweeps, so
        // they are excluded by construction rather than by exception.
        const PAGED_URL = /\/transaction\?perPage=\$\{|perPage=100&page=\$\{/;
        const offenders: string[] = [];
        for (const file of files) {
            const src = readFileSync(file, 'utf-8');
            if (!PAGED_URL.test(src)) continue;
            if (relative(process.cwd(), file) === join('src', 'lib', 'paystack-sweep.ts')) continue;
            offenders.push(relative(process.cwd(), file));
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP ACTUALLY LOOKED AT THE TREE', async () => {
        //   The vacuity guard the previous version needed and did not have: an
        //   assertion that walks a directory passes trivially if the walk finds
        //   nothing. #484's and #486's shape — a control that reads as present
        //   and is none.
        const { readFileSync, readdirSync, statSync } = await import('fs');
        const { join } = await import('path');

        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const p = join(dir, entry);
                if (statSync(p).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(p);
                } else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p);
            }
        };
        walk(join(process.cwd(), 'src'));

        expect(files.length).toBeGreaterThan(500);
        // The helper exists, is importable, and is where the one URL lives.
        const sweep = readFileSync(join(process.cwd(), 'src/lib/paystack-sweep.ts'), 'utf-8');
        expect(sweep).toContain('export async function eachPaystackTransaction');
        expect(sweep).toContain('export const eachPaystackSuccess');
        expect(sweep).toMatch(/\/transaction\?perPage=\$\{/);

        // And the callers actually call it, rather than the ban being satisfied
        // by nobody sweeping at all.
        const callers = files.filter((f) => {
            const src = readFileSync(f, 'utf-8');
            return src.includes('eachPaystackSuccess(') || src.includes('eachPaystackTransaction(');
        });
        //   reconcile, paystack-sync, the cron, and the helper itself.
        //
        //   WAS 5, AND analytics.service WAS THREE OF THOSE SWEEPS. #699 removed
        //   all three: they ran on admin page renders, where a sequential sweep
        //   of a payment API is the wrong thing to do at all. The number is
        //   lowered deliberately rather than loosened to `> 0` — it still fails
        //   if the remaining callers stop calling, which is what this control is
        //   for, and it would fail again if a fifth appeared unexamined.
        expect(callers.length).toBe(4);
    });

    it('no longer fans out unbounded parallel requests', async () => {
        // getPlatformMetrics fetched pages 2..pageCount with Promise.all and no
        // bound, so a reported count of 500 meant 499 concurrent requests.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/services/analytics.service.ts'), 'utf-8');

        expect(src).not.toContain('pagePromises');
    });
});

describe('the financial overview is admin-only', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses a caller with no session', async () => {
        setSession(null);
        const { getFinancialOverviewAction } = await import('@/app/actions/admin-analytics');

        const r: any = await getFinancialOverviewAction();

        expect(r.success).toBe(false);
        expect(r.totalRevenue).toBe(0);
    });

    it('refuses a signed-in non-admin', async () => {
        setSession('user-1', ['seller']);
        const { getFinancialOverviewAction } = await import('@/app/actions/admin-analytics');

        const r: any = await getFinancialOverviewAction();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/admin/i);
        // Every figure is zeroed on refusal, so a refusal cannot be mistaken
        // for a platform with no money.
        expect(r.totalEscrowVolume).toBe(0);
        expect(r.totalLoansDisbursed).toBe(0);
    });

    it('refuses a non-admin on the module stats too', async () => {
        setSession('user-1', ['seller']);
        const { getModuleRegistrationStatsAction } = await import('@/app/actions/admin-analytics');

        await expect(getModuleRegistrationStatsAction()).rejects.toThrow(/unauthori[sz]ed/i);
    });

    it('checks the admin role before doing any work', async () => {
        // The session check and the isAdmin check are fifteen lines apart in
        // this function; the gap is only the error-return object, and nothing
        // reads the database in between. Asserted so a later edit cannot slip
        // work into that gap.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/admin-analytics.ts'), 'utf-8');

        const fn = src.slice(src.indexOf('export async function getFinancialOverviewAction'));
        const adminCheckAt = fn.indexOf('isAdmin(');
        const firstServiceCall = fn.indexOf('analyticsService.');

        expect(adminCheckAt).toBeGreaterThan(-1);
        expect(firstServiceCall).toBeGreaterThan(adminCheckAt);
    });
});
