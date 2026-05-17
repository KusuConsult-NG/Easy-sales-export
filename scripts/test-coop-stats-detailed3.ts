import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIdsFromAllPayments = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    
    let memUnpaid = 0;
    memSnap.docs.forEach(doc => {
        if (!paidUserIdsFromAllPayments.has(doc.data().userId || doc.id)) {
            memUnpaid++;
        }
    });
    
    console.log(`Member docs WITHOUT ANY completed payment: ${memUnpaid}`);
}

run().catch(console.error).finally(() => process.exit(0));
