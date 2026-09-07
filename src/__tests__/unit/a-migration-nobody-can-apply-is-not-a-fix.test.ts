/**
 * @jest-environment node
 */

/**
 *   #469 THE MIGRATION WAS WRITTEN FOR A TOOL THIS PROJECT DOES NOT HAVE, SO
 *   THE FIX IT CARRIED WAS NEVER APPLIED.
 *
 *   #467 measured a 430x speedup on /admin/users and shipped it as migration
 *   027. The owner tried to apply it and got:
 *
 *       Error: Failed to run sql query: ERROR: 25001: CREATE INDEX CONCURRENTLY
 *       cannot run inside a transaction block
 *
 *   The Supabase SQL Editor wraps every submission in a transaction. There is no
 *   setting for that. And build-deploy-sql.mjs's own header states, in the file
 *   that generates the deployment, that the Editor is the ONLY route here —
 *   "applied by pasting into the Supabase SQL Editor because neither psql nor
 *   the Supabase CLI is installed."
 *
 *   So the repository knew both halves and never put them together. THREE places
 *   recorded the instruction that could not be followed:
 *
 *     027's header      "run this file ON ITS OWN"
 *     EXCLUDED          "Run it on its own, then check pg_index"
 *     the #467 test      asserted EVERY STATEMENT IS CONCURRENTLY
 *
 *   The test is the worst of the three: it pinned the file to the one form that
 *   could not be used, so any attempt to rewrite it into a usable one would have
 *   failed CI and looked like the mistake. Fifth time in this audit that a test
 *   pinned to an implementation detail held a defect in place.
 *
 *   EXCLUDING IT WAS NOT A SOLUTION, WHICH IS THE PART WORTH KEEPING. Leaving a
 *   migration out of the consolidated file is correct when it is applied some
 *   other way. It is a silent hole when there IS no other way — the builder
 *   reports a complete deployment and the index never exists. So this test does
 *   not merely ban the statement; it checks the builder REFUSES rather than
 *   quietly re-excluding.
 *
 *   WHAT THE REWRITE COSTS, MEASURED RATHER THAN ASSUMED. 027's first draft
 *   justified CONCURRENTLY by claiming the plain form "takes an ACCESS EXCLUSIVE
 *   lock and blocks every read and write". Asked directly it takes a ShareLock:
 *   reads are unaffected for the whole build; writes block for 718 ms on 50,009
 *   rows. The wrong sentence is why the unusable form looked like the only safe
 *   one. Those facts are asserted against a live cluster in
 *   src/__tests__/pg/created-at-is-indexed-where-it-is-ordered.test.ts, which
 *   also applies the real file inside BEGIN/COMMIT.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     027 back to CREATE INDEX CONCURRENTLY        KILLED
 *     027 re-added to EXCLUDED instead of fixed    KILLED
 *     the builder's guard deleted                  KILLED
 *     the guard's comment-stripping removed        KILLED (027's header names it)
 *     lock_timeout dropped from 027                KILLED
 *     reword this header                           SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BUILDER = 'scripts/build-deploy-sql.mjs';
const MIGRATIONS = 'supabase/migrations';

const build = (args: string[] = []) =>
    execFileSync('node', [BUILDER, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

/** SQL comments, so a statement NAMED in a header is not read as one written. */
const statementsOf = (sql: string) =>
    sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');

/** Statements PostgreSQL refuses to run inside a transaction block. */
const NON_TRANSACTIONAL = /\b(?:CREATE|DROP)\s+INDEX\s+CONCURRENTLY\b|\bREINDEX\s+(?:\w+\s+)*CONCURRENTLY\b|\bVACUUM\b|\bALTER\s+SYSTEM\b/i;

// ─────────────────────────────────────────────────────────────────────────────
describe('#469 — the consolidated deploy can actually be pasted', () => {
    it('NOTHING IN IT REFUSES TO RUN IN A TRANSACTION', () => {
        //   The whole file is submitted as one paste. A single such statement
        //   fails at that line and everything AFTER it never runs — a partial
        //   deployment reported as one error.
        const generated = build();
        const offenders = statementsOf(generated).match(NON_TRANSACTIONAL);

        expect({ offenders: offenders ?? [] }).toEqual({ offenders: [] });
    });

    it('AND 027 IS IN IT — the fix that could not be applied', () => {
        // Not merely "no bad statement": a file emptied of the migration would
        // satisfy the ban above and leave the 430x speedup unshipped, which is
        // exactly what happened.
        const generated = build();

        expect(generated).toContain('idx_users_created_at');
        expect(generated).toContain('027_dedicated_table_created_at_indexes.sql');
    });

    it('POSITIVE CONTROL: the scan really would catch the statement 027 had', () => {
        // Without this, "no offenders" could mean the pattern never matches.
        expect(
            statementsOf('CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON public.users (created_at DESC);'),
        ).toMatch(NON_TRANSACTIONAL);
    });

    it('and a statement only NAMED in a comment is not mistaken for one written', () => {
        //   027's header names the CONCURRENTLY form deliberately, for a future
        //   where a table is large enough to need it. A guard that could not
        //   tell prose from code would force that knowledge to be deleted.
        expect(statementsOf('-- CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON y (z);\nSELECT 1;'))
            .not.toMatch(NON_TRANSACTIONAL);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#469 — the builder REFUSES rather than quietly excluding', () => {
    /**
     * The failure this guards is not "a bad statement got in". It is the
     * opposite: the bad statement was correctly kept OUT, and the fix it carried
     * then had nowhere to go. A builder that only bans is a builder that
     * encourages the next person to add an EXCLUDED entry and move on.
     */
    const withTempMigration = (body: string, run: () => void) => {
        const name = '999_temp_469_probe.sql';
        const path = join(MIGRATIONS, name);
        writeFileSync(path, body);
        try { run(); } finally { rmSync(path, { force: true }); }
    };

    it('AN UNKNOWN MIGRATION STOPS THE BUILD — the check that already existed', () => {
        withTempMigration('SELECT 1;\n', () => {
            const failed = (() => { try { build(); return null; } catch (e: any) { return e; } })();

            expect(failed).not.toBeNull();
            expect(String(failed.stderr)).toContain('does not know about');
        });
    });

    it('AND ITS MESSAGE SAYS WHY EXCLUDING IT IS NOT THE ANSWER', () => {
        //   The words matter here more than usual: the previous message offered
        //   EXCLUDED as an equal option, and somebody took it.
        const source = readFileSync(BUILDER, 'utf-8');

        expect(source).toContain('Do NOT just move it to EXCLUDED');
        expect(source).toContain('no psql and no Supabase CLI');
    });

    it('AND THE GUARD IS ON THE CHOSEN FILES, NOT ON A HAND-KEPT LIST', () => {
        // Derived from the migrations actually emitted, so it cannot drift from
        // them — the same reason the function list below it is derived.
        const source = readFileSync(BUILDER, 'utf-8');

        expect(source).toContain('for (const step of chosen)');
        expect(source).toContain('NON_TRANSACTIONAL');
    });

    it('and it exits non-zero — a warning nobody reads is not a guard', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mig469-'));
        try {
            // A migration that IS expected, rewritten to hold the statement.
            const real = join(MIGRATIONS, '027_dedicated_table_created_at_indexes.sql');
            const saved = readFileSync(real, 'utf-8');
            writeFileSync(join(dir, 'saved.sql'), saved);
            writeFileSync(real, saved.replace(/^CREATE INDEX /m, 'CREATE INDEX CONCURRENTLY '));

            const failed = (() => { try { build(); return null; } catch (e: any) { return e; } })();

            writeFileSync(real, saved);

            expect(failed).not.toBeNull();
            expect(failed.status).toBe(1);
            expect(String(failed.stderr)).toContain('cannot run inside a transaction');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#469 — and no migration on disk carries one unnoticed', () => {
    it('EVERY SUCH MIGRATION IS ACCOUNTED FOR', () => {
        //   022 legitimately holds CONCURRENTLY: it is marked DO NOT APPLY on
        //   its own measurements and is excluded on that ground, not on how it
        //   would be applied. Anything else is 027's mistake repeating.
        const ALLOWED = new Set(['022_jsonb_expression_indexes.sql']);

        const offenders = readdirSync(MIGRATIONS)
            .filter((f) => f.endsWith('.sql') && !ALLOWED.has(f))
            .filter((f) => NON_TRANSACTIONAL.test(statementsOf(readFileSync(join(MIGRATIONS, f), 'utf-8'))));

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('and the allowance is a real file, not a stale name', () => {
        // A typo'd exemption would silently exempt nothing and pass forever, or
        // silently exempt everything if the file were renamed.
        const files = readdirSync(MIGRATIONS);

        expect(files).toContain('022_jsonb_expression_indexes.sql');
        expect(
            NON_TRANSACTIONAL.test(statementsOf(readFileSync(join(MIGRATIONS, '022_jsonb_expression_indexes.sql'), 'utf-8'))),
        ).toBe(true);
    });
});
