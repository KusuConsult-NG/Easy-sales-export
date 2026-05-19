import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function alignCoopKeys() {
    console.log("Starting Cooperative Key Plurality Migration...");

    console.log("Fetching all users...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    console.log(`Loaded ${usersSnap.size} users.`);

    let migrationCount = 0;
    let skipCount = 0;
    let batch = db.batch();
    let count = 0;

    for (const doc of usersSnap.docs) {
        const userId = doc.id;
        const data = doc.data();

        const serviceRegs = data.serviceRegistrations || {};
        const singularCoop = serviceRegs.cooperative;
        const pluralCoop = serviceRegs.cooperatives;

        // If singular exists, we need to merge/copy it into plural
        if (singularCoop) {
            const mergedCoop = {
                ...(pluralCoop || {}),
                ...singularCoop
            };

            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            
            // Update both keys: set plural to the merged value, and delete/unset singular
            // We can do this in a single update
            const updatePayload: any = {
                "serviceRegistrations.cooperatives": mergedCoop,
                // Optional: We can choose to keep or unset the singular key. Let's merge it and clean it up.
                // Keeping it is fine for backward compatibility, but standardizing on plural is the target.
                // To be completely safe and backward-compatible, we can keep the singular key or just write to both.
                // The prompt says "merge/copy them into serviceRegistrations.cooperatives". 
                // Let's copy it to plural and keep singular as is for full compatibility.
            };

            batch.update(userRef, updatePayload);
            count++;
            migrationCount++;

            if (count >= 400) {
                await batch.commit();
                batch = db.batch();
                count = 0;
                console.log(`Committed batch: ${migrationCount} migrated so far...`);
            }
        } else {
            skipCount++;
        }
    }

    if (count > 0) {
        await batch.commit();
        console.log(`Committed final batch: ${migrationCount} total migrated.`);
    }

    console.log(`Key alignment complete. Migrated: ${migrationCount}, Skipped/Already Aligned: ${skipCount}`);
}

alignCoopKeys().catch(console.error);
