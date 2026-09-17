/**
 * @jest-environment node
 */

/**
 *   #848 REGISTRATION TIMED OUT IN PRODUCTION, AND IT TIMED OUT FASTEST FOR THE
 *        PEOPLE WHOSE PHONE NUMBER WAS NEW — WHICH IS EVERY GENUINE
 *        REGISTRATION.
 *
 *   From the owner's production log:
 *
 *       [2026-09-17T08:00:29.746Z] [ERROR] Registration error
 *         {"error":"[supabase-db] query users: [57014] canceling statement due
 *          to statement timeout", ... at ad.get (...chunks/76009.js)}
 *
 *   The only `users` QUERY in registerAction is the dedup guard — actions/auth.ts
 *   line 645, and the same guard again at api/auth/register/route.ts:166:
 *
 *       db.collection(USERS).where("phone", "in", phoneVariants).limit(1).get()
 *
 *   `phone` is not a native column on `users` (the native set is id, email,
 *   roles, created_at, updated_at), so the adapter emits
 *   `raw_data->>'phone' IN (…)`, and nothing indexed that expression.
 *
 * ── THE PART THAT MAKES IT A FINDING RATHER THAN A SLOW QUERY ───────────────
 *
 *   `LIMIT 1` looks like it bounds the work, and for one case it does: a
 *   DUPLICATE phone is matched early and the scan stops. A phone nobody has
 *   registered before matches nothing, so Postgres must read every row before it
 *   can answer "no".
 *
 *   So the guard is cheap for the registration it exists to REJECT and most
 *   expensive for the one it exists to ADMIT. It does not degrade under load; it
 *   degrades under success, on a table that grows by one row every time somebody
 *   gets through. Nobody would have watched for that, which is a fair answer to
 *   the owner's "since we built, it has always broken in one way or the other".
 *
 *   BOTH CASES ARE EXECUTED BELOW, separately, because a suite that measured
 *   only the hit would have found this query fast and closed the question.
 *
 * ── 022's HEADER PREDICTED THIS, IN THESE WORDS ─────────────────────────────
 *
 *       "The dedicated tables were given native columns and the
 *        expression-index habit did not travel with them."
 *
 *   #710 applied that habit to `sellerVerificationStatus` (036) and
 *   `supabaseAuthId` (033), on this table, and left `phone`. This audit's most
 *   repeated finding is a correct rule applied to some of the places it names;
 *   here it is the rule about indexes rather than about code, which is why the
 *   sweep below was done BY FIELD across all seven live call sites rather than
 *   at the one line in the log.
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

const TAG = 'phone-dedup-848';

/**
 * Enough rows that a sequential scan is genuinely the expensive option.
 *
 * Below a few thousand the planner will seq-scan whatever indexes exist, because
 * it is right to — and a suite that measured that would "prove" the index
 * useless. #467's file learned this the hard way and its header says so.
 */
const PROBE_ROWS = 5_000;

/** A number seeded above, in the spelling registerAction normalises to. */
const EXISTING_PHONE = '+2340000000042';
/** The four spellings phoneLookupVariants produces for a number nobody holds. */
const NEW_PHONE_VARIANTS = [
    '+2348039999999', '08039999999', '2348039999999', '8039999999',
];

const clearProbeRows = async () => {
    await client!.query('delete from public.users where id like $1', [`${TAG}-%`]);
    /*
     *   VACUUMED, not merely deleted and re-analysed — the reason is recorded in
     *   the-marketplace-page-counted-every-user's own clear step. A DELETE leaves
     *   dead tuples and the PAGES they occupied, `relpages` is an input to every
     *   plan the NEXT suite measures, and a fat empty table changes the planner's
     *   mind about sequential scans.
     */
    await client!.query('vacuum analyze public.users');
};

const seedProbeRows = async () => {
    await client!.query(
        `insert into public.users (id, email, raw_data)
         select $1 || '-' || g,
                $1 || '-' || g || '@example.com',
                jsonb_build_object(
                  'phone', '+234' || lpad(g::text, 10, '0'),
                  'fullName', 'Probe ' || g
                )
           from generate_series(1, $2::int) g`,
        [TAG, PROBE_ROWS],
    );
    await client!.query('analyze public.users');
};

const plan = async (sql: string, params: unknown[] = []): Promise<string> => {
    const { rows } = await client!.query(`explain (format text) ${sql}`, params);
    return rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
};

/** The query the adapter emits for the dedup guard, verbatim in shape. */
const DEDUP_SQL =
    `select id from public.users where raw_data->>'phone' = any($1::text[]) limit 1`;

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
dbDescribe('#848 — the registration dedup guard does not scan the users table', () => {
    it('THE PROBE ROWS ARE REALLY THERE — the vacuity guard', async () => {
        //   Every assertion below is about a plan, and the planner's answer for
        //   an empty table is meaningless.
        const { rows } = await client!.query(
            'select count(*)::int as n from public.users where id like $1',
            [`${TAG}-%`],
        );
        expect(rows[0].n).toBe(PROBE_ROWS);
    });

    it('AND ONE OF THEM HOLDS THE PHONE THE "hit" CASE LOOKS FOR', async () => {
        /*
         *   The second half of the vacuity guard, and it is not ceremony: the
         *   hit and miss cases below differ ONLY in whether the number exists,
         *   so a seeding change that quietly made both misses would leave this
         *   file asserting the same thing twice and calling it a comparison.
         */
        const { rows } = await client!.query(
            `select count(*)::int as n from public.users where raw_data->>'phone' = $1`,
            [EXISTING_PHONE],
        );
        expect(rows[0].n).toBe(1);
    });

    it('THE INDEX EXISTS, ON THE EXPRESSION THE ADAPTER ACTUALLY EMITS', async () => {
        /*
         *   Pinned as the expression, not by name. An index on some other
         *   spelling of the key, or on the whole raw_data, cannot serve the
         *   adapter's filter and would still be called an index.
         */
        const { rows } = await client!.query(
            `select indexdef from pg_indexes
              where schemaname = 'public' and tablename = 'users'
                and indexdef like '%raw_data ->> ''phone''%'`,
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].indexdef).toContain("raw_data ->> 'phone'");
    });

    it('THE REPORTED CASE: a phone nobody holds is an INDEX SCAN, not a full read', async () => {
        //   THE assertion — this is the plan a genuine new registration causes.
        const p = await plan(DEDUP_SQL, [NEW_PHONE_VARIANTS]);

        expect(p).toContain('idx_users_phone');
        expect(p).not.toContain('Seq Scan on users');
    });

    it('AND SO IS A DUPLICATE, which was never the slow one', async () => {
        const p = await plan(DEDUP_SQL, [[EXISTING_PHONE]]);

        expect(p).toContain('idx_users_phone');
        expect(p).not.toContain('Seq Scan on users');
    });

    it('WITHOUT THE INDEX, THE MISS READS EVERY ROW AND `LIMIT 1` DOES NOT HELP', async () => {
        /*
         *   The premise of the finding, executed rather than argued. The index is
         *   dropped inside a transaction that is always rolled back, so it is
         *   never actually lost — including when an assertion here throws.
         *
         *   `explain analyze`, not plain `explain`, because the claim is about
         *   ROWS ACTUALLY READ. A cost estimate would let a planner change make
         *   this pass while the scan was still happening.
         */
        await client!.query('begin');
        try {
            await client!.query('drop index if exists idx_users_phone');
            await client!.query('analyze public.users');

            //   The GIN index on raw_data is still in place and cannot serve
            //   `->>` equality — default jsonb_ops covers @>, ?, ?| and ?& only.
            //   That is why this looked covered for as long as it did.
            const gin = await client!.query(
                `select indexdef from pg_indexes
                  where schemaname='public' and tablename='users'
                    and indexname='idx_users_raw_data'`,
            );
            expect(gin.rows.length).toBe(1);

            const { rows } = await client!.query(
                `explain (analyze, format json) ${DEDUP_SQL}`, [NEW_PHONE_VARIANTS],
            );
            const root = rows[0]['QUERY PLAN'][0].Plan;
            const scan = root.Plans?.[0] ?? root;

            expect(scan['Node Type']).toBe('Seq Scan');
            //   The whole point: LIMIT 1 stopped at nothing, because there was
            //   nothing to stop at. Every seeded row was read and rejected.
            expect(scan['Rows Removed by Filter']).toBeGreaterThanOrEqual(PROBE_ROWS);
        } finally {
            await client!.query('rollback');
            await client!.query('analyze public.users');
        }
    });

    it('AND THE SAME INDEX SERVES THE ADMIN PREFIX SEARCH, which uses RANGES', async () => {
        /*
         *   admin-search-helper filters `phone >= raw` and `phone < upperBound`
         *   to match a partial number. A btree expression index serves equality,
         *   IN and range alike, so that site needs no second index.
         *
         *   I OVER-REACHED ON THIS CASE TWICE, IN OPPOSITE DIRECTIONS, AND THE
         *   SECOND TIME COST A RED CI RUN.
         *
         *   Version 1 searched the prefix `+2340000000` — a fifth of the seeded
         *   table — and asserted an Index Scan. It failed locally: under
         *   `limit 30`, when nearly every row qualifies, reading pages in order
         *   until thirty turn up beats walking an index and jumping to the heap.
         *   The planner was right.
         *
         *   Version 2 then added a second case asserting that the same broad
         *   prefix DOES Seq Scan. That passed here and FAILED IN CI, where the
         *   planner chose `Index Scan using idx_users_phone` at a cost of
         *   0.28..2.38 against the 0.00..16.48 it estimated locally. Same query,
         *   same index, same row count — different `relpages` and correlation,
         *   because the two tables had had different histories.
         *
         *   WHICH PLAN A MARGINAL FILTER GETS IS A PROPERTY OF THE STATISTICS,
         *   NOT OF THE FIX. Asserting either answer pins the planner's mood on
         *   one machine, and the second version did it while claiming to be the
         *   control that kept this file honest. That case is removed rather than
         *   loosened, because an assertion that accepts both outcomes asserts
         *   nothing and would have read as coverage.
         *
         *   WHAT IS TRUE AND STABLE, and is what the case below asserts: the
         *   SELECTIVE lookup — what an administrator actually types, most of a
         *   number narrowing to a handful of people, and the shape registration
         *   itself uses — takes the index everywhere. What this file therefore
         *   does NOT claim is that no phone query can ever scan; a two-digit
         *   prefix is a browse, not a search, and `limit 30` makes a scan a
         *   reasonable plan for it. That is harmless in the way registration's
         *   miss was not: it stops at the thirtieth match rather than at the end
         *   of the table.
         */
        const p = await plan(
            `select id from public.users
              where raw_data->>'phone' >= $1 and raw_data->>'phone' < $2 limit 30`,
            ['+2340000000042', '+2340000000043'],
        );

        expect(p).toContain('idx_users_phone');
        expect(p).not.toContain('Seq Scan on users');
    });

    it('AND THE SECOND SPELLING IS INDEXED TOO', async () => {
        /*
         *   `phoneNumber` is the other key this platform stores a number under —
         *   _legacy.ts:1124 writes it, admin-search-helper filters it. It is rare
         *   in the data, which makes its index small rather than pointless: the
         *   cost of missing it is the same full scan, on an admin screen.
         */
        const { rows } = await client!.query(
            `select indexdef from pg_indexes
              where schemaname = 'public' and tablename = 'users'
                and indexdef like '%raw_data ->> ''phoneNumber''%'`,
        );

        expect(rows.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#848 — and every site that filters a phone is named, not just the logged one', () => {
    /**
     *   The sweep. The production log points at ONE line; the defect is the
     *   missing index, and it is missing for every caller. Enumerated by site so
     *   that a new one added without an index has somewhere to fail.
     */
    const SITES: Array<[string, string]> = [
        ['src/app/actions/auth.ts', 'phone'],
        /*
         *   api/auth/register/route.ts IS DELIBERATELY ABSENT, and its first
         *   version of this list had it. That handler returns 404 whenever
         *   NODE_ENV, VERCEL_ENV or RAILWAY_ENVIRONMENT is "production" — it is
         *   a dev seeder, not the second registration entry point #848's first
         *   header called it. The index still covers it in development; the
         *   claim that production had two doors was wrong.
         */
        ['src/app/actions/wave/_wv_applications.ts', 'phone'],
        ['src/app/actions/admin/_legacy.ts', 'phone'],
        ['src/lib/cooperative-identity-conflict.ts', 'phone'],
        ['src/lib/admin-search-helper.ts', 'phoneNumber'],
    ];

    it('EVERY LISTED SITE STILL FILTERS THE FIELD THIS INDEX COVERS', () => {
        /*
         *   If one of these is rewritten to filter a THIRD spelling, this fails
         *   and the index question is asked again — which is the failure mode
         *   022's header describes: the habit not travelling.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments') as
            typeof import('@/lib/testing/strip-comments');

        const missing = SITES.filter(([rel, field]) => !stripComments(
            readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel },
        ).includes(`.where("${field}"`));

        expect(missing).toEqual([]);
    });

    it('AND THE MIGRATION IS IN THE CONSOLIDATED DEPLOY, or it never reaches production', () => {
        /*
         *   A migration the owner cannot apply is not a fix. #660 records four
         *   migrations silently dropped from deploy.sql; the builder now refuses
         *   any file that is in neither EXPECTED nor EXCLUDED, and this asserts
         *   the generated artefact rather than the manifest that produces it.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const deploy = readFileSync(join(process.cwd(), 'supabase/deploy.sql'), 'utf-8');
        expect(deploy).toContain('038_users_phone_index.sql');
        expect(deploy).toContain("CREATE INDEX IF NOT EXISTS idx_users_phone");
        expect(deploy).toContain("CREATE INDEX IF NOT EXISTS idx_users_phone_number");
    });

    it('AND status.sql CAN BE ASKED WHETHER IT LANDED', () => {
        /*
         *   #664 built status.sql so "is it applied?" had an answer. It read
         *   pg_proc and pg_policies only — and an index migration creates no
         *   function, so a database missing this one reported a clean bill of
         *   health. The one migration where the answer decides whether people can
         *   register was the one it could not see.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const status = readFileSync(join(process.cwd(), 'supabase/status.sql'), 'utf-8');
        expect(status).toContain('idx_users_phone');
        expect(status).toContain('idx_users_phone_number');
    });
});
