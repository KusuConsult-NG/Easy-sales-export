/**
 * @jest-environment node
 */

/**
 *   #786 THE NAME SORT THE OWNER REPORTED AS BROKEN WAS NOT BROKEN. IT WAS NOT
 *        THERE.
 *
 *   The owner, on their formal list: "Sorting/filtering by applicant name in the
 *   WAVE Admin Dashboard is not functioning correctly and returns an error."
 *
 *   Measured before the fix, on the screen and in the action behind it:
 *
 *       the sort control's options        Sort by Date, Sort by Gender
 *       the action's sortBy type          "createdAt" | "gender"
 *
 *   A table whose first column is the applicant's name, and no way to order by
 *   it. So the first half of this finding adds the sort.
 *
 * ── AND THE HALF THAT WAS WORSE ─────────────────────────────────────────────
 *
 *   The approved tab RETURNS BEFORE THE SORT. _wv_admin_applications has two
 *   branches: `status === "approved"` reads USERS by role and returns its own
 *   result a hundred lines above the tail, where the gender sort lives. So
 *   "Sort by Gender" — a control that has shipped for as long as the screen has
 *   — has been doing nothing at all on the largest tab in the dashboard, and a
 *   name sort added only at the tail would have inherited exactly that hole.
 *
 *   This is the shape this audit keeps meeting: a correct rule applied to some
 *   of the places it names. It is why the sort is one function in lib/ that both
 *   branches call, and why the test below drives BOTH TABS rather than one.
 *
 * ── AND WHY "RETURNS AN ERROR" IS NOT CLAIMED AS REPRODUCED ─────────────────
 *
 *   Honestly: it is not. What was measured is that a failing search was
 *   INDISTINGUISHABLE from an empty one — searchUserIdsByQuery caught, logged
 *   one line, and returned whatever ids it had, which is `[]` when the first
 *   query threw. Every one of the nine callers then does `if (length === 0)
 *   return { data: [] }`. Whether the owner saw a red banner or an empty table,
 *   a search that fails silently is the defect underneath it, and it is fixed
 *   by throwing. The helper's own docstring also promised a cap of thirty that
 *   the code did not apply — the `in`-clause limit its callers are built on.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     "name" removed from IN_MEMORY_SORTS                          KILLED
 *     blank-key branch deleted from sortResolvedRows               KILLED
 *     tie-break on createdAt removed                               KILLED
 *     sortResolvedRows call removed from the approved branch       KILLED
 *     sortResolvedRows call removed from the tail branch           KILLED
 *     the cap dropped — an early `return all` above the slice      SURVIVED
 *                                             → then, rewritten:   KILLED
 *     the helper's throw restored to a swallowing return           KILLED
 *     the <option value="name"> removed from the screen            KILLED
 *     the truncation flag dropped in the approved branch           KILLED
 *     reword this header                                SURVIVED, intended
 *
 *   THE SURVIVOR IS RECORDED BECAUSE IT MATTERS. The cap test read the source
 *   — the slice present, the old uncapped return absent — and an early return
 *   inserted ABOVE the slice satisfies both while capping nothing. Rewritten to
 *   execute the search against sixty seeded members; see the test itself.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { sortResolvedRows, sortIsInMemory, IN_MEMORY_SORTS } from '@/lib/admin-row-sort';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

//   Same reason as the sibling suite: @upstash/redis pulls in ESM-only
//   `uncrypto`, the import failure lands in the action's own catch, and the
//   result reads exactly like a defect in the code under test.
jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/email-notifications', () => ({
    sendWaveApplicationEmail: jest.fn(async () => undefined),
    sendEmail: jest.fn(async () => undefined),
}));

let store: FakeDbHandle;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

const actions = () => import('@/app/actions/wave/_wv_admin_applications');

/** A row in the shape the reader hands to the sort. */
const row = (name: string, createdAt?: string, gender = '') =>
    ({ user: { name, gender }, data: { createdAt } });

const names = (rows: any[]) => rows.map(r => r.user.name);

// ─────────────────────────────────────────────────────────────────────────────
describe('#786 — the sort itself', () => {
    it('THE NAME SORT EXISTS, which is the whole of the owner\'s first report', () => {
        //   Vacuity guard for everything below: every ordering assertion in this
        //   file is trivially satisfied by a sort that silently does nothing,
        //   which is precisely what was there.
        expect(sortIsInMemory('name')).toBe(true);
        expect([...IN_MEMORY_SORTS]).toEqual(['gender', 'name', 'state']);
    });

    it('orders by the name the admin actually reads, both ways', () => {
        const rows = [row('Zainab Bello'), row('Ada Obi'), row('Musa Ibrahim')];

        sortResolvedRows(rows, 'name', 'asc');
        expect(names(rows)).toEqual(['Ada Obi', 'Musa Ibrahim', 'Zainab Bello']);

        sortResolvedRows(rows, 'name', 'desc');
        expect(names(rows)).toEqual(['Zainab Bello', 'Musa Ibrahim', 'Ada Obi']);
    });

    it('A MEMBER WHOSE NAME DID NOT RESOLVE GOES LAST, EITHER WAY', () => {
        /*
         *   "" compares before every letter, so the naive sort opens an A-Z list
         *   on a block of rows with no name — the least useful page of a list
         *   somebody opened in order to find a name. #754's header is the record
         *   of how many members resolve blank through this path.
         */
        const asc = [row(''), row('Ada Obi'), row(''), row('Musa Ibrahim')];
        sortResolvedRows(asc, 'name', 'asc');
        expect(names(asc)).toEqual(['Ada Obi', 'Musa Ibrahim', '', '']);

        const desc = [row(''), row('Ada Obi'), row('Musa Ibrahim')];
        sortResolvedRows(desc, 'name', 'desc');
        expect(names(desc)).toEqual(['Musa Ibrahim', 'Ada Obi', '']);
    });

    it('AND THE ORDER IS TOTAL — two members with one name do not swap between loads', () => {
        /*
         *   Without the tie-break, equal keys keep their input order, and the
         *   input order is whatever the database returned — which differs
         *   between two identical requests. An admin paging a list of people who
         *   share a surname would see rows move, and read it as the data
         *   changing underneath them.
         */
        const build = () => [
            { user: { name: 'Musa Ibrahim', gender: '' }, data: { createdAt: '2026-01-01T00:00:00.000Z' }, tag: 'older' },
            { user: { name: 'Musa Ibrahim', gender: '' }, data: { createdAt: '2026-06-01T00:00:00.000Z' }, tag: 'newer' },
        ];

        const forwards: any[] = build();
        const backwards: any[] = build().reverse();
        sortResolvedRows(forwards, 'name', 'asc');
        sortResolvedRows(backwards, 'name', 'asc');

        expect(forwards.map(r => r.tag)).toEqual(['newer', 'older']);
        expect(backwards.map(r => r.tag)).toEqual(forwards.map(r => r.tag));
    });

    it('reads a Timestamp and an ISO string as the same instant', () => {
        //   The two branches of the reader hand it different shapes: the tail
        //   carries serialised `{ seconds }`, the approved branch a raw
        //   `createdAt` off the user document.
        const rows: any[] = [
            { user: { name: 'Ada Obi' }, data: { createdAt: '2026-01-01T00:00:00.000Z' }, tag: 'iso-older' },
            { user: { name: 'Ada Obi' }, data: { createdAt: { seconds: Date.parse('2026-06-01T00:00:00.000Z') / 1000 } }, tag: 'ts-newer' },
        ];
        sortResolvedRows(rows, 'name', 'asc');
        expect(rows.map(r => r.tag)).toEqual(['ts-newer', 'iso-older']);
    });

    it('CONTROL: a sort it does not own leaves the rows exactly as they came', () => {
        //   `createdAt` is ordered by the database. A sort helper that quietly
        //   re-ordered those rows would undo the query's own ordering, which is
        //   the defect #068's header records on this same collection.
        const rows = [row('Zainab Bello'), row('Ada Obi')];
        sortResolvedRows(rows, 'createdAt', 'asc');
        expect(names(rows)).toEqual(['Zainab Bello', 'Ada Obi']);

        sortResolvedRows(rows, undefined, 'asc');
        expect(names(rows)).toEqual(['Zainab Bello', 'Ada Obi']);
    });

    it('and gender still sorts the way it always did', () => {
        const rows = [row('A', undefined, 'male'), row('B', undefined, 'female')];
        sortResolvedRows(rows, 'gender', 'asc');
        expect(rows.map(r => r.user.gender)).toEqual(['female', 'male']);
        sortResolvedRows(rows, 'gender', 'desc');
        expect(rows.map(r => r.user.gender)).toEqual(['male', 'female']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#786 — BOTH TABS, because only one of them was ever wired', () => {
    /**
     * Three applicants, seeded in an order that is neither alphabetical nor
     * reverse-alphabetical, so a list that comes back sorted cannot have come
     * back sorted by accident.
     */
    const PEOPLE = [
        { uid: 'u-musa', first: 'Musa', last: 'Ibrahim', created: '2026-03-01T00:00:00.000Z' },
        { uid: 'u-zainab', first: 'Zainab', last: 'Bello', created: '2026-01-01T00:00:00.000Z' },
        { uid: 'u-ada', first: 'Ada', last: 'Obi', created: '2026-02-01T00:00:00.000Z' },
    ];

    function seedApproved(): void {
        for (const p of PEOPLE) {
            store.seed(COLLECTIONS.USERS, p.uid, {
                email: `${p.uid}@example.com`,
                firstName: p.first,
                lastName: p.last,
                fullName: `${p.first} ${p.last}`,
                roles: ['user', 'wave_participant'],
                createdAt: p.created,
            });
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `app-${p.uid}`, {
                userId: p.uid,
                email: `${p.uid}@example.com`,
                firstName: p.first,
                surname: p.last,
                status: 'approved',
                createdAt: p.created,
            });
        }
    }

    function seedPending(): void {
        for (const p of PEOPLE) {
            store.seed(COLLECTIONS.USERS, p.uid, {
                email: `${p.uid}@example.com`,
                firstName: p.first,
                lastName: p.last,
                fullName: `${p.first} ${p.last}`,
                roles: ['user'],
                createdAt: p.created,
            });
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `app-${p.uid}`, {
                userId: p.uid,
                email: `${p.uid}@example.com`,
                firstName: p.first,
                surname: p.last,
                status: 'pending',
                createdAt: p.created,
            });
        }
    }

    const returned = (result: any) => (result.data ?? []).map((r: any) => r.user?.name);

    it('THE APPROVED TAB SORTS BY NAME — the branch that had no sort at all', async () => {
        seedApproved();
        const { getStandardWaveApplicationsAction } = await actions();

        const asc = await getStandardWaveApplicationsAction({ status: 'approved', sortBy: 'name', sortOrder: 'asc' });
        expect(asc.success).toBe(true);
        expect(returned(asc)).toEqual(['Ada Obi', 'Musa Ibrahim', 'Zainab Bello']);

        const desc = await getStandardWaveApplicationsAction({ status: 'approved', sortBy: 'name', sortOrder: 'desc' });
        expect(returned(desc)).toEqual(['Zainab Bello', 'Musa Ibrahim', 'Ada Obi']);
    });

    it('AND SO DOES THE APPROVED TAB\'S GENDER SORT, which never reached the tail', async () => {
        /*
         *   The regression this finding found on its way past. Not reported by
         *   the owner and not something a reader of the file would see, because
         *   the sort it needed is a hundred lines below the return that skips
         *   it.
         */
        store.seed(COLLECTIONS.USERS, 'u-f', {
            email: 'f@example.com', fullName: 'Fatima Sule', gender: 'female',
            roles: ['user', 'wave_participant'], createdAt: '2026-01-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.USERS, 'u-m', {
            email: 'm@example.com', fullName: 'Musa Danjuma', gender: 'male',
            roles: ['user', 'wave_participant'], createdAt: '2026-02-01T00:00:00.000Z',
        });

        const { getStandardWaveApplicationsAction } = await actions();
        const asc = await getStandardWaveApplicationsAction({ status: 'approved', sortBy: 'gender', sortOrder: 'asc' });
        expect(asc.success).toBe(true);
        expect((asc.data ?? []).map((r: any) => r.user?.gender)).toEqual(['female', 'male']);
    });

    it('and the applications tab sorts by name too', async () => {
        seedPending();
        const { getStandardWaveApplicationsAction } = await actions();

        const asc = await getStandardWaveApplicationsAction({ status: 'pending', sortBy: 'name', sortOrder: 'asc' });
        expect(asc.success).toBe(true);
        expect(returned(asc)).toEqual(['Ada Obi', 'Musa Ibrahim', 'Zainab Bello']);
    });

    it('CONTROL: without a name sort the order is the database\'s, not alphabetical', async () => {
        /*
         *   Proves the two assertions above are reading the SORT and not some
         *   incidental ordering of the fixture. Seeded newest-last, read
         *   newest-first: an alphabetical answer here would mean every claim in
         *   this describe block was measuring nothing.
         */
        seedPending();
        const { getStandardWaveApplicationsAction } = await actions();

        const dated = await getStandardWaveApplicationsAction({ status: 'pending', sortOrder: 'desc' });
        expect(dated.success).toBe(true);
        expect(returned(dated)).not.toEqual(['Ada Obi', 'Musa Ibrahim', 'Zainab Bello']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#786 — a failed search no longer looks like an empty one', () => {
    it('THE HELPER THROWS instead of returning the ids it managed to collect', () => {
        /*
         *   Source-read rather than executed, because provoking the failure
         *   means making the query builder throw, and a helper mocked that
         *   thoroughly would be asserting the mock. What matters is which of two
         *   things the catch does, and there is exactly one line of it.
         */
        const src = stripComments(read('src/lib/admin-search-helper.ts'));
        const catchBody = src.split('} catch (err) {')[1].split('\n    }')[0];

        expect(catchBody).toMatch(/throw new Error/);
        expect(catchBody).not.toMatch(/return/);
    });

    it('AND THE CAP IT PROMISED IN ITS DOCSTRING IS THE CAP IT APPLIES', async () => {
        /*
         *   "Returns a list of matching user IDs (up to 30, which is the limit
         *   for 'in' operator)" — its own words, at the top of the file, since
         *   the file was written. The two EARLY returns sliced to thirty; the
         *   final one did not, so a common name came back uncapped and went
         *   straight into a `.where("userId", "in", ids)` built on that limit.
         *   Every caller is one of nine admin screens.
         *
         *   EXECUTED, NOT READ. The first draft of this test asserted the
         *   source instead — `slice(0, SEARCH_RESULT_CAP)` present, the old
         *   uncapped `return` absent — and the mutation sweep walked straight
         *   through it: an early `return all;` inserted ABOVE the slice leaves
         *   both strings in the file and caps nothing. That is the #741 shape
         *   for the sixth time in this audit, caught here by the sweep rather
         *   than by review, which is what the sweep is for.
         *
         *   THE FIXTURE IS THE REAL CASE. Thirty members whose FIRST name is
         *   Ibrahim and thirty different members whose LAST name is Ibrahim.
         *   Each individual query is capped at thirty by the builder; it is the
         *   UNION across fields that overflows, which is why the tail return is
         *   where the cap has to be and why a name that is both a given name
         *   and a surname is the one that breaks it.
         */
        for (let i = 0; i < 30; i++) {
            store.seed(COLLECTIONS.USERS, `first-${i}`, {
                email: `first-${i}@example.com`,
                firstName: 'Ibrahim', lastName: `Surname${i}`,
                fullName: `Ibrahim Surname${i}`, roles: ['user'],
            });
            store.seed(COLLECTIONS.USERS, `last-${i}`, {
                email: `last-${i}@example.com`,
                firstName: `Given${i}`, lastName: 'Ibrahim',
                fullName: `Given${i} Ibrahim`, roles: ['user'],
            });
        }

        const { searchUserIdsByQuery, SEARCH_RESULT_CAP } = await import('@/lib/admin-search-helper');
        const ids = await searchUserIdsByQuery('Ibrahim');

        //   The fixture really does overflow — otherwise the cap below is
        //   satisfied by a search that simply found fewer than thirty people.
        const distinct = new Set(ids);
        expect(distinct.size).toBe(ids.length);
        expect(ids.length).toBe(SEARCH_RESULT_CAP);
    });

    it('and a truncated result can be recognised by the caller', async () => {
        const { searchWasTruncated, SEARCH_RESULT_CAP } = await import('@/lib/admin-search-helper');

        expect(SEARCH_RESULT_CAP).toBe(30);
        expect(searchWasTruncated(new Array(SEARCH_RESULT_CAP).fill('id'))).toBe(true);
        expect(searchWasTruncated(new Array(SEARCH_RESULT_CAP - 1).fill('id'))).toBe(false);
        expect(searchWasTruncated([])).toBe(false);
    });

    it('AND BOTH BRANCHES OF THE READER REPORT IT — not one of the two', () => {
        //   The finding's own defect class, checked against the finding's own
        //   fix. Two search sites, two returns; a flag set at one of them is a
        //   banner that appears on some tabs.
        const src = stripComments(read('src/app/actions/wave/_wv_admin_applications.ts'));

        expect((src.match(/searchTruncated = searchWasTruncated\(/g) ?? []).length).toBe(2);
        expect((src.match(/searchTruncated \? \{ searchTruncated: true/g) ?? []).length).toBe(2);
        expect((src.match(/sortResolvedRows\(/g) ?? []).length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#786 — and the admin can reach it and read it', () => {
    const SCREEN = 'src/app/admin/wave/applications/page.tsx';

    it('THE SORT CONTROL OFFERS THE NAME — the absence that was reported as a fault', () => {
        const src = stripComments(read(SCREEN));

        expect(src).toMatch(/<option value="name">/);
        //   and the direction labels say what they now do, rather than
        //   "Newest First" on an A-Z list
        expect(src).toMatch(/Name \(A-Z\)/);
        expect(src).toMatch(/Name \(Z-A\)/);
    });

    it('AND A PARTIAL LIST SAYS SO ON THE SCREEN, not in a log', () => {
        /*
         *   Both bounds are real and neither can be removed here: a search
         *   returns at most thirty because that is the `in`-clause limit, and a
         *   resolved-row sort covers the fetch window because the name is not a
         *   column. #772 is this codebase's record of what a sample presented as
         *   a total costs, so the screen states them.
         */
        const src = stripComments(read(SCREEN));

        expect(src).toMatch(/searchTruncated/);
        expect(src).toMatch(/sortIsPartial/);
        expect(src).toMatch(/This is a partial list/);
        expect(src).toMatch(/Sorted within the first/);
    });
});
