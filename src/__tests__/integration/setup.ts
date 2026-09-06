/**
 * Fixtures for the application integration suites.
 *
 *   #435 THIS FILE DELETED EVERY ROW OF NINE COLLECTIONS, INCLUDING users AND
 *   audit_logs, ON WHATEVER DATABASE THE ENVIRONMENT NAMED.
 *
 * `cleanupTestData()` read each collection whole and batch-deleted all of it:
 *
 *     const collections = ['users', 'loans', 'loan_applications',
 *         'cooperative_memberships', 'enrollments', 'land_listings',
 *         'withdrawals', 'escrow_transactions', 'audit_logs'];
 *     const snapshot = await adminDb.collection(name).get();
 *     snapshot.docs.forEach((d) => batch.delete(d.ref));
 *
 * No test prefix, no id filter, no locality check. And `getAdminDb()` is not a
 * Firebase leftover — it `return supabaseDb`, the real adapter, pointed at
 * whatever NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY say.
 *
 * DEMONSTRATED, NOT ARGUED. Six suites call this in beforeAll and afterAll, and
 * all six are absent from jest.config.integration.js's testMatch, which is an
 * explicit allowlist of three files — so they never run, and the exclusion is
 * invisible unless you compare the directory to the config. I widened that
 * allowlist to find out whether the six were salvageable, ran them, and the
 * local stack's `users` table went from 9 rows to 0. Re-seeded. That is a
 * throwaway local database; the same run against a staging one loses real data.
 *
 * WHAT WAS AND WAS NOT PROTECTING IT. lib/testing/db-env-guard refuses to run
 * when the URL contains the production project ref, and that guard is real —
 * production was never at risk from this. But it recognises ONE hardcoded ref.
 * A staging database, a restored copy, a new project: all wiped, silently,
 * because a config line changed.
 *
 * AND THE REPOSITORY ALREADY KNEW BETTER. Every suite under
 * __tests__/db-integration cleans up by test prefix —
 * `.eq("collection_name", COLLECTION).like("id", "jest-db-%")` — deleting only
 * rows it wrote. Two conventions for one job, and the destructive one sat in
 * the files nobody ran, which is where a rule goes to rot.
 *
 * WHAT THIS FILE DOES NOW
 * -----------------------
 *   - refuses to delete anything unless the database is LOCAL. The locality
 *     decision comes from db-env-guard through global.DB_IS_LOCAL rather than
 *     being restated here, because two copies of a safety rule is how the
 *     weaker one ends up deciding;
 *   - deletes ONLY rows carrying TEST_ID_PREFIX, so a row this helper did not
 *     create cannot be removed by it even on a local database;
 *   - creates test users idempotently. "A user with this email address has
 *     already been registered" was the first error in every one of the six
 *     failing suites: the helper used fixed emails and threw on the second run.
 *
 * The standing instruction on this codebase is that nothing is deleted or
 * destroyed — errors get fixed and data stays safe (#280, #292, #300, #301,
 * #327 all landed that way). A test helper is not an exception to it.
 */

import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { signInWithEmailAndPassword } from 'firebase/auth';

/**
 * Every document this helper creates carries this id prefix, and only documents
 * carrying it are ever removed.
 */
export const TEST_ID_PREFIX = 'jest-int-';

/** The collections these suites touch. Nothing outside this list is read or written. */
const TEST_COLLECTIONS = [
    'users',
    'loans',
    'loan_applications',
    'cooperative_memberships',
    'enrollments',
    'land_listings',
    'withdrawals',
    'escrow_transactions',
    'audit_logs',
] as const;

/**
 * Refuse to delete anything on a database that is not local.
 *
 * `global.DB_IS_LOCAL` is set by jest.integration.setup.js from db-env-guard's
 * own answer. It is UNDEFINED when this module is loaded outside that setup —
 * and undefined must mean "no", because the failure being prevented is a
 * destructive helper running somewhere nobody expected it to.
 */
function assertLocalDatabase(operation: string): void {
    if ((global as unknown as { DB_IS_LOCAL?: boolean }).DB_IS_LOCAL === true) return;
    throw new Error(
        `[integration setup] Refusing to ${operation}: the configured database is not local.\n` +
        `  This helper removes rows. It runs only against 127.0.0.1 / localhost.\n` +
        `  Bring one up with: ./scripts/local-stack/up.sh`,
    );
}

/**
 * Create a test user, idempotently.
 *
 * The Auth record is created if absent and reused if present; the profile row
 * is written either way, so a re-run starts from a known state without deleting
 * anybody. Throwing on "already registered" is what stopped six suites from
 * running at all.
 */
export async function createTestUser(data: {
    email: string;
    fullName: string;
    role?: string;
}) {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminDb();

    let uid: string;
    try {
        const userRecord = await adminAuth.createUser({
            email: data.email,
            password: 'password123',
            displayName: data.fullName,
        });
        uid = userRecord.uid;
    } catch (error) {
        // Reuse rather than delete-and-recreate: the account may carry rows
        // this helper did not write, and destroying those is the defect above.
        const existing = await adminAuth.getUserByEmail(data.email).catch(() => null);
        if (!existing) throw error;
        uid = existing.uid;
    }

    const roles = data.role ? [data.role] : ['user'];

    await adminDb.collection('users').doc(uid).set({
        fullName: data.fullName,
        email: data.email,
        roles,
        isVerified: true,
        createdAt: new Date(),
        // The marker that makes this row removable by cleanupTestData. A user
        // row without it is somebody else's and is left alone.
        _jestIntegrationFixture: true,
    });

    if ((global as any).testAuth) {
        await signInWithEmailAndPassword((global as any).testAuth, data.email, 'password123');
    }

    return { uid, email: data.email };
}

/**
 * Remove only what these suites created, and only on a local database.
 *
 * Two independent conditions, both required: the database must be local, and a
 * document must be marked as a fixture. Either one alone would have prevented
 * what happened; requiring both is cheap.
 */
export async function cleanupTestData() {
    assertLocalDatabase('delete test data');

    const adminDb = getAdminDb();

    for (const collectionName of TEST_COLLECTIONS) {
        try {
            const snapshot = await adminDb
                .collection(collectionName)
                .where('_jestIntegrationFixture', '==', true)
                .get();
            if (snapshot.empty) continue;

            const batch = adminDb.batch();
            for (const docSnapshot of snapshot.docs) {
                // Belt and braces: the query already filters, and a row that
                // somehow arrives without the marker is still skipped.
                if (docSnapshot.data()?._jestIntegrationFixture !== true) continue;
                batch.delete(docSnapshot.ref);
            }
            await batch.commit();
        } catch (error) {
            console.error(`Error cleaning ${collectionName}:`, error);
        }
    }
}

/**
 * Wait utility
 */
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Test data fixtures
 */
export const TEST_USER = {
    email: 'test@example.com',
    fullName: 'Test User',
    role: 'user',
};

export const TEST_ADMIN = {
    email: 'admin@example.com',
    fullName: 'Admin User',
    role: 'admin',
};

export const TEST_LOAN_APPLICATION = {
    amount: 50000,
    purpose: 'Sesame farming expansion',
    duration: 6,
};

export const TEST_LAND_LISTING = {
    title: 'Prime Agricultural Land',
    size: 2.02, // approx 5 acres
    location: { city: 'Kaduna', state: 'Kaduna' },
    price: 2000000,
    soilQuality: 'Excellent' as const,
};
