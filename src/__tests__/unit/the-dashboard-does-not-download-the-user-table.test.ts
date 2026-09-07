/**
 * @jest-environment node
 */

/**
 *   #473 THE ADMIN DASHBOARD DOWNLOADED THE ENTIRE USERS TABLE TO COUNT FOUR
 *   NUMBERS.
 *
 *   Found by MEASURING THE PAGE, after the owner said the dashboards were still
 *   slow and that I had claimed a fix that did not deliver. A real browser
 *   logged in as admin, against real PostgREST and real PostgreSQL with 50,009
 *   users, with every database round trip recorded by method and payload size:
 *
 *       /admin cold load        BEFORE            AFTER
 *         round trips              97               37
 *         calls returning rows     68               17
 *         database time         8,701 ms          213 ms
 *         data transferred      4,597 kB            1 kB
 *         whole-table pages        51                0
 *
 *   calculateUserSegments() computed Math.ceil(count / 1000) and fired that many
 *   requests through Promise.all — 51 simultaneous whole-table reads at 92 kB a
 *   page — to classify every user in JavaScript and report four integers. It
 *   also saturated the connection pool doing it, so everything else on the page
 *   queued behind one widget.
 *
 *   THREE THINGS THIS FINDING TAUGHT, ALL OF THEM BY BEING WRONG FIRST:
 *
 *     1. FEWER ROUND TRIPS IS NOT A FASTER PAGE. The first SQL version cut the
 *        page from 4.6 MB to 1 kB and made the wall clock WORSE — 2.3 s to
 *        6.0 s — because a 2.6 second database function had replaced the
 *        transfer. Only loading the page showed that.
 *
 *     2. A NEW FUNCTION IS NOT CALLABLE UNTIL PostgREST RELOADS ITS SCHEMA.
 *        The migration applied cleanly, the code was correct, and the page still
 *        made all 51 requests: the RPC was failing with "could not find the
 *        function ... in the schema cache" and the fallback was quietly carrying
 *        it. A fix that silently degrades to the thing it replaced looks exactly
 *        like a fix that works.
 *
 *     3. THE OBVIOUS SQL WAS 80x SLOWER. jsonb_each is the natural translation
 *        of Object.values(regs).some(...), and a SQL function containing a FROM
 *        clause cannot be inlined, so Postgres called it once per row. The
 *        jsonb_path_exists form is a scalar expression and inlines: 2,811 ms to
 *        35 ms over the same 50,009 rows.
 *
 *   THE FALLBACK IS DELIBERATE AND MUST NOT BE REMOVED. The owner applies
 *   migrations separately from deploying code, and #469 is what happens when
 *   that order is assumed away. Without the fallback, a deploy landing before
 *   the migration would blank the dashboard; with it, that window is merely
 *   slow, and the log names the file that fixes it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the RPC call removed, always paging      KILLED
 *     the fallback removed                     KILLED
 *     the RPC error swallowed silently         KILLED
 *     the schema-reload dropped from 029       KILLED
 *     029 left out of the deploy file          KILLED
 *     reword this header                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const SERVICE = 'src/services/analytics.service.ts';
const MIGRATION = 'supabase/migrations/029_user_segment_counts.sql';
const BUILDER = 'scripts/build-deploy-sql.mjs';

const service = () => stripComments(readFileSync(SERVICE, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#473 — the four counters come from the database', () => {
    it('THE SEGMENTS ARE COUNTED BY AN RPC, NOT BY PAGING THE TABLE', () => {
        // The assertion the finding is about.
        expect(service()).toContain('supabaseAdmin.rpc("count_user_segments")');
    });

    it('AND THE RPC IS ASKED BEFORE THE PAGING LOOP', () => {
        //   Order matters: reversed, the fallback runs every time and the RPC
        //   becomes decoration.
        //
        //   THIS ALSO PINNED THE EXACT EXPRESSION —
        //   `(await A) ?? (await B)` — and #482 restructured that line to make
        //   the counters live, so the suite failed on the SHAPE of correct code.
        //   Ninth time in this audit. What it meant is the ORDER, so that is
        //   what it asserts.
        const code = service();
        const rpc = code.indexOf('countUserSegmentsInDatabase()');
        const paging = code.indexOf('this.calculateUserSegments()', rpc);

        expect(rpc).toBeGreaterThan(-1);
        expect(paging).toBeGreaterThan(rpc);
    });

    it('THE FALLBACK STILL EXISTS — a deploy can land before its migration', () => {
        //   #469: the owner applies migrations by hand, separately. Removing
        //   this makes that window a blank dashboard instead of a slow one.
        const code = service();

        expect(code).toContain('private async calculateUserSegments()');
        expect(code).toMatch(/Math\.ceil\(count \/ pageSize\)/);
    });

    it('AND THE FALLBACK IS LOUD — a silent degrade looks exactly like a fix', () => {
        //   This is not a style preference. The measured failure was the RPC
        //   erroring on PostgREST's stale schema cache while the page still made
        //   all 51 requests and looked, from outside, entirely fixed.
        const code = service();

        expect(code).toContain('console.error');
        expect(code).toContain('029_user_segment_counts.sql');
    });

    it('and the RPC result is read as a one-row set', () => {
        // A TABLE-returning function comes back as an array of one row, and
        // reading it as an object yields four undefineds — which Number() turns
        // into NaN and `|| 0` turns into a confident zero on the dashboard.
        expect(service()).toContain('Array.isArray(data) ? data[0] : data');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#473 — the migration is applicable and self-announcing', () => {
    const sql = () => readFileSync(MIGRATION, 'utf-8');

    it('IT TELLS PostgREST TO RELOAD ITS SCHEMA', () => {
        //   Measured, not assumed: without this the RPC fails with "could not
        //   find the function ... in the schema cache", the fallback carries it,
        //   and the page is unchanged while every other sign says fixed.
        expect(sql()).toContain("NOTIFY pgrst, 'reload schema'");
    });

    it('AND IT IS TRANSACTION-SAFE — #469', () => {
        // The Supabase SQL Editor always opens a transaction. A migration that
        // cannot run in one is a migration that never gets applied here.
        const statements = sql().replace(/^\s*--.*$/gm, ' ');

        expect(statements).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        expect(statements).toContain('CREATE OR REPLACE FUNCTION count_user_segments()');
    });

    it('AND IT IS IN THE CONSOLIDATED DEPLOY, WITH THE CODE THAT CALLS IT', () => {
        // Excluding it would mean every fresh deployment silently runs the
        // fallback — which is the defect, shipped as the default.
        expect(readFileSync(BUILDER, 'utf-8')).toContain('n: "029"');
    });

    it('and it uses the inlinable form, not the one that was 80x slower', () => {
        //   jsonb_each is the obvious translation and cannot be inlined, so
        //   Postgres calls the function once per row: 2,811 ms against 35 ms
        //   over 50,009 users. Recorded so nobody "simplifies" it back.
        const body = sql();

        expect(body).toContain('jsonb_path_exists');
        expect(body).toContain('2,811 ms');
        expect(body).toContain('35 ms');
    });
});
