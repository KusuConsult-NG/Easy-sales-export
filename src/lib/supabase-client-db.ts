import { supabase } from './supabase';
import { DEDICATED_TABLE_MAP, NATIVE_COLUMNS, FIELD_TO_COLUMN } from './supabase-table-map';

/**
 * Rows a query with no explicit limit() returns.
 *
 * The server adapter caps at the same number and says why: "a query with no
 * .limit() used to read the ENTIRE table". This reader had NO cap at all, and
 * onSnapshot re-runs the query every eight seconds — so an unlimited client
 * query would have pulled a whole collection into the browser, over and over,
 * for as long as the tab stayed open.
 */
const CLIENT_DEFAULT_LIMIT = 5000;

const _clientLimitWarned = new Set<string>();

/**
 * The table a collection lives in.
 *
 * Was `collection.split('/')[0]` against a local map, which resolved a
 * SUBCOLLECTION to its parent's dedicated table: `users/u1/notes` came out as
 * the `users` table, so a subcollection read would have queried user rows.
 * The server matches the whole path against the map and falls back to
 * document_collections, which is what a subcollection actually uses.
 */
function getTableName(collection: string): string {
    return DEDICATED_TABLE_MAP[collection] || 'document_collections';
}

export class ClientDocRef {
    public readonly path: string;
    constructor(public readonly collectionName: string, public readonly id: string) {
        this.path = `${collectionName}/${id}`;
    }
}

export class ClientColRef {
    constructor(public readonly collectionName: string) {}
}

export interface WhereFilter {
    field: string;
    op: string;
    value: any;
}

export interface OrderByClause {
    field: string;
    direction: 'asc' | 'desc';
}

export class ClientQuery {
    public filters: WhereFilter[] = [];
    public limitVal: number | null = null;
    public orderByVal: OrderByClause[] = [];

    constructor(public readonly colRef: ClientColRef) {}
}

/**
 * Resolve a Firestore field name to the Supabase column (or JSONB path) it lives in.
 */
function resolveColumn(tableName: string, field: string): string {
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};
    const cols = NATIVE_COLUMNS[tableName] || [];
    if (fieldMap[field]) return fieldMap[field];
    if (cols.includes(field)) return field;
    return `raw_data->>${field}`;
}

/**
 * Apply a single where() clause to a Supabase query builder.
 *
 * Every operator the app actually uses is handled here. Previously only
 * ==, >= and <= were implemented and anything else — notably
 * `array-contains` — was dropped on the floor, which turned a scoped query
 * into "select the entire collection". That is what made the unread-message
 * badge count every conversation on the platform rather than the signed-in
 * user's, and it pulled those documents into the browser.
 */
function applyClientFilter(query: any, tableName: string, f: WhereFilter): any {
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};
    const cols = NATIVE_COLUMNS[tableName] || [];
    const nativeCol = fieldMap[f.field] || (cols.includes(f.field) ? f.field : null);

    if (f.op === 'array-contains') {
        // Native TEXT[] column vs. a JSONB array inside raw_data
        return nativeCol
            ? query.contains(nativeCol, [f.value])
            : query.filter(`raw_data->${f.field}`, 'cs', JSON.stringify([f.value]));
    }

    if (f.op === 'array-contains-any') {
        const values = Array.isArray(f.value) ? f.value : [f.value];
        if (!nativeCol) {
            // `ov` is SQL `&&`, and Postgres has no `&&` for jsonb — verified,
            // not inferred. The same line was in supabase-db; both are refused
            // rather than rewritten, and both here so the fix does not reach
            // one copy. See that module's note.
            throw new Error(
                `[supabase-client-db] Unsupported query operator "array-contains-any" on JSONB field `
                + `"${f.field}": Postgres has no && operator for jsonb. Give the field a native `
                + `TEXT[] column, or use array-contains for a single value.`);
        }
        return query.overlaps(nativeCol, values);
    }

    // Scalar comparisons. JSONB values come back as text, so the comparison
    // value has to be stringified to match.
    const column = nativeCol || `raw_data->>${f.field}`;
    const value = nativeCol ? f.value : (f.value === null ? null : String(f.value));

    switch (f.op) {
        case '==':
            return value === null ? query.is(column, null) : query.eq(column, value);
        case '!=':
            return value === null ? query.not(column, 'is', null) : query.neq(column, value);
        case '<': return query.lt(column, value);
        case '<=': return query.lte(column, value);
        case '>': return query.gt(column, value);
        case '>=': return query.gte(column, value);
        case 'in':
            return query.in(column, (Array.isArray(f.value) ? f.value : [f.value]).map(v => nativeCol ? v : String(v)));
        default:
            // Fail loudly rather than returning an unfiltered collection.
            throw new Error(`[supabase-client-db] Unsupported query operator "${f.op}" on field "${f.field}"`);
    }
}

/**
 * Apply filters, ordering and limit to a Supabase query builder.
 * Shared by getDocs() and onSnapshot() so the two cannot drift apart.
 */
function applyQueryClauses(query: any, tableName: string, target: ClientColRef | ClientQuery): any {
    const isQuery = target instanceof ClientQuery;

    for (const f of isQuery ? target.filters : []) {
        query = applyClientFilter(query, tableName, f);
    }

    for (const o of isQuery ? target.orderByVal : []) {
        const column = (o.field === 'createdAt' || o.field === 'created_at')
            ? 'created_at'
            : resolveColumn(tableName, o.field);
        query = query.order(column, { ascending: o.direction === 'asc' });
    }

    /**
     * A query with no limit() is capped rather than unbounded.
     *
     * This was `if (lim !== null) query = query.limit(lim)` and nothing else —
     * so an unlimited query selected the WHOLE table into the browser, and
     * onSnapshot re-ran it every eight seconds for as long as the tab stayed
     * open. The server adapter caps the same case and warns; so does this, by
     * collection, once.
     */
    const lim = isQuery ? target.limitVal : null;
    if (lim !== null) {
        query = query.limit(lim);
    } else {
        const colName = isQuery ? target.colRef.collectionName : target.collectionName;
        if (!_clientLimitWarned.has(colName)) {
            _clientLimitWarned.add(colName);
            console.warn(
                `[supabase-client-db] Query on '${colName}' has no limit() and is capped at ` +
                `${CLIENT_DEFAULT_LIMIT} rows. Give it a limit — this runs in the browser, and ` +
                `onSnapshot repeats it every 8 seconds.`
            );
        }
        query = query.limit(CLIENT_DEFAULT_LIMIT);
    }

    return query;
}

export const db = {};

export function collection(_db: any, path: string): ClientColRef {
    return new ClientColRef(path);
}

export function doc(_db: any, collectionPath: string, id: string): ClientDocRef {
    return new ClientDocRef(collectionPath, id);
}

export function query(base: ClientColRef | ClientQuery, ...clauses: any[]): ClientQuery {
    const q = base instanceof ClientQuery ? base : new ClientQuery(base);
    clauses.forEach(c => {
        if (c?.type === 'where') q.filters.push(c.filter);
        if (c?.type === 'limit') q.limitVal = c.value;
        if (c?.type === 'orderBy') q.orderByVal.push(c.value);
    });
    return q;
}

export function where(field: string, op: string, value: any) {
    return { type: 'where', filter: { field, op, value } };
}

export function limit(value: number) {
    return { type: 'limit', value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return { type: 'orderBy', value: { field, direction } };
}

// Custom Timestamp shim matching Firebase structure
export class Timestamp {
    /** Admin-style aliases — see the note in firestore-compat.Timestamp. */
    public readonly _seconds: number;
    public readonly _nanoseconds: number;

    constructor(public readonly seconds: number, public readonly nanoseconds: number) {
        this._seconds = seconds;
        this._nanoseconds = nanoseconds;
    }

    static now(): Timestamp {
        const ms = Date.now();
        return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
    }

    static fromDate(date: Date): Timestamp {
        const ms = date.getTime();
        return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
    }

    toDate(): Date {
        return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
    }

    toMillis(): number {
        return this.seconds * 1000 + this.nanoseconds / 1e6;
    }
}

/**
 * Turn ISO datetime strings into Timestamp shims, everywhere in the document.
 *
 * This used to be one line, on one field:
 *
 *     if (raw.createdAt && typeof raw.createdAt === 'string') { ... }
 *     // "Map string dates to Timestamp shims so doc.data().createdAt.toDate() works!"
 *
 * It worked for createdAt and for nothing else. updatedAt, timestamp, date,
 * registeredAt, lastMessageAt, scheduledAt, expiresAt — every one of them came
 * back as a plain string, so a component calling `.toDate()` on any of them
 * threw, and one calling `.toMillis()` got undefined and then NaN. The server
 * adapter converts the whole document recursively (convertStringsToTimestamps);
 * this is the same rule, with the same regex, so the two readers agree about
 * what a document looks like.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function hydrateTimestamps(value: any): any {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        if (!ISO_DATE.test(value)) return value;
        const d = new Date(value);
        return isNaN(d.getTime()) ? value : Timestamp.fromDate(d);
    }

    if (Array.isArray(value)) return value.map(hydrateTimestamps);

    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') return value;
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) out[k] = hydrateTimestamps(v);
        return out;
    }

    return value;
}

/**
 * A row as a document, native columns included.
 *
 * The select was `'id, raw_data'` for every table, so on a DEDICATED table the
 * native columns — status, user_id, email, roles, balance, amount, created_at —
 * were simply absent from doc.data(). That mattered because the filters DO use
 * them: applyClientFilter routes `where("status", ...)` to the native `status`
 * column. The reader filtered on one copy of a field and returned the other, so
 * a row selected by its native status could come back with no status at all.
 * Mirrors SupabaseQuery._mapRow.
 */
function mapRow(row: any, isDedicated: boolean): any {
    const rawData = row.raw_data ?? {};
    const id = row.id || rawData.id;
    const merged: Record<string, any> = { ...rawData };
    if (!merged.id) merged.id = id;

    if (isDedicated) {
        if (row.status !== undefined && merged.status === undefined) merged.status = row.status;
        if (row.status !== undefined && merged.membershipStatus === undefined) merged.membershipStatus = row.status;
        if (row.user_id !== undefined && merged.userId === undefined) merged.userId = row.user_id;
        if (row.email !== undefined && merged.email === undefined) merged.email = row.email;
        if (row.roles !== undefined && merged.roles === undefined) merged.roles = row.roles;
        if (row.balance !== undefined && merged.balance === undefined) merged.balance = row.balance;
        if (row.amount !== undefined && merged.amount === undefined) merged.amount = row.amount;
        if (row.total_amount !== undefined && merged.totalAmount === undefined) merged.totalAmount = row.total_amount;
        if (row.created_at !== undefined) merged.createdAt = merged.createdAt || row.created_at;
        if (row.updated_at !== undefined) merged.updatedAt = merged.updatedAt || row.updated_at;
    }

    const data = hydrateTimestamps(merged);

    return {
        id,
        data: () => data,
        exists: () => true,
    };
}

/** The column list to select — everything on a dedicated table, as the server does. */
function selectList(tableName: string): string {
    return tableName === 'document_collections' ? 'id, raw_data' : '*';
}

// Client onSnapshot listener using polling
export function onSnapshot(
    target: ClientDocRef | ClientColRef | ClientQuery,
    onNext: (snapshot: any) => void,
    onError?: (error: any) => void
) {
    let isCancelled = false;

    async function poll() {
        if (isCancelled) return;
        try {
            if (target instanceof ClientDocRef) {
                const tableName = getTableName(target.collectionName);
                let query = supabase.from(tableName).select(selectList(tableName));

                if (tableName === 'document_collections') {
                    query = query.eq('id', target.id).eq('collection_name', target.collectionName);
                } else {
                    query = query.eq('id', target.id);
                }

                const { data, error } = await query.maybeSingle();
                if (error) throw error;

                // Through the same mapper as a query result, so a document
                // read one way is not a different shape from the same document
                // read the other. Native columns were missing from both single
                // reads, and only createdAt was ever hydrated.
                const exists = !!data;
                const snap = exists
                    ? mapRow({ ...(data as Record<string, any>), id: target.id }, tableName !== 'document_collections')
                    : null;

                if (!isCancelled) {
                    onNext({
                        exists: () => exists,
                        data: () => (snap ? snap.data() : null),
                        id: target.id,
                    });
                }
            } else {
                const colName = target instanceof ClientQuery ? target.colRef.collectionName : target.collectionName;
                const tableName = getTableName(colName);
                let query = supabase.from(tableName).select(selectList(tableName));

                if (tableName === 'document_collections') {
                    query = query.eq('collection_name', colName);
                }

                query = applyQueryClauses(query, tableName, target);

                const { data, error } = await query;
                if (error) throw error;

                if (!isCancelled) {
                    const docs = (data ?? []).map(row =>
                        mapRow(row, tableName !== 'document_collections'));

                    onNext({
                        docs,
                        size: docs.length,
                        empty: docs.length === 0,
                        forEach: (cb: any) => docs.forEach(cb),
                    });
                }
            }
            consecutiveErrors = 0;
        } catch (err) {
            consecutiveErrors++;
            if (onError && !isCancelled) onError(err);
        }
    }

    /**
     * A FAILING LISTENER STOPS INSTEAD OF HAMMERING THE DATABASE FOR EVER.
     *
     * This was a bare `setInterval(poll, 8000)`, and a poll that threw only
     * called onError — the interval kept firing. An expired session, a revoked
     * RLS grant or a dropped connection therefore produced one failed query
     * every eight seconds, from every open tab, indefinitely, with an onError
     * callback firing behind it each time. Nothing anywhere backed off.
     *
     * Consecutive failures back the interval off and, past a limit, stop the
     * listener — with a final onError so a caller can tell "stopped" from
     * "quiet". A success resets it.
     */
    const BASE_INTERVAL_MS = 8000;
    const MAX_CONSECUTIVE_ERRORS = 5;
    let consecutiveErrors = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
        if (isCancelled) return;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            isCancelled = true;
            onError?.(new Error(
                `[supabase-client-db] Listener stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive ` +
                `failures. Re-subscribe once the cause is resolved.`
            ));
            return;
        }

        // 8s, 16s, 32s, 64s, 128s.
        const delay = BASE_INTERVAL_MS * Math.pow(2, consecutiveErrors);
        timer = setTimeout(async () => {
            await poll();
            schedule();
        }, delay);
    }

    poll().then(schedule);

    return () => {
        isCancelled = true;
        if (timer) clearTimeout(timer);
    };
}

export async function deleteDoc(docRef: ClientDocRef): Promise<void> {
    const tableName = getTableName(docRef.collectionName);
    let query = supabase.from(tableName).delete();
    if (tableName === 'document_collections') {
        query = query.eq('id', docRef.id).eq('collection_name', docRef.collectionName);
    } else {
        query = query.eq('id', docRef.id);
    }
    const { error } = await query;
    if (error) throw error;
}

export async function getDocs(target: ClientColRef | ClientQuery) {
    const colName = target instanceof ClientQuery ? target.colRef.collectionName : target.collectionName;
    const tableName = getTableName(colName);
    let query = supabase.from(tableName).select(selectList(tableName));

    if (tableName === 'document_collections') {
        query = query.eq('collection_name', colName);
    }

    query = applyQueryClauses(query, tableName, target);

    const { data, error } = await query;
    if (error) throw error;

    const docs = (data ?? []).map(row =>
        mapRow(row, tableName !== 'document_collections'));

    return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: (cb: any) => docs.forEach(cb),
    };
}

export async function getDoc(docRef: ClientDocRef) {
    const tableName = getTableName(docRef.collectionName);
    let query = supabase.from(tableName).select(selectList(tableName));

    if (tableName === 'document_collections') {
        query = query.eq('id', docRef.id).eq('collection_name', docRef.collectionName);
    } else {
        query = query.eq('id', docRef.id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    const exists = !!data;
    const snap = exists
        ? mapRow({ ...(data as Record<string, any>), id: docRef.id }, tableName !== 'document_collections')
        : null;

    return {
        exists: () => exists,
        data: () => (snap ? snap.data() : null),
        id: docRef.id,
    };
}
