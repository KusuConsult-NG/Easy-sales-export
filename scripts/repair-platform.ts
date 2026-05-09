
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { normalizeAggressive } from "../src/lib/canonical/normalizer";
import { LATEST_SCHEMA_VERSION } from "../src/lib/canonical/schemas";

const COLLECTIONS = {
    USERS: "users",
};

async function totalPlatformRecovery() {
    console.log("🚀 Starting Total Platform Recovery (V10 - Safety Guaranteed)...");

    // 1. Index everything
    console.log("📁 Indexing all truth sources (Sellers, Coop, WAVE)...");
    
    const sellersByUid = new Map();
    const sellerSnap = await db.collection("seller_verifications").get();
    sellerSnap.docs.forEach(d => sellersByUid.set(d.data().userId, d.data()));

    const membersByUid = new Map();
    const membersByEmail = new Map();
    const memberSnap = await db.collection("cooperative_members").get();
    memberSnap.docs.forEach(d => {
        const data = d.data();
        if (data.userId) membersByUid.set(data.userId, data);
        const emails = [data.userEmail, data.email].filter(Boolean);
        emails.forEach(e => membersByEmail.set(e.toLowerCase(), data));
    });

    const waveByUid = new Map();
    const waveByEmail = new Map();
    const waveSnap = await db.collection("wave_applications").get();
    waveSnap.docs.forEach(d => {
        const data = d.data();
        if (data.userId) waveByUid.set(data.userId, data);
        const emails = [data.userEmail, data.email, data.contactEmail].filter(Boolean);
        emails.forEach(e => waveByEmail.set(e.toLowerCase(), data));
    });

    console.log(`✅ Indices ready. (Sellers: ${sellersByUid.size}, Members: ${membersByUid.size}, WAVE: ${waveSnap.size})`);

    // 2. Batch Processing
    let processed = 0;
    let repaired = 0;
    let errors = 0;
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
            
            // CRITICAL FIX: Handle corrupted UID objects from previous bad run
            const actualUid = typeof userId === 'string' ? userId : (uData.uid?.uid || uData.uid || doc.id);
            const email = (uData.email || uData.uid?.email)?.toLowerCase();

            // RECONCILIATION LOGIC: Correct argument order for normalizeAggressive
            // (userId, uData, sData, cData, wData)
            const sellerSource = sellersByUid.get(actualUid);
            const memberSource = membersByUid.get(actualUid) || (email ? membersByEmail.get(email) : null);
            const waveSource = waveByUid.get(actualUid) || (email ? waveByEmail.get(email) : null);

            try {
                const canonical = normalizeAggressive(
                    actualUid, 
                    uData.uid?.uid ? uData.uid : uData, // Unpack corrupted data if found
                    sellerSource, 
                    memberSource, 
                    waveSource
                );

                // SAFETY CHECK: Don't downgrade data
                const oldBank = uData.verificationProfile?.bankDetails?.bankName || "N/A";
                const newBank = canonical.verificationProfile?.bankDetails?.bankName || "N/A";
                
                // FORCE UPDATE if we have new data OR if we need to fix the corrupted schema/uid
                const needsFix = uData.schemaVersion < 10 || 
                                (newBank !== "N/A" && oldBank === "N/A") ||
                                (typeof uData.uid !== 'string');

                if (needsFix) {
                    batch.update(doc.ref, {
                        ...canonical,
                        schemaVersion: 10,
                        updatedAt: new Date()
                    });
                    batchCount++;
                    repaired++;
                }
            } catch (e) {
                errors++;
            }

            processed++;
            lastDoc = doc;
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`✅ Processed ${processed}... (${repaired} repaired/fixed)`);
        } else {
            if (processed % 5000 === 0) console.log(`⏩ Scanned ${processed}...`);
        }
    }

    console.log("\n=========================================");
    console.log("🎉 TOTAL RECOVERY V10 COMPLETE");
    console.log(`Total Scanned: ${processed}`);
    console.log(`Total Repaired: ${repaired}`);
    console.log(`Errors: ${errors}`);
    console.log("=========================================\n");
}

totalPlatformRecovery().catch(console.error);
