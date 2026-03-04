#!/usr/bin/env node
/**
 * diagnose-auth.js
 * 
 * Diagnoses and fixes all known auth issues for Easy Sales Export.
 * Run with: node scripts/diagnose-auth.js steviekusu@gmail.com
 */

require("dotenv").config({ path: ".env.local" });

const admin = require("firebase-admin");
const https = require("https");

const TARGET_EMAIL = process.argv[2] || "steviekusu@gmail.com";

// ─── Colours ─────────────────────────────────────────────────────────────────
const GREEN = "\x1b[32m✅";
const RED = "\x1b[31m❌";
const YELLOW = "\x1b[33m⚠️ ";
const BLUE = "\x1b[34mℹ️ ";
const RESET = "\x1b[0m";

function ok(msg) { console.log(`${GREEN} ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED} ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW} ${msg}${RESET}`); }
function info(msg) { console.log(`${BLUE} ${msg}${RESET}`); }
function section(title) { console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`); }

// ─── Firebase Admin Init ──────────────────────────────────────────────────────
function initFirebase() {
    if (admin.apps.length > 0) return admin.apps[0];

    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (!privateKey || !clientEmail || !projectId) {
        throw new Error("Missing FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, or FIREBASE_PROJECT_ID in .env.local");
    }

    return admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        projectId,
    });
}

// ─── Check: Env Vars ─────────────────────────────────────────────────────────
async function checkEnvVars() {
    section("1. Environment Variables");

    const required = {
        NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
        FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    };

    let allOk = true;
    for (const [key, val] of Object.entries(required)) {
        if (!val || val.startsWith("placeholder") || val.startsWith("mock-")) {
            fail(`${key} = "${val || "(missing)"}"`);
            allOk = false;
        } else {
            const display = val.length > 40 ? val.slice(0, 20) + "..." + val.slice(-8) : val;
            ok(`${key} = "${display}"`);
        }
    }
    return allOk;
}

// ─── Check: Firebase Admin SDK connectivity ───────────────────────────────────
async function checkFirebaseAdmin() {
    section("2. Firebase Admin SDK");
    try {
        initFirebase();
        const db = admin.firestore();
        const testRef = await db.collection("_health_check_").doc("ping").get();
        ok("Firebase Admin SDK initialised");
        ok("Firestore reachable (collection query succeeded)");
        return true;
    } catch (err) {
        fail(`Firebase Admin SDK failed: ${err.message}`);
        return false;
    }
}

// ─── Check: Upstash Redis ─────────────────────────────────────────────────────
async function checkRedis() {
    section("3. Upstash Redis");
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        fail("UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing");
        return false;
    }

    return new Promise((resolve) => {
        // Simple PING via REST API
        const fullUrl = new URL("/ping", url);
        const options = {
            hostname: fullUrl.hostname,
            path: fullUrl.pathname,
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                if (res.statusCode === 200) {
                    ok(`Upstash Redis reachable — PING response: ${data.trim()}`);
                    resolve(true);
                } else {
                    fail(`Upstash Redis returned HTTP ${res.statusCode}: ${data.trim()}`);
                    resolve(false);
                }
            });
        });
        req.on("error", (err) => {
            fail(`Upstash Redis connection failed: ${err.message}`);
            resolve(false);
        });
        req.end();
    });
}

// ─── Check: Firebase Auth User ───────────────────────────────────────────────
async function checkFirebaseAuthUser(email) {
    section(`4. Firebase Auth — User: ${email}`);
    try {
        initFirebase();
        const userRecord = await admin.auth().getUserByEmail(email);
        ok(`Firebase Auth user exists — UID: ${userRecord.uid}`);
        ok(`Email verified: ${userRecord.emailVerified}`);
        ok(`Disabled: ${userRecord.disabled}`);
        if (userRecord.disabled) {
            warn("User is DISABLED in Firebase Auth. They cannot sign in.");
        }
        return userRecord;
    } catch (err) {
        if (err.code === "auth/user-not-found") {
            fail(`No Firebase Auth user for ${email}`);
            info("ACTION NEEDED: Create the account at https://www.easysalesexport.com/auth/register");
        } else {
            fail(`Firebase Auth lookup failed: ${err.message}`);
        }
        return null;
    }
}

// ─── Check + Fix: Firestore User Document ────────────────────────────────────
async function checkAndFixFirestoreUser(userRecord) {
    section("5. Firestore User Document");
    if (!userRecord) {
        warn("Skipped — no Firebase Auth user");
        return false;
    }

    initFirebase();
    const db = admin.firestore();
    const docRef = db.collection("users").doc(userRecord.uid);
    const doc = await docRef.get();

    if (doc.exists) {
        const data = doc.data();
        ok(`Firestore user document exists`);
        info(`  fullName: ${data.fullName || data.displayName || "(missing)"}`);
        info(`  email: ${data.email}`);
        info(`  roles: [${(data.roles || []).join(", ")}]`);
        info(`  verified: ${data.verified}`);
        info(`  isBanned: ${data.isBanned || false}`);
        info(`  status: ${data.status || "(not set)"}`);

        // Fix: ensure roles array exists
        let fixes = {};
        if (!data.roles || data.roles.length === 0) {
            warn("Roles array is empty — setting default role 'user'");
            fixes.roles = ["user"];
        }
        if (data.verified === undefined || data.verified === null) {
            warn("verified field missing — setting to true");
            fixes.verified = true;
        }
        if (Object.keys(fixes).length > 0) {
            await docRef.update({ ...fixes, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            ok(`Fixed Firestore document: ${JSON.stringify(fixes)}`);
        }
        return true;
    } else {
        fail(`No Firestore user document found for UID: ${userRecord.uid}`);
        warn("AUTO-FIXING: Creating Firestore user document...");

        // Create minimal user document from Firebase Auth data
        const newDoc = {
            id: userRecord.uid,
            email: userRecord.email,
            fullName: userRecord.displayName || userRecord.email.split("@")[0],
            displayName: userRecord.displayName || userRecord.email.split("@")[0],
            photoURL: userRecord.photoURL || null,
            roles: ["user"],
            verified: userRecord.emailVerified,
            isBanned: false,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            serviceRegistrations: {},
        };

        await docRef.set(newDoc);
        ok(`Created Firestore user document for ${userRecord.email}`);
        return true;
    }
}

// ─── Check: NEXTAUTH_URL ─────────────────────────────────────────────────────
async function checkNextAuthUrl() {
    section("6. NextAuth URL");
    const url = process.env.NEXTAUTH_URL;
    if (!url) {
        fail("NEXTAUTH_URL is not set");
        return false;
    }
    if (url === "http://localhost:3000") {
        warn(`NEXTAUTH_URL is set to localhost: "${url}"`);
        warn("This is fine for LOCAL testing. On Vercel production it should be https://easysalesexport.com");
        warn("Run: vercel env add NEXTAUTH_URL production → https://easysalesexport.com");
        return false;
    }
    ok(`NEXTAUTH_URL = "${url}"`);
    return true;
}

// ─── Check: Firebase Authorized Domains ──────────────────────────────────────
async function checkAuthorizedDomains() {
    section("7. Firebase Authorized Domains (Manual Check Required)");
    warn("Cannot check programmatically. Please verify manually:");
    info("Go to: https://console.firebase.google.com/project/easy-sales-hub/authentication/settings");
    info("Ensure these domains are in 'Authorized domains':");
    info("  - localhost");
    info("  - easy-sales-hub.firebaseapp.com");
    info("  - easysalesexport.com");
    info("  - www.easysalesexport.com");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  AUTH DIAGNOSTIC — Easy Sales Export`);
    console.log(`  Target user: ${TARGET_EMAIL}`);
    console.log(`${"═".repeat(60)}`);

    let pass = 0, fail_count = 0;

    const envOk = await checkEnvVars().then(r => (r ? pass++ : fail_count++, r));
    const adminOk = await checkFirebaseAdmin().then(r => (r ? pass++ : fail_count++, r));
    const redisOk = await checkRedis().then(r => (r ? pass++ : fail_count++, r));
    const authUser = await checkFirebaseAuthUser(TARGET_EMAIL);
    if (authUser) pass++; else fail_count++;
    const firestoreOk = await checkAndFixFirestoreUser(authUser);
    if (firestoreOk) pass++; else fail_count++;
    await checkNextAuthUrl();
    await checkAuthorizedDomains();

    section("SUMMARY");
    console.log(`  Passed: ${pass} | Failed: ${fail_count}`);

    if (fail_count === 0) {
        ok("All checks passed — auth should work.");
    } else {
        fail(`${fail_count} issue(s) found. Review the output above and follow the ACTION NEEDED steps.`);
    }

    console.log("");
    process.exit(fail_count === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("Script crashed:", err);
    process.exit(1);
});
