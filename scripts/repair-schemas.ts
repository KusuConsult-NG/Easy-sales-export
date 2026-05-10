import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

async function repairSchemas() {
    console.log("Starting Schema Repair...");
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    let repairedCount = 0;
    
    // Batch process in chunks of 500
    const chunks = [];
    for (let i = 0; i < usersSnapshot.docs.length; i += 500) {
        chunks.push(usersSnapshot.docs.slice(i, i + 500));
    }

    for (const chunk of chunks) {
        const batch = db.batch();
        let batchHasUpdates = false;

        for (const doc of chunk) {
            const data = doc.data();
            const updates: any = {};
            let needsRepair = false;

            // 1. Enforce _schemaVersion
            if (!data._schemaVersion) {
                updates._schemaVersion = 2;
                needsRepair = true;
            }

            // 2. Enforce minimum roles array
            if (!data.roles || !Array.isArray(data.roles)) {
                updates.roles = ['general_user'];
                needsRepair = true;
            }

            // 3. Ensure serviceRegistrations exists
            if (!data.serviceRegistrations || typeof data.serviceRegistrations !== 'object') {
                updates.serviceRegistrations = {};
                needsRepair = true;
            }

            if (needsRepair) {
                updates.updatedAt = FieldValue.serverTimestamp();
                batch.set(doc.ref, updates, { merge: true });
                batchHasUpdates = true;
                repairedCount++;
            }
        }

        if (batchHasUpdates) {
            await batch.commit();
        }
    }

    console.log(`--- Schema Repair Complete ---`);
    console.log(`Repaired Documents: ${repairedCount}`);
}

repairSchemas().catch(console.error);
