#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: ".env.local" });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, "\n");

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = getApps().length > 0 ? getApps()[0] : initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
    }),
});

const db = getFirestore(app);
try { db.settings({ preferRest: true, ignoreUndefinedProperties: true }); } catch (_) {}

async function run() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 1 — academy_applications: how many docs total?");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection("academy_applications").limit(10).get();
        console.log("Docs found:", snap.docs.length);
        if (snap.docs.length > 0) {
            const first = snap.docs[0].data();
            console.log("First doc fields:", Object.keys(first).join(", "));
            console.log("status:", first.status);
            console.log("userId:", first.userId);
            console.log("submittedAt type:", first.submittedAt?.constructor?.name);
            console.log("createdAt type:", first.createdAt?.constructor?.name);
        } else {
            console.warn("⚠️  EMPTY — no academy applications exist in Firestore yet");
        }
    } catch (e) {
        console.error("❌ FAILED:", e.message);
        if (e.message?.includes("index")) {
            console.error("   → MISSING INDEX. Create at: https://console.firebase.google.com/project/" + process.env.FIREBASE_PROJECT_ID + "/firestore/indexes");
        }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 2 — query with status == 'pending' (used by admin)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection("academy_applications")
            .where("status", "==", "pending")
            .get();
        console.log("Pending docs:", snap.docs.length);
    } catch (e) {
        console.error("❌ FAILED:", e.message);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 3 — orderBy('createdAt','desc') (paginated admin view)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection("academy_applications")
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();
        console.log("Docs returned:", snap.docs.length);
    } catch (e) {
        console.error("❌ FAILED:", e.message);
        if (e.message?.includes("index")) {
            console.error("   → Missing composite index for (status, createdAt). Create at:");
            console.error("     https://console.firebase.google.com/project/" + process.env.FIREBASE_PROJECT_ID + "/firestore/indexes");
        }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("TEST 4 — users with serviceRegistrations.academy.status set");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        const snap = await db.collection("users")
            .where("serviceRegistrations.academy.status", "!=", null)
            .limit(10)
            .get();
        console.log("Users with academy registration:", snap.docs.length);
        snap.docs.forEach(d => {
            const data = d.data();
            console.log(" - id:", d.id, "| academy status:", data.serviceRegistrations?.academy?.status, "| applicationId:", data.serviceRegistrations?.academy?.applicationId);
        });
    } catch (e) {
        console.error("❌ FAILED:", e.message);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("DONE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
