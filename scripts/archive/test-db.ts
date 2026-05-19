import { db } from "./src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    let paymentStatusCompleted = 0;
    let noPaymentStatus = 0;
    
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentStatus === 'completed') paymentStatusCompleted++;
        else noPaymentStatus++;
    });
    
    console.log(`Payment Status Completed in cooperative_members: ${paymentStatusCompleted}`);
    console.log(`No Payment Status or Not Completed: ${noPaymentStatus}`);
}
run();
