/**
 * @jest-environment node
 */

/**
 *   THE ONLY PATH ON THIS PLATFORM THAT MOVES MONEY BETWEEN TWO WALLETS.
 *
 *   Everything else moves it into or out of ONE: credit_wallet_once inserts at
 *   `p_user_id`, debit_wallet_once updates `WHERE id = p_user_id`, and
 *   `p_user_id` is the session's id — live by construction, since #490 ranks a
 *   superseded row last at login.
 *
 *   Which is exactly why a balance left under a superseded profile is stranded:
 *   it cannot be received into, spent from, or withdrawn, by the member or by
 *   anybody else. Migration 046 is the way out, and it is a DATABASE function
 *   rather than a credit followed by a debit for one reason:
 *
 *       Both of those are idempotent. THE PAIR IS NOT ATOMIC. A crash, a
 *       timeout or a deploy between them leaves the credit applied without its
 *       debit — which does not lose money, it MINTS it.
 *
 *   So the properties below are not stylistic. `money is conserved` and
 *   `a rollback takes both sides with it` are the whole reason this exists in
 *   SQL, and neither can be tested anywhere but against a real cluster.
 *
 * ── AND IT CARRIES ITS OWN AUTHORISATION ────────────────────────────────────
 *
 *   The check that two ids are one person is re-read inside the same
 *   transaction as the move, from `users`. Not taken from an argument, and not
 *   left to the caller — an admin action can be wrong, can be called from
 *   somewhere new, or can be replaced by a script. A function that moved money
 *   between arbitrary ids on request would be a transfer primitive, and the
 *   refusal tests below are what stop it becoming one.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL, HAS_PG } from '@/lib/testing/pg-harness';

let client: Client | null = null;

const LIVE = 'wc-live';
const OLD = 'wc-old';
const OTHER = 'wc-other';
const MIDDLE = 'wc-middle';

beforeAll(async () => {
    if (!HAS_PG) return;
    const c = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('select 1');
    client = c;
});

afterAll(async () => {
    if (client) {
        await client.query(
            `delete from document_collections where collection_name = 'wallet_transactions'
               and raw_data->>'consolidatedFrom' = any($1)`, [[OLD, OTHER, MIDDLE, LIVE]],
        ).catch(() => {});
        await client.query('delete from wallets where id = any($1)', [[LIVE, OLD, OTHER, MIDDLE]]).catch(() => {});
        await client.query('delete from users where id = any($1)', [[LIVE, OLD, OTHER, MIDDLE]]).catch(() => {});
    }
    await client?.end().catch(() => {});
});

async function q<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await client!.query(sql, params);
    return r.rows as T[];
}

/** Both copies of the balance — 011's rule, and what the application reads. */
async function balances(id: string): Promise<{ native: number; raw: number | null }> {
    const rows = await q(`select balance, raw_data->>'balance' as raw from wallets where id = $1`, [id]);
    if (rows.length === 0) return { native: 0, raw: null };
    return { native: Number(rows[0].balance), raw: rows[0].raw === null ? null : Number(rows[0].raw) };
}

async function move(from: string, to: string, actor = 'an-admin') {
    const rows = await q(
        `select * from consolidate_wallet_to_live_profile($1, $2, $3)`, [from, to, actor],
    );
    return rows[0];
}

async function seedWallet(id: string, balance: number): Promise<void> {
    await q(
        `insert into wallets (id, balance, raw_data) values ($1, $2, $3::jsonb)
         on conflict (id) do update set balance = excluded.balance, raw_data = excluded.raw_data`,
        [id, balance, JSON.stringify({ id, userId: id, balance, currency: 'NGN' })],
    );
}

beforeEach(async () => {
    if (!HAS_PG) return;
    await q(`delete from document_collections where collection_name = 'wallet_transactions'
               and raw_data->>'consolidatedFrom' = any($1)`, [[OLD, OTHER, MIDDLE, LIVE]]);
    await q('delete from wallets where id = any($1)', [[LIVE, OLD, OTHER, MIDDLE]]);
    await q('delete from users where id = any($1)', [[LIVE, OLD, OTHER, MIDDLE]]);

    //   One person with two rows, an unrelated person, and a middle row so the
    //   chain case is reachable: MIDDLE -> OLD -> LIVE.
    await q(
        `insert into users (id, raw_data) values
            ($1, $2::jsonb), ($3, $4::jsonb), ($5, $6::jsonb), ($7, $8::jsonb)`,
        [
            LIVE, JSON.stringify({ id: LIVE, email: 'member@example.com' }),
            OLD, JSON.stringify({ id: OLD, email: 'member@example.com', _migratedTo: LIVE }),
            OTHER, JSON.stringify({ id: OTHER, email: 'other@example.com' }),
            MIDDLE, JSON.stringify({ id: MIDDLE, email: 'member@example.com', _migratedTo: OLD }),
        ],
    );
});

dbDescribe('consolidate_wallet_to_live_profile — the move', () => {
    it('moves the whole balance onto the live profile', async () => {
        await seedWallet(OLD, 5000);

        const r = await move(OLD, LIVE);

        expect(r.moved).toBe(true);
        expect(Number(r.amount)).toBe(5000);
        expect(Number(r.to_balance)).toBe(5000);
    });

    it('AND MONEY IS CONSERVED — the property the whole design is for', async () => {
        //   THE test. A credit and a debit as two RPC calls would satisfy every
        //   other assertion in this file and still fail this one the day the
        //   pair broke halfway.
        await seedWallet(OLD, 7500);
        await seedWallet(LIVE, 250);

        const before = (await balances(OLD)).raw! + (await balances(LIVE)).raw!;
        await move(OLD, LIVE);
        const after = (await balances(OLD)).raw! + (await balances(LIVE)).raw!;

        expect(before).toBe(7750);
        expect(after).toBe(before);
    });

    it('AND A ROLLBACK TAKES BOTH SIDES WITH IT', async () => {
        //   The other half of atomicity: not just that both writes happen, but
        //   that neither survives alone.
        await seedWallet(OLD, 2000);
        await seedWallet(LIVE, 100);

        await q('begin');
        const r = await move(OLD, LIVE, 'rolled-back');
        expect(r.moved).toBe(true);           // it really did move, inside the txn
        await q('rollback');

        expect((await balances(OLD)).raw).toBe(2000);
        expect((await balances(LIVE)).raw).toBe(100);
        const ledger = await q(
            `select 1 from document_collections where collection_name = 'wallet_transactions'
               and raw_data->>'actorId' = 'rolled-back'`);
        expect(ledger).toHaveLength(0);
    });

    it('and writes BOTH copies of the balance — 011', async () => {
        //   A wallet carries its balance twice and the application reads
        //   raw_data. 005/006 moved money in the column the app never looks at.
        await seedWallet(OLD, 900);

        await move(OLD, LIVE);

        expect(await balances(OLD)).toEqual({ native: 0, raw: 0 });
        expect(await balances(LIVE)).toEqual({ native: 900, raw: 900 });
    });

    it('and creates the live wallet when the member has none', async () => {
        await seedWallet(OLD, 1200);

        await move(OLD, LIVE);

        expect((await balances(LIVE)).raw).toBe(1200);
    });

    it('and records a matched pair, both sides, one reference', async () => {
        await seedWallet(OLD, 4000);
        await seedWallet(LIVE, 1000);

        await move(OLD, LIVE);

        const rows = await q(
            `select raw_data->>'type' as type, (raw_data->>'amount')::numeric as amount,
                    (raw_data->>'balanceBefore')::numeric as before,
                    (raw_data->>'balanceAfter')::numeric as after,
                    raw_data->>'reference' as reference
               from document_collections
              where collection_name = 'wallet_transactions'
                and raw_data->>'consolidatedFrom' = $1
              order by raw_data->>'type'`, [OLD]);

        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.type)).toEqual(['consolidation_in', 'consolidation_out']);
        //   Net zero, which is what makes it a move rather than a creation.
        expect(Number(rows[0].amount) + Number(rows[1].amount)).toBe(0);
        expect(rows[0].reference).toBe(rows[1].reference);
        //   And each side's arithmetic closes.
        expect(Number(rows[0].before)).toBe(1000);
        expect(Number(rows[0].after)).toBe(5000);
        expect(Number(rows[1].before)).toBe(4000);
        expect(Number(rows[1].after)).toBe(0);
    });

    it('and is idempotent — a second call moves nothing', async () => {
        await seedWallet(OLD, 3000);

        await move(OLD, LIVE);
        const second = await move(OLD, LIVE);

        expect(second.moved).toBe(false);
        expect(second.reason).toBe('nothing_to_move');
        expect((await balances(LIVE)).raw).toBe(3000);
    });

    it('and two concurrent calls move the balance exactly once', async () => {
        //   The lock is what makes this true. Without FOR UPDATE both would
        //   read 6000 and both would credit it.
        await seedWallet(OLD, 6000);

        const other = new Client({ connectionString: PG_URL });
        await other.connect();
        try {
            const sql = `select * from consolidate_wallet_to_live_profile('${OLD}', '${LIVE}', 'race')`;
            const [a, b] = await Promise.all([client!.query(sql), other.query(sql)]);
            const moved = [a.rows[0], b.rows[0]].filter((r: any) => r.moved);

            expect(moved).toHaveLength(1);
            expect((await balances(LIVE)).raw).toBe(6000);
        } finally {
            await other.end().catch(() => {});
        }
    });
});

dbDescribe('consolidate_wallet_to_live_profile — what it refuses', () => {
    it('REFUSES A PAIR THE PLATFORM DOES NOT SAY IS ONE PERSON', async () => {
        //   THE refusal. Without it this is a transfer primitive: any balance,
        //   to any id, on request.
        await seedWallet(OTHER, 999999);

        const r = await move(OTHER, LIVE);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('not_the_same_person');
        expect((await balances(OTHER)).raw).toBe(999999);
    });

    it('and refuses the reverse direction too', async () => {
        //   LIVE does not point at OLD — supersession has a direction, and
        //   draining the live wallet into a dead one is the defect inverted.
        await seedWallet(LIVE, 5000);

        const r = await move(LIVE, OLD);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('not_the_same_person');
        expect((await balances(LIVE)).raw).toBe(5000);
    });

    it('and refuses a target that is itself superseded', async () => {
        //   MIDDLE -> OLD -> LIVE. Moving onto OLD strands the money one hop
        //   along, which is this defect performed by its own repair.
        await seedWallet(MIDDLE, 800);

        const r = await move(MIDDLE, OLD);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('target_is_not_live');
        expect((await balances(MIDDLE)).raw).toBe(800);
    });

    it('and says nothing_to_move for a zero balance — 272 wallets are here', async () => {
        await seedWallet(OLD, 0);

        const r = await move(OLD, LIVE);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('nothing_to_move');
    });

    it('and refuses a profile with no wallet at all', async () => {
        const r = await move(OLD, LIVE);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('no_source_wallet');
    });

    it('and refuses a source profile that does not exist', async () => {
        const r = await move('wc-nobody', LIVE);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('source_profile_not_found');
    });

    it('and refuses moving a wallet onto itself', async () => {
        await seedWallet(OLD, 500);

        const r = await move(OLD, OLD);

        expect(r.moved).toBe(false);
        expect(r.reason).toBe('same_profile');
        expect((await balances(OLD)).raw).toBe(500);
    });

    it('and honours supabaseAuthId as the pointer, not only _migratedTo', async () => {
        //   Both are the platform's statement that two rows are one person —
        //   resolveActiveUser walks _migratedTo then supabaseAuthId, and a row
        //   linked to an auth account is never tombstoned.
        await q(`update users set raw_data = $2::jsonb where id = $1`,
            [OLD, JSON.stringify({ id: OLD, email: 'member@example.com', supabaseAuthId: LIVE })]);
        await seedWallet(OLD, 650);

        const r = await move(OLD, LIVE);

        expect(r.moved).toBe(true);
        expect((await balances(LIVE)).raw).toBe(650);
    });
});
