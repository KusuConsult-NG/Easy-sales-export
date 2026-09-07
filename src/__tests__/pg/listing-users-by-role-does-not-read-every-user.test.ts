/**
 * @jest-environment node
 */

/**
 *   #471 EVERY SCREEN THAT LISTS USERS BY ROLE READ THE WHOLE TABLE.
 *
 *   The owner's forensics run came back with a check that could not finish:
 *
 *       Farm Nation / Verification Scan
 *       Could not complete this scan: [supabase-db] query users:
 *       canceling statement due to statement timeout
 *
 *   `roles` is a native TEXT[] column with no index. The check filters on it and
 *   on a JSONB path, under `LIMIT 50` — and A LIMIT ONLY RESCUES A SCAN THAT
 *   FINDS THAT MANY ROWS. There are two or three verified farmers on the
 *   platform, so the limit can never be filled and the scan must read every row,
 *   detoasting each document to evaluate the JSONB path.
 *
 *   That is why it timed out in production and takes 22 ms here: locally all
 *   12,571 blocks are cache hits. The block count, not the millisecond count, is
 *   the number that transfers.
 *
 *   AND IT IS NOT ONE CHECK. `roles` is filtered in 27 places — /admin/users and
 *   its count query, marketplace buyers and sellers, every admin lookup in
 *   messages.ts, wallet.ts's notification fan-out, three broadcast audiences, the
 *   academy instructor list, and three forensic scans. Each was a full table scan
 *   on a page load. This is the shape of "the dashboards are slow" that measuring
 *   one query at a time kept missing: not one slow page — one missing index under
 *   twenty of them.
 *
 *   THE TEST 022 SETS, BOTH HALVES. Migration 022 is marked DO NOT APPLY because
 *   its indexes served a filter matching 96% of its table. So this asks the
 *   planner both questions: does it USE the index for a selective role (1% of
 *   rows), and does it IGNORE it for one that matches everything. Both are
 *   asserted below, and the second is the one 022's indexes fail.
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

/** This suite's own rows, so it never asserts about data somebody else left. */
const TAG = 'role-471';
const TOTAL = 4000;
const RARE = 40; // 1% — the selective case
const VERIFIED = 3; // fewer than the LIMIT, which is the whole point

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
    await c.query(
        `insert into public.users (id, email, roles, raw_data)
         select $1 || '-' || g,
                $1 || '-' || g || '@example.com',
                case when g <= $2 then array['user','farmer'] else array['user'] end,
                case when g <= $3 then '{"isVerified":true}'::jsonb else '{}'::jsonb end
           from generate_series(1, $4) g`,
        [TAG, RARE, VERIFIED, TOTAL],
    );
    await c.query('analyze public.users');
});

afterAll(async () => {
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.end().catch(() => {});
});

const plan = async (sql: string, params: any[] = []) => {
    const { rows } = await client!.query(`explain (analyze, buffers, format json) ${sql}`, params);
    return rows[0]['QUERY PLAN'][0];
};

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#471 — the role filter uses an index', () => {
    it('THE INDEX EXISTS, AND IS GIN', async () => {
        // btree cannot serve @> or && at all, so the access method is part of
        // the fix rather than an implementation detail.
        const { rows } = await client!.query(
            `select am.amname
               from pg_class i
               join pg_am am on am.oid = i.relam
              where i.relname = 'idx_users_roles'`,
        );

        expect(rows.map((r: any) => r.amname)).toEqual(['gin']);
    });

    it('THE FARM NATION QUERY NO LONGER READS EVERY ROW — the check that timed out', async () => {
        //   The assertion the finding is about, and it asserts on BLOCKS rather
        //   than milliseconds: locally every block is a cache hit, so the time
        //   barely moves while the work done differs by two orders of magnitude.
        //   Blocks are what production pays for.
        const p = await plan(
            `select id, raw_data from public.users
              where roles @> array['farmer'] and raw_data->>'isVerified' = 'true'
                and id like '${TAG}-%'
              limit 50`,
        );
        const text = JSON.stringify(p);

        expect(text).toContain('idx_users_roles');
        expect(text).not.toContain('"Node Type":"Seq Scan"');
    });

    it('AND THE LIMIT WAS NEVER GOING TO SAVE IT — the premise', async () => {
        //   A LIMIT lets a scan stop early only when it FINDS that many rows.
        //   If this ever returned 50, the finding's reasoning would be wrong and
        //   somebody should re-read it rather than assume.
        const { rows } = await client!.query(
            `select count(*)::int as n from public.users
              where roles @> array['farmer'] and raw_data->>'isVerified' = 'true'
                and id like $1`,
            [`${TAG}-%`],
        );

        expect(rows[0].n).toBe(VERIFIED);
        expect(rows[0].n).toBeLessThan(50);
    });

    it('AND array-contains-any USES IT TOO — messages.ts and wallet.ts go through &&', async () => {
        // A fix that reached only @> would leave the admin notification fan-out
        // and the wallet's notifiable-roles query scanning. Third time in this
        // audit a fix reached some of the doors.
        const p = await plan(
            `select id from public.users where roles && array['farmer','seller']`,
        );

        expect(JSON.stringify(p)).toContain('idx_users_roles');
    });

    it("POSITIVE CONTROL: THE PLANNER IGNORES IT FOR A ROLE THAT MATCHES EVERYTHING", async () => {
        //   This is the half migration 022 fails, and the reason 022 is marked
        //   DO NOT APPLY. An index that gets used for a 100%-selectivity filter
        //   is slower than the seq scan it replaced. Without this assertion,
        //   "the index is used" would be indistinguishable from "the index is
        //   always used", which is the defect 022 documents.
        const p = await plan(`select id from public.users where roles @> array['user']`);

        expect(JSON.stringify(p)).toContain('"Node Type":"Seq Scan"');
    });

    it('and the rows this suite reasons about are its own', async () => {
        // Vacuity guard: an empty table makes every plan above trivially cheap.
        const { rows } = await client!.query(
            `select count(*)::int as n from public.users where id like $1`,
            [`${TAG}-%`],
        );

        expect(rows[0].n).toBe(TOTAL);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#471 — the migration records what it costs', () => {
    const sql = () => readFileSync('supabase/migrations/028_users_roles_index.sql', 'utf-8');

    it('IT IS THE PLAIN FORM UNDER A lock_timeout — #469', () => {
        //   A CONCURRENTLY migration here is a migration that never gets
        //   applied: the SQL Editor is this project's only route and it always
        //   opens a transaction. That lesson cost the #467 speedup two days.
        const body = sql().replace(/^\s*--.*$/gm, ' ');

        expect(body).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        expect(body).toContain('SET lock_timeout');
        expect(body).toContain('IF NOT EXISTS');
    });

    it('AND IT CARRIES THE MEASUREMENT, INCLUDING THE BLOCK COUNTS', () => {
        //   022 is marked DO NOT APPLY on ITS measurements. A sibling that only
        //   claimed "this will be faster" is the thing 022 warns against — and
        //   here the millisecond figure alone would understate it, because
        //   locally every block is a cache hit.
        const body = sql();

        expect(body).toContain('21.972 ms');
        expect(body).toContain('0.314 ms');
        expect(body).toContain('12,571 buffers');
        expect(body).toContain('Rows Removed by Filter: 50006');
    });

    it("AND ANSWERS 022'S QUESTION ABOUT THE UNSELECTIVE CASE", () => {
        const body = sql();

        expect(body).toContain("roles @> ARRAY['user']");
        expect(body).toContain('It ignores the index, correctly');
    });

    it('and states the write cost rather than waving it away', () => {
        const body = sql();

        expect(body).toContain('14.284 ms');
        expect(body).toContain('19.029 ms');
        expect(body).toContain('176 kB');
    });
});
