/**
 * @jest-environment node
 */

/**
 *   #467 THE TABLES PROMOTED FOR SPEED LOST THE INDEX THE SLOW ONE KEPT.
 *
 *   The owner reported /admin and /admin/users loading slowly. Measured against
 *   a real PostgreSQL 16 with 50,009 users, on the exact query the page issues:
 *
 *       select id, raw_data from users order by created_at desc limit 20;
 *
 *       BEFORE   26.496 ms   Sort (rows=50009), Sort Key: created_at DESC
 *       AFTER     0.061 ms   Index Scan using idx_users_created_at
 *
 *   430x. The whole table was sorted to find twenty rows, on every page load.
 *
 *   AND THE PROOF IT IS AN OVERSIGHT: document_collections, the untyped
 *   catch-all everything used to live in, already carries
 *   (collection_name, created_at DESC). Every table since promoted OUT of it
 *   into a dedicated table — for performance — was created without one.
 *
 *   TWO THINGS I MEASURED THAT WERE NOT THE CAUSE, recorded so nobody re-runs
 *   them:
 *
 *     count: 'exact'      20 sequential counts over 50k rows: 615 ms; the same
 *                         20 as 'planned': 542 ms. Barely different, because
 *                         the cost is the round trip, not the counting. An
 *                         "estimated count" change would trade correctness for
 *                         nothing. The admin block is already Promise.all —
 *                         190 ms for all twenty.
 *
 *     the JSONB detoast   `select id, raw_data` vs `select id, email` on the
 *                         same query: 28.8 ms against 23.2 ms. Real, and small
 *                         beside the sort.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
});
afterAll(async () => { await client?.end().catch(() => {}); });

/** Every dedicated table the adapter routes a collection to. */
const DEDICATED = [
    'users',
    'marketplace_orders',
    'processed_payments',
    'transactions',
    'cooperative_members',
    'cooperative_loans',
    'academy_applications',
    'wallets',
];

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#467 — every dedicated table can be ordered by created_at cheaply', () => {
    it('EVERY ONE OF THEM HAS A created_at INDEX', async () => {
        const { rows } = await client!.query(
            `select tablename from pg_indexes
             where schemaname = 'public' and indexdef like '%created_at%'`,
        );
        const indexed = new Set(rows.map((r: any) => r.tablename));

        const missing = DEDICATED.filter((t) => !indexed.has(t));
        expect({ missing }).toEqual({ missing: [] });
    });

    it('AND THE CATCH-ALL STILL HAS THE ONE IT ALWAYS HAD', async () => {
        // The premise of the whole finding: document_collections was never the
        // problem, which is what made the dedicated tables' omission visible.
        const { rows } = await client!.query(
            `select indexdef from pg_indexes
             where schemaname='public' and tablename='document_collections'
               and indexdef like '%created_at%'`,
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].indexdef).toContain('collection_name');
    });

    it('AND THE PLANNER USES IT — an index nothing scans is not a fix', async () => {
        // The assertion that actually matters. A btree can exist and be ignored:
        // migration 022 records exactly that outcome for a different query
        // shape, which is why this asks the planner rather than pg_indexes.
        const { rows } = await client!.query(
            `explain (analyze, format json)
             select id, raw_data from users order by created_at desc limit 20`,
        );
        const plan = JSON.stringify(rows[0]['QUERY PLAN']);

        expect(plan).toContain('idx_users_created_at');
        expect(plan).not.toContain('"Node Type":"Sort"');
    });

    it('POSITIVE CONTROL: a query with no index still sorts', async () => {
        // Without this, "no Sort node" could mean the plan text is being read
        // wrongly rather than the index being used.
        const { rows } = await client!.query(
            `explain (analyze, format json)
             select id from users order by raw_data->>'fullName' limit 20`,
        );

        expect(JSON.stringify(rows[0]['QUERY PLAN'])).toContain('"Node Type":"Sort"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#467 — the migration says how to apply it safely', () => {
    const sql = () => readFileSync('supabase/migrations/027_dedicated_table_created_at_indexes.sql', 'utf-8');

    it('EVERY STATEMENT IS CONCURRENTLY — the alternative locks the table', () => {
        const creates = sql().split('\n').filter((l) => l.trim().startsWith('CREATE INDEX'));

        expect(creates.length).toBe(DEDICATED.length);
        for (const line of creates) {
            expect({ line, safe: line.includes('CONCURRENTLY') && line.includes('IF NOT EXISTS') })
                .toEqual({ line, safe: true });
        }
    });

    it('AND IT COVERS EXACTLY THE DEDICATED TABLES', () => {
        const body = sql();

        for (const table of DEDICATED) {
            expect({ table, covered: body.includes(`ON public.${table} (created_at DESC)`) })
                .toEqual({ table, covered: true });
        }
    });

    it('and it carries the measurement, not just the intent', () => {
        // 022 is marked DO NOT APPLY on ITS measurements. A sibling migration
        // that only asserted "this will be faster" would be the thing 022 warns
        // against.
        const body = sql();

        expect(body).toContain('26.496 ms');
        expect(body).toContain('0.061 ms');
        expect(body).toContain('Sort Key: created_at DESC');
    });

    it('and tells the operator how to check for an INVALID build', () => {
        expect(sql()).toContain('WHERE NOT indisvalid');
    });
});
