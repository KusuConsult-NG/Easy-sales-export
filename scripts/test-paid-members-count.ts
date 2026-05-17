import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId).filter(Boolean));
    
    let matchedById = 0;
    
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (paidUserIds.has(d.userId || doc.id)) {
            matchedById++;
        }
    });
    
    console.log(`Matched by userId || doc.id: ${matchedById}`);
}

run().catch(console.error).finally(() => process.exit(0));
