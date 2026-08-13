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
import { Timestamp, FieldValue } from './firestore-compat';
import { invalidateCacheForCollection } from './cache-map';
import { logger } from './logger';

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

/**
 * Rows returned by a query that specifies no .limit().
 *
 * Chosen to match the existing 5,000-document threshold that
 * firestore-serialize already warns at, so the two agree. Reaching it is
 * reported, never silent — see SupabaseQuery.get().
 */
const DEFAULT_QUERY_LIMIT = Math.max(
    1,
    Number(process.env.SUPABASE_DEFAULT_QUERY_LIMIT) || 5000
);

/**
 * Runaway guard for `.all()`. Not a limit anyone should reach — hitting it
 * means the result is incomplete, and it is logged as an error rather than
 * quietly returned.
 */
const UNBOUNDED_CEILING = Math.max(
    DEFAULT_QUERY_LIMIT,
    Number(process.env.SUPABASE_UNBOUNDED_CEILING) || 500_000
);

const _unknownCollectionsWarned = new Set<string>();
const _limitReachedWarned = new Set<string>();

export function getTableName(collection: string): string {
    if (collection in DEDICATED_TABLE_MAP) {
        return DEDICATED_TABLE_MAP[collection];
    }

    if (!_unknownCollectionsWarned.has(collection)) {
        _unknownCollectionsWarned.add(collection);
        logger.warn(`[supabase-db] Collection '${collection}' is not in DEDICATED_TABLE_MAP. Falling back to document_collections table.`);
        if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
            import('@sentry/nextjs').then(Sentry => {
                Sentry.addBreadcrumb({
                    category: 'database',
                    message: `Unmapped collection fallback: ${collection}`,
                    level: 'warning',
                });
            }).catch(() => {});
        }
    }

    return 'document_collections';
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
    if (obj instanceof Date) {
        return obj.toISOString();
    }
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
    if (value && typeof value === 'object' && !(value instanceof Date) && typeof value.toDate !== 'function') {
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

/**
 * Partial update via PostgreSQL JSONB merge.
 *
 * Unlike supabaseUpsert (which replaces the entire raw_data object), this
 * function safely overlays only the supplied keys on top of existing raw_data.
 * All other keys in raw_data are preserved even if the in-memory read of the
 * existing document was incomplete or stale.
 *
 * Used by DocumentReference.update() to ensure admin edits never silently
 * wipe out fields that weren't part of the edit form.
 */
/**
 * Separates FieldValue.increment entries from the rest of a write.
 *
 * Increments must not be resolved in JavaScript — that is a read-modify-write
 * and loses concurrent updates. They are applied in SQL instead, by
 * applyIncrements below.
 */
function splitIncrements(data: Record<string, any>): {
    increments: Record<string, number>;
    rest: Record<string, any>;
} {
    const increments: Record<string, number> = {};
    const rest: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
        if (getFieldValueType(value) === 'FieldValue.increment') {
            const operand = Number((value as any)?._operand ?? 0);
            if (Number.isFinite(operand)) {
                increments[key] = operand;
                continue;
            }
            // A non-numeric operand is a caller bug. Fall through so the old
            // path handles it rather than silently dropping the field.
        }
        rest[key] = value;
    }

    return { increments, rest };
}

/**
 * Applies a targeted patch to a document in JavaScript.
 *
 * Only for the fallback path, when apply_document_patch is unavailable. It is a
 * read-modify-write and therefore NOT concurrent — the same defect this whole
 * change exists to remove — but it keeps dotted paths and deletions working on
 * a database that has not had migration 017 applied, rather than dropping them
 * silently. Silently dropping a delete is how FieldValue.delete() went
 * unnoticed for so long.
 */
function applyPatchInJs(
    base: Record<string, any>,
    patch: Record<string, any>,
    paths: Record<string, any>,
    deletes: string[],
): Record<string, any> {
    const merged: Record<string, any> = { ...base, ...patch };

    for (const [path, value] of Object.entries(paths)) {
        setNestedValue(merged, path, value);
    }

    for (const path of deletes) {
        if (!path.includes('.')) {
            delete merged[path];
            continue;
        }
        const parts = path.split('.');
        let cur: any = merged;
        for (let i = 0; i < parts.length - 1; i++) {
            if (cur == null || typeof cur !== 'object') { cur = null; break; }
            cur = cur[parts[i]];
        }
        if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
    }

    return merged;
}

/**
 * Flattens nested plain objects into dotted paths, for set(..., { merge: true }).
 *
 * Firestore distinguishes two things this adapter was treating identically:
 *
 *   update({ a: { b: 1 } })                 REPLACES a
 *   set({ a: { b: 1 } }, { merge: true })   MERGES b into a, keeping a's siblings
 *
 * Both were replacing, because the value went into the top-level patch and
 * merge_raw_data / apply_document_patch shallow-merge at the top level.
 *
 * The damage is concrete. A cooperative payment writes:
 *
 *   { serviceRegistrations: { cooperatives: {...} } }
 *
 * through set(merge). Replacing that object wipes the same user's `wave` and
 * `academy` registrations — so paying for one module silently revokes another.
 *
 * Flattening to `serviceRegistrations.cooperatives.status` makes each leaf its
 * own jsonb_set, which is what a deep merge is. Arrays and dates are leaves:
 * Firestore replaces arrays on merge rather than combining them.
 */
function flattenForMerge(
    value: any,
    prefix: string,
    out: Record<string, any>,
): void {
    const isPlainObject =
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        typeof value.toDate !== 'function' &&
        !getFieldValueType(value);

    // An empty object carries no leaves, so it has to be written as itself or
    // the write disappears.
    if (!isPlainObject || Object.keys(value).length === 0) {
        out[prefix] = value;
        return;
    }

    for (const [k, v] of Object.entries(value)) {
        flattenForMerge(v, `${prefix}.${k}`, out);
    }
}

/**
 * Builds a patch containing ONLY the fields a write actually changes.
 *
 * processWriteData returns `{ ...existingData, ...changes }` — the whole
 * document. That was correct but not concurrent: two updates to unrelated
 * fields clobber one another, because each writes back everything it read.
 * See supabase/migrations/017_targeted_document_patch.sql.
 *
 * The three shapes are separated because Firestore treats them differently and
 * a single shallow merge cannot express all three:
 *
 *   patch    top-level fields. `update({a: {x: 1}})` REPLACES a.
 *   paths    dotted paths. `update({"a.b": 1})` leaves a's siblings alone.
 *   deletes  FieldValue.delete(), which a merge can never express — an absent
 *            key means "unchanged", not "remove".
 *
 * Sentinels still resolve against `existing`, but only the ones that have to:
 * increments and top-level array ops are pulled out before this runs and are
 * applied in SQL.
 */
function buildWritePatch(
    data: Record<string, any>,
    existing: Record<string, any>,
): { patch: Record<string, any>; paths: Record<string, any>; deletes: string[] } {
    const patch: Record<string, any> = {};
    const paths: Record<string, any> = {};
    const deletes: string[] = [];

    for (const [key, rawValue] of Object.entries(data)) {
        const fvType = getFieldValueType(rawValue);

        if (fvType === 'FieldValue.delete') {
            deletes.push(key);
            continue;
        }

        if (fvType) {
            const resolved = resolveFieldValue(fvType, rawValue, getNestedValue(existing, key));
            if (resolved === undefined) {
                deletes.push(key);
            } else if (key.includes('.')) {
                paths[key] = convertTimestamps(resolved);
            } else {
                patch[key] = convertTimestamps(resolved);
            }
            continue;
        }

        // A nested object may still contain sentinels. They resolve against the
        // existing value at that position, as before.
        const resolved = processNestedFieldValues(rawValue, getNestedValue(existing, key));

        if (resolved === undefined) {
            deletes.push(key);
        } else if (key.includes('.')) {
            paths[key] = resolved;
        } else {
            patch[key] = resolved;
        }
    }

    return { patch, paths, deletes };
}

/**
 * Separates arrayUnion / arrayRemove entries from the rest of a write.
 *
 * Same reason as splitIncrements: resolving these in JavaScript reads the
 * array, appends to the value it just read, and writes it back. Two concurrent
 * writers each keep their own element and lose the other's.
 *
 * 33 of the call sites are `roles: FieldValue.arrayUnion(...)` on users, which
 * is what every module-access check reads — so a lost element is a paying user
 * with no access to the module they just paid for. See
 * supabase/migrations/016_atomic_array_ops.sql.
 */
function splitArrayOps(data: Record<string, any>): {
    arrayOps: Record<string, { union?: any[]; remove?: any[] }>;
    rest: Record<string, any>;
} {
    const arrayOps: Record<string, { union?: any[]; remove?: any[] }> = {};
    const rest: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
        const fvType = getFieldValueType(value);
        const elements = (value as any)?._elements;

        if ((fvType === 'FieldValue.arrayUnion' || fvType === 'FieldValue.arrayRemove')
            && Array.isArray(elements)) {
            const op = fvType === 'FieldValue.arrayUnion' ? 'union' : 'remove';
            arrayOps[key] = { ...(arrayOps[key] ?? {}), [op]: elements };
            continue;
        }

        // A sentinel with no _elements is a caller bug or an unrecognised
        // shape. Fall through to the old path rather than dropping the field.
        rest[key] = value;
    }

    return { arrayOps, rest };
}

/**
 * Applies array operations atomically in the database.
 *
 * Splits them into native typed columns and raw_data paths for the same reason
 * applyIncrements does — `roles` is a real TEXT[] column on `users` AND a key
 * inside raw_data, and the application reads the raw_data copy. Migration 016
 * derives the column from the new raw_data value so the two cannot drift.
 *
 * Falls back to the previous read-modify-write when the RPC is unavailable —
 * migration 016 not yet applied, or the mocked adapter under test. The fallback
 * is not atomic, and says so, but it keeps writes working rather than failing.
 */
async function applyArrayOps(
    collection: string,
    id: string,
    arrayOps: Record<string, { union?: any[]; remove?: any[] }>,
    existing: Record<string, any>,
): Promise<void> {
    const tableName = getTableName(collection);
    const nativeCols = NATIVE_COLUMNS[tableName] || [];
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};

    const nativeOps: Record<string, { union?: any[]; remove?: any[] }> = {};
    const jsonOps: Record<string, { union?: any[]; remove?: any[] }> = {};

    for (const [field, ops] of Object.entries(arrayOps)) {
        // Dotted paths always live in raw_data — a native column has no dots.
        // A native column is also only usable when every element is a string,
        // since these columns are TEXT[]; anything else goes to raw_data alone
        // rather than being refused by the database.
        const everyElementIsText = [...(ops.union ?? []), ...(ops.remove ?? [])]
            .every(el => typeof el === 'string');

        if (!field.includes('.') && everyElementIsText) {
            const column = fieldMap[field] ?? field;
            if (nativeCols.includes(column)) {
                nativeOps[column] = ops;
                continue;
            }
        }
        jsonOps[field] = ops;
    }

    try {
        const { error } = await supabaseAdmin.rpc('apply_array_ops', {
            p_table: tableName,
            p_id: id,
            p_collection: tableName === 'document_collections' ? collection : null,
            p_native: nativeOps,
            p_json: jsonOps,
        });

        if (!error) return;

        logger.warn(
            `[supabase-db] apply_array_ops RPC unavailable for ${collection}/${id} ` +
            `(${error.message}); falling back to a NON-ATOMIC array update. ` +
            `Apply supabase/migrations/016_atomic_array_ops.sql to fix this.`
        );
    } catch (err: any) {
        logger.warn(
            `[supabase-db] apply_array_ops RPC threw for ${collection}/${id} ` +
            `(${err?.message}); falling back to a NON-ATOMIC array update.`
        );
    }

    // Fallback: the old behaviour. Concurrent writes can still be lost here.
    const patch: Record<string, any> = {};
    for (const [field, ops] of Object.entries(arrayOps)) {
        let current = getNestedValue(existing, field);
        current = Array.isArray(current) ? [...current] : [];

        for (const el of ops.union ?? []) {
            const elStr = JSON.stringify(el);
            if (!current.some((a: any) => JSON.stringify(a) === elStr)) current.push(el);
        }
        if (ops.remove?.length) {
            const removeSet = ops.remove.map((e: any) => JSON.stringify(e));
            current = current.filter((a: any) => !removeSet.includes(JSON.stringify(a)));
        }
        patch[field] = current;
    }

    await supabasePartialUpdate(collection, id, patch);
}

/**
 * Applies increments atomically in the database.
 *
 * Splits them into native typed columns and raw_data paths, because both exist:
 * `balance` is a real column on `wallets`, while most counters live inside the
 * JSONB blob. The mapping lives here rather than in SQL because this module
 * already owns it.
 *
 * Falls back to the previous read-modify-write when the RPC is unavailable —
 * migration 010 not yet applied, or the mocked adapter under test. The fallback
 * is not atomic, and says so, but it keeps writes working rather than failing.
 */
async function applyIncrements(
    collection: string,
    id: string,
    increments: Record<string, number>,
    existing: Record<string, any>,
): Promise<void> {
    const tableName = getTableName(collection);
    const nativeCols = NATIVE_COLUMNS[tableName] || [];
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};

    const nativeIncrements: Record<string, number> = {};
    const jsonIncrements: Record<string, number> = {};

    for (const [field, delta] of Object.entries(increments)) {
        // Dotted paths always live in raw_data — a native column has no dots.
        if (!field.includes('.')) {
            const column = fieldMap[field] ?? field;
            if (nativeCols.includes(column)) {
                nativeIncrements[column] = (nativeIncrements[column] ?? 0) + delta;
                continue;
            }
        }
        jsonIncrements[field] = (jsonIncrements[field] ?? 0) + delta;
    }

    try {
        const { error } = await supabaseAdmin.rpc('apply_increments', {
            p_table: tableName,
            p_id: tableName === 'document_collections' ? id : id,
            p_collection: tableName === 'document_collections' ? collection : null,
            p_native: nativeIncrements,
            p_json: jsonIncrements,
        });

        if (!error) return;

        logger.warn(
            `[supabase-db] apply_increments RPC unavailable for ${collection}/${id} ` +
            `(${error.message}); falling back to a NON-ATOMIC increment. ` +
            `Apply supabase/migrations/010_atomic_increments.sql to fix this.`
        );
    } catch (err: any) {
        logger.warn(
            `[supabase-db] apply_increments RPC threw for ${collection}/${id} ` +
            `(${err?.message}); falling back to a NON-ATOMIC increment.`
        );
    }

    // Fallback: the old behaviour. Concurrent increments can still be lost here.
    const patch: Record<string, any> = {};
    for (const [field, delta] of Object.entries(increments)) {
        const current = Number(getNestedValue(existing, field) ?? 0);
        patch[field] = (Number.isFinite(current) ? current : 0) + delta;
    }
    await supabasePartialUpdate(collection, id, patch);
}

async function supabasePartialUpdate(
    collection: string,
    id: string,
    patch: Record<string, any>,
    /**
     * Dotted paths and deletions, which a shallow merge cannot express.
     *
     * A dotted path must not carry its whole parent object — that is what made
     * every write clobber concurrent changes. A deletion cannot be expressed by
     * a merge at all: an absent key means "unchanged", so FieldValue.delete()
     * was a silent no-op until migration 017.
     */
    extras?: { paths?: Record<string, any>; deletes?: string[] },
): Promise<void> {
    const paths = extras?.paths ?? {};
    const deletes = extras?.deletes ?? [];
    const tableName = getTableName(collection);

    // Extract native column overrides from the patch (e.g., email, roles for users table)
    const fieldMap = FIELD_TO_COLUMN[tableName] || {};
    const nativeOverrides: Record<string, any> = {};
    for (const [firestoreField, sqlCol] of Object.entries(fieldMap)) {
        if (firestoreField in patch && patch[firestoreField] !== undefined) {
            nativeOverrides[sqlCol] = patch[firestoreField];
        }
    }

    // Try server-side RPC merge first for 0-read atomic performance.
    //
    // apply_document_patch (017) is preferred because it can express dotted
    // paths and deletions. merge_raw_data can express neither, so it is only a
    // fallback for a database that has not had 017 applied yet — and on that
    // path the two shapes it cannot carry are handled in JavaScript below.
    try {
        const hasExtras = Object.keys(paths).length > 0 || deletes.length > 0;

        const { error: rpcErr } = await supabaseAdmin.rpc('apply_document_patch', {
            p_table: tableName,
            p_id: id,
            p_collection: tableName === 'document_collections' ? collection : null,
            p_patch: patch,
            p_paths: paths,
            p_deletes: deletes,
        });

        if (!rpcErr) {
            // If native column overrides exist, apply them
            if (Object.keys(nativeOverrides).length > 0 && tableName !== 'document_collections') {
                const { error: e2 } = await supabaseAdmin
                    .from(tableName)
                    .update(nativeOverrides)
                    .eq('id', id);
                if (e2) throw e2;
            }
            return;
        }

        // 017 not applied. merge_raw_data still handles the common case — a
        // plain shallow patch — without reading the document first. Anything it
        // cannot express falls through to the JavaScript path below.
        if (!hasExtras) {
            const { error: legacyErr } = await supabaseAdmin.rpc('merge_raw_data', {
                p_table: tableName,
                p_id: tableName === 'document_collections' ? `${collection}::${id}` : id,
                p_patch: patch,
            });

            if (!legacyErr) {
                if (Object.keys(nativeOverrides).length > 0 && tableName !== 'document_collections') {
                    const { error: e2 } = await supabaseAdmin
                        .from(tableName)
                        .update(nativeOverrides)
                        .eq('id', id);
                    if (e2) throw e2;
                }
                return;
            }
        }
    } catch {
        // Fall back to JS-level fetch+patch if RPC function is missing or in mock environment
    }

    if (tableName === 'document_collections') {
        // Fetch current raw_data, merge patch on top, then upsert full row
        const { data: existing, error: fetchErr } = await supabaseAdmin
            .from('document_collections')
            .select('raw_data')
            .eq('id', id)
            .eq('collection_name', collection)
            .maybeSingle();
        if (fetchErr) throw new Error(`[supabase-db] partial-update fetch ${collection}/${id}: ${fetchErr.message}`);

        const merged = applyPatchInJs(existing?.raw_data ?? {}, patch, paths, deletes);
        if (!merged.id) merged.id = id;
        const row = buildGenericRow(collection, id, merged);
        const { error } = await supabaseAdmin
            .from('document_collections')
            .upsert(row, { onConflict: 'id,collection_name' });
        if (error) throw new Error(`[supabase-db] partial-update upsert ${collection}/${id}: ${error.message}`);
    } else {
        // For dedicated tables: fetch current raw_data, merge patch on top, then PATCH
        const { data: cur, error: fetchErr } = await supabaseAdmin
            .from(tableName)
            .select('raw_data')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr) throw new Error(`[supabase-db] partial-update fetch ${tableName}/${id}: ${fetchErr.message}`);

        // Merge: existing raw_data fields are preserved; patch keys overwrite only changed fields
        const mergedRaw = applyPatchInJs(cur?.raw_data ?? {}, patch, paths, deletes);
        if (!mergedRaw.id) mergedRaw.id = id;

        const updatePayload: Record<string, any> = {
            raw_data: mergedRaw,
            ...nativeOverrides,
        };

        const { error: patchErr } = await supabaseAdmin
            .from(tableName)
            .update(updatePayload)
            .eq('id', id);

        if (patchErr) throw new Error(`[supabase-db] partial-update PATCH ${tableName}/${id}: ${patchErr.message}`);
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
            // For TEXT[] arrays like roles: column @> ARRAY[value]
            return query.contains(nativeCol, [normalizedValue]);
        }
        if (op === 'array-contains-any') {
            // For TEXT[] arrays: column && ARRAY[...values] (overlap)
            return query.overlaps(nativeCol, Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]);
        }
        return applySimpleFilter(query, nativeCol, op, normalizedValue);
    }

    // Check if field is a direct native column name (e.g. 'email' on users)
    const cols = NATIVE_COLUMNS[tableName] || [];
    if (cols.includes(field)) {
        if (op === 'array-contains') {
            return query.contains(field, [normalizedValue]);
        }
        if (op === 'array-contains-any') {
            return query.overlaps(field, Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]);
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

/**
 * Rewrites a JSONB path so an ordering comparison against a number is done
 * numerically.
 *
 * THE CAST HAS TO GO ON `->`, NOT `->>`
 * -------------------------------------
 * This appended `::numeric` to the `->>` path and looked correct. PostgREST
 * ignores it. `->>` already yields text, and the cast written after it does not
 * reach the comparison, so `where("amount", ">", 900)` compared strings and
 * silently dropped every amount whose first digit was below 9 — 1000 and 1500
 * both sort before '900'.
 *
 * Measured rather than reasoned about, against PostgREST in CI:
 *
 *     raw_data->>"amount"::numeric=gt.900   →  [90000]                 wrong
 *     raw_data->>amount::numeric=gt.900     →  [90000]                 wrong
 *     raw_data->>amount::int=gt.900         →  [90000]                 wrong
 *     raw_data->>amount=gt.900              →  [90000]                 the text answer
 *     raw_data->amount::numeric=gt.900      →  [1000, 1500, 90000]     correct
 *
 * The single arrow yields jsonb, which the cast does apply to. So the final
 * `->>` becomes `->` whenever a numeric comparison is being built.
 *
 * The previous version of this function shipped with a comment explaining that
 * the cast fixed the lexicographic comparison. It did not, and nothing could
 * tell the difference until the suite that checks the adapter against real
 * Postgres was actually run — which happened for the first time in the change
 * that found this.
 *
 * Numbers only: dates are ISO-8601 strings which already sort correctly as
 * text, and casting them would break the comparison rather than fix it. A
 * non-finite number is left alone — the comparison is meaningless either way,
 * and an invalid cast would turn a wrong answer into a query error.
 */
function numericAware(jsonPath: string, value: any): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return jsonPath;

    // Only the LAST arrow is the text extractor; intermediate segments of a
    // nested path already use `->`.
    const lastTextArrow = jsonPath.lastIndexOf('->>');
    const asJsonb = lastTextArrow === -1
        ? jsonPath
        : `${jsonPath.slice(0, lastTextArrow)}->${jsonPath.slice(lastTextArrow + 3)}`;

    return `${asJsonb}::numeric`;
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
        // Ordering comparisons on a NUMBER must compare as numbers.
        // See numericAware — the cast has to be applied to `->`, not `->>`.
        case '<': return query.lt(numericAware(jsonPath, value), String(value));
        case '<=': return query.lte(numericAware(jsonPath, value), String(value));
        case '>': return query.gt(numericAware(jsonPath, value), String(value));
        case '>=': return query.gte(numericAware(jsonPath, value), String(value));
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
            // Use the && (overlap) operator — checks if JSONB array overlaps with given values
            const arrPath = parts.length === 1
                ? `raw_data->${JSON.stringify(field)}`
                : `raw_data${parts.slice(0, -1).map(p => `->${JSON.stringify(p)}`).join('')}->${JSON.stringify(parts[parts.length - 1])}`;
            return query.filter(arrPath, 'ov', JSON.stringify(Array.isArray(value) ? value : [value]));
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

    /**
     * True when the default cap was hit and rows were left behind.
     *
     * A truncated result looks identical to a complete one, which is how a
     * repair script reports success having processed a fraction of the table.
     * Anything that sweeps a whole collection should either use `.all()` or
     * check this.
     */
    public readonly truncated: boolean;

    constructor(docs: SupabaseQueryDocumentSnapshot[], truncated = false) {
        this.docs = docs;
        this.truncated = truncated;
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

        // NOTE: read errors are deliberately NOT swallowed. Returning an
        // "does not exist" snapshot when the database actually failed made
        // transient errors indistinguishable from a missing document, so
        // callers went on to re-create records and overwrite live data.
        if (tableName === 'document_collections') {
            const { data, error } = await supabaseAdmin
                .from('document_collections')
                .select('raw_data')
                .eq('id', this.id)
                .eq('collection_name', this._collection)
                .maybeSingle();
            if (error) throw new Error(`[supabase-db] get ${this._collection}/${this.id}: ${error.message}`);
            raw = data?.raw_data ?? null;
        } else {
            const { data, error } = await supabaseAdmin
                .from(tableName)
                .select('*')
                .eq('id', this.id)
                .maybeSingle();
            if (error) throw new Error(`[supabase-db] get ${this._collection}/${this.id}: ${error.message}`);
            if (data) {
                // Precedence must match SupabaseQuery.get(): the domain value in
                // raw_data wins, the native SQL column is only a fallback.
                // These used to be inverted here, so the same document read via
                // .doc().get() and via .where().get() reported different
                // createdAt / email values.
                raw = {
                    ...(data.raw_data ?? {}),
                    createdAt: data.raw_data?.createdAt ?? data.created_at,
                    updatedAt: data.raw_data?.updatedAt ?? data.updated_at,
                    email: data.raw_data?.email ?? data.email,
                    id: data.id
                };
            }
        }

        // Ensure id is accessible via .data().id
        if (raw && !raw.id) raw = { id: this.id, ...raw };
        const parsedRaw = raw ? convertStringsToTimestamps(raw) : null;
        return new SupabaseDocumentSnapshot(this.id, this, parsedRaw);
    }

    async set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
        let base: Record<string, any> = {};
        let exists = false;

        if (options?.merge) {
            const snap = await this.get();
            exists = snap.exists;
            base = snap.data() ?? {};
        }
        // A merging set() over an EXISTING document is the same race as
        // update(): processWriteData resolves increment/arrayUnion/arrayRemove
        // against `base`, which is a value we just read, and a concurrent
        // writer's change is overwritten.
        //
        // This path is not incidental. The cooperative membership grant runs
        // through `transaction.set(userRef, ..., { merge: true })`, so fixing
        // update() alone would have left the paid-member role still dropping.
        // Migration 010 left this gap for increments too; both are closed here.
        //
        // When the document does NOT exist there is nothing to race against and
        // the upsert below needs concrete values, so the sentinels are resolved
        // in JavaScript exactly as before.
        if (options?.merge && exists) {
            const { increments, rest: afterIncrements } = splitIncrements(data);
            const { arrayOps, rest } = splitArrayOps(afterIncrements);

            if (Object.keys(rest).length > 0) {
                const { patch, paths, deletes } = buildWritePatch(rest, base);

                // set(merge) deep-merges nested maps; update() replaces them.
                // Flattening the patch's nested objects into dotted paths is
                // what makes the difference — see flattenForMerge.
                const mergedPaths: Record<string, any> = { ...paths };
                const flatPatch: Record<string, any> = {};
                for (const [k, v] of Object.entries(patch)) {
                    const isPlainObject =
                        v !== null && typeof v === 'object' && !Array.isArray(v) &&
                        !(v instanceof Date) && typeof (v as any).toDate !== 'function';
                    if (isPlainObject) {
                        // Merging an empty map changes nothing, so it is skipped
                        // rather than written. Sending it would shallow-merge
                        // `{}` over the existing object and wipe it — the exact
                        // failure this function exists to stop.
                        if (Object.keys(v as object).length === 0) continue;
                        flattenForMerge(v, k, mergedPaths);
                    } else {
                        flatPatch[k] = v;
                    }
                }

                await supabasePartialUpdate(this._collection, this.id, flatPatch,
                    { paths: mergedPaths, deletes });
            }

            if (Object.keys(increments).length > 0) {
                await applyIncrements(this._collection, this.id, increments, base);
            }

            if (Object.keys(arrayOps).length > 0) {
                await applyArrayOps(this._collection, this.id, arrayOps, base);
            }

            await invalidateCacheForCollection(this._collection, this.id);
            return;
        }

        const processed = processWriteData(data, base, !!options?.merge);
        if (!processed.id) processed.id = this.id;

        // A merging set() on a document that does not exist yet must CREATE it.
        // supabasePartialUpdate() issues a bare SQL UPDATE, which matches zero
        // rows and reports no error — so the write was silently discarded for
        // every first-time set(..., { merge: true }).
        if (options?.merge && exists) {
            await supabasePartialUpdate(this._collection, this.id, processed);
        } else {
            await supabaseUpsert(this._collection, this.id, processed);
        }
        await invalidateCacheForCollection(this._collection, this.id);
    }

    async update(data: Record<string, any>): Promise<void> {
        // Increments are pulled out and applied in SQL, not resolved here.
        //
        // They used to go through processWriteData below, which reads the
        // document and adds to the value it just read. Two concurrent
        // increments therefore computed the same result and the second write
        // overwrote the first, silently losing one — on seller payouts, loan
        // repayments and savings balances among others. See
        // supabase/migrations/010_atomic_increments.sql.
        //
        // Array operations are pulled out for the same reason — see
        // supabase/migrations/016_atomic_array_ops.sql. 010 fixed increment
        // only, and `roles: FieldValue.arrayUnion(...)` kept losing writes.
        const { increments, rest: afterIncrements } = splitIncrements(data);
        const { arrayOps, rest } = splitArrayOps(afterIncrements);

        const snap = await this.get();
        const existing = snap.data() ?? {};

        if (!snap.exists) {
            // Firestore throws NOT_FOUND here. We keep the write a no-op to avoid
            // changing behaviour under load, but it must not stay invisible —
            // this is how "the save button did nothing" bugs reach production.
            logger.warn(
                `[supabase-db] update() on missing document ${this._collection}/${this.id} — ` +
                `no rows will be affected. Use set(data, { merge: true }) if the document may not exist yet.`
            );
        }

        // Non-increment fields keep the existing behaviour exactly.
        if (Object.keys(rest).length > 0) {
            // Only the changed fields are sent. This used to be the whole
            // document — see migration 017 — so two updates to unrelated fields
            // reverted one another, and the stale copy of a counter or array
            // rode along and undid the atomic functions below.
            const { patch, paths, deletes } = buildWritePatch(rest, existing);
            await supabasePartialUpdate(this._collection, this.id, patch, { paths, deletes });
        }

        if (Object.keys(increments).length > 0) {
            await applyIncrements(this._collection, this.id, increments, existing);
        }

        if (Object.keys(arrayOps).length > 0) {
            await applyArrayOps(this._collection, this.id, arrayOps, existing);
        }

        await invalidateCacheForCollection(this._collection, this.id);
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
            await invalidateCacheForCollection(this._collection, this.id);
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
        await invalidateCacheForCollection(this._collection, this.id);
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
    protected _unbounded = false;
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
        q._unbounded = this._unbounded;
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

    /**
     * Read every matching row, ignoring the default cap.
     *
     * For whole-collection work only: data repair sweeps, migrations,
     * broadcasts — anything where processing a subset is worse than being slow.
     * Never for a screen; that is what the cap exists to prevent.
     *
     * The cap was added to stop page loads reading entire tables, and it does
     * that well. But it applies to any query without an explicit `.limit()`,
     * which silently turned "repair every user" into "repair the first 5,000
     * and report success" — with ~41,000 users, 12% coverage presented as
     * completion. This is the way to say the whole collection is genuinely
     * meant.
     *
     * Still batched internally, so it does not load everything in one request.
     */
    all(): this {
        const q = this._clone();
        q._unbounded = true;
        q._limit = null;
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

                // PostgREST caps a plain select at 1,000 rows. Reading that
                // single page made every aggregate silently under-report once a
                // collection passed 1k documents — financial totals included.
                const rows: any[] = [];
                for (let offset = 0; ; offset += 1000) {
                    const { data, error } = await query.range(offset, offset + 999);
                    if (error) throw new Error(`[supabase-db] aggregate ${this._collection}: ${error.message}`);
                    if (!data || data.length === 0) break;
                    rows.push(...data);
                    if (data.length < 1000) break;
                }

                const sums: Record<string, number> = {};
                for (const [key, value] of Object.entries(spec)) {
                    const op = (value as any)?._op ?? 'sum';
                    const field = (value as any)?._field;

                    if (op === 'count') {
                        sums[key] = rows.length;
                        continue;
                    }

                    let sum = 0;
                    let counted = 0;
                    for (const row of rows) {
                        const raw = row.raw_data || {};
                        const n = Number(raw[field]);
                        if (Number.isFinite(n)) {
                            sum += n;
                            counted++;
                        }
                    }
                    sums[key] = op === 'average' ? (counted ? sum / counted : 0) : sum;
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
        // For dedicated tables, select ALL columns so native columns (status, user_id, etc.)
        // are available and can be merged into doc.data(). Raw-only select misses these.
        // For the generic document_collections table, 'id, raw_data' is sufficient.
        const isDedicated = isDedicatedTable(this._collection);
        let query = supabaseAdmin.from(tableName).select(isDedicated ? '*' : 'id, raw_data');

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

        if (this._orderBy.length === 0) {
            query = query.order('id');
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
                if (!colName) {
                    // Fall back to the same JSONB path the orderBy above used.
                    // Previously the cursor was simply dropped for any field that
                    // was not a native column, so startAfter() returned page 1
                    // again — "load more" repeated the same rows forever.
                    colName = (firstOrderField === 'createdAt' || firstOrderField === 'created_at')
                        ? 'created_at'
                        : `raw_data->>${JSON.stringify(firstOrderField)}`;
                }

                if (this._orderBy[0].direction === 'desc') {
                    query = query.lt(colName, cursorValue);
                } else {
                    query = query.gt(colName, cursorValue);
                }
            }
        }

        // Apply limit and fetch auto-paginated batches to bypass Supabase 1,000-row select caps
        const allData: any[] = [];
        // A query with no .limit() used to read the ENTIRE table, one 1,000-row
        // page at a time. 415 of the 516 read call sites in this codebase have
        // no limit, so a single page load against the 41,000-row users table
        // meant ~41 sequential round trips to Supabase before anything
        // rendered — the main reason the application feels slow, and one that
        // gets worse as data grows.
        //
        // The cap is deliberately NOT silent: exceeding it logs the collection
        // by name, so the screens that genuinely need pagination identify
        // themselves in production instead of being guessed at. Raise it with
        // SUPABASE_DEFAULT_QUERY_LIMIT if a specific screen needs more while
        // it is being fixed properly.
        // .all() means the caller genuinely wants every row — a repair sweep, a
        // migration, a broadcast. UNBOUNDED_CEILING is a runaway guard, not a
        // limit anyone should hit; reaching it is reported as an error.
        const limitVal = this._unbounded
            ? UNBOUNDED_CEILING
            : (this._limit ?? DEFAULT_QUERY_LIMIT);
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

        // Did we stop because the data ran out, or because we hit a ceiling?
        const truncated = this._unbounded
            ? fetchedSoFar >= UNBOUNDED_CEILING
            : this._limit == null && fetchedSoFar >= DEFAULT_QUERY_LIMIT;

        if (truncated && this._unbounded) {
            // A sweep that silently covers part of a collection is worse than
            // one that fails, so this is an error rather than a warning.
            logger.error(
                `[supabase-db] .all() on '${this._collection}' hit the ${UNBOUNDED_CEILING}-row ceiling. ` +
                `The result is INCOMPLETE. Raise UNBOUNDED_CEILING or process the collection in explicit pages.`
            );
        } else if (truncated) {
            // Truncation must never pass unnoticed — a short result that looks
            // complete is how "the report is missing rows" bugs reach production.
            const key = this._collection;
            if (!_limitReachedWarned.has(key)) {
                _limitReachedWarned.add(key);
                logger.warn(
                    `[supabase-db] Query on '${key}' returned the default cap of ${DEFAULT_QUERY_LIMIT} rows ` +
                    `and was truncated. This query has no .limit() — give it real pagination, ` +
                    `use .all() if the whole collection is genuinely required, ` +
                    `or raise SUPABASE_DEFAULT_QUERY_LIMIT.`
                );
            }
        }

        const docs = allData.map((row: any) => {
            const rawData = row.raw_data ?? {};
            const id = row.id || rawData.id;
            // Merge native columns into raw_data so doc.data() returns a complete view.
            // This ensures fields like 'status', 'user_id', 'email' stored in native SQL
            // columns are accessible the same way as fields stored in JSONB raw_data.
            const mergedData: Record<string, any> = { ...rawData };
            if (!mergedData.id) mergedData.id = id;
            if (isDedicated) {
                // Map known native columns back to their Firestore field names
                if (row.status !== undefined && mergedData.status === undefined) {
                    mergedData.status = row.status;
                }
                if (row.status !== undefined && mergedData.membershipStatus === undefined) {
                    // cooperative_members uses membershipStatus in code but status in SQL
                    mergedData.membershipStatus = row.status;
                }
                if (row.user_id !== undefined && mergedData.userId === undefined) {
                    mergedData.userId = row.user_id;
                }
                if (row.email !== undefined && mergedData.email === undefined) {
                    mergedData.email = row.email;
                }
                if (row.roles !== undefined && mergedData.roles === undefined) {
                    mergedData.roles = row.roles;
                }
                if (row.balance !== undefined && mergedData.balance === undefined) {
                    mergedData.balance = row.balance;
                }
                if (row.amount !== undefined && mergedData.amount === undefined) {
                    mergedData.amount = row.amount;
                }
                if (row.created_at !== undefined) {
                    mergedData.createdAt = mergedData.createdAt || row.created_at;
                }
                if (row.updated_at !== undefined) {
                    mergedData.updatedAt = mergedData.updatedAt || row.updated_at;
                }
            }
            const parsedWithId = convertStringsToTimestamps(mergedData);
            const ref = new SupabaseDocumentReference(this._collection, id);
            return new SupabaseQueryDocumentSnapshot(id, ref, parsedWithId);
        });

        return new SupabaseQuerySnapshot(docs, truncated);
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

    /**
     * Resolve a document reference.
     *
     * Accepts both call styles used across the codebase:
     *   db.doc("users/abc")                          — Admin SDK slash path
     *   db.doc("users", "abc")                       — client SDK style segments
     *   db.doc("cooperatives", id, "members", uid)   — nested segments
     *
     * Previously only the first form was honoured; the extra segments were
     * dropped, so `db.doc("processedPayments", ref)` collapsed to a
     * single-segment path and threw "Invalid document path". That took out the
     * cooperative contribution verification and balance lookups entirely.
     */
    doc(path: string, ...segments: string[]): SupabaseDocumentReference {
        const parts = [path, ...segments]
            .filter(p => p !== undefined && p !== null && p !== '')
            .flatMap(p => String(p).split('/'))
            .filter(Boolean);

        if (parts.length < 2) {
            throw new Error(
                `Invalid document path: "${[path, ...segments].join('/')}". ` +
                `A document path needs an even number of segments (collection/id). ` +
                `To create a document with a generated id use db.collection(name).doc().`
            );
        }
        if (parts.length % 2 !== 0) {
            throw new Error(
                `Invalid document path: "${parts.join('/')}" has an odd number of segments. ` +
                `Document paths must alternate collection/id.`
            );
        }

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

/**
 * Numeric increment sentinel.
 *
 * Must produce the same shape the write pipeline detects (`_methodName`).
 * The previous `{ __op: 'increment' }` shape was invisible to
 * getFieldValueType(), so `increment(1)` was persisted verbatim as a JSON
 * object — silently replacing counters like memberCount/totalSavings with
 * `{"__op":"increment","value":1}` instead of adding to them.
 */
export function increment(value: number) {
    return FieldValue.increment(value);
}

export function serverTimestamp() {
    return FieldValue.serverTimestamp();
}

export function arrayUnion(...elements: any[]) {
    return FieldValue.arrayUnion(...elements);
}

export function arrayRemove(...elements: any[]) {
    return FieldValue.arrayRemove(...elements);
}

export function deleteField() {
    return FieldValue.delete();
}

export async function runTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
    if (typeof dbInstance.runTransaction === 'function') {
        return dbInstance.runTransaction(updateFunction);
    }
    return getAdminDb().runTransaction(updateFunction);
}


