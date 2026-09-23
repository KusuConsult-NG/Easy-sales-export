/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "add the migration check."
 *
 *   The day that asked for it: a `count users` fix merged at midday, the admin
 *   dashboard reading "Total Users — could not be read" all afternoon, and the
 *   reason being that the fix had two halves. The app half shipped. The other
 *   half was migration 051, one CREATE INDEX, and NOTHING APPLIES THESE
 *   MIGRATIONS TO PRODUCTION — not the Dockerfile, not deploy-production.yml,
 *   not a start script. CI runs them against a throwaway cluster
 *   scripts/test-migrations.sh creates and destroys.
 *
 *   So every suite was green against a database that had all of them, while
 *   the real one was missing two, and nothing anywhere said so.
 *
 *   048's header had already written the shape down, about a different
 *   migration: "APPLY IT ON ITS OWN means a human, by hand, once, on each
 *   database. Whether that ever happened is not knowable from this
 *   repository." 027 said it before that. Three migrations have now recorded
 *   the same uncertainty. This is the check that ends it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const rpc = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: { rpc: (...a: any[]) => rpc(...a) },
}));

const audit = () => import('@/lib/migration-audit');

beforeEach(() => {
    jest.resetModules();
    rpc.mockReset();
});

describe('the manifest is what the migrations actually create', () => {
    it('LISTS EVERY INDEX AND FUNCTION, AND NOTHING ELSE', async () => {
        /*
         *   THE ANTI-ROT CONTROL, and the reason this check can be trusted at
         *   all. lib/migration-manifest is a checked-in constant because
         *   supabase/migrations is not shipped — a Next standalone build
         *   carries `.next` output and nothing else, so nothing at runtime can
         *   read those files.
         *
         *   A constant can drift from the directory it describes, which is the
         *   same failure this whole check exists to catch, one level up. So the
         *   files are parsed here and compared. Add a migration without listing
         *   what it creates and this fails.
         */
        const { migrationObjects } = await import('@/lib/testing/migration-objects');
        const { EXPECTED_SCHEMA_OBJECTS } = await import('@/lib/migration-manifest');

        const fromFiles = migrationObjects().map((o) => `${o.kind}:${o.name}:${o.migration}`).sort();
        const fromManifest = EXPECTED_SCHEMA_OBJECTS
            .map((o) => `${o.kind}:${o.name}:${o.migration}`).sort();

        expect(fromManifest).toEqual(fromFiles);
    });

    it('and the parser is not reading prose — a commented CREATE is not one', async () => {
        //   Every one of these files is mostly explanation, and several quote
        //   their own DDL in the header. A parser that counted those would add
        //   objects nobody creates, and the audit would report a healthy
        //   database as behind for ever.
        const { migrationObjects } = await import('@/lib/testing/migration-objects');

        const names = migrationObjects().map((o) => o.name);

        //   022 declares these with CONCURRENTLY and 048 re-creates them
        //   without; one object, named once.
        expect(names.filter((n) => n === 'idx_dc_collection_user')).toHaveLength(1);
        //   027's header walks through the lock costs of a worked example that
        //   it never runs. If that were counted, the manifest would carry a name
        //   no database will ever have, and the audit would call every healthy
        //   database behind.
        expect(names).not.toContain('idx_probe');
        //   A sanity floor: the directory really was read.
        expect(names.length).toBeGreaterThan(50);
    });

    it('DOES NOT ASK FOR WHAT A LATER MIGRATION OVERRULED', async () => {
        /*
         *   FOUND BY THIS CHECK'S FIRST RUN AGAINST PRODUCTION, and it is the
         *   defect this file exists to stop: the audit reported two indexes
         *   missing that are not missing.
         *
         *   022 declares nine expression indexes with CONCURRENTLY, which the
         *   Supabase SQL Editor cannot run, so 048 re-declared them in the
         *   plain form — SIX of them. It left idx_cm_user_id and
         *   idx_cm_membership_status out on purpose, because supabase-db
         *   resolves a filter field through FIELD_TO_COLUMN before it falls
         *   back to the JSONB path, and cooperative_members maps both names to
         *   native columns. Nothing can ever reach those two indexes, and an
         *   unreachable index is maintained on every write to a table on the
         *   cooperative signup path.
         *
         *   The manifest is PARSED FROM THE FILES. It can see that 022
         *   declares them; it cannot see that 048 overruled it. So the audit
         *   asked production for two indexes production was right not to have.
         *
         *   A check that cries wolf is a check that stops being read.
         */
        const { EXPECTED_INDEXES, DELIBERATELY_ABSENT } = await import('@/lib/migration-manifest');

        expect(DELIBERATELY_ABSENT.map((o) => o.name).sort()).toEqual([
            'idx_cm_membership_status',
            'idx_cm_user_id',
        ]);
        for (const { name } of DELIBERATELY_ABSENT) {
            expect(EXPECTED_INDEXES).not.toContain(name);
        }
    });

    it('but the RATCHET still knows about them, or the list rots the other way', async () => {
        /*
         *   THE EXEMPTION MUST NOT HIDE FROM THE PARSER. If an overruled
         *   object were simply dropped from EXPECTED_SCHEMA_OBJECTS, the
         *   file-versus-manifest comparison would fail — and the obvious way
         *   to make it pass is to stop parsing that migration, which is how
         *   this whole list would quietly stop describing the directory.
         *
         *   So they stay in the parsed set and are subtracted only from what
         *   the audit asks the database for. Every name here is one a
         *   migration really declares: a typo parked in this list would be
         *   an exemption for nothing.
         */
        const { EXPECTED_SCHEMA_OBJECTS, DELIBERATELY_ABSENT } =
            await import('@/lib/migration-manifest');

        for (const absent of DELIBERATELY_ABSENT) {
            const declared = EXPECTED_SCHEMA_OBJECTS.find((o) => o.name === absent.name);
            expect(declared).toBeDefined();
            expect(declared!.kind).toBe(absent.kind);
            //   And it names BOTH migrations: the one that declares it and the
            //   one that decided against it. Either alone is half a reason.
            expect(declared!.migration).toBe(absent.declaredBy);
            expect(absent.overruledBy).toMatch(/^\d{3}_.+\.sql$/);
            expect(absent.why.length).toBeGreaterThan(80);
        }
    });

    it('IGNORES DDL INSIDE A BLOCK COMMENT, including a nested one', async () => {
        /*
         *   THE CASE THE FIRST VERSION MISSED, and the reason this fixture is
         *   written rather than inferred.
         *
         *   That first version filtered whole `--` lines — which the `^\s*`
         *   anchors on the patterns already did for free. It was dead code that
         *   read like a guard, and a mutation run proved it: replacing the
         *   filter with a pass-through changed nothing anywhere in
         *   supabase/migrations, so nothing failed.
         *
         *   A block comment is the form that actually gets through: it says
         *   nothing about column 1, and 030 and 046 already use them. So the
         *   parser is pointed at a directory built for this, holding both
         *   comment forms and the real statements beside them.
         */
        const { mkdtempSync, mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const { tmpdir } = await import('os');

        const root = mkdtempSync(join(tmpdir(), 'migration-objects-'));
        mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
        writeFileSync(join(root, 'supabase', 'migrations', '001_fixture.sql'), [
            '-- A header in the house style, quoting the statement it is about:',
            '-- CREATE INDEX idx_quoted_in_a_line_comment ON public.users (id);',
            '',
            '/*',
            ' * The same thing in a block comment, at column one, which is what a',
            ' * filter on whole `--` lines could not see:',
            'CREATE INDEX idx_quoted_in_a_block ON public.users (id);',
            'CREATE OR REPLACE FUNCTION public.quoted_in_a_block() RETURNS void',
            ' *   /* nested, because Postgres nests block comments */',
            'CREATE INDEX idx_still_quoted_after_the_nested_one ON public.users (id);',
            ' */',
            '',
            "-- An apostrophe in the prose — it's the sort that swallows the rest",
            '-- of a file in a parser that tracks quotes without tracking',
            '-- comments first.',
            'CREATE INDEX idx_really_created ON public.users (created_at DESC);',
            'CREATE OR REPLACE FUNCTION public.really_created() RETURNS void',
            "LANGUAGE sql AS $$ SELECT 'the /* in this literal opens nothing' $$;",
            '',
            'CREATE INDEX idx_before_the_block ON public.users (id); /*',
            ' * A comment that opens after a live statement and closes before the',
            ' * next one. The newlines inside it are kept, or these two fold onto',
            ' * one line and the second stops being a statement.',
            '*/ CREATE INDEX idx_after_the_block ON public.users (id);',
        ].join('\n'));

        const { migrationObjects } = await import('@/lib/testing/migration-objects');

        expect(migrationObjects(root).map((o) => `${o.kind}:${o.name}`).sort()).toEqual([
            'function:really_created',
            'index:idx_after_the_block',
            'index:idx_before_the_block',
            'index:idx_really_created',
        ]);
    });
});

describe('three answers, because "could not look" is not "fine"', () => {
    it('IN SYNC when the database returns nothing missing', async () => {
        rpc.mockResolvedValue({ data: [], error: null });
        const { auditMigrations } = await audit();

        const result = await auditMigrations();

        expect(result.verdict).toBe('in-sync');
        expect(result.missing).toEqual([]);
        expect(result.applyThese).toEqual([]);

        //   AND IT COUNTED WHAT IT ASKED FOR. Reporting the parsed total here
        //   would overstate the check by the objects 048 overruled, which is
        //   the same mistake one sentence further along.
        const { EXPECTED_INDEXES, EXPECTED_FUNCTIONS, EXPECTED_SCHEMA_OBJECTS, DELIBERATELY_ABSENT } =
            await import('@/lib/migration-manifest');
        expect(result.expected).toBe(EXPECTED_INDEXES.length + EXPECTED_FUNCTIONS.length);
        expect(result.expected).toBe(EXPECTED_SCHEMA_OBJECTS.length - DELIBERATELY_ABSENT.length);
        expect(result.detail).toContain(String(result.expected));
    });

    it('BEHIND, naming the objects AND the files to apply, oldest first', async () => {
        /*
         *   The two that were actually missing on the day this was written —
         *   050 and 051 — plus an older one, and the third is here for a
         *   reason worth writing down.
         *
         *   TWO ROWS CANNOT PIN AN ORDER. The first version of this test fed
         *   them in descending order, 051 then 050, and asserted the ascending
         *   answer. Sorting a descending pair and REVERSING it produce the
         *   same list, so the assertion could not tell the two apart: a
         *   mutation run swapped .sort() for .reverse() in migration-audit and
         *   this test stayed green.
         *
         *   Three rows arriving in an order that is neither ascending nor
         *   descending have exactly one correct answer, and reversing them is
         *   not it.
         */
        rpc.mockResolvedValue({
            data: [
                { object_name: 'idx_dc_collection_email', object_kind: 'index' },   // 050
                { object_name: 'idx_users_raw_created_at', object_kind: 'index' },  // 051
                { object_name: 'idx_users_roles', object_kind: 'index' },           // 028
            ],
            error: null,
        });
        const { auditMigrations } = await audit();

        const result = await auditMigrations();

        expect(result.verdict).toBe('behind');
        //   ORDER MATTERS: migrations are written to be applied in sequence,
        //   and a later one can depend on what an earlier one created.
        expect(result.applyThese).toEqual([
            '028_users_roles_index.sql',
            '050_document_collections_user_email_index.sql',
            '051_users_raw_created_at_index.sql',
        ]);
        //   The sentence an operator reads carries the same order.
        expect(result.detail).toContain(
            '028_users_roles_index.sql, 050_document_collections_user_email_index.sql, '
            + '051_users_raw_created_at_index.sql',
        );
        //   And it is the FILE they are told to apply, not just the index name.
        expect(result.missing.map((m) => m.name)).toContain('idx_users_raw_created_at');
    });

    it('CANNOT TELL when the audit function itself is missing — and says which migration', async () => {
        /*
         *   The chicken and egg, and it is the most informative answer there
         *   is: if 052 has not been applied either, this database is behind by
         *   at least that one. Reporting "the check did not run" without naming
         *   the fix would leave an operator where they started.
         */
        rpc.mockResolvedValue({
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function' },
        });
        const { auditMigrations } = await audit();

        const result = await auditMigrations();

        expect(result.verdict).toBe('cannot-tell');
        expect(result.cause).toBe('missing');
        expect(result.applyThese).toEqual(['052_missing_schema_objects.sql']);
        expect(result.detail).toContain('052_missing_schema_objects.sql');
    });

    it('CANNOT TELL on a timeout, and claims nothing about what is applied', async () => {
        rpc.mockResolvedValue({
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
        });
        const { auditMigrations } = await audit();

        const result = await auditMigrations();

        expect(result.verdict).toBe('cannot-tell');
        expect(result.cause).toBe('timed-out');
        //   NOT a list of files to apply: nothing was learned, so prescribing
        //   a migration would be inventing one. lib/rpc-unavailable's rule.
        expect(result.applyThese).toEqual([]);
        expect(result.missing).toEqual([]);
    });

    it('AND A THROWN ERROR IS STILL NOT "IN SYNC"', async () => {
        //   The shape that matters most. A check believed when it could not
        //   look is worse than no check — #316's rule on money, #786's on
        //   lists, and this is the same rule on schema.
        rpc.mockImplementation(() => { throw new Error('socket hang up'); });
        const { auditMigrations } = await audit();

        const result = await auditMigrations();

        expect(result.verdict).toBe('cannot-tell');
        expect(result.verdict).not.toBe('in-sync');
    });
});

describe('the cron route makes the run go red when a human is needed', () => {
    const route = () => import('@/app/api/cron/migration-audit/route');

    beforeEach(() => {
        jest.doMock('@/lib/cron-auth', () => ({ refuseUnauthorisedCron: () => null }));
    });

    it('200 when the schema is in sync', async () => {
        rpc.mockResolvedValue({ data: [], error: null });
        const { GET } = await route();

        const res = await GET({} as any);

        expect(res.status).toBe(200);
        expect((await res.json()).verdict).toBe('in-sync');
    });

    it('503 WHEN THE DATABASE IS BEHIND, which is how it reaches somebody', async () => {
        /*
         *   #702's route answers 200 when it finds a condition no run can
         *   change — "answering 500 would make the scheduler shout about a
         *   condition no run can change, which is how a job stops being read."
         *
         *   THIS IS THE OTHER CASE. A missing index is fixable by one person in
         *   about twenty seconds, and the body says which file to paste. So the
         *   scheduled run goes red, and it clears itself when the migration is
         *   applied.
         */
        rpc.mockResolvedValue({
            data: [{ object_name: 'idx_users_raw_created_at', object_kind: 'index' }],
            error: null,
        });
        const { GET } = await route();

        const res = await GET({} as any);
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body.success).toBe(false);
        expect(body.applyThese).toEqual(['051_users_raw_created_at_index.sql']);
    });

    it('AND 503 WHEN IT COULD NOT LOOK, rather than a quiet 200', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no function' } });
        const { GET } = await route();

        const res = await GET({} as any);

        expect(res.status).toBe(503);
        expect((await res.json()).verdict).toBe('cannot-tell');
    });
});
