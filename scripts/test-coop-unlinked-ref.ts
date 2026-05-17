import { db } from "../src/lib/firebase-admin";

async function run() {
    const paymentsSnap = await db.collection("processedPayments")
        .where("reference", "==", "4h93mc1tl2")
        .get();
        
    console.log(`Found payments with reference 4h93mc1tl2: ${paymentsSnap.size}`);
    paymentsSnap.docs.forEach(doc => console.log(doc.id, doc.data()));
}

run().catch(console.error).finally(() => process.exit(0));
