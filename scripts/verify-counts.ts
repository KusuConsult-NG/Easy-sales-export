import { db } from "../src/lib/firebase-admin";

async function verifyCounts() {
    try {
        const memSnap = await db.collection("cooperative_members").count().get();
        console.log(`Total cooperative_members documents: ${memSnap.data().count}`);

        const paymentSnap = await db.collection("processedPayments")
            .where("type", "==", "cooperative_membership_registration")
            .where("status", "==", "completed")
            .get();
            
        console.log(`Total processedPayments for cooperative registration: ${paymentSnap.docs.length}`);
        
        // Let's also check the actual export script logic
        const memGetSnap = await db.collection("cooperative_members").get();
        const memUserIds = new Set();
        memGetSnap.docs.forEach(doc => memUserIds.add(doc.data().userId || doc.id));
        
        let orphanedPayments = 0;
        paymentSnap.docs.forEach(doc => {
            if (doc.data().userId && !memUserIds.has(doc.data().userId)) {
                orphanedPayments++;
            }
        });
        
        console.log(`Unique User IDs in cooperative_members: ${memUserIds.size}`);
        console.log(`Orphaned Payments (paid but not in cooperative_members): ${orphanedPayments}`);
        console.log(`Total records script would generate: ${memGetSnap.docs.length + orphanedPayments}`);
        
    } catch(e) {
        console.error("Error:", e);
    }
}

verifyCounts();
