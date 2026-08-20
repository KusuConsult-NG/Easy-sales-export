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
// Returns a resolved ref, because the factory now hands the recorder's value
// straight back to the caller. `const ref = await col.add(x); ref.id` is the
// shape production uses; a bare jest.fn() returning undefined would throw on
// `.id` and the action's catch would turn that into a generic failure.
global.mockFirestoreAdd = jest.fn(() => Promise.resolve({ id: 'mock-generated-id' }));
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

// ── firebase-admin Auth and Storage ──────────────────────────────────────────
//
// Declared here with the other recorders so a test can assert on them. The mock
// used to export `adminAuth: {}`, so every one of these calls threw — and most
// callers wrap the Firebase half in try/catch as best-effort, which turned the
// throw into a silent skip no assertion could see.
global.mockAdminAuthCreateCustomToken = jest.fn(() => Promise.resolve('mock-custom-token'));
global.mockAdminAuthCreateUser = jest.fn((props) => Promise.resolve({ uid: 'mock-uid', ...(props || {}) }));
global.mockAdminAuthDeleteUser = jest.fn(() => Promise.resolve());
global.mockAdminAuthDeleteUsers = jest.fn(() => Promise.resolve({ successCount: 0, failureCount: 0, errors: [] }));
global.mockAdminAuthGetUser = jest.fn((uid) => Promise.resolve({ uid, email: `${uid}@example.test`, disabled: false }));
global.mockAdminAuthGetUserByEmail = jest.fn((email) => Promise.resolve({ uid: 'mock-uid', email, disabled: false }));
global.mockAdminAuthListUsers = jest.fn(() => Promise.resolve({ users: [], pageToken: undefined }));
global.mockAdminAuthUpdateUser = jest.fn((uid, props) => Promise.resolve({ uid, ...(props || {}) }));
global.mockAdminStorageBucket = jest.fn(() => undefined);
global.mockAdminStorageFileDelete = jest.fn(() => Promise.resolve());
global.mockAdminStorageFileSave = jest.fn(() => Promise.resolve());

jest.mock('@/lib/firebase-admin', () => {
    // Firebase Auth admin surface, as used in src: createCustomToken,
    // createUser, deleteUser, deleteUsers, getUser, getUserByEmail, listUsers
    // and updateUser. getUser/getUserByEmail resolve to a plausible record
    // rather than undefined, so a caller reading .uid off the result does not
    // throw on a path that would have worked.
    const mockAdminAuth = {
        createCustomToken: (...a) => global.mockAdminAuthCreateCustomToken(...a),
        createUser: (...a) => global.mockAdminAuthCreateUser(...a),
        deleteUser: (...a) => global.mockAdminAuthDeleteUser(...a),
        deleteUsers: (...a) => global.mockAdminAuthDeleteUsers(...a),
        getUser: (...a) => global.mockAdminAuthGetUser(...a),
        getUserByEmail: (...a) => global.mockAdminAuthGetUserByEmail(...a),
        listUsers: (...a) => global.mockAdminAuthListUsers(...a),
        updateUser: (...a) => global.mockAdminAuthUpdateUser(...a),
    };

    // Storage: only bucket().file().delete() is reached from src today, but the
    // handle is complete enough that a caller chaining off it does not throw.
    const mockAdminStorage = {
        bucket: (...a) => {
            global.mockAdminStorageBucket(...a);
            return {
                file: (path) => ({
                    delete: (opts) => global.mockAdminStorageFileDelete(path, opts),
                    exists: () => Promise.resolve([true]),
                    save: (data) => global.mockAdminStorageFileSave(path, data),
                    getSignedUrl: () => Promise.resolve([`https://mock-storage.test/${path}`]),
                    makePublic: () => Promise.resolve(),
                }),
            };
        },
    };

    // The whole fluent surface lives in ONE module now — this file used to
    // carry two byte-for-byte copies, and three of the harness gaps its
    // comments record had to be fixed twice.
    //
    // Required inside the factory: jest.mock factories may not close over
    // out-of-scope variables.
    const { createMockDb } = require('@/lib/testing/firestore-mock-db');
    const mockDb = createMockDb();
    return {
        db: mockDb,
        // The module's full export surface, not two thirds of it.
        //
        // This returned `{ getAdminDb, adminAuth: {} }`. The real module also
        // exports initializeFirebaseAdmin, db, getAdminAuth, getAdminStorage
        // and adminStorage — so anything importing one of those got undefined
        // and threw on first use, and `adminAuth: {}` threw on every method
        // call.
        //
        // That is why the seven suites in src/__tests__/integration failed with
        // "getAdminAuth is not a function": not stale tests, not missing
        // credentials, an incomplete mock. They are excluded from the default
        // jest config and CI runs only that config, so nothing ever reported it.
        //
        // Third instance of this shape. `isAdmin: () => true` made every
        // ownership guard untestable; a missing docRef.delete() made every
        // "refuses to delete" assertion vacuous. harness-covers-adapter.test.ts
        // was written after the second and diffs the supabase-db surface — it
        // now diffs this module too.
        //
        // Every stub records through a global jest.fn(), because a stub that
        // accepts a call and reports nothing is the other half of the same
        // problem: it cannot be distinguished from a working one until a test
        // asserts on it.
        initializeFirebaseAdmin: () => ({ name: 'mock-app' }),
        getAdminDb: () => mockDb,
        db: mockDb,
        getAdminAuth: () => mockAdminAuth,
        adminAuth: mockAdminAuth,
        getAdminStorage: () => mockAdminStorage,
        adminStorage: mockAdminStorage,
    };
});

jest.mock('@/lib/supabase-db', () => {
    // The whole fluent surface lives in ONE module now — this file used to
    // carry two byte-for-byte copies, and three of the harness gaps its
    // comments record had to be fixed twice.
    //
    // Required inside the factory: jest.mock factories may not close over
    // out-of-scope variables.
    const { createMockDb } = require('@/lib/testing/firestore-mock-db');
    const mockDb = createMockDb();
    // The compat helpers — doc/getDoc/setDoc/updateDoc/collection/runTransaction
    // and the FieldValue sentinels — also come from the shared module. They were
    // absent from the original mock entirely, so the first call threw "doc is not
    // a function", the action's catch turned it into a generic failure, and any
    // assertion about what it wrote could never fail. cooperative/_payment.ts
    // could not be tested at all, and nothing said so.
    const { createCompatHelpers } = require('@/lib/testing/firestore-mock-db');
    const helpers = createCompatHelpers(mockDb);

    return {
        supabaseDb: mockDb,
        getAdminDb: () => mockDb,
        // From the REAL module. This was a hand-kept duplicate of
        // DEDICATED_TABLE_MAP — two copies of one fact, with the stale one
        // deciding, which is the drift this audit keeps finding.
        getTableName: jest.requireActual('@/lib/supabase-db').getTableName,

        // The three routing maps, taken from the REAL module rather than
        // copied.
        //
        // DEDICATED above is already a hand-kept duplicate of
        // DEDICATED_TABLE_MAP, which is precisely the drift this audit keeps
        // finding: two copies of one fact, and the stale one deciding. These
        // are re-exported from source so a table added there cannot go missing
        // here, and so a unit test that reads them sees what production sees.
        DEDICATED_TABLE_MAP: jest.requireActual('@/lib/supabase-db').DEDICATED_TABLE_MAP,
        NATIVE_COLUMNS: jest.requireActual('@/lib/supabase-db').NATIVE_COLUMNS,
        FIELD_TO_COLUMN: jest.requireActual('@/lib/supabase-db').FIELD_TO_COLUMN,

        ...helpers,
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
// recordAdminAction was the THIRD export missing from this list, after
// logAdminFinancialAction and logAuditAction. The failure mode is identical each
// time: the export is undefined, the call throws, the action's catch turns it
// into "Failed to update member status", and a test asserting the write can
// never pass — against perfectly correct code.
//
// It cost an hour here. src/__tests__/unit/audit-log-mock-is-complete.test.ts is
// the gate that stops there being a fourth: it diffs this list against the
// module's own exports.
global.mockRecordAdminAction = jest.fn(() => Promise.resolve());
// Financial audit rows are assertable too. logAdminFinancialAction was a bare
// jest.fn() with no handle, so a suite that wanted to check WHICH amount was
// recorded — the payout or the gross, which #109/#113 are exactly about — had
// no way to reach it without re-mocking the whole module locally.
global.mockLogAdminFinancialAction = jest.fn(() => Promise.resolve());
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (payload) => global.mockCreateAdminAuditLog(payload),
    createAuditLog: (payload) => global.mockCreateAdminAuditLog(payload),
    recordAdminAction: (payload) => global.mockRecordAdminAction(payload),
    logAdminAction: jest.fn(),
    logAuditAction: jest.fn(),
    logFinancialAction: jest.fn(),
    logAdminFinancialAction: (...args) => global.mockLogAdminFinancialAction(...args),
    getAuditLogs: jest.fn(() => Promise.resolve([])),
    purgeOldAuditLogs: jest.fn(() => Promise.resolve(0)),
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
// `isAdmin: () => true` used to be here, unconditionally.
//
// session-guard's isAdmin is a thin delegate to admin-permissions' isAdmin, and
// stubbing it true made EVERY caller an admin in EVERY test. Any guard of the
// shape
//
//     if (record.userId !== session.user.id && !isAdmin(session.user.roles))
//
// therefore could not be tested at all: the admin arm always won, so a test
// asserting "a stranger is refused" could never pass no matter how correct the
// action was. It also meant a missing guard and a present one looked identical.
//
// The real function is used now, so roles decide. It is imported lazily inside
// the factory because jest.mock factories may not close over out-of-scope
// variables.
jest.mock('@/lib/session-guard', () => ({
    requireSession: () => global.mockRequireSession(),
    isAdmin: (roles) => jest.requireActual('@/lib/admin-permissions').isAdmin(roles),
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
