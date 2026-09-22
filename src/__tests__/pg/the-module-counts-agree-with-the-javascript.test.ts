/**
 *   #909 — THE ONE-SCAN MODULE COUNTS SAY WHAT THE EIGHT QUERIES SAID.
 *
 *   migration 049 replaces eight `count: 'exact'` queries — each a sequential
 *   scan of `users` that detoasted the whole of `raw_data` per row — with one
 *   pass that produces all eight figures. Measured on a 42,845-row table with
 *   raw_data genuinely in TOAST:
 *
 *       one of the eight            129,642 buffers     162 ms
 *       eight, as the page ran    ~1,037,000 buffers   ~1.3 s
 *       count_module_registrations      1,262 buffers      42 ms
 *
 *   ── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
 *
 *   The status lists are now stated TWICE: in
 *   lib/module-registration-status.ts, and in the SQL. That is a real cost and
 *   it is accepted for the 822x, on one condition — that the duplication is
 *   held by a test rather than by care. This is that test, and it is the same
 *   arrangement #473 made for count_user_segments().
 *
 *   IT DOES NOT COMPARE TOTALS AGAINST HAND-WRITTEN NUMBERS. It rebuilds each
 *   of the eight predicates FROM THE TYPESCRIPT CONSTANTS, runs them as the
 *   old code did, and compares each against the function's figure over the same
 *   table. So a status added to ACTIVE_REGISTRATION_STATUSES and not to the SQL
 *   fails here, which is the only way this stays true.
 *
 *   Run with:
 *       ./scripts/local-postgres.sh start
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:55499/app npm run test:pg
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import {
    ACTIVE_REGISTRATION_STATUSES,
    SETTLED_REGISTRATION_STATUSES,
    IN_REVIEW_REGISTRATION_STATUSES,
} from '@/lib/module-registration-status';
import { dbDescribe as sharedDbDescribe } from '@/lib/testing/pg-harness';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';
const dbDescribe = sharedDbDescribe;

let client: Client | null = null;
const TAG = 'modcount-909';

/**
 * Enough rows that a table scan costs more than a page.
 *
 *   The cost assertion at the bottom compares the function against one bare
 *   count over the same table. The first version of this suite seeded nothing
 *   and compared whatever the table happened to hold: on a freshly-created
 *   cluster that is thirty rows on ONE page, where a scan costs one buffer and
 *   "one pass versus eight" is indistinguishable from noise. It passed against
 *   a cluster left over from manual measurement and failed against a clean
 *   one — which is a test that reports how it was run, not what the code does.
 *
 *   At roughly a kilobyte apiece these put the table over 250 pages: enough
 *   for eight passes to be unmissable, and under a second to insert. They
 *   carry a marketplace registration so they are not inert — they land in one
 *   of the eight buckets and are counted by both sides of the comparison.
 */
const BULK_ROWS = 2000;

/**
 * One fixture per thing the rule distinguishes, and several it must not.
 *
 * Named, so a failure says which rule broke rather than which array index did.
 */
const CASES: Array<{ name: string; roles: string[]; doc: any }> = [
    // ---- the plain registration path, one per module ------------------------
    { name: 'wave approved', roles: [], doc: { serviceRegistrations: { wave: { status: 'approved' } } } },
    { name: 'academy paid', roles: [], doc: { serviceRegistrations: { academy: { status: 'paid' } } } },
    { name: 'cooperatives active', roles: [], doc: { serviceRegistrations: { cooperatives: { status: 'active' } } } },
    { name: 'export pending_approval', roles: [], doc: { serviceRegistrations: { export: { status: 'pending_approval' } } } },
    { name: 'marketplace approved', roles: [], doc: { serviceRegistrations: { marketplace: { status: 'approved' } } } },

    // ---- the SECOND spellings, which are the ones that get forgotten -------
    { name: 'cooperative (singular) active', roles: [], doc: { serviceRegistrations: { cooperative: { status: 'active' } } } },
    { name: 'farm_nation (underscore) approved', roles: [], doc: { serviceRegistrations: { farm_nation: { status: 'approved' } } } },
    { name: 'farmNation (camel) approved', roles: [], doc: { serviceRegistrations: { farmNation: { status: 'approved' } } } },

    // ---- the cooperative partition: settled vs still in review -------------
    { name: 'cooperatives pending — onboarding, not settled', roles: [], doc: { serviceRegistrations: { cooperatives: { status: 'pending' } } } },
    { name: 'cooperative revision_required — onboarding', roles: [], doc: { serviceRegistrations: { cooperative: { status: 'revision_required' } } } },
    { name: 'cooperatives suspended — settled, per SETTLED list', roles: [], doc: { serviceRegistrations: { cooperatives: { status: 'suspended' } } } },

    // ---- the ROLES arm, every role each module accepts ---------------------
    { name: 'role wave_participant, no registration', roles: ['wave_participant'], doc: {} },
    { name: 'role academy_participant', roles: ['academy_participant'], doc: {} },
    { name: 'role cooperative_member', roles: ['cooperative_member'], doc: {} },
    { name: 'role farmer', roles: ['farmer'], doc: {} },
    { name: 'role land_owner', roles: ['land_owner'], doc: {} },
    { name: 'role investor', roles: ['investor'], doc: {} },
    { name: 'role export_participant', roles: ['export_participant'], doc: {} },
    { name: 'role seller', roles: ['seller'], doc: {} },
    { name: 'role marketplace_seller', roles: ['marketplace_seller'], doc: {} },
    { name: 'role buyer', roles: ['buyer'], doc: {} },
    { name: 'role marketplace_buyer', roles: ['marketplace_buyer'], doc: {} },

    // ---- counted ONCE when both arms match ---------------------------------
    { name: 'both arms: wave registration AND wave role', roles: ['wave_participant'], doc: { serviceRegistrations: { wave: { status: 'approved' } } } },
    { name: 'both arms: two farm nation roles at once', roles: ['farmer', 'investor'], doc: { serviceRegistrations: { farmNation: { status: 'approved' } } } },

    // ---- shapes that must NOT be counted -----------------------------------
    { name: 'status rejected is not active', roles: [], doc: { serviceRegistrations: { wave: { status: 'rejected' } } } },
    { name: 'status not_started is not active', roles: [], doc: { serviceRegistrations: { academy: { status: 'not_started' } } } },
    { name: 'registration with no status', roles: [], doc: { serviceRegistrations: { wave: { note: 'x' } } } },
    { name: 'empty registrations', roles: [], doc: { serviceRegistrations: {} } },
    { name: 'empty document', roles: [], doc: {} },
    { name: 'an unrelated role', roles: ['user'], doc: {} },
    { name: 'a role that only looks like one — farm-nation-seller', roles: ['farm-nation-seller'], doc: {} },
];

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);
    //   #673 A delete changes the population and does not tell the planner.
    //   This one clears a previous run's rows; the analyse after seeding below
    //   is the one that describes the table this suite measures.
    await c.query('analyze public.users');

    for (let i = 0; i < CASES.length; i += 1) {
        await c.query(
            `insert into public.users (id, email, roles, raw_data) values ($1, $2, $3::text[], $4::jsonb)`,
            [`${TAG}-${i}`, `${TAG}-${i}@example.com`, CASES[i].roles, JSON.stringify(CASES[i].doc)],
        );
    }

    //   BULK_ROWS — see the note above the constant.
    await c.query(
        `insert into public.users (id, email, roles, raw_data)
         select $1 || g, $1 || g || '@example.com', array['user']::text[],
                jsonb_build_object(
                    'bio', repeat(md5(g::text), 30),
                    'serviceRegistrations',
                        jsonb_build_object('marketplace', jsonb_build_object('status', 'approved'))
                )
         from generate_series(1, $2::int) g`,
        [`${TAG}-bulk-`, BULK_ROWS],
    );
    await c.query('analyze public.users');
}, 300_000);

afterAll(async () => {
    /*
     *   #673 — AND RE-ANALYSE, because a DELETE does not tell the planner.
     *
     *   This suite inserts BULK_ROWS and analyses, so leaving without
     *   re-analysing hands every later suite statistics that describe a table
     *   two thousand rows larger than the one they are querying — which is how
     *   a cost assertion in another file starts failing for reasons that have
     *   nothing to do with it. The repo has a ratchet for exactly this, and it
     *   caught this suite.
     */
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.query('analyze public.users').catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** A SQL IN-list literal from a TypeScript array. */
const inList = (xs: readonly string[]) => xs.map((s) => `'${s}'`).join(', ');
/** A SQL text[] literal from a TypeScript array. */
const arr = (xs: readonly string[]) => `ARRAY[${inList(xs)}]::text[]`;

/**
 * The eight predicates, rebuilt from the TypeScript constants — the same ORs
 * analytics.service sent as eight PostgREST queries, over `raw_data` exactly as
 * it did.
 *
 * `service_regs` is NOT used here on purpose: the point of the comparison is
 * that the function's narrow-column read agrees with the wide-column read the
 * application used to do. 045 argues they are the same value by construction;
 * this checks it rather than trusting it.
 */
const ALL = inList(ACTIVE_REGISTRATION_STATUSES);
const SETTLED = inList(SETTLED_REGISTRATION_STATUSES);
const IN_REVIEW = inList(IN_REVIEW_REGISTRATION_STATUSES);
const reg = (key: string, list: string) =>
    `raw_data->'serviceRegistrations'->'${key}'->>'status' IN (${list})`;

const PREDICATES: Record<string, string> = {
    wave: `${reg('wave', ALL)} OR roles @> ARRAY['wave_participant']::text[]`,
    academy: `${reg('academy', ALL)} OR roles @> ARRAY['academy_participant']::text[]`,
    cooperatives:
        `${reg('cooperatives', SETTLED)} OR ${reg('cooperative', SETTLED)} ` +
        `OR roles @> ARRAY['cooperative_member']::text[]`,
    cooperative_onboarding:
        `${reg('cooperatives', IN_REVIEW)} OR ${reg('cooperative', IN_REVIEW)}`,
    farm_nation:
        `${reg('farmNation', ALL)} OR ${reg('farm_nation', ALL)} ` +
        `OR roles && ${arr(['farmer', 'land_owner', 'investor'])}`,
    export_hub: `${reg('export', ALL)} OR roles @> ARRAY['export_participant']::text[]`,
    export_onboarding: reg('export', inList(['pending', 'pending_approval', 'under_review', 'revision_required'])),
    marketplace:
        `${reg('marketplace', ALL)} ` +
        `OR roles && ${arr(['seller', 'marketplace_seller', 'buyer', 'marketplace_buyer'])}`,
};

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#909 — one scan says what eight scans said', () => {
    it('THE FUNCTION EXISTS — apply migration 049', async () => {
        const { rows } = await client!.query(
            `select 1 from pg_proc where proname = 'count_module_registrations'`,
        );
        expect({ found: rows.length }).toEqual({ found: 1 });
    }, 300_000);

    it('EVERY ONE OF THE EIGHT FIGURES AGREES, over the whole table', async () => {
        /*
         *   Reported as a list of disagreements rather than a first-failure, so
         *   one run says exactly which modules differ instead of one of them.
         */
        const { rows } = await client!.query(`select * from count_module_registrations()`);
        const fromFunction = rows[0];

        const disagreements: string[] = [];
        for (const [key, predicate] of Object.entries(PREDICATES)) {
            const { rows: r } = await client!.query(
                `select count(*)::int as n from public.users where ${predicate}`,
            );
            const eightQueryAnswer = r[0].n;
            const oneScanAnswer = Number(fromFunction[key]);
            if (eightQueryAnswer !== oneScanAnswer) {
                disagreements.push(`${key}: eight-query=${eightQueryAnswer} one-scan=${oneScanAnswer}`);
            }
        }

        expect({ disagreements }).toEqual({ disagreements: [] });
    }, 300_000);

    it('AND EVERY FIGURE IS NON-ZERO — the vacuity guard', async () => {
        /*
         *   THE control. A function returning eight zeros agrees perfectly with
         *   eight predicates that match nothing, and this suite's fixtures
         *   exist to make each bucket non-empty. If one reads zero, either the
         *   fixtures did not land or that module's rule matches nothing at all
         *   — and the agreement above is worth nothing for it.
         */
        const { rows } = await client!.query(`select * from count_module_registrations()`);
        const zero = Object.entries(rows[0])
            .filter(([, v]) => Number(v) === 0)
            .map(([k]) => k);

        expect({ figuresReadingZero: zero }).toEqual({ figuresReadingZero: [] });
    }, 300_000);

    it('AND IT READS service_regs RATHER THAN raw_data — 044/045\'s finding', async () => {
        /*
         *   The whole 822x. Reading through `raw_data` detoasts ~2.5 kB per row
         *   to get one short string; `service_regs` is GENERATED ALWAYS from
         *   the same expression and sits inline on the heap page the scan is
         *   already holding.
         *
         *   Asserted on the function's own body in the catalogue, not on the
         *   migration file, so a later hand-edit in the database cannot pass.
         */
        const { rows } = await client!.query(
            `select prosrc from pg_proc where proname = 'count_module_registrations'`,
        );
        const body: string = rows[0].prosrc;

        expect(body).toContain('service_regs');
        expect(body).not.toContain(`raw_data -> 'serviceRegistrations'`);
        expect(body).not.toContain(`raw_data->'serviceRegistrations'`);
    }, 300_000);

    it('AND IT COSTS ONE PASS OVER users, not eight — measured', async () => {
        /*
         *   A function that produced the right numbers by running eight
         *   subqueries would satisfy every assertion above and save nothing.
         *
         *   THE PLAN CANNOT BE READ FOR THIS. A set-returning SQL function
         *   called in FROM shows up as a bare `Function Scan`; the inner plan
         *   is not exposed, so counting "Relation Name":"users" in the JSON
         *   returns ZERO however many scans happen inside. Measured, and that
         *   is what the first version of this test asserted against.
         *
         *   BUFFERS ARE EXPOSED, and they are the thing that actually costs.
         *   So this compares the function against a single bare count over the
         *   same table: one pass is ~1x, eight would be ~8x. The ratio is the
         *   assertion, not an absolute number, so it holds at any table size.
         */
        const buffersOf = async (sql: string): Promise<number> => {
            const { rows } = await client!.query(`explain (analyze, buffers, format json) ${sql}`);
            const plan = JSON.stringify(rows[0]['QUERY PLAN']);
            //   Every "Shared Hit Blocks"/"Shared Read Blocks" in the plan tree,
            //   summed — nested nodes double-count upwards, so the TOP node's
            //   figure is the total. It is the first of each in the JSON.
            const hit = Number(/"Shared Hit Blocks": ?(\d+)/.exec(plan)?.[1] ?? 0);
            const read = Number(/"Shared Read Blocks": ?(\d+)/.exec(plan)?.[1] ?? 0);
            return hit + read;
        };

        /*
         *   THE BASELINE HAS TO READ THE HEAP, and `select count(*) from users`
         *   does not. Measured: the planner serves it from an INDEX ONLY SCAN
         *   at 43 buffers against 2,453 for a real pass, so comparing against
         *   it says the function costs 70x a scan — which is false, and was the
         *   first version of this assertion.
         *
         *   `where service_regs is not null` cannot be answered from an index
         *   here, so it is one sequential pass over the same column the
         *   function reads. That is the honest unit.
         */
        const onePass = await buffersOf(
            'select count(*) from public.users where service_regs is not null',
        );
        const theFunction = await buffersOf('select * from count_module_registrations()');

        //   Generous: index-only paths and the roles column shift this a little.
        //   Eight passes cannot hide under 3x.
        expect({
            onePass,
            theFunction,
            withinThreePasses: theFunction < onePass * 3,
        }).toMatchObject({ withinThreePasses: true });

        //   AND the baseline really read the table. On a near-empty table both
        //   figures are 1 and the ratio means nothing, which is exactly how the
        //   first version of this test passed on a seeded cluster and failed on
        //   a fresh one. BULK_ROWS is what makes this hold either way.
        expect(onePass).toBeGreaterThan(100);
        //   And the function is not free either — a figure of 0 would mean the
        //   plan was not measured at all and the ratio is vacuous.
        expect(theFunction).toBeGreaterThan(100);
    }, 300_000);
});
