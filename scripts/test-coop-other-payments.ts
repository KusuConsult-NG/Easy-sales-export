import { db } from "../src/lib/firebase-admin";

async function run() {
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const memSnap = await db.collection("cooperative_members").get();
    const memIds = new Set(memSnap.docs.map(doc => doc.data().userId).filter(Boolean));
    memSnap.docs.forEach(doc => memIds.add(doc.id));
    
    let otherPayments = 0;
    paymentsSnap.docs.forEach(doc => {
        if (!memIds.has(doc.data().userId)) {
            otherPayments++;
            if (otherPayments <= 3) {
                console.log("Other Payment:", doc.id, doc.data());
            }
        }
    });
    
    console.log(`Total other payments: ${otherPayments}`);
}

run().catch(console.error).finally(() => process.exit(0));
