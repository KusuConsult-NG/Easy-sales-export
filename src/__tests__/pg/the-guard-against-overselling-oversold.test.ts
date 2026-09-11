/**
 * @jest-environment node
 */

/**
 *   #652 THE GUARD AGAINST OVERSELLING OVERSOLD.
 *
 *   `decrement_many_or_fail` is the single thing standing between two buyers and
 *   the last unit of stock. Every marketplace purchase door reserves through it,
 *   and so do the export catalogue and actions/orders.ts. Its call sites explain
 *   why it exists, in `orders.ts`'s own words:
 *
 *       runTransaction in this codebase takes no lock — it replays queued
 *       writes after the callback returns. So two buyers ordering the last unit
 *       both read availableQuantity 1, both pass the check, and both write 0.
 *       Two orders, one unit: overselling.
 *
 *   IT WAS TESTED BY NOTHING. money-functions.test.ts proves the concurrency of
 *   six SQL functions and this is not among them; the db-integration suites
 *   cover `claim_payment_once` and the bounded counters and not this. Every unit
 *   suite that touches it MOCKS it — including the two I wrote for #647 and
 *   #649. The function the whole marketplace's inventory rests on had no proof
 *   of any kind.
 *
 * ── AND IT OVERSOLD WHENEVER ONE CALL NAMED THE SAME ROW TWICE ──────────────
 *
 *   Pass 1 locked each row and compared its CURRENT value against that LINE's
 *   amount. Nothing had been decremented yet, so two lines of three against a
 *   stock of five both passed — 3 ≤ 5, twice — and pass 2 subtracted three
 *   twice:
 *
 *       stock 5, two lines of 3  ->  ok: true, stock: -1
 *
 *   Six units taken from a shelf holding five, reported as SUCCESS, so the order
 *   completes, escrow is written and the seller is credited for goods they
 *   cannot ship. The negative figure then leaks downstream into the card's
 *   "Only N left", the `availableQuantity === 0` tests, and the next buyer's
 *   reservation — which succeeds against a number that is already a lie.
 *
 *   Every caller maps order lines to decrement items ONE FOR ONE, and nothing
 *   between the cart and here merges them. The checkout screen merges on ADD,
 *   but the cart is localStorage JSON and the action is a reachable endpoint
 *   that takes the array it is given — and negative-price-cart.test.ts already
 *   exercises a two-line cart for one product, so the shape is not hypothetical.
 *
 *   Migration 035 sums the amounts per row before locking. This file is the
 *   proof, and the coverage the function should have had from the start.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

let client: Client | null = null;

const PRODUCTS = 'products';
const ITEM = (id: string, amount: number, field = 'availableQuantity', collection = PRODUCTS) =>
    ({ collection, id, field, amount });

beforeAll(async () => {
    if (!PG_URL) return;
    client = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

/** A product row with the given stock, replacing any earlier one. */
async function seed(id: string, stock: number | null): Promise<void> {
    const raw = stock === null
        ? { title: 'Yam' }
        : { title: 'Yam', availableQuantity: stock };
    await client!.query(
        `insert into document_collections (id, collection_name, raw_data)
         values ($1, $2, $3::jsonb)
         on conflict (id, collection_name) do update set raw_data = excluded.raw_data`,
        [id, PRODUCTS, JSON.stringify(raw)],
    );
}

async function stockOf(id: string): Promise<number | null> {
    const { rows } = await client!.query(
        `select raw_data ->> 'availableQuantity' as q
           from document_collections where id = $1 and collection_name = $2`,
        [id, PRODUCTS],
    );
    const q = rows[0]?.q;
    return q === undefined || q === null ? null : Number(q);
}

async function decrement(items: unknown[]): Promise<{ ok: boolean; failed_id: string | null; reason: string | null }> {
    const { rows } = await client!.query(
        'select * from decrement_many_or_fail($1::jsonb)', [JSON.stringify(items)],
    );
    return rows[0];
}

beforeEach(async () => {
    if (!client) return;
    await client.query(
        `delete from document_collections where collection_name = $1 and id like '652-%'`,
        [PRODUCTS],
    );
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#652 — one call, one row, named more than once', () => {
    it('THE DEFECT: two lines for one product must not take more than it holds', async () => {
        //   Six units out of a shelf holding five, and `ok: true` while it
        //   happened. The measurement that opened this finding.
        await seed('652-a', 5);

        const result = await decrement([ITEM('652-a', 3), ITEM('652-a', 3)]);

        expect({ ok: result.ok, reason: result.reason })
            .toEqual({ ok: false, reason: 'insufficient' });
        expect(await stockOf('652-a')).toBe(5);
    });

    it('AND WHEN THE TOTAL DOES FIT, IT IS TAKEN ONCE AND IN FULL', async () => {
        /*
         *   The control, and it fails in the opposite direction. A fix that
         *   merely refused any repeated id would pass the test above and stop a
         *   legitimate two-line cart from buying anything at all.
         */
        await seed('652-b', 5);

        const result = await decrement([ITEM('652-b', 2), ITEM('652-b', 2)]);

        expect(result.ok).toBe(true);
        expect(await stockOf('652-b')).toBe(1);
    });

    it('AND THE SAME PRODUCT ON FIVE LINES IS THE SAME AS ONE LINE OF FIVE', async () => {
        //   The property stated plainly: how the caller splits its lines cannot
        //   change the answer.
        await seed('652-c', 5);
        await seed('652-d', 5);

        const split = await decrement([1, 1, 1, 1, 1].map(() => ITEM('652-c', 1)));
        const whole = await decrement([ITEM('652-d', 5)]);

        expect({ split: split.ok, whole: whole.ok }).toEqual({ split: true, whole: true });
        expect(await stockOf('652-c')).toBe(await stockOf('652-d'));
        expect(await stockOf('652-c')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#652 — all of it or none of it', () => {
    it('A SHORTFALL ON THE LAST ITEM LEAVES THE FIRST UNTOUCHED', async () => {
        /*
         *   The reason this function exists at all rather than a loop. Migration
         *   015's own note: "a per-item loop would leave the first products
         *   decremented when the third turns out to be short."
         */
        await seed('652-e', 10);
        await seed('652-f', 1);

        const result = await decrement([ITEM('652-e', 5), ITEM('652-f', 5)]);

        expect({ ok: result.ok, failed: result.failed_id, reason: result.reason })
            .toEqual({ ok: false, failed: '652-f', reason: 'insufficient' });
        expect(await stockOf('652-e')).toBe(10);
    });

    it('AND A ROW THAT IS NOT THERE REFUSES THE WHOLE CALL', async () => {
        await seed('652-g', 10);

        const result = await decrement([ITEM('652-g', 1), ITEM('652-missing', 1)]);

        expect({ ok: result.ok, failed: result.failed_id, reason: result.reason })
            .toEqual({ ok: false, failed: '652-missing', reason: 'not_found' });
        expect(await stockOf('652-g')).toBe(10);
    });

    it('AND TAKING EXACTLY WHAT IS LEFT IS ALLOWED', async () => {
        //   The boundary, in the direction that matters: an off-by-one here
        //   refuses the last unit of every product in the shop.
        await seed('652-h', 3);

        const result = await decrement([ITEM('652-h', 3)]);

        expect(result.ok).toBe(true);
        expect(await stockOf('652-h')).toBe(0);
    });

    it('AND ONE UNIT MORE IS NOT', async () => {
        await seed('652-i', 3);

        const result = await decrement([ITEM('652-i', 4)]);

        expect({ ok: result.ok, reason: result.reason })
            .toEqual({ ok: false, reason: 'insufficient' });
        expect(await stockOf('652-i')).toBe(3);
    });

    it('AND AN UNRECORDED STOCK IS NOT AN UNLIMITED ONE', async () => {
        /*
         *   A missing field reads as zero, which is what #582 is about: the
         *   export path decremented a field that collection has never carried,
         *   so every paid export order was cancelled as out of stock. The
         *   behaviour is deliberate and is what lib/export-stock and #647's
         *   `stockOf` are both written around, so it is pinned here rather than
         *   left as an implementation detail.
         */
        await seed('652-j', null);

        const result = await decrement([ITEM('652-j', 1)]);

        expect({ ok: result.ok, reason: result.reason })
            .toEqual({ ok: false, reason: 'insufficient' });
    });

    it('AND A NON-POSITIVE AMOUNT IS AN ERROR, BEFORE ANYTHING IS LOCKED', async () => {
        /*
         *   negative-price-cart.test.ts records what a negative quantity was
         *   worth to an attacker before the cart refused it, and names this
         *   function as the backstop. The raise now happens before the first
         *   row is locked rather than part-way through the walk.
         */
        await seed('652-k', 10);

        await expect(decrement([ITEM('652-k', 5), ITEM('652-k', -1)]))
            .rejects.toThrow(/amount must be positive/);
        expect(await stockOf('652-k')).toBe(10);

        await expect(decrement([ITEM('652-k', 0)])).rejects.toThrow(/amount must be positive/);
        expect(await stockOf('652-k')).toBe(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#652 — two buyers, one unit', () => {
    it('EXACTLY ONE OF TWO CONCURRENT CALLERS GETS THE LAST UNIT', async () => {
        /*
         *   THE property, and the only harness that can show it: two separate
         *   connections, both in a transaction, both asking for the last unit at
         *   once. This is what the whole function is for, and nothing had ever
         *   demonstrated it.
         */
        await seed('652-race', 1);

        const a = new Client({ connectionString: PG_URL });
        const b = new Client({ connectionString: PG_URL });
        await a.connect();
        await b.connect();
        try {
            await a.query('BEGIN');
            await b.query('BEGIN');

            const items = JSON.stringify([ITEM('652-race', 1)]);
            //   A goes first and holds the row lock until it commits; B blocks
            //   inside the function on the same FOR UPDATE.
            const first = a.query('select * from decrement_many_or_fail($1::jsonb)', [items]);
            const second = b.query('select * from decrement_many_or_fail($1::jsonb)', [items]);

            const firstRow = (await first).rows[0];
            await a.query('COMMIT');
            const secondRow = (await second).rows[0];
            await b.query('COMMIT');

            expect({ first: firstRow.ok, second: secondRow.ok })
                .toEqual({ first: true, second: false });
            expect(secondRow.reason).toBe('insufficient');
        } finally {
            await a.end().catch(() => {});
            await b.end().catch(() => {});
        }

        //   The figure that matters: never below zero.
        expect(await stockOf('652-race')).toBe(0);
    });

    it('AND TWO ORDERS NAMING THE SAME PRODUCTS IN OPPOSITE ORDER DO NOT DEADLOCK', async () => {
        /*
         *   The reason pass 1 walks `ORDER BY id`, stated in the function's own
         *   comment and in wallet-ledger's — and asserted nowhere. Without it,
         *   one caller locks X then waits for Y while the other holds Y and
         *   waits for X, and Postgres kills one with a deadlock error rather
         *   than refusing it honestly.
         */
        await seed('652-x', 10);
        await seed('652-y', 10);

        const a = new Client({ connectionString: PG_URL });
        const b = new Client({ connectionString: PG_URL });
        await a.connect();
        await b.connect();
        try {
            await a.query('BEGIN');
            await b.query('BEGIN');
            await a.query("SET LOCAL lock_timeout = '10s'");
            await b.query("SET LOCAL lock_timeout = '10s'");

            const forward = JSON.stringify([ITEM('652-x', 1), ITEM('652-y', 1)]);
            const reverse = JSON.stringify([ITEM('652-y', 1), ITEM('652-x', 1)]);

            const first = a.query('select * from decrement_many_or_fail($1::jsonb)', [forward]);
            const second = b.query('select * from decrement_many_or_fail($1::jsonb)', [reverse]);

            expect((await first).rows[0].ok).toBe(true);
            await a.query('COMMIT');
            expect((await second).rows[0].ok).toBe(true);
            await b.query('COMMIT');
        } finally {
            await a.end().catch(() => {});
            await b.end().catch(() => {});
        }

        expect(await stockOf('652-x')).toBe(8);
        expect(await stockOf('652-y')).toBe(8);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   The strongest form available for a SQL fix: the PREVIOUS DEFINITION of the
 *   function, re-applied over the new one from migration 015 and the whole file
 *   re-run against the same live database.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: migration 015's definition, restored                KILLED
 *
 *   And it killed exactly ONE test — "two lines for one product must not take
 *   more than it holds". The other ten passed on the old function, which is the
 *   honest reading of what they are: coverage this function should have had from
 *   the start, and which nothing had ever provided. Ten of them are a
 *   description of a contract nobody had written down; one is the finding.
 *
 *   The aggregation and the lock order are separately mutated in the unit suite
 *   (the-checkout-never-asked-if-it-could-be-sold), which can assert on the
 *   migration's text in the default run where no database exists. Two halves:
 *   what the SQL DOES is proved here, that the SQL SAYS it is shipped is proved
 *   there.
 *
 * ── AND THE CART HALF HAS THE SAME BLIND SPOT, BECAUSE IT WAS MINE ──────────
 *
 *   #647's pre-charge stock check — added three findings ago — compared each
 *   cart LINE against the stock, which is precisely the mistake this function
 *   was making one layer down. Two lines of three against a stock of five passed
 *   it twice. It aggregates per product now.
 *
 *   Worth naming rather than quietly fixing: the same error was made
 *   independently in SQL and in TypeScript, by different people, years apart,
 *   because "check each item can afford it" reads as complete and is not.
 */
