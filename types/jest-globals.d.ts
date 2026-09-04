/**
 * The globals jest.setup.js installs, declared once.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * jest.setup.js attaches ~30 mock handles and `maybeDescribe` to `global`.
 * TypeScript has no way to know that, so under noImplicitAny every
 * `global.mockFirestoreGet` is an error, and the test files that use them were
 * the last thing standing between this codebase and having both strict flags
 * on permanently.
 *
 * The alternative was a cast at each of the ~24 use sites, or `declare const`
 * repeated at the top of each file — which is what several files already do
 * for `maybeDescribe`, and it is exactly how two declarations of the same
 * thing drift apart. One declaration, and a test that names a mock which does
 * not exist fails to compile instead of reading `undefined` at runtime and
 * throwing something unhelpful.
 *
 * KEEP THIS IN STEP WITH jest.setup.js. A mock added there and not here is
 * unusable from a .ts test; one removed there and left here is a compile-time
 * promise the harness no longer keeps. src/__tests__/unit/harness-covers-adapter.test.ts
 * already guards the adapter surface the same way.
 */

import type { Describe } from '@jest/types/build/Global';

declare global {
    /**
     * describe() for suites that need a real database, or describe.skip() when
     * none is configured. src/lib/testing/db-env-guard.js decides which, and
     * turns a skip into a failure under CI.
     */
    var maybeDescribe: jest.Describe;

    /** Whether a real database is configured for this run. */
    var HAS_DB: boolean;

    // ── Firestore-compat adapter ────────────────────────────────────────────
    var mockFirestoreCollection: jest.Mock;
    var mockFirestoreDoc: jest.Mock;
    var mockFirestoreGet: jest.Mock;
    var mockFirestoreSet: jest.Mock;
    var mockFirestoreUpdate: jest.Mock;
    var mockFirestoreDelete: jest.Mock;
    var mockFirestoreAdd: jest.Mock;

    // Batches
    var mockFirestoreBatch: jest.Mock;
    var mockFirestoreBatchUpdate: jest.Mock;
    var mockFirestoreBatchDelete: jest.Mock;
    var mockFirestoreBatchCommit: jest.Mock;

    // Transactions
    var mockFirestoreTxGet: jest.Mock;
    var mockFirestoreTxSet: jest.Mock;
    var mockFirestoreTxUpdate: jest.Mock;

    // ── Auth shim ───────────────────────────────────────────────────────────
    var mockAdminAuthCreateUser: jest.Mock;
    var mockAdminAuthUpdateUser: jest.Mock;
    var mockAdminAuthDeleteUser: jest.Mock;
    var mockAdminAuthDeleteUsers: jest.Mock;
    var mockAdminAuthGetUser: jest.Mock;
    var mockAdminAuthGetUserByEmail: jest.Mock;
    var mockAdminAuthListUsers: jest.Mock;
    var mockAdminAuthCreateCustomToken: jest.Mock;

    // ── Storage shim ────────────────────────────────────────────────────────
    var mockAdminStorageBucket: jest.Mock;
    var mockAdminStorageFileSave: jest.Mock;
    var mockAdminStorageFileDelete: jest.Mock;

    // ── Application helpers ─────────────────────────────────────────────────
    var mockRequireSession: jest.Mock;
    var mockCreateAdminAuditLog: jest.Mock;
    var mockInvalidateUserCache: jest.Mock;
}

export {};
