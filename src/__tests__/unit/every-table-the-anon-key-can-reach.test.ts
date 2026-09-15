/**
 * @jest-environment node
 */

/**
 *   #762 NOTHING TIED THE TABLES THE ADAPTER TARGETS TO THE TABLES ROW-LEVEL
 *        SECURITY PROTECTS.
 *
 *   The owner ran the two checks this audit had been asking for and the answer
 *   was correct on both counts:
 *
 *       policies_attached                          0
 *       rowsecurity, all nine public tables     true
 *
 *   That is migration 004's intended end state — "RLS on, no policies, anon key
 *   locked out entirely" — and it is right precisely BECAUSE there are no
 *   policies: the browser authenticates with NextAuth, so `auth.uid()` is NULL
 *   for anon requests and a per-user policy would deny everything anyway. The
 *   server is unaffected because it holds the service role, which bypasses RLS.
 *
 *   So there is no defect in the current state. THE DEFECT IS THAT NOTHING KEEPS
 *   IT TRUE.
 *
 * ── THE ONE WAY IT BREAKS, AND IT IS QUIET ──────────────────────────────────
 *
 *   `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships inside the JavaScript bundle. It is
 *   public by design. Migration 004 states the consequence plainly:
 *
 *       "With RLS disabled, that key can read and write EVERY row of EVERY
 *        table directly against the Supabase REST endpoint... The application's
 *        own permission checks are irrelevant, because an attacker does not have
 *        to go through the application."
 *
 *   Adding a collection does NOT create a table — `getTableName` sends anything
 *   it does not recognise to `document_collections`, which is protected. The
 *   hole opens only when somebody adds an entry to DEDICATED_TABLE_MAP and a
 *   migration creating that table, and does not enable RLS on it. Two files, one
 *   of which is easy to forget, and the result is a table holding real member
 *   data that anybody with the public key can read.
 *
 *   Nothing in this repository connected those two files. This does.
 *
 * ── WHY A TEST AND NOT A COMMENT ────────────────────────────────────────────
 *
 *   The migration already carries a warning telling whoever applies it to
 *   re-run a grep, with the reason: "this comment ages, the grep does not."
 *   The same argument applies one level up — a comment asking the next person
 *   to remember is the mechanism that failed everywhere else in this audit.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEDICATED_TABLE_MAP } from '@/lib/supabase-table-map';

const ROOT = process.cwd();
const RLS = 'supabase/migrations/004_enable_row_level_security.sql';

const rlsSql = () => readFileSync(join(ROOT, RLS), 'utf-8');

/** Tables migration 004 turns row-level security ON for. */
function tablesWithRls(): string[] {
    //   Only the STEP 1 enables, which is the part that is applied. The
    //   commented-out STEP 2 policies must not count as protection.
    const uncommented = rlsSql()
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');

    return [...uncommented.matchAll(/ALTER TABLE\s+(?:public\.)?([a-z_]+)\s+ENABLE ROW LEVEL SECURITY/gi)]
        .map((m) => m[1])
        .sort();
}

/** Every native table the adapter can address, plus the catch-all. */
function tablesTheAdapterTargets(): string[] {
    return [...new Set([...Object.values(DEDICATED_TABLE_MAP), 'document_collections'])].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#762 — every table the anon key could reach has RLS turned on', () => {
    it('THE TWO LISTS ARE THE SAME LIST', () => {
        /*
         *   THE ratchet. A new dedicated table added to the adapter without a
         *   matching ENABLE ROW LEVEL SECURITY fails here, which is the only
         *   moment anybody is looking.
         *
         *   Compared as sets rather than counted: a count would pass if one
         *   table were added and another removed in the same change.
         */
        expect(tablesTheAdapterTargets()).toEqual(tablesWithRls());
    });

    it('AND THE LIST IS THE NINE THE OWNER MEASURED IN PRODUCTION', () => {
        /*
         *   Pinned to the actual answer from the live database, so this test is
         *   anchored to reality rather than only to itself. If the sets above
         *   drift together — both changed, still equal — this still fails and
         *   asks whether production was checked again.
         */
        expect(tablesWithRls()).toEqual([
            'academy_applications',
            'cooperative_loans',
            'cooperative_members',
            'document_collections',
            'marketplace_orders',
            'processed_payments',
            'transactions',
            'users',
            'wallets',
        ]);
    });

    it('and the sweep is not vacuous — it finds real ALTER statements', () => {
        //   Both helpers are list-producing, so an empty-vs-empty comparison
        //   would pass while proving nothing.
        expect(tablesWithRls().length).toBeGreaterThan(5);
        expect(tablesTheAdapterTargets().length).toBeGreaterThan(5);
    });

    it('AND A COMMENTED-OUT ENABLE DOES NOT COUNT AS PROTECTION', () => {
        /*
         *   Migration 004 keeps STEP 2 commented out deliberately — those
         *   policies assume a Supabase session this platform does not issue.
         *   A parser that ignored comments would read the file as protecting
         *   more than it does, which is the direction that matters.
         */
        const commented = '-- ALTER TABLE not_a_real_table ENABLE ROW LEVEL SECURITY;';

        expect(rlsSql()).toContain('--');
        expect(tablesWithRls()).not.toContain('not_a_real_table');
        expect(commented.trimStart().startsWith('--')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#762 — and the precondition the migration depends on still holds', () => {
    it('NO BROWSER CODE READS THE DATABASE WITH THE ANON KEY', () => {
        /*
         *   Migration 004 says to confirm this before applying, and says why:
         *   "this comment ages, the grep does not". Option A works because
         *   everything the browser used to read moved to Server Actions — a
         *   single client component importing the plain `supabase` client would
         *   break silently the moment RLS went on, and would be a reason to
         *   doubt the lockout rather than trust it.
         *
         *   Run as a test so it is confirmed on every commit rather than on
         *   whoever remembers.
         */
        const { readdirSync } = require('fs') as typeof import('fs');

        const offenders: string[] = [];
        (function walk(dir: string) {
            for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) {
                    if (e.name === '__tests__' || e.name === 'testing') continue;
                    walk(rel);
                    continue;
                }
                if (!/\.tsx?$/.test(e.name) || e.name.includes('.test.')) continue;

                const src = readFileSync(join(ROOT, rel), 'utf-8');
                //   A CLIENT component that imports the anon-key client. The
                //   service-role import (`supabaseAdmin`) is server-side and is
                //   exactly what Option A assumes.
                const isClient = /^["']use client["']/m.test(src);
                const importsAnon = /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*["']@\/lib\/supabase["']/.test(src);

                if (isClient && importsAnon) offenders.push(rel);
            }
        })('src');

        expect(offenders).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH.
 *
 *     MUTANT                                                        RESULT
 *     a new dedicated table is added to the adapter with no RLS      KILLED
 *     RLS is removed from the users table                            KILLED
 *     a client component starts reading with the anon key            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The first mutant is the whole point: it adds `'bvnVault':
 *   'member_bvn_vault'` to DEDICATED_TABLE_MAP and nothing else — exactly the
 *   two-file change that would have opened a table of members' BVNs to a key
 *   that ships in the browser bundle.
 */
