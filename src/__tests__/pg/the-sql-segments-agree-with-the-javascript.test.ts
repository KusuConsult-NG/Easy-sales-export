/**
 * @jest-environment node
 */

/**
 *   #473 THE ADMIN DASHBOARD DOWNLOADED THE ENTIRE USERS TABLE TO COUNT FOUR
 *   NUMBERS — AND THIS IS THE TEST THAT HAD TO PASS BEFORE THE FIX WAS WRITTEN.
 *
 *   calculateUserSegments() pages the whole users table over HTTP and classifies
 *   every row in JavaScript, to produce four totals. Measured through a real
 *   browser against real PostgREST: 51 simultaneous requests, 4.6 MB, on every
 *   cold /admin load.
 *
 *   MOVING THAT CLASSIFICATION INTO SQL IS THE OBVIOUS FIX AND THE DANGEROUS
 *   ONE. The four numbers are on the admin dashboard. If the SQL disagrees with
 *   the JavaScript by even one user, the dashboard quietly starts reporting
 *   something else, and nobody finds out from a page that renders fine. That is
 *   a worse defect than the slowness it cures.
 *
 *   So this suite classifies THE SAME USERS BOTH WAYS and fails on any single
 *   disagreement — not on totals, on each individual user, so a failure names
 *   the document rather than a difference of two.
 *
 *   THE ODDITIES ARE THE POINT. categorizeUser has asymmetries that look like
 *   mistakes and are load-bearing, because they decide real numbers today:
 *
 *     verificationProfile.bankDetails.bankName excludes the literal "N/A".
 *     bankDetails.bankName does NOT.                    (broadcast-logic.ts:30)
 *
 *     Same for address.state.                           (broadcast-logic.ts:31)
 *
 *     "suspended" is in neither the approved nor the pending list, so it falls
 *     through to hasStartedAny and counts as STALLED.
 *
 *   Every one has a case below. A "tidier" SQL rule that dropped them would pass
 *   a totals comparison on most data and change the dashboard on real data.
 *
 *   AND JAVASCRIPT TRUTHINESS IS NOT "IS PRESENT". `r.status && ...` treats
 *   null, false, 0 and "" as absent, while `->>'status'` renders false and 0 as
 *   the non-empty strings 'false' and '0'. jsonb_truthy() exists for that alone,
 *   and the cases below are what prove it.
 *
 *   ONE DIFFERENCE IS DELIBERATE AND IS ASSERTED AS SUCH: a null registration
 *   value makes categorizeUser THROW, and there is no try around the loop that
 *   calls it — so one malformed record blanks all four counters for everybody.
 *   The SQL does not throw. That case is tested for the SQL and documented
 *   rather than mirrored.
 *
 *   RUN AGAINST A LOCAL CLUSTER; skipped, loudly, without one:
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { categorizeUser } from '@/lib/broadcast-logic';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;
const dbDescribe: typeof describe = (REQUESTED ? describe : describe.skip) as typeof describe;

const TAG = 'seg-473';

/**
 * Every shape the rule distinguishes, and several it must NOT distinguish.
 *
 * Named, because a failure should say which rule broke rather than which array
 * index did.
 */
const CASES: Array<{ name: string; doc: any }> = [
    // ---- precedence -------------------------------------------------------
    { name: 'approved beats everything', doc: { serviceRegistrations: { wave: { status: 'approved' }, academy: { status: 'pending' } } } },
    { name: 'active is approved-equivalent', doc: { serviceRegistrations: { a: { status: 'active' } } } },
    { name: 'paid is approved-equivalent', doc: { serviceRegistrations: { a: { status: 'paid' } } } },
    { name: 'completed is approved-equivalent', doc: { serviceRegistrations: { a: { status: 'completed' } } } },
    { name: 'pending beats stalled', doc: { serviceRegistrations: { a: { status: 'pending' } }, bankDetails: { bankName: 'GTB' } } },
    { name: 'submitted is pending', doc: { serviceRegistrations: { a: { status: 'submitted' } } } },
    { name: 'under_review is pending', doc: { serviceRegistrations: { a: { status: 'under_review' } } } },
    { name: 'briefing is pending', doc: { serviceRegistrations: { a: { status: 'briefing' } } } },

    // ---- the fall-through that is easy to get wrong ------------------------
    { name: 'SUSPENDED falls through to stalled', doc: { serviceRegistrations: { a: { status: 'suspended' } } } },
    { name: 'rejected falls through to stalled', doc: { serviceRegistrations: { a: { status: 'rejected' } } } },
    { name: 'legacy_pending_onboarding falls through to stalled', doc: { serviceRegistrations: { a: { status: 'legacy_pending_onboarding' } } } },
    { name: 'not_started alone is NOT stalled', doc: { serviceRegistrations: { a: { status: 'not_started' } } } },

    // ---- the asymmetry, both halves, both fields ---------------------------
    { name: 'verificationProfile bank "N/A" does NOT count', doc: { verificationProfile: { bankDetails: { bankName: 'N/A' } } } },
    { name: 'verificationProfile bank real name counts', doc: { verificationProfile: { bankDetails: { bankName: 'Zenith' } } } },
    { name: 'top-level bank "N/A" DOES count — the asymmetry', doc: { bankDetails: { bankName: 'N/A' } } },
    { name: 'top-level bank real name counts', doc: { bankDetails: { bankName: 'Access' } } },
    { name: 'verificationProfile address "N/A" does NOT count', doc: { verificationProfile: { address: { state: 'N/A' } } } },
    { name: 'verificationProfile address real state counts', doc: { verificationProfile: { address: { state: 'Lagos' } } } },
    { name: 'top-level address "N/A" DOES count — the asymmetry', doc: { address: { state: 'N/A' } } },
    { name: 'top-level address real state counts', doc: { address: { state: 'Kano' } } },

    // ---- JavaScript truthiness, which "is present" would get wrong ---------
    { name: 'status "" is falsy', doc: { serviceRegistrations: { a: { status: '' } } } },
    { name: 'status false is falsy', doc: { serviceRegistrations: { a: { status: false } } } },
    { name: 'status 0 is falsy', doc: { serviceRegistrations: { a: { status: 0 } } } },
    { name: 'status "0" is TRUTHY — a non-empty string', doc: { serviceRegistrations: { a: { status: '0' } } } },
    { name: 'bankName "" is falsy', doc: { bankDetails: { bankName: '' } } },
    { name: 'bankName false is falsy', doc: { bankDetails: { bankName: false } } },
    { name: 'bankName 0 is falsy', doc: { bankDetails: { bankName: 0 } } },
    { name: 'state "" is falsy', doc: { address: { state: '' } } },

    // ---- ghosts ------------------------------------------------------------
    { name: 'empty document is a ghost', doc: {} },
    { name: 'empty registrations is a ghost', doc: { serviceRegistrations: {} } },
    { name: 'unrelated fields only is a ghost', doc: { fullName: 'Ada', email: 'a@b.c' } },
    { name: 'registration with no status at all is a ghost', doc: { serviceRegistrations: { a: { note: 'x' } } } },
    { name: 'empty bankDetails object is a ghost', doc: { bankDetails: {} } },
    { name: 'empty verificationProfile is a ghost', doc: { verificationProfile: {} } },

    // ---- shapes that must not throw or reclassify --------------------------
    { name: 'many registrations, one approved', doc: { serviceRegistrations: { a: { status: 'not_started' }, b: { status: 'rejected' }, c: { status: 'approved' } } } },
    { name: 'many registrations, none interesting', doc: { serviceRegistrations: { a: { status: 'not_started' }, b: { status: 'not_started' } } } },
    { name: 'bank present AND address present', doc: { bankDetails: { bankName: 'UBA' }, address: { state: 'Oyo' } } },
];

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
    for (let i = 0; i < CASES.length; i += 1) {
        await c.query(
            `insert into public.users (id, email, roles, raw_data) values ($1, $2, array['user'], $3::jsonb)`,
            [`${TAG}-${i}`, `${TAG}-${i}@example.com`, JSON.stringify(CASES[i].doc)],
        );
    }
}, 300_000);

afterAll(async () => {
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** The SQL rule's answer for one document. */
async function sqlSegment(doc: any): Promise<string> {
    const { rows } = await client!.query(`select user_segment($1::jsonb) as seg`, [JSON.stringify(doc)]);
    return rows[0].seg;
}

/** The JavaScript rule's answer, normalised to the same four words. */
const jsSegment = (doc: any): string => categorizeUser(doc).replace(/_users$/, '');

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#473 — the SQL rule and the JavaScript rule agree, user by user', () => {
    it('EVERY CASE CLASSIFIES IDENTICALLY', async () => {
        //   The assertion the whole change rests on. Reported as a list of
        //   disagreements rather than a first-failure, so one run says exactly
        //   which rules differ instead of one of them.
        const disagreements: string[] = [];

        for (const c of CASES) {
            const [sql, js] = [await sqlSegment(c.doc), jsSegment(c.doc)];
            if (sql !== js) disagreements.push(`${c.name}: sql=${sql} js=${js}`);
        }

        expect({ disagreements }).toEqual({ disagreements: [] });
    }, 300_000);

    it('AND THE FOUR TOTALS MATCH OVER THE SAME ROWS', async () => {
        //   Per-case agreement above could still be undone by the aggregate
        //   query — a wrong FILTER clause, a segment spelled differently in one
        //   place. This runs the real counting function over this suite's rows.
        const { rows } = await client!.query(
            `select
                 count(*) filter (where user_segment(raw_data) = 'active')::int  as active,
                 count(*) filter (where user_segment(raw_data) = 'pending')::int as pending,
                 count(*) filter (where user_segment(raw_data) = 'stalled')::int as stalled,
                 count(*) filter (where user_segment(raw_data) = 'ghost')::int   as ghost
               from public.users where id like $1`,
            [`${TAG}-%`],
        );

        const js = { active: 0, pending: 0, stalled: 0, ghost: 0 };
        for (const c of CASES) js[jsSegment(c.doc) as keyof typeof js] += 1;

        expect({ ...rows[0] }).toEqual(js);
    }, 300_000);

    it('POSITIVE CONTROL: all four segments actually occur here', async () => {
        //   Without this, a rule that answered "ghost" for everything would
        //   agree with a JavaScript rule that did the same, and both tests above
        //   would pass while measuring nothing.
        const seen = new Set(CASES.map((c) => jsSegment(c.doc)));

        expect([...seen].sort()).toEqual(['active', 'ghost', 'pending', 'stalled']);
    });

    it('POSITIVE CONTROL: the comparison can fail', async () => {
        //   A document the two rules genuinely classify differently would be a
        //   bug; a document only the SQL sees proves the harness is looking.
        //   'approved' must not read as a ghost under either rule.
        expect(await sqlSegment({ serviceRegistrations: { a: { status: 'approved' } } })).toBe('active');
        expect(await sqlSegment({})).toBe('ghost');
        expect(jsSegment({ serviceRegistrations: { a: { status: 'approved' } } })).toBe('active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#473 — count_user_segments returns what the classification says', () => {
    it('THE FUNCTION AGREES WITH COUNTING THE SAME ROWS BY HAND', async () => {
        // The whole table, not just this suite's rows — which is what the
        // dashboard asks for.
        const { rows: fn } = await client!.query('select * from count_user_segments()');
        const { rows: byHand } = await client!.query(
            `select
                 count(*) filter (where user_segment(raw_data) = 'active')  as active,
                 count(*) filter (where user_segment(raw_data) = 'pending') as pending,
                 count(*) filter (where user_segment(raw_data) = 'stalled') as stalled,
                 count(*) filter (where user_segment(raw_data) = 'ghost')   as ghost
               from public.users`,
        );

        expect({ ...fn[0] }).toEqual({ ...byHand[0] });
    }, 300_000);

    it('AND IT RETURNS EXACTLY ONE ROW WITH ALL FOUR SEGMENTS', async () => {
        // A segment missing from the result is indistinguishable, at the call
        // site, from a segment whose count is zero.
        const { rows } = await client!.query('select * from count_user_segments()');

        expect(rows.length).toBe(1);
        expect(Object.keys(rows[0]).sort()).toEqual(['active', 'ghost', 'pending', 'stalled']);
    }, 300_000);

    it('and every user in the table is in exactly one segment', async () => {
        // The four must partition the table: no user counted twice, none lost.
        const { rows } = await client!.query(
            `select (select count(*) from public.users)::int as total,
                    (select active + pending + stalled + ghost from count_user_segments())::int as summed`,
        );

        expect({ summed: rows[0].summed }).toEqual({ summed: rows[0].total });
    }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#473 — the one place they deliberately differ', () => {
    it('A NULL REGISTRATION MAKES THE JAVASCRIPT THROW, AND THE SQL DOES NOT', async () => {
        //   `Object.values(regs).some(r => r.status === ...)` on a null value
        //   raises TypeError, and calculateUserSegments has NO try around the
        //   loop — so one malformed record blanks all four counters for
        //   everybody. This is recorded rather than mirrored: the SQL gives the
        //   answer the JavaScript would give if it survived to give one.
        const doc = { serviceRegistrations: { wave: null } };

        expect(() => categorizeUser(doc)).toThrow();
        expect(await sqlSegment(doc)).toBe('ghost');
    }, 300_000);

    it('and a non-object serviceRegistrations does not error either', async () => {
        // jsonb_each rejects a non-object, so the function guards its input.
        expect(await sqlSegment({ serviceRegistrations: 'nonsense' })).toBe('ghost');
        expect(await sqlSegment({ serviceRegistrations: null })).toBe('ghost');
        expect(await sqlSegment({ serviceRegistrations: [1, 2] })).toBe('ghost');
    }, 300_000);
});
