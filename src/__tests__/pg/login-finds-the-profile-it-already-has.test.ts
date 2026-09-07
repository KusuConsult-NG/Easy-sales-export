/**
 * @jest-environment node
 */

/**
 *   #476 A PROFILE STORED WITH DIFFERENT CASE OR SURROUNDING SPACE WAS INVISIBLE
 *   TO LOGIN, AND LOGIN THEN WROTE A BLANK ONE OVER THE TOP.
 *
 *   The owner: "users will report auth is broken or account not found even when
 *   they are fully registered, or missing details after they got enrolled
 *   successfully."
 *
 *   lib/auth.ts found the caller's profile with
 *
 *       db.collection(USERS).where('email', '==', email.toLowerCase())
 *
 *   normalising the INPUT and not the STORED VALUE. Proven against a real
 *   PostgreSQL with a row held the way legacy rows are:
 *
 *       stored:  [  Ada@Example.COM ]  roles: wave_participant, academy_participant
 *       where email = 'ada@example.com'                ->  0 rows
 *       where lower(btrim(email)) = 'ada@example.com'  ->  1 row
 *
 *   WHAT THAT DOES TO THE PERSON. Supabase Auth verifies them — right password,
 *   right account. The profile query returns empty, and auth.ts takes the branch
 *   immediately below: auto-provision `roles: ['general_user']`, `fullName` from
 *   the email prefix, `profileComplete: false`. Their real roles, name and
 *   approved registrations are not in the session. That is the owner's report,
 *   both halves of it.
 *
 *   AND IT COMPOUNDS. The auto-provision writes a SECOND row under the auth id
 *   while the real profile stays under its legacy id. Afterwards two rows match
 *   the email, neither identifies with the auth account by the first two rules,
 *   and every login falls to auth.ts's last resort — `?? userSnap.docs[0]` —
 *   picking whichever comes back first. One person, two profiles, arbitrary
 *   choice.
 *
 *   THE REPOSITORY ALREADY KNEW. #465's authAccountsWithProfiles normalises both
 *   sides and its test asserts '  Ada@Example.COM ' matches. The forensic scan
 *   was taught this and the LOGIN was not — the fifth fix-reaches-one-of-N in
 *   this audit, and this time the door was the front one.
 *
 *   THE FALLBACK IS EXACT, NOT FUZZY, AND THAT IS THE SECURITY PROPERTY.
 *   Measured against the real PostgREST:
 *
 *       email=ilike.ada@example.com     ->  []       the spaces defeat it
 *       email=ilike.*ada@example.com*   ->  the row  and anything containing it
 *
 *   Only the wildcard form works, and `*ada@example.com*` also matches
 *   `xada@example.com.attacker` — a DIFFERENT account. A login must never
 *   resolve identity by substring. There is a test for that below, and it is
 *   the most important one in this file.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

const TAG = 'lookup-476';
const WANTED = `${TAG}-ada@example.com`;

/** The legacy row: real roles, real registration, badly stored email. */
const LEGACY_ID = `${TAG}-legacy`;
/** A different account whose address CONTAINS the one being looked up. */
const ATTACKER_ID = `${TAG}-attacker`;

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
    await c.query(
        `insert into public.users (id, email, roles, raw_data) values
             ($1, $2, array['wave_participant','academy_participant'], $3::jsonb),
             ($4, $5, array['general_user'], '{}'::jsonb)`,
        [
            LEGACY_ID,
            `  ${TAG}-Ada@Example.COM `,
            JSON.stringify({
                fullName: 'Ada Obi',
                profileComplete: true,
                serviceRegistrations: { academy: { status: 'approved' } },
            }),
            ATTACKER_ID,
            `x${WANTED}.attacker`,
        ],
    );
}, 300_000);

afterAll(async () => {
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe("#476 — the query the login used could not see the person's profile", () => {
    it('THE EXACT MATCH FINDS NOTHING — the defect, reproduced', async () => {
        //   The premise. If this ever returns a row, the finding is wrong and
        //   somebody should re-read it rather than assume.
        const { rows } = await client!.query(
            `select id from public.users where email = $1`, [WANTED],
        );

        expect(rows).toEqual([]);
    });

    it('AND THE NORMALISED MATCH FINDS IT', async () => {
        const { rows } = await client!.query(
            `select id from find_users_by_normalised_email($1)`, [WANTED],
        );

        expect(rows.map((r: any) => r.id)).toEqual([LEGACY_ID]);
    });

    it('AND IT RETURNS THE REAL ROLES AND REGISTRATION, not a blank profile', async () => {
        //   The whole point. Finding *a* row is not enough — it has to be the
        //   row carrying what the person actually has, which is what the
        //   auto-provision branch was replacing with ['general_user'].
        const { rows } = await client!.query(
            `select u.roles, u.raw_data
               from find_users_by_normalised_email($1) f
               join public.users u on u.id = f.id`,
            [WANTED],
        );

        expect(rows[0].roles).toEqual(['wave_participant', 'academy_participant']);
        expect(rows[0].raw_data.fullName).toBe('Ada Obi');
        expect(rows[0].raw_data.serviceRegistrations.academy.status).toBe('approved');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#476 — and it does not match a different account', () => {
    it('A SUBSTRING MATCH IS REFUSED — the most important test here', async () => {
        //   `ilike.*ada@example.com*`, the only wildcard form that survives the
        //   stored spaces, ALSO matches xada@example.com.attacker. Resolving a
        //   login by substring would sign somebody into another person's
        //   account. This is why the fallback is an exact match on a normalised
        //   value rather than a fuzzy one.
        const { rows } = await client!.query(
            `select id from find_users_by_normalised_email($1)`, [WANTED],
        );

        expect(rows.map((r: any) => r.id)).not.toContain(ATTACKER_ID);
        expect(rows.length).toBe(1);
    });

    it('POSITIVE CONTROL: the substring account really is in the table', async () => {
        //   Without this, "not matched" could mean the row was never inserted
        //   and the control proves nothing.
        const { rows } = await client!.query(
            `select id from public.users where id = $1`, [ATTACKER_ID],
        );

        expect(rows.map((r: any) => r.id)).toEqual([ATTACKER_ID]);
    });

    it('AND THE WILDCARD FORM THAT WOULD HAVE MATCHED IT IS DEMONSTRABLY WRONG', async () => {
        //   Not hypothetical. This is the query the "obvious" ilike patch
        //   produces, run against the same two rows.
        const { rows } = await client!.query(
            `select id from public.users where email ilike '%' || $1 || '%' and id like $2`,
            [WANTED, `${TAG}-%`],
        );

        expect(rows.map((r: any) => r.id).sort()).toEqual([ATTACKER_ID, LEGACY_ID].sort());
    });

    it('and an unknown address finds nobody', async () => {
        const { rows } = await client!.query(
            `select id from find_users_by_normalised_email($1)`, ['nobody-at-all@example.com'],
        );

        expect(rows).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#476 — asked through the adapter the login actually calls', () => {
    it('findProfilesByEmail RESOLVES THE BADLY-STORED ROW', async () => {
        //   Source scanning cannot show this: the RPC has to exist, be visible
        //   to PostgREST, and come back in the shape auth.ts consumes. #473
        //   shipped a fix whose RPC failed on a stale schema cache while the
        //   fallback silently carried it, and everything else looked right.
        const { findProfilesByEmail } = await import('@/lib/profile-lookup');

        const found = await findProfilesByEmail(WANTED);

        expect(found.rows.map((r) => r.id)).toEqual([LEGACY_ID]);
        expect(found.viaFallback).toBe(true);
        expect(found.rows[0].data().fullName).toBe('Ada Obi');
    }, 300_000);

    it('AND A CORRECTLY STORED EMAIL STILL RESOLVES ON THE EXACT PATH', async () => {
        //   The common case must not start paying for the rare one, and
        //   viaFallback must not be true for it — the log line would be noise
        //   on every login.
        const { findProfilesByEmail } = await import('@/lib/profile-lookup');
        await client!.query(
            `insert into public.users (id, email, roles, raw_data) values ($1, $2, array['user'], '{}'::jsonb)`,
            [`${TAG}-clean`, `${TAG}-clean@example.com`],
        );

        const found = await findProfilesByEmail(`${TAG}-CLEAN@example.com`);

        expect(found.rows.map((r) => r.id)).toEqual([`${TAG}-clean`]);
        expect(found.viaFallback).toBe(false);
    }, 300_000);

    it('and an empty address asks the database nothing', async () => {
        const { findProfilesByEmail } = await import('@/lib/profile-lookup');

        expect(await findProfilesByEmail('')).toEqual({ rows: [], viaFallback: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#476 — the login uses it, and still refuses to guess', () => {
    const auth = () => readFileSync('src/lib/auth.ts', 'utf-8');

    it('THE EXACT-ONLY QUERY IS GONE FROM THE LOGIN', () => {
        expect(auth()).not.toContain(".where('email', '==', email.toLowerCase())");
        expect(auth()).toContain('findProfilesByEmail(email)');
    });

    it('AND A FALLBACK RESOLUTION IS LOGGED, not silent', () => {
        //   A login that quietly resolves this way hides that the data needs
        //   repairing. The owner should be able to find these people.
        expect(auth()).toContain('Profile found only by NORMALISED email');
    });

    it('AND THE AUTO-PROVISION BRANCH STILL EXISTS for a genuinely new user', () => {
        //   Control: a fix that removed it would break first-time login for
        //   everybody, and would satisfy both assertions above.
        const code = auth();

        expect(code).toContain('Auto-provisioning default profile');
        expect(code).toContain("roles: ['general_user']");
    });

    it('AND THE ARBITRARY docs[0] PICK IS STILL LOGGED AS AN ERROR', () => {
        //   #476 makes that branch far rarer; it does not remove it. Two rows
        //   genuinely unrelated to the auth account still resolve arbitrarily,
        //   and that must stay loud.
        expect(auth()).toContain('No profile identifies itself with the authenticated account');
    });

    it('and the migration is transaction-safe and reloads the schema cache', () => {
        const sql = readFileSync('supabase/migrations/030_find_users_by_normalised_email.sql', 'utf-8');

        expect(sql.replace(/^\s*--.*$/gm, ' ')).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
        expect(sql).toContain('lower(btrim(email))');
    });
});
