import { getAdminDb } from "../src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const snap = await db.collection("failedPayments").limit(5).get();
    
    snap.docs.forEach((d, i) => {
        console.log(`\nDocument ${i + 1} fields keys:`, Object.keys(d.data()));
        console.log(`Document ${i + 1} data:`, d.data());
    });
}

run().catch(console.error);
