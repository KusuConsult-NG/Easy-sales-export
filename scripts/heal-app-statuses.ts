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
        
        let docsToProcess: any[] = [];
        
        // For large collections, use queries. For smaller ones, load all to catch legacy formats.
        if (collection === COLLECTIONS.WAVE_APPLICATIONS) {
            const snap = await db.collection(collection).where("paymentStatus", "in", ["completed", "paid"]).get();
            docsToProcess = snap.docs;
        } else {
            const snap = await db.collection(collection).get();
            docsToProcess = snap.docs.filter(doc => {
                const data = doc.data();
                return data.paymentStatus === "completed" || data.paymentStatus === "paid" || data.paid === true;
            });
        }
        
        console.log(`Found ${docsToProcess.length} paid/completed records in ${collection}.`);

        for (const doc of docsToProcess) {
            const data = doc.data();
            
            let needsUpdate = false;
            const updateData: any = {
                updatedAt: new Date()
            };
            
            if (collection === COLLECTIONS.COOPERATIVE_MEMBERS) {
                // For cooperative members, status and membershipStatus should be 'active'
                const currentStatus = data.status || "pending";
                const currentMemberStatus = data.membershipStatus || "pending";
                
                if (currentStatus !== "active" || currentMemberStatus !== "active") {
                    needsUpdate = true;
                    updateData.status = "active";
                    updateData.membershipStatus = "active";
                    
                    // Also canonicalize payment status
                    if (data.paymentStatus !== "completed") {
                        updateData.paymentStatus = "completed";
                    }
                }
            } else {
                // For other applications, status should be 'approved'
                const currentStatus = data.status || "pending";
                if (currentStatus !== "approved") {
                    needsUpdate = true;
                    updateData.status = "approved";
                    
                    // Also canonicalize payment status
                    if (data.paymentStatus !== "completed" && data.paymentStatus !== "paid") {
                        updateData.paymentStatus = "completed";
                    }
                }
            }

            if (needsUpdate) {
                batch.update(doc.ref, updateData);
                updates++;
                console.log(`[${collection}] Queued update for doc ${doc.id} (User ${data.userId || "unknown"}) -> ${JSON.stringify(updateData)}`);

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
        console.log("Committed final batch.");
    }
    
    console.log("Status heal complete!");
}

healApplicationStatuses().catch(console.error);
