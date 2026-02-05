import { collection, addDoc, deleteDoc, getDocs, doc, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

/**
 * Create test user in Firebase Auth + Firestore
 */
export async function createTestUser(data: {
    email: string;
    fullName: string;
    role?: string;
}) {
    try {
        // Create in Auth
        const userCredential = await createUserWithEmailAndPassword(
            global.testAuth,
            data.email,
            'password123'
        );

        const uid = userCredential.user.uid;

        // Create in Firestore
        await setDoc(doc(global.testDb, 'users', uid), {
            fullName: data.fullName,
            email: data.email,
            role: data.role || 'user',
            isVerified: true,
            createdAt: new Date(),
        });

        return { uid, email: data.email };
    } catch (error) {
        console.error('Error creating test user:', error);
        throw error;
    }
}

/**
 * Clean up all test data from Firestore
 */
export async function cleanupTestData() {
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
            const snapshot = await getDocs(collection(global.testDb, collectionName));
            const deletePromises = snapshot.docs.map(docSnapshot =>
                deleteDoc(docSnapshot.ref)
            );
            await Promise.all(deletePromises);
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
    acreage: 5,
    location: { city: 'Kaduna', state: 'Kaduna' },
    price: 2000000,
    soilQuality: 'Excellent' as const,
};
