/**
 * @jest-environment node
 */

/**
 *   #479 A PROFILE WITH NO EMAIL CAN ONLY EVER BE FOUND BY ITS DOCUMENT ID —
 *   AND NORMALISING BLANKS WOULD HAVE MADE THAT WORSE.
 *
 *   The owner's duplicate query turned up a group with an EMPTY normalised
 *   email and 49 rows in it. Every lookup in this codebase that resolves a
 *   person from an address misses all of them: the login, the ghost scan,
 *   session-guard, password reset, the cooperative and module checks. If such a
 *   profile sits under a legacy id rather than the auth id, the person is
 *   unreachable and #476's branch writes them a blank profile instead.
 *
 *   AND #478 NEARLY MADE IT DANGEROUS. #478 routes every users.email equality
 *   through `email_normalised` — lower(btrim(email)) — which is right for real
 *   addresses and WIDENS the match for blank ones, because '' and '   ' become
 *   the same value. Measured on a real cluster before the guard:
 *
 *       where email = '   '              ->  1 row
 *       where email_normalised = ''      ->  2 rows
 *
 *   session-guard.ts, the six cooperative lookups and the admin search all reach
 *   that filter with `where('email','==', x)`. An identity lookup that resolved
 *   a blank address to somebody's blank-email profile would be a worse defect
 *   than the one #478 fixed. So a blank value keeps the RAW column and the exact
 *   pre-#478 behaviour, and only real addresses are normalised.
 *
 *   THE REPAIR IS THE ADDRESS THE PERSON JUST PROVED THEY OWN. When login
 *   resolves a profile by an identity LINK and finds its email empty, Supabase
 *   Auth has already verified the address for that account — so it is written
 *   in, and the row stops being invisible. ONLY when empty: an existing address
 *   is never overwritten, because a profile whose email differs from the one used
 *   to sign in is a finding, and overwriting it destroys the evidence.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

const TAG = 'blank-479';

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
    await c.query(
        `insert into public.users (id, email, roles, raw_data) values
             ($1, null,  array['wave_participant'],    '{"fullName":"No Email"}'::jsonb),
             ($2, '',    array['academy_participant'], '{"fullName":"Empty Email"}'::jsonb),
             ($3, '   ', array['user'],                '{"fullName":"Space Email"}'::jsonb),
             ($4, $5,    array['user'],                '{"fullName":"Real"}'::jsonb)`,
        [`${TAG}-null`, `${TAG}-empty`, `${TAG}-space`, `${TAG}-real`, `${TAG}-real@example.com`],
    );
}, 300_000);

afterAll(async () => {
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

const ours = (rows: any[]) => rows.map((r) => r.id).filter((id: string) => id.startsWith(TAG)).sort();

/**
 * Whether migration 032 is applied to the database under test.
 *
 *   #480 THIS SUITE ASSUMED IT WAS, AND THE OWNER'S PRODUCTION SHOWED IT WAS
 *   NOT. Two tests below are statements about a normalised column, and on a
 *   database without one they failed while the code was behaving exactly as
 *   designed — degrading to the raw column, with #476's RPC fallback still
 *   finding the profile.
 *
 *   Both states are correct. The suite has to say which it is looking at rather
 *   than assume the tidier one, because the untidy one is what production was.
 */
const migration032 = async (): Promise<boolean> => {
    const { rows } = await client!.query(
        `select count(*)::int as n from information_schema.columns
          where table_schema='public' and table_name='users' and column_name='email_normalised'`,
    );
    return rows[0].n === 1;
};

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#479 — a blank email must not match another blank email', () => {
    it('THE ADAPTER DOES NOT WIDEN A BLANK SEARCH', async () => {
        //   The assertion the guard exists for. Through the real adapter and
        //   real PostgREST: a whitespace-only address must behave exactly as it
        //   did before #478 — matching the row that literally holds it, not
        //   every row whose email is blank.
        const { supabaseDb } = await import('@/lib/supabase-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');

        const snap = await supabaseDb.collection(COLLECTIONS.USERS).where('email', '==', '   ').get();

        expect(ours(snap.docs)).toEqual([`${TAG}-space`]);
    }, 300_000);

    it('AND AN EMPTY SEARCH MATCHES ONLY THE EMPTY ROW', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');

        const snap = await supabaseDb.collection(COLLECTIONS.USERS).where('email', '==', '').get();

        expect(ours(snap.docs)).toEqual([`${TAG}-empty`]);
    }, 300_000);

    it('POSITIVE CONTROL: a REAL address is normalised WHEN 032 IS APPLIED', async () => {
        //   Without this, "blank does not widen" could be satisfied by removing
        //   the normalisation altogether, which is the defect #478 fixed.
        //
        //   #480: on a database WITHOUT 032 the adapter deliberately uses the
        //   raw column, so this asserts the state it is actually in. What must
        //   hold either way is that a login still finds the person — that is
        //   asserted in login-finds-the-profile-it-already-has.test.ts, through
        //   #476's RPC fallback.
        const { supabaseDb } = await import('@/lib/supabase-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const applied = await migration032();

        const snap = await supabaseDb
            .collection(COLLECTIONS.USERS)
            .where('email', '==', `  ${TAG}-REAL@Example.COM `)
            .get();

        expect({ applied, found: ours(snap.docs) })
            .toEqual({ applied, found: applied ? [`${TAG}-real`] : [] });
    }, 300_000);

    it('AND WITHOUT 032 THE ADAPTER FALLS BACK RATHER THAN ERRORING', async () => {
        //   The whole point of #480. A deploy that lands before the migration
        //   must be exactly as good as it was before #478 — not broken with
        //   "column email_normalised does not exist" on every email lookup.
        const { supabaseDb } = await import('@/lib/supabase-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');

        const snap = await supabaseDb
            .collection(COLLECTIONS.USERS)
            .where('email', '==', `${TAG}-real@example.com`)
            .get();

        expect(ours(snap.docs)).toEqual([`${TAG}-real`]);
    }, 300_000);

    it('and the widening it prevents is real, not hypothetical', async () => {
        //   The measurement that motivated the guard, run against the same rows:
        //   normalising blanks collapses '' and '   ' into one value. Expressed
        //   with lower(btrim(...)) rather than the column, so it states the FACT
        //   about normalisation and holds whether or not 032 is applied.
        const { rows } = await client!.query(
            `select
                 count(*) filter (where email = '   ')::int                      as raw_match,
                 count(*) filter (where lower(btrim(email)) = '')::int           as normalised_match
               from public.users where id like $1`,
            [`${TAG}-%`],
        );

        expect(rows[0].raw_match).toBe(1);
        expect(rows[0].normalised_match).toBeGreaterThan(1);
    }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#479 — the login repairs the row it can see', () => {
    const auth = () => stripComments(readFileSync('src/lib/auth.ts', 'utf-8'));

    it('AN EMPTY STORED EMAIL IS FILLED FROM THE VERIFIED ADDRESS', () => {
        const code = auth();

        expect(code).toContain("const storedEmail = typeof matchedData.email === 'string'");
        expect(code).toContain("if (storedEmail === '')");
        expect(code).toContain('email: email.toLowerCase()');
    });

    it('AND AN EXISTING ADDRESS IS NEVER OVERWRITTEN', () => {
        //   The control that matters. A profile whose email differs from the one
        //   used to sign in is a FINDING; overwriting it would erase the
        //   evidence and could quietly move a person onto another row.
        const code = auth();
        const start = code.indexOf('const storedEmail');
        const block = code.slice(start, start + 900);

        expect(block).toContain("if (storedEmail === '')");
        expect(block).not.toMatch(/if \(storedEmail !== email/);
    });

    it('AND A FAILED REPAIR DOES NOT FAIL THE LOGIN', () => {
        //   Signing in must not depend on a housekeeping write succeeding.
        const code = auth();
        const start = code.indexOf('const storedEmail');
        const block = code.slice(start, start + 1200);

        expect(block).toContain('try {');
        expect(block).toContain('catch');
    });

    it('and it says what it did', () => {
        expect(auth()).toContain('had NO email stored and was');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#479 — and the ones who have not logged in are counted', () => {
    const forensics = () => stripComments(readFileSync('src/app/actions/forensics.ts', 'utf-8'));

    it('THERE IS A CHECK FOR PROFILES WITH NO EMAIL', () => {
        //   The login repair only reaches people who log in. 49 rows exist; this
        //   is how the rest are found rather than waited for.
        const code = forensics();

        expect(code).toContain('Profiles With No Email Address');
        expect(code).toContain('.where("email", "==", "")');
        expect(code).toContain('.where("email", "==", null as any)');
    });

    it('AND THEY ARE FINDINGS, NOT "could not check"', () => {
        //   Unlike an unrecorded gender, this is not a fact about the person
        //   that was never collected — they signed up with an address. It is
        //   something to fix, so it belongs in affectedIds.
        const code = forensics();
        const start = code.indexOf('Profiles With No Email Address');
        const block = code.slice(start, start + 1800);

        expect(block).toContain('affectedIds: ids');
        expect(block).not.toContain('notCheckedIds');
    });

    it('and it reports the roles, so an admin can see what is at stake', () => {
        expect(forensics()).toContain('(roles: ${roles.join(", ")})');
    });
});
