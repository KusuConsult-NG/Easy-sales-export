
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function purgeCorruptedMembers() {
    const db = getAdminDb();
    console.log("Searching for corrupted member records...");

    const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
    let purgedCount = 0;

    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const isCorrupted = !data.firstName || 
                           !data.lastName || 
                           data.firstName === "undefined" || 
                           data.lastName === "undefined";

        if (isCorrupted) {
            console.log(`Purging corrupted record for user: ${doc.id} (${data.firstName} ${data.lastName})`);
            batch.delete(doc.ref);
            purgedCount++;
            batchCount++;

            // Reset user's cooperative status
            const userRef = db.collection(COLLECTIONS.USERS).doc(doc.id);
            batch.set(userRef, {
                serviceRegistrations: {
                    cooperative: { status: "pending_repair", repairedAt: new Date() },
                    cooperatives: { status: "pending_repair", repairedAt: new Date() }
                }
            }, { merge: true });
            batchCount++;

            if (batchCount >= 400) {
                await batch.commit();
                batch = db.batch(); // Create new batch
                batchCount = 0;
            }
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`Purge complete. Deleted ${purgedCount} corrupted records.`);
}

purgeCorruptedMembers()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
