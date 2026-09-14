/**
 * @jest-environment node
 */

/**
 *   #739 TWO MORE OFFSET-PAGED SWEEPS WITH NO TOTAL ORDER, AND ONE OF THEM HAD
 *        NO ORDER AT ALL.
 *
 *   supabase-db states the rule where it maps the key, and states the
 *   consequence too: offset paging needs "the one ordering that is guaranteed
 *   total", because otherwise "rows are then re-read and skipped between
 *   pages".
 *
 *   #671 found exactly that in the duplicate-profile forensic — a row read
 *   twice became a duplicate profile, and a row skipped left a real duplicate
 *   unreported — and fixed that one caller. Two others were left:
 *
 *     services/userMetrics.service.ts   `.limit(1000).offset(n)` with NO
 *                                       orderBy, and none of its four callers
 *                                       supplies one. Postgres makes no
 *                                       ordering guarantee without ORDER BY.
 *
 *     actions/data-recovery.ts          `.orderBy("createdAt")`, which is not
 *                                       unique: bulk imports and migrations
 *                                       write whole batches on one timestamp,
 *                                       and rows lacking the field sort
 *                                       arbitrarily.
 *
 * ── WHY THESE TWO IN PARTICULAR ─────────────────────────────────────────────
 *
 *   userMetrics carries its own instruction in its header: "ALL DASHBOARDS MUST
 *   CONSUME THIS SERVICE FOR USER METRICS." A double-read inflates a number the
 *   owner reads as fact; a skip deflates it.
 *
 *   data-recovery is the tool that repairs rows. There the SKIP is the half
 *   that matters: it would pass over records without saying so and report a
 *   clean run — a repair that quietly does not repair.
 *
 * ── AND WHY IT HAS BEEN INVISIBLE ───────────────────────────────────────────
 *
 *   It bites only above one page. A collection under the page size returns
 *   everything on the first call and the offset is never used, so both have
 *   behaved perfectly on every small dataset they have ever run against.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run before
 *   the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const METRICS = 'src/services/userMetrics.service.ts';
const RECOVERY = 'src/app/actions/data-recovery.ts';

/**
 * The statement containing each `.offset(` call.
 *
 *   SCOPED TO ONE STATEMENT, NOT THE FILE. My first version matched a file
 *   containing `.offset(` anywhere against a file containing an `orderBy` on a
 *   timestamp anywhere, and flagged data-recovery immediately: it pages one
 *   query by the document id and, in a DIFFERENT function, reads "the latest
 *   application" with `.orderBy("createdAt","desc").limit(1)`. That second one
 *   is correct — for a single newest row a tie is still the newest — and a
 *   file-level match called it an offender. The same file-level-for-use-level
 *   trap this audit keeps filing.
 *
 *   AND THE SECOND VERSION ONLY SAW MULTI-LINE CHAINS, because it started a
 *   chain at a line beginning with `.`. A query written on one line produced no
 *   chain at all and was invisible — a blind spot of exactly the shape this
 *   finding is about, caught by its own positive control.
 *
 *   So: walk back from each `.offset(` to the statement boundary and forward to
 *   the next one. Layout does not matter.
 */
function offsetStatements(src: string): string[] {
    const out: string[] = [];
    let at = src.indexOf('.offset(');
    while (at !== -1) {
        const startSemi = src.lastIndexOf(';', at);
        const startBrace = src.lastIndexOf('{', at);
        const start = Math.max(startSemi, startBrace) + 1;
        const endSemi = src.indexOf(';', at);
        const end = endSemi === -1 ? src.length : endSemi;
        out.push(src.slice(start, end).replace(/\s+/g, ' ').trim());
        at = src.indexOf('.offset(', at + 8);
    }
    return out;
}

const NON_UNIQUE_ORDER = /\.orderBy\(\s*["'](createdAt|created_at|updatedAt|timestamp)["']/;


// ─────────────────────────────────────────────────────────────────────────────
describe('#739 — every offset-paged sweep orders by something unique', () => {
    it('THE METRICS SERVICE ORDERS AT ALL — it did not', () => {
        const src = code(METRICS);

        expect(src).toContain('.orderBy("__name__", "asc")');
        //   And the paged read uses the ordered query, not the raw one. Adding
        //   an order and then paging the original is the shape of a fix that
        //   runs and changes nothing.
        expect(src).toContain('const ordered = query.orderBy("__name__", "asc")');
        expect(src).toContain('await ordered.limit(1000).offset(offset).get()');
        expect(src).not.toContain('await query.limit(1000).offset(offset).get()');
    });

    it('AND THE RECOVERY SWEEP ORDERS BY THE ID, NOT THE TIMESTAMP', () => {
        const src = code(RECOVERY);

        expect(src).toContain('.orderBy("__name__", "asc")');
        expect(src).not.toContain('.orderBy("createdAt", "asc")');
    });

    it('AND NO OFFSET-PAGED QUERY ANYWHERE SORTS BY A NON-UNIQUE KEY', () => {
        /*
         *   Swept rather than listed — a fourth pager added later is the next
         *   instance of this finding, and a list cannot notice it.
         *
         *   `createdAt` is the specific key #671 and this finding both tripped
         *   over: a real column, so the query succeeds, and not unique, so the
         *   paging is unstable.
         */
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name === '__tests__' || e.name === 'node_modules') continue;
                    walk(full);
                    continue;
                }
                if (/\.tsx?$/.test(e.name)) files.push(relative(ROOT, full).split(sep).join('/'));
            }
        };
        walk(join(ROOT, 'src'));

        const offenders = files
            //   The adapter defines offset; it is not a caller of it.
            .filter((f) => f !== 'src/lib/supabase-db.ts')
            .flatMap((f) => offsetStatements(code(f)).map((stmt) => ({ f, stmt })))
            .filter(({ stmt }) => NON_UNIQUE_ORDER.test(stmt))
            .map(({ f }) => f);

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP CAN SEE ONE, SO [] MEANS CLEAN', () => {
        /*
         *   Two parts, because the sweep has two ways to go quiet: the regex
         *   could stop matching, or the STATEMENT EXTRACTION could stop
         *   producing statements — which would empty the offender list just as
         *   thoroughly while every regex still worked. The second is the one a
         *   reader would not think to check, so it runs against the real file
         *   this finding repaired.
         */
        const paged = offsetStatements(code(RECOVERY));
        expect(paged.length).toBe(1);
        expect(paged[0]).toContain('.orderBy("__name__", "asc")');

        //   And an offender is recognised, on one line and across several.
        const oneLine = 'const p = q.orderBy("createdAt", "asc").limit(10).offset(20).get();';
        const multi = 'const p = q\n  .orderBy("createdAt", "asc")\n  .limit(10)\n  .offset(20)\n  .get();';
        for (const sample of [oneLine, multi]) {
            const found = offsetStatements(sample);
            expect(found.length).toBe(1);
            expect(NON_UNIQUE_ORDER.test(found[0])).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#739 — and the key it orders by means the document id', () => {
    it('THE ADAPTER MAPS __name__ TO THE ID COLUMN WHEN ORDERING', () => {
        /*
         *   The whole repair rests on this. Before #671 the name fell through
         *   to the JSONB fallback and became `raw_data->>"__name__"` — NULL on
         *   every row — so Postgres sorted by nothing and the query SUCCEEDED,
         *   which the adapter calls "the worst possible outcome".
         *
         *   Asserted here because both fixes above would be silently useless if
         *   that mapping went away.
         */
        const src = code('src/lib/supabase-db.ts');
        const at = src.indexOf("ob.field === '__name__'");

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain("colName = 'id'");
    });

    it('AND createdAt IS A REAL COLUMN, WHICH IS WHY THE OLD ORDER LOOKED FINE', () => {
        //   It sorted by something real and non-unique — the query worked, the
        //   paging did not. A key that errored would have been noticed.
        const src = code('src/lib/supabase-db.ts');
        expect(src).toContain("ob.field === 'createdAt'");
        expect(src).toContain("colName = 'created_at'");
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run before
 *   this table was written.
 *
 *     MUTANT                                                        RESULT
 *     the metrics service drops its order again                      KILLED
 *     it orders but pages the unordered query                        KILLED
 *     it orders by createdAt instead of the id                       KILLED
 *     the recovery sweep goes back to createdAt                      KILLED
 *     the sweep stops matching createdAt                             KILLED
 *     the sweep stops looking for .offset(                           KILLED
 *     the adapter stops mapping __name__ to the id column            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
