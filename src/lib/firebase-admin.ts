import './firestore-retry';
import './db-sync';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/**
 * CRITICAL: Lazy initialization pattern
 * Firebase Admin SDK is NOT initialized at module scope.
 * Initialization only happens when getAdminDb() is called (at request time).
 * This prevents private key parsing during build process.
 */

// Define global interface for Next.js hot-reload persistence
declare global {
    var __FIREBASE_ADMIN_APP__: App | undefined;
    var __FIRESTORE_INSTANCE__: Firestore | undefined;
    var __FIREBASE_AUTH_INSTANCE__: Auth | undefined;
    var __FIREBASE_STORAGE_INSTANCE__: ReturnType<typeof getStorage> | undefined;
}

export function initializeFirebaseAdmin(): App {
    if (globalThis.__FIREBASE_ADMIN_APP__) {
        return globalThis.__FIREBASE_ADMIN_APP__;
    }

    // Check if already initialized by another instance
    const apps = getApps();
    if (apps.length > 0) {
        globalThis.__FIREBASE_ADMIN_APP__ = apps[0];
        return globalThis.__FIREBASE_ADMIN_APP__;
    }

    // RUNTIME ONLY: Parse private key here, not at module scope
    // Handle both quoted and unquoted formats, with or without escaped newlines
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    const isEmulator = !!(
        process.env.FIREBASE_AUTH_EMULATOR_HOST ||
        process.env.FIRESTORE_EMULATOR_HOST ||
        process.env.NODE_ENV === 'test'
    );

    if (!privateKey) {
        if (isEmulator) {
            // Provide a dummy private key for local development/testing with Firebase Emulators
            privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzbUIqcf2E9CEq\nmBCYoNr8xL0YcG8uU5IaJ2YA9A0Yj5HsU5oiRAypTPjzLu6/QEgw5tlbMroU2jP6\ni8t1je6a+qQ4p4zjTXwD1+7kmfPCvxGH2+dzIKI2x/C5/tG33kK2uOqBxsvk9EqH\nfVCna9bjx1z/Qs1GstVzM8TeilxAZM0KborOow+iBUlOCRdH3J+/nIOD9wbQBZ0d\nVBN6d0uJsAvbWIDh1MJkvPJ690meuw7uBMnyHQOrN98omahKXSt9yghR0Ou23M5J\nObpWk8MD4+2YwEqBSHKsck+W0JiOYh3EGaRzMIvkx2nj5cuRedJg7ZH7DD2LjdSy\nSkr5RD3LAgMBAAECggEAWCDSjmGFyY9VWQPupuDfHqcNT9stqL3wdXsjfVVht04R\nONgJTUpKQ7+kSWGkb3iF3MsOOF6Oil5wiF+wc9FeQG3aSl91clGlF4gwdMTvNxi8\n5hOLN39wXWLQKLLx1BNNhk0GFe8MR6z7jFfvTQRJPIC3+0KW6+I7uAVV7Y5c6F0l\nBLYZ1qKKl1Nd8KyWCUrds2dHvVLrqr0OOd04VPKfDy0Cr9CwYsWXzRlVcAxsMaxR\n8H2QHDJFGeiMtNKIpuF4SsDZlHMx/kvfPZVbIMeYnqJ6+sIA9/XWuEcu8CbvFoqe\nzS6sDwlMvNMW3E3SHv+WH5CTcEMWZ5JbMl0IlkNyxQKBgQD8WWu8oLZG71p0aJjR\n/kvtwa0Tsun07P7qQTpHNvbkRqL2ujY9ZJKnPMMt1nNHhoKoxRNs4qV1dI7Rhy8i\ngaxbNq5jxJ1RUu5yK4NO/dnvVckx0sZquVwnoCUgbXW+P6LWwrc3kClc4rC8T46z\n94yfSs+ULNbY3k0Sg4XseSKsPwKBgQC2BcShEpd9w0Lps2H9Uo+Lz9clwR27NPSI\n1lbd38GyV8mpsvKFT9LN+spH8zLmCDL2XQ3guwk05J30POjMi6vKOlGOjSvqxDXD\nwje2RA30GCPDWsNa7Y/JmwyHhQVlm10hv2Q4hO81GV48nwkRHPcENfWAz52zxWdj\nOzEP1wc7dQKBgQDr4Xo/m8pGjD31SkBvKlE3MS7jlv3yIAY4WjhrkQk/YHe8QVuq\nD3S2NqoLEsY3OZiwwWbjBQi8vfMyEDcS/jtqF7bzMzoKZobU2a+oCsnIWlvy4p7t\n684kjCGoKilBaKKCNQimO28ukAe8PnGZ7+/Whkt6ql854LISeDabULAEaQKBgG00\nYrbcZ6UdPAzoAXcxTEvuYz8UcJj7eWaLacxtzVEJWEUGxnfy3x+TQj8Ois/1xVWH\nmKbmr+xa6OU6kdT+Sw/mEz46NkoAc91BrZkdlV2IChTPZHsuIeErs8WuqgE+yA5S\nPHeoUbeCw8YNCCyLOyv8j5E7fnr3iULApXvCX2VtAoGAYFoeYzYlrsMCGEsSwOPJ\nYGUSlIebEncBCzbQwt/xcvRy0qYvsVIB1WIL6nALT9nv3Vhob6o3jYvsuR3IRec9\n0Fs/KDNlQqp0gpoisnYDvI1l3xTblGMiLknsfFfSz+8z+l0s4KI8GHslDtqM1Kxc\n0PPDYErUYB3/M7tHoR9yYpM=\n-----END PRIVATE KEY-----";
        } else {
            throw new Error(
                'Missing FIREBASE_PRIVATE_KEY environment variable. ' +
                'Please check your .env.local file.'
            );
        }
    }

    if (isEmulator) {
        process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-test';
        process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || `firebase-adminsdk-fbsvc@${process.env.FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`;
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
        globalThis.__FIREBASE_ADMIN_APP__ = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey,
            }),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        });
    } catch (error: any) {
        throw new Error(
            `Failed to initialize Firebase Admin SDK: ${error.message}. ` +
            'Please verify your Firebase credentials in .env.local'
        );
    }

    return globalThis.__FIREBASE_ADMIN_APP__;
}

/**
 * Get Firestore instance (lazy initialization)
 * This function should ONLY be called inside API routes or server actions
 */
export function getAdminDb(): Firestore {
    if (!globalThis.__FIRESTORE_INSTANCE__) {
        initializeFirebaseAdmin();
        const db = getFirestore();
        try {
            db.settings({ preferRest: false, ignoreUndefinedProperties: true });
        } catch (e) {
            console.warn("Firestore settings already applied manually");
        }
        globalThis.__FIRESTORE_INSTANCE__ = db;
    }
    return globalThis.__FIRESTORE_INSTANCE__;
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


/**
 * Get Storage instance (lazy initialization)
 */
export function getAdminStorage() {
    const app = initializeFirebaseAdmin();
    // Storage is part of firebase-admin/storage but accessed via app in v10 or imported
    // Actually in firebase-admin, it's getStorage(app)
    return getStorage(app);
}

export const adminStorage = new Proxy({} as ReturnType<typeof getStorage>, {
    get(_target, prop) {
        const instance = getAdminStorage();
        return instance[prop as keyof ReturnType<typeof getStorage>];
    }
});
