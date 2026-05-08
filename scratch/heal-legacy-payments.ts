import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * HEAL SCRIPT: Legacy Payment Status Synchronizer
 * 
 * Objective: 
 * Identify all users who were onboarded via the Legacy Admin flow but are missing 
 * the 'paymentStatus: "completed"' flag in their service registrations.
 * 
 * Logic:
 * 1. Scan for users where onboardingCompleted: true AND isVerified: true.
 * 2. Check if serviceRegistrations exist.
 * 3. Proactively backfill paymentStatus: "completed" for any approved service.
 */

async function healLegacyPayments() {
    console.log("🚀 Starting Legacy Payment Healing Process...");
    
    const usersSnap = await db.collection(COLLECTIONS.USERS)
        .where("onboardingCompleted", "==", true)
        .where("isVerified", "==", true)
        .get();

    console.log(`Found ${usersSnap.size} potentially onboarded legacy users.`);
    
    let updatedCount = 0;
    const batch = db.batch();
    let batchSize = 0;

    for (const doc of usersSnap.docs) {
        const data = doc.data();
        const serviceRegistrations = data.serviceRegistrations || {};
        let needsUpdate = false;
        
        // Update all approved services to include paymentStatus: "completed"
        for (const serviceKey in serviceRegistrations) {
            const registration = serviceRegistrations[serviceKey];
            if (registration.status === "approved" && registration.paymentStatus !== "completed") {
                registration.paymentStatus = "completed";
                registration.onboardingCompleted = true; // Ensure this is also set
                needsUpdate = true;
                console.log(`[HEAL] User ${data.email}: Flagging ${serviceKey} as PAID.`);
            }
        }

        if (needsUpdate) {
            batch.update(doc.ref, { serviceRegistrations });
            updatedCount++;
            batchSize++;

            if (batchSize === 400) {
                await batch.commit();
                console.log("Committed batch of 400...");
                batchSize = 0;
            }
        }
    }

    if (batchSize > 0) {
        await batch.commit();
    }

    console.log(`✅ Healing complete. ${updatedCount} users updated.`);
}

healLegacyPayments().catch(console.error);
