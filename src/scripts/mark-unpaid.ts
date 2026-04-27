import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";

async function markUnpaid() {
    console.log("Starting script to explicitly mark 99 bypassed users as 'unpaid'...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    let updatedCount = 0;
    
    // We can use a batch
    const batch = db.batch();
    
    for (const doc of usersSnap.docs) {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        // Target users who have academy status but NOT 'completed' paymentStatus
        if (academy && academy.status && academy.paymentStatus !== 'completed') {
            const userId = doc.id;
            
            // 1. Update the user document
            batch.update(db.collection(COLLECTIONS.USERS).doc(userId), {
                "serviceRegistrations.academy.paymentStatus": "unpaid"
            });
            
            // 2. Find and update their application document
            const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", userId)
                .limit(1)
                .get();
                
            if (!appSnap.empty) {
                const appId = appSnap.docs[0].id;
                batch.update(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(appId), {
                    paymentStatus: "unpaid"
                });
            }
            
            updatedCount++;
            console.log(`Marking user ${userId} as unpaid`);
        }
    }
    
    if (updatedCount > 0) {
        await batch.commit();
        console.log(`Successfully marked ${updatedCount} users as 'unpaid'!`);
    } else {
        console.log("No users found to update.");
    }
    
    process.exit(0);
}

markUnpaid().catch(console.error);
