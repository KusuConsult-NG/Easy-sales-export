
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { normalizeAggressive } from "../src/lib/canonical/normalizer";
import { LATEST_SCHEMA_VERSION } from "../src/lib/canonical/schemas";

/**
 * TOTAL PLATFORM RECOVERY (V6)
 * 
 * The Final Sweep. Reconciles ALL fields: Identity, Bank, Docs, KYC, and Module Enrollment.
 */

function isDeepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

async function runRepair() {
    console.log("🚀 Starting Total Platform Recovery (V6)...");

    // 1. Index All Modules
    console.log("📁 Indexing all truth sources (Sellers, Coop, WAVE)...");
    const sellers = new Map();
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();
    sellerSnap.docs.forEach(d => sellers.set(d.data().userId, d.data()));

    const members = new Map();
    const memberSnap = await db.collection("cooperative_members").get();
    memberSnap.docs.forEach(d => members.set(d.data().userId, d.data()));

    const waveApps = new Map();
    const waveSnap = await db.collection("wave_applications").get();
    waveSnap.docs.forEach(d => waveApps.set(d.data().userId, d.data()));

    console.log(`✅ Indices ready. Scanning 37,162 unique accounts...`);

    // 2. Batch Processing
    let processed = 0;
    let repaired = 0;
    const BATCH_SIZE = 500;
    let lastDoc = null;

    while (true) {
        let query = db.collection(COLLECTIONS.USERS).limit(BATCH_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const userId = doc.id;
            const uData = doc.data();

            const normalized = normalizeAggressive(
                userId,
                uData,
                sellers.get(userId),
                members.get(userId),
                waveApps.get(userId)
            );

            // TOTAL COMPARISON: Check for ANY drift in any canonical field
            const needsUpdate = 
                !uData.verificationProfile?.isCanonical || 
                uData.schemaVersion < LATEST_SCHEMA_VERSION ||
                !isDeepEqual(uData.verificationProfile, normalized.verificationProfile) ||
                !isDeepEqual(uData.serviceRegistrations, normalized.serviceRegistrations) ||
                uData.fullName !== normalized.fullName ||
                uData.phone !== normalized.phone;

            if (needsUpdate) {
                batch.update(doc.ref, {
                    ...normalized,
                    updatedAt: new Date(),
                    schemaVersion: LATEST_SCHEMA_VERSION
                });
                batchCount++;
                repaired++;
            }

            processed++;
            lastDoc = doc;
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`✅ Processed ${processed}... (${repaired} repaired)`);
        } else {
            if (processed % 5000 === 0) console.log(`⏩ Scanned ${processed}...`);
        }
    }

    console.log("\n=========================================");
    console.log("🎉 TOTAL RECOVERY COMPLETE");
    console.log("=========================================");
    console.log(`Total Scanned: ${processed}`);
    console.log(`Total Repaired: ${repaired}`);
    console.log("=========================================");
}

runRepair().catch(console.error);
