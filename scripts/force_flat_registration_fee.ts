import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Starting cleanup: Enforcing flat 10,000 Naira fee and Member tier for all cooperative members...");
    const coopSnap = await db.collection("cooperative_members").get();
    
    let updatedCount = 0;
    let batch = db.batch();

    for (const doc of coopSnap.docs) {
        const data = doc.data();
        
        const currentFee = data.registrationFee;
        const currentTier = data.membershipTier || data.tier || "";
        
        const needsFeeUpdate = currentFee !== 10000;
        const needsTierUpdate = currentTier !== "Member";

        if (needsFeeUpdate || needsTierUpdate) {
            console.log(`  Updating Member ${doc.id} (${data.email || ""}): Fee: ${currentFee} -> 10000 | Tier: ${currentTier} -> Member`);
            
            const updates: any = {
                registrationFee: 10000,
                membershipTier: "Member",
                updatedAt: new Date()
            };

            // If "tier" field exists, set/update it too
            if (data.tier !== undefined) {
                updates.tier = "Member";
            }

            batch.update(doc.ref, updates);
            updatedCount++;

            if (updatedCount % 400 === 0) {
                await batch.commit();
                batch = db.batch();
                console.log(`  [Batch] Committed ${updatedCount} updates.`);
            }
        }
    }

    if (updatedCount % 400 > 0) {
        await batch.commit();
    }

    console.log(`\nSuccessfully updated ${updatedCount} members to flat 10,000 Naira fee and Member tier.`);
}

main().catch(console.error).finally(() => process.exit(0));
