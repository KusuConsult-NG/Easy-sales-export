/**
 * @jest-environment node
 */

/**
 *   #761 THE SEGMENT COUNTS INCLUDED ERASED AND SUPERSEDED ACCOUNTS, AND PUT
 *        THEM IN THE GHOST BUCKET — AND #756 FIXED THE WRONG COPY.
 *
 *   Reported by the owner twice. First as two populations on one screen —
 *   "41,696 Unique Accounts" beside "Total Analyzed 42,566" — and then, after
 *   #756 was pushed, as the number not moving:
 *
 *       "why do i still see this? Ghost 19,981 (46.9%)"
 *
 *   THE SECOND REPORT IS THE FINDING. #756 added the tombstone exclusion to
 *   `calculateUserSegments` in analytics.service.ts, whose own docstring says
 *   what it is:
 *
 *       "The pre-#473 implementation, kept as the fallback ONLY. It runs when
 *        migration 029 has not been applied yet."
 *
 *   The live path is the SQL function `count_user_segments`. So the fix landed
 *   on the copy that does not run in production — the exact defect class this
 *   audit has spent more findings on than any other, committed inside a fix for
 *   it, by me. The JS fallback keeps its exclusion so the two agree whichever
 *   one answers; that half was right and is not undone.
 *
 * ── WHY THE GHOST BUCKET SPECIFICALLY ───────────────────────────────────────
 *
 *   An erasure SCRUBS the record — no application, no bank details, no address.
 *   That is the exact definition of `ghost` in user_segment(). So every
 *   deletion the platform honoured, and every duplicate an admin resolved,
 *   made the Ghost figure larger, and the owner has been reading deleted
 *   accounts as a problem to fix.
 *
 * ── MEASURED AGAINST REAL POSTGRES, NOT A FAKE ──────────────────────────────
 *
 *   This is SQL, so it is tested as SQL. The before/after below runs 029's
 *   definition and 037's against the same rows in one transaction:
 *
 *       BEFORE (029)  ghost 3
 *       AFTER  (037)  ghost 1
 *
 *   Most of this audit's findings are pinned against a fake database. This one
 *   could not be — the defect is in a function the fake does not have — and it
 *   is the more convincing for it.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

let client: Client | null = null;

/** Rows this suite owns. Prefixed so a crashed run cannot confuse a later one. */
const P = '__761_';
const IDS = [`${P}live_ghost`, `${P}erased`, `${P}dupe`, `${P}empty_mig`, `${P}not_deleted`];

const clearProbeRows = async () => {
    if (!client) return;
    await client.query(`DELETE FROM public.users WHERE id LIKE '${P}%'`);
};

const seedProbeRows = async () => {
    if (!client) return;
    await client.query(
        `INSERT INTO public.users (id, email, raw_data) VALUES
           ($1, 'g@e.com',  '{"email":"g@e.com"}'::jsonb),
           ($2, 'x@e.com',  '{"deleted":true}'::jsonb),
           ($3, 'd@e.com',  $6::jsonb),
           ($4, 'e@e.com',  '{"_migratedTo":""}'::jsonb),
           ($5, 'n@e.com',  '{"deleted":false}'::jsonb)`,
        [...IDS, JSON.stringify({ _migratedTo: IDS[0] })],
    );
};

beforeAll(async () => {
    if (!PG_URL) return;
    const c = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();
    await seedProbeRows();
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** Segment counts over this suite's rows only. */
async function segmentsOfProbeRows(where: string): Promise<Record<string, number>> {
    const { rows } = await client!.query(
        `SELECT
            count(*) FILTER (WHERE seg='active')::int  AS active,
            count(*) FILTER (WHERE seg='pending')::int AS pending,
            count(*) FILTER (WHERE seg='stalled')::int AS stalled,
            count(*) FILTER (WHERE seg='ghost')::int   AS ghost
         FROM (
            SELECT user_segment(raw_data) AS seg
            FROM public.users
            WHERE id LIKE '${P}%' ${where}
         ) s`,
    );
    return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#761 — a tombstone is not a ghost', () => {
    it('THE PROBE ROWS ARE REALLY THERE — the vacuity guard', async () => {
        const { rows } = await client!.query(
            `SELECT count(*)::int AS n FROM public.users WHERE id LIKE '${P}%'`,
        );
        expect(rows[0].n).toBe(5);
    });

    it('is_live_person EXCLUDES AN ERASED ACCOUNT AND A SUPERSEDED ONE', async () => {
        const { rows } = await client!.query(
            `SELECT id FROM public.users
              WHERE id LIKE '${P}%' AND is_live_person(raw_data) ORDER BY id`,
        );
        const live = rows.map((r: { id: string }) => r.id).sort();

        expect(live).toEqual([`${P}empty_mig`, `${P}live_ghost`, `${P}not_deleted`].sort());
    });

    it('AND IT KEEPS A ROW WITH NO deleted KEY AT ALL — the NULL trap', async () => {
        /*
         *   `raw_data->>'deleted' <> 'true'` is NULL, and therefore NOT TRUE,
         *   for a row with no `deleted` key — which is almost every live user.
         *   Written that way the predicate would have excluded the entire
         *   platform. This codebase has been caught by exactly that before; see
         *   lib/user-population.ts.
         */
        const { rows } = await client!.query(
            `SELECT is_live_person('{"email":"a@b.com"}'::jsonb) AS live`,
        );
        expect(rows[0].live).toBe(true);
    });

    it('AND AN EMPTY _migratedTo IS A LIVE PERSON, NOT A TOMBSTONE', async () => {
        //   #724 writes the surviving profile's id there. An empty string is
        //   not a pointer at anything.
        const { rows } = await client!.query(
            `SELECT is_live_person('{"_migratedTo":""}'::jsonb) AS live,
                    is_live_person('{"_migratedTo":"other"}'::jsonb) AS superseded`,
        );
        expect(rows[0]).toEqual({ live: true, superseded: false });
    });

    it('AND deleted:false IS LIVE, WHICH deleted IS DISTINCT FROM true GETS RIGHT', async () => {
        const { rows } = await client!.query(
            `SELECT is_live_person('{"deleted":false}'::jsonb) AS live,
                    is_live_person('{"deleted":true}'::jsonb)  AS erased`,
        );
        expect(rows[0]).toEqual({ live: true, erased: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#761 — and the ghost count drops by exactly the tombstones', () => {
    it('BEFORE THE FIX THE TOMBSTONES WERE GHOSTS', async () => {
        /*
         *   029's definition, over the same rows: no exclusion at all. This is
         *   what the owner has been reading — and it is the assertion that makes
         *   the one below a measurement rather than a claim.
         */
        const before = await segmentsOfProbeRows('');

        expect(before.ghost).toBe(5);
    });

    it('AND AFTER IT THEY ARE NOT', async () => {
        const after = await segmentsOfProbeRows('AND is_live_person(raw_data)');

        expect(after.ghost).toBe(3);
    });

    it('AND THE LIVE FUNCTION IS THE ONE THAT CHANGED', async () => {
        /*
         *   The half #756 missed. `count_user_segments` is what
         *   countUserSegmentsInDatabase calls, and what the dashboard shows —
         *   `calculateUserSegments` runs only when this function is unavailable.
         *   Asserted on the function itself, not on a copy of its body.
         */
        const { rows } = await client!.query(
            `SELECT pg_get_functiondef(oid) AS def
               FROM pg_proc WHERE proname = 'count_user_segments'`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].def).toContain('is_live_person(raw_data)');
    });

    it('and every segment is still returned, including the empty ones', async () => {
        //   029's property, kept: a caller never has to tell "no such segment"
        //   from "none this time".
        const { rows } = await client!.query('SELECT * FROM count_user_segments()');

        expect(Object.keys(rows[0]).sort()).toEqual(['active', 'ghost', 'pending', 'stalled']);
    });
});
