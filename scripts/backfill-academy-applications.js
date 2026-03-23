/**
 * backfill-academy-applications.js
 * ─────────────────────────────────
 * Finds all users with completed academy payments (serviceRegistrations.academy.paymentStatus === "completed")
 * that do NOT already have an academy_applications document, then creates one for each.
 *
 * Run: node scripts/backfill-academy-applications.js
 */

const path = require("path");
require("dotenv").config({ path: ".env.local" });

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// ── Firebase Init ───────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length) return getFirestore();
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
        console.error("❌ Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY in .env.local");
        process.exit(1);
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    return getFirestore();
}

const db = initFirebase();

async function run() {
    console.log("🔍 Scanning users for completed academy payments...");

    // 1. Get all existing academy_applications to avoid duplicates
    const existingSnap = await db.collection("academy_applications").get();
    const existingRefs = new Set(existingSnap.docs.map(d => d.data().paymentReference).filter(Boolean));
    const existingUserIds = new Set(existingSnap.docs.map(d => d.data().userId).filter(Boolean));
    console.log(`   Existing academy_applications: ${existingSnap.size}`);

    // 2. Get all users  
    const usersSnap = await db.collection("users").get();
    console.log(`   Total users: ${usersSnap.size}`);

    const batch = db.batch();
    let count = 0;

    for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const academy = userData.serviceRegistrations?.academy;

        if (!academy) continue;
        if (academy.paymentStatus !== "completed") continue;

        const ref = academy.paymentReference;
        const userId = userDoc.id;

        // Skip if already have an entry for this user or this payment reference
        if (existingUserIds.has(userId) || (ref && existingRefs.has(ref))) {
            console.log(`   ↳ Skipping ${userId} — already has academy_applications entry`);
            continue;
        }

        const applicationId = academy.applicationId || `ACADEMY-BACKFILL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const appRef = db.collection("academy_applications").doc(applicationId);

        batch.set(appRef, {
            userId,
            applicationId,
            personalInfo: {
                fullName: userData.fullName || userData.name || "Unknown",
                email: userData.email || "—",
                phone: userData.phone || userData.phoneNumber || "",
            },
            education: {
                educationLevel: "Not provided (backfilled from payment)",
                fieldOfStudy: "Not provided",
            },
            status: academy.status || "pending",
            paymentStatus: "completed",
            paymentReference: ref || null,
            paymentAmount: academy.paymentAmount || null,
            plan: academy.plan || null,
            submittedAt: academy.paidAt || FieldValue.serverTimestamp(),
            source: "backfill_script_v2",
        }, { merge: true });

        // Also link back to user doc if not already linked
        if (!academy.applicationId) {
            const userRef = db.collection("users").doc(userId);
            batch.update(userRef, {
                "serviceRegistrations.academy.applicationId": applicationId,
            });
        }

        count++;
        console.log(`   ✅ Queued: ${userData.fullName || userData.email} (${userId}) — plan: ${academy.plan}, amount: ${academy.paymentAmount}`);
    }

    if (count === 0) {
        console.log("\n✅ Nothing to backfill — all academy payments already have applications.");
        process.exit(0);
    }

    console.log(`\n📝 Committing ${count} new academy_applications entries...`);
    await batch.commit();
    console.log("✅ Done.\n");
    process.exit(0);
}

run().catch(err => {
    console.error("❌ Error:", err);
    process.exit(1);
});
