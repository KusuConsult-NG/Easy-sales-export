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

        if (singularCoop || pluralCoop) {
            const getProgressScore = (status: string) => {
                switch (status) {
                    case 'active':
                    case 'approved':
                        return 4;
                    case 'pending':
                    case 'pending_review':
                    case 'revision_required':
                        return 3;
                    case 'pending_repair':
                    case 'legacy_pending_onboarding':
                        return 2;
                    case 'not_started':
                        return 1;
                    default:
                        return 0;
                }
            };
            const scorePlural = getProgressScore(pluralCoop?.status || '');
            const scoreSingular = getProgressScore(singularCoop?.status || '');

            const mergedCoop = scoreSingular > scorePlural
                ? { ...(pluralCoop || {}), ...(singularCoop || {}) }
                : { ...(singularCoop || {}), ...(pluralCoop || {}) };

            const needsUpdate = 
                JSON.stringify(pluralCoop) !== JSON.stringify(mergedCoop) ||
                JSON.stringify(singularCoop) !== JSON.stringify(mergedCoop);

            if (needsUpdate) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const updatePayload = {
                    "serviceRegistrations.cooperatives": mergedCoop,
                    "serviceRegistrations.cooperative": mergedCoop
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
