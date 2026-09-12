/**
 * @jest-environment node
 */

/**
 *   #666 THE STATUS QUERY REPORTED A COMPLETE PRODUCTION DATABASE AS MISSING TEN
 *   MONEY FUNCTIONS.
 *
 *   #664 committed `supabase/status.sql` so the owner could ask a database what
 *   it has, and I validated it against two controls before handing it over. It
 *   was run against production and came back:
 *
 *       money functions present (expect 45)   |   35
 *
 *   Ten missing, on the money layer. The honest reading of that number is an
 *   emergency.
 *
 *   IT WAS THE QUERY. `SELECT count(*) FROM pg_proc … WHERE nspname='public'`
 *   counts EXTENSION functions too, and the expectation of 45 was taken from
 *   the machine the query was written on. The local stack installs `uuid-ossp`
 *   into `public`; Supabase keeps extensions in the `extensions` schema. That
 *   extension contributes exactly ten functions:
 *
 *       uuid_generate_v1  uuid_generate_v1mc  uuid_generate_v3
 *       uuid_generate_v4  uuid_generate_v5    uuid_nil
 *       uuid_ns_dns       uuid_ns_oid         uuid_ns_url  uuid_ns_x500
 *
 *   45 − 10 = 35. Production had every one of its 35 application functions and
 *   was entirely up to date.
 *
 * ── WHY BOTH CONTROLS PASSED ANYWAY ─────────────────────────────────────────
 *
 *   This is the part worth keeping. #664's positive and negative controls were
 *   real and they both ran — against two databases ON THE SAME MACHINE. A
 *   control only rules out what it varies, and both of mine varied the
 *   MIGRATIONS while holding the HOST fixed. The one difference that mattered
 *   was the one neither control touched.
 *
 *   "Audit the instrument before believing the measurement" is this audit's
 *   first rule and it had already cost several diagnoses. Here it nearly cost
 *   the owner an emergency: a fully patched production database reported as
 *   missing ten functions from the wallet and escrow layer.
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────
 *
 *   Extension-owned functions are excluded through `pg_depend` (deptype 'e'),
 *   so the count is the application's own wherever the extensions live. And the
 *   query NAMES what is absent rather than counting: "35 of 45" says something
 *   is wrong and not what, which is the same defect as a warning nobody can act
 *   on (#658) and a flag no screen renders (#665).
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The query, WITH ITS COMMENTS STRIPPED.
 *
 *   A FOURTH FILE FORMAT. #651 was caught by prose in YAML, #654 by a test file
 *   matching its own sweep, #655 by a JS comment quoting the sentence it said
 *   was gone — and the first version of this file asserted
 *   `not.toContain('expect 45')` against raw SQL, where the comment explaining
 *   what 45 was contains the phrase twice.
 *
 *   The rule is the rule: a source assertion strips comments, every time, in
 *   every format.
 */
const RAW = read('supabase/status.sql');
const STATUS = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

/**
 * The function names the query expects a complete database to have.
 *
 * Matched anywhere in the VALUES list rather than anchored to whole lines: the
 * first name shares a line with `(VALUES (` and the last with the closing
 * bracket, so a line-anchored pattern silently found 32 of 35 — and every
 * assertion below would have been about a list three names short.
 */
const EXPECTED = [...STATUS.matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);

/** Every function the schema and the migrations actually create. */
const DECLARED = (() => {
    const names = new Set<string>();
    const files = [
        'supabase/schema.sql',
        ...readdirSync(join(ROOT, 'supabase/migrations'))
            .filter((f) => f.endsWith('.sql'))
            .map((f) => `supabase/migrations/${f}`),
    ];
    for (const f of files) {
        for (const m of read(f).matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
            names.add(m[1].toLowerCase());
        }
    }
    return names;
})();

// ─────────────────────────────────────────────────────────────────────────────
describe('#666 — the count is of the application, not of the host', () => {
    it('EXTENSION-OWNED FUNCTIONS ARE EXCLUDED', () => {
        /*
         *   THE defect. Without this, the answer depends on which schema the
         *   host installs uuid-ossp into — and the two hosts in play disagree,
         *   by exactly the ten functions that made a complete database look
         *   broken.
         */
        expect(STATUS).toContain("LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'");
        expect(STATUS).toContain('d.objid IS NULL');
    });

    it('AND THE EXPECTATION IS NO LONGER 45', () => {
        //   The number from the machine it was written on.
        expect(STATUS).not.toContain('expect 45');
        expect(STATUS).toContain(`expect ${EXPECTED.length}`);
    });

    it('AND IT NAMES WHAT IS ABSENT RATHER THAN COUNTING IT', () => {
        /*
         *   A count cannot be acted on. "35 of 45" is exactly as useful as the
         *   unmappable collection warning #658 removed and the unrendered
         *   partial-revenue flag #665 wired up: it says something is wrong and
         *   not what to do.
         */
        expect(STATUS).toContain('MISSING FUNCTION');
        //   34 DISTINCT names, not 35 rows: credit_wallet_once and
        //   debit_jsonb_balance are overloaded, so pg_proc has two entries for
        //   each of two names. The count row asks for count(DISTINCT proname)
        //   so the two measures agree.
        expect(EXPECTED.length).toBeGreaterThanOrEqual(34);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#666 — and the list cannot drift from the migrations', () => {
    it('EVERY NAME IT EXPECTS IS ACTUALLY CREATED BY THE SCHEMA OR A MIGRATION', () => {
        /*
         *   The list was generated from a database rather than from the source,
         *   so it is a second statement of what the migrations create — this
         *   audit's fourth-most-common defect. This is what keeps the two
         *   agreeing: a name in the query that nothing creates would report a
         *   missing function on every database for ever.
         */
        const unbacked = EXPECTED.filter((n) => !DECLARED.has(n));

        expect({ unbacked }).toEqual({ unbacked: [] });
    });

    it('AND THE MONEY FUNCTIONS ARE AMONG THEM, BY NAME', () => {
        /*
         *   A positive control on the list itself. "Every expected name is
         *   created somewhere" is also satisfied by an empty list, which would
         *   report a healthy database whatever was missing.
         *
         *   These six are the ones an incomplete database would hurt most: the
         *   compare-and-swap every status transition runs through, the two
         *   wallet movements, the idempotency claim, the bounded increment and
         *   #652's overselling fix.
         */
        expect(EXPECTED).toEqual(expect.arrayContaining([
            'claim_status_transition',
            'debit_wallet_locked',
            'credit_wallet_once',
            'claim_idempotency_key',
            'increment_within_ceiling',
            'decrement_many_or_fail',
        ]));
    });

    it('AND NO uuid_ FUNCTION IS ON IT', () => {
        //   The ten that caused this. They belong to an extension and their
        //   schema is the host's business, not the application's.
        expect(EXPECTED.filter((n) => n.startsWith('uuid_'))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#666 — and it is still safe to paste at a production database', () => {
    it('IT WRITES NOTHING', () => {
        //   #664's claim, re-asserted because this change added a VALUES list
        //   and a join, which is the kind of edit that quietly turns a read into
        //   something else.
        //   THE CLAIM against the RAW file and the CODE against the stripped
        //   one — the mirror of the trap above. "READ-ONLY" is documentation
        //   and lives in a comment, so asserting it against stripped source
        //   fails on a file that says it perfectly well.
        expect(RAW).toContain('READ-ONLY');
        expect(STATUS).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT)\b/i);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the pg_depend exclusion is removed                  KILLED
 *     the expectation goes back to 45                                 KILLED
 *     the missing-function listing is dropped                         KILLED
 *     a uuid_ function is added back to the expected list             KILLED
 *     a money function is removed from the expected list              KILLED
 *     the expected list gains a name nothing creates                  KILLED
 *     a write statement is added to the query                         KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   Both controls, again, and this time varying the thing that mattered. On a
 *   complete database: 35 application functions and no MISSING rows. On one
 *   built without 033, 034 and 035: 33, and the two absent functions named —
 *   find_users_by_supabase_auth_ids and jsonb_present.
 *
 *   The ten-function gap was confirmed rather than guessed, by grouping
 *   pg_proc on pg_depend: 35 application functions and 10 from uuid-ossp.
 */
