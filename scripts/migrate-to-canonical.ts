
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

/**
 * PLATFORM-WIDE RECONCILIATION SCRIPT (V3)
 * 
 * Reconciles Marketplace AND Cooperatives data to root User documents.
 */

async function runMigration() {
    console.log("🚀 Starting Platform-Wide Reconciliation (V3)...");
    
    // 1. Index Seller Verifications
    console.log("📁 Indexing Seller Verifications...");
    const sellerMap = new Map();
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();
    sellerSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.userId) {
            const existing = sellerMap.get(data.userId);
            if (!existing || (data.createdAt?.seconds > existing.createdAt?.seconds)) {
                sellerMap.set(data.userId, data);
            }
        }
    });

    // 2. Index Cooperative Members
    console.log("📁 Indexing Cooperative Members...");
    const coopMap = new Map();
    const coopSnap = await db.collection("cooperative_members").get();
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.userId) coopMap.set(data.userId, data);
    });
    console.log(`✅ Indexed ${sellerMap.size} Sellers and ${coopMap.size} Coop Members.`);

    // 3. Process Users
    let processedCount = 0;
    let repairedCount = 0;
    let lastDoc = null;
    const BATCH_SIZE = 500;

    while (true) {
        let query = db.collection(COLLECTIONS.USERS).limit(BATCH_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        let batchHasUpdates = false;

        for (const doc of snapshot.docs) {
            const userId = doc.id;
            const uData = doc.data();
            const updates: any = {};

            // A. Marketplace Repair
            const sData = sellerMap.get(userId);
            if (sData && !uData.verificationProfile?.isCanonical) {
                updates.verificationProfile = {
                    fullName: uData.fullName || sData.businessName || "Unknown",
                    phone: uData.phone || sData.phone || sData.phoneNumber || "",
                    bankDetails: uData.bankDetails || sData.bankDetails || { bankName: sData.bankName || "N/A", accountNumber: sData.accountNumber || "N/A", accountName: sData.accountName || "N/A" },
                    status: uData.sellerVerificationStatus || sData.status || "pending",
                    isCanonical: true,
                    migratedAt: new Date()
                };
                updates["serviceRegistrations.marketplace.status"] = updates.verificationProfile.status === "approved" ? "active" : updates.verificationProfile.status;
            }

            // B. Cooperative Repair
            const cData = coopMap.get(userId);
            if (cData && uData.serviceRegistrations?.cooperative?.status !== "active") {
                updates["serviceRegistrations.cooperative"] = {
                    status: "active",
                    memberId: cData.memberId || doc.id,
                    joinedAt: cData.createdAt || new Date(),
                    paymentStatus: "completed"
                };
            }

            if (Object.keys(updates).length > 0) {
                batch.update(doc.ref, updates);
                batchHasUpdates = true;
                repairedCount++;
            }

            processedCount++;
            lastDoc = doc;
        }

        if (batchHasUpdates) {
            await batch.commit();
            console.log(`✅ Progress: ${processedCount} users... (${repairedCount} repaired)`);
        } else {
            // Speed up if no repairs needed in this batch
            if (processedCount % 10000 === 0) console.log(`⏩ Scanned ${processedCount} users...`);
        }
    }

    console.log(`\n🎉 RECONCILIATION COMPLETE!`);
    console.log(`Total Scanned: ${processedCount}`);
    console.log(`Total Repaired: ${repairedCount}`);
}

runMigration().catch(console.error);
