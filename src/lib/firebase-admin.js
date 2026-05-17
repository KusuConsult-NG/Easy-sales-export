"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminStorage = exports.adminAuth = exports.db = void 0;
exports.initializeFirebaseAdmin = initializeFirebaseAdmin;
exports.getAdminDb = getAdminDb;
exports.getAdminAuth = getAdminAuth;
exports.getAdminStorage = getAdminStorage;
var app_1 = require("firebase-admin/app");
var firestore_1 = require("firebase-admin/firestore");
var auth_1 = require("firebase-admin/auth");
var storage_1 = require("firebase-admin/storage");
function initializeFirebaseAdmin() {
    if (globalThis.__FIREBASE_ADMIN_APP__) {
        return globalThis.__FIREBASE_ADMIN_APP__;
    }
    // Check if already initialized by another instance
    var apps = (0, app_1.getApps)();
    if (apps.length > 0) {
        globalThis.__FIREBASE_ADMIN_APP__ = apps[0];
        return globalThis.__FIREBASE_ADMIN_APP__;
    }
    // RUNTIME ONLY: Parse private key here, not at module scope
    // Handle both quoted and unquoted formats, with or without escaped newlines
    var privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('Missing FIREBASE_PRIVATE_KEY environment variable. ' +
            'Please check your .env.local file.');
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
        throw new Error('Invalid FIREBASE_PRIVATE_KEY format. ' +
            'Must be a valid PEM formatted private key. ' +
            'Check that your .env.local has the complete key including BEGIN/END markers.');
    }
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error('Missing Firebase Admin SDK environment variables. ' +
            'Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    }
    try {
        globalThis.__FIREBASE_ADMIN_APP__ = (0, app_1.initializeApp)({
            credential: (0, app_1.cert)({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey,
            }),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        });
    }
    catch (error) {
        throw new Error("Failed to initialize Firebase Admin SDK: ".concat(error.message, ". ") +
            'Please verify your Firebase credentials in .env.local');
    }
    return globalThis.__FIREBASE_ADMIN_APP__;
}
/**
 * Get Firestore instance (lazy initialization)
 * This function should ONLY be called inside API routes or server actions
 */
function getAdminDb() {
    if (!globalThis.__FIRESTORE_INSTANCE__) {
        initializeFirebaseAdmin();
        var db_1 = (0, firestore_1.getFirestore)();
        try {
            db_1.settings({ preferRest: true, ignoreUndefinedProperties: true });
        }
        catch (e) {
            console.warn("Firestore settings already applied manually");
        }
        globalThis.__FIRESTORE_INSTANCE__ = db_1;
    }
    return globalThis.__FIRESTORE_INSTANCE__;
}
// Legacy export for backward compatibility
// WARNING: This getter will initialize Firebase on first access
exports.db = new Proxy({}, {
    get: function (_target, prop) {
        var instance = getAdminDb();
        return instance[prop];
    }
});
/**
 * Get Auth instance (lazy initialization)
 */
function getAdminAuth() {
    var app = initializeFirebaseAdmin();
    return (0, auth_1.getAuth)(app);
}
exports.adminAuth = new Proxy({}, {
    get: function (_target, prop) {
        var instance = getAdminAuth();
        return instance[prop];
    }
});
/**
 * Get Storage instance (lazy initialization)
 */
function getAdminStorage() {
    var app = initializeFirebaseAdmin();
    // Storage is part of firebase-admin/storage but accessed via app in v10 or imported
    // Actually in firebase-admin, it's getStorage(app)
    return (0, storage_1.getStorage)(app);
}
exports.adminStorage = new Proxy({}, {
    get: function (_target, prop) {
        var instance = getAdminStorage();
        return instance[prop];
    }
});
