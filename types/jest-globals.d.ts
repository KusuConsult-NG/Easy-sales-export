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
    // eslint-disable-next-line no-var
    var maybeDescribe: jest.Describe;

    /** Whether a real database is configured for this run. */
    // eslint-disable-next-line no-var
    var HAS_DB: boolean;

    // ── Firestore-compat adapter ────────────────────────────────────────────
    // eslint-disable-next-line no-var
    var mockFirestoreCollection: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreDoc: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreGet: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreSet: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreUpdate: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreDelete: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreAdd: jest.Mock;

    // Batches
    // eslint-disable-next-line no-var
    var mockFirestoreBatch: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreBatchUpdate: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreBatchDelete: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreBatchCommit: jest.Mock;

    // Transactions
    // eslint-disable-next-line no-var
    var mockFirestoreTxGet: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreTxSet: jest.Mock;
    // eslint-disable-next-line no-var
    var mockFirestoreTxUpdate: jest.Mock;

    // ── Auth shim ───────────────────────────────────────────────────────────
    // eslint-disable-next-line no-var
    var mockAdminAuthCreateUser: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthUpdateUser: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthDeleteUser: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthDeleteUsers: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthGetUser: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthGetUserByEmail: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthListUsers: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminAuthCreateCustomToken: jest.Mock;

    // ── Storage shim ────────────────────────────────────────────────────────
    // eslint-disable-next-line no-var
    var mockAdminStorageBucket: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminStorageFileSave: jest.Mock;
    // eslint-disable-next-line no-var
    var mockAdminStorageFileDelete: jest.Mock;

    // ── Application helpers ─────────────────────────────────────────────────
    // eslint-disable-next-line no-var
    var mockRequireSession: jest.Mock;
    // eslint-disable-next-line no-var
    var mockCreateAdminAuditLog: jest.Mock;
    // eslint-disable-next-line no-var
    var mockInvalidateUserCache: jest.Mock;
}

export {};
