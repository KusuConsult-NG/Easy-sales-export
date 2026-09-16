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
 *
 * ── AND THEN THOSE TWO CASES WENT RED IN CI, ON THE SAME CODE ───────────────
 *
 *   They passed here and failed on the CI database. Only the PARTIAL cases —
 *   "Abuba", "AISH"; every whole-name case passed on both.
 *
 *   The upper bound was `value + ""`, the idiom searchUserIdsByQuery has
 *   always used. U+F8FF is a PRIVATE-USE code point: a byte-ordered collation
 *   sorts it above every letter and the range works, while a locale-aware
 *   collation (en_US.UTF-8, ICU) may treat an unassigned private-use character
 *   as IGNORABLE — collapsing "ABUBA" to "ABUBA", which makes
 *   `"ABUBAKAR" <= "ABUBA"` false. A whole-name query never noticed, because
 *   its lower bound alone matched.
 *
 *   So the suite was right, the code was environment-dependent, and the two
 *   machines disagreed. The bound is `< prefixUpperBound(value)` now —
 *   "ABUBA" bounds at "ABUBB" — which compares two ordinary letters and means
 *   the same thing under either collation.
 *
 *   THE LESSON IS THE ONE THIS FILE KEEPS TEACHING: passing locally is not
 *   passing. The assertion was sound and the environment was the variable.
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

    /*
     *   #832 — two more rows, for the question a prefix range cannot answer.
     *
     *   LEGACY carries ONE combined string the way a bulk import writes it, so
     *   her surname sits in the MIDDLE of it and no prefix of the query matches
     *   the field. WILDCARD exists to prove the escaping: a name holding a
     *   literal `%` must not become a pattern meaning "anything".
     */
    await c.query(
        `insert into public.users (id, email, roles, raw_data) values
             ($1, $2, array['user'], '{"fullName":"L. Import"}'::jsonb),
             ($3, $4, array['user'], '{"fullName":"P. Cent"}'::jsonb)`,
        [LEGACY, `${TAG}-legacy@example.com`, WILDCARD, `${TAG}-wild@example.com`],
    );
    await c.query(
        `insert into public.academy_applications (id, user_id, status, raw_data) values
             ($1, $2, 'pending', $3::jsonb),
             ($4, $5, 'pending', $6::jsonb)`,
        [
            LEGACY, LEGACY,
            JSON.stringify({
                userId: LEGACY, status: 'pending',
                personalInfo: { fullName: 'NGOZI ELEDUMARE' },
            }),
            WILDCARD, WILDCARD,
            JSON.stringify({
                userId: WILDCARD, status: 'pending',
                personalInfo: { fullName: '100% Cotton Ltd' },
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
/** #832 — the combined-name row, and the one with a wildcard in its name. */
const LEGACY = `${TAG}-legacy`;
const WILDCARD = `${TAG}-wild`;

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

// ─────────────────────────────────────────────────────────────────────────────
restDescribe('#832 — a surname in the MIDDLE of a combined name', () => {
    beforeAll(assertRestReachable);

    /**
     *   THE BOUND #825 RECORDED AND LEFT OPEN.
     *
     *   `searchDocIdsByNameFields` worked by PREFIX RANGE, and a prefix only
     *   matches a field that STARTS with the term. A member whose name the bulk
     *   import wrote as one string — `fullName: "NGOZI ELEDUMARE"` — was
     *   therefore not findable by her SURNAME, which is how most administrators
     *   search. #825 said closing it needed `ilike` on the data layer that
     *   everything shares, or a written name-token index, and that neither was
     *   a change to make on local evidence alone.
     *
     *   The adapter has `ilike` now, and this is the evidence: executed against
     *   real PostgREST and real Postgres, not against the fake.
     */

    it('FINDS HER BY THE SURNAME, WHICH IS NOT A PREFIX OF THE FIELD', async () => {
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'ELEDUMARE'));
        expect(ids).toEqual([LEGACY]);
    }, 60_000);

    it('AND CASE DOES NOT MATTER — ilike is why the casing variants are not needed here', async () => {
        for (const spelling of ['eledumare', 'Eledumare', 'eLeDuMaRe']) {
            const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, spelling));
            expect({ spelling, found: ids }).toEqual({ spelling, found: [LEGACY] });
        }
    }, 60_000);

    it('AND A MIDDLE FRAGMENT WORKS, not just a whole word', async () => {
        //   "DUMA" is inside "ELEDUMARE", which is inside "NGOZI ELEDUMARE" —
        //   two levels of middle, and the case a prefix range cannot reach at
        //   either level.
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'DUMA'));
        expect(ids).toEqual([LEGACY]);
    }, 60_000);

    it('AND THE PREFIX PATH STILL WORKS — this supplements, it does not replace', async () => {
        /*
         *   The fast path is the one that uses an index. If adding ilike had
         *   quietly replaced it, every search on this platform would have
         *   become a sequential scan.
         */
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'Abuba'));
        expect(ids).toEqual([HER]);
    }, 60_000);

    it('CONTROL: A LITERAL % IN A NAME IS NOT A WILDCARD', async () => {
        /*
         *   THE escaping case. `%` and `_` are ilike wildcards, and they arrive
         *   in real searches — a company called "100% Cotton Ltd" is seeded
         *   above. Unescaped, a search for "100%" would mean "starts with 100,
         *   then anything", and worse, a search for "%" alone would return the
         *   entire table as a name match.
         */
        const found = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, '100% Cotton'));
        expect(found).toEqual([WILDCARD]);

        /*
         *   AND THE WILDCARD ALONE IS A LITERAL, NOT "EVERYBODY".
         *
         *   The first draft of this assertion expected `[]` and was WRONG — the
         *   run returned the one row whose name really does contain a percent
         *   sign, which is the correct answer to searching for "%". The defect
         *   this guards against is the OTHER outcome: an unescaped pattern
         *   makes `%` mean "any characters", and the query returns the entire
         *   table as a name match.
         *
         *   So the claim is the one that distinguishes those two — the rows
         *   that do NOT contain a percent sign are absent.
         */
        const forWildcard = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, '%'));
        expect(forWildcard).toEqual([WILDCARD]);
        expect(forWildcard).not.toContain(HER);
        expect(forWildcard).not.toContain(OTHER);
        expect(forWildcard).not.toContain(LEGACY);
    }, 60_000);

    it('CONTROL: AN UNDERSCORE IS NOT A SINGLE-CHARACTER WILDCARD EITHER', async () => {
        //   `_` matches exactly one character in LIKE. "N_OZI" would otherwise
        //   find "NGOZI".
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'N_OZI'));
        expect(ids).toEqual([]);
    }, 60_000);

    it('CONTROL: a name nobody has still finds nobody', async () => {
        const ids = ours(await searchDocIdsByNameFields(TABLE, NAME_FIELDS, 'Zzzznobody'));
        expect(ids).toEqual([]);
    }, 60_000);
});
