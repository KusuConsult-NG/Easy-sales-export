/**
 * @jest-environment node
 */

/**
 * The money SQL, run for real, with two callers at once.
 *
 * Everything this platform relies on to not pay twice is a Postgres function.
 * They exist because the Firestore-compat adapter's runTransaction takes NO
 * LOCK: a read-then-write in JavaScript lets two callers both see "pending" and
 * both proceed. That is not theoretical here — it paid a withdrawal twice,
 * admitted two fee-free members on one invitation, and released an escrow that
 * had already been released.
 *
 * The 3,935-test unit suite cannot execute one line of this SQL: jest.setup.js
 * mocks @/lib/supabase-db globally, so every "claim" in those tests is a
 * jest.fn() returning whatever the test said it would. The claims are asserted
 * to be CALLED. Whether they actually serialise two concurrent callers has,
 * until now, been taken on faith.
 *
 * This file runs them against PostgreSQL 16 with the app's real schema and all
 * 24 migrations, and fires the concurrent case with two separate connections.
 *
 * SKIPPED IS REPORTED AS SKIPPED, NOT AS PASSED
 * ---------------------------------------------
 * The first version of this file ran every test and returned early when there
 * was no database, so `npm run test:pg` printed "15 passed" having asserted
 * nothing. That is the same vacuous-pass shape this audit removed from the
 * inert-control scan and the dead-link floor: a green result that means the
 * check did not happen.
 *
 * So the decision is made at module scope, synchronously, on whether
 * LOCAL_PG_URL is set:
 *
 *   absent      — describe.skip, and Jest says "skipped". Nobody is misled, and
 *                 a laptop with no cluster does not go red for an optional
 *                 dependency.
 *   set, but unreachable — a hard FAILURE. Somebody asked for a database run;
 *                 quietly not doing it is worse than a red suite.
 *
 *     ./scripts/local-postgres.sh start
 *     LOCAL_PG_URL=postgres://postgres@127.0.0.1:55432/app npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';

/**
 * Decided synchronously, at module scope, so `describe.skip` can be used and
 * Jest reports a skip as a skip.
 */
const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

/** describe when a database was asked for, describe.skip when it was not. */
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;
const dbIt = it;

beforeAll(async () => {
    if (!REQUESTED) return;

    // No try/catch. LOCAL_PG_URL being set means somebody wanted these to run,
    // so a connection failure must stop the suite rather than turn into fifteen
    // green no-ops.
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('select 1');
    client = c;
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await client!.query(sql, params);
    return r.rows as T[];
}

/** A second, independent connection — required for the concurrency cases. */
async function secondClient(): Promise<Client> {
    const c = new Client({ connectionString: URL });
    await c.connect();
    return c;
}

async function seedDoc(collection: string, id: string, raw: Record<string, unknown>): Promise<void> {
    await q(
        // The primary key is (id, collection_name), not id — one document id can
        // exist in more than one collection. `on conflict (id)` fails outright
        // with "no unique or exclusion constraint matching", which is how this
        // was found rather than guessed.
        `insert into document_collections (id, collection_name, raw_data)
         values ($1, $2, $3::jsonb)
         on conflict (id, collection_name) do update set raw_data = excluded.raw_data`,
        [id, collection, JSON.stringify(raw)],
    );
}

beforeEach(async () => {
    if (!REQUESTED) return;
    await q(`delete from document_collections where id like 'pgt-%'`);
});

dbDescribe('the harness is actually talking to a database', () => {
    dbIt('with the app schema and every migration applied', async () => {
        // Vacuity guard for the whole file. If this is a bare cluster, the
        // assertions below would fail for the wrong reason.
        const [{ n }] = await q<{ n: string }>(
            `select count(*)::text as n from information_schema.tables
             where table_schema = 'public' and table_name = 'document_collections'`);
        expect(Number(n)).toBe(1);

        // DISTINCT: credit_wallet_once exists TWICE, as two overloads — see the
        // test below. A plain list returns it twice and the first version of
        // this assertion failed on that, which is how the overload was noticed.
        const fns = await q<{ proname: string }>(
            `select distinct proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and proname = any($1)`,
            [['claim_status_transition', 'increment_within_ceiling', 'debit_wallet_locked',
                'credit_wallet_once', 'claim_idempotency_key', 'claim_single_open_loan_application']],
        );
        expect(fns.map((f) => f.proname).sort()).toEqual([
            'claim_idempotency_key',
            'claim_single_open_loan_application',
            'claim_status_transition',
            'credit_wallet_once',
            'debit_wallet_locked',
            'increment_within_ceiling',
        ]);
    });

    it('and credit_wallet_once has two overloads, which is recorded not ignored', async () => {

        // Two signatures differing only by a trailing p_status parameter:
        //
        //   (p_reference, p_user_id, p_amount, p_payment_type, p_source, p_raw_data)
        //   (p_reference, p_user_id, p_amount, p_payment_type, p_source, p_raw_data, p_status)
        //
        // Postgres resolves by arity, so both are callable and a six-argument
        // call silently picks the one with no status. That is the same
        // "two implementations of one operation" shape this audit kept finding,
        // in the function that CREDITS A WALLET. Pinned here so the count cannot
        // grow, and so it is visible to whoever decides which one should live.
        const rows = await q<{ args: string }>(
            `select pg_get_function_arguments(p.oid) as args
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and proname = 'credit_wallet_once'
             order by pronargs`);

        expect(rows).toHaveLength(2);
        expect(rows[0].args).not.toContain('p_status');
        expect(rows[1].args).toContain('p_status');
    });
});

dbDescribe('claim_status_transition — the compare-and-set everything rests on', () => {
    dbIt('moves a row from one status to the next', async () => {
        await seedDoc('withdrawals', 'pgt-w1', { status: 'pending', amount: 5000 });

        const [row] = await q<{ claimed: boolean; status: string }>(
            `select * from claim_status_transition('withdrawals', 'pgt-w1', 'pending', 'payout_initiated', '{"by":"admin-1"}'::jsonb)`);

        expect(row.claimed).toBe(true);

        const [doc] = await q<{ raw_data: Record<string, unknown> }>(
            `select raw_data from document_collections where id = 'pgt-w1'`);
        expect(doc.raw_data.status).toBe('payout_initiated');
        // The patch lands in the same atomic step, not a second write.
        expect(doc.raw_data.by).toBe('admin-1');
    });

    dbIt('refuses when the row is no longer in the expected status', async () => {
        await seedDoc('withdrawals', 'pgt-w2', { status: 'completed' });

        const [row] = await q<{ claimed: boolean; status: string }>(
            `select * from claim_status_transition('withdrawals', 'pgt-w2', 'pending', 'payout_initiated')`);

        expect(row.claimed).toBe(false);
        // It reports what it found, which is what lets a caller say
        // "already completed" rather than a generic failure.
        expect(row.status).toBe('completed');
    });

    dbIt('reports a missing row as null rather than throwing', async () => {
        const [row] = await q<{ claimed: boolean; status: string | null }>(
            `select * from claim_status_transition('withdrawals', 'pgt-nope', 'pending', 'x')`);

        expect(row.claimed).toBe(false);
        expect(row.status).toBeNull();
    });

    dbIt('and TWO CONCURRENT CALLERS: exactly one wins — THE test', async () => {
        // This is the assertion the entire audit leaned on and no unit test can
        // make. Two connections, one row, both claims issued before either
        // resolves. Under the old JavaScript check-then-write both callers saw
        // "pending" and both proceeded to pay.
        await seedDoc('withdrawals', 'pgt-race', { status: 'pending', amount: 9000 });

        const other = await secondClient();
        try {
            const sql = `select * from claim_status_transition('withdrawals', 'pgt-race', 'pending', 'payout_initiated')`;
            const [a, b] = await Promise.all([client!.query(sql), other.query(sql)]);

            const claims = [a.rows[0].claimed, b.rows[0].claimed];
            expect(claims.filter(Boolean)).toHaveLength(1);
            expect(claims.filter((c) => !c)).toHaveLength(1);
        } finally {
            await other.end();
        }
    });

    dbIt('and fifty concurrent callers still yield exactly one winner', async () => {
        // One race passing can be luck. Fifty connections contending on one row
        // is the shape a retry storm actually takes.
        await seedDoc('escrow_transactions', 'pgt-storm', { status: 'funded' });

        const clients = await Promise.all(Array.from({ length: 50 }, () => secondClient()));
        try {
            const sql = `select * from claim_status_transition('escrow_transactions', 'pgt-storm', 'funded', 'released')`;
            const results = await Promise.all(clients.map((c) => c.query(sql)));
            const winners = results.filter((r) => r.rows[0].claimed);

            expect(winners).toHaveLength(1);
        } finally {
            await Promise.all(clients.map((c) => c.end()));
        }
    });
});

dbDescribe('increment_within_ceiling — the overfunding guard', () => {
    dbIt('allows increments up to the ceiling and refuses past it', async () => {
        await seedDoc('export_windows', 'pgt-cap', { fundedAmount: 0, fundingGoal: 1000 });

        const [first] = await q<{ ok: boolean; value: string }>(
            `select * from increment_within_ceiling('export_windows','pgt-cap','fundedAmount',600,'fundingGoal')`);
        expect(first.ok).toBe(true);
        expect(Number(first.value)).toBe(600);

        const [second] = await q<{ ok: boolean; value: string; reason: string }>(
            `select * from increment_within_ceiling('export_windows','pgt-cap','fundedAmount',600,'fundingGoal')`);
        expect(second.ok).toBe(false);
        expect(second.reason).toBe('at_capacity');
        // And it did not partially apply.
        expect(Number(second.value)).toBe(600);
    });

    dbIt('treats a MISSING ceiling field as unbounded — verified, not inferred', async () => {
        // This was asserted from reading the SQL when export_windows' funding
        // goal was fixed. Every row in production carries no fundingGoal, so
        // "unbounded" means a window accepts any amount. Confirmed here.
        await seedDoc('export_windows', 'pgt-nocap', { fundedAmount: 0 });

        const [row] = await q<{ ok: boolean; value: string }>(
            `select * from increment_within_ceiling('export_windows','pgt-nocap','fundedAmount',1000000000,'fundingGoal')`);

        expect(row.ok).toBe(true);
        expect(Number(row.value)).toBe(1_000_000_000);
    });

    dbIt('and concurrent increments cannot exceed the ceiling between them', async () => {
        // Ten callers each adding 200 to a 1000 ceiling: five must be refused.
        // A JavaScript read-modify-write would let all ten through.
        await seedDoc('export_windows', 'pgt-caprace', { fundedAmount: 0, fundingGoal: 1000 });

        const clients = await Promise.all(Array.from({ length: 10 }, () => secondClient()));
        try {
            const sql = `select * from increment_within_ceiling('export_windows','pgt-caprace','fundedAmount',200,'fundingGoal')`;
            const results = await Promise.all(clients.map((c) => c.query(sql)));

            expect(results.filter((r) => r.rows[0].ok)).toHaveLength(5);

            const [doc] = await q<{ raw_data: Record<string, unknown> }>(
                `select raw_data from document_collections where id = 'pgt-caprace'`);
            expect(Number(doc.raw_data.fundedAmount)).toBe(1000);
        } finally {
            await Promise.all(clients.map((c) => c.end()));
        }
    });
});

dbDescribe('claim_idempotency_key — insert-if-absent, decided by Postgres', () => {
    dbIt('claims a fresh key and refuses the same key twice', async () => {
        const key = `pgt-key-${process.pid}`;
        await q(`delete from document_collections where raw_data->>'key' = $1`, [key]);

        const [first] = await q<{ claimed: boolean }>(
            `select * from claim_idempotency_key($1, 'user-1', 'create_export_window')`, [key]);
        expect(first.claimed).toBe(true);

        const [second] = await q<{ claimed: boolean; held_at: string }>(
            `select * from claim_idempotency_key($1, 'user-1', 'create_export_window')`, [key]);
        expect(second.claimed).toBe(false);
        // It reports when the winner claimed it, so a caller can say how long ago.
        expect(second.held_at).not.toBeNull();
    });

    dbIt('and two concurrent submissions of one key: one winner', async () => {
        const key = `pgt-key-race-${process.pid}`;
        const other = await secondClient();
        try {
            const sql = `select * from claim_idempotency_key($1, 'user-1', 'create_export_window')`;
            const [a, b] = await Promise.all([client!.query(sql, [key]), other.query(sql, [key])]);
            expect([a.rows[0].claimed, b.rows[0].claimed].filter(Boolean)).toHaveLength(1);
        } finally {
            await other.end();
        }
    });
});

dbDescribe('debit_jsonb_balance — a balance cannot go negative', () => {
    dbIt('debits what is there', async () => {
        await seedDoc('cooperative_members', 'pgt-m1', { savingsBalance: 5000 });

        const [row] = await q<{ ok: boolean; balance: string }>(
            `select * from debit_jsonb_balance('document_collections','pgt-m1','savingsBalance',2000,'cooperative_members')`);

        expect(row.ok).toBe(true);
        expect(Number(row.balance)).toBe(3000);
    });

    dbIt('and refuses to overdraw rather than writing a negative', async () => {
        await seedDoc('cooperative_members', 'pgt-m2', { savingsBalance: 1000 });

        const [row] = await q<{ ok: boolean; balance: string; reason: string }>(
            `select * from debit_jsonb_balance('document_collections','pgt-m2','savingsBalance',5000,'cooperative_members')`);

        expect(row.ok).toBe(false);
        expect(row.reason).toBeTruthy();

        const [doc] = await q<{ raw_data: Record<string, unknown> }>(
            `select raw_data from document_collections where id = 'pgt-m2'`);
        expect(Number(doc.raw_data.savingsBalance)).toBe(1000);
    });

    dbIt('and ten concurrent debits of a balance that only covers four', async () => {
        // THE double-spend case, run for real. 4000 available, ten callers each
        // taking 1000: six refused, balance lands on zero, never below.
        await seedDoc('cooperative_members', 'pgt-m3', { savingsBalance: 4000 });

        const clients = await Promise.all(Array.from({ length: 10 }, () => secondClient()));
        try {
            const sql = `select * from debit_jsonb_balance('document_collections','pgt-m3','savingsBalance',1000,'cooperative_members')`;
            const results = await Promise.all(clients.map((c) => c.query(sql)));

            expect(results.filter((r) => r.rows[0].ok)).toHaveLength(4);

            const [doc] = await q<{ raw_data: Record<string, unknown> }>(
                `select raw_data from document_collections where id = 'pgt-m3'`);
            expect(Number(doc.raw_data.savingsBalance)).toBe(0);
        } finally {
            await Promise.all(clients.map((c) => c.end()));
        }
    });
});
