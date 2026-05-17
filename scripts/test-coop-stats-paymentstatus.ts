import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    
    let paidStatus = 0;
    let pendingStatus = 0;
    let missingStatus = 0;
    let failedStatus = 0;
    let others = 0;

    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentStatus === "completed" || d.paymentStatus === "paid" || d.paymentStatus === "successful") {
            paidStatus++;
        } else if (d.paymentStatus === "pending") {
            pendingStatus++;
        } else if (d.paymentStatus === "failed") {
            failedStatus++;
        } else if (!d.paymentStatus) {
            missingStatus++;
        } else {
            others++;
        }
    });
    
    console.log(`Total members: ${memSnap.size}`);
    console.log(`paymentStatus completed/paid: ${paidStatus}`);
    console.log(`paymentStatus pending: ${pendingStatus}`);
    console.log(`paymentStatus failed: ${failedStatus}`);
    console.log(`paymentStatus missing: ${missingStatus}`);
    console.log(`paymentStatus others: ${others}`);
}

run().catch(console.error).finally(() => process.exit(0));
