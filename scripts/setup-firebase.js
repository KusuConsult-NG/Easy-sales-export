#!/usr/bin/env node
/**
 * ============================================================
 * Firebase Setup & Verification Script
 * ============================================================
 * Run: node scripts/setup-firebase.js
 *
 * What this does:
 *  1. Validates all required environment variables
 *  2. Tests Firebase Admin SDK initialization
 *  3. Tests Firestore read/write
 *  4. Creates & verifies the Firebase Storage bucket
 *  5. Configures Storage CORS so browsers can upload
 *  6. Deploys Firestore + Storage rules (if firebase CLI available)
 *  7. Prints a summary with ✅/❌ for each check
 * ============================================================
 */

require("dotenv").config({ path: ".env.local" });

const admin = require("firebase-admin");
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Colours ────────────────────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

const pass = (msg) => console.log(`  ${green("✅")} ${msg}`);
const fail = (msg) => console.log(`  ${red("❌")} ${msg}`);
const warn = (msg) => console.log(`  ${yellow("⚠️")} ${msg}`);
const info = (msg) => console.log(`  ${cyan("ℹ")}  ${msg}`);

const results = [];
const check = (label, ok, detail = "") => {
    results.push({ label, ok, detail });
    if (ok) pass(`${label}${detail ? ` — ${detail}` : ""}`);
    else fail(`${label}${detail ? ` — ${detail}` : ""}`);
};

// ── Helpers ────────────────────────────────────────────────────────────────
function parsePrivateKey(raw) {
    if (!raw) return null;
    let key = raw;
    if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
    if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
    return key;
}

function hasCLI(cmd) {
    try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; }
    catch { return false; }
}

// ══════════════════════════════════════════════════════════════════════════
async function main() {
    console.log();
    console.log(bold("🔥 Firebase Setup & Verification"));
    console.log("─".repeat(55));

    // ── 1. Environment Variables ─────────────────────────────────────────
    console.log("\n" + bold("1. Environment Variables"));

    const REQUIRED = [
        "FIREBASE_PROJECT_ID",
        "FIREBASE_CLIENT_EMAIL",
        "FIREBASE_PRIVATE_KEY",
    ];
    const STORAGE_VAR =
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    let allEnvOk = true;
    for (const v of REQUIRED) {
        if (process.env[v]) {
            pass(`${v} is set`);
        } else {
            fail(`${v} is MISSING — add it to .env.local and Vercel`);
            allEnvOk = false;
        }
    }

    if (STORAGE_VAR) {
        pass(`Storage bucket: ${STORAGE_VAR}`);
    } else {
        warn(`FIREBASE_STORAGE_BUCKET not set — will use default (project-id.appspot.com)`);
    }

    if (!allEnvOk) {
        console.log(red("\n⛔ Missing required env vars. Fix them and re-run.\n"));
        process.exit(1);
    }

    // ── 2. Admin SDK Init ────────────────────────────────────────────────
    console.log("\n" + bold("2. Firebase Admin SDK"));

    let app;
    try {
        const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
        if (!privateKey.includes("BEGIN PRIVATE KEY")) {
            throw new Error("Private key is not in PEM format");
        }

        const existingApps = admin.apps;
        if (existingApps.length > 0) {
            app = existingApps[0];
        } else {
            app = admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey,
                }),
                storageBucket:
                    STORAGE_VAR ||
                    `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
            });
        }
        check("Admin SDK initialised", true, process.env.FIREBASE_PROJECT_ID);
    } catch (err) {
        check("Admin SDK initialised", false, err.message);
        console.log(red("\n⛔ Cannot continue without a valid Admin SDK. Fix credentials.\n"));
        process.exit(1);
    }

    // ── 3. Firestore ─────────────────────────────────────────────────────
    console.log("\n" + bold("3. Firestore"));

    const db = admin.firestore(app);
    db.settings({ ignoreUndefinedProperties: true });

    try {
        const testRef = db.collection("_setup_check").doc("ping");
        await testRef.set({ ts: admin.firestore.Timestamp.now(), source: "setup-firebase.js" });
        const snap = await testRef.get();
        await testRef.delete();
        check("Firestore write/read/delete", snap.exists, `latency OK`);
    } catch (err) {
        check("Firestore write/read/delete", false, err.message);
        warn("App will still boot but Firestore operations may fail");
    }

    // ── 4. Firebase Storage ──────────────────────────────────────────────
    console.log("\n" + bold("4. Firebase Storage"));

    const storage = admin.storage(app);
    const bucketName =
        STORAGE_VAR ||
        `${process.env.FIREBASE_PROJECT_ID}.appspot.com`;

    let bucket;
    try {
        bucket = storage.bucket(bucketName);
        // Test if bucket exists
        const [exists] = await bucket.exists();
        if (exists) {
            check(`Bucket exists: ${bucketName}`, true);
        } else {
            // Try to create the bucket
            info(`Bucket not found — attempting to create ${bucketName}...`);
            try {
                await bucket.create({ location: "us-central1" });
                check(`Bucket created: ${bucketName}`, true);
            } catch (createErr) {
                // Creating the default Firebase Storage bucket must be done via
                // the Firebase console — the Admin SDK can only manage existing buckets.
                check(`Bucket exists: ${bucketName}`, false,
                    "Enable Storage in Firebase Console → Storage → Get Started");
            }
        }
    } catch (err) {
        check("Storage bucket accessible", false, err.message);
    }

    // ── 5. Test file upload ────────────────────────────────────────────────
    if (bucket) {
        console.log("\n" + bold("5. Storage Upload Test"));
        try {
            const [exists] = await bucket.exists();
            if (exists) {
                const testFile = bucket.file("_setup_check/test.txt");
                await testFile.save(Buffer.from("Firebase Storage is working! 🔥"), {
                    metadata: { contentType: "text/plain" },
                    resumable: false,
                });
                const [fileExists] = await testFile.exists();
                await testFile.delete();
                check("Upload test (write + delete)", fileExists);
            } else {
                warn("Skipping upload test — bucket not accessible");
            }
        } catch (err) {
            check("Upload test", false, err.message);
            warn("Enable Firebase Storage in Console: https://console.firebase.google.com");
        }
    }

    // ── 6. CORS Configuration ────────────────────────────────────────────
    console.log("\n" + bold("6. Storage CORS"));

    const corsConfig = [
        {
            origin: ["*"],
            method: ["GET", "HEAD", "PUT", "POST", "DELETE"],
            responseHeader: ["Content-Type", "Authorization", "Content-Length", "User-Agent"],
            maxAgeSeconds: 3600,
        },
    ];

    try {
        if (bucket) {
            const [, metadata] = await bucket.exists();
            await bucket.setCorsConfiguration(corsConfig);
            check("CORS configured on storage bucket", true);
        }
    } catch (err) {
        warn(`CORS configuration skipped: ${err.message}`);
    }

    // ── 7. Firebase Rules Deployment ──────────────────────────────────────
    console.log("\n" + bold("7. Firebase Rules Deployment"));

    const firebaseJsonPath = path.join(process.cwd(), "firebase.json");
    const firestoreRulesPath = path.join(process.cwd(), "firestore.rules");
    const storageRulesPath = path.join(process.cwd(), "storage.rules");

    if (!fs.existsSync(firebaseJsonPath)) {
        warn("firebase.json not found — skipping rules deployment");
    } else if (!hasCLI("firebase")) {
        warn("Firebase CLI not found — install with: npm install -g firebase-tools");
        info("Then run: firebase deploy --only firestore:rules,storage");
    } else {
        // Deploy Firestore rules
        if (fs.existsSync(firestoreRulesPath)) {
            try {
                const result = spawnSync(
                    "firebase",
                    ["deploy", "--only", "firestore:rules", "--project", process.env.FIREBASE_PROJECT_ID],
                    { encoding: "utf-8", timeout: 60000 }
                );
                const ok = result.status === 0;
                check("Firestore rules deployed", ok, ok ? "" : (result.stderr?.slice(0, 100) || ""));
            } catch (err) {
                warn(`Firestore rules deploy failed: ${err.message}`);
            }
        }

        // Deploy Storage rules
        if (fs.existsSync(storageRulesPath)) {
            try {
                const result = spawnSync(
                    "firebase",
                    ["deploy", "--only", "storage", "--project", process.env.FIREBASE_PROJECT_ID],
                    { encoding: "utf-8", timeout: 60000 }
                );
                const ok = result.status === 0;
                check("Storage rules deployed", ok, ok ? "" : (result.stderr?.slice(0, 100) || ""));
            } catch (err) {
                warn(`Storage rules deploy failed: ${err.message}`);
            }
        }
    }

    // ── 8. Vercel Env Var Reminder ────────────────────────────────────────
    console.log("\n" + bold("8. Vercel Environment Variables"));

    const VERCEL_VARS = {
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? "✓ SET" : "❌ MISSING",
        FIREBASE_STORAGE_BUCKET: STORAGE_VAR || "❌ MISSING — add this!",
    };

    for (const [k, v] of Object.entries(VERCEL_VARS)) {
        if (v && !v.includes("MISSING")) {
            pass(`${k}`);
        } else {
            fail(`${k} — add to Vercel: https://vercel.com/dashboard`);
        }
    }

    // ── Summary ──────────────────────────────────────────────────────────
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    console.log("\n" + "─".repeat(55));
    console.log(bold("Summary:"));
    console.log(`  ${green(`${passed} passed`)}   ${failed > 0 ? red(`${failed} failed`) : green("0 failed")}`);

    if (failed === 0) {
        console.log(green("\n🎉 Firebase is fully configured and ready!\n"));
    } else {
        console.log(yellow("\n⚠️  Fix the issues above, then re-run this script.\n"));
        console.log(bold("Common fixes:"));
        console.log("  1. Enable Firebase Storage:");
        console.log("     https://console.firebase.google.com → Storage → Get Started\n");
        console.log("  2. Add FIREBASE_STORAGE_BUCKET to Vercel:");
        console.log(`     Value: ${STORAGE_VAR || process.env.FIREBASE_PROJECT_ID + ".appspot.com"}`);
        console.log("     https://vercel.com/dashboard → Settings → Environment Variables\n");
        console.log("  3. Deploy rules:");
        console.log("     npx firebase deploy --only firestore:rules,storage\n");
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(red(`\n💥 Unexpected error: ${err.message}\n`));
    process.exit(1);
});
