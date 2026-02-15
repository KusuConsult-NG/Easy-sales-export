/**
 * Firebase Configuration
 * 
 * Environment variables required in .env.local:
 * - NEXT_PUBLIC_FIREBASE_API_KEY
 * - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 * - NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * - NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * - NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 * - NEXT_PUBLIC_FIREBASE_APP_ID
 * - NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY (reCAPTCHA v3 site key)
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase (only once)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase App Check (Bot & Abuse Prevention)
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY) {
    try {
        initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY),
            isTokenAutoRefreshEnabled: true, // Automatically refresh tokens
        });
        console.log("[Firebase] App Check initialized successfully");
    } catch (error) {
        // App Check already initialized or error
        console.warn("[Firebase] App Check initialization:", error);
    }
}

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
