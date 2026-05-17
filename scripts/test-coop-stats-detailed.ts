import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    
    let memPaid = 0;
    let memUnpaid = 0;
    memSnap.docs.forEach(doc => {
        if (paidUserIds.has(doc.data().userId || doc.id)) {
            memPaid++;
        } else {
            memUnpaid++;
        }
    });
    
    console.log(`Total member docs: ${memSnap.size}`);
    console.log(`Member docs WITH payment: ${memPaid}`);
    console.log(`Member docs WITHOUT payment: ${memUnpaid}`);
    console.log(`Total completed payments: ${paymentsSnap.size}`);
}

run().catch(console.error).finally(() => process.exit(0));
