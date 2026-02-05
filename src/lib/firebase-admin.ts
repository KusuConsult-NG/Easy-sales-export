import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

/**
 * CRITICAL: Lazy initialization pattern
 * Firebase Admin SDK is NOT initialized at module scope.
 * Initialization only happens when getAdminDb() is called (at request time).
 * This prevents private key parsing during build process.
 */

let adminApp: App | null = null;
let firestoreInstance: Firestore | null = null;

function initializeFirebaseAdmin(): App {
    if (adminApp) {
        return adminApp;
    }

    // Check if already initialized by another instance
    const apps = getApps();
    if (apps.length > 0) {
        adminApp = apps[0];
        return adminApp;
    }

    // RUNTIME ONLY: Parse private key here, not at module scope
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
        throw new Error(
            'Missing Firebase Admin SDK environment variables. ' +
            'Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
        );
    }

    adminApp = initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });

    return adminApp;
}

/**
 * Get Firestore instance (lazy initialization)
 * This function should ONLY be called inside API routes or server actions
 */
export function getAdminDb(): Firestore {
    if (!firestoreInstance) {
        initializeFirebaseAdmin();
        firestoreInstance = getFirestore();
    }
    return firestoreInstance;
}

// Legacy export for backward compatibility
// WARNING: This getter will initialize Firebase on first access
export const db = new Proxy({} as Firestore, {
    get(_target, prop) {
        const instance = getAdminDb();
        return instance[prop as keyof Firestore];
    }
});

