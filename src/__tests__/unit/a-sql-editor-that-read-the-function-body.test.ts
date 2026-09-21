/**
 * @jest-environment node
 */

/**
 *   #808 THE SUPABASE SQL EDITOR READS A FUNCTION BODY AS TOP-LEVEL SQL, AND
 *        `SELECT … INTO v_x FROM …` IS `CREATE TABLE AS` OUT THERE.
 *
 *        Migration 046 failed twice in the editor. The second failure named its
 *        own cause, because the editor had APPENDED this to the statement:
 *
 *            -- Added by Supabase: enable Row Level Security on newly created tables
 *            ALTER TABLE v_pointer      ENABLE ROW LEVEL SECURITY;
 *            ALTER TABLE v_target_row   ENABLE ROW LEVEL SECURITY;
 *            ALTER TABLE v_from_balance ENABLE ROW LEVEL SECURITY;
 *            ALTER TABLE v_to_balance   ENABLE ROW LEVEL SECURITY;
 *
 *        Those four are not tables. They are the four DECLARE variables the
 *        function read into — and the names match the four `SELECT … INTO`
 *        statements in its body exactly, in order. The editor believed four
 *        tables had been created, truncated the statement it was assembling in
 *        order to append its RLS block, and the body was cut mid-function:
 *
 *            ERROR: 42601: unterminated dollar-quoted string at or near "$fn$"
 *
 *        THE DOLLAR TAGS WERE NEVER THE CAUSE. `$$` had already been changed to
 *        `$fn$`/`$chk$` on that suspicion and the theory could not be
 *        reproduced. It is recorded as wrong in 046's header rather than
 *        quietly deleted, because the next person would otherwise start there.
 *
 * ── AND IT WAS NOT SUFFICIENT, WHICH IS THE OTHER HALF ──────────────────────
 *
 *   Removing the pattern removes the invented tables. The editor STILL could
 *   not run the file — it failed next with `syntax error at or near "RETURN"`,
 *   `LINE 1` of a line that is not line 1 of anything: the body cut at a
 *   different place. Its statement splitter does not respect dollar quoting
 *   either, and that is a SECOND defect this rewrite does not touch.
 *
 *   So what is asserted below is exactly what was achieved — no invented
 *   tables — and not "the editor accepts it". 046's header carries the rest,
 *   including the single-quoted-literal form that the editor does accept, and
 *   the psql path that was never affected.
 *
 * ── WHY THIS IS A RATCHET AND NOT A FIX ─────────────────────────────────────
 *
 *   FOURTEEN OTHER MIGRATIONS STILL READ THIS WAY — credit_wallet_once among
 *   them. They are already applied in production, so nothing is broken today,
 *   and rewriting fourteen money functions to remove a hazard that has already
 *   passed is a larger risk than the hazard. What must not happen is a NEW one,
 *   or a fresh project provisioned from supabase/deploy.sql — whose own header
 *   says it is applied "by pasting into the Supabase SQL Editor".
 *
 *   So the known set is pinned and may only SHRINK. A migration added with the
 *   pattern fails this suite; one repaired does not.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * SQL with comments removed.
 *
 *   PROSE IS NOT CODE, and this file is the reason the rule is repeated here:
 *   046's header now QUOTES the broken statement, `ALTER TABLE v_pointer` and
 *   all. A detector that reads comments reports the file it just fixed.
 */
function sqlOnly(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
}

/**
 * The `INTO <plpgsql variable>` reads a plain-SQL parser would take for table
 * creations.
 *
 * `INSERT INTO <table>` is excluded because it names a real table and the
 * editor plainly distinguishes it — it never named `public.wallets`, which 046
 * inserts into twice. `RETURNING … INTO` is excluded for the same reason: it
 * has no meaning in plain SQL at all, so there is no table for a parser to
 * invent from it.
 */
function selectIntoTargets(src: string): string[] {
    const sql = sqlOnly(src);
    const out: string[] = [];
    for (const m of sql.matchAll(/\bINTO\s+(v_\w+(?:\s*,\s*v_\w+)*)/g)) {
        const before = sql.slice(Math.max(0, m.index - 250), m.index);
        if (/\bRETURNING\b[^;]*$/.test(before)) continue;
        out.push(m[1]);
    }
    return out;
}

const migrations = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const affected = migrations.filter(
    (f) => selectIntoTargets(readFileSync(join(DIR, f), 'utf8')).length > 0,
);

/** Measured when this suite was written. It may shrink; it may not grow. */
const KNOWN = [
    '005_atomic_wallet_operations.sql',
    '006_wallet_ledger_corrections.sql',
    '007_status_transition_cas.sql',
    '009_claim_payment_once.sql',
    '011_wallet_balance_raw_data_sync.sql',
    '013_debit_jsonb_balance.sql',
    '014_debit_nested_jsonb_balance.sql',
    '015_bounded_counters.sql',
    '019_claim_idempotency_key.sql',
    '020_floored_debit_and_versioned_cas.sql',
    '021_single_open_loan_application.sql',
    '025_status_transition_dedicated_tables.sql',
    '026_document_patch_mirrors_native_columns.sql',
    '035_decrement_many_or_fail_aggregates_duplicates.sql',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#808 — 046 no longer invites the editor to invent tables', () => {
    const FILE = '046_consolidate_wallet_to_live_profile.sql';

    it('IT READS WITH ASSIGNMENTS, NOT `SELECT … INTO`', () => {
        expect(selectIntoTargets(readFileSync(join(DIR, FILE), 'utf8'))).toEqual([]);
    });

    it('AND THE READS ARE STILL THERE — it was not emptied, it was rewritten', () => {
        //   A file with no reads at all would pass the assertion above. The
        //   four values the function decides on must still be fetched.
        const src = sqlOnly(readFileSync(join(DIR, FILE), 'utf8'));

        for (const v of ['v_pointer', 'v_target_ptr', 'v_from_balance', 'v_to_balance']) {
            expect(src).toMatch(new RegExp(`${v}\\s*:=`));
        }
    });

    it('AND EXISTENCE IS ASKED SEPARATELY, because `:=` does not set FOUND', () => {
        //   Two refusals depend on telling "no row" from "a row holding NULL":
        //   source_profile_not_found and no_source_wallet. An assignment sets
        //   neither FOUND nor anything else, so EXISTS carries them.
        const src = sqlOnly(readFileSync(join(DIR, FILE), 'utf8'));

        expect(src).toMatch(/v_source_row\s*:=\s*EXISTS/);
        expect(src).toMatch(/v_source_wlt\s*:=\s*EXISTS/);
        expect(src).toContain('source_profile_not_found');
        expect(src).toContain('no_source_wallet');
    });

    it('and the consolidated deploy file carries the same version', () => {
        // deploy.sql is generated, and a stale one is the file somebody
        // actually pastes.
        const deploy = sqlOnly(readFileSync(join(process.cwd(), 'supabase', 'deploy.sql'), 'utf8'));

        expect(deploy).toMatch(/v_source_row\s*:=\s*EXISTS/);
        expect(deploy).not.toMatch(/\bINTO\s+v_pointer\b/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#808 — and no new migration may bring the pattern back', () => {
    it('THE AFFECTED SET MAY SHRINK BUT NOT GROW', () => {
        const added = affected.filter((f) => !KNOWN.includes(f));

        expect(added).toEqual([]);
    });

    it('POSITIVE CONTROL: the detector really does find the pattern', () => {
        // Otherwise "no new migrations" could be measuring a detector that
        // finds nothing anywhere.
        expect(affected.length).toBeGreaterThan(0);
        expect(selectIntoTargets(
            `SELECT COALESCE(w.balance, 0)\n  INTO v_balance\n  FROM wallets w;`,
        )).toEqual(['v_balance']);
    });

    it('AND IT IGNORES A COMMENT, which is how this file nearly lied', () => {
        //   046's header quotes the broken statement verbatim. The first run of
        //   this detector reported 046 as still affected, from its own fix.
        expect(selectIntoTargets(
            `-- SELECT 2 AS y INTO v_pointer;\n/* INTO v_other */\nSELECT 1;`,
        )).toEqual([]);
    });

    it('and it does not count INSERT INTO or RETURNING INTO', () => {
        // Neither can be read as a table creation, and 046 legitimately has both.
        expect(selectIntoTargets('INSERT INTO public.wallets (id) VALUES (1);')).toEqual([]);
        expect(selectIntoTargets(
            `INSERT INTO public.wallets (id) VALUES (1)\n  RETURNING balance INTO v_to_balance;`,
        )).toEqual([]);
    });
});

/*
 * ── HOW THE CAUSE WAS ESTABLISHED ───────────────────────────────────────────
 *
 *   Not from the error text, which blamed the dollar tags. On PostgreSQL 16,
 *   in this repository's own local cluster:
 *
 *       SELECT 2 AS y INTO v_pointer;
 *       SELECT tablename FROM pg_tables WHERE tablename = 'v_pointer';
 *       -- v_pointer
 *
 *   One line, and the four names the editor invented are accounted for.
 *
 *   The rewrite was then verified BEHAVIOURALLY rather than by reading it:
 *   schema + all 46 migrations applied to a fresh cluster, and
 *   src/__tests__/pg/money-that-moves-between-two-wallets.test.ts — sixteen
 *   tests including "money is conserved", "a rollback takes both sides with it"
 *   and "two concurrent calls move the balance exactly once" — passing
 *   identically before and after. The full supabase/deploy.sql applies clean
 *   to a fresh database too, since that is the file the header tells people to
 *   paste.
 */
