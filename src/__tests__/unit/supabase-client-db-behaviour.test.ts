/**
 * @jest-environment node
 */

/**
 * lib/supabase-client-db.ts, EXECUTED. It was at 6.7%.
 *
 * WHAT THIS MODULE IS, AND WHY THESE ARE LATENT
 * ---------------------------------------------
 * It is the browser-side reader behind the `firebase/firestore` shim: client
 * code that imports getDocs/onSnapshot/getDoc reaches Supabase through here.
 * NOTHING in src/ imports `firebase/firestore` today, so none of the defects
 * below is currently reachable by a user. They are recorded and fixed anyway —
 * the module exists to be used, and a reader that is already wrong before its
 * first caller gets blamed on the caller.
 *
 *   #201 THREE MAPPING TABLES HAND-COPIED FROM THE SERVER, AND ALREADY DRIFTED.
 *        TABLE_MAP, NATIVE_COLUMNS and FIELD_TO_COLUMN were duplicated from
 *        supabase-db.ts and were not the same:
 *
 *          TABLE_MAP        missing 'processedPayments' and 'marketplaceOrders',
 *                           the camelCase spellings the app writes. A client
 *                           read of either resolved to document_collections
 *                           while the server wrote the dedicated table — two
 *                           different tables for one collection name, decided by
 *                           whether the code ran in a browser.
 *
 *          FIELD_TO_COLUMN  missing cooperative_members.membershipStatus and
 *                           marketplace_orders.totalAmount. Without the alias
 *                           `where("totalAmount", ">=", 10000)` fell to the JSONB
 *                           path, where values are TEXT — so it compared as a
 *                           string, and "9000" >= "10000" is true. A numeric
 *                           filter silently answering lexicographically.
 *
 *        Both sides import lib/supabase-table-map.ts now.
 *
 *   #202 getTableName RESOLVED A SUBCOLLECTION TO ITS PARENT'S TABLE.
 *        `collection.split('/')[0]`, so `users/u1/notes` came out as the `users`
 *        table and a subcollection read would have queried user rows. The
 *        server matches the whole path and falls back to document_collections,
 *        which is where subcollections actually live.
 *
 *   #203 A QUERY WITH NO limit() READ THE WHOLE TABLE, EVERY EIGHT SECONDS.
 *        The limit clause was applied only when one was given. The server caps
 *        the same case at 5,000 and says why — "a query with no .limit() used to
 *        read the ENTIRE table" — and this copy had no cap at all, while
 *        onSnapshot re-runs the query on an 8-second timer for as long as the
 *        tab is open.
 *
 *   #204 ONLY createdAt WAS HYDRATED INTO A Timestamp.
 *        One line, one field, with a comment saying "so
 *        doc.data().createdAt.toDate() works!". updatedAt, timestamp, date,
 *        registeredAt, lastMessageAt and every other timestamp came back as a
 *        plain string, so `.toDate()` on any of them threw and `.toMillis()`
 *        gave undefined then NaN. The server converts the whole document
 *        recursively. Same family as #18 and #49.
 *
 *   #205 DEDICATED TABLES WERE FILTERED ON NATIVE COLUMNS AND RETURNED WITHOUT
 *        THEM. The select was 'id, raw_data' for every table, so status,
 *        user_id, email, roles, balance and amount were absent from doc.data()
 *        — while applyClientFilter routes where("status", ...) to exactly those
 *        columns. It filtered on one copy of a field and returned the other.
 *
 *   #206 A FAILING LISTENER HAMMERED THE DATABASE FOR EVER.
 *        `setInterval(poll, 8000)` with a catch that only called onError. An
 *        expired session or a revoked RLS grant produced one failed query every
 *        eight seconds, from every open tab, indefinitely. It backs off and
 *        stops now, with a final onError so a caller can tell "stopped" from
 *        "quiet".
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ─── A recording PostgREST builder ───────────────────────────────────────────

type Call = [string, ...unknown[]];

let calls: Call[] = [];
let nextRows: any[] = [];
let nextError: any = null;
let selectedTable = '';

const makeChain = (): any => {
    const chain: any = {};
    const record = (name: string) => (...args: unknown[]) => {
        calls.push([name, ...args]);
        return chain;
    };
    for (const m of ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'not',
        'contains', 'overlaps', 'filter', 'order', 'limit', 'delete']) {
        chain[m] = record(m);
    }
    chain.select = (cols: string) => { calls.push(['select', cols]); return chain; };
    chain.maybeSingle = async () => {
        calls.push(['maybeSingle']);
        return { data: nextRows[0] ?? null, error: nextError };
    };
    // The builder itself is awaited for list queries.
    chain.then = (resolve: any) => resolve({ data: nextRows, error: nextError });
    return chain;
};

jest.mock('@/lib/supabase', () => ({
    supabase: { from: (t: string) => { selectedTable = t; calls.push(['from', t]); return makeChain(); } },
    supabaseAdmin: { from: (t: string) => makeChain() },
}));

const clientDb = async () => await import('@/lib/supabase-client-db');

const argOf = (name: string): Call | undefined => calls.find(([n]) => n === name);
const allOf = (name: string): Call[] => calls.filter(([n]) => n === name);

beforeEach(() => {
    jest.clearAllMocks();
    calls = [];
    nextRows = [];
    nextError = null;
    selectedTable = '';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#201 — one mapping, shared with the server', () => {
    it('THE CLIENT AND THE SERVER RESOLVE EVERY COLLECTION TO THE SAME TABLE', async () => {
        const server = jest.requireActual('@/lib/supabase-db') as any;
        const { DEDICATED_TABLE_MAP } = await import('@/lib/supabase-table-map');
        const { collection, getDocs } = await clientDb();

        for (const name of Object.keys(DEDICATED_TABLE_MAP)) {
            calls = [];
            await getDocs(collection(null, name));
            // Was: 'processedPayments' and 'marketplaceOrders' hit
            // document_collections on the client and the dedicated table on the
            // server.
            expect(`${name} -> ${selectedTable}`)
                .toBe(`${name} -> ${server.getTableName(name)}`);
        }
    });

    it('THE totalAmount ALIAS EXISTS, so a numeric filter is not a string compare', async () => {
        const { collection, query, where, getDocs } = await clientDb();

        await getDocs(query(collection(null, 'marketplaceOrders'), where('totalAmount', '>=', 10000)));

        // Was `gte('raw_data->>totalAmount', '10000')` — TEXT, so "9000" wins.
        expect(argOf('gte')).toEqual(['gte', 'total_amount', 10000]);
    });

    it('THE membershipStatus ALIAS EXISTS', async () => {
        const { collection, query, where, getDocs } = await clientDb();

        await getDocs(query(collection(null, 'cooperative_members'),
            where('membershipStatus', '==', 'active')));

        expect(argOf('eq')).toEqual(['eq', 'status', 'active']);
    });

    it('still routes a field with no alias through raw_data', async () => {
        const { collection, query, where, getDocs } = await clientDb();

        await getDocs(query(collection(null, 'users'), where('nickname', '==', 'ada')));

        expect(argOf('eq')).toEqual(['eq', 'raw_data->>nickname', 'ada']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#202 — a subcollection is not its parent table', () => {
    it('DOES NOT READ THE users TABLE FOR users/u1/notes', async () => {
        const { collection, getDocs } = await clientDb();

        await getDocs(collection(null, 'users/u1/notes'));

        // Was 'users' — a subcollection read answered with user rows.
        expect(selectedTable).toBe('document_collections');
        expect(allOf('eq')).toContainEqual(['eq', 'collection_name', 'users/u1/notes']);
    });

    it('still resolves a real dedicated collection', async () => {
        const { collection, getDocs } = await clientDb();
        await getDocs(collection(null, 'users'));
        expect(selectedTable).toBe('users');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#203 — no query is unbounded in a browser', () => {
    it('CAPS A QUERY THAT ASKED FOR NO LIMIT', async () => {
        const { collection, getDocs } = await clientDb();

        await getDocs(collection(null, 'notifications'));

        // Was: no limit call at all, and onSnapshot repeats this every 8s.
        const [, capped] = argOf('limit') as Call;
        expect(capped).toBe(5000);
    });

    it('says so, once per collection', async () => {
        const { collection, getDocs } = await clientDb();

        await getDocs(collection(null, 'a-fresh-collection'));

        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("Query on 'a-fresh-collection' has no limit()"),
        );
    });

    it('honours an explicit limit unchanged', async () => {
        const { collection, query, limit, getDocs } = await clientDb();

        await getDocs(query(collection(null, 'notifications'), limit(20)));

        expect(allOf('limit')).toEqual([['limit', 20]]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#204 — every timestamp is hydrated, not just createdAt', () => {
    const rowWith = (raw: Record<string, unknown>) => [{ id: 'd1', raw_data: raw }];

    it('HYDRATES updatedAt AND THE REST, NOT ONE FIELD', async () => {
        nextRows = rowWith({
            createdAt: '2026-03-01T00:00:00.000Z',
            updatedAt: '2026-03-02T00:00:00.000Z',
            lastMessageAt: '2026-03-03T00:00:00.000Z',
        });
        const { collection, getDocs } = await clientDb();

        const data = (await getDocs(collection(null, 'chats'))).docs[0].data();

        // Only createdAt used to answer toDate; the other two were strings and
        // calling toDate() on them threw.
        expect(data.createdAt.toDate().toISOString()).toBe('2026-03-01T00:00:00.000Z');
        expect(data.updatedAt.toDate().toISOString()).toBe('2026-03-02T00:00:00.000Z');
        expect(data.lastMessageAt.toDate().toISOString()).toBe('2026-03-03T00:00:00.000Z');
    });

    it('reaches into nested objects and arrays', async () => {
        nextRows = rowWith({
            meta: { approvedAt: '2026-03-04T00:00:00.000Z' },
            events: [{ at: '2026-03-05T00:00:00.000Z' }],
        });
        const { collection, getDocs } = await clientDb();

        const data = (await getDocs(collection(null, 'chats'))).docs[0].data();

        expect(data.meta.approvedAt.toMillis()).toBe(Date.parse('2026-03-04T00:00:00.000Z'));
        expect(data.events[0].at.toMillis()).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
    });

    it('leaves a string that is not a datetime alone', async () => {
        nextRows = rowWith({ title: '2026 annual report', code: '12345678901' });
        const { collection, getDocs } = await clientDb();

        const data = (await getDocs(collection(null, 'chats'))).docs[0].data();

        expect(data.title).toBe('2026 annual report');
        expect(data.code).toBe('12345678901');
    });

    it('agrees with the server adapter about what a Timestamp is', async () => {
        nextRows = rowWith({ createdAt: '2026-03-01T12:00:00.000Z' });
        const { collection, getDocs } = await clientDb();
        const { toMillis } = await import('@/lib/firestore-serialize');

        const data = (await getDocs(collection(null, 'chats'))).docs[0].data();

        // toMillis is the shared reader every sort in this codebase uses.
        expect(toMillis(data.createdAt)).toBe(Date.parse('2026-03-01T12:00:00.000Z'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#205 — native columns come back with the document', () => {
    it('SELECTS EVERY COLUMN ON A DEDICATED TABLE', async () => {
        const { collection, getDocs } = await clientDb();

        await getDocs(collection(null, 'users'));

        // Was 'id, raw_data', so the columns the filters use were not returned.
        expect(argOf('select')).toEqual(['select', '*']);
    });

    it('still selects only what it needs from the generic table', async () => {
        const { collection, getDocs } = await clientDb();

        await getDocs(collection(null, 'notifications'));

        expect(argOf('select')).toEqual(['select', 'id, raw_data']);
    });

    it('MERGES THE NATIVE COLUMNS INTO doc.data()', async () => {
        nextRows = [{
            id: 'u1',
            raw_data: { name: 'Ada' },
            email: 'ada@example.test',
            roles: ['user'],
            status: 'active',
            user_id: 'u1',
            created_at: '2026-02-01T00:00:00.000Z',
        }];
        const { collection, getDocs } = await clientDb();

        const data = (await getDocs(collection(null, 'users'))).docs[0].data();

        // A row selected BY its native status used to come back with no status.
        expect(data).toMatchObject({
            name: 'Ada', email: 'ada@example.test', status: 'active', userId: 'u1',
        });
        expect(data.roles).toEqual(['user']);
        expect(data.createdAt.toDate().toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('raw_data wins over a native column, as it does on the server', async () => {
        nextRows = [{ id: 'u1', raw_data: { status: 'from-raw' }, status: 'from-column' }];
        const { collection, getDocs } = await clientDb();

        expect((await getDocs(collection(null, 'users'))).docs[0].data().status)
            .toBe('from-raw');
    });

    it('gives a single doc read the same shape as a query result', async () => {
        nextRows = [{ id: 'u1', raw_data: { name: 'Ada' }, email: 'ada@example.test' }];
        const { doc, getDoc } = await clientDb();

        const snap = await getDoc(doc(null, 'users', 'u1'));

        expect(snap.exists()).toBe(true);
        expect(snap.data()).toMatchObject({ name: 'Ada', email: 'ada@example.test' });
    });

    it('reports a missing document as missing', async () => {
        nextRows = [];
        const { doc, getDoc } = await clientDb();

        const snap = await getDoc(doc(null, 'users', 'nope'));

        expect(snap.exists()).toBe(false);
        expect(snap.data()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#206 — a failing listener stops', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('BACKS OFF AND GIVES UP INSTEAD OF POLLING FOR EVER', async () => {
        nextError = { message: 'JWT expired' };
        const onError = jest.fn();
        const { collection, onSnapshot } = await clientDb();

        const unsubscribe = onSnapshot(collection(null, 'notifications'), () => {}, onError);

        // Was setInterval(poll, 8000): one failed query every 8 seconds, from
        // every open tab, for ever. Run well past that.
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
            jest.advanceTimersByTime(300_000);
            await Promise.resolve();
        }

        const queries = allOf('from').length;
        expect(queries).toBeLessThanOrEqual(6);
        expect(onError.mock.calls.some(([e]: any[]) =>
            String(e?.message ?? e).includes('Listener stopped'))).toBe(true);

        unsubscribe();
    });

    it('stops querying once unsubscribed', async () => {
        const { collection, onSnapshot } = await clientDb();

        const unsubscribe = onSnapshot(collection(null, 'notifications'), () => {});
        await Promise.resolve();
        unsubscribe();

        const before = allOf('from').length;
        jest.advanceTimersByTime(120_000);
        await Promise.resolve();

        expect(allOf('from').length).toBe(before);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the query surface, executed', () => {
    it.each([
        ['==', 'eq'], ['!=', 'neq'], ['<', 'lt'], ['<=', 'lte'], ['>', 'gt'], ['>=', 'gte'],
    ])('routes %s to %s', async (op, method) => {
        const { collection, query, where, getDocs } = await clientDb();
        await getDocs(query(collection(null, 'items'), where('n', op, 5)));
        expect(argOf(method)).toBeDefined();
    });

    it('refuses an operator it cannot express rather than returning everything', async () => {
        const { collection, query, where, getDocs } = await clientDb();

        await expect(getDocs(query(collection(null, 'items'), where('n', 'not-in', [1]))))
            .rejects.toThrow(/Unsupported query operator/);
    });

    it('handles array-contains on a JSONB field', async () => {
        const { collection, query, where, getDocs } = await clientDb();
        await getDocs(query(collection(null, 'chats'), where('participants', 'array-contains', 'u1')));
        expect(argOf('filter')).toEqual(['filter', 'raw_data->participants', 'cs', '["u1"]']);
    });

    it('orders createdAt on the native column', async () => {
        const { collection, query, orderBy, getDocs } = await clientDb();
        await getDocs(query(collection(null, 'chats'), orderBy('createdAt', 'desc')));
        expect(argOf('order')).toEqual(['order', 'created_at', { ascending: false }]);
    });

    it('raises the query error rather than returning an empty list', async () => {
        nextError = { message: 'permission denied' };
        const { collection, getDocs } = await clientDb();
        await expect(getDocs(collection(null, 'items'))).rejects.toBeDefined();
    });
});
