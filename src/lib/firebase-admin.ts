import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

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
    // Handle both quoted and unquoted formats, with or without escaped newlines
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!privateKey) {
        throw new Error(
            'Missing FIREBASE_PRIVATE_KEY environment variable. ' +
            'Please check your .env.local file.'
        );
    }

    // Remove surrounding quotes if present
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }

    // Handle escaped newlines (common in quoted env vars)
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Validate PEM format
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
        throw new Error(
            'Invalid FIREBASE_PRIVATE_KEY format. ' +
            'Must be a valid PEM formatted private key. ' +
            'Check that your .env.local has the complete key including BEGIN/END markers.'
        );
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error(
            'Missing Firebase Admin SDK environment variables. ' +
            'Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
        );
    }

    try {
        adminApp = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey,
            }),
        });
    } catch (error: any) {
        throw new Error(
            `Failed to initialize Firebase Admin SDK: ${error.message}. ` +
            'Please verify your Firebase credentials in .env.local'
        );
    }

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


/**
 * Get Auth instance (lazy initialization)
 */
export function getAdminAuth(): Auth {
    const app = initializeFirebaseAdmin();
    return getAuth(app);
}

export const adminAuth = new Proxy({} as Auth, {
    get(_target, prop) {
        const instance = getAdminAuth();
        return instance[prop as keyof Auth];
    }
});

