import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Fixing 61 unpaid members who are erroneously marked as active/approved...");
    const snap = await db.collection("cooperative_members").get();
    
    let fixed = 0;
    const batch = db.batch();

    snap.docs.forEach(doc => {
        const data = doc.data();
        const isActive = data.membershipStatus === "active" || data.membershipStatus === "approved" ||
                         data.status === "active" || data.status === "approved";
        
        if (isActive && data.paymentStatus !== "completed") {
            batch.update(doc.ref, {
                membershipStatus: "pending",
                status: "pending"
            });
            fixed++;
        }
    });

    if (fixed > 0) {
        await batch.commit();
        console.log(`Successfully reverted ${fixed} users back to pending.`);
    } else {
        console.log("No unpaid approved members found.");
    }
}
main();
