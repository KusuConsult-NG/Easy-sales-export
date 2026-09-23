/**
 *   THE RECONCILIATION JOB HELD THE CONTAINER WHILE USERS WAITED BEHIND IT.
 *
 *   From the production log, a burst of fifteen:
 *
 *       [Reconciliation Cron] Invalidated finance, dashboard, and coop caches.
 *       Error: aborted { code: 'ECONNRESET' }      x15
 *       [request] the connection closed before the response did — GET /dashboard
 *
 *   Those are inbound clients giving up, not outbound failures: the job's own
 *   Paystack errors are caught and logged with a "[Reconciliation Cron] Failed
 *   to auto-heal transaction <ref>" prefix, and these are bare. The cache line
 *   is the job's LAST step, so the burst marks it finishing — the disconnect
 *   events had queued behind it and drained at once.
 *
 *   Two things made it long enough for that to happen, and this suite pins
 *   both.
 *
 * ── 1. THE SET THAT STOPS A PAYMENT BEING HEALED TWICE ──────────────────────
 *
 *   `firebaseRefs` is built from every completed payment, and every reference
 *   NOT in it is sent to dispatchPaystackPayment. That dispatcher has no
 *   idempotency guard — the processors validate the AMOUNT, not whether the
 *   reference was already fulfilled — so the set has to be COMPLETE or the job
 *   re-fulfils real payments.
 *
 *   It was built with a plain `.get()`, which stops at DEFAULT_QUERY_LIMIT
 *   (5,000) and returns a short answer that looks complete. The sibling job
 *   reconcile-fulfilment already hit this and wrote it down verbatim; the fix
 *   was never ported here.
 *
 *   Every false positive also costs a sequential Paystack verify, which is
 *   what made the job long. The correctness bug and the slowness are the same
 *   bug.
 *
 * ── 2. THE WRITES MUST STAY SERIAL ─────────────────────────────────────────
 *
 *   The verifies now run six at a time. The HEALING does not, and that is the
 *   whole care in the change: a verify is a pure GET and reorderable, while
 *   dispatchPaystackPayment credits wallets, grants roles and records
 *   payments. Two heals for one person running at once is a race this job has
 *   never had, and a reconciliation job is the last place to introduce one.
 *
 *   So the assertion below is not "it is concurrent" — it is "the WRITE is not
 *   inside the concurrent part". That is the property worth holding.
 *
 *   mapWithConcurrency's own behaviour (order, the limit, and that one
 *   rejection abandons the rest) is covered by #805's suite and is not
 *   retested here; the catch inside the callback exists because of it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROUTE = 'src/app/api/cron/reconcile-paystack/route.ts';
const source = stripComments(readFileSync(join(process.cwd(), ROUTE), 'utf-8'));

/** The body of the first `mapWithConcurrency(...)` call, by brace matching. */
function concurrentCallbackBody(src: string): string {
    const start = src.indexOf('mapWithConcurrency(');
    expect({ callsMapWithConcurrency: start > -1 }).toEqual({ callsMapWithConcurrency: true });

    let depth = 0;
    for (let i = src.indexOf('(', start); i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unbalanced mapWithConcurrency(...) call');
}

describe('the reconciliation cron no longer walks Paystack one call at a time', () => {
    it('BUILDS ITS ALREADY-PAID SET FROM EVERY ROW — .all(), not a capped .get()', () => {
        /*
         *   A truncated set here does not under-report, it RE-FULFILS. .all()
         *   carries the adapter's ceiling and reports reaching it as an error
         *   rather than handing back a short answer that looks whole.
         */
        const read = source.slice(
            source.indexOf('.collection("processedPayments")'),
            source.indexOf('const firebaseRefs'),
        );

        expect({ read: read.includes('.all()') }).toEqual({ read: true });
    });

    it('and narrows that read to the fields the mapper actually uses', () => {
        //   One string per row is the whole point of the read; without this it
        //   detoasts every raw_data in the ledger to collect it.
        const read = source.slice(
            source.indexOf('.collection("processedPayments")'),
            source.indexOf('const firebaseRefs'),
        );

        expect({ narrowed: read.includes('.select(') }).toEqual({ narrowed: true });
    });

    it('VERIFIES THROUGH A BOUNDED POOL, not a serial await in a loop', () => {
        const callback = concurrentCallbackBody(source);

        //   The verify is the expensive half and it is inside the pool.
        expect({ verifyIsPooled: callback.includes('/transaction/verify/') })
            .toEqual({ verifyIsPooled: true });
    });

    it('THE HEALING WRITE IS NOT INSIDE THE POOL — the safety property', () => {
        /*
         *   THE one assertion this file exists for. Moving
         *   dispatchPaystackPayment inside the pool would look like a further
         *   speed-up and would introduce a write race into a money path.
         */
        const callback = concurrentCallbackBody(source);

        expect({ dispatchInsidePool: callback.includes('dispatchPaystackPayment') })
            .toEqual({ dispatchInsidePool: false });

        //   …and it is still called, serially, outside it. Without this the
        //   assertion above passes on a file that no longer heals at all.
        expect({ stillHeals: source.includes('await dispatchPaystackPayment(') })
            .toEqual({ stillHeals: true });
    });

    it('and the pool is bounded by a small explicit limit', () => {
        const match = source.match(/VERIFY_CONCURRENCY\s*=\s*(\d+)/);
        expect({ hasLimit: match !== null }).toEqual({ hasLimit: true });

        const limit = Number(match![1]);
        //   Bounded on both sides: 1 would be the serial loop again, and a
        //   large number is a different way to hold the container.
        expect({ inRange: limit > 1 && limit <= 10, limit }).toEqual({ inRange: true, limit });
    });

    it('a failed verify is CAUGHT INSIDE the pool, so one bad reference cannot abandon the rest', () => {
        /*
         *   mapWithConcurrency records the failure and rethrows, and the other
         *   workers stop claiming — #805's own suite asserts that. So the
         *   callback has to absorb its own failure and report it as a value.
         */
        const callback = concurrentCallbackBody(source);

        expect({ catches: /catch\s*\(/.test(callback) }).toEqual({ catches: true });
    });

    it('THE PREMISE HOLDS — the file still does the job this describes', () => {
        //   A vacuity guard: every assertion above is about a file that must
        //   still be a reconciliation cron reading Paystack.
        expect(source.includes('firebaseRefs')).toBe(true);
        expect(source.includes('paystackBaseUrl()')).toBe(true);
        expect(source.length).toBeGreaterThan(2000);
    });
});
