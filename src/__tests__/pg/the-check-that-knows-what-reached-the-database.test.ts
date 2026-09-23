/**
 *   THE OWNER: "add the migration check."
 *
 *   Nothing applies this repository's migrations to production — not the
 *   Dockerfile, not deploy-production.yml, not a start script. CI runs them
 *   against a throwaway cluster it creates and destroys, so every suite is
 *   green against a database that has all of them, and the real one is
 *   whatever a human last remembered to paste into the SQL editor.
 *
 *   On the day this was written, 050 and 051 had not been. 051 was the other
 *   half of a `count users` fix merged hours earlier, and the admin dashboard
 *   read "Total Users — could not be read" the whole time.
 *
 *   THIS SUITE RUNS AGAINST A REAL POSTGRES, because the thing being tested is
 *   SQL that reads pg_indexes and pg_proc. A fake cannot tell you whether a
 *   catalogue query is right.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe } from '@/lib/testing/pg-harness';

let client: Client | null = null;

beforeAll(async () => {
    const url = process.env.LOCAL_PG_URL || process.env.DATABASE_URL;
    if (!url) return;
    const c = new Client({ connectionString: url });
    await c.connect();
    client = c;
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

const missing = async (indexes: string[], functions: string[]) => {
    const { rows } = await client!.query(
        'select object_name, object_kind from public.missing_schema_objects($1, $2) order by object_name',
        [indexes, functions],
    );
    return rows as Array<{ object_name: string; object_kind: string }>;
};

dbDescribe('the function that says what reached this database', () => {
    it('SAYS NOTHING when everything asked for is present', async () => {
        //   The healthy answer is no rows — the comparison happens in the
        //   database so a well-migrated one returns an empty payload.
        const rows = await missing(['idx_users_roles'], ['merge_raw_data']);

        expect(rows).toEqual([]);
    });

    it('NAMES WHAT IS ABSENT, and says which kind it is', async () => {
        const rows = await missing(
            ['idx_users_roles', 'idx_not_real'],
            ['merge_raw_data', 'fn_not_real'],
        );

        expect(rows).toEqual([
            { object_name: 'fn_not_real', object_kind: 'function' },
            { object_name: 'idx_not_real', object_kind: 'index' },
        ]);
    });

    it('DOES NOT CONFUSE AN INDEX WITH A FUNCTION OF THE SAME NAME', async () => {
        //   Asked for a real INDEX name as a FUNCTION, it must report it
        //   missing: the two catalogues are separate and the check says which
        //   one it looked in.
        const rows = await missing([], ['idx_users_roles']);

        expect(rows).toEqual([{ object_name: 'idx_users_roles', object_kind: 'function' }]);
    });

    it('handles an empty ask, and a null one, without failing', async () => {
        //   A caller with nothing to check is not an error, and the manifest
        //   could legitimately be empty in a stripped-down environment.
        expect(await missing([], [])).toEqual([]);

        const { rows } = await client!.query(
            'select * from public.missing_schema_objects(null, null)',
        );
        expect(rows).toEqual([]);
    });

    it('AND EVERY OBJECT THE MANIFEST EXPECTS IS ON THIS DATABASE', async () => {
        /*
         *   The control, and the one that makes the whole check meaningful:
         *   this database has had every migration applied by
         *   scripts/local-postgres.sh, so the audit must report it in sync.
         *
         *   If this fails, either a migration creates something the manifest
         *   does not list — the ratchet in the unit suite catches that — or the
         *   manifest lists something no migration creates, which is this test.
         */
        const { EXPECTED_INDEXES, EXPECTED_FUNCTIONS } =
            await import('@/lib/migration-manifest');

        const rows = await missing([...EXPECTED_INDEXES], [...EXPECTED_FUNCTIONS]);

        expect({ missing: rows.map((r) => `${r.object_kind}:${r.object_name}`) })
            .toEqual({ missing: [] });
    });
});
