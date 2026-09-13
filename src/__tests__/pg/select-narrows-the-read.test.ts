/**
 * @jest-environment node
 */

/**
 *   #696 `.select(...fields)` DID NOTHING, AND IT IS CALLED 75 TIMES ON THE
 *        HEAVIEST SCANS THE PLATFORM RUNS.
 *
 *   SupabaseQuery.select() stored its argument in `_selectedFields` and NOTHING
 *   EVER READ IT — not the query builder, not the row mapper, not even a trim in
 *   JavaScript. Its own comment admitted half of it ("we still fetch all
 *   raw_data from Supabase"); the whole of it is that the fields were narrowed
 *   nowhere, at any stage. A record nothing consults.
 *
 *   The callers are not incidental. They are the biggest reads on the platform,
 *   and every one of them believes it is asking for a handful of fields:
 *
 *     actions/sms-broadcast.ts          every user, every cooperative member,
 *                                       every WAVE and academy and farm-nation
 *                                       and export application — .all() over
 *                                       each, to build a broadcast audience
 *     cooperative/_coop_admin_reports   the transaction and loan reports
 *     api/cron/reconcile-fulfilment     whole-collection sweeps
 *     lib/broadcast-logic, user-cache, status-transition, messages, maintenance
 *
 *   Each was transferring whole documents.
 *
 * ── THIS IS THE MEASURED CAUSE OF "THE ADMIN PANEL IS SLOW" ─────────────────
 *
 *   The performance audit of 2026-08-10 established that it is NOT missing
 *   indexes. Migration 022 was written to add expression indexes and is headed
 *   "DO NOT APPLY. The numbers do not support it" — EXPLAIN ANALYZE showed the
 *   index scan would be SLOWER than the seq scan it replaced. The same file
 *   names what it actually is:
 *
 *       "598 ms to scan ~1,830 rows ... The likely cause is large JSONB being
 *        detoasted by SELECT *, or shared-tier I/O. SELECTING FEWER COLUMNS IS
 *        THE FIX; indexing is not."
 *
 *   #455 acted on that for AGGREGATES. The read path kept `select('*')` on
 *   dedicated tables and `select('id, raw_data')` everywhere else, and the one
 *   API a caller could use to ask for less was inert.
 *
 *   AND ONE PLACE ALREADY DID IT BY HAND. analytics.service.ts leaves the
 *   adapter entirely for the user-segmentation count:
 *
 *       supabaseAdmin.from("users")
 *         .select("raw_data->serviceRegistrations, raw_data->verificationProfile, ...")
 *
 *   because the adapter could not express it. One site doing the right thing by
 *   bypassing the layer that should carry it — the fix belongs in the layer.
 *
 * ── WHAT THIS SUITE EXISTS TO PROVE ─────────────────────────────────────────
 *
 *   Narrowing a read is only worth having if a narrowed read and a wide read
 *   return the SAME VALUES. That is one property and it is the whole risk of
 *   this change: 75 call sites are about to start receiving different rows from
 *   the database, and if any field comes back subtly altered, the damage is
 *   silent and spread across broadcasts, reports and reconcilers.
 *
 *   So every assertion below compares the narrowed read against the wide read of
 *   the same row, against a real PostgreSQL through a real PostgREST — not
 *   against an expectation I wrote down.
 *
 *   THE OPERATOR IS WHERE THIS WOULD HAVE GONE WRONG. The aggregate planner uses
 *   `->>` and is right to; it wants numbers. Measured against the PostgREST this
 *   repo runs, `->>` returns a nested object as a JSON STRING:
 *
 *       select=k:raw_data->>kyc   ->  {"k":"{\"bvn\": \"123\", \"tier\": 2}"}
 *       select=k:raw_data->kyc    ->  {"k":{"bvn": "123", "tier": 2}}
 *
 *   sms-broadcast selects `kyc`, `profile`, `personalInfo` and `companyInfo` —
 *   every one an object — so copying the aggregate planner's operator would have
 *   turned each into a string and broken every audience filter that reads into
 *   them, quietly. The nested-object and array cases below are here because of
 *   that, not for completeness.
 *
 *     bash scripts/local-stack/up.sh
 *     LOCAL_PG_URL="postgresql://postgres@127.0.0.1:54322/postgres" \
 *       npx jest --config jest.config.pg.js --runInBand
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { supabaseDb as db, readProjection } from '@/lib/supabase-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { restDescribe, assertRestReachable } from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('select 1');
    client = c;
});

afterAll(async () => { await client?.end().catch(() => {}); });

const PREFIX = 'sel696-';

async function q(sql: string, params: unknown[] = []) {
    return (await client!.query(sql, params)).rows;
}

/**
 * Scoped to rows this suite wrote. document_collections is SHARED by every
 * untyped collection, so an unscoped assertion is a question about whatever else
 * happens to be in the database — #455's note, learned the hard way there.
 */
async function wipe() {
    for (const t of ['users', 'document_collections']) {
        await q(`delete from ${t} where id like $1`, [`${PREFIX}%`]);
    }
}

beforeEach(async () => { if (REQUESTED) await wipe(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#696 — the plan, before anything is fetched with it', () => {
    it('WITHOUT .select() THE PROJECTION IS UNCHANGED', () => {
        //   THE control on the whole change: a caller that does not narrow must
        //   issue exactly the select it issued before this finding, or every
        //   read on the platform is in scope rather than 75 of them.
        expect(readProjection({
            tableName: 'users', isDedicated: true, isCollectionGroup: false, fields: null,
        })).toEqual({ projection: '*', fields: null, columnAlias: {} });

        expect(readProjection({
            tableName: 'document_collections', isDedicated: false, isCollectionGroup: false, fields: [],
        }).projection).toBe('id, raw_data');

        expect(readProjection({
            tableName: 'document_collections', isDedicated: false, isCollectionGroup: true, fields: null,
        }).projection).toBe('id, raw_data, collection_name');
    });

    it('AND A FIELD IT CANNOT NAME SAFELY TAKES THE WHOLE PLAN BACK TO THE DOCUMENT', () => {
        //   A select is one string and half a narrowing is not a narrowing —
        //   aggregateProjection's rule, for the same reason.
        const plan = readProjection({
            tableName: 'document_collections', isDedicated: false, isCollectionGroup: false,
            fields: ['phone', 'address.line1'],
        });
        expect(plan.fields).toBeNull();
        expect(plan.projection).toBe('id, raw_data');
    });

    it('AND IT USES -> RATHER THAN ->>, WHICH IS THE DIFFERENCE BETWEEN AN OBJECT AND A STRING', () => {
        const plan = readProjection({
            tableName: 'document_collections', isDedicated: false, isCollectionGroup: false,
            fields: ['kyc'],
        });
        expect(plan.projection).toContain('kyc:raw_data->kyc');
        expect(plan.projection).not.toContain('->>');
    });

    it('AND ON A DEDICATED TABLE IT ASKS FOR BOTH PLACES THE FIELD CAN LIVE', () => {
        //   _mapRow prefers raw_data and falls back to the column. Projecting
        //   only the column would return a different value than a wide read for
        //   any row carrying both.
        const plan = readProjection({
            tableName: 'users', isDedicated: true, isCollectionGroup: false,
            fields: ['roles', 'fullName'],
        });
        expect(plan.projection).toContain('roles:raw_data->roles');
        expect(plan.projection).toContain(`${plan.columnAlias.roles}:roles`);
        //   fullName has no column, so it is asked for once.
        expect(plan.columnAlias.fullName).toBeUndefined();
        expect(plan.projection).toContain('fullName:raw_data->fullName');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
restDescribe('#696 — a narrowed read and a wide read agree, against real Postgres', () => {
    beforeAll(assertRestReachable);

    const COLL = COLLECTIONS.ESCROW_TRANSACTIONS; // untyped → document_collections

    const DOC = {
        name: 'Ada',
        rank: 3,
        kyc: { bvn: '12345678901', tier: 2, verified: true },
        tags: ['alpha', 'beta'],
        nested: { deep: { value: 'kept' } },
        unwanted: 'this must not travel',
    };

    async function seed(id: string, data: Record<string, unknown>) {
        await q(
            `insert into document_collections (id, collection_name, raw_data) values ($1,$2,$3::jsonb)`,
            [id, COLL, JSON.stringify({ id, ...data })],
        );
    }

    it('EVERY SELECTED FIELD COMES BACK IDENTICAL TO THE WIDE READ', async () => {
        /*
         *   THE property this change lives or dies on. Not "the narrowed read
         *   looks right" — the two reads are compared to each other, so an
         *   expectation I got wrong cannot make this pass.
         */
        await seed(`${PREFIX}a`, DOC);

        const wide = (await db.collection(COLL).where('name', '==', 'Ada').get()).docs[0].data();
        const narrow = (await db.collection(COLL)
            .where('name', '==', 'Ada')
            .select('name', 'rank', 'kyc', 'tags', 'nested')
            .get()).docs[0].data();

        for (const field of ['name', 'rank', 'kyc', 'tags', 'nested']) {
            expect({ field, value: narrow[field] }).toEqual({ field, value: wide[field] });
        }
    });

    it('A NESTED OBJECT STAYS AN OBJECT, AND AN ARRAY STAYS AN ARRAY', async () => {
        //   The ->> trap, asserted on the types rather than on equality alone:
        //   a JSON string would be `"{\"bvn\":...}"` and compare unequal, but
        //   naming the type says WHY when it fails.
        await seed(`${PREFIX}b`, DOC);

        const d = (await db.collection(COLL)
            .where('name', '==', 'Ada')
            .select('kyc', 'tags', 'rank')
            .get()).docs[0].data();

        expect(typeof d.kyc).toBe('object');
        expect(d.kyc.bvn).toBe('12345678901');
        expect(d.kyc.tier).toBe(2);
        expect(Array.isArray(d.tags)).toBe(true);
        expect(d.tags).toEqual(['alpha', 'beta']);
        expect(typeof d.rank).toBe('number');
    });

    it('AND THE FIELDS NOBODY ASKED FOR DO NOT TRAVEL', async () => {
        //   The point of the whole finding. Without this the suite above is
        //   satisfied by the inert `.select()` it replaces.
        await seed(`${PREFIX}c`, DOC);

        const d = (await db.collection(COLL)
            .where('name', '==', 'Ada')
            .select('name')
            .get()).docs[0].data();

        expect(d.name).toBe('Ada');
        expect(d.unwanted).toBeUndefined();
        expect(d.kyc).toBeUndefined();
    });

    it('AND THE DOCUMENT ID AND REF SURVIVE THE NARROWING', async () => {
        //   Callers key maps on doc.id and write through doc.ref. A projection
        //   that dropped either would break them in a way doc.data() cannot show.
        await seed(`${PREFIX}d`, DOC);

        const snap = (await db.collection(COLL).where('name', '==', 'Ada').select('name').get()).docs[0];

        expect(snap.id).toBe(`${PREFIX}d`);
        expect(snap.ref.id).toBe(`${PREFIX}d`);
        expect(snap.data().id).toBe(`${PREFIX}d`);
    });

    it('AND ORDERING AND FILTERING STILL WORK ON FIELDS THAT WERE NOT SELECTED', async () => {
        /*
         *   A narrowing that forced every ordered or filtered field into the
         *   projection would narrow almost nothing. Verified against PostgREST
         *   before this was built, and pinned here so it stays true.
         */
        await seed(`${PREFIX}e1`, { ...DOC, name: 'Ada', rank: 3 });
        await seed(`${PREFIX}e2`, { ...DOC, name: 'Bem', rank: 1 });
        await seed(`${PREFIX}e3`, { ...DOC, name: 'Chi', rank: 2 });

        const ordered = await db.collection(COLL)
            .where('unwanted', '==', 'this must not travel')
            .orderBy('rank', 'asc')
            .select('name')
            .get();

        expect(ordered.docs.map((d: any) => d.data().name)).toEqual(['Bem', 'Chi', 'Ada']);
        expect(ordered.docs[0].data().rank).toBeUndefined();
    });

    it('AND A KEY THE DOCUMENT DOES NOT HAVE IS STILL ABSENT, NOT INVENTED', async () => {
        await seed(`${PREFIX}f`, { name: 'Ada' });

        const wide = (await db.collection(COLL).where('name', '==', 'Ada').get()).docs[0].data();
        const narrow = (await db.collection(COLL)
            .where('name', '==', 'Ada').select('name', 'missingEntirely').get()).docs[0].data();

        expect(wide.missingEntirely).toBeUndefined();
        //   OMITTED, not null. A wide read omits a key the document does not
        //   carry, and a narrowed one has to agree or `=== undefined` and
        //   `in` stop meaning what they meant.
        expect(narrow.missingEntirely).toBeUndefined();
        expect('missingEntirely' in narrow).toBe(false);
    });

    //   The IN-MEMORY FAKE narrows by the same rule, and is asserted in
    //   src/__tests__/unit/select-narrows-in-the-fake-too.test.ts. It cannot be
    //   checked here: this file uses the REAL adapter, and the fake replaces
    //   that module wholesale — fake-db-matches-postgres.test.ts has to
    //   jest.mock it for its own registry for exactly this reason.

});

// ─────────────────────────────────────────────────────────────────────────────
restDescribe('#696 — and on a dedicated table, the column precedence is preserved', () => {
    beforeAll(assertRestReachable);

    it('THE DOCUMENT WINS OVER THE COLUMN, NARROWED EXACTLY AS WIDE', async () => {
        /*
         *   _mapRow takes raw_data first and the native column only when the
         *   document has no value. A row carrying BOTH — with DIFFERENT values,
         *   deliberately, because seeding them equal could not tell the two
         *   apart — is the case a naive projection would get wrong.
         */
        const id = `${PREFIX}u1`;
        await q(
            `insert into users (id, email, roles, raw_data) values ($1, 'column@x.test', array['user'], $2::jsonb)`,
            [id, JSON.stringify({ id, email: 'document@x.test', roles: ['admin'], fullName: 'Ada' })],
        );

        const wide = (await db.collection(COLLECTIONS.USERS).where('fullName', '==', 'Ada').get()).docs[0].data();
        const narrow = (await db.collection(COLLECTIONS.USERS)
            .where('fullName', '==', 'Ada').select('email', 'roles', 'fullName').get()).docs[0].data();

        expect(wide.email).toBe('document@x.test');
        expect(narrow.email).toBe(wide.email);
        expect(narrow.roles).toEqual(wide.roles);
        expect(narrow.fullName).toBe('Ada');
    });

    it('AND THE COLUMN IS USED WHEN THE DOCUMENT HAS NO VALUE', async () => {
        const id = `${PREFIX}u2`;
        await q(
            `insert into users (id, email, roles, raw_data) values ($1, 'column@y.test', array['user'], $2::jsonb)`,
            [id, JSON.stringify({ id, fullName: 'Bem' })],
        );

        const wide = (await db.collection(COLLECTIONS.USERS).where('fullName', '==', 'Bem').get()).docs[0].data();
        const narrow = (await db.collection(COLLECTIONS.USERS)
            .where('fullName', '==', 'Bem').select('email', 'roles', 'fullName').get()).docs[0].data();

        expect(wide.email).toBe('column@y.test');
        expect(narrow.email).toBe(wide.email);
        expect(narrow.roles).toEqual(wide.roles);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     the projection never narrows                                    KILLED
 *     `->` becomes `->>`, flattening objects to strings               KILLED
 *     the native column is never projected                            KILLED
 *     the column wins over the document                               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the header                                            SURVIVED ✓
 *
 *   THE OPERATOR MUTANT FIRST REPORTED SURVIVED, AND THE CODE WAS FINE.
 *
 *   That is the mutant this whole suite exists for, so a survivor was not
 *   something to write down and move past. It had not applied: the line sits at
 *   eight spaces of indentation and the pattern demanded twelve. The harness
 *   guards against exactly that by requiring each mutant to prove its edit
 *   landed — and the guard passed anyway, because the proof string chosen was
 *   `raw_data->>${field}`, which ALREADY EXISTS in that file on
 *   aggregateProjection's line. A proof that matches something else is not a
 *   proof.
 *
 *   Re-run with the right indentation and a proof unique to the mutated line
 *   (`${field}:raw_data->>${field}`), it is KILLED by five tests at once.
 *
 *   The lesson is the file's own: a surviving mutant on the property a suite was
 *   built around is a claim about the INSTRUMENT before it is a claim about the
 *   code.
 */
