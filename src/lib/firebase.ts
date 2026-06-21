/**
 * Firebase Client SDK Configuration
 *
 * Required environment variables (set in Vercel → Settings → Environment Variables):
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * NOTE: App Check / reCAPTCHA is intentionally NOT used in this project.
 *       Do not re-add it without explicit direction from the project owner.
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ── Startup env-var audit (visible in Vercel function logs) ──────────────────
// If any of these are missing, Firebase will initialise with mock values and
// EVERY auth + Firestore call will silently fail.  Log clearly so developers
// know exactly what to fix without reading Firebase's cryptic error codes.
const REQUIRED_ENV_VARS = {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const OPTIONAL_ENV_VARS = {
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const missingRequired = Object.entries(REQUIRED_ENV_VARS)
    .filter(([, v]) => !v || v.startsWith("mock-"))
    .map(([k]) => k);

if (missingRequired.length > 0) {
    console.error(
        `[Firebase] CRITICAL STARTUP ERROR — missing required env vars: ${missingRequired.join(", ")}. ` +
        "Firestore and Auth will fail. Add these to Vercel → Settings → Environment Variables."
    );
}

// ─────────────────────────────────────────────────────────────────────────────

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "mock-api-key-for-build",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mock-auth-domain.firebaseapp.com",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "mock-project-id",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "mock-bucket.appspot.com",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:123456789:web:abcdef123456",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-1234567890",
};

// Initialize Firebase (only once across hot-reloads)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize services
export const auth = getAuth(app);

const isTestEnv = typeof window === 'undefined' && (process.env.NODE_ENV === 'test' || !!process.env.FIRESTORE_EMULATOR_HOST);

export const db = isTestEnv
    ? initializeFirestore(app, { experimentalForceLongPolling: true })
    : getFirestore(app);

export const storage = getStorage(app);

if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalhost) {
        // Connect Auth Emulator (always use 127.0.0.1 to avoid IPv6 resolution mismatches)
        try {
            connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            console.warn('✅ Connected client-side Firebase Auth to Emulator (127.0.0.1:9099)');
        } catch (e: any) {
            // Silence duplicate config errors
            if (e && e.code !== 'auth/emulator-config-failed') {
                console.warn('⚠️ Firebase Auth emulator connection warning:', e);
            }
        }

        // Connect Firestore Emulator (always use 127.0.0.1 to avoid IPv6 resolution mismatches)
        try {
            connectFirestoreEmulator(db, '127.0.0.1', 8080);
            console.warn('✅ Connected client-side Firestore to Emulator (127.0.0.1:8080)');
        } catch (e: any) {
            // Silence duplicate connection errors
            if (e && e.code !== 'failed-precondition') {
                console.warn('⚠️ Firestore emulator connection warning:', e);
            }
        }
    }
}

export default app;
