import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { signInWithEmailAndPassword } from 'firebase/auth';

/**
 * Create test user in Firebase Auth + Firestore using Admin SDK to bypass rules
 */
export async function createTestUser(data: {
    email: string;
    fullName: string;
    role?: string;
}) {
    try {
        const adminAuth = getAdminAuth();
        const adminDb = getAdminDb();

        // Create in Auth via Admin SDK
        const userRecord = await adminAuth.createUser({
            email: data.email,
            password: 'password123',
            displayName: data.fullName,
        });

        const uid = userRecord.uid;

        // Sync roles array according to the firestore.rules requirements
        const roles = data.role ? [data.role] : ['user'];

        // Create in Firestore via Admin SDK
        await adminDb.collection('users').doc(uid).set({
            fullName: data.fullName,
            email: data.email,
            roles: roles,
            isVerified: true,
            createdAt: new Date(),
        });

        // Authenticate the client SDK to bind request.auth.uid for subsequent client operations
        if ((global as any).testAuth) {
            await signInWithEmailAndPassword((global as any).testAuth, data.email, 'password123');
        }

        return { uid, email: data.email };
    } catch (error) {
        console.error('Error creating test user:', error);
        throw error;
    }
}

/**
 * Clean up all test data from Firestore using Admin SDK (bypassing all rules)
 */
export async function cleanupTestData() {
    const adminDb = getAdminDb();
    const collections = [
        'users',
        'loans',
        'loan_applications',
        'cooperative_memberships',
        'enrollments',
        'land_listings',
        'withdrawals',
        'escrow_transactions',
        'audit_logs',
    ];

    for (const collectionName of collections) {
        try {
            const snapshot = await adminDb.collection(collectionName).get();
            if (snapshot.empty) continue;
            
            const batch = adminDb.batch();
            snapshot.docs.forEach(docSnapshot => {
                batch.delete(docSnapshot.ref);
            });
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
