/**
 * @jest-environment node
 */

/**
 *   #653 FOUR MONEY FUNCTIONS NOTHING HAD EVER RUN.
 *
 *   #652 found that `decrement_many_or_fail` — the guard between two buyers and
 *   the last unit of stock — was proved by nothing, and that it oversold. The
 *   same question asked of the rest of the money SQL gives the same answer for
 *   four more, and all four are live:
 *
 *     debit_jsonb_balance_with_floor  cooperative withdrawal, loan repayment,
 *                                     coop money, export booking release
 *     debit_jsonb_balance             coop money, WAVE earnings, fixed savings
 *     debit_wallet_once               the wallet debit
 *     claim_versioned_update          optimistic locking, used platform-wide
 *
 *   `money-functions.test.ts` proves the concurrency of six functions and none
 *   of these is among them; the db-integration suites cover `claim_payment_once`
 *   and the bounded counters. Every unit suite that touches any of these MOCKS
 *   it, which is the only thing a globally-mocked adapter can do.
 *
 * ── NO DEFECT WAS FOUND IN ANY OF THE FOUR ──────────────────────────────────
 *
 *   Said plainly, because after #652 the expectation was that there would be.
 *   They lock the row and read under the lock, they check before they write,
 *   they refuse a non-positive amount, they distinguish a missing row from a
 *   zero balance, and `claim_versioned_update` writes `_version` AFTER the
 *   caller's patch so a patch cannot forge it. The dotted-path handling, the
 *   string-valued balance, and the missing-collection case were all probed by
 *   hand against a real database before this file was written, and all three
 *   behave.
 *
 *   What was missing was any of that being checked. Every property below is one
 *   an ordinary edit could remove without a single existing test noticing —
 *   the mutation table at the foot of this file is that list.
 *
 * ── WHAT ONLY THIS HARNESS CAN SHOW ─────────────────────────────────────────
 *
 *   The three concurrency cases. Two callers debiting the same balance at once,
 *   two claiming the same version, two spending the same reference: the whole
 *   reason these are Postgres functions rather than JavaScript is that
 *   `runTransaction` in this codebase takes no lock, so a check-then-write lets
 *   both callers through. Nothing had ever demonstrated that the replacement
 *   works.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL, waitUntilBlocked as blocked } from '@/lib/testing/pg-harness';

let client: Client | null = null;

const WALLETS = 'wallets';

beforeAll(async () => {
    if (!PG_URL) return;
    client = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

/** A document_collections row carrying `raw_data`. */
async function doc(id: string, collection: string, raw: unknown): Promise<void> {
    await client!.query(
        `insert into document_collections (id, collection_name, raw_data)
         values ($1, $2, $3::jsonb)
         on conflict (id, collection_name) do update set raw_data = excluded.raw_data`,
        [id, collection, JSON.stringify(raw)],
    );
}

async function readDoc(id: string, collection: string): Promise<any> {
    const { rows } = await client!.query(
        `select raw_data from document_collections where id = $1 and collection_name = $2`,
        [id, collection],
    );
    return rows[0]?.raw_data;
}

const call = async (sql: string, params: unknown[]) =>
    (await client!.query(sql, params)).rows[0];

const pidOf = async (c: Client): Promise<number> =>
    Number((await c.query('select pg_backend_pid() as pid')).rows[0].pid);

const debit = (id: string, field: string, amount: number) =>
    call('select * from debit_jsonb_balance($1,$2,$3,$4,$5)',
        ['document_collections', id, field, amount, 'wallets']);

const debitFloor = (id: string, field: string, amount: number, floor: number) =>
    call('select * from debit_jsonb_balance_with_floor($1,$2,$3,$4,$5,$6)',
        ['document_collections', id, field, amount, floor, 'wallets']);

const claim = (id: string, expected: number | null, patch: unknown = {}) =>
    call('select * from claim_versioned_update($1,$2,$3,$4::jsonb,$5)',
        ['document_collections', id, expected, JSON.stringify(patch), 'wallets']);

beforeEach(async () => {
    if (!client) return;
    await client.query(`delete from document_collections where id like '653-%'`);
    await client.query(`delete from processed_payments where id like '653-%'`);
    await client.query(`delete from ${WALLETS} where id like '653-%'`);
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#653 — a balance cannot be spent below zero', () => {
    it('DEBITS WHAT IS THERE', async () => {
        await doc('653-a', 'wallets', { balance: 500, note: 'keep me' });

        const r = await debit('653-a', 'balance', 200);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 300 });
        expect(await readDoc('653-a', 'wallets')).toEqual({ balance: 300, note: 'keep me' });
    });

    it('AND REFUSES WHAT IS NOT, LEAVING THE BALANCE ALONE', async () => {
        await doc('653-b', 'wallets', { balance: 500 });

        const r = await debit('653-b', 'balance', 501);

        expect({ ok: r.ok, reason: r.reason, balance: Number(r.balance) })
            .toEqual({ ok: false, reason: 'insufficient_funds', balance: 500 });
        expect((await readDoc('653-b', 'wallets')).balance).toBe(500);
    });

    it('AND SPENDING EXACTLY THE BALANCE IS ALLOWED', async () => {
        //   The boundary in the direction that matters: an off-by-one here stops
        //   every member emptying their own wallet.
        await doc('653-c', 'wallets', { balance: 500 });

        const r = await debit('653-c', 'balance', 500);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 0 });
    });

    it('AND A MISSING ROW IS not_found, NOT A BALANCE OF ZERO', async () => {
        /*
         *   The two look identical through a COALESCE and mean different things:
         *   one is a member with no money, the other is a lookup that went to
         *   the wrong place. A caller told "insufficient_funds" for a row that
         *   does not exist would show a member a balance they do not have.
         */
        const r = await debit('653-nothing', 'balance', 1);

        expect({ ok: r.ok, reason: r.reason }).toEqual({ ok: false, reason: 'not_found' });
    });

    it('AND A NON-POSITIVE AMOUNT IS AN ERROR', async () => {
        await doc('653-d', 'wallets', { balance: 500 });

        await expect(debit('653-d', 'balance', 0)).rejects.toThrow(/amount must be positive/);
        await expect(debit('653-d', 'balance', -100)).rejects.toThrow(/amount must be positive/);
        expect((await readDoc('653-d', 'wallets')).balance).toBe(500);
    });

    it('AND A DOTTED FIELD READS AND WRITES THE SAME NESTED PLACE', async () => {
        //   The read uses `#>>` and the write uses `jsonb_set`; they are
        //   different operators and have to agree about the path, and nothing
        //   said they did.
        await doc('653-e', 'wallets', { wallet: { balance: 500 }, other: 'keep' });

        const r = await debit('653-e', 'wallet.balance', 100);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 400 });
        expect(await readDoc('653-e', 'wallets'))
            .toEqual({ wallet: { balance: 400 }, other: 'keep' });
    });

    it('AND A BALANCE STORED AS A STRING IS STILL MONEY', async () => {
        //   Legacy rows carry `"500"`. Refusing them would lock members out of
        //   their own funds; the write normalises to a number.
        await doc('653-f', 'wallets', { balance: '500' });

        const r = await debit('653-f', 'balance', 100);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 400 });
        expect((await readDoc('653-f', 'wallets')).balance).toBe(400);
    });

    it('AND A document_collections CALL WITH NO COLLECTION TOUCHES NOTHING', async () => {
        //   `collection_name = NULL` matches no row, so the answer is not_found
        //   rather than a debit against whichever row happened to share the id.
        await doc('653-g', 'wallets', { balance: 500 });

        const r = await call('select * from debit_jsonb_balance($1,$2,$3,$4,$5)',
            ['document_collections', '653-g', 'balance', 100, null]);

        expect({ ok: r.ok, reason: r.reason }).toEqual({ ok: false, reason: 'not_found' });
        expect((await readDoc('653-g', 'wallets')).balance).toBe(500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#653 — and a floor is a different refusal from an empty purse', () => {
    it('REFUSES A DEBIT THAT WOULD BREAK THE FLOOR', async () => {
        await doc('653-h', 'wallets', { balance: 5000 });

        const r = await debitFloor('653-h', 'balance', 4000, 2000);

        expect({ ok: r.ok, reason: r.reason }).toEqual({ ok: false, reason: 'below_floor' });
        expect((await readDoc('653-h', 'wallets')).balance).toBe(5000);
    });

    it('AND ALLOWS ONE THAT LANDS EXACTLY ON IT', async () => {
        //   The control, and the boundary: a floor of 2,000 means a member may
        //   be left with 2,000, not 2,001.
        await doc('653-i', 'wallets', { balance: 5000 });

        const r = await debitFloor('653-i', 'balance', 3000, 2000);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 2000 });
    });

    it('AND SAYS insufficient_funds BEFORE below_floor', async () => {
        /*
         *   The order is deliberate and the function says so: "A member with 200
         *   who asks for 5,000 against a floor of 5,000 has insufficient funds,
         *   not a floor problem; reporting the floor first would tell them to
         *   keep a balance they never had."
         *
         *   Both conditions are true here, so only the ORDER decides what the
         *   member is told. Nothing asserted it.
         */
        await doc('653-j', 'wallets', { balance: 200 });

        const r = await debitFloor('653-j', 'balance', 5000, 5000);

        expect(r.reason).toBe('insufficient_funds');
    });

    it('AND A NEGATIVE FLOOR IS AN ERROR, not a licence to overdraw', async () => {
        await doc('653-k', 'wallets', { balance: 500 });

        await expect(debitFloor('653-k', 'balance', 100, -1))
            .rejects.toThrow(/floor must be >= 0/);
        expect((await readDoc('653-k', 'wallets')).balance).toBe(500);
    });

    it('AND A FLOOR OF ZERO BEHAVES LIKE THE PLAIN DEBIT', async () => {
        //   The two functions must not disagree at the one point they overlap.
        await doc('653-l', 'wallets', { balance: 500 });
        await doc('653-m', 'wallets', { balance: 500 });

        const floored = await debitFloor('653-l', 'balance', 500, 0);
        const plain = await debit('653-m', 'balance', 500);

        expect({ ok: floored.ok, balance: Number(floored.balance) })
            .toEqual({ ok: plain.ok, balance: Number(plain.balance) });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#653 — a reference is spent once', () => {
    async function wallet(id: string, balance: number): Promise<void> {
        await client!.query(
            `insert into ${WALLETS} (id, balance, raw_data)
             values ($1, $2, $3::jsonb)
             on conflict (id) do update set balance = excluded.balance, raw_data = excluded.raw_data`,
            [id, balance, JSON.stringify({ balance })],
        );
    }
    const walletBalance = async (id: string) => Number(
        (await client!.query(`select balance from ${WALLETS} where id = $1`, [id])).rows[0]?.balance,
    );
    const debitOnce = (ref: string, user: string, amount: number) =>
        call('select * from debit_wallet_once($1,$2,$3,$4)', [ref, user, amount, 'test']);

    it('DEBITS ONCE AND RECORDS THE REFERENCE', async () => {
        await wallet('653-w1', 1000);

        const r = await debitOnce('653-ref-1', '653-w1', 400);

        expect({ ok: r.ok, balance: Number(r.balance) }).toEqual({ ok: true, balance: 600 });
        expect(await walletBalance('653-w1')).toBe(600);
    });

    it('AND THE SAME REFERENCE AGAIN TAKES NOTHING MORE', async () => {
        //   THE property. Without it a retried callback debits twice, which is
        //   the class of defect claim_payment_once exists for on the other side.
        await wallet('653-w2', 1000);

        await debitOnce('653-ref-2', '653-w2', 400);
        const again = await debitOnce('653-ref-2', '653-w2', 400);

        expect({ ok: again.ok, reason: again.reason })
            .toEqual({ ok: false, reason: 'already_processed' });
        expect(await walletBalance('653-w2')).toBe(600);
    });

    it('AND A REFUSED DEBIT SPENDS NO REFERENCE', async () => {
        /*
         *   The other half, and the one that would be invisible: if the claim
         *   were written before the funds check, a member briefly short of money
         *   would burn the reference and could never retry the same payment.
         */
        await wallet('653-w3', 100);

        const r = await debitOnce('653-ref-3', '653-w3', 400);
        expect(r.reason).toBe('insufficient_funds');

        //   Money arrives, and the same reference now works.
        await wallet('653-w3', 1000);
        const retry = await debitOnce('653-ref-3', '653-w3', 400);

        expect({ ok: retry.ok, balance: Number(retry.balance) })
            .toEqual({ ok: true, balance: 600 });
    });

    it('AND A MISSING WALLET IS no_wallet', async () => {
        const r = await debitOnce('653-ref-4', '653-nobody', 1);
        expect({ ok: r.ok, reason: r.reason }).toEqual({ ok: false, reason: 'no_wallet' });
    });

    it('AND THE LEDGER ROW IS NOT COUNTED AS REVENUE', async () => {
        /*
         *   `status: 'wallet_debit'`, deliberately not 'completed' — the
         *   function's own comment says global-aggregation sums completed rows
         *   as revenue. A debit booked as revenue would inflate every platform
         *   total on the admin dashboard.
         */
        await wallet('653-w5', 1000);
        await debitOnce('653-ref-5', '653-w5', 400);

        const { rows } = await client!.query(
            `select raw_data ->> 'status' as status from processed_payments where id = $1`,
            ['653-ref-5'],
        );
        expect(rows[0].status).toBe('wallet_debit');
    });

    it('AND TWO CALLERS WITH ONE REFERENCE DEBIT ONCE BETWEEN THEM', async () => {
        //   Two connections, both in a transaction, same reference. The wallet
        //   lock serialises them and the second finds the reference spent.
        await wallet('653-w6', 1000);

        const a = new Client({ connectionString: PG_URL });
        const b = new Client({ connectionString: PG_URL });
        await a.connect();
        await b.connect();
        try {
            await a.query('BEGIN');
            await b.query('BEGIN');
            const args = ['653-ref-6', '653-w6', 400, 'test'];
            //   A takes the row lock and HOLDS it — its transaction is still
            //   open. B is issued next and must be BLOCKED before A commits, or
            //   the lock is not what decides the outcome. See waitUntilBlocked.
            const bPid = await pidOf(b);
            const firstRow = (await a.query('select * from debit_wallet_once($1,$2,$3,$4)', args)).rows[0];
            const second = b.query('select * from debit_wallet_once($1,$2,$3,$4)', args);
            await blocked(client!, bPid);
            await a.query('COMMIT');
            const secondRow = (await second).rows[0];
            await b.query('COMMIT');

            expect({ first: firstRow.ok, second: secondRow.ok })
                .toEqual({ first: true, second: false });
            expect(secondRow.reason).toBe('already_processed');
        } finally {
            await a.end().catch(() => {});
            await b.end().catch(() => {});
        }

        expect(await walletBalance('653-w6')).toBe(600);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#653 — a version is claimed by one writer', () => {
    it('CLAIMS WHEN THE VERSION MATCHES, AND MOVES IT ON', async () => {
        await doc('653-v1', 'wallets', { _version: 3, status: 'pending' });

        const r = await claim('653-v1', 3, { status: 'approved' });

        expect({ claimed: r.claimed, version: Number(r.version) })
            .toEqual({ claimed: true, version: 4 });
        expect(await readDoc('653-v1', 'wallets'))
            .toEqual({ _version: 4, status: 'approved' });
    });

    it('AND REFUSES A STALE EXPECTATION WITHOUT WRITING', async () => {
        await doc('653-v2', 'wallets', { _version: 5, status: 'pending' });

        const r = await claim('653-v2', 3, { status: 'approved' });

        expect({ claimed: r.claimed, version: Number(r.version) })
            .toEqual({ claimed: false, version: 5 });
        expect((await readDoc('653-v2', 'wallets')).status).toBe('pending');
    });

    it('AND A ROW WRITTEN BEFORE VERSIONING COUNTS AS VERSION ZERO', async () => {
        //   optimistic-locking.ts's backfill behaviour: records older than
        //   versioning must stay updatable, or an edit to any of them is
        //   impossible for ever.
        await doc('653-v3', 'wallets', { status: 'pending' });

        const r = await claim('653-v3', 0, { status: 'approved' });

        expect({ claimed: r.claimed, version: Number(r.version) })
            .toEqual({ claimed: true, version: 1 });
    });

    it('AND A NULL EXPECTATION CLAIMS WITHOUT ASSERTING', async () => {
        await doc('653-v4', 'wallets', { _version: 7 });

        const r = await claim('653-v4', null, { note: 'set' });

        expect({ claimed: r.claimed, version: Number(r.version) })
            .toEqual({ claimed: true, version: 8 });
    });

    it('AND A PATCH CANNOT FORGE THE VERSION', async () => {
        /*
         *   `raw_data || patch || {_version}` — the version is applied LAST, so
         *   a caller who puts `_version` in their patch cannot set it. Reverse
         *   those two and a single request could freeze a row's version for
         *   ever, and every optimistic lock on it would pass.
         */
        await doc('653-v5', 'wallets', { _version: 2 });

        const r = await claim('653-v5', 2, { _version: 99, note: 'x' });

        expect(Number(r.version)).toBe(3);
        expect((await readDoc('653-v5', 'wallets'))._version).toBe(3);
    });

    it('AND A MISSING ROW IS NOT CLAIMED', async () => {
        const r = await claim('653-nothing', 0, {});
        expect({ claimed: r.claimed, version: r.version }).toEqual({ claimed: false, version: null });
    });

    it('AND TWO WRITERS AT ONE VERSION: EXACTLY ONE WINS', async () => {
        /*
         *   THE property, and the reason this is SQL. Both read version 3, both
         *   would have passed a JavaScript check-then-write, and the loser's
         *   update would silently overwrite the winner's.
         */
        await doc('653-race', 'wallets', { _version: 3, owner: 'none' });

        const a = new Client({ connectionString: PG_URL });
        const b = new Client({ connectionString: PG_URL });
        await a.connect();
        await b.connect();
        try {
            await a.query('BEGIN');
            await b.query('BEGIN');
            const sql = 'select * from claim_versioned_update($1,$2,$3,$4::jsonb,$5)';
            //   A first and held; B issued and waited for. See the note in the
            //   wallet race above.
            const bPid = await pidOf(b);
            const firstRow = (await a.query(sql, ['document_collections', '653-race', 3, '{"owner":"a"}', 'wallets'])).rows[0];
            const second = b.query(sql, ['document_collections', '653-race', 3, '{"owner":"b"}', 'wallets']);
            await blocked(client!, bPid);
            await a.query('COMMIT');
            const secondRow = (await second).rows[0];
            await b.query('COMMIT');

            expect({ first: firstRow.claimed, second: secondRow.claimed })
                .toEqual({ first: true, second: false });
        } finally {
            await a.end().catch(() => {});
            await b.end().catch(() => {});
        }

        const after = await readDoc('653-race', 'wallets');
        expect({ version: after._version, owner: after.owner })
            .toEqual({ version: 4, owner: 'a' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#653 — and two debits of one balance do not both succeed', () => {
    it('EXACTLY ONE OF TWO CONCURRENT FULL DEBITS WINS', async () => {
        /*
         *   The case every one of these functions exists for. Both callers read
         *   500 and ask for 500; a check-then-write in JavaScript lets both
         *   through and the balance ends at 0 having paid out 1,000.
         */
        await doc('653-drace', 'wallets', { balance: 500 });

        const a = new Client({ connectionString: PG_URL });
        const b = new Client({ connectionString: PG_URL });
        await a.connect();
        await b.connect();
        try {
            await a.query('BEGIN');
            await b.query('BEGIN');
            const sql = 'select * from debit_jsonb_balance($1,$2,$3,$4,$5)';
            const args = ['document_collections', '653-drace', 'balance', 500, 'wallets'];
            //   A first and held; B issued and waited for.
            const bPid = await pidOf(b);
            const firstRow = (await a.query(sql, args)).rows[0];
            const second = b.query(sql, args);
            await blocked(client!, bPid);
            await a.query('COMMIT');
            const secondRow = (await second).rows[0];
            await b.query('COMMIT');

            expect({ first: firstRow.ok, second: secondRow.ok })
                .toEqual({ first: true, second: false });
            expect(secondRow.reason).toBe('insufficient_funds');
        } finally {
            await a.end().catch(() => {});
            await b.end().catch(() => {});
        }

        //   The figure that matters: never below zero.
        expect((await readDoc('653-drace', 'wallets')).balance).toBe(0);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   The function bodies themselves, mutated in the live database with
 *   CREATE OR REPLACE and restored afterwards, the whole file re-run each time.
 *
 *     MUTANT                                                        RESULT
 *     debit: the row lock is dropped                                  KILLED
 *     debit: the balance may go negative                              KILLED
 *     debit: off by one, the last naira is unspendable                KILLED
 *     floor: the two refusals are reported the wrong way round        KILLED
 *     floor: the floor stops being enforced                           KILLED
 *     wallet: the reference is claimed before the funds check         KILLED
 *     wallet: a spent reference debits again                          KILLED
 *     wallet: the debit is booked as completed revenue                KILLED
 *     version: a patch can forge the version                          KILLED
 *     version: the stale-expectation check is removed                 KILLED
 *     version: the row lock is dropped                                KILLED
 *
 *   Eleven properties, each of which an ordinary edit could have removed with no
 *   existing test noticing, because no existing test ran any of these functions.
 *
 * ── TWO SURVIVED THE FIRST RUN, AND THE CAUSE WAS THIS FILE ─────────────────
 *
 *   Both were "the row lock is dropped", and they survived because of how the
 *   races here were written — a chain of three attempts worth recording, since
 *   the first two each looked correct:
 *
 *     1. fire both callers, await the first.  DEADLOCKS THE TEST whenever the
 *        second wins the lock: the first is awaited, it waits for the second,
 *        and the second's commit sits behind an await that never runs. The suite
 *        hung for ten minutes.
 *     2. run A, issue B, commit A.  Deterministic, and it quietly removed the
 *        race — nothing made B reach its statement before A committed, so B read
 *        already-committed data and refused for the ordinary reason. Deleting
 *        FOR UPDATE then changed nothing at all.
 *     3. run A, issue B, WAIT UNTIL B IS BLOCKED, commit A.  The lock is now the
 *        thing that decides, and both mutants die.
 *
 *   Version 2 is the dangerous one. It passes, it looks like a concurrency test,
 *   and it asserts nothing about concurrency. Mutation testing is the only
 *   reason anybody would know.
 */
