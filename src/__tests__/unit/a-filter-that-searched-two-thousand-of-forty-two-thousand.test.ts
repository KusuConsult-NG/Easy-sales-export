/**
 * @jest-environment node
 */

/**
 *   #780 THE ADMIN FILTERS SEARCHED 2,000 ROWS OF A 42,000-ROW PLATFORM AND
 *        PRESENTED THE ANSWER AS COMPLETE.
 *
 *   Reported by the owner twice — "sorting users is not completely functional
 *   (using the filter button)", and then, after #776 fixed the SORT: "filtering
 *   is still not fixed." He was right both times, and the second report is a
 *   different defect from the first.
 *
 *   getUsersAction fetched one bounded batch:
 *
 *       const FETCH_LIMIT = (search || hasUnindexedFilter || fromDate || ...)
 *           ? 2000
 *           : Math.min(2000, (page + 1) * pageSize + 100);
 *
 *   and then applied `gender`, `status`, `modules` and the date range to those
 *   rows IN MEMORY. So an admin filtering by gender saw the female accounts
 *   among the newest 2,000, and every one outside that window was invisible on
 *   every page, with nothing saying anything had been left out.
 *
 *   MEASURED, on 3,002 accounts with the two targets at the old end:
 *
 *       gender = female        expected 1 row     returned NOTHING
 *       status = verified      expected 1 row     returned NOTHING
 *       module = wave          expected 1 row     returned NOTHING
 *       module = academy       expected 1 row     returned NOTHING
 *
 * ── WHY IT SURVIVED 14,000 TESTS ────────────────────────────────────────────
 *
 *   Because every existing fixture is small. On two users all fifteen filters
 *   pass, and I confirmed exactly that before finding this: the instrument was
 *   smaller than the window it was meant to be measuring. The suite below seeds
 *   past the window on purpose, and that is the only reason it can see this.
 *
 * ── WHY NOT SIMPLY RAISE THE LIMIT ──────────────────────────────────────────
 *
 *   #766 is the owner's OTHER report about this screen — "Users app loading
 *   slowly" — and the mapper each row passes through reconciles four schema
 *   generations, walks serviceRegistrations and derives provenance. Mapping
 *   42,000 rows per filtered request would trade one of his complaints for the
 *   other.
 *
 *   So: a cheap prefilter on the RAW row, in front of the mapper, plus a paged
 *   scan that stops when it has enough rather than taking a fixed window.
 *
 * ── THE PREFILTER HAD TO BE EXACT, AND MY FIRST ONE WAS NOT ─────────────────
 *
 *   It began deliberately conservative — discard only what definitely cannot
 *   match, keep anything uncertain. For `modules` that meant keeping every row
 *   whose serviceRegistrations was empty, on the reasoning that the mapper
 *   might know more.
 *
 *   IT DOES NOT, and the cost was measurable: three thousand module-less rows
 *   filled the scan, it stopped having "found enough", and the two real matches
 *   at the far end were never reached. The module filters still returned
 *   nothing after the first fix.
 *
 *   The repair was not a bigger scan but ONE RULE: `activeModulesOf` and
 *   `genderOf` are exported from lib/admin-user-scan and called by BOTH the
 *   mapper and the prefilter, and the verification rule is passed in rather
 *   than restated. A prefilter that reads a different field from the filter
 *   standing behind it is the same defect wearing the opposite costume.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the scan reverted to a single 2,000-row window            KILLED
 *     the module prefilter made conservative again              KILLED
 *     the prefilter discarding rows with no gender recorded     KILLED
 *     the mapper given its own copy of the module rule          KILLED
 *     countIsBounded hardcoded false                            KILLED
 *     the scan ceiling dropped to one page                      KILLED
 *     reword this header                              SURVIVED, intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { activeModulesOf, genderOf, rawRowCanMatch, scanUsers } from '@/lib/admin-user-scan';

jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());
jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(), revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

let store: FakeDbHandle;
const ADMIN = 'admin-1';

/** Far enough past the old 2,000-row window that it cannot reach the targets. */
const FILLERS = 3000;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'a@b.c' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'], createdAt: '2020-01-01T00:00:00.000Z' });

    //   THE TWO TARGETS, at the OLD end of the collection.
    store.seed(COLLECTIONS.USERS, 'u-ada', {
        email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi', fullName: 'Ada Obi',
        phone: '08031234567', roles: ['member', 'wave_participant'], gender: 'female',
        isVerified: true, createdAt: '2024-01-01T00:00:00.000Z',
        address: { state: 'Plateau', lga: 'Jos North' },
        serviceRegistrations: { wave: { status: 'approved' } },
    });
    store.seed(COLLECTIONS.USERS, 'u-bola', {
        email: 'bola@example.com', firstName: 'Bola', lastName: 'Eze', fullName: 'Bola Eze',
        phone: '08099999999', roles: ['member'], gender: 'male',
        isVerified: false, createdAt: '2025-06-01T00:00:00.000Z',
        address: { state: 'Lagos', lga: 'Ikeja' },
        serviceRegistrations: { academy: { status: 'approved' } },
    });

    //   And the crowd in front of them, all NEWER.
    for (let i = 0; i < FILLERS; i++) {
        store.seed(COLLECTIONS.USERS, `z-${String(i).padStart(4, '0')}`, {
            email: `z${i}@example.com`, fullName: `Filler ${i}`, roles: ['member'],
            gender: 'male', isVerified: false,
            createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString(),
            address: { state: 'Kano', lga: 'Nassarawa' },
        });
    }
});

const list = async (o: Record<string, unknown>) => {
    const { getUsersAction } = await import('@/app/actions/admin/_users');
    return (await getUsersAction(o as any)) as any;
};
/** Ids returned, with the admin and the crowd removed. */
const targets = (r: any) =>
    ((r.data ?? []) as any[]).map(u => u.id)
        .filter(i => i !== ADMIN && !String(i).startsWith('z-')).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#780 — a filter reaches past the first window', () => {
    it('GENDER FINDS A MATCH BEYOND THE OLD 2,000-ROW WINDOW', async () => {
        //   THE test. Returned nothing at all before the fix.
        expect(targets(await list({ gender: 'female' }))).toEqual(['u-ada']);
    });

    it('STATUS FINDS A MATCH BEYOND IT', async () => {
        expect(targets(await list({ status: 'verified' }))).toEqual(['u-ada']);
    });

    it('MODULE FINDS A MATCH BEYOND IT — both of them', async () => {
        /*
         *   Both, because the first fix made gender and status pass while the
         *   module filters still returned nothing: the prefilter was keeping
         *   every module-less row, so it narrowed nothing and the scan filled
         *   up on rows that could never match.
         */
        expect(targets(await list({ modules: 'wave' }))).toEqual(['u-ada']);
        expect(targets(await list({ modules: 'academy' }))).toEqual(['u-bola']);
    });

    it('and the filters that already worked still do', async () => {
        //   The vacuity guard. Search, role, state and LGA narrow in the
        //   DATABASE, so they were never affected — and must not become so.
        expect(targets(await list({ search: 'ada@example.com' }))).toEqual(['u-ada']);
        expect(targets(await list({ search: 'Obi' }))).toEqual(['u-ada']);
        expect(targets(await list({ role: 'wave_participant' }))).toEqual(['u-ada']);
        expect(targets(await list({ state: 'Lagos' }))).toEqual(['u-bola']);
        expect(targets(await list({ lga: 'Jos North' }))).toEqual(['u-ada']);
    });

    it('A MATCH THAT IS SIMPLY OLD IS REACHABLE BY ASKING FOR IT', async () => {
        /*
         *   Where thousands of rows match, the oldest is legitimately on a
         *   later page rather than missing — a distinction worth pinning,
         *   because "not on page one" and "not returned at all" look identical
         *   to somebody using the screen, and the second was the defect.
         */
        expect(targets(await list({ status: 'unverified', sortOrder: 'asc', limit: 3 })))
            .toEqual(['u-bola']);
        expect(targets(await list({ fromDate: '2025-01-01', sortOrder: 'asc', limit: 3 })))
            .toEqual(['u-bola']);
    });

    it('CONTROL: a filter matching nobody still returns nobody', async () => {
        //   A scan that kept going until it found something would "fix" every
        //   test above by returning the wrong rows.
        expect(targets(await list({ gender: 'female', state: 'Lagos' }))).toEqual([]);
        expect(targets(await list({ modules: 'farm-nation' }))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#780 — the prefilter and the filter behind it are one rule', () => {
    it('THE MAPPER DOES NOT KEEP ITS OWN COPY OF THE MODULE RULE', () => {
        /*
         *   The rule decided what `modules` matched while living only inside
         *   the mapper, so the scan in front of the filter could not agree with
         *   it by construction. Two copies is how they stop agreeing.
         */
        const src = stripComments(read('src/app/actions/admin/_users.ts'));

        expect(src).toMatch(/activeModulesOf\(/);
        expect(src).toMatch(/genderOf\(data\)/);
        //   and the inlined tables are gone
        expect(src).not.toMatch(/const MODULE_KEYS\s*=/);
        expect(src).not.toMatch(/const ENROLLED_STATUSES\s*=/);
    });

    it('AND THE VERIFICATION RULE IS PASSED IN, NOT RESTATED', () => {
        //   #495 computes three states from a backfill marker plus two flags.
        //   A second reading of that here would drift.
        const src = stripComments(read('src/app/actions/admin/_users.ts'));
        expect(src).toMatch(/verificationStateOf:\s*verificationState/);
    });

    it('activeModulesOf agrees with the statuses that count as enrolled', () => {
        expect(activeModulesOf({ serviceRegistrations: { wave: { status: 'approved' } } })).toEqual(['wave']);
        expect(activeModulesOf({ serviceRegistrations: { wave: { status: 'rejected' } } })).toEqual([]);
        //   the two spellings of farm nation normalise to one label
        expect(activeModulesOf({ serviceRegistrations: { farmNation: { status: 'active' } } })).toEqual(['farm-nation']);
        expect(activeModulesOf({ serviceRegistrations: { farm_nation: { status: 'active' } } })).toEqual(['farm-nation']);
        //   and the legacy marketplace fallback survives
        expect(activeModulesOf({ accountType: 'seller' })).toEqual(['marketplace']);
        expect(activeModulesOf({})).toEqual([]);
    });

    it('genderOf reads every spelling the platform has used', () => {
        expect(genderOf({ gender: 'Female' })).toBe('female');
        expect(genderOf({ kyc: { gender: 'MALE' } })).toBe('male');
        expect(genderOf({ kyc: { kycData: { gender: ' Female ' } } })).toBe('female');
        expect(genderOf({ serviceRegistrations: { wave: { profile: { gender: 'female' } } } })).toBe('female');
        expect(genderOf({})).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#780 — the prefilter never hides a row it is unsure about', () => {
    it('A ROW WITH NO GENDER RECORDED IS KEPT, not discarded', () => {
        //   Discarding on absence is the same defect from the other side: a
        //   user the admin can never see.
        expect(rawRowCanMatch({}, { gender: 'female' })).toBe(true);
        expect(rawRowCanMatch({ gender: 'male' }, { gender: 'female' })).toBe(false);
    });

    it('AND A ROW WITH AN UNREADABLE DATE IS KEPT', () => {
        //   The in-memory date backstop exists precisely because legacy rows
        //   store createdAt inconsistently.
        expect(rawRowCanMatch({ createdAt: 'not a date' }, { fromDate: '2025-01-01' })).toBe(true);
        expect(rawRowCanMatch({}, { toDate: '2020-01-01' })).toBe(true);
        expect(rawRowCanMatch({ createdAt: '2019-01-01T00:00:00.000Z' }, { fromDate: '2025-01-01' })).toBe(false);
    });

    it('and with no filters at all it keeps everything', () => {
        expect(rawRowCanMatch({ gender: 'male' }, {})).toBe(true);
        expect(rawRowCanMatch(null, {})).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#780 — the scan stops, and says when it stopped early', () => {
    const page = (all: any[]) => async (after: any, limit: number) => {
        const from = after ? all.indexOf(after) + 1 : 0;
        return all.slice(from, from + limit);
    };

    it('STOPS AT THE END OF THE COLLECTION WITHOUT CLAIMING TO BE BOUNDED', async () => {
        //   Running out of rows is not the same as being cut off, and reporting
        //   it as bounded would make every small result look like a sample.
        const all = Array.from({ length: 7 }, (_, i) => ({ id: i }));
        const r = await scanUsers(page(all), () => ({}), {}, { need: 100, ceiling: 1000, pageSize: 5 });

        expect(r.docs).toHaveLength(7);
        expect(r.bounded).toBe(false);
    });

    it('AND REPORTS BOUNDED WHEN THE CEILING CUTS IT SHORT', async () => {
        const all = Array.from({ length: 500 }, (_, i) => ({ id: i }));
        const r = await scanUsers(page(all), () => ({}), {}, { need: 400, ceiling: 20, pageSize: 10 });

        expect(r.bounded).toBe(true);
        expect(r.scanned).toBe(20);
    });

    it('stops as soon as it has enough, rather than reading on', async () => {
        //   The performance half of the fix: an ordinary filter must not walk
        //   the collection just because it could.
        const all = Array.from({ length: 5000 }, (_, i) => ({ id: i }));
        const r = await scanUsers(page(all), () => ({}), {}, { need: 25, ceiling: 5000, pageSize: 100 });

        expect(r.scanned).toBe(100);
        expect(r.docs).toHaveLength(100);
    });

    it('and a nonsense page size cannot turn it into an endless loop', async () => {
        const all = Array.from({ length: 10 }, (_, i) => ({ id: i }));
        const r = await scanUsers(page(all), () => ({}), {}, { need: 5, ceiling: 0, pageSize: 0 });

        expect(r.scanned).toBeLessThanOrEqual(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#780 — a bounded count is not reported as a total', () => {
    it('countIsBounded follows the scan rather than a fixed window', () => {
        /*
         *   It read `deduplicatedUsers.length >= FETCH_LIMIT` — "did we fill
         *   the window?" — which stopped meaning anything once the window
         *   became a scan that stops when it has enough. #772's rule: a sample
         *   is never presented as a total.
         */
        const src = stripComments(read('src/app/actions/admin/_users.ts'));

        expect(src).toMatch(/countIsBounded:\s*narrowedInMemory && scan\.bounded/);
        expect(src).not.toMatch(/FETCH_LIMIT/);
    });
});
