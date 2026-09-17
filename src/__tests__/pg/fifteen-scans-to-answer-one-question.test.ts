/**
 * @jest-environment node
 */

/**
 *   #850 THE FIX FOR #835 READ THE USERS TABLE FIFTEEN TIMES TO ANSWER ONE
 *   QUESTION, AND I SHIPPED IT.
 *
 *   lib/module-applicant-count issues one `count()` per bucket per registration
 *   key spelling, plus one per overlapping pair:
 *
 *       5 buckets x 1 key                =  5 queries   wave, academy, export,
 *                                                       marketplace
 *       5 buckets x (2 keys + 1 overlap) = 15 queries   cooperative, farmNation
 *
 *   Each filters `raw_data->serviceRegistrations-><key>->>'status'`, which no
 *   index serves, so each is a full scan of `users`. Five admin surfaces call
 *   it, and #835 is ALREADY DEPLOYED — before it, that screen counted rows in a
 *   dedicated indexed table.
 *
 *   The production log shows LOGINS timing out on `where("email","==",…)
 *   limit 1` — an indexed native column. A cheap query timing out is what a
 *   saturated database looks like. THIS FILE DOES NOT CLAIM TO BE THE CAUSE OF
 *   THAT, and the claim is available to make cheaply, which is exactly why it is
 *   refused: 022's header drew the same line and #841 is the record of what
 *   happens when a plausible cause is adopted without measurement — three
 *   diagnoses, all wrong, all reasoned from source.
 *
 *   What is certain: this is a large, repeated, uncached load that did not exist
 *   three weeks ago, that I added, and that one scan can replace.
 *
 * ── WHAT THIS SUITE HAS TO PROVE, AND IT IS NOT "IT IS FASTER" ──────────────
 *
 *   A faster count that answers differently is a worse defect than a slow one.
 *   So the central case runs BOTH paths over the same rows and asserts they
 *   agree bucket for bucket — the new one-scan rollup against the literal
 *   fifteen-query arithmetic, written out in SQL from the same status lists the
 *   application uses.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';
import {
    APPROVED_STATUSES, PENDING_STATUSES, REJECTED_STATUSES, REVISION_STATUSES,
    bucketStatusSets,
} from '@/lib/module-applicant-count';
import { NOT_STARTED_STATUSES } from '@/lib/module-registration-status';

const URL = PG_URL;
const REQUESTED = Boolean(URL);

let client: Client | null = null;

const TAG = 'rollup-850';
const KEYS = ['cooperative', 'cooperatives'];

/**
 * The production cooperative mix, scaled down but in proportion — and with the
 * two shapes that make the arithmetic non-trivial deliberately included.
 */
const MIX: Array<{ coop: string | null; coops: string | null; n: number }> = [
    //   The ordinary case: BOTH spellings, same value. 36,662 accounts in
    //   production, and the reason a SUM over spellings double-counts.
    { coop: 'not_started', coops: 'not_started', n: 3357 },
    { coop: 'pending', coops: 'pending', n: 163 },
    { coop: 'active', coops: 'active', n: 125 },
    { coop: 'approved', coops: 'approved', n: 16 },
    { coop: 'pending_repair', coops: 'pending_repair', n: 31 },
    { coop: 'legacy_pending_onboarding', coops: 'legacy_pending_onboarding', n: 8 },
    //   One spelling only — 19 and 24 accounts in production.
    { coop: null, coops: 'approved', n: 19 },
    { coop: 'pending', coops: null, n: 24 },
    /*
     *   THE SHAPE THE ARRAY EXISTS FOR: the two spellings DISAGREE. Under the
     *   old arithmetic this account is in |A| for one bucket and |B| for
     *   another, and the pairwise subtraction only removes it where both match.
     *   Under the rollup it is one row carrying {approved,not_started}.
     *
     *   It must count as an APPLICANT — it has applied under one spelling — and
     *   as approved. Not measured in production; included because the
     *   arithmetic differs here and nowhere else, so an untested disagreement
     *   would be invisible until it appeared in the data.
     */
    { coop: 'not_started', coops: 'approved', n: 7 },
    { coop: 'rejected', coops: 'not_started', n: 5 },
    //   No cooperative registration at all — must not appear anywhere.
    { coop: null, coops: null, n: 200 },
];

const inList = (xs: readonly string[]) => xs.map((s) => `'${s}'`).join(',');

const clearProbeRows = async () => {
    await client!.query('delete from public.users where id like $1', [`${TAG}-%`]);
    //   Vacuumed for the reason the-marketplace-page-counted-every-user records:
    //   dead tuples keep their PAGES, and `relpages` feeds every plan the next
    //   suite measures.
    await client!.query('vacuum analyze public.users');
};

const seedProbeRows = async () => {
    let i = 0;
    for (const { coop, coops, n } of MIX) {
        const reg: Record<string, unknown> = {};
        if (coop) reg.cooperative = { status: coop };
        if (coops) reg.cooperatives = { status: coops };

        await client!.query(
            `insert into public.users (id, email, raw_data)
             select $1 || '-' || g,
                    $1 || '-' || g || '@example.com',
                    jsonb_build_object(
                      'serviceRegistrations', $2::jsonb,
                      'createdAt', '2001-06-01T00:00:00.000Z',
                      'fullName', 'Probe'
                    )
               from generate_series($3::int, $4::int) g`,
            [TAG, JSON.stringify(reg), i + 1, i + n],
        );
        i += n;
    }
    await client!.query('analyze public.users');
};

/** The rollup, exactly as lib/module-applicant-count calls it. */
const rollup = async () => {
    const { rows } = await client!.query(
        'select statuses, people from module_registration_counts($1::text[], $2)',
        [KEYS, null],
    );
    return bucketStatusSets(rows as Array<{ statuses: string[]; people: string }>);
};

/**
 * The OLD arithmetic, in SQL.
 *
 *   `bucketCount` computes |A| + |B| − |A ∩ B|, which is |A ∪ B| — so the
 *   fifteen queries' answer for a bucket is a single OR over the two spellings.
 *   Written that way here so the comparison is against what the old code
 *   COMPUTES rather than against a re-implementation of how it computes it.
 */
const legacyBucket = async (predicate: (path: string) => string) => {
    const or = KEYS.map((k) =>
        predicate(`(raw_data->'serviceRegistrations'->'${k}'->>'status')`),
    ).join(' OR ');
    /*
     *   NO `id like TAG-%` FILTER, and the first version of this helper had one.
     *   The function under test reads the WHOLE table, so scoping only this side
     *   compares two different populations: the local stack already holds two
     *   seeded cooperative members, and every case built on the comparison was
     *   out by exactly two. The fixture-derived expectations below add the
     *   baseline for the same reason.
     */
    const { rows } = await client!.query(
        `select count(*)::int as n from public.users where ${or}`,
    );
    return rows[0].n as number;
};

/** Whatever the stack already held before this suite seeded anything. */
let baseline = { total: 0, approved: 0, revisionRequired: 0, withReg: 0 };

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;
    await clearProbeRows();

    //   Measured BEFORE seeding, so the expectations below describe what this
    //   fixture adds rather than assuming the table starts empty.
    const before = await rollup();
    const withRegRow = await client.query(
        `select coalesce(sum(people), 0)::int as n
           from module_registration_counts($1::text[], null)`,
        [KEYS],
    );
    baseline = {
        total: before.total ?? 0,
        approved: before.approved ?? 0,
        revisionRequired: before.revisionRequired ?? 0,
        withReg: withRegRow.rows[0].n,
    };

    await seedProbeRows();
}, 300_000);

afterAll(async () => {
    if (client) await clearProbeRows().catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#850 — one scan answers what fifteen did, identically', () => {
    it('THE PROBE ROWS ARE REALLY THERE — the vacuity guard', async () => {
        const expected = MIX.reduce((a, m) => a + m.n, 0);
        const { rows } = await client!.query(
            'select count(*)::int as n from public.users where id like $1',
            [`${TAG}-%`],
        );
        expect(rows[0].n).toBe(expected);
    });

    it('THE FUNCTION EXISTS — migration 039', async () => {
        const { rows } = await client!.query(
            `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'module_registration_counts'`,
        );
        expect(rows.length).toBe(1);
    });

    it('THE CENTRAL CASE: every bucket agrees with the fifteen-query arithmetic', async () => {
        const viaRollup = await rollup();

        const viaLegacy = {
            //   #841's `total`: has a status, and it is not one that means
            //   "never began".
            total: await legacyBucket((p) =>
                `${p} IS NOT NULL AND ${p} NOT IN (${inList(NOT_STARTED_STATUSES)})`),
            approved: await legacyBucket((p) => `${p} IN (${inList(APPROVED_STATUSES)})`),
            pending: await legacyBucket((p) => `${p} IN (${inList(PENDING_STATUSES)})`),
            rejected: await legacyBucket((p) => `${p} IN (${inList(REJECTED_STATUSES)})`),
            revisionRequired: await legacyBucket((p) => `${p} IN (${inList(REVISION_STATUSES)})`),
        };

        expect({
            total: viaRollup.total,
            approved: viaRollup.approved,
            pending: viaRollup.pending,
            rejected: viaRollup.rejected,
            revisionRequired: viaRollup.revisionRequired,
        }).toEqual(viaLegacy);
    });

    it('AND THE NUMBERS ARE THE ONES THE FIXTURE DESCRIBES, not merely equal', async () => {
        /*
         *   The vacuity guard for the case above: two paths that both returned
         *   zero would agree perfectly. Derived from MIX rather than pasted, so
         *   a change to the fixture cannot leave a stale expectation behind.
         */
        const c = await rollup();

        const has = (m: typeof MIX[number], xs: readonly string[]) =>
            (m.coop !== null && xs.includes(m.coop)) || (m.coops !== null && xs.includes(m.coops));
        const sum = (f: (m: typeof MIX[number]) => boolean) =>
            MIX.filter(f).reduce((a, m) => a + m.n, 0);

        expect(c.total).toBe(baseline.total + sum((m) =>
            (m.coop !== null && !NOT_STARTED_STATUSES.includes(m.coop as never))
            || (m.coops !== null && !NOT_STARTED_STATUSES.includes(m.coops as never))));
        expect(c.approved).toBe(baseline.approved + sum((m) => has(m, APPROVED_STATUSES)));
        expect(c.revisionRequired).toBe(
            baseline.revisionRequired + sum((m) => has(m, REVISION_STATUSES)));

        //   Nobody is unplaceable — #847's property, preserved by the new path.
        expect(c.other).toBe(0);
        expect(c.total).toBeGreaterThan(0);
    });

    it('AND AN ACCOUNT WHOSE TWO SPELLINGS DISAGREE IS COUNTED ONCE', async () => {
        /*
         *   The row the array shape exists for. Seven accounts carry
         *   `not_started` under one spelling and `approved` under the other.
         *   They have applied, so they are in `total` and in `approved` — and
         *   they are SEVEN people, not fourteen, which is what a sum over
         *   spellings would have made them.
         */
        const { rows } = await client!.query(
            `select statuses, people::int as people from module_registration_counts($1::text[], null)
              where statuses @> ARRAY['approved','not_started']::text[]
                and array_length(statuses, 1) = 2`,
            [KEYS],
        );

        expect(rows.length).toBe(1);
        expect(rows[0].people).toBe(7);
    });

    it('AND AN ACCOUNT WITH NO COOPERATIVE REGISTRATION IS NOT A ROW AT ALL', async () => {
        //   200 seeded with neither key. If they appeared as an empty or null
        //   array they would be a bucket nobody named.
        const { rows } = await client!.query(
            `select coalesce(sum(people), 0)::int as n
               from module_registration_counts($1::text[], null)`,
            [KEYS],
        );
        const withReg = MIX.filter((m) => m.coop || m.coops).reduce((a, m) => a + m.n, 0);

        expect(rows[0].n).toBe(baseline.withReg + withReg);
    });

    it('AND IT READS THE TABLE ONCE, which is the whole finding', async () => {
        /*
         *   Asserted as the number of scans in the plan, not as elapsed time —
         *   a duration is a property of the machine, which is the mistake #848's
         *   suite made and had to withdraw after CI disagreed with this box.
         *
         *   One Seq Scan is the expected plan and is not a defect: the `total`
         *   bucket's `<>` cannot use a btree index at all (measured: 3,475
         *   buffers with an expression index and without it). The finding was
         *   never that the scan is avoidable — it is that there were fifteen.
         */
        const { rows } = await client!.query(
            `explain (format json) select * from module_registration_counts($1::text[], null)`,
            [KEYS],
        );
        const plan = JSON.stringify(rows[0]['QUERY PLAN']);
        const scans = (plan.match(/"Relation Name":"users"/g) ?? []).length;

        expect(scans).toBe(1);
    });

    it('AND THE since FILTER NARROWS THE SAME WAY THE QUERY PATH DOES', async () => {
        /*
         *   Parity on the filter too, because the function receives an ISO
         *   string and compares it against `raw_data->>'createdAt'` as TEXT —
         *   which is what `where("createdAt", ">=", date)` resolves to, since
         *   `createdAt` is not in users' FIELD_TO_COLUMN and the native column is
         *   spelled `created_at`. Lexicographic ordering of ISO-8601 UTC strings
         *   is chronological, so it is correct; this proves it is also the SAME.
         */
        const since = async (iso: string | null) => {
            const { rows } = await client!.query(
                `select coalesce(sum(people), 0)::int as n
                   from module_registration_counts($1::text[], $2)`,
                [KEYS, iso],
            );
            return rows[0].n as number;
        };

        const withReg = MIX.filter((m) => m.coop || m.coops).reduce((a, m) => a + m.n, 0);

        /*
         *   THE FIXTURE IS DATED 2001 ON PURPOSE, and the first version was not.
         *   It carried 2026-09-01 and asserted the difference between a window
         *   opening in 2026-08 and one opening in 2026-12 — which is the fixture
         *   PLUS whatever else the stack happened to have created between those
         *   dates. The local seed's two cooperative members are dated
         *   2026-09-12, so they fell inside the interval and the case was out by
         *   two: a hardcoded window silently depending on the stack's history,
         *   which is what a delta is supposed to avoid.
         *
         *   Bounding the interval around a year nothing else uses makes the
         *   baseline cancel — it is outside both terms — so the difference is
         *   this fixture and nothing else.
         */
        const opensBefore = await since('2000-01-01T00:00:00.000Z');
        const opensAfter = await since('2002-01-01T00:00:00.000Z');

        expect(opensBefore - opensAfter).toBe(withReg);
        //   And an absent filter is not an empty one — the two are different
        //   questions, and `p_since_iso IS NULL` is what keeps them apart.
        expect(await since(null)).toBe(baseline.withReg + withReg);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#850 — the bucketing is arithmetic, and is executed as such', () => {
    /**
     *   No database. bucketStatusSets is a pure function over the rows the scan
     *   returns, and the shapes that break it are easier to state directly than
     *   to seed.
     */
    it('COUNTS FROM POSTGRES ARRIVE AS STRINGS, and are not concatenated', () => {
        /*
         *   `count(*)::bigint` comes back as "14668" through PostgREST, because
         *   a bigint does not fit a JavaScript number safely and the driver
         *   refuses to guess. `total += row.people` would produce "014668".
         *   supabase-db's aggregate helpers coerce for this reason; this path is
         *   new and had to do it too.
         */
        const c = bucketStatusSets([
            { statuses: ['approved'], people: '14668' },
            { statuses: ['pending'], people: '5083' },
        ]);

        expect(c.total).toBe(19751);
        expect(c.approved).toBe(14668);
        expect(c.pending).toBe(5083);
    });

    it('AND not_started IS NOT AN APPLICATION — #841, on this path too', () => {
        const c = bucketStatusSets([
            { statuses: ['approved'], people: 169 },
            { statuses: ['not_started'], people: 33576 },
        ]);

        expect(c.total).toBe(169);
        expect(c.other).toBe(0);
    });

    it('BUT AN ACCOUNT THAT IS not_started UNDER ONE SPELLING AND APPLIED UNDER THE OTHER COUNTS', () => {
        /*
         *   The reason `total` tests "has a status that is not not_started"
         *   rather than "does not have not_started". Reversing those two reads
         *   identically in English and drops this account.
         */
        const c = bucketStatusSets([{ statuses: ['approved', 'not_started'], people: 7 }]);

        expect(c.total).toBe(7);
        expect(c.approved).toBe(7);
    });

    it('AND AN UNKNOWN STATUS IS VISIBLE IN `other` RATHER THAN MISSING', () => {
        /*
         *   #824's property. `not_started`, `legacy_pending_onboarding` and
         *   `pending_repair` were all added to this platform's vocabulary while
         *   this audit was running, so the next one is not hypothetical — it
         *   must land somewhere a reader can see.
         */
        const c = bucketStatusSets([{ statuses: ['a_status_nobody_has_invented'], people: 4 }]);

        expect({ total: c.total, other: c.other }).toEqual({ total: 4, other: 4 });
    });

    it('AND AN EMPTY OR NULL ROW CONTRIBUTES NOTHING', () => {
        const c = bucketStatusSets([
            { statuses: null, people: 99 },
            { statuses: [], people: 99 },
            { statuses: ['approved'], people: null },
            { statuses: ['approved'], people: 3 },
        ]);

        expect({ total: c.total, approved: c.approved }).toEqual({ total: 3, approved: 3 });
    });

    it('AND NO ROWS IS ZERO AND COUNTED, not a failure', () => {
        //   The distinction #753 exists for: "nil" and "not measured" must not
        //   render alike. An empty scan is a measurement.
        const c = bucketStatusSets([]);

        expect({ total: c.total, counted: c.counted }).toEqual({ total: 0, counted: true });
    });
});
