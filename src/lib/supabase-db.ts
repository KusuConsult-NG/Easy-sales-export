/**
 * Supabase Database Adapter — Firestore-Compatible API
 *
 * Drop-in replacement for the Firestore `db` object.
 * Exposes the same API surface as Firestore Admin SDK so all existing
 * .collection().doc().get() / .where().get() / .set() / .update() / etc.
 * calls work WITHOUT any business logic changes.
 *
 * Architecture:
 * - 8 core collections → dedicated Supabase tables (fast, indexed columns)
 * - ALL other collections → document_collections generic table (JSONB raw_data)
 * - FieldValue sentinels (serverTimestamp, arrayUnion, increment, delete) → handled in writes
 * - Transactions → sequential read-then-write (sufficient for this app's patterns)
 * - Batch writes → sequential Supabase upserts
 *
 * This file is the SINGLE source of truth for all database reads and writes.
 * Firebase Firestore is no longer used for data — only Firebase Auth remains.
 */

import { supabaseAdmin } from './supabase';
import { v4 as uuidv4 } from 'uuid';
import { Timestamp } from './firestore-compat';

// ─── Table Mapping ─────────────────────────────────────────────────────────────
// Maps Firestore collection names → dedicated Supabase table names.
// Collections NOT listed here fall back to the `document_collections` generic table.

const DEDICATED_TABLE_MAP: Record<string, string> = {
    'users': 'users',
    'cooperative_members': 'cooperative_members',
    'cooperative_loans': 'cooperative_loans',
    'transactions': 'transactions',
    'processedPayments': 'processed_payments',  // Firestore camelCase → snake_case table
    'processed_payments': 'processed_payments', // Also accept snake_case
    'marketplaceOrders': 'marketplace_orders',  // Firestore camelCase → snake_case table
    'marketplace_orders': 'marketplace_orders', // Also accept snake_case
    'wallets': 'wallets',
    'academy_applications': 'academy_applications',
};

// Native typed columns per dedicated table (used to route .where() filters efficiently)
// Fields NOT listed here are stored in raw_data JSONB and queried via raw_data->>'field'
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

// Firestore field name → Supabase native column name (for dedicated tables)
// These map the app's data model field names to the actual SQL column names
const FIELD_TO_COLUMN: Record<string, Record<string, string>> = {
    'users': {
        'email': 'email',
        'roles': 'roles',
    },
    'cooperative_members': {
        'userId': 'user_id',
        'membershipStatus': 'status',
        'status': 'status',
    },
    'cooperative_loans': {
        'userId': 'user_id',
        'status': 'status',
        'amount': 'amount',
    },
    'transactions': {
        'userId': 'user_id',
        'type': 'type',
        'status': 'status',
        'amount': 'amount',
    },
    'processed_payments': {
        'userId': 'user_id',
        'reference': 'reference',
        'amount': 'amount',
    },
    'marketplace_orders': {
        'userId': 'user_id',
        'status': 'status',
        'totalAmount': 'total_amount',
    },
    'wallets': {
        'balance': 'balance',
    },
    'academy_applications': {
        'userId': 'user_id',
        'status': 'status',
    },
};

function getTableName(collection: string): string {
    return DEDICATED_TABLE_MAP[collection] || 'document_collections';
}

function isDedicatedTable(collection: string): boolean {
    return collection in DEDICATED_TABLE_MAP;
}

// ─── FieldValue Detection & Processing ────────────────────────────────────────

/**
 * Detects FieldValue sentinel objects from firebase-admin/firestore.
 * These have a _methodName property set by the Firestore SDK internals.
 */
function getFieldValueType(value: any): string | null {
    if (!value || typeof value !== 'object') return null;
    // Primary detection: _methodName property (set by @google-cloud/firestore)
    if (typeof value._methodName === 'string') return value._methodName;
    // Fallback: constructor name detection
    const ctorName = value?.constructor?.name || '';
    if (ctorName === 'ServerTimestampTransform') return 'FieldValue.serverTimestamp';
    if (ctorName === 'ArrayUnionTransform') return 'FieldValue.arrayUnion';
    if (ctorName === 'ArrayRemoveTransform') return 'FieldValue.arrayRemove';
    if (ctorName === 'NumericIncrementTransform') return 'FieldValue.increment';
    if (ctorName === 'DeleteTransform') return 'FieldValue.delete';
    return null;
}

/**
 * Resolves a single FieldValue against its existing value.
 */
function resolveFieldValue(fvType: string, fvObj: any, existing: any): any {
    switch (fvType) {
        case 'FieldValue.serverTimestamp':
            return new Date().toISOString();
        case 'FieldValue.arrayUnion': {
            const arr = Array.isArray(existing) ? [...existing] : [];
            const elements = fvObj._elements || [];
            for (const el of elements) {
                const elStr = JSON.stringify(el);
                if (!arr.some(a => JSON.stringify(a) === elStr)) arr.push(el);
            }
            return arr;
        }
        case 'FieldValue.arrayRemove': {
            const arr = Array.isArray(existing) ? [...existing] : [];
            const elements = fvObj._elements || [];
            return arr.filter(a => {
                const aStr = JSON.stringify(a);
                return !elements.some((e: any) => JSON.stringify(e) === aStr);
            });
        }
        case 'FieldValue.increment':
            return (typeof existing === 'number' ? existing : 0) + (fvObj._operand || 0);
        case 'FieldValue.delete':
            return undefined; // Signal field deletion
        default:
            return fvObj;
    }
}

/**
 * Reads a value at a dotted path from an object.
 */
function getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}

/**
 * Sets a value at a dotted path in an object (mutating).
 */
function setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
            cur[parts[i]] = {};
        }
        cur = cur[parts[i]];
    }
    if (value === undefined) {
        delete cur[parts[parts.length - 1]];
    } else {
        cur[parts[parts.length - 1]] = value;
    }
}

/**
 * Recursively convert Firestore Timestamp objects to ISO strings.
 */
function convertTimestamps(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    // Firestore Timestamp has _seconds and _nanoseconds, or toDate() method
    if (obj && typeof obj === 'object' && typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
    }
    if (obj && typeof obj === 'object' && typeof obj._seconds === 'number') {
        return new Date(obj._seconds * 1000).toISOString();
    }
    if (Array.isArray(obj)) return obj.map(convertTimestamps);
    if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [k, v] of Object.entries(obj)) result[k] = convertTimestamps(v);
        return result;
    }
    return obj;
}

/**
 * Recursively convert ISO datetime strings back to Firestore Timestamp objects for read compatibility.
 */
function convertStringsToTimestamps(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        if (isoDateRegex.test(obj)) {
            const d = new Date(obj);
            if (!isNaN(d.getTime())) {
                try {
                    return Timestamp.fromDate(d);
                } catch {
                    return obj;
                }
            }
        }
        return obj;
    }

    if (Array.isArray(obj)) return obj.map(convertStringsToTimestamps);

    if (typeof obj === 'object') {
        if (typeof obj.toDate === 'function') return obj;

        const result: any = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = convertStringsToTimestamps(v);
        }
        return result;
    }

    return obj;
}

/**
 * Process a data payload containing FieldValue sentinels and dotted paths.
 * Returns a merged object with all sentinels resolved against existingData.
 * Used for both set() and update() operations.
 */
function processWriteData(
    data: Record<string, any>,
    existingData: Record<string, any>,
    isUpdate: boolean,
): Record<string, any> {
    // Start from existing data (for updates) or empty object (for sets)
    const result: Record<string, any> = isUpdate ? { ...existingData } : {};

    for (const [key, rawValue] of Object.entries(data)) {
        const fvType = getFieldValueType(rawValue);

        if (fvType) {
            // FieldValue sentinel — resolve against existing
            const existingVal = getNestedValue(key.includes('.') ? result : result, key.includes('.') ? key : key);
            const resolved = resolveFieldValue(fvType, rawValue, existingVal);
            if (key.includes('.')) {
                setNestedValue(result, key, resolved);
            } else {
                if (resolved === undefined) {
                    delete result[key];
                } else {
                    result[key] = resolved;
                }
            }
        } else if (key.includes('.')) {
            // Dotted path notation (e.g. "serviceRegistrations.cooperatives.status")
            const existing = getNestedValue(result, key);
            const resolved = (rawValue && typeof rawValue === 'object' && getFieldValueType(rawValue))
                ? resolveFieldValue(getFieldValueType(rawValue)!, rawValue, existing)
                : rawValue;
            setNestedValue(result, key, resolved);
        } else {
            // Regular field: recursively process nested FieldValues
            result[key] = processNestedFieldValues(rawValue, existingData[key]);
        }
    }

    return convertTimestamps(result);
}

/**
 * Recursively resolve FieldValue sentinels inside nested objects/arrays.
 */
function processNestedFieldValues(value: any, existing: any): any {
    const fvType = getFieldValueType(value);
    if (fvType) return resolveFieldValue(fvType, value, existing);
    if (Array.isArray(value)) return value.map((v, i) => processNestedFieldValues(v, Array.isArray(existing) ? existing[i] : undefined));
    if (value && typeof value === 'object' && typeof value.toDate !== 'function') {
        const result: any = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = processNestedFieldValues(v, existing?.[k]);
        }
        return result;
    }
    return convertTimestamps(value);
}

// ─── Row Builders ─────────────────────────────────────────────────────────────

/**
 * Extract native column values from processed data for a dedicated table.
 */
function buildDedicatedRow(tableName: string, id: string, data: Record<string, any>): Record<string, any> {
    const cols = NATIVE_COLUMNS[tableName] || [];
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};
    const row: Record<string, any> = { id, raw_data: data };

    // Map native columns from data
    for (const [firestoreField, sqlCol] of Object.entries(fieldMap)) {
        if (firestoreField in data && data[firestoreField] !== undefined) {
            row[sqlCol] = data[firestoreField];
        }
    }

    // Special handling: ensure id is in raw_data (some code reads .id from .data())
    if (row.raw_data && !row.raw_data.id) {
        row.raw_data = { ...row.raw_data, id };
    }

    return row;
}

/**
 * Build a row for the document_collections generic table.
 */
function buildGenericRow(collection: string, id: string, data: Record<string, any>): Record<string, any> {
    // Ensure id is in raw_data so doc.data().id works
    const raw_data = { ...data };
    if (!raw_data.id) raw_data.id = id;
    return {
        id,
        collection_name: collection,
        raw_data,
    };
}

// ─── Supabase Write Helpers ───────────────────────────────────────────────────

async function supabaseUpsert(
    collection: string,
    id: string,
    data: Record<string, any>,
): Promise<void> {
    const tableName = getTableName(collection);

    if (tableName === 'document_collections') {
        const row = buildGenericRow(collection, id, data);
        const { error } = await supabaseAdmin
            .from('document_collections')
            .upsert(row, { onConflict: 'id,collection_name' });
        if (error) throw new Error(`[supabase-db] upsert ${collection}/${id}: ${error.message}`);
    } else {
        const row = buildDedicatedRow(tableName, id, data);
        const { error } = await supabaseAdmin
            .from(tableName)
            .upsert(row, { onConflict: 'id' });
        if (error) throw new Error(`[supabase-db] upsert ${tableName}/${id}: ${error.message}`);
    }
}

async function supabaseDelete(collection: string, id: string): Promise<void> {
    const tableName = getTableName(collection);
    if (tableName === 'document_collections') {
        const { error } = await supabaseAdmin
            .from('document_collections')
            .delete()
            .eq('id', id)
            .eq('collection_name', collection);
        if (error) throw new Error(`[supabase-db] delete ${collection}/${id}: ${error.message}`);
    } else {
        const { error } = await supabaseAdmin
            .from(tableName)
            .delete()
            .eq('id', id);
        if (error) throw new Error(`[supabase-db] delete ${tableName}/${id}: ${error.message}`);
    }
}

// ─── Query Builder ────────────────────────────────────────────────────────────

type FilterOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';

interface WhereFilter {
    field: string;
    op: FilterOperator;
    value: any;
}

interface OrderByClause {
    field: string;
    direction: 'asc' | 'desc';
}

/**
 * Map a Firestore field name + operator to a Supabase query filter.
 * Handles both native columns and raw_data JSONB fields.
 */
function applyFilter(
    query: any,
    tableName: string,
    collection: string,
    filter: WhereFilter,
): any {
    const { field, op, value } = filter;

    let normalizedValue = value;
    if (Array.isArray(value)) {
        normalizedValue = value.map(v => {
            if (v instanceof Date) return v.toISOString();
            if (v && typeof v === 'object') {
                if (typeof v.toDate === 'function') return v.toDate().toISOString();
                if (typeof v.toISOString === 'function') return v.toISOString();
            }
            return v;
        });
    } else if (value instanceof Date) {
        normalizedValue = value.toISOString();
    } else if (value && typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            normalizedValue = value.toDate().toISOString();
        } else if (typeof value.toISOString === 'function') {
            normalizedValue = value.toISOString();
        }
    }

    // Special: FieldPath.documentId() — filter on the primary key `id`
    if (field === '__name__' || field === '__id__' || (typeof field === 'object' && (field as any)._methodName === 'FieldPath.documentId')) {
        if (op === 'in' && Array.isArray(normalizedValue)) {
            return query.in('id', normalizedValue);
        }
        return applySimpleFilter(query, 'id', op, normalizedValue);
    }

    // Check if this field has a native column mapping
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};
    const nativeCol = fieldMap[field];

    if (nativeCol) {
        // Route to native SQL column
        if (op === 'array-contains') {
            // For TEXT[] arrays like roles
            return query.contains(nativeCol, [normalizedValue]);
        }
        return applySimpleFilter(query, nativeCol, op, normalizedValue);
    }

    // Check if field is a direct native column name (e.g. 'email' on users)
    const cols = NATIVE_COLUMNS[tableName] || [];
    if (cols.includes(field)) {
        if (op === 'array-contains') {
            return query.contains(field, [normalizedValue]);
        }
        return applySimpleFilter(query, field, op, normalizedValue);
    }

    // Otherwise: JSONB query on raw_data
    return applyJsonbFilter(query, field, op, normalizedValue);
}

function applySimpleFilter(query: any, column: string, op: FilterOperator, value: any): any {
    switch (op) {
        case '==': return query.eq(column, value);
        case '!=': return query.neq(column, value);
        case '<': return query.lt(column, value);
        case '<=': return query.lte(column, value);
        case '>': return query.gt(column, value);
        case '>=': return query.gte(column, value);
        case 'in': return query.in(column, Array.isArray(value) ? value : [value]);
        case 'not-in': return query.not(column, 'in', `(${(Array.isArray(value) ? value : [value]).map((v: any) => `"${v}"`).join(',')})`);
        default: return query.eq(column, value);
    }
}

function applyJsonbFilter(query: any, field: string, op: FilterOperator, value: any): any {
    // Convert dotted path to PostgREST JSONB path
    // e.g. "serviceRegistrations.cooperatives.status" → "raw_data->serviceRegistrations->cooperatives->>status"
    const parts = field.split('.');
    let jsonPath: string;
    if (parts.length === 1) {
        jsonPath = `raw_data->>${JSON.stringify(field)}`;  // raw_data->>'field'
    } else {
        const intermediate = parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('');
        jsonPath = `raw_data${intermediate}->>${JSON.stringify(parts[parts.length - 1])}`;
    }

    switch (op) {
        case '==':
            if (value === null) return query.is(jsonPath, null);
            return query.eq(jsonPath, String(value));
        case '!=':
            if (value === null) return query.not(jsonPath, 'is', null);
            return query.neq(jsonPath, String(value));
        case '<': return query.lt(jsonPath, String(value));
        case '<=': return query.lte(jsonPath, String(value));
        case '>': return query.gt(jsonPath, String(value));
        case '>=': return query.gte(jsonPath, String(value));
        case 'in': {
            // Use OR filters for each value
            const values = (Array.isArray(value) ? value : [value]).map(String);
            return query.in(jsonPath, values);
        }
        case 'array-contains': {
            // For JSONB arrays, use the @> (contains) operator
            const arrPath = parts.length === 1
                ? `raw_data->${JSON.stringify(field)}`
                : `raw_data${parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('')}->${JSON.stringify(parts[parts.length - 1])}`;
            return query.filter(arrPath, 'cs', JSON.stringify([value]));
        }
        case 'array-contains-any': {
            // Use the && (overlap) operator
            const arrPath = parts.length === 1
                ? `raw_data->${JSON.stringify(field)}`
                : `raw_data${parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('')}->${JSON.stringify(parts[parts.length - 1])}`;
            return query.filter(arrPath, 'cd', JSON.stringify(Array.isArray(value) ? value : [value]));
        }
        default: return query.eq(jsonPath, String(value));
    }
}

// ─── DocumentSnapshot ─────────────────────────────────────────────────────────

export class SupabaseDocumentSnapshot {
    public readonly id: string;
    public readonly ref: SupabaseDocumentReference;
    private _data: Record<string, any> | null;

    constructor(id: string, ref: SupabaseDocumentReference, data: Record<string, any> | null) {
        this.id = id;
        this.ref = ref;
        this._data = data;
    }

    get exists(): boolean { return this._data !== null; }

    data(): Record<string, any> | undefined {
        return this._data ?? undefined;
    }

    get(field: string): any {
        if (!this._data) return undefined;
        return this._data[field];
    }
}

// ─── QueryDocumentSnapshot ────────────────────────────────────────────────────

export class SupabaseQueryDocumentSnapshot extends SupabaseDocumentSnapshot {
    override data(): Record<string, any> {
        return super.data() ?? {};
    }
}

// ─── QuerySnapshot ────────────────────────────────────────────────────────────

export class SupabaseQuerySnapshot {
    public readonly docs: SupabaseQueryDocumentSnapshot[];

    constructor(docs: SupabaseQueryDocumentSnapshot[]) {
        this.docs = docs;
    }

    get size(): number { return this.docs.length; }
    get empty(): boolean { return this.docs.length === 0; }

    forEach(fn: (doc: SupabaseQueryDocumentSnapshot) => void): void {
        this.docs.forEach(fn);
    }
}

// ─── DocumentReference ────────────────────────────────────────────────────────

export class SupabaseDocumentReference {
    public readonly id: string;
    public readonly path: string;
    private readonly _collection: string;

    constructor(collection: string, id: string) {
        this._collection = collection;
        this.id = id;
        this.path = `${collection}/${id}`;
    }

    get parent(): SupabaseCollectionReference {
        return new SupabaseCollectionReference(this._collection);
    }

    async get(): Promise<SupabaseDocumentSnapshot> {
        const tableName = getTableName(this._collection);
        let raw: Record<string, any> | null = null;

        try {
            if (tableName === 'document_collections') {
                const { data, error } = await supabaseAdmin
                    .from('document_collections')
                    .select('raw_data')
                    .eq('id', this.id)
                    .eq('collection_name', this._collection)
                    .maybeSingle();
                if (error) throw error;
                raw = data?.raw_data ?? null;
            } else {
                const { data, error } = await supabaseAdmin
                    .from(tableName)
                    .select('*')
                    .eq('id', this.id)
                    .maybeSingle();
                if (error) throw error;
                if (data) {
                    raw = {
                        ...(data.raw_data ?? {}),
                        createdAt: data.created_at || data.raw_data?.createdAt,
                        updatedAt: data.updated_at || data.raw_data?.updatedAt,
                        email: data.email || data.raw_data?.email,
                        id: data.id
                    };
                }
            }
        } catch (err: any) {
            console.error(`[supabase-db] get ${this._collection}/${this.id}:`, err?.message);
            raw = null;
        }

        // Ensure id is accessible via .data().id
        if (raw && !raw.id) raw = { id: this.id, ...raw };
        const parsedRaw = raw ? convertStringsToTimestamps(raw) : null;
        return new SupabaseDocumentSnapshot(this.id, this, parsedRaw);
    }

    async set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
        let base: Record<string, any> = {};
        if (options?.merge) {
            const snap = await this.get();
            base = snap.data() ?? {};
        }
        const processed = processWriteData(data, base, !!options?.merge);
        if (!processed.id) processed.id = this.id;
        await supabaseUpsert(this._collection, this.id, processed);
    }

    async update(data: Record<string, any>): Promise<void> {
        const snap = await this.get();
        const existing = snap.data() ?? {};
        const processed = processWriteData(data, existing, true);
        if (!processed.id) processed.id = this.id;
        await supabaseUpsert(this._collection, this.id, processed);
    }

    async create(data: Record<string, any>): Promise<void> {
        const processed = processWriteData(data, {}, false);
        if (!processed.id) processed.id = this.id;
        const tableName = getTableName(this._collection);

        try {
            if (tableName === 'document_collections') {
                const row = buildGenericRow(this._collection, this.id, processed);
                const { error } = await supabaseAdmin.from('document_collections').insert(row);
                if (error) throw error;
            } else {
                const row = buildDedicatedRow(tableName, this.id, processed);
                const { error } = await supabaseAdmin.from(tableName).insert(row);
                if (error) throw error;
            }
        } catch (err: any) {
            // If already exists, throw ALREADY_EXISTS error (mimics Firestore)
            if (err.code === '23505' || err.message?.includes('duplicate')) {
                throw Object.assign(new Error(`Document ${this._collection}/${this.id} already exists`), { code: 'ALREADY_EXISTS' });
            }
            throw err;
        }
    }

    async delete(): Promise<void> {
        await supabaseDelete(this._collection, this.id);
    }

    // Subcollection support (used by cooperatives/members subcollection in dashboard)
    collection(name: string): SupabaseCollectionReference {
        return new SupabaseCollectionReference(`${this._collection}/${this.id}/${name}`);
    }
}

// ─── Query ────────────────────────────────────────────────────────────────────

export class SupabaseQuery {
    protected readonly _collection: string;
    protected _filters: WhereFilter[] = [];
    protected _limit: number | null = null;
    protected _offset: number | null = null;
    protected _orderBy: OrderByClause[] = [];
    protected _startAfterDoc: SupabaseDocumentSnapshot | null = null;
    protected _selectedFields: string[] | null = null;

    constructor(collection: string) {
        this._collection = collection;
    }

    protected _clone(): this {
        const q = new (this.constructor as any)(this._collection);
        q._filters = [...this._filters];
        q._limit = this._limit;
        q._offset = this._offset;
        q._orderBy = [...this._orderBy];
        q._startAfterDoc = this._startAfterDoc;
        q._selectedFields = this._selectedFields ? [...this._selectedFields] : null;
        return q;
    }

    where(field: string | any, op: string, value: any): this {
        const q = this._clone();
        // Handle FieldPath.documentId()
        const fieldName = (field && typeof field === 'object' && field._methodName === 'FieldPath.documentId')
            ? '__name__'
            : (typeof field === 'string' ? field : String(field));
        q._filters = [...this._filters, { field: fieldName, op: op as FilterOperator, value }];
        return q;
    }

    orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
        const q = this._clone();
        q._orderBy = [...this._orderBy, { field, direction }];
        return q;
    }

    limit(n: number): this {
        const q = this._clone();
        q._limit = n;
        return q;
    }

    offset(n: number): this {
        const q = this._clone();
        q._offset = n;
        return q;
    }

    startAfter(docOrValue: any): this {
        const q = this._clone();
        if (docOrValue instanceof SupabaseDocumentSnapshot) {
            q._startAfterDoc = docOrValue;
        }
        return q;
    }

    startAt(docOrValue: any): this {
        // Simplified: treat same as startAfter for pagination purposes
        return this.startAfter(docOrValue);
    }

    endBefore(_docOrValue: any): this {
        return this._clone();
    }

    endAt(_docOrValue: any): this {
        return this._clone();
    }

    /** Partial field selection (Firestore .select(...fields)) — we still fetch all raw_data from Supabase */
    select(..._fields: string[]): this {
        const q = this._clone();
        q._selectedFields = _fields;
        return q;
    }

    count(): { get(): Promise<{ data(): { count: number } }> } {
        return {
            get: async (): Promise<{ data(): { count: number } }> => {
                const tableName = getTableName(this._collection);
                let query = supabaseAdmin.from(tableName).select('*', { count: 'exact', head: true });

                if (tableName === 'document_collections') {
                    query = query.eq('collection_name', this._collection);
                }
                for (const filter of this._filters) {
                    query = applyFilter(query, tableName, this._collection, filter);
                }

                const { count, error } = await query;
                if (error) throw new Error(`[supabase-db] count ${this._collection}: ${error.message}`);
                
                return {
                    data() {
                        return { count: count ?? 0 };
                    }
                };
            }
        };
    }

    aggregate(spec: Record<string, any>): { get(): Promise<{ data(): Record<string, number> }> } {
        return {
            get: async (): Promise<{ data(): Record<string, number> }> => {
                const tableName = getTableName(this._collection);
                let query = supabaseAdmin.from(tableName).select('raw_data');

                if (tableName === 'document_collections') {
                    query = query.eq('collection_name', this._collection);
                }
                for (const filter of this._filters) {
                    query = applyFilter(query, tableName, this._collection, filter);
                }

                const { data, error } = await query;
                if (error) throw new Error(`[supabase-db] aggregate: ${error.message}`);

                const sums: Record<string, number> = {};
                for (const [key, value] of Object.entries(spec)) {
                    const field = (value as any)?._field || "amountDisbursed";
                    let sum = 0;
                    for (const row of data || []) {
                        const raw = row.raw_data || {};
                        sum += Number(raw[field]) || 0;
                    }
                    sums[key] = sum;
                }

                return {
                    data() {
                        return sums;
                    }
                };
            }
        };
    }



    async get(): Promise<SupabaseQuerySnapshot> {
        const tableName = getTableName(this._collection);
        let query = supabaseAdmin.from(tableName).select('id, raw_data');

        if (tableName === 'document_collections') {
            query = query.eq('collection_name', this._collection);
        }

        // Apply where filters
        for (const filter of this._filters) {
            query = applyFilter(query, tableName, this._collection, filter);
        }

        // Apply orderBy — map to native columns or raw_data JSONB text cast
        for (const ob of this._orderBy) {
            const fieldMap = FIELD_TO_COLUMN[tableName] || {};
            const cols = NATIVE_COLUMNS[tableName] || [];
            let colName: string;

            if (ob.field === 'createdAt' || ob.field === 'created_at') {
                colName = 'created_at'; // native timestamp column (all tables have this)
            } else if (fieldMap[ob.field]) {
                colName = fieldMap[ob.field];
            } else if (cols.includes(ob.field)) {
                colName = ob.field;
            } else {
                // JSONB text sort — works correctly for ISO dates and strings
                colName = `raw_data->>${JSON.stringify(ob.field)}`;
            }

            query = query.order(colName, { ascending: ob.direction === 'asc' });
        }

        // Apply cursor pagination (startAfter)
        if (this._startAfterDoc && this._orderBy.length > 0) {
            const firstOrderField = this._orderBy[0].field;
            let cursorValue = this._startAfterDoc.get(firstOrderField)
                ?? this._startAfterDoc.data()?.[firstOrderField];
                
            // Convert Firestore Timestamp objects or objects with seconds to ISO strings for SQL compatibility
            if (cursorValue && typeof cursorValue === 'object') {
                if (typeof cursorValue.toDate === 'function') {
                    cursorValue = cursorValue.toDate().toISOString();
                } else if (cursorValue.seconds !== undefined) {
                    cursorValue = new Date(cursorValue.seconds * 1000).toISOString();
                } else if (cursorValue._seconds !== undefined) {
                    cursorValue = new Date(cursorValue._seconds * 1000).toISOString();
                }
            }

            if (cursorValue !== undefined) {
                const fieldMap = FIELD_TO_COLUMN[tableName] || {};
                const cols = NATIVE_COLUMNS[tableName] || [];
                let colName = fieldMap[firstOrderField] || (cols.includes(firstOrderField) ? firstOrderField : null);
                if (!colName) colName = (firstOrderField === 'createdAt' || firstOrderField === 'created_at') ? 'created_at' : null;

                if (colName) {
                    if (this._orderBy[0].direction === 'desc') {
                        query = query.lt(colName, cursorValue);
                    } else {
                        query = query.gt(colName, cursorValue);
                    }
                }
            }
        }

        // Apply limit and fetch auto-paginated batches to bypass Supabase 1,000-row select caps
        const allData: any[] = [];
        const limitVal = this._limit ?? 999999;
        const offsetVal = this._offset ?? 0;
        let fetchedSoFar = 0;

        while (fetchedSoFar < limitVal) {
            const batchLimit = Math.min(1000, limitVal - fetchedSoFar);
            const rangeStart = offsetVal + fetchedSoFar;
            const rangeEnd = rangeStart + batchLimit - 1;

            const { data: batchData, error } = await query.range(rangeStart, rangeEnd);
            if (error) throw new Error(`[supabase-db] query ${this._collection}: ${error.message}`);
            if (!batchData || batchData.length === 0) break;

            allData.push(...batchData);
            fetchedSoFar += batchData.length;

            if (batchData.length < batchLimit) break;
        }

        const docs = allData.map((row: any) => {
            const rawData = row.raw_data ?? {};
            const id = row.id || rawData.id;
            const withId = rawData.id ? rawData : { id, ...rawData };
            const parsedWithId = convertStringsToTimestamps(withId);
            const ref = new SupabaseDocumentReference(this._collection, id);
            return new SupabaseQueryDocumentSnapshot(id, ref, parsedWithId);
        });

        return new SupabaseQuerySnapshot(docs);
    }
}

// ─── CollectionReference ──────────────────────────────────────────────────────

export class SupabaseCollectionReference extends SupabaseQuery {
    constructor(collection: string) {
        super(collection);
    }

    doc(id?: string): SupabaseDocumentReference {
        const docId = id || uuidv4();
        return new SupabaseDocumentReference(this._collection, docId);
    }

    async add(data: Record<string, any>): Promise<SupabaseDocumentReference> {
        const id = uuidv4();
        const ref = this.doc(id);
        await ref.set(data);
        return ref;
    }
}

// ─── Transaction ──────────────────────────────────────────────────────────────

/**
 * Supabase Transaction — sequential read-then-write.
 * Not truly ACID-atomic, but sufficient for all patterns in this codebase.
 * Batches all writes and executes them after all reads complete.
 */
export class SupabaseTransaction {
    private _pendingWrites: Array<() => Promise<void>> = [];

    get<T extends SupabaseDocumentReference | SupabaseQuery>(
        refOrQuery: T
    ): Promise<T extends SupabaseDocumentReference ? SupabaseDocumentSnapshot : SupabaseQuerySnapshot> {
        return refOrQuery.get() as any;
    }

    async getAll(...refs: SupabaseDocumentReference[]): Promise<SupabaseDocumentSnapshot[]> {
        return Promise.all(refs.map(ref => ref.get()));
    }

    set(ref: SupabaseDocumentReference, data: Record<string, any>, options?: { merge?: boolean }): void {
        this._pendingWrites.push(() => ref.set(data, options));
    }

    update(ref: SupabaseDocumentReference, data: Record<string, any>): void {
        this._pendingWrites.push(() => ref.update(data));
    }

    create(ref: SupabaseDocumentReference, data: Record<string, any>): void {
        this._pendingWrites.push(() => ref.create(data));
    }

    delete(ref: SupabaseDocumentReference): void {
        this._pendingWrites.push(() => ref.delete());
    }

    async _commit(): Promise<void> {
        for (const write of this._pendingWrites) {
            await write();
        }
    }
}

// ─── WriteBatch ───────────────────────────────────────────────────────────────

export class SupabaseWriteBatch {
    private _operations: Array<() => Promise<void>> = [];

    set(ref: SupabaseDocumentReference, data: Record<string, any>, options?: { merge?: boolean }): this {
        this._operations.push(() => ref.set(data, options));
        return this;
    }

    update(ref: SupabaseDocumentReference, data: Record<string, any>): this {
        this._operations.push(() => ref.update(data));
        return this;
    }

    create(ref: SupabaseDocumentReference, data: Record<string, any>): this {
        this._operations.push(() => ref.create(data));
        return this;
    }

    delete(ref: SupabaseDocumentReference): this {
        this._operations.push(() => ref.delete());
        return this;
    }

    async commit(): Promise<void> {
        for (const op of this._operations) {
            await op();
        }
    }
}

// ─── Main Database Object ─────────────────────────────────────────────────────

/**
 * The primary database interface — use this everywhere `db` was used before.
 * Matches the Firestore Admin SDK API surface.
 */
export const supabaseDb = {
    collection(name: string): SupabaseCollectionReference {
        return new SupabaseCollectionReference(name);
    },

    doc(path: string): SupabaseDocumentReference {
        const parts = path.split('/');
        if (parts.length < 2) throw new Error(`Invalid document path: ${path}`);
        const id = parts[parts.length - 1];
        const collection = parts.slice(0, -1).join('/');
        return new SupabaseDocumentReference(collection, id);
    },

    /**
     * Batch get multiple document references simultaneously.
     * Mimics db.getAll(...refs) from Firestore Admin SDK.
     */
    async getAll(...refs: SupabaseDocumentReference[]): Promise<SupabaseDocumentSnapshot[]> {
        return Promise.all(refs.map(ref => ref.get()));
    },

    async runTransaction<T>(
        fn: (transaction: SupabaseTransaction) => Promise<T>,
    ): Promise<T> {
        const tx = new SupabaseTransaction();
        const result = await fn(tx);
        await tx._commit();
        return result;
    },

    batch(): SupabaseWriteBatch {
        return new SupabaseWriteBatch();
    },
};

export function getAdminDb(): any {
    return supabaseDb;
}

// ─── Type Compatibility ───────────────────────────────────────────────────────
// Export type aliases so TypeScript files that import legacy names
// can transition gracefully.

export type Query = SupabaseQuery;
export type CollectionReference = SupabaseCollectionReference;
export type DocumentReference = SupabaseDocumentReference;
export type DocumentSnapshot = SupabaseDocumentSnapshot;
export type QuerySnapshot = SupabaseQuerySnapshot;
export type Transaction = SupabaseTransaction;
export type WriteBatch = SupabaseWriteBatch;

export function doc(dbInstance: any, path: string, ...segments: string[]) {
    if (typeof dbInstance.doc === 'function') {
        return dbInstance.doc(path, ...segments);
    }
    return doc(getAdminDb(), path, ...segments);
}

export function collection(dbInstance: any, path: string, ...segments: string[]) {
    if (typeof dbInstance.collection === 'function') {
        return dbInstance.collection(path, ...segments);
    }
    return collection(getAdminDb(), path, ...segments);
}

export async function getDoc(ref: any) {
    return ref.get();
}

export async function setDoc(ref: any, data: any, options?: any) {
    return ref.set(data, options);
}

export async function updateDoc(ref: any, data: any) {
    return ref.update(data);
}

export function increment(value: number) {
    return { __op: 'increment', value };
}

export function serverTimestamp() {
    return new Date();
}

export async function runTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
    if (typeof dbInstance.runTransaction === 'function') {
        return dbInstance.runTransaction(updateFunction);
    }
    return getAdminDb().runTransaction(updateFunction);
}


