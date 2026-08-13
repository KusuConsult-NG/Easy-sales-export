/**
 * @jest-environment node
 */

/**
 * Referential integrity across collections, against a real database.
 *
 * WHY THIS FILE CHANGED WHEN IT WAS WIRED INTO CI
 * -----------------------------------------------
 * Every test here was a loop over query results:
 *
 *     const snap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).limit(100).get();
 *     for (const doc of snap.docs) {
 *         ...
 *         expect(userDoc.exists).toBe(true);
 *     }
 *
 * On an empty database the loop body never runs and the test passes having
 * asserted nothing. That was tolerable while the suite was pointed at a
 * populated staging project and never actually executed; it is not tolerable in
 * CI, where the database is created fresh for the run. Wiring these in unchanged
 * would have added four permanently green tests that check nothing — which is
 * worse than leaving them out, because green tests are read as coverage.
 *
 * So each test now seeds a known-good fixture and asserts the query returned it
 * before looping. The invariant being checked is unchanged; what changed is
 * that the check is now reached.
 *
 * THE THIRD TEST HAD NO ASSERTION AT ALL
 * --------------------------------------
 * "users with seller role must have a verification record or be approved" found
 * anomalies and called console.warn on them. It could not fail — not on an empty
 * database, not on a populated one, not on a database full of violations. It
 * has a real assertion now, and a seeded violation proves the detection works
 * rather than only that nothing was found.
 *
 * WHAT THIS COSTS WHEN POINTED AT STAGING
 * ---------------------------------------
 * The fixtures are created and removed per run and are namespaced by a unique
 * id, so running this against a populated database still checks that database's
 * real rows — it just also guarantees at least one row to check. A pre-existing
 * orphan in staging will now fail the run, which is the point of the file.
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

const db = getAdminDb();

/** Unique per run so a parallel or interrupted run cannot see these rows. */
const RUN = `dc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const GOOD_USER = `${RUN}-good-user`;
const SELLER_USER = `${RUN}-seller-user`;
const ORPHAN_SELLER = `${RUN}-orphan-seller`;

/** Everything created here, so afterAll removes exactly what it made. */
const created: Array<{ collection: string; id: string }> = [];

async function seedDoc(collection: string, id: string, data: Record<string, unknown>) {
    await db.collection(collection).doc(id).set(data);
    created.push({ collection, id });
}

maybeDescribe('Data Consistency Verification', () => {
    beforeAll(async () => {
        await seedDoc(COLLECTIONS.USERS, GOOD_USER, {
            email: `${GOOD_USER}@example.test`,
            fullName: 'Consistency Fixture',
            roles: ['user'],
            isVerified: true,
            createdAt: new Date().toISOString(),
        });

        await seedDoc(COLLECTIONS.USERS, SELLER_USER, {
            email: `${SELLER_USER}@example.test`,
            fullName: 'Compliant Seller Fixture',
            roles: ['user', 'seller'],
            isVerified: true,
            sellerVerificationStatus: 'approved',
            createdAt: new Date().toISOString(),
        });

        // A seller with the role and neither a verification status nor
        // isVerified — the anomaly the third test is supposed to detect. It is
        // seeded so that "no anomalies found" cannot be the answer for the
        // trivial reason that nothing was looked at.
        await seedDoc(COLLECTIONS.USERS, ORPHAN_SELLER, {
            email: `${ORPHAN_SELLER}@example.test`,
            fullName: 'Non-compliant Seller Fixture',
            roles: ['user', 'seller'],
            isVerified: false,
            createdAt: new Date().toISOString(),
        });

        await seedDoc(COLLECTIONS.SELLER_VERIFICATIONS, `${RUN}-sv`, {
            userId: GOOD_USER,
            status: 'approved',
            createdAt: new Date().toISOString(),
        });

        await seedDoc(COLLECTIONS.WAVE_APPLICATIONS, `${RUN}-wave`, {
            userId: GOOD_USER,
            status: 'pending',
            createdAt: new Date().toISOString(),
        });

        await seedDoc(COLLECTIONS.TRANSACTIONS, `${RUN}-txn`, {
            userId: GOOD_USER,
            amount: 1000,
            status: 'success',
            createdAt: new Date().toISOString(),
        });
    });

    afterAll(async () => {
        for (const { collection, id } of created) {
            try {
                await db.collection(collection).doc(id).delete();
            } catch {
                // Best effort. A leftover fixture row is namespaced by RUN and
                // inert; failing the suite over cleanup would hide the result.
            }
        }
    });

    test('all Marketplace applications should have a valid user', async () => {
        const snap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).limit(100).get();

        // Vacuity guard: without this the test passes on an empty database.
        expect(snap.docs.length).toBeGreaterThan(0);

        const orphans: string[] = [];
        for (const doc of snap.docs) {
            const userId = doc.data().userId;
            if (!userId) continue;

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (!userDoc.exists) orphans.push(`${doc.id} -> ${userId}`);
        }

        expect(orphans).toEqual([]);
    });

    test('all WAVE applications should have a valid user', async () => {
        const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(100).get();

        expect(snap.docs.length).toBeGreaterThan(0);

        const orphans: string[] = [];
        for (const doc of snap.docs) {
            const userId = doc.data().userId;
            if (!userId) continue;

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (!userDoc.exists) orphans.push(`${doc.id} -> ${userId}`);
        }

        expect(orphans).toEqual([]);
    });

    test('sellers without a verification status are detected, not just logged', async () => {
        // This test used to console.warn its findings and assert nothing, so it
        // passed against any database in any state.
        const sellersSnap = await db.collection(COLLECTIONS.USERS)
            .where('roles', 'array-contains', 'seller')
            .limit(100)
            .get();

        expect(sellersSnap.docs.length).toBeGreaterThan(0);

        const anomalies = sellersSnap.docs
            .filter((doc: any) => {
                const data = doc.data();
                return data.sellerVerificationStatus === undefined && !data.isVerified;
            })
            .map((doc: any) => doc.id);

        // The seeded violation must be found — otherwise the filter is broken
        // and an empty result means nothing.
        expect(anomalies).toContain(ORPHAN_SELLER);

        // And the compliant seller must NOT be, or the filter matches everything
        // and would report a clean database as broken.
        expect(anomalies).not.toContain(SELLER_USER);

        // Any anomaly that is not our own fixture is a real one.
        expect(anomalies.filter((id: string) => !id.startsWith(RUN))).toEqual([]);
    });

    test('no transactions should exist without an associated user', async () => {
        const transSnap = await db.collection(COLLECTIONS.TRANSACTIONS).limit(100).get();

        expect(transSnap.docs.length).toBeGreaterThan(0);

        const orphans: string[] = [];
        for (const doc of transSnap.docs) {
            const userId = doc.data().userId;
            if (!userId) continue;

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (!userDoc.exists) orphans.push(`${doc.id} -> ${userId}`);
        }

        expect(orphans).toEqual([]);
    });
});
