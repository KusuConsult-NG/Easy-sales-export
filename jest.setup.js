const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter() {
        return {
            push: jest.fn(),
            replace: jest.fn(),
            prefetch: jest.fn(),
            back: jest.fn(),
        }
    },
    useSearchParams() {
        return new URLSearchParams()
    },
    usePathname() {
        return ''
    },
}))

// Mock Firebase
jest.mock('@/lib/firebase', () => ({
    db: {},
    auth: {},
    storage: {},
}))

// Mock NextAuth
jest.mock('@/lib/auth', () => ({
    auth: jest.fn(() => Promise.resolve(null)),
}))

// Mock Firebase Admin SDK
global.mockFirestoreCollection = jest.fn();
global.mockFirestoreBatch = jest.fn();
global.mockFirestoreBatchUpdate = jest.fn();
global.mockFirestoreBatchCommit = jest.fn(() => Promise.resolve());
global.mockFirestoreDoc = jest.fn();
global.mockFirestoreGet = jest.fn();
global.mockFirestoreUpdate = jest.fn();
global.mockFirestoreTxGet = jest.fn();
global.mockFirestoreTxUpdate = jest.fn();
global.mockFirestoreTxSet = jest.fn();
global.mockFirestoreAdd = jest.fn();
// docRef.set() existed as `() => Promise.resolve()` — it succeeded and recorded
// nothing, so any assertion about a document written with .set() was vacuous.
// Same defect as the missing add() stub noted below it.
global.mockFirestoreSet = jest.fn();
// batch.delete() had no stub at all, so any action deleting documents in a
// batch threw `batch.delete is not a function` and its later writes never ran.
global.mockFirestoreBatchDelete = jest.fn();
// docRef.delete() — reachable through the compat helpers below and through
// docObj, and previously undefined, so calling it threw rather than recording.
global.mockFirestoreDelete = jest.fn(() => Promise.resolve());

jest.mock('@/lib/firebase-admin', () => {
    const mockDb = {
        collection: (name) => {
            global.mockFirestoreCollection(name);
            const docObj = (id) => {
                global.mockFirestoreDoc(id);
                return {
                    get: () => global.mockFirestoreGet(id),
                    update: (fields) => global.mockFirestoreUpdate(id, fields),
                    set: (data) => { global.mockFirestoreSet(id, data); return Promise.resolve(); },
                };
            };
            const queryObj = {
                doc: docObj,
                // A collection().add() had no stub at all, so every action that
                // creates a document this way threw before reaching its later
                // writes — which silently made some assertions vacuous.
                add: (data) => {
                    global.mockFirestoreAdd(name, data);
                    return Promise.resolve({ id: 'mock-generated-id' });
                },
                where: () => queryObj,
                orderBy: () => queryObj,
                limit: () => queryObj,
                startAfter: () => queryObj,
                get: () => global.mockFirestoreGet(name),
                count: () => ({
                    get: () => global.mockFirestoreGet(name + "_count")
                }),

                // ── Chainable methods the real adapter has and the mock did not
                //
                // Every one of these threw `x is not a function` when a test
                // reached it. Most callers wrap their work in try/catch, so the
                // throw was swallowed and the action returned a generic failure
                // — leaving assertions that could never fail.
                //
                // That is not hypothetical: three such gaps surfaced by accident
                // in a single day (collection().add(), docRef.set(),
                // batch.delete()). These were found by diffing the adapter's
                // method surface against this file instead of waiting for the
                // next test to trip over one.
                //
                // Usage in src at the time of writing: .select() 96 call sites,
                // query .all() 34, .getAll() 17.
                select: () => queryObj,
                offset: () => queryObj,
                startAt: () => queryObj,
                endAt: () => queryObj,
                endBefore: () => queryObj,

                // .all() bypasses the default row cap. It returns the same shape
                // as .get(), so tests that stub mockFirestoreGet keep working
                // without knowing which one the code under test chose.
                all: () => global.mockFirestoreGet(name),

                aggregate: () => ({
                    get: () => global.mockFirestoreGet(name + "_aggregate")
                }),
                create: (data) => {
                    global.mockFirestoreAdd(name, data);
                    return Promise.resolve({ id: 'mock-generated-id' });
                }
            };
            return queryObj;
        },
        // db.getAll(...refs) reads several documents at once. Unmocked, any
        // action using it threw before its first assertion.
        getAll: (...refs) => Promise.all(
            refs.flat().map((r) => global.mockFirestoreGet(r && r.id ? r.id : 'getAll'))
        ),
        batch: () => {
            global.mockFirestoreBatch();
            return {
                update: (ref, fields) => global.mockFirestoreBatchUpdate(ref, fields),
                delete: (ref) => global.mockFirestoreBatchDelete(ref),
                set: (ref, data) => global.mockFirestoreSet(ref, data),
                commit: () => global.mockFirestoreBatchCommit(),
            };
        },
        runTransaction: (cb) => {
            const tx = {
                get: (ref) => global.mockFirestoreTxGet(ref),
                set: (ref, data) => {
                    global.mockFirestoreTxSet(ref, data);
                    return Promise.resolve();
                },
                update: (ref, fields) => {
                    global.mockFirestoreTxUpdate(ref, fields);
                    return Promise.resolve();
                },
            };
            return cb(tx);
        }
    };
    return {
        db: mockDb,
        getAdminDb: () => mockDb,
        adminAuth: {},
    };
});

jest.mock('@/lib/supabase-db', () => {
    const mockDb = {
        collection: (name) => {
            global.mockFirestoreCollection(name);
            const docObj = (id) => {
                global.mockFirestoreDoc(id);
                return {
                    get: () => global.mockFirestoreGet(id),
                    update: (fields) => global.mockFirestoreUpdate(id, fields),
                    set: (data) => { global.mockFirestoreSet(id, data); return Promise.resolve(); },
                };
            };
            const queryObj = {
                doc: docObj,
                // A collection().add() had no stub at all, so every action that
                // creates a document this way threw before reaching its later
                // writes — which silently made some assertions vacuous.
                add: (data) => {
                    global.mockFirestoreAdd(name, data);
                    return Promise.resolve({ id: 'mock-generated-id' });
                },
                where: () => queryObj,
                orderBy: () => queryObj,
                limit: () => queryObj,
                startAfter: () => queryObj,
                get: () => global.mockFirestoreGet(name),
                count: () => ({
                    get: () => global.mockFirestoreGet(name + "_count")
                }),

                // ── Chainable methods the real adapter has and the mock did not
                //
                // Every one of these threw `x is not a function` when a test
                // reached it. Most callers wrap their work in try/catch, so the
                // throw was swallowed and the action returned a generic failure
                // — leaving assertions that could never fail.
                //
                // That is not hypothetical: three such gaps surfaced by accident
                // in a single day (collection().add(), docRef.set(),
                // batch.delete()). These were found by diffing the adapter's
                // method surface against this file instead of waiting for the
                // next test to trip over one.
                //
                // Usage in src at the time of writing: .select() 96 call sites,
                // query .all() 34, .getAll() 17.
                select: () => queryObj,
                offset: () => queryObj,
                startAt: () => queryObj,
                endAt: () => queryObj,
                endBefore: () => queryObj,

                // .all() bypasses the default row cap. It returns the same shape
                // as .get(), so tests that stub mockFirestoreGet keep working
                // without knowing which one the code under test chose.
                all: () => global.mockFirestoreGet(name),

                aggregate: () => ({
                    get: () => global.mockFirestoreGet(name + "_aggregate")
                }),
                create: (data) => {
                    global.mockFirestoreAdd(name, data);
                    return Promise.resolve({ id: 'mock-generated-id' });
                }
            };
            return queryObj;
        },
        batch: () => {
            global.mockFirestoreBatch();
            return {
                update: (ref, fields) => global.mockFirestoreBatchUpdate(ref, fields),
                delete: (ref) => global.mockFirestoreBatchDelete(ref),
                set: (ref, data) => global.mockFirestoreSet(ref, data),
                commit: () => global.mockFirestoreBatchCommit(),
            };
        },
        runTransaction: (cb) => {
            const tx = {
                get: (ref) => global.mockFirestoreTxGet(ref),
                set: (ref, data) => {
                    global.mockFirestoreTxSet(ref, data);
                    return Promise.resolve();
                },
                update: (ref, fields) => {
                    global.mockFirestoreTxUpdate(ref, fields);
                    return Promise.resolve();
                },
            };
            return cb(tx);
        }
    };
    // Mirrors DEDICATED_TABLE_MAP in src/lib/supabase-db.ts. Anything not
    // listed falls back to the generic document_collections table, which is
    // what the real routing does — optimistic-locking.ts depends on that
    // distinction to decide whether a collection name must accompany the id.
    const DEDICATED = {
        'users': 'users',
        'cooperative_members': 'cooperative_members',
        'cooperative_loans': 'cooperative_loans',
        'transactions': 'transactions',
        'processedPayments': 'processed_payments',
        'processed_payments': 'processed_payments',
        'marketplaceOrders': 'marketplace_orders',
        'marketplace_orders': 'marketplace_orders',
        'wallets': 'wallets',
        'academy_applications': 'academy_applications',
    };
    /**
     * The modular compat helpers, which the mock did not export at all.
     *
     * src/lib/supabase-db.ts exports doc/getDoc/setDoc/updateDoc/collection/
     * increment/serverTimestamp/arrayUnion/arrayRemove/deleteField/runTransaction
     * alongside the fluent supabaseDb object, and ten-odd action files
     * destructure them:
     *
     *     const { supabaseDb: db, doc, getDoc, runTransaction } =
     *         await import('@/lib/supabase-db');
     *
     * Every one of those was `undefined` here, so the first call threw
     * "doc is not a function", the action's catch turned it into a generic
     * failure, and any assertion about what it wrote could never fail.
     * cooperative/_payment.ts could not be tested at all, and nothing said so —
     * the harness gap and the coverage gap hid each other, exactly as they did
     * for .select() and docRef.set() before.
     *
     * These record through the same globals as the fluent API, so a test can
     * assert on writes made either way.
     */
    const sentinel = (methodName, elements, operand) => ({ _methodName: methodName, _elements: elements, _operand: operand });

    const docRefFor = (path, id) => ({
        id,
        path,
        get: () => global.mockFirestoreGet(id),
        update: (fields) => global.mockFirestoreUpdate(id, fields),
        set: (data) => { global.mockFirestoreSet(id, data); return Promise.resolve(); },
        delete: () => global.mockFirestoreDelete(id),
    });

    return {
        supabaseDb: mockDb,
        getAdminDb: () => mockDb,
        getTableName: (collection) => DEDICATED[collection] || 'document_collections',

        doc: (_db, path, ...segments) => {
            const id = segments.length ? segments[segments.length - 1] : path;
            global.mockFirestoreDoc(id);
            return docRefFor(path, id);
        },
        collection: (_db, path) => mockDb.collection(path),
        getDoc: (ref) => global.mockFirestoreGet(ref?.id),
        setDoc: (ref, data) => { global.mockFirestoreSet(ref?.id, data); return Promise.resolve(); },
        updateDoc: (ref, data) => { global.mockFirestoreUpdate(ref?.id, data); return Promise.resolve(); },
        runTransaction: (_db, cb) => mockDb.runTransaction(cb),
        increment: (n) => sentinel('FieldValue.increment', undefined, n),
        serverTimestamp: () => sentinel('FieldValue.serverTimestamp'),
        arrayUnion: (...elements) => sentinel('FieldValue.arrayUnion', elements),
        arrayRemove: (...elements) => sentinel('FieldValue.arrayRemove', elements),
        deleteField: () => sentinel('FieldValue.delete'),
    };
});

// Mock Cache Invalidation
global.mockInvalidateUserCache = jest.fn(() => Promise.resolve());
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: (userId) => global.mockInvalidateUserCache(userId),
    invalidateAdminGlobalStats: jest.fn(),
    invalidateServiceCache: jest.fn(),
}));

// Mock Audit Log
global.mockCreateAdminAuditLog = jest.fn(() => Promise.resolve());
// The mock must cover the module's whole USED export surface.
//
// It listed two of them. logAdminFinancialAction (escrow, payments) and
// logAuditAction (11 files) were absent, so they were `undefined` at call time
// and threw — inside the try/catch those callers wrap everything in, which
// turned a harness gap into "the action returned an error" and looked like a
// defect in the code under test. Same shape as the missing collection().add().
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (payload) => global.mockCreateAdminAuditLog(payload),
    createAuditLog: (payload) => global.mockCreateAdminAuditLog(payload),
    logAdminAction: jest.fn(),
    logAuditAction: jest.fn(),
    logFinancialAction: jest.fn(),
    logAdminFinancialAction: jest.fn(),
    getSeverityForAction: jest.fn(() => 'info'),
    getSecurityContextFromHeaders: jest.fn(() => ({})),
}));

// Mock Session Guard
global.mockRequireSession = jest.fn(() => Promise.resolve({
    session: {
        user: {
            id: "admin-id",
            roles: ["admin"],
            email: "admin@example.com",
            name: "Admin User"
        }
    },
    error: null
}));
jest.mock('@/lib/session-guard', () => ({
    requireSession: () => global.mockRequireSession(),
    isAdmin: () => true,
    isSessionExpired: () => false,
}));

// Mock next/cache globally to prevent unstable_cache invariant issues in Jest
jest.mock('next/cache', () => ({
    unstable_cache: (fn) => fn,
    revalidateTag: jest.fn(),
    revalidatePath: jest.fn(),
}));

// Suppress console errors in tests (optional)
global.console = {
    ...console,
    error: jest.fn(),
    warn: jest.fn(),
}
