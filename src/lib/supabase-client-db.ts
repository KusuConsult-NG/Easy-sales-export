import { supabase } from './supabase';

// Table and Column Mappings matching supabase-db.ts
const TABLE_MAP: Record<string, string> = {
    'users': 'users',
    'cooperative_members': 'cooperative_members',
    'cooperative_loans': 'cooperative_loans',
    'transactions': 'transactions',
    'processed_payments': 'processed_payments',
    'marketplace_orders': 'marketplace_orders',
    'wallets': 'wallets',
    'academy_applications': 'academy_applications',
};

const NATIVE_COLUMNS: Record<string, string[]> = {
    'users': ['id', 'email', 'roles', 'created_at', 'updated_at'],
    'cooperative_members': ['id', 'user_id', 'status', 'created_at', 'updated_at'],
    'cooperative_loans': ['id', 'user_id', 'amount', 'status', 'created_at', 'updated_at'],
    'transactions': ['id', 'user_id', 'amount', 'type', 'status', 'created_at', 'updated_at'],
    'processed_payments': ['id', 'user_id', 'amount', 'reference', 'created_at', 'updated_at'],
    'marketplace_orders': ['id', 'user_id', 'status', 'total_amount', 'created_at', 'updated_at'],
    'wallets': ['id', 'balance', 'created_at', 'updated_at'],
    'academy_applications': ['id', 'user_id', 'status', 'created_at', 'updated_at'],
};

const FIELD_TO_COLUMN: Record<string, Record<string, string>> = {
    'users': { 'email': 'email', 'roles': 'roles' },
    'cooperative_members': { 'userId': 'user_id', 'status': 'status' },
    'cooperative_loans': { 'userId': 'user_id', 'status': 'status', 'amount': 'amount' },
    'transactions': { 'userId': 'user_id', 'type': 'type', 'status': 'status', 'amount': 'amount' },
    'processed_payments': { 'userId': 'user_id', 'reference': 'reference', 'amount': 'amount' },
    'marketplace_orders': { 'userId': 'user_id', 'status': 'status' },
    'wallets': { 'id': 'id', 'balance': 'balance' },
    'academy_applications': { 'userId': 'user_id', 'status': 'status' },
};

function getTableName(collection: string): string {
    const parts = collection.split('/');
    const rootCol = parts[0];
    return TABLE_MAP[rootCol] || 'document_collections';
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
        return nativeCol
            ? query.overlaps(nativeCol, values)
            : query.filter(`raw_data->${f.field}`, 'ov', JSON.stringify(values));
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

    const lim = isQuery ? target.limitVal : null;
    if (lim !== null) query = query.limit(lim);

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
                let query = supabase.from(tableName).select('raw_data');

                if (tableName === 'document_collections') {
                    query = query.eq('id', target.id).eq('collection_name', target.collectionName);
                } else {
                    query = query.eq('id', target.id);
                }

                const { data, error } = await query.maybeSingle();
                if (error) throw error;

                const raw = data?.raw_data ?? null;
                const exists = !!raw;

                if (!isCancelled) {
                    onNext({
                        exists: () => exists,
                        data: () => raw,
                        id: target.id,
                    });
                }
            } else {
                const colName = target instanceof ClientQuery ? target.colRef.collectionName : target.collectionName;
                const tableName = getTableName(colName);
                let query = supabase.from(tableName).select('id, raw_data');

                if (tableName === 'document_collections') {
                    query = query.eq('collection_name', colName);
                }

                query = applyQueryClauses(query, tableName, target);

                const { data, error } = await query;
                if (error) throw error;

                if (!isCancelled) {
                    const docs = (data ?? []).map(row => {
                        const raw = row.raw_data || {};
                        const id = row.id || raw.id;
                        if (raw.createdAt && typeof raw.createdAt === 'string') {
                            // Map string dates to Timestamp shims so doc.data().createdAt.toDate() works!
                            const d = new Date(raw.createdAt);
                            raw.createdAt = Timestamp.fromDate(d);
                        }
                        return {
                            id,
                            data: () => raw,
                            exists: () => true,
                        };
                    });

                    onNext({
                        docs,
                        size: docs.length,
                        empty: docs.length === 0,
                        forEach: (cb: any) => docs.forEach(cb),
                    });
                }
            }
        } catch (err) {
            if (onError && !isCancelled) onError(err);
        }
    }

    poll();
    // Poll every 8 seconds for dashboard lists
    const interval = setInterval(poll, 8000);

    return () => {
        isCancelled = true;
        clearInterval(interval);
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
    let query = supabase.from(tableName).select('id, raw_data');

    if (tableName === 'document_collections') {
        query = query.eq('collection_name', colName);
    }

    query = applyQueryClauses(query, tableName, target);

    const { data, error } = await query;
    if (error) throw error;

    const docs = (data ?? []).map(row => {
        const raw = row.raw_data || {};
        const id = row.id || raw.id;
        if (raw.createdAt && typeof raw.createdAt === 'string') {
            const d = new Date(raw.createdAt);
            raw.createdAt = Timestamp.fromDate(d);
        }
        return {
            id,
            data: () => raw,
            exists: () => true,
        };
    });

    return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: (cb: any) => docs.forEach(cb),
    };
}

export async function getDoc(docRef: ClientDocRef) {
    const tableName = getTableName(docRef.collectionName);
    let query = supabase.from(tableName).select('raw_data');

    if (tableName === 'document_collections') {
        query = query.eq('id', docRef.id).eq('collection_name', docRef.collectionName);
    } else {
        query = query.eq('id', docRef.id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    const raw = data?.raw_data ?? null;
    const exists = !!raw;

    return {
        exists: () => exists,
        data: () => raw,
        id: docRef.id,
    };
}
