import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members").get();
    
    let batch = db.batch();
    let updates = 0;
    
    for (const doc of snap.docs) {
        const data = doc.data();
        
        // If it's currently pending, let's see if it should actually be approved based on user profile
        if (data.status === "pending" || data.membershipStatus === "pending") {
            const userDoc = await db.collection("users").doc(data.userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const coopReg = userData?.serviceRegistrations?.cooperative;
                if (coopReg) {
                    if (coopReg.status === "approved" || coopReg.membershipStatus === "approved" || coopReg.status === "active" || coopReg.membershipStatus === "active") {
                        console.log(`User ${data.userId} was approved in users collection! Restoring...`);
                        
                        // We restore to whatever it was
                        batch.update(doc.ref, {
                            status: coopReg.status || "approved",
                            membershipStatus: coopReg.membershipStatus || "approved"
                        });
                        updates++;
                    }
                }
            }
        }
    }

    if (updates > 0) {
        await batch.commit();
        console.log(`Successfully restored ${updates} users from users collection.`);
    } else {
        console.log("No users found to restore.");
    }
}
main().catch(console.error);
