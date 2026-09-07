/**
 * @jest-environment node
 */

/**
 *   #472 WHAT #471 ACTUALLY ESTABLISHES — AND WHAT IT DOES NOT.
 *
 *   THIS TEST EXISTS BECAUSE OF #469, AND BECAUSE THE OWNER SAID TO STOP.
 *
 *   #467 shipped a migration verified as valid SQL, which could not be applied
 *   by the only route the operator has. The owner hit that, not me. They then
 *   said: do not push again until you have tested it and are sure. They were
 *   right, and #471 was about to repeat the shape — measured with EXPLAIN
 *   ANALYZE, reported as "70x", and never once run through the stack the
 *   application uses.
 *
 *   SO IT WAS RUN, AND THE HEADLINE NUMBER DID NOT SURVIVE. Through the real
 *   adapter, over HTTP, through real PostgREST, to real PostgreSQL:
 *
 *       50,009 rows     without the index  27 ms      with it   5 ms
 *      150,009 rows                        25 ms                4 ms
 *      450,009 rows                        45 ms                4 ms
 *
 *   Five to eleven times end to end, NOT seventy. The 70x was the query plan;
 *   end to end a fixed round trip of roughly 4 ms dominates once the query stops
 *   being the slow part. Both numbers are real and they measure different
 *   things, and quoting the larger one at an owner asking about page loads was
 *   the mistake.
 *
 *   AND THE PRODUCTION TIMEOUT WAS NOT REPRODUCED. The finding began with
 *
 *       Could not complete this scan: [supabase-db] query users:
 *       canceling statement due to statement timeout
 *
 *   At 450,009 rows on this hardware the unindexed call still answers in 45 ms.
 *   Nothing here reaches a multi-second timeout, so whatever makes that query
 *   exceed the limit in production — cold cache against network storage, a
 *   small shared instance, a shorter timeout than assumed — IS NOT PRESENT ON
 *   THIS MACHINE AND HAS NOT BEEN DEMONSTRATED. A test that manufactured the
 *   failure by setting a 15 ms timeout would be dressing a calibration up as a
 *   reproduction.
 *
 *   WHAT IS PROVEN, DETERMINISTICALLY, IS THE MECHANISM — and it is asserted in
 *   BLOCKS rather than milliseconds. Blocks are what a database pays for in I/O,
 *   they do not vary with how fast this machine happens to be, and they are
 *   exact.
 *
 *   TWO CLAIMS WERE DROPPED HERE BECAUSE THEY COULD NOT BE MADE REPRODUCIBLE,
 *   and that is the point of the exercise rather than an embarrassment:
 *
 *     "the indexed scan touches the SAME blocks at any table size"
 *          False. Six times the rows moved it 446 -> 691. The GIN index grows
 *          with the table even though the farmer population does not.
 *
 *     "so assert it grows SUB-LINEARLY instead"
 *          Not measurable here. DELETE does not reclaim space without VACUUM,
 *          so shrinking the table back leaves the pages in place and the second
 *          measurement is taken against the first one's physical size. In a
 *          suite that shares `users` with other suites, that comparison is a
 *          coin toss dressed as a number.
 *
 *   WHAT REMAINS IS DETERMINISTIC AND SUFFICIENT: the unindexed query reads
 *   essentially the whole table, and the indexed one reads at least twenty times
 *   less. "It gets worse as the table grows" follows from the first of those by
 *   definition — a scan that reads every row costs what every row costs — and
 *   does not need a second, flakier measurement to assert it.
 *
 *   Whether that alone clears production's timeout is UNKNOWN until the same
 *   scan is run there.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

const TAG = 'scale-472';
const SMALL = 20_000;
const LARGE = 120_000;
const FARMERS = 200;
const VERIFIED = 3; // fewer than the check's LIMIT 50, which is the mechanism

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
}, 300_000);

afterAll(async () => {
    if (!client) return;
    await client.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client.query('create index if not exists idx_users_roles on public.users using gin (roles)').catch(() => {});
    await client.end().catch(() => {});
}, 300_000);

/**
 * Set this suite's population to exactly `to` rows — UP OR DOWN.
 *
 * The first version could only grow, so once a test had grown the table the
 * next one asking for the smaller size silently measured the larger one and the
 * "cost grows with the table" control compared a number against itself. That is
 * the same leftover-rows mistake #455 made, in a suite written to avoid it.
 */
async function resize(to: number) {
    const { rows } = await client!.query(
        `select count(*)::int as n from public.users where id like $1`, [`${TAG}-%`],
    );
    const from = rows[0].n;

    if (from > to) {
        await client!.query(
            `delete from public.users
              where id like $1
                and split_part(id, '-', 3)::int > $2`,
            [`${TAG}-%`, to],
        );
    } else if (from < to) {
        await client!.query(
            `insert into public.users (id, email, roles, raw_data)
             select $1 || '-' || g,
                    $1 || '-' || g || '@example.com',
                    case when g <= $2 then array['user','farmer'] else array['user'] end,
                    jsonb_build_object('isVerified', g <= $3, 'padding', repeat('x', 2000))
               from generate_series($4::int + 1, $5::int) g`,
            [TAG, FARMERS, VERIFIED, from, to],
        );
    }
    await client!.query('analyze public.users');
}

/** Blocks the users table occupies on disk, for the proportionality control. */
async function tableBlocks(): Promise<number> {
    const { rows } = await client!.query(
        `select (pg_relation_size('public.users') / current_setting('block_size')::int)::int as n`,
    );
    return rows[0].n;
}

const setIndex = async (present: boolean) => {
    await client!.query(
        present
            ? 'create index if not exists idx_users_roles on public.users using gin (roles)'
            : 'drop index if exists idx_users_roles',
    );
    await client!.query('analyze public.users');
};

/** Blocks the real query touches — the quantity that transfers between machines. */
async function blocksTouched(): Promise<{ blocks: number; plan: string }> {
    const { rows } = await client!.query(
        `explain (analyze, buffers, format json)
         select id, raw_data from public.users
          where roles @> array['farmer'] and raw_data->>'isVerified' = 'true'
          limit 50`,
    );
    const plan = JSON.stringify(rows[0]['QUERY PLAN'][0]);
    const hit = Number(plan.match(/"Shared Hit Blocks":(\d+)/)?.[1] ?? 0);
    const read = Number(plan.match(/"Shared Read Blocks":(\d+)/)?.[1] ?? 0);
    return { blocks: hit + read, plan };
}

/** The exact call forensics.ts makes, through the adapter the application uses. */
async function farmNationScan() {
    const { supabaseDb } = await import('@/lib/supabase-db');
    const { COLLECTIONS } = await import('@/lib/types/firestore');

    return supabaseDb
        .collection(COLLECTIONS.USERS)
        .where('isVerified', '==', true)
        .where('roles', 'array-contains', 'farmer')
        .limit(50)
        .get();
}

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#472 — the unindexed query reads the whole table and the indexed one does not', () => {
    it('AND WITHOUT IT THE COST GROWS WITH THE TABLE — the control', async () => {
        //   Without this, "constant" above could mean the measurement is
        //   constant rather than the work.
        //
        //   Asserted against the TABLE'S OWN SIZE rather than against a second
        //   measurement, because this cluster carries rows from other suites:
        //   the claim is that the scan reads essentially the whole table, which
        //   is true regardless of who else put rows in it.
        await resize(LARGE);
        await setIndex(false);
        const scan = await blocksTouched();
        const onDisk = await tableBlocks();

        expect(scan.plan).toContain('"Node Type":"Seq Scan"');
        expect({ readsMostOfTheTable: scan.blocks > onDisk * 0.5, scan: scan.blocks, onDisk })
            .toEqual({ readsMostOfTheTable: true, scan: scan.blocks, onDisk });
    }, 900_000);

    it('AND THE INDEXED PATH READS ORDERS OF MAGNITUDE LESS THAN THE SCAN', async () => {
        await resize(LARGE);

        await setIndex(false);
        const scan = await blocksTouched();
        await setIndex(true);
        const indexed = await blocksTouched();

        expect({ indexed: indexed.blocks, scan: scan.blocks, ratioOver20: scan.blocks > indexed.blocks * 20 })
            .toEqual({ indexed: indexed.blocks, scan: scan.blocks, ratioOver20: true });
    }, 900_000);
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#472 — and the answer is the same either way', () => {
    /**
     * An index that changed the ANSWER would be a far worse defect than the one
     * it fixed. The adapter is driven here rather than raw SQL, because the
     * adapter is what the application calls and #469's lesson is that the layer
     * you skip is the layer that breaks.
     */
    it('THE ADAPTER RETURNS THE SAME ROWS WITH AND WITHOUT THE INDEX', async () => {
        await resize(LARGE);

        await setIndex(false);
        const before = (await farmNationScan()).docs.map((d: any) => d.id).sort();

        await setIndex(true);
        const after = (await farmNationScan()).docs.map((d: any) => d.id).sort();

        expect(after).toEqual(before);
        expect(after.length).toBeGreaterThan(0);
    }, 900_000);

    it('AND THEY ARE THE VERIFIED FARMERS, NOT ANY ROWS AT ALL', async () => {
        // Vacuity guard: two identical empty lists would satisfy the test above.
        await resize(LARGE);
        await setIndex(true);

        const docs = (await farmNationScan()).docs.map((d: any) => d.data());

        expect(docs.length).toBeGreaterThan(0);
        for (const d of docs) {
            expect({ verified: d.isVerified, farmer: (d.roles ?? []).includes('farmer') })
                .toEqual({ verified: true, farmer: true });
        }
    }, 900_000);

    it('and the population really is smaller than the LIMIT — the mechanism', async () => {
        //   A LIMIT only lets a scan stop early when it FINDS that many rows.
        //   If this ever returned 50 or more, the finding's reasoning is wrong
        //   and somebody should re-read it rather than assume.
        await resize(LARGE);
        const { rows } = await client!.query(
            `select count(*)::int as n from public.users
              where roles @> array['farmer'] and raw_data->>'isVerified' = 'true'
                and id like $1`,
            [`${TAG}-%`],
        );

        expect(rows[0].n).toBe(VERIFIED);
        expect(rows[0].n).toBeLessThan(50);
    }, 900_000);
});
