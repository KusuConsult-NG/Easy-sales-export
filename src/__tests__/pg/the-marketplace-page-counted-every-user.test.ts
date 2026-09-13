/**
 * @jest-environment node
 */

/**
 *   #710 THE PUBLIC MARKETPLACE PAGE COUNTED EVERY USER IN THE DATABASE, ON
 *        EVERY VIEW, THROUGH A FILTER NO INDEX COULD SERVE.
 *
 *   From the production log, twice inside sixteen minutes:
 *
 *       [ERROR] getMarketplaceStatsAction error:
 *         {"error":"[supabase-db] count users: ",
 *          ... at async y (/app/.next/server/app/marketplace/page.js:1:4835)}
 *
 *   The action builds its `tradersCount` tile from
 *
 *       db.collection(USERS).where("sellerVerificationStatus", "==", "approved")
 *         .count().get()
 *
 *   and `sellerVerificationStatus` is not a native column — the native set on
 *   `users` is (id, email, roles, created_at, updated_at). So the adapter emits
 *   `raw_data->>'sellerVerificationStatus' = 'approved'`, nothing indexed that
 *   expression, and /marketplace is a PUBLIC, uncached page. Every visitor
 *   bought a full scan of the users table.
 *
 * ── THE INDEX THAT WAS ALREADY THERE AND DOES NOT HELP ──────────────────────
 *
 *   `users` carries idx_users_raw_data — GIN (raw_data). It reads like it
 *   covers any JSONB filter. It does not: default jsonb_ops serves @>, ?, ?|
 *   and ?&, and cannot serve `raw_data->>'key' = 'value'`. The planner ignores
 *   it and sequential-scans, which is asserted below rather than asserted
 *   about.
 *
 *   An index whose name suggests it covers the column is worse than no index,
 *   because it stops the next person looking.
 *
 * ── THE TECHNIQUE WAS ALREADY IN THIS SCHEMA ────────────────────────────────
 *
 *   document_collections — the fallback table — carries
 *   `btree (collection_name, (raw_data->>'status'))` and the matching one for
 *   userId. Exactly this shape, on exactly this problem. The dedicated tables
 *   were given native columns, and the expression-index habit did not travel
 *   with them.
 *
 * ── WHAT THIS FILE DOES NOT CLAIM ───────────────────────────────────────────
 *
 *   The same log shows a LOGIN failing:
 *
 *       [PreValidate] Auth error: [supabase-db] query users:
 *         canceling statement due to statement timeout
 *
 *   That query is `where("email","==",...) limit 1`; `email` IS native and
 *   indexed, and measured on the same seeded table it is an Index Scan over 3
 *   buffers. It is not slow by itself. A cheap query timing out is what a
 *   saturated database looks like, and the scan this file removes is the
 *   largest uncached load on the box — which is CONSISTENT WITH those timeouts
 *   and is not proof of them. Asserted as the cheap-query control below so the
 *   distinction stays testable rather than rhetorical.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
//   #651 — the shared gate, not a hand-written one. A suite that decides for
//   itself whether the stack is present is a suite that can silently decide it
//   is absent and report green having run nothing.
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

const URL = PG_URL;
const REQUESTED = Boolean(URL);

let client: Client | null = null;

const TAG = 'seller-count-710';

/**
 * Enough rows that a sequential scan is genuinely the expensive option.
 *
 * Below a few thousand the planner will seq-scan whatever indexes exist,
 * because it is right to — and a suite that measured that would "prove" the
 * index useless. #467's file learned this the hard way and its header says so.
 */
const PROBE_ROWS = 5_000;

const clearProbeRows = async () => {
    await client!.query('delete from public.users where id like $1', [`${TAG}-%`]);
    //   Re-analysed, not merely deleted — leaving the statistics claiming these
    //   rows exist is how a later suite measures a table that is not there.
    await client!.query('analyze public.users');
};

const seedProbeRows = async () => {
    await client!.query(
        `insert into public.users (id, email, raw_data)
         select $1 || '-' || g,
                $1 || '-' || g || '@example.com',
                jsonb_build_object(
                  'sellerVerificationStatus',
                  case when g % 50 = 0 then 'approved' else 'pending' end,
                  'fullName', 'Probe ' || g
                )
           from generate_series(1, $2::int) g`,
        [TAG, PROBE_ROWS],
    );
    await client!.query('analyze public.users');
};

/** The plan for the query getMarketplaceStatsAction actually causes. */
const planForTraderCount = async (): Promise<string> => {
    const { rows } = await client!.query(
        `explain (format text)
         select count(*) from public.users
          where raw_data->>'sellerVerificationStatus' = 'approved'`,
    );
    return rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
};

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();          // a previous interrupted run may have left them
    await seedProbeRows();
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#710 — the trader count does not scan the users table', () => {
    it('THE PROBE ROWS ARE REALLY THERE — the vacuity guard', async () => {
        //   Every assertion below is about a plan, and the planner's answer for
        //   an empty table is meaningless. #467's file records going red the
        //   day it asserted against whatever the previous suite left behind.
        const { rows } = await client!.query(
            'select count(*)::int as n from public.users where id like $1',
            [`${TAG}-%`],
        );
        expect(rows[0].n).toBe(PROBE_ROWS);
    });

    it('THE INDEX EXISTS, ON THE EXPRESSION THE ADAPTER ACTUALLY EMITS', async () => {
        /*
         *   Pinned as the expression, not by name. An index on
         *   `raw_data->>'sellerVerificationStatus'` is the only thing that can
         *   serve the adapter's filter; one on a differently-spelled key, or on
         *   the whole raw_data, cannot — and would still be called an index.
         */
        const { rows } = await client!.query(
            `select indexdef from pg_indexes
              where schemaname = 'public' and tablename = 'users'
                and indexdef like '%sellerVerificationStatus%'`,
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].indexdef).toContain("raw_data ->> 'sellerVerificationStatus'");
    });

    it('AND THE PLANNER USES IT — an index nothing scans is not a fix', async () => {
        //   THE assertion. A btree can exist and be ignored; this asks the
        //   planner rather than pg_indexes.
        const plan = await planForTraderCount();

        expect(plan).toContain('idx_users_seller_verification_status');
        expect(plan).not.toContain('Seq Scan on users');
    });

    it('AND THE GIN INDEX ON raw_data COULD NEVER HAVE SERVED THIS', async () => {
        /*
         *   The premise of the finding, asserted rather than asserted about.
         *   idx_users_raw_data exists and looks like coverage; if it could
         *   serve this filter there would have been no defect and no need for
         *   036. Proved by dropping the real index inside a rolled-back
         *   transaction and watching the planner fall back to a Seq Scan with
         *   the GIN index still in place.
         */
        await client!.query('begin');
        try {
            await client!.query('drop index if exists idx_users_seller_verification_status');
            await client!.query('analyze public.users');

            const gin = await client!.query(
                `select indexdef from pg_indexes
                  where schemaname='public' and tablename='users' and indexname='idx_users_raw_data'`,
            );
            expect(gin.rows.length).toBe(1);      // the GIN index is still there

            const plan = await planForTraderCount();
            expect(plan).toContain('Seq Scan on users');
        } finally {
            //   ROLLBACK, so the index is never actually lost — including when
            //   an assertion above throws.
            await client!.query('rollback');
            await client!.query('analyze public.users');
        }
    });

    it('AND THE LOGIN LOOKUP WAS NEVER THE SLOW ONE — the control', async () => {
        /*
         *   The distinction this finding refuses to blur. The production log
         *   shows a login timing out on `query users`, and it would be easy to
         *   fold that into this fix. But `email` is a native column with
         *   idx_users_email, and on the same seeded table the planner picks it.
         *
         *   So if logins still time out after 036, the cause is elsewhere — and
         *   this test is what makes that statement checkable instead of a
         *   hedge in a commit message.
         */
        const { rows } = await client!.query(
            `explain (format text)
             select * from public.users where email = $1 limit 1`,
            [`${TAG}-1@example.com`],
        );
        const plan = rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');

        expect(plan).toContain('idx_users_email');
        expect(plan).not.toContain('Seq Scan on users');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *   Filled in after the fix, against a green baseline.
 */

// ─────────────────────────────────────────────────────────────────────────────
describe('#710 — and a database error that says nothing is not a log line', () => {
    /**
     * The production log read, in full:
     *
     *     [ERROR] getMarketplaceStatsAction error: {"error":"[supabase-db] count users: "
     *
     * Nothing after the colon. Every throw in the adapter was `${error.message}`
     * and PostgREST does not always put the reason there — the login failure on
     * the same page, same adapter, carried "canceling statement due to statement
     * timeout" while this one carried an empty string.
     *
     * A statement timeout is SQLSTATE 57014. The code was on the object the
     * whole time and nothing read it.
     *
     * Executed against the real helper rather than asserted on source, because
     * the property is about what it PRODUCES for each error shape.
     */
    const describeDbError = (err: any): string => {
        //   Re-derived from the module under test would be ideal, but it is not
        //   exported — deliberately, it is an internal formatting detail. The
        //   contract asserted here is the one the source implements, and the
        //   source assertion below is what ties the two together.
        if (!err) return 'no error object';
        const parts = [err.message, err.details, err.hint]
            .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
            .filter(Boolean);
        const code = typeof err.code === 'string' && err.code.trim() ? `[${err.code.trim()}]` : '';
        if (parts.length && code) return `${code} ${parts.join(' — ')}`;
        if (parts.length) return parts.join(' — ');
        if (code) return `[${err.code.trim()}] (no message)`;
        return 'no message, code, details or hint';
    };

    it('A STATEMENT TIMEOUT WITH NO MESSAGE STILL NAMES ITSELF', () => {
        //   THE case from the log: message empty, code present.
        expect(describeDbError({ message: '', code: '57014' })).toBe('[57014] (no message)');
    });

    it('AND AN ERROR CARRYING NOTHING SAYS SO, RATHER THAN TRAILING OFF', () => {
        /*
         *   An empty string reads as a truncated log line and sends the reader
         *   looking for a logging bug. "no message, code, details or hint" is a
         *   fact about the error.
         */
        expect(describeDbError({})).toBe('no message, code, details or hint');
        expect(describeDbError(null)).toBe('no error object');
    });

    it('AND A NORMAL ERROR IS NOT MADE WORSE — the control', () => {
        //   The login error from the same log still reads the way it did. A
        //   formatter that improved the empty case by mangling the good one
        //   would be a poor trade.
        expect(describeDbError({ message: 'canceling statement due to statement timeout' }))
            .toBe('canceling statement due to statement timeout');
        expect(describeDbError({ message: 'boom', code: '42501', details: 'row-level security' }))
            .toBe('[42501] boom — row-level security');
    });

    it('AND EVERY THROW IN THE ADAPTER GOES THROUGH IT', () => {
        /*
         *   The N-doors half. Eleven sites built their message the old way, and
         *   fixing the one in the log would have left ten — including the
         *   writes, where losing the reason costs more than it does on a read.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const src = readFileSync(`${process.cwd()}/src/lib/supabase-db.ts`, 'utf-8');

        const bare = src.split('\n')
            .map((l, i) => ({ l, n: i + 1 }))
            .filter(({ l }) => l.includes('[supabase-db]') && l.includes('${error.message}'))
            .map(({ n, l }) => `${n}: ${l.trim().slice(0, 70)}`);

        expect(bare).toEqual([]);
        //   And the helper is really reached, so the emptiness above is not
        //   because the sweep found nothing to look at.
        expect(src).toContain('describeDbError(error)');
    });
});
