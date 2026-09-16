/**
 * @jest-environment node
 */

/**
 *   #814 THE ADMIN SEARCHED THE NAME ON THE SCREEN AND WAS TOLD NO SUCH PERSON.
 *
 *   Reported by the owner: "AISHAT Yahaya ABUBAKAR and other are registered
 *   with pending status and when searched they return user not found, why?"
 *
 *   The WAVE applications table builds each row's label from the APPLICATION:
 *
 *       if (app.surname || app.firstName)
 *           return `${app.surname} ${app.firstName}`.trim();
 *
 *   and the search resolved the query against the USERS collection, then
 *   fetched applications by `userId in (...)`. Two different records, two
 *   different names. An applicant writes her full legal name on the form; the
 *   account she registered with may carry a shorter one, a different spelling,
 *   or none of the three fields the user search reads.
 *
 *   So the admin read a name off a row, typed it into the box directly above
 *   that row, and was told there was no such person WHILE LOOKING AT HER. And
 *   the caller's early return made it final — no user matched, so the
 *   applications collection was never queried at all.
 *
 * ── AND PREFIXES ARE WHY EVEN THE RIGHT COLLECTION WOULD HAVE MISSED HER ────
 *
 *   These are prefix queries — `>= value` and `<= value + `. A prefix of
 *   the whole query only matches a field that STARTS with it. With her name
 *   spread across surname/firstName/otherNames, searching the SURNAME matches
 *   nothing unless each token is tried against each field, which is what
 *   searchDocIdsByNameFields does.
 *
 * ── EXECUTED AGAINST POSTGRES, NOT ASSERTED ABOUT SOURCE ────────────────────
 *
 *   A source-reading test would say "the action mentions searchDocIdsByNameFields"
 *   and pass against a call whose result is discarded — the #741 trap this
 *   audit has met ten times. This seeds the real row the owner described and
 *   runs the real search over it.
 *
 *       ./scripts/local-stack/up.sh
 *       LOCAL_PG_URL=postgres://postgres@127.0.0.1:54322/postgres npm run test:pg
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     tokenisation removed, whole query only                           KILLED
 *     the case variants reduced to the raw string                      KILLED
 *     the fields argument ignored, so nothing is searched              KILLED
 *     reword this header                                   SURVIVED, intended
 *
 *     the prefix range narrowed to an equality       SURVIVED the first draft
 *                              → then, two cases:                      KILLED
 *
 *   THE SURVIVOR IS THE ONE WORTH READING. Replacing
 *
 *       .where(field, "<=", value + "")      a PREFIX range
 *   with
 *       .where(field, "<=", value)                 an EQUALITY
 *
 *   left this suite entirely GREEN. Every name it searched for was a WHOLE
 *   TOKEN — "ABUBAKAR", "AISHAT", "Yahaya" — and a whole token matches itself
 *   just as happily under equality as under a prefix range. The tests were
 *   real, executed against Postgres, and blind to the difference between the
 *   feature and half of it.
 *
 *   An admin types half a surname far more often than all of it, so the
 *   narrowed version would have shipped as a working search that failed the
 *   moment somebody typed "Abuba". The two partial cases below close it.
 *
 *   A test can execute the right code against the right database and still only
 *   ever ask it the easy question.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from 'pg';
import { restDescribe, assertRestReachable } from '@/lib/testing/pg-harness';
import { searchDocIdsByNameFields } from '@/lib/admin-search-helper';

const REQUESTED = Boolean(process.env.LOCAL_PG_URL);
const URL = process.env.LOCAL_PG_URL ?? '';

let client: Client | null = null;

const TAG = 'namesearch-814';
const HER = `${TAG}-aishat`;
const OTHER = `${TAG}-unrelated`;

/**
 * The application's own name fields.
 *
 *   RUN AGAINST academy_applications, NOT wave_applications, and that is a
 *   property of the test database rather than a choice: the local stack's
 *   schema carries academy_applications and not wave_applications. Both
 *   collections had the SAME defect and took the SAME fix, so the mechanism
 *   under test — resolving a query against the record's own name fields rather
 *   than the account's — is the one that ships on both.
 *
 *   Stated here rather than left for a reader to notice, because a test that
 *   silently exercises a different table from the one its header names is the
 *   kind of half-truth this audit exists to remove.
 */
const NAME_FIELDS = ['personalInfo.surname', 'personalInfo.firstName', 'personalInfo.otherNames', 'personalInfo.fullName'];
const TABLE = 'academy_applications';

beforeAll(async () => {
    if (!REQUESTED) return;
    const c = new Client({ connectionString: URL, connectionTimeoutMillis: 5000 });
    await c.connect();
    client = c;

    await c.query(`delete from public.academy_applications where id like $1`, [`${TAG}-%`]);
    await c.query(`delete from public.users where id like $1`, [`${TAG}-%`]);

    /*
     *   THE ACCOUNT CARRIES A DIFFERENT NAME FROM THE APPLICATION, which is the
     *   whole finding. Searching "Abubakar" against USERS cannot find her —
     *   that name is not there.
     */
    await c.query(
        `insert into public.users (id, email, roles, raw_data) values
             ($1, $2, array['user'], '{"fullName":"J. Musa","firstName":"J.","lastName":"Musa"}'::jsonb),
             ($3, $4, array['user'], '{"fullName":"Unrelated Person"}'::jsonb)`,
        [HER, `${TAG}-aishat@example.com`, OTHER, `${TAG}-other@example.com`],
    );

    await c.query(
        `insert into public.academy_applications (id, user_id, status, raw_data) values
             ($1, $2, 'pending', $3::jsonb),
             ($4, $5, 'pending', $6::jsonb)`,
        [
            HER, HER,
            JSON.stringify({
                userId: HER, status: 'pending',
                personalInfo: { surname: 'ABUBAKAR', firstName: 'AISHAT', otherNames: 'Yahaya' },
            }),
            OTHER, OTHER,
            JSON.stringify({
                userId: OTHER, status: 'pending',
                personalInfo: { surname: 'OKAFOR', firstName: 'Chinwe', otherNames: '' },
            }),
        ],
    );
}, 300_000);

afterAll(async () => {
    await client?.query(`delete from public.academy_applications where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.query(`delete from public.users where id like $1`, [`${TAG}-%`]).catch(() => {});
    await client?.end().catch(() => {});
}, 300_000);

/** Only the rows this suite seeded — the table has others. */
const ours = (ids: string[]) => ids.filter((id) => id.startsWith(TAG)).sort();

// ─────────────────────────────────────────────────────────────────────────────
restDescribe('#814 — she is found by the name printed on her row', () => {
    beforeAll(assertRestReachable);

    it.each([
        ['her SURNAME, which is what an admin reads off the row', 'ABUBAKAR'],
        ['the surname in ordinary case', 'Abubakar'],
        ['her FIRST NAME', 'AISHAT'],
        ['her full name as the form recorded it', 'AISHAT Yahaya ABUBAKAR'],
        ['the middle name nobody searches by', 'Yahaya'],
        ['surname and first name, the way the table prints them', 'ABUBAKAR AISHAT'],
        /*
         *   A PARTIAL, which is the one that holds this to a prefix RANGE.
         *
         *   Every case above is a whole token, and every one of them would
         *   still pass if the upper bound were `value` instead of
         *   `value + ` — an equality dressed as a range. An admin types
         *   half a surname far more often than all of it.
         */
        ['half a surname, which is how people actually type', 'Abuba'],
        ['half a first name', 'AISH'],
    ])('FINDS HER BY %s', async (_label, query) => {
        /*
         *   Every one of these returned NOTHING before this finding: the search
         *   asked the users collection, where her name is "J. Musa".
         */
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, query));
        expect({ query, found: ids }).toEqual({ query, found: [HER] });
    }, 60_000);

    it('CONTROL: it does not return everybody', async () => {
        //   Or every assertion above would pass against a search that matches
        //   the whole table, which is not a search.
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'OKAFOR'));
        expect(ids).toEqual([OTHER]);
    }, 60_000);

    it('CONTROL: a name nobody has finds nobody', async () => {
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'Zzzznobody'));
        expect(ids).toEqual([]);
    }, 60_000);

    it('AND THE ACCOUNT NAME STILL WORKS — this widens the search, it does not move it', async () => {
        /*
         *   The user-side search is unchanged and still the other half of the
         *   union. Asserted here so a future edit cannot "fix" the application
         *   search by replacing the account search with it.
         */
        const { searchUserIdsByQuery } = await import('@/lib/admin-search-helper');
        const ids = ours(await searchUserIdsByQuery('Musa'));
        expect(ids).toEqual([HER]);
    }, 60_000);
});
