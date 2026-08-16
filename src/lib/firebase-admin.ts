import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
// NOTE: Firestore (db) is now handled by supabase-db.ts — do NOT import db from here.
// Only Auth and Storage remain on Firebase.

/**
 * CRITICAL: Lazy initialization pattern
 * Firebase Admin SDK is NOT initialized at module scope.
 * Initialization only happens when getAdminDb() is called (at request time).
 * This prevents private key parsing during build process.
 */

// Define global interface for Next.js hot-reload persistence
declare global {
    var __FIREBASE_ADMIN_APP__: App | undefined;
    var __FIREBASE_AUTH_INSTANCE__: Auth | undefined;
    var __FIREBASE_STORAGE_INSTANCE__: ReturnType<typeof getStorage> | undefined;
}

/**
 * IMPORTANT — read before adding credential checks here.
 *
 * `firebase-admin` resolves to the local shim in src/lib/shims/firebase-admin
 * (see package.json). Its `initializeApp`/`cert` return empty objects and
 * `getAuth()` ignores the app entirely, talking to Supabase Auth directly.
 *
 * The credential parsing below therefore has no effect on anything. It used to
 * `throw` when FIREBASE_PRIVATE_KEY / FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL
 * were absent or malformed, which meant registration, login provisioning,
 * password reset and profile email changes all failed with
 * "Missing FIREBASE_PRIVATE_KEY environment variable" in any environment where
 * those now-meaningless variables were not set. Credential problems are logged
 * instead of thrown so a dead dependency cannot take down authentication.
 */
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
            // An RSA key generated at RUNTIME, not a literal in the source.
            //
            // This was a hardcoded 1.7 KB PRIVATE KEY block. It was only ever a
            // throwaway for the Firebase emulator and grants access to nothing —
            // but it is indistinguishable from a real leak to any secret scanner,
            // to a security reviewer, and to anyone browsing the repository,
            // which is public. A key that must be explained every time it is
            // found is worse than one that does not exist.
            //
            // generateKeyPairSync gives the emulator a structurally valid key
            // that is different on every process start, so there is nothing to
            // leak and nothing to explain.
            const { generateKeyPairSync } = require('crypto');
            privateKey = generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            }).privateKey as string;   // `require` types this as any, which
            // stops the compiler narrowing `privateKey` to a string after this
            // block — even though the only other branch returns. Stated
            // explicitly so the narrowing holds rather than suppressing the
            // errors downstream one by one.
        } else {
            console.warn(
                '[firebase-admin] FIREBASE_PRIVATE_KEY is not set. Firebase is shimmed to ' +
                'Supabase, so this is expected — continuing without Firebase credentials.'
            );
            globalThis.__FIREBASE_ADMIN_APP__ = initializeApp({}) as App;
            return globalThis.__FIREBASE_ADMIN_APP__;
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
        console.warn(
            '[firebase-admin] FIREBASE_PRIVATE_KEY is not PEM formatted. Ignoring it — ' +
            'Firebase credentials are unused now that auth runs on Supabase.'
        );
        globalThis.__FIREBASE_ADMIN_APP__ = initializeApp({}) as App;
        return globalThis.__FIREBASE_ADMIN_APP__;
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
        console.warn(
            '[firebase-admin] FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL are not set. ' +
            'Continuing without them — they are no longer used.'
        );
        globalThis.__FIREBASE_ADMIN_APP__ = initializeApp({}) as App;
        return globalThis.__FIREBASE_ADMIN_APP__;
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
        console.warn(`[firebase-admin] initializeApp failed (${error.message}). Continuing with an empty app.`);
        globalThis.__FIREBASE_ADMIN_APP__ = initializeApp({}) as App;
    }

    return globalThis.__FIREBASE_ADMIN_APP__;
}

// Firestore (db) has been removed from firebase-admin.ts.
// All data reads and writes now use supabase-db.ts.
// Compatibility shims are provided below for tests and old files.
import { supabaseDb } from './supabase-db';

/**
 * `db` and `getAdminDb()` were both annotated `: any`.
 *
 * supabaseDb itself is fully typed — collection() returns a
 * SupabaseCollectionReference, get() returns a SupabaseQuerySnapshot, and
 * .docs is a SupabaseQueryDocumentSnapshot[]. None of that reached a single
 * call site, because every one of them goes through this file and these two
 * annotations threw the types away on the way past. That is why `doc` is
 * implicitly `any` in ~40 `.docs.map(doc => ...)` callbacks across the app,
 * and why a typo in a field name or a call to a method the adapter does not
 * have compiles cleanly and fails in production instead.
 *
 * `typeof supabaseDb` rather than a hand-written interface: the adapter is the
 * definition of what the app may call, so the two cannot drift apart.
 */
export type AdminDb = typeof supabaseDb;

export function getAdminDb(): AdminDb {
    return supabaseDb;
}

export const db: AdminDb = supabaseDb;


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
