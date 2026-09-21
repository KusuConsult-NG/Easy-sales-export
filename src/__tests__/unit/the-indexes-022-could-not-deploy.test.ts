/**
 *   THE NINE INDEXES 022 DECLARED AND NO DEPLOY COULD EVER APPLY.
 *
 *   022 writes every one of its nine expression indexes with
 *   `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block.
 *   The Supabase SQL Editor always opens one and so does the deploy runner, so
 *   build-deploy-sql puts 022 in EXCLUDED and its own reason ends "Apply it on
 *   its own" — meaning a human, by hand, once, per database.
 *
 *   Whether that ever happened is not knowable from this repository. 027's
 *   header records what the same uncertainty cost last time: a migration that
 *   "could not be applied by the SQL Editor ... AND IT SAT UNAPPLIED".
 *
 *   041 and 043 each treated 022 as unapplied and re-declared ONE of its
 *   indexes in the plain, deployable form under the same name. Six more went
 *   unnoticed for five migrations, two of them the pair 041's own header calls
 *   "the two that cover most of the application". 048 rescues those six.
 *
 *   ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────
 *
 *   NOT to restate 048. The plans are proved against a real Postgres in
 *   src/__tests__/pg/the-indexes-022-could-not-deploy.test.ts. This is the
 *   ratchet that stops it happening a FOURTH time: every index name 022
 *   declares must be either
 *
 *     (a) re-declared in a migration the deploy builder will actually emit, or
 *     (b) named here as unreachable, with the mapping that makes it so still
 *         in place.
 *
 *   A tenth CONCURRENTLY index added to 022 tomorrow fails this immediately,
 *   rather than in five migrations' time when somebody measures a timeout.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { FIELD_TO_COLUMN, NATIVE_COLUMNS } from '@/lib/supabase-table-map';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Index names created by a migration — statements only, never prose. */
function indexesDeclaredIn(file: string): string[] {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const names: string[] = [];

    for (const line of sql.split('\n')) {
        //   A SQL comment is not a statement. 022's own header quotes several
        //   of these index names in prose, and counting those would let a
        //   stranded index pass by being TALKED about.
        if (line.trimStart().startsWith('--')) continue;

        const m = /^\s*CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(line);
        if (m) names.push(m[1]);
    }

    return names;
}

/** Every migration the deploy builder can emit — i.e. everything but 022. */
function deployableMigrations(): string[] {
    return readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.sql'))
        .filter((f) => !f.startsWith('022_'));
}

/**
 * 022's indexes that are deliberately NOT rescued, and why.
 *
 *   An index on a JSONB path the adapter never emits cannot be used by
 *   anything, and it is not free: it is maintained on every write to a table
 *   on the cooperative signup path. The mapping that makes it unreachable is
 *   asserted below, so this exemption cannot outlive its own reason.
 */
const UNREACHABLE = {
    idx_cm_user_id: { table: 'cooperative_members', field: 'userId', column: 'user_id' },
    idx_cm_membership_status: { table: 'cooperative_members', field: 'membershipStatus', column: 'status' },
} as const;

describe('the indexes 022 could not deploy', () => {
    it('022 is still written with CONCURRENTLY, which is the whole problem', () => {
        //   If somebody ever rewrites 022 into the plain form, this file's
        //   premise is gone and the exemption below should go with it.
        const sql = readFileSync(join(MIGRATIONS, '022_jsonb_expression_indexes.sql'), 'utf8');

        expect(sql).toMatch(/^CREATE INDEX CONCURRENTLY/m);
    });

    it('is EXCLUDED from the deploy build, so nothing in it ships by itself', () => {
        const builder = readFileSync(join(process.cwd(), 'scripts', 'build-deploy-sql.mjs'), 'utf8');
        const excluded = /const EXCLUDED = \[([\s\S]*?)\n\];/.exec(builder);

        expect(excluded?.[1]).toContain('"022"');
    });

    it('EVERY index 022 declares is either rescued into a deployable migration or named unreachable', () => {
        const declared = indexesDeclaredIn('022_jsonb_expression_indexes.sql');

        //   A guard on the guard: if the regex above ever stops matching, this
        //   whole test would pass vacuously on an empty list.
        expect(declared.length).toBe(9);

        const rescued = new Set(
            deployableMigrations().flatMap((f) => indexesDeclaredIn(f)),
        );

        const stranded = declared.filter(
            (name) => !rescued.has(name) && !(name in UNREACHABLE),
        );

        expect(stranded).toEqual([]);
    });

    it('and the six that ARE rescued are rescued by 048, under 022\'s own names', () => {
        //   The same name is what makes 048 a no-op on a database where 022 was
        //   applied by hand. A rescue under a NEW name would build a second
        //   index on the same expression wherever 022 landed.
        const rescuedBy048 = indexesDeclaredIn('048_the_indexes_022_could_not_deploy.sql');
        const declaredBy022 = new Set(indexesDeclaredIn('022_jsonb_expression_indexes.sql'));

        expect(rescuedBy048).toHaveLength(6);
        for (const name of rescuedBy048) {
            expect(declaredBy022.has(name)).toBe(true);
        }
    });

    it('048 is plain CREATE INDEX — if it were CONCURRENTLY it would strand itself too', () => {
        const sql = readFileSync(join(MIGRATIONS, '048_the_indexes_022_could_not_deploy.sql'), 'utf8');
        const statements = sql.split('\n').filter((l) => /^\s*CREATE\s+INDEX/i.test(l));

        expect(statements).toHaveLength(6);
        for (const s of statements) {
            expect(s).not.toMatch(/CONCURRENTLY/i);
            expect(s).toMatch(/IF NOT EXISTS/i);
        }
    });

    describe('the two that are deliberately left behind', () => {
        //   THIS IS THE LOAD-BEARING ASSERTION. 048 omits these two because
        //   supabase-db resolves a filter field through FIELD_TO_COLUMN before
        //   falling back to `raw_data->>'field'`, and both names map to native
        //   columns — so the JSONB path the index is on is never emitted.
        //
        //   Delete either mapping and the adapter starts emitting that path,
        //   the index becomes live, and 048's omission becomes a missing index
        //   on the cooperative signup path. That is what this catches.
        for (const [index, { table, field, column }] of Object.entries(UNREACHABLE)) {
            it(`${index} is unreachable because ${table}.${field} maps to the native ${column}`, () => {
                expect(FIELD_TO_COLUMN[table]?.[field]).toBe(column);
                expect(NATIVE_COLUMNS[table]).toContain(column);
            });
        }

        it('and nothing rescued them, which is the point', () => {
            const rescued = new Set(
                deployableMigrations().flatMap((f) => indexesDeclaredIn(f)),
            );

            for (const name of Object.keys(UNREACHABLE)) {
                expect(rescued.has(name)).toBe(false);
            }
        });
    });

    describe('the fields 048 DOES index are the ones the adapter sends to raw_data', () => {
        //   The mirror image of the exemption above: an index on
        //   `raw_data->>'x'` is only reachable while `x` is NOT mapped to a
        //   native column. If one of these ever gains a native column, 048's
        //   index becomes the dead weight the cooperative pair is today.
        const REACHABLE: ReadonlyArray<[string, string]> = [
            ['processed_payments', 'type'],
            ['processed_payments', 'status'],
            ['marketplace_orders', 'paymentReference'],
            ['marketplace_orders', 'paymentStatus'],
        ];

        for (const [table, field] of REACHABLE) {
            it(`${table}.${field} has no native column, so the JSONB path is emitted`, () => {
                expect(FIELD_TO_COLUMN[table]?.[field]).toBeUndefined();
                expect(NATIVE_COLUMNS[table]).not.toContain(field);
            });
        }

        it('document_collections has no native columns at all — everything is raw_data', () => {
            expect(NATIVE_COLUMNS['document_collections']).toBeUndefined();
            expect(FIELD_TO_COLUMN['document_collections']).toBeUndefined();
        });
    });
});
