import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidRefs = new Set(paymentsSnap.docs.map(doc => doc.data().reference).filter(Boolean));
    const paidTrxRefs = new Set(paymentsSnap.docs.map(doc => doc.data().trxref).filter(Boolean));
    
    let matchedByRef = 0;
    
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentReference && (paidRefs.has(d.paymentReference) || paidTrxRefs.has(d.paymentReference))) {
            matchedByRef++;
        }
    });
    
    console.log(`Matched by paymentReference: ${matchedByRef}`);
}

run().catch(console.error).finally(() => process.exit(0));
