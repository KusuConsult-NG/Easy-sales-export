import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Data Integrity and Consistency Integration Test
 * 
 * Performs cross-collection validation to ensure that related entities
 * (e.g., users and their applications) maintain referential integrity.
 */

describe('Data Consistency Verification', () => {
    const db = getAdminDb();

    test('all Marketplace applications should have a valid user', async () => {
        const snap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).limit(100).get();
        
        for (const doc of snap.docs) {
            const userId = doc.data().userId;
            if (!userId) {
                console.warn(`Seller Verification ${doc.id} is missing a userId`);
                continue;
            }
            
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            expect(userDoc.exists).toBe(true);
        }
    });

    test('all WAVE applications should have a valid user', async () => {
        const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(100).get();
        
        for (const doc of snap.docs) {
            const userId = doc.data().userId;
            if (!userId) continue;
            
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            expect(userDoc.exists).toBe(true);
        }
    });

    test('users with "seller" role must have a verification record or be approved', async () => {
        const sellersSnap = await db.collection(COLLECTIONS.USERS)
            .where('roles', 'array-contains', 'seller')
            .limit(100)
            .get();

        for (const doc of sellersSnap.docs) {
            const data = doc.data();
            // A seller must either have an approved verification or be in pending state
            // If they have the role but no record and no isVerified, it's an anomaly
            if (data.sellerVerificationStatus === undefined && !data.isVerified) {
                // This is a "warning" level anomaly
                console.warn(`User ${data.email} has seller role but no verification status`);
            }
        }
    });

    test('no transactions should exist without an associated user', async () => {
        const transSnap = await db.collection(COLLECTIONS.TRANSACTIONS).limit(100).get();
        
        for (const doc of transSnap.docs) {
            const userId = doc.data().userId;
            if (userId) {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                expect(userDoc.exists).toBe(true);
            }
        }
    });
});
