import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function healApplicationStatuses() {
    console.log("Healing application statuses for paid users...");
    
    let batch = db.batch();
    let updates = 0;

    const collectionsToHeal = [
        COLLECTIONS.COOPERATIVE_MEMBERS,
        COLLECTIONS.ACADEMY_APPLICATIONS,
        COLLECTIONS.WAVE_APPLICATIONS,
        COLLECTIONS.EXPORT_APPLICATIONS
    ];

    for (const collection of collectionsToHeal) {
        console.log(`Checking ${collection}...`);
        const snap = await db.collection(collection).where("paymentStatus", "==", "completed").get();
        console.log(`Found ${snap.docs.length} completed payments in ${collection}.`);

        for (const doc of snap.docs) {
            const data = doc.data();
            const needsUpdate = 
                (data.status === "pending" || !data.status) || 
                (collection === COLLECTIONS.COOPERATIVE_MEMBERS && (data.membershipStatus === "pending" || !data.membershipStatus));

            if (needsUpdate) {
                const updateData: any = { 
                    status: "approved",
                    updatedAt: new Date()
                };
                if (collection === COLLECTIONS.COOPERATIVE_MEMBERS) {
                    updateData.membershipStatus = "approved";
                }
                
                batch.update(doc.ref, updateData);
                updates++;
                console.log(`[${collection}] Updated doc ${doc.id} (User ${data.userId}) to approved.`);

                if (updates >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    updates = 0;
                    console.log("Committed batch...");
                }
            }
        }
    }

    if (updates > 0) {
        await batch.commit();
    }
    
    console.log("Status heal complete!");
}

healApplicationStatuses().catch(console.error);
