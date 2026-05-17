import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").limit(3).get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .limit(3)
        .get();
        
    console.log("=== MEMBERS ===");
    memSnap.docs.forEach(doc => console.log(doc.id, doc.data().userId, doc.data().paymentStatus, doc.data().email));
    
    console.log("=== PAYMENTS ===");
    paymentsSnap.docs.forEach(doc => console.log(doc.id, doc.data().userId, doc.data().email));
}

run().catch(console.error).finally(() => process.exit(0));
