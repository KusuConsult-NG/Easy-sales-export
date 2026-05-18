import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members").get();
    
    let batch = db.batch();
    let updates = 0;
    
    const now = new Date();
    // Midnight today in local time
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    // We want to find docs that were updated today by MY script
    // My script ran around May 18, 2026.
    
    snap.docs.forEach(doc => {
        const data = doc.data();
        
        if (data.status === "approved" || data.membershipStatus === "approved") {
            // Check if updatedAt is a Firestore Timestamp
            if (data.updatedAt && data.updatedAt._seconds) {
                const updatedTime = data.updatedAt._seconds * 1000;
                // If it was updated in the last 2 hours
                if (Date.now() - updatedTime < 2 * 60 * 60 * 1000) {
                    
                    // IF it doesn't have an approvedAt from today, it's definitely my script.
                    // Because an admin approving them would set approvedAt or approvedBy.
                    let wasManuallyApprovedToday = false;
                    if (data.approvedAt && data.approvedAt._seconds) {
                        const approvedTime = data.approvedAt._seconds * 1000;
                        if (Date.now() - approvedTime < 2 * 60 * 60 * 1000) {
                            wasManuallyApprovedToday = true;
                        }
                    }
                    
                    if (!wasManuallyApprovedToday) {
                        batch.update(doc.ref, {
                            status: "pending",
                            membershipStatus: "pending"
                        });
                        updates++;
                    }
                }
            }
        }
    });

    if (updates > 0) {
        await batch.commit();
        console.log(`Successfully reverted ${updates} users back to pending.`);
    } else {
        console.log("No users found to revert.");
    }
}
main().catch(console.error);
