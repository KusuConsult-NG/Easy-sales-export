/**
 * @jest-environment node
 */

/**
 *   #519 THE PAGING BUG HAD THREE MORE COPIES, ALL OF THEM ON MONEY, AND THE
 *        RATCHET WRITTEN TO CATCH THEM READ ONE FILE.
 *
 *   analytics.service.ts records fixing this expression three times:
 *
 *       const totalPages = json.meta?.pageCount ?? 1;
 *
 *   with a note that says exactly why it kept coming back — "it cannot tell
 *   'the API sent no page count' apart from 'there is one page'. When Paystack
 *   omits the field, every one of those loops stopped after page 1 and reported
 *   the hundred most recent transactions as the platform's lifetime revenue" —
 *   and, on the fix: "fixing one copy and leaving its siblings is how this class
 *   keeps surviving in this codebase."
 *
 *   THREE SIBLINGS WERE STILL THERE. All three handle money:
 *
 *     api/admin/finance/reconcile        `pageCount ?? 1`
 *     api/admin/finance/paystack-sync    `pageCount ?? 1`
 *     api/cron/reconcile-paystack        `(data.meta?.pageCount || 1)`
 *
 * ── WHY THE RATCHET DID NOT SEE THEM ────────────────────────────────────────
 *
 *   analytics-revenue-paging.test.ts said, in its own words, "If a fourth sweep
 *   is added later it has to come past this" — and then counted paged URLs in
 *   src/services/analytics.service.ts ONLY. The fourth sweep was not added
 *   later. It was already sitting in a route. A ratchet scoped to the file that
 *   happened to be fixed cannot see the sibling it was written to catch, and
 *   this audit's own rule applies to its own tests: audit the instrument before
 *   believing the measurement.
 *
 *   The string check had the same shape and a second hole: it looked for the
 *   literal `pageCount ?? 1`, so the cron's `pageCount || 1` was invisible to it
 *   twice over. Both checks sweep src/ now, and the URL check is what actually
 *   found all three — a shape, not a spelling.
 *
 *   AND THE HELPER COULD NOT BE IMPORTED. eachPaystackSuccess was declared
 *   `async function` in analytics.service.ts, module-private, so the only sweeps
 *   it could reach were the three in the file it was written in. A helper that
 *   cannot be imported is not a shared rule; it is a fourth copy waiting to be
 *   written. It is lib/paystack-sweep.ts now.
 *
 * ── WHAT EACH ONE COST ──────────────────────────────────────────────────────
 *
 *   RECONCILE is the route that diffs Paystack against the local ledger.
 *   Reading one page means comparing the hundred most recent transactions,
 *   finding all hundred present, and answering `status: "reconciled"` while
 *   thousands were never looked at. A reconciliation that cannot see the data is
 *   not a reconciliation that found nothing wrong.
 *
 *   PAYSTACK-SYNC is the one that WRITES. It hands each transaction to
 *   processMarketplaceOrder, processWalletFunding, processCooperativeRegistration
 *   and the rest. Stopping after page one means the sync only ever repairs the
 *   hundred most recent payments — so an unprocessed payment older than that
 *   stays unprocessed however many times an admin presses the button, which is
 *   the exact failure the button exists to fix.
 *
 *   THE CRON runs unattended, so its under-reading is attached to nobody.
 *
 * ── AND A PARTIAL READ NO LONGER PASSES AS A CLEAN ONE ──────────────────────
 *
 *   reconcile already KNEW about its local ceiling — it logged "will over-report
 *   missing payments" — and then returned the over-reported list anyway with
 *   nothing on the response saying so. `status` is "incomplete" now when either
 *   side was truncated, and both sweeps are named in the payload. The person
 *   reading the report is the one who chases the money.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a paged loop restored in the reconcile route     KILLED
 *     `pageCount ?? 1` restored anywhere in src        KILLED
 *     the truncation flag dropped from reconcile       KILLED
 *     "reconciled" allowed on a truncated read         KILLED
 *     the tree sweep pointed at one file again         KILLED
 *     reword this header                               SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) {
                if (entry === '__tests__' || entry === 'node_modules') continue;
                walk(p);
            } else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
        }
    };
    walk(join(ROOT, 'src'));
    return out;
}

const code = (p: string) => stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) });

const RECONCILE = join(ROOT, 'src/app/api/admin/finance/reconcile/route.ts');
const SYNC = join(ROOT, 'src/app/api/admin/finance/paystack-sync/route.ts');
const CRON = join(ROOT, 'src/app/api/cron/reconcile-paystack/route.ts');
const SWEEP = join(ROOT, 'src/lib/paystack-sweep.ts');

// ─────────────────────────────────────────────────────────────────────────────
describe('#519 — every Paystack sweep in the tree, not in one file', () => {
    it('NO FILE BUT THE HELPER PAGES PAYSTACK BY HAND', () => {
        //   THE test, and the one that actually found the three copies. It
        //   matches the SHAPE of a paged URL rather than the spelling of a stop
        //   condition, which is why it sees `|| 1` as well as `?? 1`.
        const PAGED_URL = /\/transaction\?perPage=\$\{|perPage=100&page=\$\{/;
        const offenders = sourceFiles()
            .filter((f) => PAGED_URL.test(readFileSync(f, 'utf-8')))
            .map((f) => relative(ROOT, f))
            .filter((f) => f !== join('src', 'lib', 'paystack-sweep.ts'));

        expect(offenders).toEqual([]);
    });

    it('AND THE STOP CONDITION IS GONE IN BOTH ITS SPELLINGS', () => {
        //   Comments stripped: the fixes quote the old expression to explain it,
        //   which is #493's trap and this audit has met it seven times.
        const offenders = sourceFiles()
            .filter((f) => {
                const c = code(f);
                return c.includes('pageCount ?? 1') || c.includes('pageCount || 1');
            })
            .map((f) => relative(ROOT, f));

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP ACTUALLY WALKED THE TREE', () => {
        //   The vacuity guard the original ratchet did not have: a check that
        //   walks a directory passes trivially when the walk finds nothing.
        //   #484's and #486's shape — a control that reads as present and is none.
        const files = sourceFiles();

        expect(files.length).toBeGreaterThan(500);
        expect(files.map((f) => relative(ROOT, f))).toContain(
            join('src', 'app', 'api', 'admin', 'finance', 'reconcile', 'route.ts'),
        );
    });

    it('and the helper is importable, which is what makes it a shared rule', () => {
        //   It was `async function` in analytics.service.ts — module-private, so
        //   it could only ever reach the three sweeps in its own file.
        const sweep = readFileSync(SWEEP, 'utf-8');

        expect(sweep).toContain('export async function eachPaystackTransaction');
        expect(sweep).toContain('export const eachPaystackSuccess');
    });

    it('and all three routes call it', () => {
        for (const f of [RECONCILE, SYNC, CRON]) {
            expect(code(f)).toMatch(/eachPaystack(Success|Transaction)\(/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#519 — a partial read is not a clean bill of health', () => {
    it('RECONCILE CANNOT SAY "reconciled" WHEN EITHER SIDE WAS TRUNCATED', () => {
        //   The route already logged that its local sweep "will over-report
        //   missing payments", and then returned the over-reported list with
        //   nothing on the response saying so.
        const c = code(RECONCILE);

        expect(c).toContain('const incomplete = paystackTruncated || localPaymentsSnap.truncated');
        expect(c).toMatch(/isFullyReconciled\s*=\s*!incomplete/);
        expect(c).toContain('? "incomplete"');
    });

    it('AND IT NAMES WHICH SIDE COULD NOT BE READ', () => {
        const c = code(RECONCILE);

        expect(c).toContain('paystack: paystackTruncated');
        expect(c).toContain('local: localPaymentsSnap.truncated === true');
    });

    it('AND THE SYNC REPORTS THAT IT DID NOT FINISH', () => {
        //   This one processes what it reads, so a truncated run leaves payments
        //   unprocessed — and the admin would otherwise read the remaining gaps
        //   as real.
        const c = code(SYNC);

        expect(c).toContain('const syncTruncated =');
        expect(c).toContain('truncated: syncTruncated');
    });

    it('and the cron says its clean result means nothing when truncated', () => {
        expect(code(CRON)).toMatch(/sweep\.truncated/);
    });
});
