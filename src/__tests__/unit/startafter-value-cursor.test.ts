/**
 * @jest-environment node
 */

/**
 *   #192 SEVEN PAGINATED LISTS THAT COULD NEVER LEAVE PAGE ONE.
 *
 *        Firestore's startAfter takes either a document snapshot or the
 *        ORDER-KEY VALUES. SupabaseQuery.startAfter recorded the snapshot and
 *        silently dropped anything else:
 *
 *            startAfter(docOrValue: any): this {
 *                const q = this._clone();
 *                if (docOrValue instanceof SupabaseDocumentSnapshot) {
 *                    q._startAfterDoc = docOrValue;
 *                }
 *                return q;          // <- a bare value: gone, no warning
 *            }
 *
 *        Seven call sites use the value form, every one passing a Date:
 *
 *            actions/briefing-admin.ts                WAVE briefing guest list
 *            actions/wave/_wv_resources.ts     (x2)   both resource listings
 *            api/marketplace/products/route.ts (x2)   public catalogue + fallback
 *            api/wave/training-sessions/route.ts      the training-session feed
 *            api/admin/cooperative/members/route.ts   roster, date-filtered path
 *
 *        Each reads `limit + 1` rows, reports hasMore: true and hands back a
 *        nextCursor — and the next request applied no cursor at all and served
 *        the SAME first page back. "Load more" appended rows already on screen,
 *        for ever. The lists looked paginated, said there was more, and had
 *        exactly one page.
 *
 *   #192a AND THE FAKES WERE TAUGHT TO REPRODUCE IT.
 *        firestore-mock-db.js ignored a bare value "also like the adapter",
 *        reasoning that a fake honouring one "would make a paginating call site
 *        look correct that pages nowhere". The observation was right; the
 *        conclusion was backwards. Matching the defect is what kept all seven
 *        lists broken with a 6,800-test suite green over them. The tell was
 *        sitting in fake-db.ts: a complete `startAfterValues` branch that no
 *        builder could reach.
 *
 *   #193 THE BRIEFING LIST'S INDEX FALLBACK SAMPLED AN ARBITRARY 5,000 ROWS.
 *        `db.collection(...).get()` with no orderBy and no limit. A query with
 *        neither is capped at 5,000 and, with no ordering of its own, the
 *        adapter falls back to `.order('id')` — so past 5,000 registrations it
 *        read the first 5,000 BY ID, sorted those in memory and presented the
 *        top as "the most recent". The newest registrant could be missing from
 *        a list sorted by recency.
 *
 *   #194 AND INVENTED A REGISTRATION DATE FOR ANY ROW IT COULD NOT READ.
 *        `d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString()`.
 *        The adapter hydrates ISO strings into Timestamps on read, so those
 *        answer toDate — but a MISSING createdAt does not, and neither does a
 *        legacy `{_seconds, _nanoseconds}` object, which the hydration leaves
 *        as a plain object. Both were reported as registered TODAY, in the
 *        table's Registered Date column and in the CSV of the same name. A
 *        fabricated date is worse than a blank one: nothing about it looks
 *        wrong. The in-memory sort had the mirror image,
 *        `createdAt?.toMillis?.() ?? 0`, dropping those rows to the bottom of a
 *        newest-first list. That is #49, in a file it had not reached.
 *
 *   #195 THE WAVE ADMIN COULD NOT OPEN THE WAVE GUEST LIST.
 *        A hand-written `roles.includes("admin") || roles.includes("super_admin")`.
 *        wave_admin runs every other screen under /admin/wave — applications,
 *        training, certificates, live sessions, withdrawals — and was refused
 *        the registrations page for the briefing it administers, only because
 *        this file asked the role list instead of the permission matrix.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the adapter itself, against a recording PostgREST builder.
//
// jest.setup.js replaces @/lib/supabase-db wholesale, so the real class comes
// from requireActual and its one external dependency, the Supabase client, is
// replaced with a chain that records every call and resolves range() empty.
// This is the only place in the suite where the REAL cursor code runs.
// ─────────────────────────────────────────────────────────────────────────────

type Call = [string, ...unknown[]];

let calls: Call[] = [];

const recordingClient = {
    from(table: string) {
        calls.push(['from', table]);
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') return undefined;         // not a thenable
                if (prop === 'range') {
                    return async (...args: unknown[]) => {
                        calls.push(['range', ...args]);
                        return { data: [], error: null };
                    };
                }
                return (...args: unknown[]) => {
                    calls.push([prop, ...args]);
                    return chain;
                };
            },
        });
        return chain;
    },
};

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: recordingClient,
    supabase: recordingClient,
    createServerClient: () => recordingClient,
}));

const realAdapter = () => jest.requireActual('@/lib/supabase-db') as any;

/** The arguments of the single cursor call, or null if none was made. */
const cursorCall = (): Call | null =>
    calls.find(([name]) => name === 'lt' || name === 'gt') ?? null;

const BRIEFINGS = COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS;

describe('#192 — the adapter honours a value cursor, not only a snapshot', () => {
    beforeEach(() => { calls = []; });

    const query = () => {
        const { SupabaseQuery } = realAdapter();
        return new SupabaseQuery(BRIEFINGS);
    };

    it('TURNS startAfter(aDate) INTO A REAL CURSOR PREDICATE', async () => {
        await query()
            .orderBy('createdAt', 'desc')
            .limit(25)
            .startAfter(new Date('2026-08-01T09:30:00.000Z'))
            .get();

        // Was: no lt/gt at all, so the query returned page one again.
        expect(cursorCall()).toEqual(['lt', 'created_at', '2026-08-01T09:30:00.000Z']);
    });

    it('COERCES THE DATE TO ISO rather than handing PostgREST "Tue Aug 20 2026"', async () => {
        await query()
            .orderBy('createdAt', 'desc')
            .startAfter(new Date('2026-08-01T09:30:00.000Z'))
            .get();

        const [, , value] = cursorCall() as Call;
        expect(value).toBe('2026-08-01T09:30:00.000Z');
        expect(String(value)).not.toMatch(/GMT|\d{4}\s\d{2}:/);
    });

    it('uses gt for an ascending order, as page-forward requires', async () => {
        await query()
            .orderBy('scheduledAt', 'asc')
            .startAfter(new Date('2026-08-01T09:30:00.000Z'))
            .get();

        // scheduledAt is not a native column, so it takes the JSONB path — the
        // same one the snapshot cursor uses.
        expect(cursorCall()).toEqual(['gt', 'raw_data->>"scheduledAt"', '2026-08-01T09:30:00.000Z']);
    });

    it('accepts an ISO string cursor as well as a Date', async () => {
        await query()
            .orderBy('createdAt', 'desc')
            .startAfter('2026-08-01T09:30:00.000Z')
            .get();

        expect(cursorCall()).toEqual(['lt', 'created_at', '2026-08-01T09:30:00.000Z']);
    });

    it('still honours the snapshot form — the branch that already worked', async () => {
        const { SupabaseQuery, SupabaseDocumentSnapshot } = realAdapter();
        // (id, ref, data) — the ref is not touched by the cursor path.
        const snap = new SupabaseDocumentSnapshot(
            'doc-1', null as never, { createdAt: '2026-07-04T00:00:00.000Z' });

        await new SupabaseQuery(BRIEFINGS)
            .orderBy('createdAt', 'desc')
            .startAfter(snap)
            .get();

        expect(cursorCall()).toEqual(['lt', 'created_at', '2026-07-04T00:00:00.000Z']);
    });

    it('applies no cursor when there is no orderBy to page along', async () => {
        await query().startAfter(new Date('2026-08-01T09:30:00.000Z')).get();
        expect(cursorCall()).toBeNull();
    });

    it('ignores null and undefined rather than filtering on them', async () => {
        await query().orderBy('createdAt', 'desc').startAfter(null).get();
        expect(cursorCall()).toBeNull();

        calls = [];
        await query().orderBy('createdAt', 'desc').startAfter(undefined).get();
        expect(cursorCall()).toBeNull();
    });

    it('does not leak the cursor into the query it was derived from', async () => {
        const base = query().orderBy('createdAt', 'desc');
        const paged = base.startAfter(new Date('2026-08-01T09:30:00.000Z'));

        await base.get();
        expect(cursorCall()).toBeNull();

        calls = [];
        await paged.get();
        expect(cursorCall()).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — the fakes agree with it, so a paginating call site can be proven.
// ─────────────────────────────────────────────────────────────────────────────

let store: FakeDbHandle;

const seedBriefings = (n: number) => {
    for (let i = 0; i < n; i++) {
        // Descending ids so "newest" and "first by id" disagree — the shape
        // #193's arbitrary sample could not distinguish.
        store.seed(BRIEFINGS, `reg-${String(n - i).padStart(3, '0')}`, {
            fullName: `Person ${i}`,
            email: `p${i}@example.com`,
            phoneNumber: `080000000${i}`,
            state: 'Lagos',
            role: 'woman_seeking',
            status: 'registered',
            attended: false,
            confirmationSent: false,
            // i = 0 is the newest.
            createdAt: new Date(Date.UTC(2026, 0, 100 - i)).toISOString(),
            updatedAt: new Date(Date.UTC(2026, 0, 100 - i)).toISOString(),
        });
    }
};

describe('#192a — the fake pages too, instead of matching the defect', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        seedBriefings(6);
    });

    it('A VALUE CURSOR ADVANCES THE FAKE', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const page = (cursor?: Date) => {
            let q = supabaseDb.collection(BRIEFINGS).orderBy('createdAt', 'desc').limit(2);
            if (cursor) q = q.startAfter(cursor);
            return q.get();
        };

        const first = await page();
        const firstIds = first.docs.map((d: any) => d.id);
        expect(firstIds).toHaveLength(2);

        const cursor = new Date(first.docs[1].data().createdAt);
        const second = await page(cursor);
        const secondIds = second.docs.map((d: any) => d.id);

        // Was: identical to firstIds, for ever.
        expect(secondIds).toHaveLength(2);
        expect(secondIds).not.toEqual(firstIds);
        expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    });

    it('walks the whole collection page by page and repeats nothing', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const seen: string[] = [];
        let cursor: Date | undefined;

        for (let guard = 0; guard < 10; guard++) {
            let q = supabaseDb.collection(BRIEFINGS).orderBy('createdAt', 'desc').limit(2);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            if (snap.docs.length === 0) break;
            seen.push(...snap.docs.map((d: any) => d.id));
            cursor = new Date(snap.docs[snap.docs.length - 1].data().createdAt);
        }

        expect(seen).toHaveLength(6);
        expect(new Set(seen).size).toBe(6);
    });

    it('does not depend on the cursor row still existing', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const first = await supabaseDb.collection(BRIEFINGS)
            .orderBy('createdAt', 'desc').limit(2).get();
        const cursorValue = new Date(first.docs[1].data().createdAt);

        // The admin deletes that registration between the two page loads. An
        // equality-search cursor would find nothing and serve page one again.
        await supabaseDb.collection(BRIEFINGS).doc(first.docs[1].id).delete();

        const second = await supabaseDb.collection(BRIEFINGS)
            .orderBy('createdAt', 'desc').limit(2).startAfter(cursorValue).get();

        expect(second.docs.map((d: any) => d.id))
            .not.toContain(first.docs[0].id);
    });

    it('pages ascending as well as descending', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const first = await supabaseDb.collection(BRIEFINGS)
            .orderBy('createdAt', 'asc').limit(2).get();
        const second = await supabaseDb.collection(BRIEFINGS)
            .orderBy('createdAt', 'asc').limit(2)
            .startAfter(new Date(first.docs[1].data().createdAt)).get();

        const firstIds = first.docs.map((d: any) => d.id);
        expect(second.docs.map((d: any) => d.id).some((id: string) => firstIds.includes(id)))
            .toBe(false);
    });

    it('the dead branch is reachable: the builders feed startAfterValues', () => {
        const fs = require('fs');
        const path = require('path');
        for (const f of ['src/lib/testing/fake-db.ts', 'src/lib/testing/firestore-mock-db.js']) {
            const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
            // Stripped, because the note explaining the fix quotes the old
            // behaviour and asserting over raw source would match the comment.
            const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
            expect(`${f}: ${/startAfterValues/.test(code)}`).toBe(`${f}: true`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — the briefing guest list, executed. briefing-admin.ts was at 4.7%.
// ─────────────────────────────────────────────────────────────────────────────

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const briefingAdmin = async () => await import('@/app/actions/briefing-admin');

const sessionFor = (roles: string[]) => ({
    session: { user: { id: 'admin-1', email: 'a@e.com', roles } },
});

const fetchPage = async (opts: any = {}) =>
    (await briefingAdmin()).getBriefingRegistrationsAction(opts) as any;

describe('#195 — who may read the guest list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        seedBriefings(3);
        mockRequireSession.mockResolvedValue(sessionFor(['super_admin']));
    });

    it('ADMITS THE WAVE ADMIN, WHO RUNS THE BRIEFING', async () => {
        mockRequireSession.mockResolvedValue(sessionFor(['wave_admin']));

        const res = await fetchPage();

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(3);
    });

    it.each([['admin'], ['super_admin']])('still admits %s', async (role) => {
        mockRequireSession.mockResolvedValue(sessionFor([role]));
        expect((await fetchPage()).success).toBe(true);
    });

    it.each([['support'], ['moderator'], ['marketplace_admin'], ['academy_admin'], ['user']])(
        'refuses %s, who has no WAVE remit', async (role) => {
            mockRequireSession.mockResolvedValue(sessionFor([role]));

            const res = await fetchPage();
            expect(res.success).toBe(false);
            expect(res.data).toBeUndefined();
        });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });
        expect(await fetchPage()).toMatchObject({ success: false });
    });
});

describe('#192 — the guest list actually pages', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        seedBriefings(5);
        mockRequireSession.mockResolvedValue(sessionFor(['wave_admin']));
    });

    it('PAGE TWO IS NOT PAGE ONE', async () => {
        const first = await fetchPage({ limit: 2 });
        expect(first.meta.hasMore).toBe(true);
        expect(first.meta.cursor).toBeTruthy();

        const second = await fetchPage({ limit: 2, lastDocId: first.meta.cursor });

        const firstNames = first.data.map((r: any) => r.fullName);
        const secondNames = second.data.map((r: any) => r.fullName);
        // Was: the same two people, and the same cursor, on every click.
        expect(secondNames).not.toEqual(firstNames);
        expect(secondNames.some((n: string) => firstNames.includes(n))).toBe(false);
    });

    it('reaches the last page and stops', async () => {
        const seen: string[] = [];
        let cursor: string | null = null;

        for (let guard = 0; guard < 10; guard++) {
            const res: any = await fetchPage({ limit: 2, lastDocId: cursor });
            seen.push(...res.data.map((r: any) => r.fullName));
            if (!res.meta.hasMore) break;
            cursor = res.meta.cursor;
        }

        expect(new Set(seen).size).toBe(5);
    });

    it('returns newest first', async () => {
        const res = await fetchPage({ limit: 5 });
        // Person 0 was seeded with the latest createdAt and the LAST id.
        expect(res.data[0].fullName).toBe('Person 0');
    });

    it('reports the total alongside the page', async () => {
        const res = await fetchPage({ limit: 2 });
        expect(res.meta.totalCount).toBe(5);
    });
});

describe('#194 — dates are reported, not invented', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor(['wave_admin']));
    });

    it('KEEPS THE REGISTRATION DATE THE ROW ACTUALLY CARRIES', async () => {
        store.seed(BRIEFINGS, 'r1', {
            fullName: 'Amina', email: 'a@e.com', status: 'registered',
            createdAt: '2026-03-04T10:00:00.000Z',
            updatedAt: '2026-03-05T10:00:00.000Z',
        });

        const res = await fetchPage();

        expect(res.data[0].createdAt).toBe('2026-03-04T10:00:00.000Z');
        expect(res.data[0].updatedAt).toBe('2026-03-05T10:00:00.000Z');
    });

    it('REPORTS NO DATE RATHER THAN TODAY when the row has none', async () => {
        store.seed(BRIEFINGS, 'r1', {
            fullName: 'Amina', email: 'a@e.com', status: 'registered',
        });

        const res = await fetchPage();

        // Was `new Date().toISOString()` — a registration dated today, in the
        // table and in the CSV's "Registered Date" column. The table renders an
        // em dash for "", which is the truth.
        expect(res.data[0].createdAt).toBe('');
        expect(res.data[0].createdAt).not.toMatch(new RegExp(`^${new Date().getUTCFullYear()}`));
    });

    it('SORTS A DATELESS ROW WITHOUT DISPLACING DATED ONES', async () => {
        store.seed(BRIEFINGS, 'dated', {
            fullName: 'Dated', email: 'd@e.com', status: 'registered',
            createdAt: '2026-03-04T10:00:00.000Z',
        });
        store.seed(BRIEFINGS, 'undated', {
            fullName: 'Undated', email: 'u@e.com', status: 'registered',
        });

        const res = await fetchPage();

        expect(res.success).toBe(true);
        expect(res.data.map((r: any) => r.fullName)).toContain('Dated');
        expect(res.data.map((r: any) => r.fullName)).toContain('Undated');
    });

    it('fills in the several phone-number spellings the form has used', async () => {
        store.seed(BRIEFINGS, 'r1', {
            fullName: 'Amina', email: 'a@e.com', status: 'registered',
            kyc: { phone: '08099999999' },
        });

        expect((await fetchPage()).data[0].phoneNumber).toBe('08099999999');
    });

    it('defaults the flags a registration is read through', async () => {
        store.seed(BRIEFINGS, 'r1', { fullName: 'Amina', email: 'a@e.com' });

        expect((await fetchPage()).data[0]).toMatchObject({
            status: 'registered', attended: false, confirmationSent: false,
        });
    });
});

describe('filters and search', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor(['wave_admin']));

        const rows: Array<[string, any]> = [
            ['a', { fullName: 'Amina Bello', email: 'amina@e.com', phoneNumber: '08011111111', state: 'Lagos', role: 'investor', status: 'registered' }],
            ['b', { fullName: 'Bisi Okoro', email: 'bisi@e.com', phoneNumber: '08022222222', state: 'Kano', role: 'investor', status: 'attended' }],
            ['c', { fullName: 'Chidi Nwosu', email: 'chidi@e.com', phoneNumber: '08033333333', state: 'Lagos', role: 'farm_owner', status: 'registered' }],
        ];
        rows.forEach(([id, d], i) =>
            store.seed(BRIEFINGS, id, { ...d, createdAt: new Date(Date.UTC(2026, 0, 10 - i)).toISOString() }));
    });

    const names = (res: any) => res.data.map((r: any) => r.fullName).sort();

    it('filters by state', async () => {
        expect(names(await fetchPage({ state: 'Lagos' }))).toEqual(['Amina Bello', 'Chidi Nwosu']);
    });

    it('filters by role and by status', async () => {
        expect(names(await fetchPage({ role: 'farm_owner' }))).toEqual(['Chidi Nwosu']);
        expect(names(await fetchPage({ status: 'attended' }))).toEqual(['Bisi Okoro']);
    });

    it('treats "all" as no filter', async () => {
        expect(await fetchPage({ state: 'all', role: 'all', status: 'all' }))
            .toMatchObject({ success: true });
        expect(names(await fetchPage({ state: 'all' }))).toHaveLength(3);
    });

    it('counts the filtered set, not the whole table', async () => {
        expect((await fetchPage({ state: 'Lagos' })).meta.totalCount).toBe(2);
    });

    it('searches name, email and phone, case-insensitively', async () => {
        expect(names(await fetchPage({ search: 'bisi' }))).toEqual(['Bisi Okoro']);
        expect(names(await fetchPage({ search: 'CHIDI@E.COM' }))).toEqual(['Chidi Nwosu']);
        expect(names(await fetchPage({ search: '08011111111' }))).toEqual(['Amina Bello']);
    });

    it('returns an empty list, not a failure, when the search matches nobody', async () => {
        const res = await fetchPage({ search: 'nobody at all' });
        expect(res.success).toBe(true);
        expect(res.data).toEqual([]);
    });

    it('combines a filter with a search', async () => {
        expect(names(await fetchPage({ state: 'Lagos', search: 'amina' }))).toEqual(['Amina Bello']);
    });

    it('still accepts the legacy (cursor, limit) signature', async () => {
        const res = await (await briefingAdmin()).getBriefingRegistrationsAction(null, 2) as any;
        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — #193, the index fallback.
// ─────────────────────────────────────────────────────────────────────────────

describe('#193 — the index fallback reads the newest rows, in order', () => {
    let restore: (() => void) | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        mockRequireSession.mockResolvedValue(sessionFor(['wave_admin']));
        seedBriefings(5);
    });

    afterEach(() => { restore?.(); restore = null; });

    /**
     * Force the fallback: fail the FIRST get() with an index error, then let
     * every later call through. That is exactly the production trigger — the
     * composite query raises, the single-column re-read does not.
     *
     * `onFail` runs at the moment of the failure, which is what makes the
     * fallback's own query observable: anything recorded after it belongs to
     * the fallback and not to the primary query, which orders identically. The
     * first version of this test asserted over ALL recorded orderBy calls and
     * so was satisfied by the primary query — removing the fallback's orderBy
     * left it green.
     */
    const failFirstGetWithIndexError = async (onFail?: () => void) => {
        const g = globalThis as any;
        const real = g.mockFirestoreGet.getMockImplementation();
        let failed = false;
        g.mockFirestoreGet.mockImplementation((...args: any[]) => {
            if (!failed) {
                failed = true;
                onFail?.();
                return Promise.reject(new Error('failed-precondition: The query requires an index.'));
            }
            return real(...args);
        });
        restore = () => g.mockFirestoreGet.mockImplementation(real);
    };

    it('THE FALLBACK QUERY ITSELF CARRIES THE ORDER', async () => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        let orders: unknown[] = [];
        const realCollection = supabaseDb.collection.bind(supabaseDb);
        const spy = jest.spyOn(supabaseDb, 'collection').mockImplementation(((name: string) => {
            const c: any = realCollection(name);
            const realOrderBy = c.orderBy.bind(c);
            c.orderBy = (...a: unknown[]) => { orders.push(a); return realOrderBy(...a); };
            return c;
        }) as never);

        // Everything the primary query recorded is discarded here.
        await failFirstGetWithIndexError(() => { orders = []; });

        const res = await fetchPage({ limit: 3 });
        spy.mockRestore();

        expect(res.success).toBe(true);
        // Was: no orderBy at all, so the adapter ordered by id and a truncated
        // read was an arbitrary slab presented as "the most recent".
        expect(orders).toContainEqual(['createdAt', 'desc']);
    });

    it('SO A TRUNCATED READ IS THE NEWEST ROWS, NOT THE FIRST BY ID', async () => {
        // The cap the adapter applies to a query with no explicit limit. Set
        // low so the shape is testable; the fake reads the same variable the
        // adapter does.
        process.env.SUPABASE_DEFAULT_QUERY_LIMIT = '3';
        const priorRestore = () => { delete process.env.SUPABASE_DEFAULT_QUERY_LIMIT; };

        await failFirstGetWithIndexError();
        const inner = restore!;
        restore = () => { inner(); priorRestore(); };

        // Five registrations exist and the fallback may read only three.
        const res = await fetchPage({ limit: 3 });

        // Person 0 is the NEWEST and was seeded LAST — unordered, the read
        // would have kept Persons 4, 3, 2 and lost the two most recent
        // registrants from a list whose whole claim is recency.
        expect(res.data.map((r: any) => r.fullName))
            .toEqual(['Person 0', 'Person 1', 'Person 2']);
    });

    it('returns the same newest-first order the primary query would', async () => {
        await failFirstGetWithIndexError();

        const res = await fetchPage({ limit: 3 });

        expect(res.data.map((r: any) => r.fullName))
            .toEqual(['Person 0', 'Person 1', 'Person 2']);
    });

    it('applies the filters in memory and counts what survived', async () => {
        store.seed(BRIEFINGS, 'kano', {
            fullName: 'Kano Person', email: 'k@e.com', state: 'Kano',
            status: 'registered', createdAt: '2026-04-01T00:00:00.000Z',
        });
        await failFirstGetWithIndexError();

        const res = await fetchPage({ state: 'Kano' });

        expect(res.data.map((r: any) => r.fullName)).toEqual(['Kano Person']);
        expect(res.meta.totalCount).toBe(1);
    });

    it('pages through the fallback without repeating a row', async () => {
        await failFirstGetWithIndexError();

        const first = await fetchPage({ limit: 2 });
        expect(first.meta.hasMore).toBe(true);

        const second = await fetchPage({ limit: 2, lastDocId: first.meta.cursor });
        const firstNames = first.data.map((r: any) => r.fullName);
        expect(second.data.map((r: any) => r.fullName)
            .some((n: string) => firstNames.includes(n))).toBe(false);
    });

    it('rethrows a failure that is not about an index', async () => {
        const g = globalThis as any;
        const real = g.mockFirestoreGet.getMockImplementation();
        g.mockFirestoreGet.mockImplementation(() =>
            Promise.reject(new Error('connection refused')));
        restore = () => g.mockFirestoreGet.mockImplementation(real);

        const res = await fetchPage();
        expect(res.success).toBe(false);
    });
});
