/**
 * Firestore collection name → Supabase table, and the native columns and field
 * aliases each dedicated table carries.
 *
 * ONE COPY, BECAUSE THERE WERE TWO AND THEY HAD DRIFTED
 * -----------------------------------------------------
 * supabase-client-db.ts — the browser-side reader behind the
 * `firebase/firestore` shim — declared its own TABLE_MAP, NATIVE_COLUMNS and
 * FIELD_TO_COLUMN by hand-copying these. They were not the same:
 *
 *   TABLE_MAP           missing 'processedPayments' and 'marketplaceOrders',
 *                       the camelCase spellings the app actually writes. A
 *                       client read of either resolved to document_collections
 *                       while the server wrote the dedicated table — two
 *                       different tables for one collection name, decided by
 *                       whether the code ran in a browser.
 *
 *   FIELD_TO_COLUMN     missing cooperative_members.membershipStatus and
 *                       marketplace_orders.totalAmount. Without the alias,
 *                       `where("totalAmount", ">=", 10000)` fell to the JSONB
 *                       path, where values are TEXT — so the comparison ran as
 *                       a string and "9000" >= "10000" is true. A numeric
 *                       filter that silently answered lexicographically.
 *
 * Neither is reachable today: nothing in src/ imports `firebase/firestore`, so
 * the client reader has no live consumers. It exists to be used, and a mapping
 * that is already wrong before its first caller is the kind of thing that gets
 * blamed on the caller. Both sides import this now, so a table added to one is
 * a table added to the other.
 *
 * No imports on purpose — this must be safe to pull into a client bundle.
 */

// Maps Firestore collection names → dedicated Supabase table names.
// Collections NOT listed here fall back to the `document_collections` generic table.

export const DEDICATED_TABLE_MAP: Record<string, string> = {
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
export const NATIVE_COLUMNS: Record<string, string[]> = {
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
export const FIELD_TO_COLUMN: Record<string, Record<string, string>> = {
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
