#!/usr/bin/env node
/**
 * diagnose-export-500.cjs
 *
 * WHAT THIS DOES:
 * Runs the EXACT same Firestore queries that getAllExportRequestsAction
 * executes in production, using real credentials. Prints the actual
 * error so we stop guessing.
 *
 * RUN:
 *   node diagnose-export-500.cjs
 */

"use strict";

require("dotenv").config({ path: ".env.local" });

// ─── 1. Verify all required env vars are present ─────────────────────────────
const REQUIRED = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
];

let envOk = true;
for (const key of REQUIRED) {
    const val = process.env[key];
    if (!val) {
        console.error(`❌  Missing env var: ${key}`);
        envOk = false;
    } else {
        const preview = val.length > 60 ? val.slice(0, 60) + "…" : val;
        console.log(`✅  ${key} = ${preview}`);
    }
}
if (!envOk) {
    console.error("\nAborting: fix missing env vars first.\n");
    process.exit(1);
}

// ─── 2. Parse private key (same logic as firebase-admin.ts) ──────────────────
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
}
privateKey = privateKey.replace(/\\n/g, "\n");

if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    console.error("❌  FIREBASE_PRIVATE_KEY does not look like a valid PEM key!");
    process.exit(1);
}
console.log("✅  Private key parsed OK\n");

// ─── 3. Init Firebase Admin ───────────────────────────────────────────────────
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore }                   = require("firebase-admin/firestore");

let app;
try {
    app = getApps().length > 0
        ? getApps()[0]
        : initializeApp({
              credential: cert({
                  projectId:   process.env.FIREBASE_PROJECT_ID,
                  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                  privateKey,
              }),
          });
    console.log("✅  Firebase Admin initialized\n");
} catch (e) {
    console.error("❌  Firebase Admin INIT FAILED:", e.message);
    process.exit(1);
}

const db = getFirestore(app);
try {
    db.settings({ preferRest: true, ignoreUndefinedProperties: true });
} catch (_) { /* already set */ }

// ─── 4. Run the exact queries getAllExportRequestsAction runs ─────────────────
const COLLECTION = "exportWindows";

async function diagnose() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 1 — collection exists / basic read");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection(COLLECTION).limit(1).get();
        console.log(`✅  Collection "${COLLECTION}" accessible. Doc count in sample: ${snap.docs.length}`);
        if (snap.docs.length > 0) {
            const firstDoc = snap.docs[0];
            const d = firstDoc.data();
            console.log("    Sample doc id   :", firstDoc.id);
            console.log("    Sample doc keys  :", Object.keys(d).join(", "));
            console.log("    status           :", d.status);
            console.log("    createdAt type   :", d.createdAt?.constructor?.name ?? "undefined");
        } else {
            console.warn("⚠️   Collection is EMPTY — that's likely why the UI shows nothing.");
        }
    } catch (e) {
        console.error("❌  BASIC READ FAILED:", e.message);
        console.error("    Full error:", e);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 2 — orderBy('createdAt','desc') .limit(50)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db
            .collection(COLLECTION)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();
        console.log(`✅  orderBy query OK. Docs returned: ${snap.docs.length}`);
    } catch (e) {
        console.error("❌  orderBy QUERY FAILED:", e.message);
        if (e.message?.includes("index")) {
            console.error("    → MISSING FIRESTORE INDEX. Open this URL to create it:");
            console.error("      https://console.firebase.google.com/project/"
                + process.env.FIREBASE_PROJECT_ID
                + "/firestore/indexes");
        }
        console.error("    Full error:", e);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 3 — where('status','==','pending') .limit(50)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db
            .collection(COLLECTION)
            .where("status", "==", "pending")
            .limit(50)
            .get();
        console.log(`✅  Status filter query OK. Docs returned: ${snap.docs.length}`);
    } catch (e) {
        console.error("❌  STATUS FILTER QUERY FAILED:", e.message);
        console.error("    Full error:", e);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 4 — Firestore users collection (session-guard lookup)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection("users").limit(1).get();
        console.log(`✅  Users collection accessible. Sample count: ${snap.docs.length}`);
        if (snap.docs.length > 0) {
            const d = snap.docs[0].data();
            console.log("    Sample roles:", d.roles);
        }
    } catch (e) {
        console.error("❌  USERS COLLECTION READ FAILED:", e.message);
        console.error("    → This means requireSession() will fail on EVERY request, causing 500 on all admin routes.");
        console.error("    Full error:", e);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 5 — Serialization safety on real docs");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection(COLLECTION).limit(5).get();
        const serialized = snap.docs.map((doc) => {
            const data = doc.data();
            return {
                id:          doc.id,
                orderId:     data.orderId     || "",
                title:       data.title       || "",
                commodity:   data.commodity   || "other",
                quantity:    data.quantity    || "0",
                amount:      Number(data.amount) || 0,
                status:      data.status      || "pending",
                createdAt:   data.createdAt?.toDate
                                 ? data.createdAt.toDate().toISOString()
                                 : new Date().toISOString(),
                deliveryDate: data.deliveryDate?.toDate
                                 ? data.deliveryDate.toDate().toISOString()
                                 : null,
            };
        });

        // Try JSON round-trip — the same thing React Flight will do
        const json = JSON.stringify(serialized);
        console.log(`✅  Serialization OK. JSON length: ${json.length} bytes.`);
        console.log("    First record:", JSON.parse(json)[0] ?? "(none)");
    } catch (e) {
        console.error("❌  SERIALIZATION FAILED:", e.message);
        console.error("    → This is the React Flight crash cause.");
        console.error("    Full error:", e);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("DIAGNOSIS COMPLETE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

diagnose().catch((e) => {
    console.error("UNHANDLED TOP-LEVEL ERROR:", e);
    process.exit(1);
});
