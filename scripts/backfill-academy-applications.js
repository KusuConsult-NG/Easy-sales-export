#!/usr/bin/env node

/**
 * Backfill Script: Create academy_applications records for users who paid
 * but have no corresponding academy_applications document.
 *
 * Usage: node scripts/backfill-academy-applications.js
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
        const match = line.match(/^([^#=]+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(.+))$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2] ?? match[3] ?? match[4] ?? "";
            // Unescape \\n → actual newlines
            value = value.replace(/\\n/g, "\n");
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY in .env.local");
    process.exit(1);
}

const app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
});

const db = getFirestore(app);

async function backfillAcademyApplications() {
    console.log("🔍 Scanning users for academy payments without academy_applications...\n");

    const usersSnap = await db.collection("users").get();
    let found = 0;
    let created = 0;
    let skipped = 0;

    for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const academy = userData?.serviceRegistrations?.academy;

        if (!academy || academy.paymentStatus !== "completed") {
            continue;
        }

        found++;

        // Check if they already have an academy_applications doc
        if (academy.applicationId) {
            const existingApp = await db.collection("academy_applications").doc(academy.applicationId).get();
            if (existingApp.exists) {
                console.log(`  ⏭️  ${userData.email || userDoc.id} — already has application ${academy.applicationId}`);
                skipped++;
                continue;
            }
        }

        // Also check by userId query
        const existingByUser = await db.collection("academy_applications")
            .where("userId", "==", userDoc.id)
            .limit(1)
            .get();

        if (!existingByUser.empty) {
            console.log(`  ⏭️  ${userData.email || userDoc.id} — found existing application by userId`);
            skipped++;
            continue;
        }

        // Create the academy_applications document
        const applicationId = `ACADEMY-BACKFILL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const appDoc = {
            userId: userDoc.id,
            applicationId,
            personalInfo: {
                fullName: userData.fullName || userData.name || "Unknown",
                email: userData.email || "Unknown",
                phone: userData.phone || userData.phoneNumber || "",
            },
            education: {
                educationLevel: "Not provided (backfilled from payment)",
                fieldOfStudy: "Not provided",
            },
            status: "pending",
            paymentStatus: "completed",
            paymentReference: academy.paymentReference || "unknown",
            paymentAmount: academy.paymentAmount || 0,
            plan: academy.plan || "foundation",
            submittedAt: academy.paidAt || FieldValue.serverTimestamp(),
            source: "backfill_script",
        };

        await db.collection("academy_applications").doc(applicationId).set(appDoc);

        // Link back to user
        await db.collection("users").doc(userDoc.id).update({
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.status": "pending",
        });

        console.log(`  ✅ Created application for ${userData.email || userDoc.id} → ${applicationId}`);
        created++;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Users with academy payment: ${found}`);
    console.log(`   Already had application:    ${skipped}`);
    console.log(`   New applications created:   ${created}`);
    console.log(`\n✅ Done!`);
}

backfillAcademyApplications().catch((err) => {
    console.error("❌ Backfill failed:", err);
    process.exit(1);
});
