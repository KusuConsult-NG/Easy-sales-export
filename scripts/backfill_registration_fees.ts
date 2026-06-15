import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Starting backfill of missing registration fees...");
    const coopSnap = await db.collection("cooperative_members").get();
    
    let backfilledCount = 0;
    let batch = db.batch();

    for (const doc of coopSnap.docs) {
        const data = doc.data();
        const fee = data.registrationFee;
        
        // If registrationFee is missing, undefined, null, or 0
        if (fee === undefined || fee === null || fee === 0) {
            // Determine the fee:
            // 1. If amountPaid exists, use it
            // 2. If tier is premium, use 20000, else default to 10000
            let targetFee = 10000;
            if (data.amountPaid && data.amountPaid > 0) {
                targetFee = data.amountPaid;
            } else if (data.membershipTier === "premium" || data.tier === "premium") {
                targetFee = 20000;
            } else if (data.registrationFee && data.registrationFee > 0) {
                targetFee = data.registrationFee;
            }

            console.log(`  Setting registrationFee to ₦${targetFee} for Member ${doc.id} (${data.email || ""})`);
            batch.update(doc.ref, {
                registrationFee: targetFee,
                updatedAt: new Date()
            });

            backfilledCount++;

            if (backfilledCount % 400 === 0) {
                await batch.commit();
                batch = db.batch();
                console.log(`  [Batch] Committed ${backfilledCount} updates.`);
            }
        }
    }

    if (backfilledCount % 400 > 0) {
        await batch.commit();
    }

    console.log(`\nSuccessfully backfilled registrationFee for ${backfilledCount} members.`);
}

main().catch(console.error).finally(() => process.exit(0));
