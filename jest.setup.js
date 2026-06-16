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

jest.mock('@/lib/firebase-admin', () => {
    const mockDb = {
        collection: (name) => {
            global.mockFirestoreCollection(name);
            return {
                doc: (id) => {
                    global.mockFirestoreDoc(id);
                    return {
                        get: () => global.mockFirestoreGet(id),
                        update: (fields) => global.mockFirestoreUpdate(id, fields),
                    };
                }
            };
        },
        batch: () => {
            global.mockFirestoreBatch();
            return {
                update: (ref, fields) => global.mockFirestoreBatchUpdate(ref, fields),
                commit: () => global.mockFirestoreBatchCommit(),
            };
        }
    };
    return {
        db: mockDb,
        getAdminDb: () => mockDb,
        adminAuth: {},
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
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (payload) => global.mockCreateAdminAuditLog(payload),
    logAdminAction: jest.fn(),
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
